// v0.9 の受け入れ確認。node js/v09.test.mjs
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { projectReadableList } from "./stage2-projection.mjs";
const require = createRequire(import.meta.url);
require("./protocol-data.js");
require("./judge.js");
require("./stage2-public.js");
require("./flags.js");
const judge = globalThis.MH_judge;
const S = globalThis.MH_STAGE2;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail ? " :: " + detail : ""));
  console.log("FAIL  " + name + (detail ? " :: " + detail : ""));
}
function run(extra) {
  return judge(Object.assign({ display_name: "", from_email: "notice@example.com", body: "山田様、本日の連絡です。", context_answer: "unknown", channel: "email", visible_link_url: "" }, extra));
}
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const ui = fs.readFileSync(path.join(root, "js/ui.js"), "utf8");
const judgeSrc = fs.readFileSync(path.join(root, "js/judge.js"), "utf8");
const terms = fs.readFileSync(path.join(root, "terms.html"), "utf8");
const list = fs.readFileSync(path.join(root, "list.html"), "utf8");
const pub = [index, ui, terms, list, fs.readFileSync(path.join(root, "js/judge.js"), "utf8")].join("\n");

check("T-M1 no absolute non-send claim", !pub.includes("どこにも送信されません") && !pub.includes("入力内容はどこにも送信されません"));
const click = run({ body: "エラーを解消するため、powershell を貼り付けて実行してください。" });
check("T-M2 clickfix lead is ahead of the grey verdict", click.display.lead && click.verdict === "no_clear_signal" && click.danger_level === "N");
const combo = run({ display_name: "Amazon", from_email: "notice@amaz0n.example", body: "山田様、https://amaz0n.example/login で再認証してください。", context_answer: "yes" });
check("T-M3 strong result is not only a zero strong-count", combo.danger_level === "S" && !(combo.attention.strong_count === 0 && !/組合せで強い疑い/.test(combo.attention.breakdown_ja)), combo.attention.breakdown_ja);
check("T-M4 confidence scale row is gone", !ui.includes("判定の確からしさの目安") && ui.includes("この判定方式の精度は未測定です"));
const gap = run({ from_email: "", body: "ギフトカードの番号を送ってください。" });
check("T-M5 empty from stays insufficient and adds the lead", gap.verdict === "insufficient" && gap.danger_level === "S" && gap.display.input_gap_lead && gap.display.input_gap_lead.headline === "入力が足りませんが、注意すべき特徴があります" && gap.attention.display === "—", gap.verdict + " " + gap.danger_level);
check("T-M6 history panel is off by default", index.includes('id="history_panel" hidden') && index.includes("受付履歴の機能は準備中です") && globalThis.MH_FLAGS.FEATURE_HISTORY_PANEL === false);
check("T-M7 terms stay public and linked", index.includes('href="terms.html"') && !/noindex/.test(terms) && terms.includes("弁護士の確認前の下書き") && globalThis.MH_FLAGS.FEATURE_TERMS_PUBLIC === true);
check("T-M8 internal memos are gone and blanks say 未定", terms.includes("未定") && !terms.includes("名称候補") && !terms.includes("0円") && !terms.includes("情報流通プラットフォーム") && !/株式会社|〒\d/.test(terms));
check("T-M10 list link is hidden and the page is future tense", index.includes('id="list_link" hidden') && list.includes("判定の入力がそのままこの一覧に載ることはありません") && list.includes("掲載を始める場合は") && list.includes('name="robots" content="noindex"') && list.includes("掲載は不審なアドレスであることを意味しません") && globalThis.MH_FLAGS.FEATURE_LIST_PUBLIC === false);
const unsub = run({ display_name: "ヤマト運輸", from_email: "notice@kuronekoyamato.co.jp", body: "山田様、配信停止のご案内です。" });
check("T-R1 unsubscribe alone does not raise the level", unsub.auxiliary_flags.indexOf("B08") >= 0 && unsub.danger_level === "N" && unsub.verdict === "no_clear_signal", unsub.danger_level + " " + unsub.verdict + " " + unsub.auxiliary_flags.join(","));
const ctx = run({ body: "山田様、お支払い500円の受領通知です。", context_answer: "no" });
check("T-R2 context-only review names its reason", ctx.verdict === "needs_review" && ctx.danger_level === "N" && ctx.display.reasons.indexOf("根拠：心当たりなしの回答のみ") >= 0 && /根拠：心当たりなしの回答のみ/.test(ctx.attention.breakdown_ja));
const line = run({ display_name: "架空商事", body: "山田様、公式LINEの友だち追加をお願いします。" });
check("T-R3 line friend add is separate from a secret request", line.evidence.some((e) => e.rule_id === "A03L") && !line.evidence.some((e) => e.rule_id === "A01" || e.rule_id === "B04") && line.unknowns.indexOf("unlisted_brand_claim") >= 0);
const phone = run({ body: "山田様、お電話ください。" });
check("T-R3 phone switch is weak and not the payment rule", phone.evidence.some((e) => e.rule_id === "A03P") && !phone.evidence.some((e) => e.rule_id === "A03"));
const both = run({ body: "山田様、LINEの友だち追加とパスワードを入力してください。" });
check("T-R3 line is not counted again beside a secret request", both.evidence.some((e) => e.rule_id === "A01") && !both.evidence.some((e) => e.rule_id === "A03L"));
check("T-R7 domain only is normalized", S.normalizeAddress("Ａ.B+tag@ＥＸＡＭＰＬＥ.com").address === "Ａ.B+tag@example.com");
const key = "cd".repeat(16);
const a = S.buildSubmitPayload({ address: "a@example.com", consent: true, idempotency_key: key });
const b = S.buildSubmitPayload({ address: "a@example.com", consent: true, idempotency_key: key });
check("T-R8 the same judgment key is reused", a.payload.idempotency_key === key && b.payload.idempotency_key === key);
check("T-R9 client name filter is not described as a guarantee", fs.readFileSync(path.join(root, "js/stage2-public.js"), "utf8").includes("公開の安全保証ではない"));
check("T-R14 short attention sentence is always the visible one", ui.includes("注意度の数値は、詐欺の確率でも安全の度合いでもありません。") && ui.includes("数値が無いことは安全を意味しません。"));
check("T-R17 privacy sits under the judge button", index.indexOf('id="check"') < index.indexOf('id="privacy_detail"') && index.indexOf('id="privacy_detail"') < index.indexOf('id="history_panel"'));
check("T-R18 warning is next to the address and help is in details", index.indexOf('id="from_warn"') < index.indexOf('id="from_email"') && index.indexOf("<details") < index.indexOf('id="from_help"'));
check("T-O2 metadata is kept and a data scheme is rejected", S.sanitizeName("metadata: keep") === "metadata: keep" && S.sanitizeName("data:text") === null);
const listed = projectReadableList([{
  permitted: true, reviewed: true, basisConfirmed: true, permitAddress: "notice@example.com", address: "notice@example.com",
  exactCount: 40, tieKey: "a", reviewedLabel: "metadata: keep"
}], { syntheticOnly: true, periodKind: "cumulative", minPublish: 20, bands: [{ label: "20–99", min: 20, max: 99, rank: 1 }] });
check("T-O2 list label keeps metadata", listed.items[0].display_label === "metadata: keep");

const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const ignore = fs.readFileSync(path.join(root, ".vercelignore"), "utf8");
check("T-R4 vercel routes 404 tests and tools before the filesystem", vercel.routes.some((r) => r.status === 404 && r.src.includes("tools")) && vercel.routes.some((r) => r.status === 404 && r.src.includes("test")) && vercel.routes.some((r) => r.handle === "filesystem") && ignore.includes("tools") && ignore.includes("js/*.test.mjs") && !ignore.includes("vercel.json"));

function blocked(urlPath) {
  for (const r of vercel.routes) {
    if (r.handle === "filesystem") return false;
    if (r.status === 404 && new RegExp(r.src).test(urlPath)) return true;
  }
  return false;
}
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (blocked(urlPath)) { res.writeHead(404); res.end("not found"); return; }
  const file = path.join(root, urlPath === "/" ? "index.html" : urlPath.replace(/^\//, ""));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("missing"); return; }
  res.writeHead(200); res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
async function status(p) {
  const res = await fetch("http://127.0.0.1:" + port + p);
  await res.arrayBuffer();
  return res.status;
}
check("T-R4 local route check hides tests and tools", (await status("/js/judge.test.mjs")) === 404 && (await status("/tools/browser-audit.mjs")) === 404 && (await status("/")) === 200 && (await status("/terms.html")) === 200 && (await status("/index.html")) === 200 && (await status("/js/judge.js")) === 200);
server.close();

check("sms channel is not a sender type", !index.includes('value="sms"') && !judgeSrc.includes("function parseSms") && run({ channel: "sms", from_email: "09012345678", body: "山田様、本日の連絡です。" }).verdict === "insufficient");
check("email body urls are still read", (run({ body: "山田様、詳細は https://example.com/path です。" }).url_assessments || []).length >= 1);

console.log("\n" + pass + " passed, " + fail + " failed.");
if (fail) { console.log(failures.join("\n")); process.exit(1); }
