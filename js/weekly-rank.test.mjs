// 週間ランキング。node js/weekly-rank.test.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import {
  WEEK_MS,
  GENRE_LABELS,
  CONTENT_LABELS,
  judgmentEvents,
  rankingsFromEvents,
  createMemoryWeeklyStore,
  createCommandWeeklyStore,
  createWeeklyHandler,
  createWeeklyStore,
  toRegistrable
} from "../api/weekly-rank.mjs";

const require = createRequire(import.meta.url);
require("./protocol-data.js");
require("./judge.js");
require("./domain-age.js");
require("./weekly-rank.js");
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

const NOW = Date.parse("2026-11-13T00:00:00Z");
check("co.jp stays three labels", toRegistrable("shop.example.co.jp") === "example.co.jp" && toRegistrable("example.co.jp") === "example.co.jp");

const events = judgmentEvents({
  domain: "Victim.User@shop.example.co.jp",
  genre: "delivery",
  content: "unpaid",
  email: "hidden@example.com",
  display_name: "山田",
  subject: "件名",
  body: "本文 https://evil.example/secret"
}, NOW);
check("an email payload is rejected", events === null);

const counted = judgmentEvents({ domain: "shop.example.co.jp", genre: "delivery", content: "unpaid" }, NOW);
check("one judgment counts domain, genre, and content once", counted && counted.length === 3 && counted[0].key === "example.co.jp" && counted[1].key === "delivery" && counted[2].key === "unpaid");
const domainOnly = judgmentEvents({ domain: "mail.example.com" }, NOW);
check("unselected genre and content are not counted", domainOnly && domainOnly.length === 1 && domainOnly[0].key === "example.com");
check("unknown genre is rejected", judgmentEvents({ domain: "example.com", genre: "sms" }, NOW) === null);
check("unknown content is rejected", judgmentEvents({ domain: "example.com", content: "hack" }, NOW) === null);
const otherContent = judgmentEvents({ domain: "example.com", content: "other" }, NOW);
check("content other is allowed", otherContent && otherContent.some(function (event) { return event.kind === "content" && event.key === "other"; }));
const otherEvents = [];
for (let i = 0; i < 10; i++) otherEvents.push({ kind: "content", key: "other", at: NOW });
check("content other ranks as その他・不明", CONTENT_LABELS.other === "その他・不明" && rankingsFromEvents(otherEvents).contents[0].label === "その他・不明" && rankingsFromEvents(otherEvents).contents[0].key === "other");
check("the browser sends content other", weekly.recordBody({ domain: "example.com", content: "other" }).content === "other");

const clientBody = weekly.recordBody({ domain: "example.co.jp", genre: "bank", content: null, display_name: "山田", subject: "件名", body: "本文", from_email: "a@example.co.jp" });
check("the browser payload omits mail text", JSON.stringify(clientBody) === JSON.stringify({ domain: "example.co.jp", genre: "bank" }) && !JSON.stringify(clientBody).includes("@") && !JSON.stringify(clientBody).includes("山田"));
check("the browser refuses an email", weekly.recordBody({ domain: "a@example.com", genre: "bank" }) === null);

const store = createMemoryWeeklyStore();
for (let i = 0; i < 9; i++) await store.add(judgmentEvents({ domain: "nine.example" }, NOW), NOW);
let view = rankingsFromEvents(await store.read(NOW));
check("nine judgments stay off the ranking", view.domains.length === 0);
await store.add(judgmentEvents({ domain: "nine.example", genre: "gov", content: "prize" }, NOW), NOW);
view = rankingsFromEvents(await store.read(NOW));
check("the tenth judgment appears", view.domains.length === 1 && view.domains[0].key === "nine.example" && view.domains[0].count === 10 && view.genres.length === 0 && view.contents.length === 0);

const tie = createMemoryWeeklyStore();
const names = ["m.example", "a.example", "z.example", "b.example", "c.example", "d.example", "e.example", "f.example", "g.example", "h.example", "i.example"];
for (const name of names) {
  for (let i = 0; i < 10; i++) await tie.add([{ kind: "domain", key: name, at: NOW }], NOW);
}
const tied = rankingsFromEvents(await tie.read(NOW)).domains;
check("at most ten rows, ties break alphabetically", tied.length === 10 && tied.map((row) => row.key).join(",") === names.slice().sort().slice(0, 10).join(",") && !tied.some((row) => row.key === "z.example"));

const aged = createMemoryWeeklyStore();
for (let i = 0; i < 10; i++) await aged.add([{ kind: "domain", key: "old.example", at: NOW - WEEK_MS }], NOW);
for (let i = 0; i < 10; i++) await aged.add([{ kind: "domain", key: "fresh.example", at: NOW - WEEK_MS + 1000 }], NOW);
const agedView = rankingsFromEvents(await aged.read(NOW));
check("counts older than seven days drop off", agedView.domains.length === 1 && agedView.domains[0].key === "fresh.example");
check("empty rankings have no rows", rankingsFromEvents([]).domains.length === 0 && rankingsFromEvents([]).genres.length === 0);

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
function req(method, body) {
  return {
    method: method,
    headers: { host: "mail.example", origin: "https://mail.example", "sec-fetch-site": "same-origin" },
    body: body
  };
}
const httpStore = createMemoryWeeklyStore();
const handler = createWeeklyHandler({ store: httpStore, now: function () { return NOW; }, limitPerIp: 50, globalPerMinute: 100 });
for (let i = 0; i < 10; i++) {
  const res = mockRes();
  await handler(req("POST", { domain: "Shop.Example.CO.JP", genre: "delivery", content: i < 10 ? "lock" : "" }), res);
  if (i === 9) check("handler counts one judgment once", res.statusCode === 200 && res.payload.domains[0].key === "example.co.jp" && res.payload.domains[0].count === 10 && res.payload.genres[0].label === GENRE_LABELS.delivery && res.payload.contents[0].label === CONTENT_LABELS.lock);
}
const extra = mockRes();
await handler(req("POST", { domain: "example.co.jp", email: "a@example.co.jp" }), extra);
check("extra email field is not stored", extra.statusCode === 400 && (await httpStore.read(NOW)).every((event) => !JSON.stringify(event).includes("@")));
const bad = mockRes();
await handler(req("POST", { domain: "person@example.com" }), bad);
check("handler rejects an email address", bad.statusCode === 400);
const empty = mockRes();
await handler(req("GET"), empty);
check("get returns only keys and counts", empty.statusCode === 200 && !JSON.stringify(empty.payload).includes("@") && empty.payload.domains[0].count === 10);

const sent = [];
const commandStore = createCommandWeeklyStore(async function (commands) {
  sent.push(commands);
  if (commands.some(function (command) { return command[0] === "ZRANGEBYSCORE"; })) return [0, ["domain\texample.com\t1", "1000", "genre\tdelivery\t2", "1000"]];
  return commands.map(function () { return 1; });
});
await commandStore.add(judgmentEvents({ domain: "example.com", genre: "delivery" }, 1000), 1000);
const commandEvents = await commandStore.read(1000 + 1000);
const flat = JSON.stringify(sent);
check("redis commands store no email", commandEvents.length === 2 && commandEvents[0].key === "example.com" && !flat.includes("@") && !flat.includes("secret") && sent[0].some((command) => command[0] === "ZREMRANGEBYSCORE"));
check("store selection stays in memory without credentials", createWeeklyStore({}).kind === "memory");

const ui = fs.readFileSync(path.join(root, "js/ui.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "css/app.css"), "utf8");
const rankCss = css.slice(css.indexOf(".weekly-rankings {"), css.indexOf(".weekly-rank h2"));
const recordLine = ui.split("\n").filter(function (line) { return line.includes("MH_WEEKLY.record"); })[0] || "";
check("record runs after render and not from the clear button", ui.indexOf("render(r)") < ui.indexOf("MH_WEEKLY.record") && recordLine.includes("rankPlan.body.domain") && !recordLine.includes("display_name") && !recordLine.includes("subject") && !recordLine.includes("from_email"));
check("footer order is disclaimer, rankings, note, version, guides", html.indexOf("これは参考情報です。最終的な判断はご自身でお願いします。") < html.indexOf("本結果は入力された文字情報だけに基づく補助的な判定で、安全性や正当性を保証するものではありません。") && html.indexOf("本結果は入力された文字情報だけに基づく補助的な判定で、安全性や正当性を保証するものではありません。") < html.indexOf("週間判定ドメインランキング") && html.indexOf("週間判定ドメインランキング") < html.indexOf("週間判定ジャンルランキング") && html.indexOf("週間判定ジャンルランキング") < html.indexOf("週間判定メール内容ランキング") && html.indexOf("週間判定メール内容ランキング") < html.indexOf("直近7日間に、10回以上判定されたものを、多い順に最大10件まで掲載します。") && html.indexOf("直近7日間に、10回以上判定されたものを、多い順に最大10件まで掲載します。") < html.indexOf("表示 v0.10.5") && html.indexOf("表示 v0.10.5") < html.indexOf("guides/how-to-spot.html"));
check("ranking comments are real comments", html.includes("<!-- ここは週間判定ドメインランキングの欄です -->") && html.includes("<!-- ここは週間判定ジャンルランキングの欄です -->") && html.includes("<!-- ここは週間判定メール内容ランキングの欄です -->"));
check("weekly rankings are white with no card", rankCss.includes("background: #fff") && rankCss.includes("border: 0") && !rankCss.includes("var(--beige)") && !rankCss.includes("border-radius: 8px"));
check("ranking note does not assert fraud or safety", html.includes("よく判定に使われたという情報であり、詐欺であることも、安全であることも意味しません。") && !html.includes("低リスク") && !html.includes("高リスク") && !html.includes("可能性が高い") && !html.includes("信頼性が低い"));
check("result stays above the footer rankings", html.indexOf('id="result"') < html.indexOf('id="weekly_rankings"') && html.indexOf('id="check"') < html.indexOf('id="result"'));

console.log("\n" + pass + " passed, " + fail + " failed.");
if (fail) {
  console.log(failures.join("\n"));
  process.exit(1);
}
