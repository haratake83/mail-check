// 取得日の注意。node js/domain-age.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import {
  normalizeDomain,
  hostsFromBootstrap,
  registrationMs,
  lookupRegistration,
  isSameOrigin,
  createHandler,
  loadAllowHosts,
  resetBootstrapCache
} from "../api/domain-created.mjs";

const require = createRequire(import.meta.url);
require("./protocol-data.js");
require("./judge.js");
require("./domain-age.js");
const judge = globalThis.MH_judge;
const age = globalThis.MH_DOMAIN_AGE;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail ? " :: " + detail : ""));
  console.log("FAIL  " + name + (detail ? " :: " + detail : ""));
}

const NOW = Date.parse("2026-11-13T00:00:00Z");
function isoDaysAgo(n) { return new Date(NOW - n * 86400000).toISOString(); }

function rdap(eventDate, extra) {
  return JSON.stringify(Object.assign({
    events: [{ eventAction: "registration", eventDate: eventDate }],
    entities: [{ roles: ["registrant"], vcardArray: ["vcard", [["email", {}, "text", "secret-registrant@example.net"]]], handle: "SECRET-HANDLE" }]
  }, extra || {}));
}

function routes(ageDays) {
  const calls = [];
  const request = async function (url) {
    calls.push(url);
    if (url.startsWith("https://rdap.org/")) {
      return { status: 302, location: "https://rdap.example.test/domain/example.com", body: "" };
    }
    if (url.startsWith("https://rdap.example.test/")) {
      return { status: 200, location: "", body: rdap(isoDaysAgo(ageDays)) };
    }
    throw new Error("unexpected " + url);
  };
  return { request: request, calls: calls, allowHosts: new Set(["rdap.org", "rdap.example.test"]) };
}

const banned = ["このメールは詐欺です", "可能性が高い", "不審", "信頼性が低い"];

for (const days of [29, 30]) {
  const hop = routes(days);
  const got = await lookupRegistration("example.com", { request: hop.request, now: function () { return NOW; }, allowHosts: hop.allowHosts });
  const text = age.cautionText(got);
  check(days + " days returns a caution", got.age_days === days && text.includes("30日以内") && text.includes("しっかりと確認が必要です。※詐欺と確定したことにはなりません。") && text.includes("大手の組織や公的機関が"), text);
  check(days + " days names the public date", text.includes(days === 30 ? "2026年10月14日" : "2026年10月15日"), text);
  check(days + " days stays the yellow note", age.notePresentation(got).className === "domain-age-note");
  banned.forEach(function (word) { check(days + " days avoids 「" + word + "」", !text.includes(word)); });
  check(days + " days does not return registrant data", Object.keys(got).sort().join(",") === "age_days,created" && !JSON.stringify(got).includes("secret-registrant") && !JSON.stringify(got).includes("@"), JSON.stringify(got));
}

function jaDate(iso) {
  const parts = iso.split("-").map(Number);
  return parts[0] + "年" + parts[1] + "月" + parts[2] + "日";
}
const band2Tail = "大手の組織や公的機関の公式な案内かどうかは、取得日だけでは分かりません。公式の案内と照合するなど、判断の材料にしてください。この期間であることだけを理由に、詐欺と確定したことにはなりません。";
const band3Tail = "取得から一定の期間が経過しています。ただし、時間が経っていることと、正規の案内であることは同じではありません。なりすましや、正規のドメインに見せかける手口もあるため、文面と送信元を確認してください。この期間であることだけを理由に、安全と確認できたことにはなりません。";

const older = routes(31);
const got31 = await lookupRegistration("example.com", { request: older.request, now: function () { return NOW; }, allowHosts: older.allowHosts });
const text31 = age.cautionText(got31);
const view31 = age.notePresentation(got31);
check("31 days is the milder under-a-year note", got31.age_days === 31 && text31 === "送信元ドメインの取得は、公開情報によると" + jaDate(got31.created) + "です（取得から31日以上、1年未満）。" + band2Tail && !text31.includes("30日以内") && view31.className === "domain-age-note domain-age-mild", text31);

const yearish = routes(364);
const got364 = await lookupRegistration("example.com", { request: yearish.request, now: function () { return NOW; }, allowHosts: yearish.allowHosts });
const text364 = age.cautionText(got364);
check("364 days stays in the under-a-year note", got364.age_days === 364 && text364 === "送信元ドメインの取得は、公開情報によると" + jaDate(got364.created) + "です（取得から31日以上、1年未満）。" + band2Tail && !text364.includes("取得から1年以上"), text364);

const fullYear = routes(365);
const got365 = await lookupRegistration("example.com", { request: fullYear.request, now: function () { return NOW; }, allowHosts: fullYear.allowHosts });
const text365 = age.cautionText(got365);
const view365 = age.notePresentation(got365);
check("365 days is the one-year note", got365.age_days === 365 && text365 === "送信元ドメインの取得は、公開情報によると" + jaDate(got365.created) + "です（取得から1年以上）。" + band3Tail && view365.className === "domain-age-note domain-age-mild" && !text365.includes("安全です") && text365.endsWith("安全と確認できたことにはなりません。"), text365);
check("notes do not say 低リスク or 高リスク", ![text31, text364, text365, age.cautionText({ created: "2026-10-14", age_days: 30 })].some(function (t) { return t.includes("低リスク") || t.includes("高リスク") || t.includes("なりぶ"); }));

const missing = await lookupRegistration("example.com", {
  request: async function () { return { status: 200, location: "", body: JSON.stringify({ events: [{ eventAction: "last changed", eventDate: isoDaysAgo(1) }] }) }; },
  now: function () { return NOW; },
  allowHosts: new Set(["rdap.org"])
});
check("unparsed date is unavailable", missing.status === "unavailable" && age.cautionText(missing) === "");

const benign = judge({ display_name: "山田太郎", subject: "重要", from_email: "notice@example.com", body: "山田様、本日の連絡です。", context_answer: "unknown", channel: "email" });
const before = JSON.stringify(benign);
check("unavailable leaves the judgment intact", age.cautionText({ status: "unavailable" }) === "" && benign.display.headline.length > 0 && benign.verdict === "no_clear_signal" && JSON.stringify(benign) === before);
const strong = judge({ from_email: "notice@example.com", body: "ギフトカードの番号を送ってください。", context_answer: "unknown", channel: "email" });
const strongBefore = JSON.stringify(strong);
const strongCaution = age.cautionText({ created: "2026-10-14", age_days: 30 });
check("caution does not change the verdict", strong.verdict === "strong_suspicion" && strong.danger_level === "S" && JSON.stringify(strong) === strongBefore && strongCaution.includes("30日以内") && !JSON.stringify(strong).includes("30日以内"));

const plan = age.planLookup("Victim.User@shop.example.co.jp");
check("plan sends only the registrable domain", plan && plan.url === "/api/domain-created" && plan.method === "POST" && JSON.stringify(plan.body) === JSON.stringify({ domain: "example.co.jp" }) && !JSON.stringify(plan).includes("@") && !JSON.stringify(plan).includes("Victim") && !JSON.stringify(plan).includes("shop.example"));
check("subdomain of com is reduced", JSON.stringify(age.planLookup("notice@mail.example.com").body) === JSON.stringify({ domain: "example.com" }));
check("no from domain skips the lookup", age.planLookup("") === null && age.planLookup("09012345678") === null && age.planLookup("山田") === null);
check("display name is not a lookup input", age.planLookup.length === 1);

const originalFetch = globalThis.fetch;
let fetchCalls = [];
globalThis.fetch = function (url, opts) {
  fetchCalls.push({ url: url, method: opts && opts.method, body: opts && opts.body });
  return Promise.resolve({
    ok: true,
    type: "basic",
    json: async function () { return { created: "2026-10-15", age_days: 29, email: "secret-registrant@example.net", registrant: "秘密太郎" }; }
  });
};
const refused = await age.lookup("victim@example.com");
check("lookup does not send a full email", fetchCalls.length === 0 && refused.status === "unavailable");
const posted = await age.lookup(plan.body.domain);
check("lookup posts the domain only", fetchCalls.length === 1 && fetchCalls[0].url === "/api/domain-created" && fetchCalls[0].method === "POST" && fetchCalls[0].body === "{\"domain\":\"example.co.jp\"}" && !fetchCalls[0].body.includes("@") && !fetchCalls[0].body.includes("Victim"));
check("lookup drops fields other than the date and age", posted.created === "2026-10-15" && posted.age_days === 29 && !("email" in posted) && !("registrant" in posted) && age.cautionText(posted).includes("2026年10月15日"));
globalThis.fetch = originalFetch;

check("age without a date does not invent one", age.cautionText({ age_days: 30 }).includes("公開情報によると30日以内です。") && !age.cautionText({ age_days: 30 }).includes("年"));
check("band 2 without a date does not invent one", age.cautionText({ age_days: 31 }) === "送信元ドメインの取得は、公開情報によると取得から31日以上、1年未満です。" + band2Tail && age.cautionText({ age_days: 364 }) === age.cautionText({ age_days: 31 }));
check("band 3 without a date does not invent one", age.cautionText({ age_days: 365 }) === "送信元ドメインの取得は、公開情報によると取得から1年以上です。" + band3Tail && !/\d{4}年/.test(age.cautionText({ age_days: 365 })));
check("a date alone is not a caution", age.cautionText({ created: "2026-10-14" }) === "");
check("future age is not a caution", age.cautionText({ created: "2026-12-01", age_days: -1 }) === "");

check("normalize rejects an email", normalizeDomain("victim@example.com") === null && normalizeDomain("example.com/path") === null && normalizeDomain("https://example.com") === null);
check("normalize accepts a bare domain", normalizeDomain("Example.COM.") === "example.com");

const evilCalls = [];
const evil = await lookupRegistration("example.com", {
  request: async function (url) {
    evilCalls.push(url);
    if (url.indexOf("evil.example") >= 0) throw new Error("followed");
    return { status: 302, location: "https://evil.example/domain/example.com", body: rdap(isoDaysAgo(1)) };
  },
  now: function () { return NOW; },
  allowHosts: new Set(["rdap.org", "rdap.example.test"])
});
check("disallowed redirect is not followed", evil.status === "unavailable" && evilCalls.length === 1 && evilCalls[0].indexOf("https://rdap.org/domain/example.com") === 0);

const httpHop = await lookupRegistration("example.com", {
  request: async function () { return { status: 302, location: "http://rdap.example.test/domain/example.com", body: "" }; },
  now: function () { return NOW; },
  allowHosts: new Set(["rdap.org", "rdap.example.test"])
});
check("http redirect is unavailable", httpHop.status === "unavailable");

const boot = hostsFromBootstrap(JSON.stringify({
  services: [
    [["com"], ["https://rdap.example.test/v1/", "http://insecure.example/v1/"]],
    [["jp"], ["https://user:pw@rdap.example.test/jp"]]
  ]
}));
check("bootstrap keeps https hosts only", boot.has("rdap.org") && boot.has("rdap.example.test") && !boot.has("insecure.example") && !boot.has("user"));
check("registration event ignores last changed", registrationMs({ events: [{ eventAction: "last changed", eventDate: isoDaysAgo(1) }, { eventAction: "registration", eventDate: isoDaysAgo(30) }] }) === NOW - 30 * 86400000);

function mockRes() {
  return {
    statusCode: 0,
    payload: null,
    headers: {},
    setHeader: function (k, v) { this.headers[k.toLowerCase()] = v; },
    status: function (n) { this.statusCode = n; return this; },
    json: function (o) { this.payload = o; }
  };
}
function sameOriginReq(body, extra) {
  return {
    method: "POST",
    headers: Object.assign({
      host: "mail.example",
      origin: "https://mail.example",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json"
    }, extra || {}),
    body: body
  };
}

const seen = [];
const handler = createHandler({
  limitPerIp: 2,
  globalPerMinute: 10,
  now: function () { return NOW; },
  allowHosts: function () { return new Set(["rdap.org", "rdap.example.test"]); },
  request: async function (url) {
    seen.push(url);
    if (String(url).indexOf("@") >= 0 || String(url).indexOf("victim") >= 0) throw new Error("leaked");
    if (url.startsWith("https://rdap.org/")) return { status: 302, location: "https://rdap.example.test/domain/example.com", body: "" };
    return { status: 200, location: "", body: rdap(isoDaysAgo(29)) };
  }
});

const emailed = mockRes();
await handler(sameOriginReq({ domain: "victim@example.com", display_name: "山田", subject: "件名", body: "本文 https://evil.example/secret" }), emailed);
check("handler does not look up an email", emailed.statusCode === 400 && emailed.payload.status === "unavailable" && seen.length === 0 && !JSON.stringify(emailed.payload).includes("victim") && !JSON.stringify(emailed.payload).includes("山田"));

const cross = mockRes();
await handler(sameOriginReq({ domain: "example.com" }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }), cross);
check("cross origin is refused", cross.statusCode === 403 && seen.length === 0);

const get = mockRes();
await handler({ method: "GET", headers: { host: "mail.example", origin: "https://mail.example" }, body: { domain: "example.com" } }, get);
check("GET is refused", get.statusCode === 405 && seen.length === 0);

const ok = mockRes();
await handler(sameOriginReq({ domain: "Example.COM" }), ok);
check("handler returns only the date and age", ok.statusCode === 200 && JSON.stringify(ok.payload) === JSON.stringify({ created: "2026-10-15", age_days: 29 }) && seen.every(function (u) { return u.indexOf("@") < 0 && u.indexOf("victim") < 0; }));
check("same origin check matches host", isSameOrigin({ host: "mail.example", origin: "https://mail.example", "sec-fetch-site": "same-origin" }) === true && isSameOrigin({ host: "mail.example", origin: "https://evil.example" }) === false);

const again = mockRes();
await handler(sameOriginReq({ domain: "example.com" }), again);
const limited = mockRes();
await handler(sameOriginReq({ domain: "example.com" }), limited);
check("rate limit stops further lookups", again.statusCode === 429 && limited.statusCode === 429 && limited.payload.status === "unavailable" && seen.length === 2);

const logs = [];
const methods = ["log", "info", "warn", "error"];
const saved = {};
methods.forEach(function (name) {
  saved[name] = console[name];
  console[name] = function () { logs.push(Array.prototype.join.call(arguments, " ")); };
});
const quiet = mockRes();
await handler(sameOriginReq({ domain: "example.com" }), quiet);
methods.forEach(function (name) { console[name] = saved[name]; });
check("handler does not log the domain", logs.every(function (line) { return !line.includes("example.com") && !line.includes("@"); }));

resetBootstrapCache();
const bootCalls = [];
const hosts = await loadAllowHosts(async function (url) {
  bootCalls.push(url);
  if (url !== "https://data.iana.org/rdap/dns.json") throw new Error("wrong bootstrap");
  return { status: 302, location: "https://evil.example/dns.json", body: "" };
}, function () { return NOW; });
check("bootstrap redirect is not followed", bootCalls.length === 1 && hosts.has("rdap.org") && !hosts.has("evil.example"));

const ui = fs.readFileSync(path.join(root, "js/ui.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "css/app.css"), "utf8");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const csp = vercel.headers[0].headers.find(function (h) { return h.key === "Content-Security-Policy"; }).value;
const attachLine = ui.split("\n").filter(function (line) { return line.includes("MH_DOMAIN_AGE.attach"); })[0] || "";
check("page loads the domain age script", html.includes('src="js/domain-age.js"'));
check("attach runs after render and receives only the from field", ui.indexOf("render(r)") < ui.indexOf("MH_DOMAIN_AGE.attach") && attachLine.includes('from_email') && !attachLine.includes("display_name") && !attachLine.includes("subject") && !attachLine.includes(".body"));
check("ui does not fetch by itself", !ui.includes("fetch(") && !ui.includes("rdap.org"));
check("caution uses the yellow 1px note", css.includes(".domain-age-note") && css.includes("border: 1px solid var(--warn-line)") && !/\.domain-age-note\s*\{[^}]*border-width:\s*2px/.test(css));
check("older bands use the beige 1px note", css.includes(".domain-age-note.domain-age-mild") && css.includes("background: var(--beige)") && css.includes("border: 1px solid var(--beige-line)") && !/\.domain-age-mild\s*\{[^}]*border-width:\s*2px/.test(css));
check("csp keeps form-action none and connect-src self", csp.includes("form-action 'none'") && csp.includes("connect-src 'self'") && !csp.includes("connect-src 'none'") && !csp.includes("rdap.org"));
check("privacy names the domain lookup and not collection", html.includes("登録ドメイン") && html.includes("取得日が分からないことは、危険とも安全とも扱いません") && html.includes("ドメインは現在どこにも集めていません") && html.includes("表示 v0.10.4") && html.includes("判定プロトコル v0.10"));
check("protocol version is unchanged", fs.readFileSync(path.join(root, "js/protocol-data.js"), "utf8").includes('version: "v0.10"'));

const apiSrc = fs.readFileSync(path.join(root, "api/domain-created.mjs"), "utf8");
check("api does not follow redirects automatically", !apiSrc.includes("FOLLOWLOCATION") && !apiSrc.includes("redirect: \"follow\"") && !apiSrc.includes("redirect: 'follow'"));
check("api source does not log the domain", !/console\.(log|info|warn|error)\(/.test(apiSrc));

console.log("\n" + pass + " passed, " + fail + " failed.");
if (fail) {
  console.log(failures.join("\n"));
  process.exit(1);
}
