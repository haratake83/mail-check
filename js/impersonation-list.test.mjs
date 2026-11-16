// 2026-11-16 のなりすまし一覧。選択肢、公式送信元、助言。
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GENRE_LABELS, CONTENT_LABELS } from "../api/weekly-rank.mjs";
const require = createRequire(import.meta.url);
require("./protocol-data.js");
require("./official-senders.js");
require("./judge.js");
require("./choice-ids.js");
const judge = globalThis.MH_judge;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail ? " :: " + detail : ""));
  console.log("FAIL  " + name + (detail ? " :: " + detail : ""));
}

const genres = ["gov", "ec", "delivery", "bank", "card", "carrier", "points", "subscription", "it", "travel", "crypto", "other"];
const contents = ["undelivered", "lock", "payment_update", "unpaid", "fraud_alert", "prize", "point_expiry", "virus", "reservation", "reauth", "other"];
check("html radios match the shared ids", genres.every(function (id) { return html.includes('name="sender_genre" value="' + id + '"') && GENRE_LABELS[id]; }) && contents.every(function (id) { return html.includes('name="mail_content" value="' + id + '"') && CONTENT_LABELS[id]; }));
check("labels are the short list wording", GENRE_LABELS.points === "ポイント・マイル" && GENRE_LABELS.crypto === "暗号資産・投資" && CONTENT_LABELS.point_expiry === "ポイント失効・有効期限切れ" && CONTENT_LABELS.reauth === "再認証・秘密鍵やマイナンバーの入力" && CONTENT_LABELS.other === "その他・不明");
check("choices start unchecked", !html.includes(" checked") && (html.match(/該当する項目にチェックを入れてください/g) || []).length === 2);

const base = { channel: "email", subject: "" };
const pointBody = "Vポイント失効のお知らせです。保有するポイントが失効します。\nhttps://q7v9z.example/p";
const plain = judge(Object.assign({}, base, { display_name: "Vポイント", from_email: "info@vpoint-notice.example", body: "山田様、本日の連絡です。" }));
const chosenOnly = judge(Object.assign({}, base, { display_name: "Vポイント", from_email: "info@vpoint-notice.example", body: "山田様、本日の連絡です。", sender_genre: "points", mail_content: "point_expiry" }));
const themed = judge(Object.assign({}, base, { display_name: "Vポイント", from_email: "info@vpoint-notice.example", body: pointBody, sender_genre: "points", mail_content: "point_expiry" }));
check("genre and content alone do not change danger", plain.danger_level === chosenOnly.danger_level && plain.verdict === chosenOnly.verdict && !(chosenOnly.theme_advice || []).length);
const rendered = [themed.display.body, themed.display.reasons.join("\n"), themed.display.actions.join("\n")].join("\n");
const phrase = "ポイントやマイルの失効が広く見られる手口と一致します。しっかりと確認が必要です。※詐欺と確定したことにはなりません。";
check("point expiry sentence appears once", rendered.split(phrase).length - 1 === 1, rendered.slice(0, 240));
check("point expiry adds one advice line", themed.display.actions.filter(function (a) { return a === "ポイントは、公式アプリで残高と期限を確認してください。"; }).length === 1);

const etc = judge(Object.assign({}, base, { display_name: "ETC利用照会サービス", from_email: "notice@etc-expire.example", body: "ETCカードの有効期限切れのお知らせです。\nhttps://q7v9z.example/etc", mail_content: "reservation", sender_genre: "travel" }));
check("etc advice is present once", etc.display.actions.filter(function (a) { return a === "ETCは、公式サイトを自分で開いて確認してください。"; }).length === 1 && etc.display.body.includes("ETCの有効期限の案内が広く見られる手口と一致します"));
const secret = judge(Object.assign({}, base, { display_name: "MetaMask", from_email: "notice@wallet-check.example", body: "セキュリティ強化のため秘密鍵を入力してください。\nhttps://q7v9z.example/key", mail_content: "reauth", sender_genre: "crypto" }));
check("secret key advice does not tell people to enter it", secret.display.actions.indexOf("秘密鍵・復元フレーズは、誰にも入力しないでください。") >= 0 && !secret.display.actions.some(function (a) { return /入力してください/.test(a) && /秘密鍵/.test(a); }));

const official = judge(Object.assign({}, base, { display_name: "Netflix", from_email: "info@members.netflix.com", body: "支払いエラーによりメンバーシップを一時停止します。更新手続きが完了できませんでした。\nhttps://www.netflix.com/account" }));
const fake = judge(Object.assign({}, base, { display_name: "Netflix", from_email: "notice@netflix-pay.example", body: "支払いエラーによりメンバーシップを一時停止します。更新手続きが完了できませんでした。\nhttps://q7v9z.example/pay" }));
check("official netflix sender does not get the campaign sentence", !official.display.body.includes("広く見られる手口と一致します") && !official.evidence.some(function (e) { return e.rule_id === "R01"; }));
check("non-official netflix sender can get the sentence without the choice raising danger", fake.display.body.includes("広く見られる手口と一致します") && fake.danger_level === judge(Object.assign({}, base, { display_name: "Netflix", from_email: "notice@netflix-pay.example", body: "支払いエラーによりメンバーシップを一時停止します。更新手続きが完了できませんでした。\nhttps://q7v9z.example/pay" })).danger_level);

const sagawa = globalThis.MH_PROTOCOL.brands.filter(function (b) { return b.id === "sagawa"; })[0];
const nenkin = globalThis.MH_PROTOCOL.brands.filter(function (b) { return b.id === "nenkin"; })[0];
const unverified = globalThis.MH_PROTOCOL.brands.filter(function (b) { return b.id === "bitflyer" || b.id === "metamask" || b.id === "vpoint"; });
check("verified domains come from official pages", sagawa.web.indexOf("~sagawa-exp.co.jp") >= 0 && nenkin.web.indexOf("~nenkin.go.jp") >= 0 && globalThis.MH_PROTOCOL.brands.some(function (b) { return b.id === "jcb" && b.web.indexOf("~jcb.co.jp") >= 0; }));
check("unverified targets have names and no guessed domain", unverified.length === 3 && unverified.every(function (b) { return b.names.length && !(b.web || []).length && !(b.send || []).length; }));

console.log("\n" + pass + " passed, " + fail + " failed.");
if (fail) {
  console.log(failures.join("\n"));
  process.exit(1);
}
