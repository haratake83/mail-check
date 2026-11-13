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
import weeklyHandler from "../api/weekly-rank.mjs";
import { spawn, execSync } from "child_process";
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
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".png": "image/png", ".woff2": "font/woff2" };

let domainAgeReply = { status: "unavailable" };
const site = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/weekly-rank") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = null;
    if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
    await weeklyHandler({ method: req.method, headers: req.headers, body }, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/domain-created") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    void Buffer.concat(chunks);
    res.writeHead(200, { ...staticHeaders, "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(domainAgeReply));
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
  await evaluate(`document.fonts.ready`);
  return net.slice(before);
}
async function setFields(input) {
  await evaluate(`(() => {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set("display_name", ${JSON.stringify(input.display_name || "")});
    set("subject", ${JSON.stringify(input.subject || "")});
    set("from_email", ${JSON.stringify(input.from_email || "")});
    set("body", ${JSON.stringify(input.body || "")});
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
    const bs = getComputedStyle(box);
    return {
      className: box.className,
      headline: head ? head.textContent : "",
      lead: lead ? lead.textContent : "",
      text: box.innerText,
      color: hs ? hs.color : "",
      borderColor: bs.borderTopColor,
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
async function shot(name, beyond) {
  const pic = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: beyond !== false });
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
await shot("front-desktop.png");
const look = await evaluate(`(() => {
  const wm = document.querySelector(".site-wordmark");
  const logo = wm && wm.querySelector("img");
  const btn = document.getElementById("check");
  const intro = document.querySelector(".intro-block");
  const warn = document.getElementById("subject_warn");
  const nameHint = document.getElementById("dn_hint");
  const bodyNotes = document.querySelector(".body-notes");
  const foot = document.querySelector("footer");
  const ws = getComputedStyle(wm);
  const bs = getComputedStyle(btn);
  const ns = getComputedStyle(nameHint);
  const ys = getComputedStyle(warn);
  const fontLoaded = document.fonts.check('900 40px "Zen Kaku Gothic New"', '詐欺') && document.fonts.check('500 40px "Zen Kaku Gothic New"', '.com');
  return {
    title: document.title,
    og: document.querySelector('meta[property="og:title"]').content,
    word: logo ? logo.alt : "",
    logoSrc: logo ? logo.getAttribute("src") : "",
    logoW: logo ? logo.naturalWidth : 0,
    logoH: logo ? logo.naturalHeight : 0,
    ink: ws.color,
    frame: ws.borderTopColor,
    frameWidth: ws.borderTopWidth,
    fill: ws.backgroundColor,
    btnBg: bs.backgroundColor,
    btnColor: bs.color,
    btnBorder: bs.borderTopColor,
    btnBorderWidth: bs.borderTopWidth,
    introBg: getComputedStyle(intro).backgroundColor,
    warnBg: ys.backgroundColor,
    warnBorder: ys.borderTopWidth,
    nameBg: ns.backgroundColor,
    bodyBg: getComputedStyle(bodyNotes).backgroundColor,
    footBg: getComputedStyle(foot).backgroundColor,
    footBorder: getComputedStyle(foot).borderTopColor,
    footBorderWidth: getComputedStyle(foot).borderTopWidth,
    discBg: getComputedStyle(document.querySelector("footer .body-notes")).backgroundColor,
    discBorder: getComputedStyle(document.querySelector("footer .body-notes")).borderTopWidth,
    fontLoaded
  };
})()`);
check("header logo is 詐欺メールチェック.com inside the page", look.word === "詐欺メールチェック.com" && look.logoSrc === "img/sagi-mail-check-logo.png" && look.logoW === 1552 && look.logoH === 369 && look.title.startsWith("詐欺メール判定.com") && look.og === "詐欺メール判定.com", JSON.stringify(look));
check("header logo has no green frame", look.frameWidth === "0px" && /0,\s*0,\s*0,\s*0/.test(look.fill), JSON.stringify(look));
check("judge button is white on navy with a 2px logo-green frame", /34,\s*76,\s*158/.test(look.btnBg) && /255,\s*255,\s*255/.test(look.btnColor) && /46,\s*172,\s*111/.test(look.btnBorder) && look.btnBorderWidth === "2px", JSON.stringify(look));
check("explanations are white with a navy frame and cautions are sky blue", /255,\s*255,\s*255/.test(look.introBg) && /230,\s*244,\s*251/.test(look.warnBg) && look.warnBorder === "1px" && look.nameBg === look.warnBg && look.bodyBg === look.warnBg, JSON.stringify(look));
check("footer has no navy frame and the disclaimer uses the sky hint box", look.footBorderWidth === "0px" && /230,\s*244,\s*251/.test(look.discBg) && look.discBg === look.bodyBg && look.discBorder === "1px", JSON.stringify(look));
await setViewport(390, 844, true);
await shot("front-mobile.png");
await setViewport(1280, 900, false);

await setFields(fixture.clickfix);
await judge();
const clickView = await resultView();
check("clickfix lead is before the grey verdict", clickView.lead.includes("先に読んでください") && clickView.text.indexOf("先に読んでください") < clickView.text.indexOf("判断できませんでした"), clickView.lead);
check("clickfix does not say no features were found", !clickView.text.includes("検出できた特徴はありませんでした"));
check("clickfix verdict class stays grey", clickView.className.includes("v-grey"));
check("clickfix result has no anchors to pasted urls", clickView.anchors.every(function (h) { return h === "terms.html" || h.indexOf("guides/") === 0; }));
await shot("stage1_clickfix_lead.png");

await evaluate(`document.getElementById("clear").click()`);
const cleared = await evaluate(`(() => ({
  body: document.getElementById("body").value,
  from: document.getElementById("from_email").value,
  name: document.getElementById("display_name").value,
  subject: document.getElementById("subject").value,
  linkField: document.getElementById("visible_link_url"),
  result: document.getElementById("result").innerText
}))()`);
check("clear empties fields and result", cleared.body === "" && cleared.from === "" && cleared.name === "" && cleared.subject === "" && cleared.linkField === null && cleared.result === "", JSON.stringify(cleared));

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

async function judged() {
  const view = await resultView();
  const json = await evaluate(`JSON.stringify(window.MH_judge({
    display_name: document.getElementById("display_name").value,
    from_email: document.getElementById("from_email").value,
    body: document.getElementById("body").value,
    context_answer: (document.querySelector('input[name="context_answer"]:checked') || {}).value || "",
    channel: (document.querySelector('input[name="channel"]:checked') || {}).value || "email"
  }))`);
  const formBody = await evaluate(`document.getElementById("body").value`);
  return { view, json, formBody };
}
function absent(hay, secret) { return hay.indexOf(secret) < 0; }

await go(origin + "/");
await setFields(fixture.span_secrets);
await judge();
const spanCase = await judged();
check("form keeps the typed auth codes", spanCase.formBody.includes("482913") && spanCase.formBody.includes("Ab9xQ2") && spanCase.formBody.includes("AbCd12"));
["482913", "Ab9xQ2", "AbCd12"].forEach((secret) => {
  check("screen hides " + secret, absent(spanCase.view.text, secret));
  check("result JSON hides " + secret, absent(spanCase.json, secret));
});
check("span case still names the host", spanCase.view.text.includes("example.com") && spanCase.json.includes("example.com"));

await go(origin + "/");
await setFields(fixture.glued_exec_url);
await judge();
const glued = await judged();
check("glued url path is absent from screen and JSON", absent(glued.view.text, "AbCd12") && absent(glued.json, "AbCd12"));
check("glued exec lead is on screen and in JSON", glued.view.text.includes("先に読んでください") && glued.view.text.includes("アプリやコマンド等の実行を促す") && glued.json.includes("先に読んでください") && glued.json.includes("アプリやコマンド等の実行を促す"));
check("glued exec lead is before the grey headline", glued.view.text.indexOf("先に読んでください") < glued.view.text.indexOf("判断できませんでした"));

await go(origin + "/");
await setFields(fixture.zip_view);
await judge();
const zipView = await judged();
check("ordinary zip view has no execution lead", !zipView.view.lead && absent(zipView.view.text, "先に読んでください") && absent(zipView.view.text, "アプリやコマンド等の実行を促す") && absent(zipView.json, "malware_or_execution"));
check("ordinary zip view is not called password-protected", absent(zipView.view.text, "パスワード付き") && absent(zipView.json, "パスワード付き"));

await go(origin + "/");
await setFields(fixture.zip_exec);
await judge();
const zipExec = await judged();
check("zip execute lead is on screen and in JSON", zipExec.view.text.includes("先に読んでください") && zipExec.json.includes("アプリやコマンド等の実行を促す") && zipExec.json.includes("display"));
check("zip execute without the password word is not described as password-protected", absent(zipExec.view.text, "パスワード付き") && absent(zipExec.json, "パスワード付き"));

await go(origin + "/");
await setFields(fixture.zip_password);
await judge();
const zipPw = await judged();
check("password zip lead matches the evidence", zipPw.view.text.includes("先に読んでください") && zipPw.view.text.includes("パスワード付き") && zipPw.view.text.includes("断定したものではありません") && zipPw.json.includes("パスワード付き") && zipPw.json.includes("断定したものではありません"));

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
    colors[(mobile ? "mobile_" : "desktop_") + name] = { color: view.color, borderColor: view.borderColor, className: view.className, banner: view.banner, headline: view.headline };
    check(name + (mobile ? " mobile" : " desktop") + " tone class", view.className.includes("v-" + input.tone), view.className + " " + view.color);
    if (name === "no_clear_signal") check("no_clear has the safety banner", view.banner === true);
    if (name === "insufficient") check("insufficient has no safety banner", view.banner === false);
    if (!mobile || name === "strong_suspicion" || name === "no_clear_signal") await shot("verdict_" + name + (mobile ? "_mobile" : "_desktop") + ".png");
    await evaluate(`document.getElementById("clear").click()`);
  }
}
check("strong frame is red, review frame is amber, and headlines stay black", /176,\s*0,\s*0/.test(colors.desktop_strong_suspicion.borderColor) && /138,\s*82,\s*0/.test(colors.desktop_needs_review.borderColor) && /17,\s*17,\s*17/.test(colors.desktop_strong_suspicion.color) && /17,\s*17,\s*17/.test(colors.desktop_needs_review.color), JSON.stringify(colors.desktop_strong_suspicion) + " " + JSON.stringify(colors.desktop_needs_review));
check("no_clear headline is black and the frame is grey", /17,\s*17,\s*17/.test(colors.desktop_no_clear_signal.color) && /85,\s*85,\s*85/.test(colors.desktop_no_clear_signal.borderColor), JSON.stringify(colors.desktop_no_clear_signal));

await setViewport(1280, 900, false);
await go(origin + "/");
await setFields({ from_email: "notice@example.com", body: "山田様、本日の連絡です。", context_answer: "unknown" });
await judge();
await evaluate(`new Promise((r) => setTimeout(r, 400))`);
const unavailableAge = await evaluate(`(() => ({ note: !!document.querySelector(".domain-age-note"), head: (document.querySelector(".verdict-head") || {}).textContent || "" }))()`);
check("unavailable registration date adds no caution", unavailableAge.note === false && unavailableAge.head.includes("判断できませんでした"), JSON.stringify(unavailableAge));

async function showAge(ageDays) {
  const created = new Date(Date.now() - ageDays * 86400000).toISOString().slice(0, 10);
  const [cy, cm, cd] = created.split("-").map(Number);
  const createdJa = cy + "年" + cm + "月" + cd + "日";
  domainAgeReply = { created, age_days: ageDays };
  await setViewport(1280, 900, false);
  await go(origin + "/");
  const before = net.length;
  await setFields({
    display_name: "山田太郎",
    subject: "重要なお知らせ",
    from_email: "yamada.taro@example.com",
    body: "山田様、本日の連絡です。https://example.com/secret-path",
    context_answer: "unknown"
  });
  await judge();
  const shown = await evaluate(`new Promise((resolve) => {
    const t = setInterval(() => {
      const note = document.querySelector("#result .domain-age-note");
      if (note) { clearInterval(t); resolve(true); }
    }, 20);
    setTimeout(() => { clearInterval(t); resolve(false); }, 3000);
  })`);
  const view = await resultView();
  const detail = await evaluate(`(() => {
    const note = document.querySelector(".domain-age-note");
    const cs = note ? getComputedStyle(note) : null;
    return {
      text: note ? note.textContent : "",
      mild: note ? note.classList.contains("domain-age-mild") : false,
      bg: cs ? cs.backgroundColor : "",
      border: cs ? cs.borderTopWidth : ""
    };
  })()`);
  const posts = net.slice(before).filter((r) => r.method === "POST");
  return { createdJa, shown, view, detail, posts };
}
const band1 = await showAge(30);
check("30-day caution is visible and is not a scam verdict", band1.shown === true && band1.detail.mild === false && /248,\s*231,\s*193/.test(band1.detail.bg) && band1.detail.border === "1px" && band1.detail.text.includes(band1.createdJa) && band1.detail.text.includes("30日以内") && band1.detail.text.includes("しっかりと確認が必要です。※詐欺と確定したことにはなりません。") && !band1.detail.text.includes("このメールは詐欺です") && !band1.detail.text.includes("可能性が高い") && !band1.detail.text.includes("不審") && !band1.detail.text.includes("信頼性が低い") && band1.view.className.includes("v-grey") && band1.view.headline.includes("判断できませんでした"), band1.detail.text.slice(0, 180) + " / " + band1.detail.bg);
check("the lookup post is only the registrable domain", band1.posts.length === 2 && band1.posts.every((r) => {
  const path = new URL(r.url).pathname;
  const data = JSON.parse(r.postData || "");
  const keys = Object.keys(data);
  return (path === "/api/domain-created" || path === "/api/weekly-rank") && keys.length === 1 && data.domain === "example.com" && !r.postData.includes("@") && !r.postData.includes("yamada") && !r.postData.includes("山田") && !r.postData.includes("重要") && !r.postData.includes("secret-path");
}), JSON.stringify(band1.posts));
await evaluate(`document.querySelector(".domain-age-note").scrollIntoView({ block: "center" })`);
await shot("domain-age-band1-desktop.png", false);
await setViewport(390, 844, true);
await evaluate(`document.querySelector(".domain-age-note").scrollIntoView({ block: "center" })`);
await shot("domain-age-band1-mobile.png", false);

const band2 = await showAge(31);
check("31-day note is the milder under-a-year text", band2.shown === true && band2.detail.mild === true && /246,\s*237,\s*227/.test(band2.detail.bg) && band2.detail.border === "1px" && band2.detail.text.includes(band2.createdJa) && band2.detail.text.includes("取得から31日以上、1年未満") && band2.detail.text.endsWith("詐欺と確定したことにはなりません。") && !band2.detail.text.includes("30日以内") && !band2.detail.text.includes("低リスク") && !band2.detail.text.includes("高リスク") && band2.view.className.includes("v-grey"), band2.detail.text.slice(0, 200) + " / " + band2.detail.bg);
await evaluate(`document.querySelector(".domain-age-note").scrollIntoView({ block: "center" })`);
await shot("domain-age-band2-desktop.png", false);
await setViewport(390, 844, true);
await evaluate(`document.querySelector(".domain-age-note").scrollIntoView({ block: "center" })`);
await shot("domain-age-band2-mobile.png", false);

const band3 = await showAge(365);
check("365-day note does not call the domain safe", band3.shown === true && band3.detail.mild === true && /246,\s*237,\s*227/.test(band3.detail.bg) && band3.detail.border === "1px" && band3.detail.text.includes(band3.createdJa) && band3.detail.text.includes("取得から1年以上") && band3.detail.text.endsWith("安全と確認できたことにはなりません。") && !band3.detail.text.includes("低リスク") && !band3.detail.text.includes("高リスク") && band3.view.className.includes("v-grey"), band3.detail.text.slice(0, 200) + " / " + band3.detail.bg);
await setViewport(1280, 900, false);
await evaluate(`document.querySelector(".domain-age-note").scrollIntoView({ block: "center" })`);
await shot("domain-age-band3-desktop.png", false);
await setViewport(390, 844, true);
await evaluate(`document.querySelector(".domain-age-note").scrollIntoView({ block: "center" })`);
await shot("domain-age-band3-mobile.png", false);
await setViewport(1280, 900, false);

const secrets = fixture.secrets;
const leaked = net.filter((r) => secrets.some((s) => (r.url + "\n" + r.postData).includes(s)));
check("no network event contains a fixture secret", leaked.length === 0, JSON.stringify(leaked).slice(0, 500));
const posts = net.filter((r) => r.method === "POST");
function domainPostOnly(r) {
  try {
    const u = new URL(r.url);
    if (u.pathname !== "/api/domain-created" && u.pathname !== "/api/weekly-rank") return false;
    const data = JSON.parse(r.postData || "");
    const keys = Object.keys(data);
    const allowed = { domain: 1, genre: 1, content: 1 };
    return keys.length >= 1 && keys.every((key) => allowed[key]) && data.domain === "example.com" && !String(r.postData).includes("@");
  } catch (e) { return false; }
}
check("POSTs are only the registrable domain", posts.length > 0 && posts.every(domainPostOnly), JSON.stringify(posts.map((r) => ({ url: r.url, postData: r.postData }))).slice(0, 800));
function hostOf(url) { try { return new URL(url).host; } catch (e) { return ""; } }
const foreign = net.filter((r) => {
  if (!r.url || /^(data|blob|about|chrome|chrome-extension):/.test(r.url)) return false;
  return hostOf(r.url) !== "127.0.0.1:" + sitePort;
});
check("network hosts stay on the local audit server", foreign.length === 0, JSON.stringify(foreign.map((r) => r.url)).slice(0, 500));
const typesSeen = {};
net.forEach((r) => { typesSeen[r.type || r.when || "unknown"] = (typesSeen[r.type || r.when || "unknown"] || 0) + 1; });

const sourceFiles = ["js/judge.js", "js/ui.js", "js/domain-age.js", "js/weekly-rank.js", "js/protocol-data.js", "index.html"];
const sourceIndicators = [];
const indicatorRe = /fetch\s*\(|new\s+Image\s*\(|import\s*\(|sendBeacon\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB/g;
for (const rel of sourceFiles) {
  const text = readFileSync(path.join(root, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const hits = text.match(indicatorRe) || [];
  if (hits.length) sourceIndicators.push({ file: rel, hits });
}
const ageSrc = readFileSync(path.join(root, "js/domain-age.js"), "utf8");
const weekSrc = readFileSync(path.join(root, "js/weekly-rank.js"), "utf8");
check("browser network calls stay on the two same-origin endpoints", sourceIndicators.length === 2 && sourceIndicators.every((s) => s.hits.length === 1 && s.hits[0] === "fetch(") && ageSrc.includes('fetch(ENDPOINT') && ageSrc.includes('"/api/domain-created"') && weekSrc.includes('fetch(ENDPOINT') && weekSrc.includes('"/api/weekly-rank"') && !weekSrc.includes("rdap.org"), JSON.stringify(sourceIndicators));

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
  git_head: execSync("git rev-parse HEAD", { cwd: root }).toString().trim(),
  note: "合格は、このローカル実行で、登録ドメイン以外の入力が通信に乗らなかった、という意味です。配信環境へは広げません。"
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
