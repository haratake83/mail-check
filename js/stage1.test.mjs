// 第1段階の追加テスト。既存 v0.8 の危険度・verdict を変えていないことも固定する。
// node js/stage1.test.mjs
import fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("./protocol-data.js");
require("./judge.js");
const judge = globalThis.MH_judge;
const base = globalThis.MH_PROTOCOL;

const B = (o) => ({ web: [], send: [], pending: [], anchors: [], e03r: false, state: "verified", a11: [], ...o });
const FIX = {
  ...base,
  brands: [B({ id: "brandx", label: "ブランドX", names: ["ブランドX"], web: ["~brand.example"], send: ["notice.brand.example"], anchors: ["brand"] })],
  shorteners: ["short.example"],
  tracking: [],
  redirects: [],
  scopedRoutes: [],
};
const email = { display_name: "", from_email: "notice@example.com", context_answer: "unknown", channel: "email", visible_link_url: "" };

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail ? " :: " + detail : ""));
  console.log("FAIL  " + name + (detail ? " :: " + detail : ""));
}
function tags(r) { return (r.purpose_assessment || []).map((p) => p.tag); }
function ids(r) { return r.evidence.map((e) => e.rule_id).join(",") || "-"; }
function noObs(r) {
  return !r.evidence.some((e) => String(e.rule_id).startsWith("OBS_"))
    && !r.composite_rules.some((c) => String(c.rule_id).startsWith("OBS_"))
    && !(r.auxiliary_flags || []).some((a) => String(a).startsWith("OBS_"));
}
function run(body, extra, proto) {
  return judge({ ...email, body, ...(extra || {}) }, proto ? { protocol: proto } : undefined);
}

// --- 研究者レビューの修正必須 ---
const spoof = run("ブランドXです。https://login.brand.example.attacker.tld/in を確認してください。", { display_name: "ブランドX", from_email: "notice@brand.example" }, FIX);
const spoofUrl = (spoof.url_assessments || []).find((a) => a.host === "login.brand.example.attacker.tld");
check("spoof danger unchanged M", spoof.danger_level === "M" && spoof.verdict === "needs_review", spoof.danger_level + "/" + spoof.verdict);
check("spoof evidence stays T03", ids(spoof) === "T03", ids(spoof));
check("spoof not official_web", (spoof.namespace_assessments || []).filter((x) => x.role === "url").every((x) => x.relation !== "official_web"));
check("spoof ledger none", spoofUrl && spoofUrl.ledger_match === "none");
check("spoof real host kept", spoofUrl && spoofUrl.boundary.real_host === "login.brand.example.attacker.tld");
check("spoof etld1 unknown not brand.example", spoofUrl && spoofUrl.boundary.etld1 === null && spoofUrl.boundary.approx_suffix_not_operator !== "brand.example");
check("spoof not called operator", spoofUrl && spoofUrl.boundary.operator_id === null && spoofUrl.boundary.used_as_operator === false && spoofUrl.boundary.same_operator === false);
check("spoof note rejects label/etld1 as official", spoofUrl && /公式にしません/.test(spoofUrl.match_note) && !/安全です/.test(spoofUrl.match_note));

const allowed = run("ブランドXです。https://login.brand.example/in を確認してください。", { display_name: "ブランドX", from_email: "a@notice.brand.example" }, FIX);
const allowedUrl = (allowed.url_assessments || []).find((a) => a.host === "login.brand.example");
check("allowed subdomain is visible-string match only", allowedUrl && allowedUrl.ledger_match === "visible_string_only" && /見える文字列/.test(allowedUrl.match_note) && /確認していません/.test(allowedUrl.match_note));
check("allowed match is not safety", allowedUrl && !/安全です|確認済み|公式と確認/.test(allowedUrl.match_note + allowedUrl.unknowns.join("")));

const tenants = run("比較用です。 https://tenant-a.github.io/x と https://tenant-b.github.io/y");
const ta = (tenants.url_assessments || []).find((a) => a.host === "tenant-a.github.io");
const tb = (tenants.url_assessments || []).find((a) => a.host === "tenant-b.github.io");
check("private tenants keep distinct real hosts", ta && tb && ta.boundary.real_host !== tb.boundary.real_host);
check("private tenants share no operator id", ta && tb && ta.boundary.operator_id === null && tb.boundary.operator_id === null);
check("private suffix is not used as operator", ta && tb && ta.boundary.used_as_operator === false && tb.boundary.used_as_operator === false && ta.boundary.same_operator === false && tb.boundary.same_operator === false);
check("simplified suffix is labeled not-operator", ta && ta.boundary.approx_suffix_not_operator === "github.io" && ta.boundary.etld1_status === "unknown");
check("private limitation is reported", (tenants.url_limits || []).some((t) => t.includes("private") && t.includes("同一運営とは判断しません")));
check("tenants not strong from structure", tenants.danger_level !== "S", tenants.danger_level);

const storage = run("共有ストレージのファイルです。パスワードを入力してください。\nhttps://example.com/storage/doc");
check("storage+password is needs_review or stronger", storage.verdict === "needs_review" || storage.verdict === "strong_suspicion", storage.verdict);
check("storage danger stays M from A01", storage.danger_level === "M" && ids(storage) === "A01", storage.danger_level + " " + ids(storage));
check("legit host abuse unknown present", (storage.url_limits || []).some((t) => t.includes("正規のホストに見えても") && t.includes("公開ストレージ")));
check("storage structure is not safety", (storage.url_limits || []).every((t) => !/安全です/.test(t)));
const storageUrl = (storage.url_assessments || []).find((a) => a.host === "example.com");
check("storage url not fetched", storageUrl && storageUrl.fetched === false && storageUrl.structure_not_conclusive === true);

const matched = run("ブランドXです。パスワードをこちらに入力してください。 https://files.brand.example/share/form", { display_name: "ブランドX", from_email: "a@notice.brand.example" }, FIX);
const matchedUrl = (matched.url_assessments || []).find((a) => a.host === "files.brand.example");
check("matched host still needs_review+", matched.verdict === "needs_review" || matched.verdict === "strong_suspicion", matched.verdict + " " + ids(matched));
check("matched score unchanged A01,A04", ids(matched) === "A01,A04" && matched.danger_level === "M", ids(matched) + " " + matched.danger_level);
check("matched ledger is visible string only", matchedUrl && matchedUrl.ledger_match === "visible_string_only" && /見える文字列上の一致/.test(matchedUrl.match_note));
check("matched host abuse limit shown", (matched.url_limits || []).some((t) => t.includes("乗っ取られたアカウント")));
check("path tenants cannot be proved", (matched.url_limits || []).some((t) => t.includes("パス")));
check("href unavailable is stated", (matched.url_limits || []).some((t) => t.includes("href")));

const zipNeg = run("ZIPは添付しません。");
const macNeg = run("マクロを有効にしないで。");
const bothNeg = run("ZIPは添付しません。マクロを有効にしないで。");
check("zip negation has no purpose tag", tags(zipNeg).join(",") === "unknown" && zipNeg.danger_level === "N", tags(zipNeg).join(","));
check("macro negation is not an execution tag", tags(macNeg).indexOf("malware_or_execution") < 0, tags(macNeg).join(","));
check("macro negation keeps pre-existing B07", ids(macNeg) === "B07" && macNeg.danger_level === "W" && macNeg.verdict === "needs_review", ids(macNeg) + " " + macNeg.danger_level);
check("combined negation is not execution tag and not strong", tags(bothNeg).indexOf("malware_or_execution") < 0 && bothNeg.danger_level !== "S");

const quote = run("詐欺メールでは「マクロを有効にしてください」と書かれます。");
const caution = run("ご注意ください。マクロは有効にしないでください。");
check("quotation is not an execution tag", tags(quote).indexOf("malware_or_execution") < 0);
check("quotation keeps pre-existing B07", ids(quote) === "B07" && quote.danger_level === "W", ids(quote));
check("caution is not an execution tag", tags(caution).indexOf("malware_or_execution") < 0 && caution.danger_level === "N", tags(caution).join(",") + " " + caution.danger_level);

const words = run("マクロ コマンド ZIP powershell デバイスコード OAuth キャンペーン ポイント");
check("word list alone gives unknown", tags(words).join(",") === "unknown" && words.danger_level === "N" && words.verdict === "no_clear_signal");

const dcWord = run("資料にデバイスコードという語が出てきます。");
const dcIn = run("デバイスコードを入力してください。", { context_answer: "yes" });
const dcNo = run("デバイスコードを入力してください。", { context_answer: "no" });
const dcUnk = run("デバイスコードを入力してください。", { context_answer: "unknown" });
check("device-code mention has no tag and is not strong", tags(dcWord).join(",") === "unknown" && dcWord.danger_level !== "S");
for (const [name, r] of [["yes", dcIn], ["no", dcNo], ["unknown", dcUnk]]) {
  check("device-code input " + name + " is credential not malware", tags(r).indexOf("credential_or_payment") >= 0 && tags(r).indexOf("malware_or_execution") < 0, tags(r).join(","));
  check("device-code input " + name + " is not strong", r.danger_level === "M" && r.verdict === "needs_review" && ids(r) === "A06", r.danger_level + " " + ids(r));
  const cred = r.purpose_assessment.find((p) => p.tag === "credential_or_payment");
  check("device-code input " + name + " stays after context and is not infection", cred && /感染ではなく/.test(cred.explanation) && cred.rule_ids.indexOf("A06") >= 0);
}
check("context does not change device-code danger", dcIn.danger_level === dcNo.danger_level && dcNo.danger_level === dcUnk.danger_level);

const oauth = run("OAuthの同意画面でコードを入力してください。");
const oauthWord = run("OAuthとは認可の仕組みです。");
const oauthTag = (oauth.purpose_assessment || []).find((p) => p.tag === "credential_or_payment");
check("oauth inducement is credential without new score", oauth.danger_level === "N" && oauth.verdict === "no_clear_signal" && oauthTag && oauthTag.rule_ids.indexOf("OBS_OAUTH") >= 0 && tags(oauth).indexOf("malware_or_execution") < 0, oauth.danger_level + " " + tags(oauth).join(","));
check("oauth mention alone has no credential tag", tags(oauthWord).indexOf("credential_or_payment") < 0 && oauthWord.danger_level === "N");
check("oauth observational id is not evidence", noObs(oauth));

const app = run("App Storeから公式アプリをインストールしてください。手続きはそれだけです。");
check("app-store guidance is not strong and not execution tag", app.danger_level !== "S" && tags(app).indexOf("malware_or_execution") < 0, app.danger_level + " " + tags(app).join(","));
check("app-store guidance keeps pre-existing A05", ids(app) === "A05" && app.danger_level === "M", ids(app) + " " + app.danger_level);

const zipWord = run("ZIPを確認しました。");
check("zip word alone is not strong and has no execution tag", zipWord.danger_level === "N" && tags(zipWord).join(",") === "unknown");

const click = run("エラーを解消するため、powershell を貼り付けて実行してください。");
const clickTag = (click.purpose_assessment || []).find((p) => p.tag === "malware_or_execution");
check("clickfix is execution tag without strong", click.danger_level === "N" && click.verdict === "no_clear_signal" && clickTag && clickTag.rule_ids.indexOf("OBS_CLICKFIX") >= 0, click.danger_level + " " + tags(click).join(","));
check("clickfix text does not declare infection", clickTag && /感染は、この入力からは確認できません/.test(clickTag.explanation) && !/マルウェアです|感染しています/.test(clickTag.explanation));
check("clickfix id is not a score", noObs(click));
check("clickfix keeps the four verdicts and adds a lead ahead of the grey result", click.display.lead && /先に読んでください/.test(click.display.lead.headline) && /4つの判定区分と点数は変えていません/.test(click.display.lead.note) && /判断できませんでした/.test(click.display.headline));

for (const ctx of ["yes", "no", "unknown"]) {
  const z = run("パスワード付きZIPを開いて実行してください。", { context_answer: ctx });
  const zt = (z.purpose_assessment || []).find((p) => p.tag === "malware_or_execution");
  check("zip execute " + ctx + " keeps warning and is not strong", z.danger_level === "N" && zt && /断定したものではありません/.test(zt.explanation), z.danger_level);
}
check("zip execute yes does not clear the tag", tags(run("パスワード付きZIPを開いて実行してください。", { context_answer: "yes" })).indexOf("malware_or_execution") >= 0);
const reassure = run("心配ありません、ZIPを開いて実行してください。");
check("reassurance does not cancel a separate execute request", tags(reassure).indexOf("malware_or_execution") >= 0 && reassure.danger_level !== "S" && reassure.display.lead, tags(reassure).join(",") + " " + reassure.danger_level);
check("bare zip execution is not described as password-protected", !/パスワード付き/.test((reassure.purpose_assessment.find((p) => p.tag === "malware_or_execution") || {}).explanation || "") && /アプリやコマンド等の実行を促す/.test(JSON.stringify(reassure.display.lead)));
const zipView = run("添付のZIPを開いてご確認ください。");
const zipOpen = run("ZIPを開いてください。");
check("ordinary zip viewing is not an execution lead", tags(zipView).indexOf("malware_or_execution") < 0 && !zipView.display.lead && zipView.danger_level !== "S", tags(zipView).join(",") + " " + (zipView.display.lead && zipView.display.lead.headline));
check("zip open without execute is not an execution lead", tags(zipOpen).indexOf("malware_or_execution") < 0 && !zipOpen.display.lead);
check("password zip request keeps the non-assertion that matches the evidence", /パスワード付き/.test((run("パスワード付きZIPを開いて実行してください。").purpose_assessment.find((p) => p.tag === "malware_or_execution") || {}).explanation || ""));
check("true macro negation stays untagged", tags(run("マクロを有効にしないでください。")).indexOf("malware_or_execution") < 0);
check("citation of an execute request stays untagged", tags(run("詐欺メールでは「ZIPを開いて実行してください」と書かれます。")).indexOf("malware_or_execution") < 0);
const splitNl = run("パスワード付きZIPを\n開いて実行してください。");
const splitComma = run("パスワード付きZIPを、開いて実行してください。");
check("newline-split execute request is tagged and not strong", tags(splitNl).indexOf("malware_or_execution") >= 0 && splitNl.danger_level !== "S", tags(splitNl).join(",") + " " + splitNl.danger_level);
check("comma-split execute request is tagged", tags(splitComma).indexOf("malware_or_execution") >= 0 && splitComma.danger_level !== "S");
const apk = run("公式アプリのAPKをインストールしてください。");
const profile = run("公式アプリです。この構成プロファイルをインストールしてください。");
check("official-app wording does not hide an apk install", tags(apk).indexOf("malware_or_execution") >= 0 && apk.danger_level !== "S" && (apk.purpose_assessment.find((p) => p.tag === "malware_or_execution").rule_ids || []).indexOf("OBS_APK") >= 0, tags(apk).join(",") + " " + apk.danger_level + " " + ids(apk));
check("configuration profile install is an execution feature and not strong", tags(profile).indexOf("malware_or_execution") >= 0 && profile.danger_level !== "S" && (profile.purpose_assessment.find((p) => p.tag === "malware_or_execution").rule_ids || []).indexOf("OBS_PROFILE") >= 0, ids(profile) + " " + profile.danger_level);
check("bare official-app install is not relabeled as execution", tags(run("公式アプリをインストールしてください。")).indexOf("malware_or_execution") < 0);

const ad = run("春のキャンペーンです。新商品をご購入ください。");
const adTag = (ad.purpose_assessment || []).find((p) => p.tag === "advertising_or_bulk");
check("ad request is a tag without score", ad.danger_level === "N" && ad.verdict === "no_clear_signal" && adTag && /未承諾の広告かどうかは、この入力だけでは確認できません/.test(adTag.explanation), ad.danger_level);
check("ad tag does not say spam confirmed", adTag && !/スパム確定/.test(adTag.explanation));
check("points and url alone are not an ad", tags(run("ポイントが付きます。https://example.com/p")).indexOf("advertising_or_bulk") < 0);
check("unsubscribe alone is not an ad", tags(run("配信停止は設定画面から行ってください。")).indexOf("advertising_or_bulk") < 0);

const js = run("文字列 javascript:alert(1) は実行しないでください。");
const jsItem = (js.url_assessments || []).find((a) => a.source === "literal_scheme" && a.display.indexOf("javascript:") === 0);
check("javascript is not a navigable url", js.danger_level === "N" && jsItem && jsItem.executed === false && jsItem.fetched === false && jsItem.display === "javascript:＊＊＊", JSON.stringify(jsItem));
check("javascript payload is redacted", !JSON.stringify(js.url_assessments).includes("alert(1)"));
check("javascript not in urls_parsed hosts", !(js.urls_parsed || []).some((u) => /javascript/i.test(u.host || "")));

const data = run("data:text/plain,HelloPayloadSecret という文字列です。");
const dataItem = (data.url_assessments || []).find((a) => a.display.indexOf("data:") === 0);
check("data url is not loaded", dataItem && dataItem.fetched === false && dataItem.display === "data:＊＊＊" && !JSON.stringify(data.url_assessments).includes("HelloPayloadSecret"));

const tokenBody = "本文です。 https://example.com/a?token=SuperSecretTokenValue";
const token = run(tokenBody);
const plain = run("本文です。 https://example.com/a");
check("query token is redacted everywhere in the result", !JSON.stringify(token).includes("SuperSecretTokenValue"));
check("query token does not change score", token.danger_level === plain.danger_level && token.verdict === plain.verdict && ids(token) === ids(plain), ids(token) + " vs " + ids(plain));
check("url display stops at the host", (token.url_assessments || []).some((a) => a.host === "example.com" && a.display === "https://example.com/＊＊＊") && !(token.url_assessments || []).some((a) => /\/a\?/.test(a.display || "")));
const pathSecrets = ["Ab12Cd34Ef56", "ab-cd.ef~12", "jsessionid", "abcDEF123", "shortTok", "fragSecret", "s3cr3t", "hxxpSecret"];
const pathCase = run("再設定 https://example.com/r/Ab12Cd34Ef56 と https://example.com/reset/ab-cd.ef~12;jsessionid=abcDEF123?t=shortTok#fragSecret と example.com/reset/ab-cd?token=s3cr3t と hxxps://example.com/reset/hxxpSecret");
const pathJson = JSON.stringify(pathCase);
pathSecrets.forEach((secret) => check("path secret absent from result: " + secret, !pathJson.includes(secret)));
check("scheme-less url still exposes only the host", (pathCase.url_assessments || []).some((a) => a.host === "example.com" && a.display.indexOf("example.com") === 0 && a.display.indexOf("/＊＊＊") > 0));
const metaOnly = run("項目は metadata: keepThisWord です。");
check("metadata colon is not a data scheme", !(metaOnly.url_assessments || []).some((a) => a.source === "literal_scheme" || String(a.display || "").indexOf("data:") === 0));
check("metadata text is not copied into the result", !JSON.stringify(metaOnly).includes("keepThisWord"));
const dataReal = run("参照 data:text/plain,RealDataSecret です。");
check("a real data scheme is still redacted", (dataReal.url_assessments || []).some((a) => a.display === "data:＊＊＊") && !JSON.stringify(dataReal).includes("RealDataSecret"));

const userinfo = run("確認 https://user:secretpass@example.com/a です。");
check("userinfo secret redacted", !JSON.stringify(userinfo).includes("secretpass"));
check("userinfo keeps pre-existing A12 and is not strong", ids(userinfo) === "A12" && userinfo.danger_level === "M" && userinfo.verdict === "needs_review", ids(userinfo) + " " + userinfo.danger_level);

const ip = run("山田様、案内の文字列です。 https://192.0.2.1/info");
const ipUrl = (ip.url_assessments || []).find((a) => a.host === "192.0.2.1");
check("ip host alone is not strong", ip.danger_level === "N" && ipUrl && ipUrl.features.some((f) => f.id === "ip_host") && /悪性と判断しません/.test(ipUrl.features.map((f) => f.text).join("")), ip.danger_level);

const puny = run("山田様、案内の文字列です。 https://xn--r8jz45g.example/a");
const punyUrl = (puny.url_assessments || []).find((a) => (a.host || "").indexOf("xn--") >= 0);
check("punycode alone is not strong", puny.danger_level === "N" && punyUrl && punyUrl.features.some((f) => f.id === "punycode"), puny.danger_level + " " + (punyUrl && punyUrl.host));

const cta = run("記事は https://example.com/news です。\nこちらのボタンを押してください。");
check("article url does not erase the other CTA", ids(cta) === "A04" && cta.danger_level === "W" && (cta.unmatched_ctas || []).length >= 1, ids(cta));
check("article url still assessed", (cta.url_assessments || []).some((a) => a.host === "example.com"));

function allStrings(value, out) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach(function (v) { allStrings(v, out); });
  else if (value && typeof value === "object") Object.keys(value).forEach(function (k) { allStrings(value[k], out); });
  return out;
}
const glued = run("powershellを詳細はexample.com/r/AbCd12から貼り付けて実行してください。");
const otp = run("認証コード482913をexample.com/r/AbCd12で入力してください。");
const alnum = run("認証コードAb9xQ2を入力してください。");
for (const [name, result, secret] of [["glued-path", glued, "AbCd12"], ["otp-span", otp, "482913"], ["otp-path", otp, "AbCd12"], ["alnum-code", alnum, "Ab9xQ2"]]) {
  check("secret absent from every output string: " + name, !allStrings(result, []).some(function (s) { return s.indexOf(secret) >= 0; }));
}
check("glued url keeps the host and the execution warning in JSON", allStrings(glued, []).some(function (s) { return s.indexOf("example.com") >= 0; }) && glued.display.lead && /アプリやコマンド等の実行を促す/.test(JSON.stringify(glued.display.lead)));
check("clickfix warning survives in the JSON result", /先に読んでください/.test(JSON.stringify(click.display)) && /アプリやコマンド等の実行を促す/.test(JSON.stringify(click)));
check("statistics is null not zero", spoof.statistics === null && storage.statistics === null && ad.statistics === null);
check("no assessment claims same operator", [spoof, tenants, matched, storage].every((r) => (r.url_assessments || []).every((a) => a.boundary.same_operator === false && a.boundary.operator_id == null)));
check("observational ids never enter the score", [spoof, storage, ad, click, oauth, app, macNeg].every(noObs));
check("safety_guarantees stay false", [spoof, storage, ad, click, js].every((r) => r.safety_guarantees === false));
check("verdicts stay inside the four", [spoof, storage, ad, zipNeg, macNeg, js].every((r) => ["strong_suspicion", "needs_review", "no_clear_signal", "insufficient"].indexOf(r.verdict) >= 0));
check("unknown purpose says absence is not safety", (zipNeg.purpose_assessment[0].explanation || "").includes("安全である証明ではありません"));
check("no tag is not a probability", (ad.purpose_assessment || []).every((p) => !/確率|%/.test(p.explanation)));

// --- 画面文言と、統計A/B/Cを実装していないこと ---
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("./ui.js", import.meta.url), "utf8");
const judgeSrc = fs.readFileSync(new URL("./judge.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
check("from label and warning are present", html.includes("メールに記載されたアドレス") && html.includes("あなた自身のアドレス（宛先／To）") && html.includes("notice@example.com"));
check("from help is present", html.includes("『差出人／From』") && html.includes("見つからなければ無理に操作しないでください。"));
check("from can be spoofed is stated", html.includes("表示名やFromも偽装されるため、本物とは確認できません。"));
check("plain privacy wording", html.includes("お使いの端末（ブラウザ）の中だけで判定します。本文やURLが当サイトに送られたり、保存されたりすることはありません。") && html.includes("入力した内容は含まれません。") && html.includes("画面の入力は「入力を消す」ボタンですぐ消せます。") && html.includes("ページを閉じてください。"));
check("planned stats sentence follows the privacy explanation", html.indexOf("ページを閉じてください。") < html.indexOf("ドメインは現在どこにも集めていません") && html.includes("本文とURLは統計に使いません。") && html.includes("本文内のリンク先ドメイン"));
check("judging shows the terms consent above the button", html.indexOf("判定すると、") < html.indexOf('id="check"') && html.includes("利用規約</span>に同意したものとみなします。") && html.includes('class="terms-public" href="terms.html" hidden'));
check("body note sits under the paste hint", html.indexOf("本文をそのまま貼り付けてください。") < html.indexOf("貼り付けた本文はこの端末の中だけで判定し、保存も送信もしません。ページを閉じると消えます。") && html.indexOf("貼り付けた本文はこの端末の中だけで判定し、保存も送信もしません。ページを閉じると消えます。") < html.indexOf('id="body"'));
check("old privacy jargon is gone", !html.includes("送り出す処理を含みません") && !html.includes("完全消去を保証するものではありません") && !html.includes("未監査です") && !html.includes("完全削除"));
check("stats unavailable sentence", html.includes("全利用者を対象とする送信元名別・アドレス別の統計は、現在提供していません。"));
check("stats options A/B/C are not implemented in the page", !html.includes("この端末のみ") && !html.includes("この端末での判定回数") && !ui.includes("この端末での判定回数"));
check("page does not claim complete deletion", !html.includes("完全削除") && !html.includes("名前/アドレスだけ") && !html.includes("匿名化済み"));
check("ui does not linkify result urls", !/createElement\(\s*"a"/.test(ui) && ui.includes("textContent"));
check("purpose fixed sentence is in the ui", ui.includes("タグがないことは、安全である証明ではありません。"));
check("url section says it did not visit", ui.includes("リンク先には当サイトからもアクセスしていません。"));
const code = stripComments([judgeSrc, ui, html, css, fs.readFileSync(new URL("./protocol-data.js", import.meta.url), "utf8")].join("\n"));
const banned = ["fetch(", "XMLHttpRequest", "sendBeacon", "localStorage", "sessionStorage", "indexedDB", "WebSocket", "gtag(", "googletagmanager"];
banned.forEach((w) => check("production code has no " + w, !code.includes(w)));
check("email only, no sms sender choice", !html.includes('value="sms"') && !ui.includes("SMSの送信元") && html.includes("メールアドレスのメールだけを判定します"));
check("separate link field is gone", !html.includes("visible_link_url") && !html.includes("リンクをコピー") && !html.includes("リンクのアドレスをコピー") && !ui.includes("visible_link_url") && html.includes("本文に含まれるリンクだけを文字列として調べ、開きません。"));
const separate = run("本文にはURLがありません。", { visible_link_url: "https://evil.example/secret-path" });
check("a supplied link field is not judged", !JSON.stringify(separate.url_assessments || []).includes("evil.example") && !JSON.stringify(separate.urls_parsed || []).includes("evil.example"));
const inBody = run("詳細は https://example.com/only-in-body です。");
check("a url written in the body is still read and not fetched", (inBody.url_assessments || []).some((a) => a.host === "example.com" && a.fetched === false && a.source !== "user_declared"));
const buttonOnly = run("山田様、口座が停止されます。こちらのボタンからログインしてください。", { display_name: "テスト銀行" });
check("button only mail is not treated as a pasted url and keeps a limit", buttonOnly.verdict !== "strong_suspicion" && (buttonOnly.url_assessments || []).every((a) => a.fetched === false) && ui.includes("ボタンや画像、QRコードの本当の行き先は見ていません"));
const urgentButton = run("山田様、今すぐこちらのボタンを押してください。");
check("urgent button only stays inside the four verdicts", ["strong_suspicion", "needs_review", "no_clear_signal", "insufficient"].indexOf(urgentButton.verdict) >= 0 && !(urgentButton.url_assessments || []).some((a) => a.fetched));
check("the page does not ask people to paste a separate link", !html.includes("リンク先を貼って") && !html.includes("長押しして") && html.includes("本文（本文中のURLを含む）"));
check("subject field sits under the name", html.indexOf('id="display_name"') < html.indexOf('for="subject"') && html.indexOf('id="subject_warn"') < html.indexOf('id="subject"') && html.indexOf('id="subject"') < html.indexOf('id="from_email"') && html.includes("このサイトの判定に、それらの情報は不要です"));
const benign = "山田様、本日の連絡です。";
const withoutSubject = run(benign);
const withSubject = run(benign, { subject: "ギフトカードの番号を送ってください。<img src=x>" });
check("subject is display only and does not change the verdict", withoutSubject.verdict === withSubject.verdict && withoutSubject.danger_level === withSubject.danger_level && withSubject.subject_used_in_score === false && withSubject.subject_display === "ギフトカードの番号を送ってください。<img src=x>");
check("empty subject is labeled and a long subject is shortened", run(benign, { subject: "   " }).subject_display === "（件名なし）" && run(benign, { subject: "あ".repeat(81) }).subject_display === "あ".repeat(80) + "…");
check("subject is drawn with textContent", ui.includes('el("p", "summary-subject"') && ui.includes("history_subject") && ui.includes("textContent") && !ui.includes("innerHTML"));

console.log("\n" + pass + " passed, " + fail + " failed.");
console.log("PREEXISTING_UNFIXED (locked, not claimed as fixed):");
console.log("- B07 still fires on マクロを有効にしないで / 引用中のマクロを有効にしてください (danger W). Purpose tag does not follow it.");
console.log("- A05 still fires on App Store の公式アプリ導入案内 (danger M, not S). Purpose tag does not call it execution.");
console.log("- A04 still fires when こちら and the URL are in different sentences.");
console.log("UNVERIFIED in this file: live browser network, storage, CSP, screenshots.");
if (fail) {
  console.log("\nFailed:\n- " + failures.join("\n- "));
  process.exit(1);
}
