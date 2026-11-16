// 判定回数と週間ランキングから外すドメイン。node js/domain-exclusions.test.mjs
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { judgmentEvents, rankingsFromEvents } from "../api/weekly-rank.mjs";
const require = createRequire(import.meta.url);
require("./domain-exclusions.js");
require("./protocol-data.js");
require("./official-senders.js");
require("./judge.js");
require("./domain-age.js");
require("./domain-count.js");
require("./weekly-rank.js");
const excluded = globalThis.MH_DOMAIN_EXCLUSIONS.isExcludedDomain;
const count = globalThis.MH_DOMAIN_COUNT;
const weekly = globalThis.MH_WEEKLY;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail ? " :: " + detail : ""));
  console.log("FAIL  " + name + (detail ? " :: " + detail : ""));
}

["gmail.com", "yahoo.co.jp", "outlook.com", "icloud.com", "docomo.ne.jp", "ezweb.ne.jp", "softbank.ne.jp", "au.com"].forEach(function (domain) {
  check(domain + " is excluded", excluded(domain) === true);
});
["www.nta.go.jp", "city.lg.jp", "u-tokyo.ac.jp", "example.ed.jp", "amazon.co.jp", "apple.com", "google.com", "mail.google.com", "shop.amazon.co.jp"].forEach(function (domain) {
  check(domain + " is excluded", excluded(domain) === true);
});
["example.com", "example.co.jp", "q7v9z.example", "support-amazon.example"].forEach(function (domain) {
  check(domain + " can be counted", excluded(domain) === false);
});

check("count lookup is skipped for gmail", count.planCount("person@gmail.com") === null);
check("count lookup still plans a normal domain", count.planCount("notice@shop.example.co.jp") && count.planCount("notice@shop.example.co.jp").body.domain === "example.co.jp");
check("weekly record skips gmail", weekly.recordBody({ domain: "gmail.com", genre: "bank", content: "lock" }) === null);
check("weekly record keeps example.com", weekly.recordBody({ domain: "example.com", genre: "other" }).domain === "example.com");
check("server does not record gmail", judgmentEvents({ domain: "Gmail.com", genre: "bank", content: "lock" }, 1000) === null);
check("server does not record a go.jp domain", judgmentEvents({ domain: "www.nta.go.jp" }, 1000) === null);
check("server still records example.com", judgmentEvents({ domain: "Example.COM" }, 1000)[0].key === "example.com");
const ranked = rankingsFromEvents([].concat(
  Array.from({ length: 12 }, function () { return { kind: "domain", key: "gmail.com", at: 1 }; }),
  Array.from({ length: 12 }, function () { return { kind: "domain", key: "example.com", at: 1 }; })
));
check("ranking drops an excluded domain even if it was stored", ranked.domains.length === 1 && ranked.domains[0].key === "example.com");

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const domainBlock = html.slice(html.indexOf("週間判定ドメインランキング"), html.indexOf("週間判定ジャンルランキング"));
check("domain page slot sits after the domain ranking and stays hidden", domainBlock.includes('id="domain-page-info"') && domainBlock.includes("hidden") && domainBlock.includes("ドメインページ専用の欄（サーバー側で中身を入れる）") && html.indexOf('id="domain-page-info"') < html.indexOf("週間判定ジャンルランキング"));
const age = fs.readFileSync(path.join(root, "js/domain-age.js"), "utf8");
check("domain age top band stays 30日以内", age.includes("age <= 30") && age.includes("30日以内") && age.includes("取得から31日以上、1年未満") && age.indexOf("30日以内") < age.indexOf("取得から31日以上"));

console.log("\n" + pass + " passed, " + fail + " failed.");
if (fail) {
  console.log(failures.join("\n"));
  process.exit(1);
}
