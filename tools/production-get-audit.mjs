#!/usr/bin/env node
// 本番 https://mail-check-amber.vercel.app を GET で開き、入力した文字が通信に乗らないことを見る。
// デプロイはしない。node tools/production-get-audit.mjs
import { spawn } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";

const origin = "https://mail-check-amber.vercel.app";
const marker = "v091-marker-7f3c9a";
const outDir = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/mail-check-production";
mkdirSync(outDir, { recursive: true });
const chromeBin = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find((p) => existsSync(p));
if (!chromeBin) { console.error("Chrome がありません"); process.exit(2); }
const chromePort = 9700 + (process.pid % 200);
const chrome = spawn(chromeBin, ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking", "--disable-extensions", "--remote-debugging-port=" + chromePort, "--user-data-dir=" + path.join("/tmp", "mail-check-prod-" + process.pid), "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
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
  } else if (msg.method === "Network.requestWillBeSent") {
    const q = msg.params.request;
    net.push({ url: q.url, method: q.method, postData: q.postData || "" });
  }
});
await send("Network.enable"); await send("Page.enable"); await send("Runtime.enable");
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 500));
  return result.result.value;
}
await send("Page.navigate", { url: origin + "/" });
await evaluate(`new Promise((resolve) => { if (document.readyState === "complete") resolve(true); else addEventListener("load", () => resolve(true), { once: true }); })`);
const before = net.length;
await evaluate(`document.getElementById("display_name").value = ${JSON.stringify(marker)}; document.getElementById("from_email").value = "notice@example.com"; document.getElementById("body").value = ${JSON.stringify("本文 " + marker + " https://example.com/" + marker)}; document.getElementById("check").click();`);
await evaluate(`new Promise((resolve) => { const t = setInterval(() => { if (document.querySelector("#result.show")) { clearInterval(t); resolve(true); } }, 20); })`);
await evaluate(`new Promise((r) => setTimeout(r, 400))`);
const leaked = net.filter((r) => (r.url + "\n" + r.postData).includes(marker));
const methods = [...new Set(net.map((r) => r.method))];
const hosts = [...new Set(net.map((r) => { try { return new URL(r.url).host; } catch (e) { return r.url; } }))];
const report = {
  origin,
  marker_in_any_request: leaked.length > 0,
  leaked,
  methods,
  hosts,
  request_count: net.length,
  requests_after_typing: net.length - before,
  only_get: net.every((r) => r.method === "GET"),
  requests: net.map((r) => ({ method: r.method, url: r.url.split("?")[0] }))
};
writeFileSync(path.join(outDir, "production-get-audit.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ marker_in_any_request: report.marker_in_any_request, only_get: report.only_get, methods, hosts, request_count: report.request_count, requests_after_typing: report.requests_after_typing }, null, 2));
ws.close(); chrome.kill("SIGTERM");
process.exit(report.marker_in_any_request || !report.only_get ? 1 : 0);
