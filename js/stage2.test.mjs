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
const subok = S.buildSubmitPayload({ address: "a@example.com", display_name: "架空窓口", consent: true });
check("submit payload has name and address only", subok.ok && subok.payload.display_name === "架空窓口" && subok.payload.flow === "submit" && !("verdict" in subok.payload));

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
check("bands descend and within a band exact count is not the sort", projected.items.map((i) => i.published_address).join(",") === "support@example.net,notice@example.com,news@example.org", projected.items.map((i) => i.published_address).join(","));
check("small and unpermitted rows are absent", !blob.includes(hiddenAddr) && !blob.includes(hiddenName) && !blob.includes("tiny@example.com") && !blob.includes(otp) && !blob.includes(hmac) && !blob.includes(internalKey));
check("exact counts are absent", !blob.includes("601") && !blob.includes("900") && !blob.includes("44") && !("exactCount" in (projected.items[0] || {})));
check("unsafe label is hidden and address remains readable", projected.items[2].display_label === null && projected.items[2].published_address === "news@example.org");
check("projection is not a finished server", projected.server === "none" && projected.productionReady === false && projected.privacyVerified === false && projected.implementation === "contract-test-only");
check("swapped exact counts do not change the within-band order", projectReadableList([
  row({ address: "notice@example.com", exactCount: 900, tieKey: "m" }),
  row({ address: "support@example.net", exactCount: 501, tieKey: "a" })
], policy).items.map((i) => i.published_address).join(",") === "support@example.net,notice@example.com");
check("a 7-day window is not called cumulative", projectReadableList([], { syntheticOnly: true, periodKind: "window", periodLabel: "直近7日（累計ではない）", minPublish: 20, bands: policy.bands }).period_kind === "window");

const publicFiles = ["index.html", "list.html", "js/stage2-public.js", "js/ui.js", "css/app.css"];
const publicText = publicFiles.map((f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8")).join("\n");
[hiddenAddr, hiddenName, otp, hmac, internalKey, "601", "exactCount"].forEach((secret) => {
  check("public file hides " + secret, !publicText.includes(secret));
});
check("pages do not load the projection or the test", !publicText.includes("stage2-projection") && !publicText.includes("stage2.test"));
check("list page states unavailable and the warning is not collapsed", fs.readFileSync(new URL("../list.html", import.meta.url), "utf8").includes("現在一覧を取得できません") && fs.readFileSync(new URL("../list.html", import.meta.url), "utf8").includes("掲載は不審なアドレスであることを意味しません") && !fs.readFileSync(new URL("../list.html", import.meta.url), "utf8").includes("<details"));
check("public script has no network or storage call", !/fetch\s*\(|localStorage|XMLHttpRequest|sendBeacon/.test(fs.readFileSync(new URL("./stage2-public.js", import.meta.url), "utf8")));

console.log("\n" + pass + " passed, " + fail + " failed.");
if (fail) {
  console.log(failures.join("\n"));
  process.exit(1);
}
