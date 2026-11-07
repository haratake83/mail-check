#!/usr/bin/env node
// ローカルブラウザ監査。本番・プレビューの配信ログは見ていない。
// 静的な「POSTが無い」検査だけでは非送信の証明にしない。Network の全イベントを記録する。
//
// 再実行（Node 22 以降と Google Chrome）:
//   node tools/browser-audit.mjs
// 出力先を変えるとき:
//   node tools/browser-audit.mjs --out /tmp/mail-check-audit
//
// 依存パッケージは不要です。Chrome の DevTools プロトコルを使います。
import { spawn } from "child_process";
import { createServer } from "http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, createReadStream } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outDir = args.includes("--out") ? args[args.indexOf("--out") + 1] : (existsSync("/opt/cursor/artifacts") ? "/opt/cursor/artifacts" : path.join(root, "tools", "audit-output"));
mkdirSync(outDir, { recursive: true });
const fixture = JSON.parse(readFileSync(path.join(root, "tools", "fixtures", "synthetic.json"), "utf8"));
const chromeBin = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find((p) => p && existsSync(p));
if (!chromeBin) {
  console.error("Google Chrome が見つかりません。CHROME_PATH を指定してください。");
  process.exit(2);
}

const vercel = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
const headerList = (vercel.headers && vercel.headers[0] && vercel.headers[0].headers) || [];
const staticHeaders = Object.fromEntries(headerList.map((h) => [h.key, h.value]));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".png": "image/png" };

const site = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, staticHeaders);
    res.end("not found");
    return;
  }
  res.writeHead(200, { ...staticHeaders, "Cache-Control": "no-store", "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
const sitePort = site.address().port;
const origin = `http://127.0.0.1:${sitePort}`;

const profile = path.join("/tmp", "mail-check-chrome-" + process.pid);
const chromePort = 9300 + (process.pid % 500);
const chrome = spawn(chromeBin, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
  "--disable-background-networking", "--disable-sync", "--disable-extensions",
  "--no-first-run", "--no-default-browser-check", "--metrics-recording-only",
  "--remote-debugging-port=" + chromePort, "--user-data-dir=" + profile, "about:blank"
], { stdio: ["ignore", "pipe", "pipe"] });
let chromeLog = "";
chrome.stderr.on("data", (b) => { chromeLog += b.toString(); });
chrome.stdout.on("data", (b) => { chromeLog += b.toString(); });

async function waitJson(url, tries) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch (e) { /* chrome still starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Chrome の DevTools に接続できません。\n" + chromeLog.slice(-2000));
}
const targets = await waitJson(`http://127.0.0.1:${chromePort}/json/list`, 50);
const pageTarget = targets.find((t) => t.type === "page");
if (!pageTarget) throw new Error("page target がありません");
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
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(methodName(msg) + " " + JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  } else if (msg.method === "Network.requestWillBeSent") {
    net.push({
      url: msg.params.request.url,
      method: msg.params.request.method,
      type: msg.params.type,
      postData: msg.params.request.postData || "",
      when: "requestWillBeSent"
    });
  } else if (msg.method === "Network.loadingFailed") {
    net.push({
      url: msg.params.url || "",
      method: "",
      type: msg.params.type || "",
      postData: "",
      when: "loadingFailed",
      error: msg.params.errorText || ""
    });
  }
});
function methodName() { return ""; }

await send("Network.enable");
await send("Page.enable");
await send("Runtime.enable");

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 500));
  return result.result.value;
}
async function go(url) {
  const before = net.length;
  await send("Page.navigate", { url });
  await evaluate(`new Promise((resolve) => { if (document.readyState === "complete") resolve(true); else addEventListener("load", () => resolve(true), { once: true }); })`);
  return net.slice(before);
}
async function setFields(input) {
  await evaluate(`(() => {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set("display_name", ${JSON.stringify(input.display_name || "")});
    set("from_email", ${JSON.stringify(input.from_email || "")});
    set("body", ${JSON.stringify(input.body || "")});
    set("visible_link_url", ${JSON.stringify(input.visible_link_url || "")});
    const ctxValue = ${JSON.stringify(input.context_answer || "unknown")};
    const ctx = document.querySelector('input[name="context_answer"][value="' + ctxValue + '"]');
    if (ctx) ctx.checked = true;
    return true;
  })()`);
}
async function judge() {
  await evaluate(`(() => { document.getElementById("check").click(); return true; })()`);
  await evaluate(`new Promise((resolve) => { const t = setInterval(() => { if (document.querySelector("#result.show, #result .verdict-head")) { clearInterval(t); resolve(true); } }, 20); })`);
}
async function resultView() {
  return evaluate(`(() => {
    const box = document.getElementById("result");
    const head = box.querySelector(".verdict-head");
    const lead = box.querySelector(".lead-alert h2");
    const hs = head ? getComputedStyle(head) : null;
    return {
      className: box.className,
      headline: head ? head.textContent : "",
      lead: lead ? lead.textContent : "",
      text: box.innerText,
      color: hs ? hs.color : "",
      banner: !!box.querySelector(".safety-banner"),
      anchors: [...box.querySelectorAll("a")].map((a) => a.getAttribute("href")),
      images: document.images.length,
      forms: [...document.forms].map((f) => ({ action: f.getAttribute("action"), method: (f.getAttribute("method") || "get").toLowerCase() })),
      title: document.title
    };
  })()`);
}
async function storageDump() {
  return evaluate(`(async () => {
    const idb = indexedDB.databases ? await indexedDB.databases() : [];
    const cachesKeys = ("caches" in window) ? await caches.keys() : [];
    const regs = ("serviceWorker" in navigator) ? await navigator.serviceWorker.getRegistrations() : [];
    const entries = await performance.getEntriesByType("resource");
    return {
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage },
      cookie: document.cookie,
      indexedDB: idb.map((d) => d.name),
      caches: cachesKeys,
      serviceWorkers: regs.map((r) => r.scope),
      resourceEntries: entries.map((e) => e.name),
      href: location.href
    };
  })()`);
}
async function shot(name) {
  const pic = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(path.join(outDir, name), Buffer.from(pic.data, "base64"));
}
async function setViewport(width, height, mobile) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: !!mobile });
}

const failures = [];
let passCount = 0;
function check(name, ok, detail) {
  if (ok) passCount++;
  else failures.push({ name, detail: detail || "" });
}
async function historyBack() {
  await evaluate(`history.back()`);
  await evaluate(`new Promise((resolve) => {
    const done = () => resolve(true);
    if (document.getElementById("body")) setTimeout(done, 50);
    else addEventListener("pageshow", () => setTimeout(done, 50), { once: true });
    setTimeout(done, 1200);
  })`);
}

await go(origin + "/");
await setViewport(1280, 900, false);

await setFields(fixture.clickfix);
await judge();
const clickView = await resultView();
check("clickfix lead is before the grey verdict", clickView.lead.includes("先に読んでください") && clickView.text.indexOf("先に読んでください") < clickView.text.indexOf("判断できませんでした"), clickView.lead);
check("clickfix does not say no features were found", !clickView.text.includes("検出できた特徴はありませんでした"));
check("clickfix verdict class stays grey", clickView.className.includes("v-grey"));
check("clickfix result has no anchors", clickView.anchors.length === 0);
await shot("stage1_clickfix_lead.png");

await evaluate(`document.getElementById("clear").click()`);
const cleared = await evaluate(`(() => ({
  body: document.getElementById("body").value,
  from: document.getElementById("from_email").value,
  name: document.getElementById("display_name").value,
  link: document.getElementById("visible_link_url").value,
  result: document.getElementById("result").innerText
}))()`);
check("clear empties fields and result", cleared.body === "" && cleared.from === "" && cleared.name === "" && cleared.link === "" && cleared.result === "", JSON.stringify(cleared));

await setFields({ from_email: "notice@example.com", body: "履歴確認 ROUND2CLEARMARK", context_answer: "unknown" });
await judge();
await evaluate(`document.getElementById("clear").click()`);
await go(origin + "/tools/audit-blank.html");
await historyBack();
const afterBack = await evaluate(`(() => ({
  href: location.href,
  body: (document.getElementById("body") || {}).value || "",
  result: (document.getElementById("result") || {}).innerText || ""
}))()`);
const backRestored = afterBack.body.includes("ROUND2CLEARMARK") || afterBack.result.includes("ROUND2CLEARMARK");
check("back returned to the checker", (afterBack.href || "").startsWith(origin) && !(afterBack.href || "").includes("audit-blank"), JSON.stringify(afterBack));
check("after clear, leaving and pressing back does not show the marker", !backRestored, JSON.stringify(afterBack));

await go(origin + "/");
await setFields(fixture.path_tokens);
await judge();
const pathText = (await resultView()).text;
fixture.secrets.filter((s) => s !== "ROUND2CLEARMARK").forEach((secret) => {
  check("result text hides " + secret, !pathText.includes(secret));
});
check("result still shows the host", pathText.includes("実ホスト: example.com"));

await go(origin + "/");
const netAtXss = net.length;
await setFields(fixture.xss);
await judge();
const xss = await resultView();
check("xss title unchanged", !xss.title.includes("xss"), xss.title);
check("xss created no images", xss.images === 0, String(xss.images));
check("pasted form was not parsed into the document", xss.forms.length === 1, JSON.stringify(xss.forms));
check("javascript payload is redacted", xss.text.includes("javascript:＊＊＊") && !xss.text.includes("alert(1)"));
const xssNet = net.slice(netAtXss);
check("xss did not request 192.0.2.1 or example.com", !xssNet.some((r) => /192\.0\.2\.1|example\.com/.test(r.url)));

const storage = await storageDump();
check("storage values are empty", Object.keys(storage.localStorage).length === 0 && Object.keys(storage.sessionStorage).length === 0 && storage.cookie === "" && storage.indexedDB.length === 0 && storage.caches.length === 0 && storage.serviceWorkers.length === 0, JSON.stringify(storage));

const colors = {};
for (const mobile of [false, true]) {
  await setViewport(mobile ? 390 : 1280, mobile ? 844 : 900, mobile);
  await go(origin + "/");
  for (const [name, input] of Object.entries(fixture.verdicts)) {
    await setFields(input);
    await judge();
    const view = await resultView();
    colors[(mobile ? "mobile_" : "desktop_") + name] = { color: view.color, className: view.className, banner: view.banner, headline: view.headline };
    check(name + (mobile ? " mobile" : " desktop") + " tone class", view.className.includes("v-" + input.tone), view.className + " " + view.color);
    if (name === "no_clear_signal") check("no_clear has the safety banner", view.banner === true);
    if (name === "insufficient") check("insufficient has no safety banner", view.banner === false);
    if (!mobile || name === "strong_suspicion" || name === "no_clear_signal") await shot("verdict_" + name + (mobile ? "_mobile" : "_desktop") + ".png");
    await evaluate(`document.getElementById("clear").click()`);
  }
}
check("strong is red and review is not the same color", colors.desktop_strong_suspicion.color !== colors.desktop_needs_review.color && /176,\s*0,\s*0|178,\s*0,\s*0|b00000/i.test(colors.desktop_strong_suspicion.color), JSON.stringify(colors.desktop_strong_suspicion));
check("no_clear headline is grey", /51,\s*51,\s*51/.test(colors.desktop_no_clear_signal.color), colors.desktop_no_clear_signal.color);

const secrets = fixture.secrets;
const leaked = net.filter((r) => secrets.some((s) => (r.url + "\n" + r.postData).includes(s)));
check("no network event contains a fixture secret", leaked.length === 0, JSON.stringify(leaked).slice(0, 500));
const posts = net.filter((r) => r.method === "POST");
check("no POST was observed", posts.length === 0, JSON.stringify(posts).slice(0, 500));
function hostOf(url) { try { return new URL(url).host; } catch (e) { return ""; } }
const foreign = net.filter((r) => {
  if (!r.url || /^(data|blob|about|chrome|chrome-extension):/.test(r.url)) return false;
  return hostOf(r.url) !== "127.0.0.1:" + sitePort;
});
check("network hosts stay on the local audit server", foreign.length === 0, JSON.stringify(foreign.map((r) => r.url)).slice(0, 500));
const typesSeen = {};
net.forEach((r) => { typesSeen[r.type || r.when || "unknown"] = (typesSeen[r.type || r.when || "unknown"] || 0) + 1; });

const sourceFiles = ["js/judge.js", "js/ui.js", "js/protocol-data.js", "index.html"];
const sourceIndicators = [];
const indicatorRe = /fetch\s*\(|new\s+Image\s*\(|import\s*\(|sendBeacon\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB/g;
for (const rel of sourceFiles) {
  const text = readFileSync(path.join(root, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const hits = text.match(indicatorRe) || [];
  if (hits.length) sourceIndicators.push({ file: rel, hits });
}

const report = {
  measured_at_jst: new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("Z", "+09:00"),
  scope: "local Chrome only. production and preview hosting are unaudited.",
  limits: {
    production_and_preview: "unaudited",
    delivery_access_logs: "not measured. Page-load connection records at a hosting provider are separate from whether this page sends the typed mail text.",
    static_source_scan_is_not_proof: true,
    browser_back_forward_cache: backRestored ? "after clear, back navigation restored the marker text in this browser" : "after clear, away, and back, the marker was not in the field or result in this run",
    extensions_and_physical_memory: "not tested",
    autocomplete_undo_stack: "not fully observable from the page. The on-page text says back, reload, autofill, and undo may keep text."
  },
  checks: { pass: passCount, fail: failures.length, failures },
  colors,
  back_after_clear: afterBack,
  back_restored_marker: backRestored,
  storage,
  network: {
    event_count: net.length,
    types: typesSeen,
    hosts: [...new Set(net.map((r) => hostOf(r.url) || r.url.split(":")[0]))],
    methods: [...new Set(net.map((r) => r.method).filter(Boolean))],
    events: net.map((r) => ({ url: r.url, method: r.method, type: r.type, when: r.when, error: r.error || "" }))
  },
  source_indicators: sourceIndicators,
  note: "合格は、このローカル実行で観測したネットワークイベントに入力が含まれなかった、という意味です。配信環境へは広げません。"
};
writeFileSync(path.join(outDir, "stage1_network_audit.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  outDir,
  pass: passCount,
  failures: failures.length,
  failure_names: failures.map((f) => f.name),
  network_events: net.length,
  types: typesSeen,
  hosts: report.network.hosts,
  storage_local_keys: Object.keys(storage.localStorage),
  back_restored_marker: backRestored,
  source_indicators: sourceIndicators
}, null, 2));
ws.close();
chrome.kill("SIGTERM");
site.close();
process.exit(failures.length ? 1 : 0);
