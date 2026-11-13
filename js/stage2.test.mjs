// 第2段階の契約テスト。実サーバではない。node js/stage2.test.mjs
import fs from "fs";
import { projectReadableList } from "./stage2-projection.mjs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("./stage2-public.js");
const S = globalThis.MH_STAGE2;

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail ? " :: " + detail : ""));
  console.log("FAIL  " + name + (detail ? " :: " + detail : ""));
}

check("flags stay false", S.productionReady === false && S.privacyVerified === false);
const q = S.buildQueryPayload({ address: "Notice@Example.com", body: "本文", visible_link_url: "https://example.com/a", context_answer: "yes", verdict: "no_clear_signal" });
check("query rejects body and verdict", q.ok === false && q.reason === "forbidden_field" && !JSON.stringify(q).includes("本文"));
const subj = "件名に個人情報サンプル";
const rejected = S.buildSubmitPayload({ address: "a@example.com", consent: true, subject: subj });
check("submit does not accept a subject", rejected.ok === false && rejected.reason === "forbidden_field" && !JSON.stringify(rejected).includes(subj));
const qok = S.buildQueryPayload({ address: "Notice@Example.com" });
check("query payload is address only", qok.ok && qok.payload.address === "Notice@example.com" && qok.payload.flow === "query" && !("body" in qok.payload) && !("display_name" in qok.payload));
check("local-part case is kept", S.normalizeAddress("A.B+tag@Example.com").address === "A.B+tag@example.com");
check("domain only is normalized", S.normalizeAddress("Ａ.B+tag@ＥＸＡＭＰＬＥ.com").address === "Ａ.B+tag@example.com");
check("metadata label is kept and data scheme is not", S.sanitizeName("metadata: keep") === "metadata: keep" && S.sanitizeName("data:text/plain") === null);
const sameKey = "ab".repeat(16);
const once = S.buildSubmitPayload({ address: "a@example.com", consent: true, idempotency_key: sameKey });
const twice = S.buildSubmitPayload({ address: "a@example.com", consent: true, idempotency_key: sameKey });
check("idempotency key is reused when the session supplies it", once.ok && once.payload.idempotency_key === sameKey && twice.payload.idempotency_key === sameKey);
const src = fs.readFileSync(new URL("./stage2-public.js", import.meta.url), "utf8");
check("submit key is not Math.random", !src.includes("Math.random") && src.includes("getRandomValues"));
check("submit needs a separate consent", S.buildSubmitPayload({ address: "a@example.com", consent: false }).reason === "consent_required");
const sub = S.buildSubmitPayload({ address: "a@example.com", display_name: "<b>名</b>", consent: true, otp: "998877" });
check("submit rejects otp", sub.ok === false && !JSON.stringify(sub).includes("998877"));
const subok = S.buildSubmitPayload({ address: "a@example.com", display_name: "架空窓口", genres: ["gov"], tactics: ["unpaid"], consent: true });
check("submit payload has address and choices, not a name", subok.ok && !("display_name" in subok.payload) && subok.payload.genres[0] === "gov" && subok.payload.tactics[0] === "unpaid" && subok.payload.flow === "submit" && !("verdict" in subok.payload));

const adapter = S.createDisabledAdapter();
let fetched = 0;
globalThis.fetch = function () { fetched += 1; throw new Error("fetch"); };
const un = await adapter.query({ address: "a@example.com" });
const posted = await adapter.submit({ address: "a@example.com" });
check("disabled adapter does not fetch", fetched === 0 && un.status === "unavailable" && un.acceptance_increment === 0 && posted.accepted === false);

const session = S.createSession();
const g1 = session.begin();
session.invalidate();
const stale = session.apply(g1, { status: "available", measurement: "synthetic-only", count_band: "500以上", period: { kind: "cumulative", label: "合成" }, names: [{ text: "架空" }] });
check("stale response is dropped", stale.applied === false && session.view().status === "not_queried");
check("exact count band is not shown", S.presentHistory({ status: "available", measurement: "synthetic-only", count_band: "137", period: { kind: "cumulative" } }).status === "unavailable");
check("window is not renamed to cumulative", S.presentHistory({ status: "available", measurement: "synthetic-only", count_band: "20–99", period: { kind: "window", label: "直近7日（累計ではない）" } }).period.kind === "window");
check("window labeled as cumulative is refused", S.presentHistory({ status: "available", measurement: "synthetic-only", count_band: "20–99", period: { kind: "window", label: "累計" } }).status === "unavailable");
check("real available without synthetic flag is refused", S.presentHistory({ status: "available", count_band: "50–199", period: { kind: "cumulative" } }).status === "unavailable");
const shown = S.presentHistory({
  status: "available", measurement: "synthetic-only", productionReady: false, privacyVerified: false,
  count_band: "50–199", acceptance_increment: 0,
  period: { kind: "cumulative", label: "合成データ上の累計概数", start_date: "2026-01-01", as_of_jst: "2026-11-01T00:00:00+09:00" },
  names: [{ text: "架空窓口" }, { text: "<img src=x>" }, { text: "コード998877" }]
});
check("synthetic history keeps a band and drops unsafe names", shown.status === "available" && shown.names.length === 1 && shown.names[0].text === "架空窓口" && shown.acceptance_increment === 0);
check("undisclosed has no number", S.presentHistory({ status: "undisclosed", count_band: "0" }).status === "undisclosed" && !("count_band" in S.presentHistory({ status: "undisclosed", count_band: "0" })));

const hiddenAddr = ["hidden-raw", "@", "example.com"].join("");
const hiddenName = ["架空の", "個人名", "サンプル"].join("");
const otp = ["otp-", "998877"].join("");
const internalKey = ["internal-", "permit-", "XYZ"].join("");
const hmac = ["hmac-", "key-", "do-not-ship"].join("");
const policy = {
  syntheticOnly: true,
  periodKind: "cumulative",
  periodLabel: "合成データ上の累計概数",
  asOfJst: "2026-11-01T00:00:00+09:00",
  minPublish: 20,
  bands: [
    { label: "500以上", min: 500, rank: 3 },
    { label: "100–499", min: 100, max: 499, rank: 2 },
    { label: "20–99", min: 20, max: 99, rank: 1 }
  ]
};
function row(extra) {
  return Object.assign({
    permitted: true, reviewed: true, basisConfirmed: true, permitAddress: extra.address,
    reviewedLabel: "架空窓口（掲載用）", exactCount: 40, tieKey: "m", hmac: hmac, internalId: internalKey
  }, extra);
}
const projected = projectReadableList([
  row({ address: "notice@example.com", exactCount: 601, tieKey: "m", reviewedLabel: "架空窓口（掲載用）" }),
  row({ address: "support@example.net", exactCount: 900, tieKey: "a", reviewedLabel: null }),
  row({ address: "tiny@example.com", exactCount: 7, tieKey: "a" }),
  row({ address: hiddenAddr, permitted: false, exactCount: 800, tieKey: "a", reviewedLabel: hiddenName }),
  row({ address: "news@example.org", exactCount: 44, tieKey: "b", reviewedLabel: "<b>" + otp + "</b>" }),
  row({ address: "other@example.org", exactCount: 50, tieKey: "a", permitAddress: "not-the-same@example.org" })
], policy);
const blob = JSON.stringify(projected);
check("higher internal count comes first and the number stays hidden", projected.items.map((i) => i.published_address).join(",") === "support@example.net,notice@example.com,news@example.org", projected.items.map((i) => i.published_address).join(","));
check("small and unpermitted rows are absent", !blob.includes(hiddenAddr) && !blob.includes(hiddenName) && !blob.includes("tiny@example.com") && !blob.includes(otp) && !blob.includes(hmac) && !blob.includes(internalKey));
check("exact counts are absent", !blob.includes("601") && !blob.includes("900") && !blob.includes("44") && !("exactCount" in (projected.items[0] || {})));
check("unsafe label is hidden and address remains readable", projected.items[2].display_label === null && projected.items[2].published_address === "news@example.org");
check("projection is not a finished server", projected.server === "none" && projected.productionReady === false && projected.privacyVerified === false && projected.implementation === "contract-test-only");
const privateSubject = "個人の件名そのもの";
const withheld = projectReadableList([
  row({ address: "notice@example.com", exactCount: 40, tieKey: "m", subject: privateSubject })
], policy);
check("list contract shows the subject as text", withheld.items[0].subject === privateSubject && withheld.items[0].subject_visibility === "shown" && withheld.items.every((item) => item.subject));
const longSubject = projectReadableList([
  row({ address: "notice@example.com", exactCount: 40, tieKey: "m", subject: "<b>" + "件".repeat(90) })
], policy);
check("list subject is shortened and kept as text", longSubject.items[0].subject === "<b>" + "件".repeat(77) + "…" && longSubject.items[0].subject.length === 81);
const historyWithSubject = S.presentHistory({ status: "available", measurement: "synthetic-only", count_band: "50–199", subject: privateSubject, period: { kind: "cumulative", label: "合成" }, names: [{ text: "架空窓口" }] });
check("history view keeps the subject as text", historyWithSubject.subject_display === privateSubject);
const listPage = fs.readFileSync(new URL("../list.html", import.meta.url), "utf8");
check("list page warns about subjects and has an empty row slot", listPage.includes("件名は利用者が入力したものです。個人情報が含まれないよう注意喚起していますが、完全には防げません") && listPage.includes('id="list_rows"') && !listPage.includes(privateSubject));
check("a higher internal count moves ahead inside the same band", projectReadableList([
  row({ address: "notice@example.com", exactCount: 900, tieKey: "m" }),
  row({ address: "support@example.net", exactCount: 501, tieKey: "a" })
], policy).items.map((i) => i.published_address).join(",") === "notice@example.com,support@example.net");
const tied = projectReadableList([
  row({ address: "first@example.com", exactCount: 40, tieKey: "z" }),
  row({ address: "second@example.com", exactCount: 40, tieKey: "a" })
], policy);
check("equal counts keep the existing order", tied.items.map((i) => i.published_address).join(",") === "first@example.com,second@example.com");
const many = [];
for (let i = 0; i < 31; i++) many.push(row({ address: "n" + i + "@example.com", exactCount: 100 + i, tieKey: "a", reviewedLabel: "名前" + i, subject: "件名" + i }));
const capped = projectReadableList(many, policy);
check("each list stops at 30 and drops the lowest count", capped.items.length === 30 && capped.names.length === 30 && capped.subjects.length === 30 && capped.items[0].published_address === "n30@example.com" && capped.items[29].published_address === "n1@example.com" && !JSON.stringify(capped).includes("n0@example.com") && !("exactCount" in capped.items[0]));
check("an empty list is not reported as zero items", projectReadableList([], policy).status === "empty" && projectReadableList([], policy).items.length === 0 && !JSON.stringify(projectReadableList([], policy)).includes("0件"));
const hiddenMany = [];
for (let i = 0; i < 31; i++) hiddenMany.push({ text: "名前" + i, exactCount: i });
const undisclosed = S.presentHistory({ status: "undisclosed", count_band: "0", names: hiddenMany, subjects: hiddenMany, addresses: hiddenMany });
check("undisclosed history drops every list and any count", undisclosed.status === "undisclosed" && !("names" in undisclosed) && !("subjects" in undisclosed) && !JSON.stringify(undisclosed).includes("名前30") && !JSON.stringify(undisclosed).includes("0件"));
const ranked = S.presentHistory({
  status: "available", measurement: "synthetic-only", count_band: "20–99",
  period: { kind: "cumulative", label: "合成" },
  names: [
    { text: "同数の前", exactCount: 5 },
    { text: "同数の後", exactCount: 5 },
    { text: "多い名前", exactCount: 9 }
  ],
  subjects: [
    { text: "件名小", count_band: "20–99" },
    { text: "件名大", count_band: "500以上" }
  ],
  addresses: hiddenMany.map(function (n, i) { return { address: "a" + i + "@example.com", exactCount: i + 1 }; })
});
check("history lists sort by count, keep ties, and cap at 30", ranked.names.map((n) => n.text).join(",") === "多い名前,同数の前,同数の後" && ranked.subjects.map((s) => s.text).join(",") === "件名大,件名小" && ranked.addresses.length === 30 && ranked.addresses[0].address === "a30@example.com" && !("exactCount" in ranked.names[0]) && !JSON.stringify(ranked).includes("a0@example.com"));
check("sender domain is normalized and invalid addresses are omitted", S.domainFromAddress(" User@Example.COM. ").text === "example.com" && S.domainFromAddress("") === null && S.domainFromAddress("not-an-email") === null && S.domainFromAddress("a@b") === null);
const senderDomains = [];
for (let i = 0; i < 31; i++) senderDomains.push({ address: "u" + i + "@d" + i + ".example", exactCount: i + 1 });
senderDomains.push({ address: "later@d0.example", exactCount: 1 });
const domainHistory = S.presentHistory({
  status: "available", measurement: "synthetic-only", count_band: "20–99",
  period: { kind: "cumulative", label: "合成" },
  domains: senderDomains
});
check("sender domains sort, cap at 30, and keep a tie in input order", domainHistory.domains.length === 30 && domainHistory.domains[0].domain === "d30.example" && domainHistory.domains[29].domain === "d0.example" && !domainHistory.domains.some((d) => d.domain === "d1.example") && !("exactCount" in domainHistory.domains[0]));
const tiedDomains = S.presentHistory({
  status: "available", measurement: "synthetic-only", count_band: "20–99",
  period: { kind: "cumulative", label: "合成" },
  domains: [{ domain: "a.example", exactCount: 4 }, { domain: "b.example", exactCount: 4 }]
});
check("equal domain counts stay in the existing order", tiedDomains.domains.map((d) => d.domain).join(",") === "a.example,b.example");
const secretUrl = "https://user:secretpass@Evil.Example/hidden/path?q=1#frag";
const linkRows = [
  row({ address: "notice@example.com", exactCount: 40, linkHosts: [secretUrl, secretUrl, "http://192.0.2.1/admin", "https://short.example/x"] }),
  row({ address: "other@example.net", exactCount: 30, linkHosts: ["https://phish.test/a"] })
];
const linkList = projectReadableList(linkRows, policy);
check("body link domains are hosts only, deduped per message, and not links", linkList.link_domains.map((d) => d.text).join(",") === "evil.example,192.0.2.1,short.example,phish.test" && linkList.link_domains[0].count_band === "20–99" && !JSON.stringify(linkList.link_domains).includes("secretpass") && !JSON.stringify(linkList.link_domains).includes("/hidden") && !JSON.stringify(linkList.link_domains).includes("q=1") && linkList.domains.map((d) => d.domain).join(",") === "example.com,example.net");
const manyHosts = [];
for (let i = 0; i < 31; i++) manyHosts.push(row({ address: "h" + i + "@example.com", exactCount: 20 + i, linkHosts: ["https://h" + i + ".example/path"] }));
const cappedHosts = projectReadableList(manyHosts, policy);
check("body link domains stop at 30", cappedHosts.link_domains.length === 30 && cappedHosts.link_domains[0].text === "h30.example" && !JSON.stringify(cappedHosts.link_domains).includes("h0.example") && !JSON.stringify(cappedHosts.link_domains).includes("/path"));
const closedLinks = S.presentHistory({ status: "undisclosed", link_domains: [{ host: secretUrl, exactCount: 9 }] });
check("undisclosed history does not show link domains", closedLinks.status === "undisclosed" && !("link_domains" in closedLinks) && !JSON.stringify(closedLinks).includes("secretpass"));
const uiSrc = fs.readFileSync(new URL("./ui.js", import.meta.url), "utf8");
check("link domain rows are plain text", uiSrc.includes('paintList(box, "本文内のリンク先ドメイン"') && !/list_link_domains[\s\S]{0,200}<a/.test(listPage) && listPage.includes("リンクではありません。アクセスしないでください。"));
check("a 7-day window is not called cumulative", projectReadableList([], { syntheticOnly: true, periodKind: "window", periodLabel: "直近7日（累計ではない）", minPublish: 20, bands: policy.bands }).period_kind === "window");

const publicFiles = ["index.html", "list.html", "js/stage2-public.js", "js/ui.js", "css/app.css"];
const publicText = publicFiles.map((f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8")).join("\n");
[hiddenAddr, hiddenName, otp, hmac, internalKey, "601"].forEach((secret) => {
  check("public file hides " + secret, !publicText.includes(secret));
});
const visiblePages = ["index.html", "list.html", "js/ui.js", "css/app.css"].map((f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8")).join("\n");
check("pages do not mention an exact count field", !visiblePages.includes("exactCount"));
check("pages do not load the projection or the test", !publicText.includes("stage2-projection") && !publicText.includes("stage2.test"));
check("list page states unavailable and the warning is not collapsed", fs.readFileSync(new URL("../list.html", import.meta.url), "utf8").includes("現在一覧を取得できません") && fs.readFileSync(new URL("../list.html", import.meta.url), "utf8").includes("掲載は不審なアドレスであることを意味しません") && !fs.readFileSync(new URL("../list.html", import.meta.url), "utf8").includes("<details"));
check("public script has no network or storage call", !/fetch\s*\(|localStorage|XMLHttpRequest|sendBeacon/.test(fs.readFileSync(new URL("./stage2-public.js", import.meta.url), "utf8")));

console.log("\n" + pass + " passed, " + fail + " failed.");
if (fail) {
  console.log(failures.join("\n"));
  process.exit(1);
}
