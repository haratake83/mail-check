#!/usr/bin/env node
// 週間ランキングの画面確認。本番の初期データにはしない。
import { spawn } from "child_process";
import { createServer } from "http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, createReadStream } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createMemoryWeeklyStore, createWeeklyHandler } from "../api/weekly-rank.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = "/opt/cursor/artifacts";
mkdirSync(outDir, { recursive: true });
const chromeBin = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find((p) => existsSync(p));
if (!chromeBin) { console.error("Chrome がありません"); process.exit(2); }

const now = Date.now();
const filled = createMemoryWeeklyStore();
const domains = ["alpha.example", "bravo.example", "charlie.example", "delta.example", "echo.example", "foxtrot.example", "golf.example", "hotel.example", "india.example", "juliet.example"];
for (let i = 0; i < domains.length; i++) {
  for (let n = 0; n < 20 - i; n++) await filled.add([{ kind: "domain", key: domains[i], at: now }], now);
}
for (let n = 0; n < 9; n++) await filled.add([{ kind: "domain", key: "hidden.example", at: now }], now);
for (const [index, key] of ["delivery", "bank", "ec", "carrier", "gov", "other"].entries()) {
  for (let n = 0; n < 16 - index; n++) await filled.add([{ kind: "genre", key, at: now }], now);
}
for (const [index, key] of ["undelivered", "lock", "unpaid", "prize"].entries()) {
  for (let n = 0; n < 14 - index; n++) await filled.add([{ kind: "content", key, at: now }], now);
}
const empty = createMemoryWeeklyStore();
let active = filled;
const weekly = createWeeklyHandler({
  store: { add: (items, at) => active.add(items, at), read: (at) => active.read(at) },
  now: () => Date.now(),
  limitPerIp: 1000,
  globalPerMinute: 1000
});

const vercel = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
const staticHeaders = Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value]));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".woff2": "font/woff2" };
const site = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/api/weekly-rank") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = null;
    if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
    await weekly({ method: req.method, headers: req.headers, body }, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/domain-created") {
    for await (const chunk of req) void chunk;
    res.writeHead(200, { ...staticHeaders, "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "unavailable" }));
    return;
  }
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
const origin = "http://127.0.0.1:" + site.address().port;
const chrome = spawn(chromeBin, ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking", "--disable-extensions", "--remote-debugging-port=9411", "--user-data-dir=/tmp/mail-check-rank-shot", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
let chromeLog = "";
chrome.stderr.on("data", (b) => { chromeLog += b.toString(); });
async function waitJson(url) {
  for (let i = 0; i < 50; i++) {
    try { const res = await fetch(url); if (res.ok) return await res.json(); } catch (e) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(chromeLog.slice(-400));
}
const page = (await waitJson("http://127.0.0.1:9411/json/list")).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
const pending = new Map();
let seq = 0;
function send(method, params) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params: params || {} }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (!msg.id || !pending.has(msg.id)) return;
  const p = pending.get(msg.id);
  pending.delete(msg.id);
  if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
  else p.resolve(msg.result);
});
await send("Network.enable");
await send("Page.enable");
await send("Runtime.enable");
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 400));
  return result.result.value;
}
async function go() {
  await send("Page.navigate", { url: origin + "/" });
  await evaluate(`new Promise((resolve) => { if (document.readyState === "complete") resolve(true); else addEventListener("load", () => resolve(true), { once: true }); })`);
  await evaluate(`document.fonts.ready`);
  await evaluate(`new Promise((resolve) => {
    const t = setInterval(() => {
      const text = (document.getElementById("rank_domains") || {}).innerText || "";
      if (text.includes("1位") || text.includes("まだありません")) { clearInterval(t); resolve(true); }
    }, 20);
    setTimeout(() => { clearInterval(t); resolve(false); }, 3000);
  })`);
}
async function shot(name, width, height, scroll) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  if (scroll) await evaluate(scroll);
  const pic = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(path.join(outDir, name), Buffer.from(pic.data, "base64"));
}

await go();
const filledText = await evaluate(`document.getElementById("rank_domains").innerText`);
if (!filledText.includes("1位") || !filledText.includes("10位") || filledText.includes("hidden.example")) {
  console.error("filled ranking missing", filledText.slice(0, 300));
  process.exit(1);
}
await shot("weekly_rank_filled_desktop.png", 1280, 1900, `document.getElementById("weekly_rankings").scrollIntoView({ block: "start" })`);
await shot("weekly_rank_filled_mobile.png", 390, 2600, `document.getElementById("weekly_rankings").scrollIntoView({ block: "start" })`);

active = empty;
await go();
const emptyText = await evaluate(`document.getElementById("weekly_rankings").innerText`);
if (!emptyText.includes("今週、10回以上判定された項目はまだありません。") || emptyText.includes("1位")) {
  console.error("empty ranking wrong", emptyText.slice(0, 300));
  process.exit(1);
}
await shot("weekly_rank_empty_desktop.png", 1280, 1100, `document.getElementById("weekly_rankings").scrollIntoView({ block: "start" })`);
await shot("weekly_rank_empty_mobile.png", 390, 1200, `document.getElementById("weekly_rankings").scrollIntoView({ block: "start" })`);
await shot("weekly_rank_order_desktop.png", 1280, 1700, `document.getElementById("check").scrollIntoView({ block: "start" })`);
await shot("weekly_rank_order_mobile.png", 390, 1800, `document.getElementById("check").scrollIntoView({ block: "start" })`);

await evaluate(`(() => {
  document.getElementById("display_name").value = "山田太郎";
  document.getElementById("subject").value = "重要なお知らせ";
  document.getElementById("from_email").value = "yamada.taro@example.com";
  document.getElementById("body").value = "山田様、本日の連絡です。";
  document.getElementById("check").click();
  return true;
})()`);
await evaluate(`new Promise((resolve) => { const t = setInterval(() => { if (document.querySelector("#result.show .verdict-head")) { clearInterval(t); resolve(true); } }, 20); })`);
await shot("weekly_rank_after_judge_desktop.png", 1280, 1400, `window.scrollTo(0, Math.max(0, document.querySelector("footer").getBoundingClientRect().top + window.scrollY - 520))`);
await shot("weekly_rank_after_judge_mobile.png", 390, 1400, `window.scrollTo(0, Math.max(0, document.querySelector("footer").getBoundingClientRect().top + window.scrollY - 420))`);
const order = await evaluate(`(() => {
  const result = document.getElementById("result");
  const foot = document.querySelector("footer");
  const note = document.querySelector(".weekly-rank-note");
  return { resultBeforeFooter: result.compareDocumentPosition(foot) === Node.DOCUMENT_POSITION_FOLLOWING, hasVerdict: !!result.querySelector(".verdict-head"), note: note.textContent };
})()`);
console.log(JSON.stringify({ origin, filled: filledText.includes("10位"), empty: emptyText.includes("まだありません"), order }));
ws.close();
chrome.kill("SIGTERM");
site.close();
process.exit(order.resultBeforeFooter && order.hasVerdict ? 0 : 1);
