#!/usr/bin/env node
// 注意度と利用規約のローカル監査。GET のみ。本番・プレビューは見ない。
// node tools/stage3-browser-audit.mjs
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
const headerList = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8")).headers[0].headers;
const staticHeaders = Object.fromEntries(headerList.map((h) => [h.key, h.value]));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
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
const origin = "http://127.0.0.1:" + site.address().port;
const chromePort = 9600 + (process.pid % 300);
const chrome = spawn(chromeBin, ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking", "--disable-extensions", "--remote-debugging-port=" + chromePort, "--user-data-dir=" + path.join("/tmp", "mail-check-stage3-" + process.pid), "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
let chromeLog = "";
chrome.stderr.on("data", (b) => { chromeLog += b.toString(); });
async function waitJson(url) {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(chromeLog.slice(-400));
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
  } else if (msg.method === "Network.requestWillBeSent") net.push({ url: msg.params.request.url, method: msg.params.request.method });
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
async function shot(name, beyond) {
  const pic = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: beyond !== false });
  writeFileSync(path.join(outDir, name), Buffer.from(pic.data, "base64"));
}
async function judge(body) {
  await evaluate(`document.getElementById("from_email").value = "notice@example.com"; document.getElementById("body").value = ${JSON.stringify(body)}; document.getElementById("check").click();`);
  await evaluate(`new Promise((resolve) => { const t = setInterval(() => { if (document.querySelector("#result.show")) { clearInterval(t); resolve(true); } }, 20); })`);
}
const failures = [];
let passCount = 0;
function check(name, ok, detail) { if (ok) passCount++; else { failures.push({ name, detail: detail || "" }); console.log("FAIL", name, detail || ""); } }

await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await go(origin + "/");
check("history ui is hidden on the form", (await evaluate(`document.getElementById("history_panel").hidden && document.getElementById("history_pending").innerText.includes("準備中") && document.getElementById("list_link").hidden`)) === true);
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await evaluate(`document.getElementById("body_privacy").scrollIntoView({ block: "center" })`);
await shot("v091_body_note_mobile.png", false);
await evaluate(`document.getElementById("terms_agree").scrollIntoView({ block: "center" })`);
await shot("v092_consent_mobile.png", false);
await evaluate(`document.getElementById("privacy_detail").scrollIntoView({ block: "end" })`);
await shot("v092_privacy_plan_mobile.png", false);
check("plain privacy text is on the form", (await evaluate(`document.getElementById("privacy_detail").innerText`)).includes("本文やURLが当サイトに送られたり、保存されたりすることはありません") && (await evaluate(`document.getElementById("privacy_plan").innerText`)).includes("現在は集めていません") && (await evaluate(`document.getElementById("terms_agree").innerText`)).includes("利用規約に同意したものとみなします"));
check("separate link field is absent", (await evaluate(`document.getElementById("visible_link_url") === null && document.body.innerText.includes("本文に含まれるリンクだけを文字列として調べ、開きません")`)) === true);
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await shot("stage3_form_hidden_desktop.png");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await shot("stage3_form_hidden_mobile.png");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await judge("ギフトカードの番号を送ってください。");
let text = await evaluate(`document.getElementById("result").innerText`);
let open = await evaluate(`document.querySelector(".attention-break").open`);
const more = await evaluate(`document.querySelector(".attention-expl-more").textContent`);
check("percent result shows 80 and the short non-probability sentence", text.includes("注意度（目安・確率ではありません）") && text.includes("80%") && text.includes("注意度の数値は、詐欺の確率でも安全の度合いでもありません。") && text.includes("詐欺メールの疑いが強いです") && !text.includes("確からしさの目安"), text.slice(0, 240));
check("longer explanation stays in the collapsed details", open === false && more.includes("詐欺である確率・的中率・安全の度合いではありません"));
check("version label is visible", text.includes("attention-scale-2026-11-09-a") && text.includes("判定プロトコル版：0.9.3"));
await shot("stage3_percent_desktop.png");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await shot("stage3_percent_mobile.png");

await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await go(origin + "/");
await judge("山田様、本日の連絡です。");
text = await evaluate(`document.getElementById("result").innerText`);
check("grey result shows a dash and the safety banner", text.includes("注意度（目安・確率ではありません）") && text.includes("—") && !text.includes("0%") && !text.includes("100%") && text.includes("安全ではありません") && text.includes("数値が無いことは安全を意味しません"), text.slice(0, 280));
await shot("stage3_dash_desktop.png");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await shot("stage3_dash_mobile.png");

await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await go(origin + "/");
await evaluate(`document.getElementById("from_email").value = ""; document.getElementById("body").value = "ギフトカードの番号を送ってください。"; document.getElementById("check").click();`);
await evaluate(`new Promise((resolve) => { const t = setInterval(() => { if (document.querySelector("#result.show")) { clearInterval(t); resolve(true); } }, 20); })`);
text = await evaluate(`document.getElementById("result").innerText`);
check("missing from stays insufficient and leads with the caution", text.includes("入力が足りませんが、注意すべき特徴があります") && text.includes("情報が足りず判定できません") && text.includes("—"), text.slice(0, 280));
await shot("stage3_gap_desktop.png");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await shot("stage3_gap_mobile.png");

await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await go(origin + "/terms.html");
text = await evaluate(`document.body.innerText`);
check("terms page is marked as an unreviewed draft", text.includes("弁護士の確認前の下書き") && text.includes("未定") && !text.includes("名称候補") && !text.includes("0円とする実質的全部免責"));
check("terms page does not state a total disclaimer", !text.includes("一切の損害について責任を負いません"));
await shot("stage3_terms_desktop.png");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await shot("stage3_terms_mobile.png");

check("only GET", net.every((r) => r.method === "GET"));
check("only local host", net.every((r) => { try { return new URL(r.url).host === new URL(origin).host; } catch (e) { return false; } }));
const report = {
  git_head: execSync("git rev-parse HEAD", { cwd: root }).toString().trim(),
  scope: "local Chrome GET only. production and preview were not opened.",
  checks: { pass: passCount, fail: failures.length, failures },
  network_events: net.length,
  methods: [...new Set(net.map((r) => r.method))]
};
writeFileSync(path.join(outDir, "stage3_network_audit.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ git_head: report.git_head, pass: passCount, fail: failures.length, events: net.length, outDir }, null, 2));
ws.close(); chrome.kill("SIGTERM"); site.close();
process.exit(failures.length ? 1 : 0);
