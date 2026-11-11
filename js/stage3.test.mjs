// 判定区分と利用規約下書き。注意度の％は出さない。node js/stage3.test.mjs
import fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("./protocol-data.js");
require("./judge.js");
const judge = globalThis.MH_judge;
const base = { display_name: "", from_email: "notice@example.com", channel: "email", visible_link_url: "", context_answer: "unknown" };
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail ? " :: " + detail : ""));
  console.log("FAIL  " + name + (detail ? " :: " + detail : ""));
}
function run(body, extra) { return judge(Object.assign({}, base, { body: body }, extra || {})); }

const strong = run("ギフトカードの番号を送ってください。");
check("A01 strong verdict unchanged", strong.verdict === "strong_suspicion" && strong.danger_level === "S" && !strong.attention);
const reviewM = run("デバイスコードを入力してください。");
check("A02 needs_review M unchanged", reviewM.verdict === "needs_review" && reviewM.danger_level === "M" && !reviewM.attention);
const reviewN = run("山田様、お支払い500円の受領通知です。", { context_answer: "no" });
check("A03 needs_review N unchanged", reviewN.verdict === "needs_review" && reviewN.danger_level === "N" && !reviewN.attention);
const reviewW = run("こちらのボタンを押してください。");
check("needs_review W unchanged", reviewW.verdict === "needs_review" && reviewW.danger_level === "W" && !reviewW.attention);
const grey = run("山田様、本日の連絡です。");
check("A04 no_clear keeps the safety banner", grey.verdict === "no_clear_signal" && grey.display.banner.indexOf("安全ではありません") >= 0 && !grey.attention);
const insuff = run("");
check("A05 insufficient unchanged", insuff.verdict === "insufficient" && !insuff.attention);
const lead = run("ギフトカードの番号を送ってください。powershell を貼り付けて実行してください。");
check("A06 lead and strong verdict coexist", lead.verdict === "strong_suspicion" && lead.display.lead && lead.danger_level === "S");
const again = run("ギフトカードの番号を送ってください。");
check("A07 repeat is stable", again.verdict === strong.verdict && again.danger_level === strong.danger_level);

const ui = fs.readFileSync(new URL("./ui.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const list = fs.readFileSync(new URL("../list.html", import.meta.url), "utf8");
const terms = fs.readFileSync(new URL("../terms.html", import.meta.url), "utf8");
check("result renderer has no attention block", !ui.includes("注意度") && !ui.includes("renderAttention") && !ui.includes("attention-scale") && !ui.includes("根拠の目安を見る"));
const renderSrc = ui.slice(ui.indexOf("function render(r)"));
check("display order source is lead then verdict", renderSrc.indexOf('el("h2", "verdict-head"') > renderSrc.indexOf("lead-alert"));
check("public pages do not mention an attention score", !index.includes("注意度") && !terms.includes("注意度") && !list.includes("注意度"));
check("terms draft notice and undetermined marks", terms.includes("弁護士の確認前の下書き") && terms.includes("未定") && !terms.includes("名称候補") && !terms.includes("0円とする実質的全部免責"));
check("terms mark address statistics as planned and not started", terms.includes("ドメインは現在どこにも集めていません") && terms.includes("本文内のリンク先ドメイン") && terms.includes("安全であることも危険であることも意味しません") && terms.includes("本文とURLは統計に使いません") && !terms.includes("サーバへ送られることがあります"));
check("terms do not invent an operator address or a yen cap", !/株式会社|東京都|〒\d/.test(terms) && !/上限として金[0-9]/.test(terms) && !terms.includes("一切の損害について責任を負いません"));
check("terms are linked from the footer, history, and list", index.includes('href="terms.html"') && index.includes('href="#privacy_detail"') && list.includes('href="terms.html"') && list.includes("プライバシーに関する説明"));
check("forbidden absolute disclaimer is absent", !terms.includes("損害賠償の有無・金額は当社が決定します") && !terms.includes("法令に反しない限り責任を負いません"));

console.log("\n" + pass + " passed, " + fail + " failed.");
if (fail) { console.log(failures.join("\n")); process.exit(1); }
