// 解説ページ v0.10 の受け入れ確認。node js/guides.test.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail ? " :: " + detail : ""));
  console.log("FAIL  " + name + (detail ? " :: " + detail : ""));
}
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
const pages = ["guides/how-to-spot.html", "guides/if-you-opened.html", "guides/types.html", "guides/phishing.html", "guides/malware.html", "guides/billing.html", "guides/spam.html"];
const allGuides = pages.concat(["guides/contacts.html", "guides/index.html"]).map(read).join("\n");
const index = read("index.html");
const ui = read("js/ui.js");
const flags = read("js/flags.js");
pages.forEach(function (rel) {
  const html = read(rel);
  check("T-M1 " + rel, html.includes("判断できませんでした") && html.includes("安全という意味ではありません") && !html.includes("注意度") && html.includes("SMSは判定の対象外です") && html.includes("本当のリンク先") && !html.includes("本サービスなら安全") && !html.includes("本サービスで安全"));
});
const opened = read("guides/if-you-opened.html");
check("T-M2 order", opened.indexOf("最初に確認すること") < opened.indexOf("入力・導入・電話・支払いをしていない場合") && opened.includes("フィッシングのメールやSMS") && opened.includes("疑わしいメールのURLや添付ファイルはクリックしない") && opened.indexOf("IPA") < opened.indexOf("総務省の企業・組織向けページ") && !opened.includes("開いただけなら大丈夫"));
check("T-M3 no unverified spam-center phone", !allGuides.includes("03-5974-0068") && read("guides/spam.html").includes("soumu.go.jp") && read("guides/contacts.html").includes("soumu.go.jp"));
const contacts = read("guides/contacts.html");
check("T-M4 contacts table", contacts.includes("確認日2026-11-11") && contacts.includes("03-5978-7509") && contacts.includes("IPA自身のページ") && contacts.includes("10:00〜12:00、13:30〜17:00") && contacts.includes("土日祝") && contacts.includes("番号は推定しません") && contacts.includes("各都道府県警察本部で異なる"));
check("T-M5 definitions sit with numbers", read("guides/phishing.html").includes("被害の件数ではありません") && read("guides/phishing.html").includes("94,661") && read("guides/phishing.html").includes("かたる") && read("guides/billing.html").includes("被害件数ではない") && read("guides/spam.html").includes("受信箱に届く割合ではありません") && !read("guides/billing.html").includes("半減"));
const site = allGuides + index;
check("T-M6 no copy-link instructions", !index.includes("長押しして「リンクをコピー」") && !index.includes("リンク先を貼って") && read("guides/how-to-spot.html").includes("このサイトでは案内しません"));
check("T-M7 unverified items are marked", allGuides.includes("未確認") && !allGuides.includes("オプトイン") && !read("guides/malware.html").includes("Emotet") && !allGuides.includes("ばらまき型が多い"));
check("T-M8 no link field", !index.includes("visible_link_url") && index.includes("本文（本文中のURLを含む）"));
check("T-M9 button warning is in the result renderer", ui.includes("ボタンや画像、QRコードの本当の行き先は見ていません"));
check("T-R10 enterprise page is labeled", read("guides/malware.html").includes("企業・組織向け"));
check("T-R11 court phone", read("guides/billing.html").includes("その番号にはかけないでください") && !read("guides/billing.html").includes("裁判所はメールでは連絡しない"));
check("T-R16 sms caveat", (read("guides/how-to-spot.html").match(/SMSは本サービスの判定対象外です/g) || []).length >= 1 && (read("guides/types.html").match(/SMSは本サービスの判定対象外です/g) || []).length >= 1);
check("T-O1 quick list", contacts.indexOf("早見") < contacts.indexOf("<table") && contacts.includes("110番") && contacts.includes("188") && contacts.includes("IPA"));
check("T-O2 chatbot is not universal", contacts.includes("万能ではありません"));
check("T-O3 no copied IPA mailbox", !allGuides.includes("anshin@ipa.go.jp") && contacts.includes("antiphishing.jp"));
check("T-NAV guide links and hidden terms", index.includes("guides/how-to-spot.html") && index.includes('class="terms-public" href="terms.html" hidden') && flags.includes("FEATURE_TERMS_PUBLIC: false") && flags.includes("FEATURE_LIST_PUBLIC: false"));
check("T-R19 history subject can be masked", ui.includes("function maskHistorySubject") && index.includes("共用の端末では"));
console.log("\n" + pass + " passed, " + fail + " failed.");
if (fail) { console.log(failures.join("\n")); process.exit(1); }
