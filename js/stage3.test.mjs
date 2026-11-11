// 注意度の換算と利用規約下書き。判定スコアは変えない。node js/stage3.test.mjs
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
function attnOk(a) {
  return a && a.is_probability === false && a.scale_version === "attention-scale-2026-11-09-a" && a.display !== "0" && a.display !== "100" && a.display !== "0%" && a.display !== "100%";
}

const strong = run("ギフトカードの番号を送ってください。");
check("A01 strong is 80 inside 75-85 and verdict unchanged", strong.verdict === "strong_suspicion" && strong.danger_level === "S" && strong.attention.display === "80" && strong.attention.band[0] === 75 && strong.attention.band[1] === 85, strong.danger_level + " " + strong.attention.display);
const reviewM = run("デバイスコードを入力してください。");
check("A02 needs_review M is 60", reviewM.verdict === "needs_review" && reviewM.danger_level === "M" && reviewM.attention.display === "60" && reviewM.attention.band.join(",") === "55,65");
const reviewN = run("山田様、お支払い500円の受領通知です。", { context_answer: "no" });
check("A03 needs_review N is 45", reviewN.verdict === "needs_review" && reviewN.danger_level === "N" && reviewN.attention.display === "45" && reviewN.attention.band.join(",") === "40,50");
const reviewW = run("こちらのボタンを押してください。");
check("needs_review W is 45", reviewW.verdict === "needs_review" && reviewW.danger_level === "W" && reviewW.attention.display === "45");
const grey = run("山田様、本日の連絡です。");
check("A04 no_clear is a dash", grey.verdict === "no_clear_signal" && grey.attention.display === "—" && grey.attention.hidden_reason === "no_clear_signal" && grey.display.banner.indexOf("安全ではありません") >= 0);
const insuff = run("");
check("A05 insufficient is a dash", insuff.verdict === "insufficient" && insuff.attention.display === "—" && insuff.attention.hidden_reason === "insufficient");
const lead = run("ギフトカードの番号を送ってください。powershell を貼り付けて実行してください。");
check("A06 lead and strong attention coexist", lead.verdict === "strong_suspicion" && lead.display.lead && lead.attention.display === "80" && lead.danger_level === "S");
const again = run("ギフトカードの番号を送ってください。");
check("A07 repeat is stable", again.attention.display === strong.attention.display && again.verdict === strong.verdict && again.danger_level === strong.danger_level);
[strong, reviewM, reviewN, reviewW, grey, insuff, lead].forEach(function (r) {
  check("scale and not a probability " + r.verdict + r.danger_level, attnOk(r.attention) && r.attention.protocol_version === "0.9.3");
});
check("no displayed value is 0 or 100", [strong, reviewM, reviewN, grey, insuff].every(function (r) { return r.attention.display !== "0" && r.attention.display !== "100"; }));

const ui = fs.readFileSync(new URL("./ui.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const list = fs.readFileSync(new URL("../list.html", import.meta.url), "utf8");
const terms = fs.readFileSync(new URL("../terms.html", import.meta.url), "utf8");
check("A08 version label is in the renderer", ui.includes("attention-scale-2026-11-09-a") && ui.includes("判定プロトコル版"));
check("A09 breakdown says it is not an added probability", ui.includes("件数を足し上げた確率ではありません") && ui.includes("<details") === false && ui.includes('el("details"'));
check("short attention sentence is outside the collapsed details", ui.indexOf("注意度の数値は、詐欺の確率でも安全の度合いでもありません。") < ui.indexOf('el("details", "attention-break")') && ui.indexOf("詐欺である確率・的中率・安全の度合いではありません") > ui.indexOf('el("details", "attention-break")'));
const renderSrc = ui.slice(ui.indexOf("function render(r)"));
check("display order source is lead then attention then verdict", renderSrc.indexOf("renderAttention(r)") > renderSrc.indexOf("lead-alert") && renderSrc.indexOf('el("h2", "verdict-head"') > renderSrc.indexOf("renderAttention(r)"));
check("terms draft notice and undetermined marks", terms.includes("弁護士の確認前の下書き") && terms.includes("未定") && !terms.includes("名称候補") && !terms.includes("0円とする実質的全部免責"));
check("terms mark address statistics as planned and not started", terms.includes("メールアドレス、名前、件名は現在どこにも集めていません") && terms.includes("件名、本文、URLは統計に使いません") && terms.includes("公開の一覧に件名は出しません") && !terms.includes("サーバへ送られることがあります"));
check("terms do not invent an operator address or a yen cap", !/株式会社|東京都|〒\d/.test(terms) && !/上限として金[0-9]/.test(terms) && !terms.includes("一切の損害について責任を負いません"));
check("terms are linked from the footer, history, and list", index.includes('href="terms.html"') && index.includes('href="#privacy_detail"') && list.includes('href="terms.html"') && list.includes("プライバシーに関する説明"));
check("forbidden absolute disclaimer is absent", !terms.includes("損害賠償の有無・金額は当社が決定します") && !terms.includes("法令に反しない限り責任を負いません"));

console.log("\n" + pass + " passed, " + fail + " failed.");
if (fail) { console.log(failures.join("\n")); process.exit(1); }
