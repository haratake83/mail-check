// 利用者が 2026-11-12 に報告した頻出の送信元名・本文・手口の回帰。
// 名前や語句だけでは R01 で危険度を上げない。公式の送信元では文言も出さない。
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("./protocol-data.js");
require("./official-senders.js");
require("./judge.js");
const judge = globalThis.MH_judge;
const base = { channel: "email", subject: "" };

function ev(r, id) { return (r.evidence || []).some((e) => e.rule_id === id); }
const PHRASE = "が広く見られる手口と一致します。しっかりと確認が必要です。※詐欺と確定したことにはなりません。";
function renderedText(r) {
  const d = r.display || {};
  return [d.headline, d.banner, d.body, ...(d.notes || []), ...(d.reasons || []), ...(d.actions || [])].join("\n");
}
function phraseCount(r) {
  const t = renderedText(r);
  let n = 0;
  let i = 0;
  while ((i = t.indexOf(PHRASE, i)) >= 0) { n++; i += PHRASE.length; }
  return n;
}
function hasWording(r) {
  const t = renderedText(r);
  return phraseCount(r) === 1 && t.includes(PHRASE) && !t.includes("このメールは詐欺です") && !t.includes("確実に詐欺") && !t.includes("可能性が高い") && !t.includes("不審") && !/安全です|低リスク|高リスク|信頼性が低い/.test(t);
}

const rows = [
  ["Amazon未決済_非公式", { display_name: "Amazon.cm.jp", from_email: "notice@support-amazon.example", body: "月額利用料の未決済のお知らせです。更新手続きが完了できませんでした。お支払い方法を更新してください。\nhttps://q7v9z.example/pay" }, ["S"], true, true],
  ["iCloud支払い未完了_非公式", { display_name: "iCloud +", from_email: "notice@icloud-pay.example", body: "支払い手続き未完了のお知らせです。更新手続きが完了できませんでした。お支払い方法を更新してください。\nhttps://q7v9z.example/pay" }, ["M", "S"], true, true],
  ["Vポイント失効_お知らせ", { display_name: "お知らせ", from_email: "info@vpoint-notice.example", body: "Vポイント失効のお知らせです。保有するポイント（15,000円相当）が失効します。こちらから手続きしてください。\nhttps://q7v9z.example/p" }, ["W", "M", "S", "N"], false, true],
  ["Apple_iCloud更新_非公式", { display_name: "Apple", from_email: "notice@apple-id-update.example", body: "iCloud更新のお知らせです。更新手続きが完了できませんでした。お支払い方法を更新してください。\nhttps://q7v9z.example/pay" }, ["M", "S"], true, true],
  ["エスポカード_ポイント失効", { display_name: "エスポカードサポート", from_email: "support@espo-card.example", body: "ポイント失効のお知らせです。保有するポイント（12,000円相当）が失効します。こちらから手続きしてください。\nhttps://q7v9z.example/p" }, ["W", "M", "S", "N"], false, true],
  ["WAON_ポイント失効", { display_name: "WAON POINT事務局", from_email: "info@waon-point.example", body: "WAONポイント失効のお知らせです。保有するポイント（10,000円相当）が失効します。こちらから手続きしてください。\nhttps://q7v9z.example/p" }, ["W", "M", "S", "N"], false, true],
  ["ANA_スカイコイン失効", { display_name: "ANAマイレージクラブ", from_email: "info@ana-mile.example", body: "スカイコイン失効のお知らせです。保有するポイント（20,000円相当）が失効します。こちらから手続きしてください。\nhttps://q7v9z.example/p" }, ["W", "M", "S", "N"], false, true],
  ["楽天銀行_不正ログイン", { display_name: "楽天銀行株式会社", from_email: "notice@rakuten-bank-sec.example", body: "不正ログインのお知らせです。心当たりがない場合は、こちらから確認してください。\nhttps://q7v9z.example/login" }, ["W", "M", "S", "N"], false, true],
  ["eオリコ_不正利用", { display_name: "eオリコカードセンター", from_email: "center@e-orico.example", body: "カードの不正利用のお知らせです。こちらから確認してください。\nhttps://q7v9z.example/card" }, ["W", "M", "S", "N"], false, true],
  ["国税庁_還付エラー_ファイル", { display_name: "国税庁", from_email: "refund@nta-tax.example", body: "還付金の振り込みエラーのお知らせです。証明書ファイルをダウンロードしてご確認ください。" }, ["M"], true, true],
  ["マイナポータル_住宅控除_不可視文字", { display_name: "マイナポータル", from_email: "notice@myna-portal.example", body: "住宅\u2060借 入 金等特別控除証明書のご案内です。証明書ファイルをダウンロードしてご確認ください。" }, ["W", "M", "S", "N"], false, true],
  ["ヤマト運輸株式_お預かり", { display_name: "ヤマト運輸株式", from_email: "notice@yamato-hold.example", body: "お届け荷物のお預かりのお知らせです。こちらから再配達を依頼してください。\nhttps://q7v9z.example/hold" }, ["S"], true, true],
  ["カード事務局_利用可能額", { display_name: "カード事務局", from_email: "info@jcb-limit.example", body: "JCBカードのご利用可能額のお知らせです。こちらからご確認ください。\nhttps://q7v9z.example/limit" }, ["W", "M", "S", "N"], false, true],
  ["NEG_Amazon公式_手口文言なし", { display_name: "Amazon", from_email: "auto-confirm@amazon.co.jp", body: "月額利用料の未決済のお知らせです。更新手続きが完了できませんでした。お支払い方法を更新してください。\nhttps://www.amazon.co.jp/pay" }, null, false, false],
  ["NEG_国税庁公式ドメイン_手口文言なし", { display_name: "国税庁", from_email: "info@nta.go.jp", body: "還付金の振り込みエラーのお知らせです。証明書ファイルをダウンロードしてご確認ください。" }, null, false, false],
  ["NEG_こちらだけ_リンク扱いしない", { display_name: "お知らせ", from_email: "info@vpoint-notice.example", body: "Vポイント失効のお知らせです。保有するポイントが失効します。こちらから手続きしてください。" }, null, false, false],
];

let pass = 0;
for (const [id, inp, levels, expectR01, expectWording] of rows) {
  const r = judge({ ...base, ...inp });
  const hasR01 = ev(r, "R01");
  const levelOk = levels ? levels.includes(r.danger_level) : true;
  const word = hasWording(r);
  const once = phraseCount(r) === (expectWording ? 1 : 0);
  const ok = levelOk && hasR01 === expectR01 && word === expectWording && once && r.safety_guarantees === false;
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}: ${r.danger_level}/${r.verdict} R01=${hasR01} wording=${word} times=${phraseCount(r)}`);
  if (!ok) {
    console.log("      expect R01=" + expectR01 + " wording=" + expectWording + (levels ? " level=" + levels.join("|") : ""));
    console.log("      ev=" + (r.evidence || []).map((e) => e.rule_id + ":" + e.strength).join(","));
    console.log("      body=" + (r.display && r.display.body));
  }
}
const nameOnly = judge({ ...base, display_name: "お知らせ", from_email: "notice@example.com", body: "山田様、本日の連絡です。" });
const noName = judge({ ...base, display_name: "", from_email: "notice@example.com", body: "山田様、本日の連絡です。" });
const nameOnlyOk = !ev(nameOnly, "R01") && !hasWording(nameOnly) && nameOnly.danger_level === noName.danger_level;
console.log(`${nameOnlyOk ? "PASS" : "FAIL"}  名前だけでは危険度も文言も増えない: ${nameOnly.danger_level} vs ${noName.danger_level}`);
if (nameOnlyOk) pass++;
const total = rows.length + 1;
console.log(`\n${pass}/${total} passed.`);
if (pass !== total) process.exit(1);
