// 公式送信元と除外ドメイン。node js/official-senders.test.mjs
// passes が true のときだけ、手口の一文を出さない。真偽の表示は変えない。
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
require("./protocol-data.js");
require("./official-senders.js");
require("./judge.js");
require("./domain-exclusions.js");
const passes = globalThis.MH_OFFICIAL_SENDERS.passes;
const excluded = globalThis.MH_DOMAIN_EXCLUSIONS.isExcludedDomain;
const judge = globalThis.MH_judge;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail ? " :: " + detail : ""));
  console.log("FAIL  " + name + (detail ? " :: " + detail : ""));
}

const cases = [
  ["info@e-tax.nta.go.jp", "nta", true],
  ["x@e-tax.nta.go.jp", "nta", false],
  ["a@mail.vpass.ne.jp", "smbc_card", true],
  ["admin@eposcard.co.jp", "epos", false],
  ["a@01epos.jp", "epos", true],
  ["shopping-order-master@mail.yahoo.co.jp", "yahoo_shopping", true],
  ["taro@yahoo.co.jp", "yahoo_shopping", false],
  ["info@wdy.docomo.ne.jp", "docomo", true],
  ["taro@docomo.ne.jp", "docomo", false],
  ["no-reply@accounts.google.com", "google", false],
  ["forms-receipts-noreply@google.com", "google", false],
  ["a@dpoint.jp", "dpoint", false],
  ["a@jp.nomura.com", "nomura", false],
  ["a@nomura.com", "nomura", true],
  ["noreply@trendmicro.com", "trendmicro", false],
  ["info@trendmicro.com", "trendmicro", true],
  ["no-reply@coin.z.com", "gmo_coin", true],
  ["a@evil.z.com", "gmo_coin", false],
  ["noreply-mizuhobank@resv.jp", "mizuho", true],
  ["other@resv.jp", "mizuho", false],
  ["a@rakuten.co.jp", "rakuten_card", true],
  ["a@rakuten.co.jp", "amazon", false],
  ["a@police.pref.osaka.lg.jp", "police", false],
  ["a@pref.osaka.lg.jp", "pref", true]
];
check("spec has 24 sender cases", cases.length === 24);
cases.forEach(function (row) {
  const got = passes(row[0], row[1]);
  check(row[0] + " as " + row[1] + (row[2] ? " passes" : " does not pass"), got === row[2], "got " + got);
});

check("normalized address still matches the listed mailbox", passes(" Info@E-Tax.NTA.go.jp. ", "nta") === true);
check("a longer old domain does not fall back to the parent", passes("a@jp.nomura.com", "nomura") === false && passes("a@nomura.com", "nomura") === true);
check("an unmatched subdomain does not use the parent host rule", passes("foo@yahoo.co.jp", "yahoo_shopping") === false && passes("a@x.accounts.google.com", "google") === false);
check("google.com and a child stay closed", passes("a@mail.google.com", "google") === false && passes("a@www.google.com", "youtube") === false);
check("a missing brand does not pass", passes("info@nta.go.jp", "") === false && passes("info@nta.go.jp", "not-a-brand") === false);
check("a single-label host is not a sender match", passes("info@localhost", "nta") === false);

["amazon.co.jp", "mail.amazon.co.jp", "google.com", "city.sapporo.jp", "pref.osaka.jp", "nta.go.jp", "01epos.jp"].forEach(function (host) {
  check(host + " is excluded", excluded(host) === true);
});
["amazonaws.com", "s3.amazonaws.com", "dpoint.jp", "resv.jp", "evil.zendesk.com", "taotao-ex.com", "cuenote.jp", "dkim.cuenote.jp", "z.com", "zendesk.com", "bitbankcc.zendesk.com", "discoursemail.com", "adobe-campaign.com", "email-ssl.com", "cleverbridge.com", "zuberance.com", "ifeelgoods.com", "trustpilot.com", "club-off.com", "onetrust.com", "creditview.co.uk", "cacs.jp", "dnp-cdms.jp"].forEach(function (host) {
  check(host + " is not excluded", excluded(host) === false);
});

const PHRASE = "が広く見られる手口と一致します";
const BANNED = ["このメールは詐欺です", "可能性が高い", "不審", "信頼性が低い", "低リスク", "高リスク", "安全です"];
function rendered(r) {
  const d = r.display || {};
  return [d.headline, d.banner, d.body, ...(d.notes || []), ...(d.reasons || []), ...(d.actions || [])].join("\n");
}
function hasPhrase(r) { return rendered(r).indexOf(PHRASE) >= 0; }
const refund = "還付金の振り込みエラーのお知らせです。証明書ファイルをダウンロードしてご確認ください。";
const pay = "月額利用料の未決済のお知らせです。更新手続きが完了できませんでした。お支払い方法を更新してください。\nhttps://q7v9z.example/pay";
const points = "ポイント失効のお知らせです。保有するポイントが失効します。\nhttps://q7v9z.example/p";
const base = { channel: "email", subject: "" };

const listed = judge(Object.assign({}, base, { display_name: "e-Tax", from_email: "info@e-tax.nta.go.jp", body: refund }));
const otherAddr = judge(Object.assign({}, base, { display_name: "e-Tax", from_email: "x@e-tax.nta.go.jp", body: refund }));
const oldDomain = judge(Object.assign({}, base, { display_name: "dポイント", from_email: "a@dpoint.jp", body: points }));
const parentBrand = judge(Object.assign({}, base, { display_name: "楽天カード", from_email: "a@rakuten.co.jp", body: pay }));
const otherBrand = judge(Object.assign({}, base, { display_name: "Amazon", from_email: "a@rakuten.co.jp", body: pay }));
const google = judge(Object.assign({}, base, { display_name: "Google", from_email: "no-reply@accounts.google.com", body: pay }));
check("listed mailbox skips the campaign sentence", !hasPhrase(listed) && listed.safety_guarantees === false);
check("another address on the same host still gets the sentence", hasPhrase(otherAddr));
check("an old domain still gets the sentence", hasPhrase(oldDomain) && rendered(oldDomain).indexOf("dpoint.jpは公式") < 0);
check("same group skips the sentence and a different brand does not", !hasPhrase(parentBrand) && hasPhrase(otherBrand));
check("google does not skip the sentence", hasPhrase(google));
[listed, otherAddr, oldDomain, parentBrand, otherBrand, google].forEach(function (r, i) {
  const text = rendered(r);
  check("result " + i + " keeps the forbidden words out", BANNED.every(function (word) { return text.indexOf(word) < 0; }), text.slice(0, 180));
});

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const senderSrc = fs.readFileSync(path.join(root, "js/official-senders.js"), "utf8");
check("the page loads the sender module from a script tag before judge", html.indexOf('src="js/official-senders.js"') >= 0 && html.indexOf('src="js/official-senders.js"') < html.indexOf('src="js/judge.js"'));
check("the sender module does not fetch", !/fetch\s*\(|XMLHttpRequest|sendBeacon/.test(senderSrc));
check("the sender module does not call a domain safe", senderSrc.indexOf("安全") < 0 && senderSrc.indexOf("低リスク") < 0 && senderSrc.indexOf("高リスク") < 0);

function brand(id) {
  return globalThis.MH_PROTOCOL.brands.filter(function (b) { return b.id === id; })[0];
}
check("ledger ids used by the sentence point at the sender list", brand("amazon_jp").officialKey === "amazon" && brand("nta_general").officialKey === "nta" && brand("nta_etax").officialKey === "nta" && brand("dpoint").officialKey === "dpoint" && brand("rakuten_card").officialKey === "rakuten_card" && brand("google").officialKey === "google" && !brand("nhk").officialKey);

console.log("\n" + pass + " passed, " + fail + " failed.");
if (fail) {
  console.log(failures.join("\n"));
  process.exit(1);
}
