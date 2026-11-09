#!/usr/bin/env node
// 第2段階のローカルブラウザ監査。無効アダプタの通信0と、一覧の空状態を見る。
// 本番・プレビューは見ていない。node tools/stage2-browser-audit.mjs
import { spawn, execSync } from "child_process";
import { createServer } from "http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, createReadStream } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outDir = args.includes("--out") ? args[args.indexOf("--out") + 1] : (existsSync("/opt/cursor/artifacts") ? "/opt/cursor/artifacts" : path.join(root, "tools", "audit-output"));
mkdirSync(outDir, { recursive: true });
const chromeBin = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find((p) => p && existsSync(p));
if (!chromeBin) { console.error("Chrome がありません"); process.exit(2); }
const headerList = (JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8")).headers[0].headers);
const staticHeaders = Object.fromEntries(headerList.map((h) => [h.key, h.value]));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8" };
const site = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404, staticHeaders); res.end("not found"); return; }
  res.writeHead(200, { ...staticHeaders, "Cache-Control": "no-store", "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
const sitePort = site.address().port;
const origin = "http://127.0.0.1:" + sitePort;
const chromePort = 9400 + (process.pid % 400);
const chrome = spawn(chromeBin, ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking", "--disable-extensions", "--remote-debugging-port=" + chromePort, "--user-data-dir=" + path.join("/tmp", "mail-check-stage2-" + process.pid), "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
let chromeLog = "";
chrome.stderr.on("data", (b) => { chromeLog += b.toString(); });
async function waitJson(url) {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(chromeLog.slice(-500));
}
const pageTarget = (await waitJson("http://127.0.0.1:" + chromePort + "/json/list")).find((t) => t.type === "page");
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
const pending = new Map();
const net = [];
let seq = 0;
function send(method, params) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params: params || {} }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
  } else if (msg.method === "Network.requestWillBeSent") {
    net.push({ url: msg.params.request.url, method: msg.params.request.method, type: msg.params.type, postData: msg.params.request.postData || "" });
  }
});
await send("Network.enable"); await send("Page.enable"); await send("Runtime.enable");
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 400));
  return result.result.value;
}
async function go(url) {
  await send("Page.navigate", { url });
  await evaluate(`new Promise((resolve) => { if (document.readyState === "complete") resolve(true); else addEventListener("load", () => resolve(true), { once: true }); })`);
}
async function shot(name) {
  const pic = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(path.join(outDir, name), Buffer.from(pic.data, "base64"));
}
const failures = [];
let passCount = 0;
function check(name, ok, detail) { if (ok) passCount++; else { failures.push({ name, detail: detail || "" }); console.log("FAIL", name, detail || ""); } }
const MARK = "stage2-marker@example.com";

await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
const before = net.length;
await go(origin + "/");
check("index loads", (await evaluate(`document.querySelector("#history_panel h2").textContent`)).includes("受付履歴"));
check("history controls stay hidden", (await evaluate(`document.getElementById("history_panel").hidden`)) === true);
check("history pending line is shown", (await evaluate(`document.getElementById("history_pending").innerText`)).includes("準備中"));
check("list link stays hidden", (await evaluate(`document.getElementById("list_link").hidden`)) === true);
check("name label is the approved wording", (await evaluate(`document.getElementById("dn_label").textContent`)).includes("メールに記載された名前"));
check("address label is the approved wording", (await evaluate(`document.getElementById("from_label").textContent`)).includes("メールに記載されたアドレス"));
check("consent starts off", (await evaluate(`document.getElementById("history_consent").checked`)) === false);
await shot("stage2_history_desktop.png");
const afterLoad = net.length;
await evaluate(`document.getElementById("from_email").value = ${JSON.stringify(MARK)}; document.getElementById("from_email").dispatchEvent(new Event("input"));`);
await evaluate(`document.getElementById("display_name").value = "<img src=\\"https://192.0.2.1/x.png\\">";`);
await evaluate(`document.getElementById("body").value = "本文と認証コード998877と https://example.com/secret";`);
const afterType = net.length;
await evaluate(`document.getElementById("history_query").click()`);
await evaluate(`new Promise((r) => setTimeout(r, 50))`);
const queryText = await evaluate(`document.getElementById("history_result").textContent`);
check("disabled query says unavailable and has no count", queryText.includes("現在履歴を取得できません") && !/\d+件/.test(queryText), queryText);
check("query did not add a network event", net.length === afterType);
await evaluate(`document.getElementById("history_submit").click()`);
const submitText = await evaluate(`document.getElementById("history_submit_result").textContent`);
check("submit without consent does not send", submitText.includes("同意がないので送信しません") && net.length === afterType, submitText);
await evaluate(`document.getElementById("history_consent").checked = true; document.getElementById("history_submit").click();`);
await evaluate(`new Promise((r) => setTimeout(r, 30))`);
check("submit with consent still does not send when no endpoint exists", net.length === afterType && (await evaluate(`document.getElementById("history_submit_result").textContent`)).includes("送信していません"));
check("malicious name did not create an image", (await evaluate(`document.images.length`)) === 0);
check("typed values stayed in the form", (await evaluate(`document.getElementById("from_email").value`)) === MARK);
const leaked = net.slice(before).filter((r) => (r.url + r.postData).includes(MARK) || (r.url + r.postData).includes("998877") || r.method === "POST");
check("no request carries the address, code, or a POST", leaked.length === 0, JSON.stringify(leaked));
check("loads are only local documents, css, and scripts", net.slice(before).every((r) => r.method === "GET" && r.url.startsWith(origin)));

await evaluate(`window.MH_STAGE2.adapter.query = function () { return new Promise((resolve) => setTimeout(() => resolve({ schema_version: "sender-history-draft-1", status: "available", measurement: "synthetic-only", productionReady: false, privacyVerified: false, acceptance_increment: 0, count_band: "合成帯-ONLY", period: { kind: "cumulative", label: "合成データ上の累計概数", start_date: "2026-01-01", as_of_jst: "2026-11-01T00:00:00+09:00" }, names: [{ text: "架空窓口（掲載用）" }] }), 250)); };`);
await evaluate(`document.getElementById("history_query").click(); document.getElementById("from_email").value = "other@example.net"; document.getElementById("from_email").dispatchEvent(new Event("input"));`);
await evaluate(`new Promise((r) => setTimeout(r, 400))`);
const late = await evaluate(`document.getElementById("history_result").innerText + document.body.innerText`);
check("a late synthetic response does not reappear", !late.includes("合成帯-ONLY"), late.slice(0, 180));

await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await go(origin + "/");
await shot("stage2_history_mobile.png");
await go(origin + "/list.html");
const listText = await evaluate(`document.body.innerText`);
const listHtml = await evaluate(`document.documentElement.outerHTML`);
check("list warning is visible and not collapsed", listText.includes("掲載は不審なアドレスであることを意味しません") && listText.includes("所有者の関与・悪質性を示しません") && !listHtml.includes("<details"));
check("list is unavailable and has no count", listText.includes("現在一覧を取得できません") && !/\d+件/.test(listText.replace("これは0件という意味ではありません。", "")));
check("list has no mail link", !listHtml.includes("mailto:"));
await shot("stage2_list_mobile.png");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await shot("stage2_list_desktop.png");
const listNet = net.filter((r) => r.url.includes("/list.html") || r.url.endsWith("/css/app.css"));
check("list navigation did not POST", listNet.every((r) => r.method === "GET"));

const report = {
  git_head: execSync("git rev-parse HEAD", { cwd: root }).toString().trim(),
  scope: "local Chrome only. production and preview are unaudited. stage2 disabled adapter.",
  checks: { pass: passCount, fail: failures.length, failures },
  network_events: net.length,
  asset_gets_after_index: afterLoad - before,
  note: "Asset GET requests for html, css, and js are separate from sending the typed address. This run is not tools/audit-evidence.json."
};
writeFileSync(path.join(outDir, "stage2_network_audit.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ git_head: report.git_head, pass: passCount, fail: failures.length, events: net.length, outDir }, null, 2));
ws.close(); chrome.kill("SIGTERM"); site.close();
process.exit(failures.length ? 1 : 0);
