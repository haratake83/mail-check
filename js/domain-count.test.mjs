// 判定回数の表示。node js/domain-count.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import handler from "../api/domain-count.mjs";

const require = createRequire(import.meta.url);
require("./protocol-data.js");
require("./judge.js");
require("./domain-age.js");
require("./domain-count.js");
const age = globalThis.MH_DOMAIN_AGE;
const count = globalThis.MH_DOMAIN_COUNT;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail ? " :: " + detail : ""));
  console.log("FAIL  " + name + (detail ? " :: " + detail : ""));
}

const full = { status: "ok", total: 12, day: 1, week: 3, month: 7, half_year: 10, year: 12 };
function withTotal(total) {
  return { status: "ok", total: total, day: 1, week: 1, month: 1, half_year: 1, year: total };
}

check("total 1 stays hidden", count.viewFor(withTotal(1)) === null);
check("total 4 stays hidden", count.viewFor(withTotal(4)) === null);
const five = count.viewFor(withTotal(5));
check("total 5 is shown", five && five.lines[0] === "1日：1回" && five.lines[4] === "1年：5回" && five.heading === "このドメインが判定された回数");
check("unavailable stays hidden", count.viewFor({ status: "unavailable" }) === null && count.viewFor(null) === null && count.viewFor({}) === null);
const shown = count.viewFor(full);
check("shown wording is the neutral count", shown && shown.lead === "このドメインは、このサイトでこれまでに判定されています。" && shown.lines.join(" / ") === "1日：1回 / 1週間：3回 / 1ヶ月：7回 / 半年：10回 / 1年：12回" && shown.note === "※判定された回数は、詐欺かどうかを示すものではありません。");
check("shown text does not judge the mail", shown && !/可能性が高い|不審|安全/.test(shown.heading + shown.lead + shown.lines.join("") + shown.note));
check("a broken count stays hidden", count.viewFor({ status: "ok", total: 5, day: 1, week: 1, month: 1, half_year: 1 }) === null && count.viewFor({ status: "ok", total: 5.5, day: 1, week: 1, month: 1, half_year: 1, year: 5 }) === null);

const agePlan = age.planLookup("Victim.User@shop.example.co.jp");
const plan = count.planCount("Victim.User@shop.example.co.jp");
check("plan uses the same domain as the date lookup", plan && agePlan && plan.url === "/api/domain-count" && plan.method === "POST" && plan.body.domain === agePlan.body.domain && JSON.stringify(plan.body) === JSON.stringify({ domain: "example.co.jp" }) && !JSON.stringify(plan).includes("@") && !JSON.stringify(plan).includes("Victim"));
check("no domain skips the count", count.planCount("") === null && count.planCount("09012345678") === null && count.planCount("victim@") === null);

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = function (url, opts) {
  calls.push({ url: url, method: opts && opts.method, body: opts && opts.body });
  return Promise.resolve({
    ok: true,
    type: "basic",
    json: async function () { return full; }
  });
};
const posted = await count.lookup(plan.body.domain);
check("lookup posts only the normalized domain", calls.length === 1 && calls[0].url === "/api/domain-count" && calls[0].method === "POST" && calls[0].body === "{\"domain\":\"example.co.jp\"}" && !calls[0].body.includes("@") && posted.status === "ok" && posted.total === 12);
calls.length = 0;
const refused = await count.lookup("victim@example.com");
check("lookup does not send an email address", calls.length === 0 && refused.status === "unavailable" && count.viewFor(refused) === null);

globalThis.fetch = function () { return Promise.reject(new Error("network")); };
const errored = await count.lookup("example.com");
check("a network error stays hidden", errored.status === "unavailable" && count.viewFor(errored) === null);

globalThis.fetch = function () {
  return Promise.resolve({ ok: false, type: "basic", json: async function () { return full; } });
};
const badStatus = await count.lookup("example.com");
check("a failed response stays hidden", badStatus.status === "unavailable" && count.viewFor(badStatus) === null);

let aborted = false;
globalThis.fetch = function (url, opts) {
  return new Promise(function (resolve, reject) {
    const signal = opts && opts.signal;
    if (signal) {
      signal.addEventListener("abort", function () {
        aborted = true;
        reject(new Error("aborted"));
      });
    }
  });
};
const timed = await count.lookup("example.com", undefined, 30);
check("a timeout stays hidden", timed.status === "unavailable" && count.viewFor(timed) === null && aborted === true && count.TIMEOUT_MS === 5000);
globalThis.fetch = originalFetch;

function mockRes() {
  const headers = {};
  return {
    headers: headers,
    statusCode: 0,
    body: "",
    setHeader: function (name, value) { headers[name] = value; },
    end: function (body) { this.body = body; }
  };
}
const res = mockRes();
await handler({ method: "POST", body: { domain: "example.com", email: "a@example.com" } }, res);
check("vercel handler stores nothing and is unavailable", res.statusCode === 200 && res.body === "{\"status\":\"unavailable\"}" && !res.body.includes("example.com") && !res.body.includes("@"));
const apiSrc = fs.readFileSync(path.join(root, "api/domain-count.mjs"), "utf8");
check("vercel handler source does not store or log", !/console\.(log|info|warn|error)\(/.test(apiSrc) && !apiSrc.includes("writeFile") && !apiSrc.includes("new Map") && !apiSrc.includes("createMemory") && apiSrc.includes('status: "unavailable"'));

const ui = fs.readFileSync(path.join(root, "js/ui.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const privacy = fs.readFileSync(path.join(root, "privacy.html"), "utf8");
const css = fs.readFileSync(path.join(root, "css/app.css"), "utf8");
const sentence = "判定したあと、差出人アドレスの登録ドメイン（@より後ろの、登録の単位とみなすドメイン）と、判定した日時を、そのドメインが何回判定されたかを数えるためにサーバへ記録します。メールアドレスそのもの、本文、URLは送らず、保存もしません。";
check("privacy wording is on the form and the privacy page", html.includes('id="privacy_count"') && privacy.includes('id="privacy_count"') && html.includes(sentence) && privacy.includes(sentence) && html.indexOf('id="privacy_count"') < html.indexOf('id="check"'));
check("the context question is gone", !html.includes("心当たりはありますか") && !html.includes('name="context_answer"') && !ui.includes("context_answer"));
check("count script loads and runs after the judgment", html.includes('src="js/domain-count.js"') && ui.indexOf("render(r)") < ui.indexOf("MH_DOMAIN_COUNT.attach") && ui.indexOf("MH_DOMAIN_AGE.attach") < ui.indexOf("MH_DOMAIN_COUNT.attach"));
const countCss = css.slice(css.indexOf(".domain-count-note {"), css.indexOf(".domain-count-list"));
check("count note uses the sky box and a navy heading", countCss.includes("background: #E6F4FB") && countCss.includes("border: 1px solid #5BA4C9") && countCss.includes("font-weight: 400") && countCss.includes("font-size: 0.85rem") && css.includes(".domain-count-note h3") && /domain-count-note h3\s*\{[^}]*color:\s*#224C9E/.test(css) && !countCss.includes("#F6EDE3") && !countCss.includes("#F8E7C1"));
const judgeSrc = fs.readFileSync(path.join(root, "js/judge.js"), "utf8");
check("judgment no longer depends on the context answer", !judgeSrc.includes("context_answer") && !judgeSrc.includes("context_invalid") && !judgeSrc.includes("心当たり"));

console.log("\n" + pass + " passed, " + fail + " failed.");
if (fail) {
  console.log(failures.join("\n"));
  process.exit(1);
}
