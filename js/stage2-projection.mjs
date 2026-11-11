/* 一覧の公開projection。テスト専用。HTMLからは読み込まない。
 * 実サーバでも本番許可でもない。syntheticOnly でない呼び出しは unavailable。 */

function subjectText(raw) {
  var t = String(raw == null ? "" : raw).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  if (!t) return "（件名なし）";
  if (t.length > 80) return t.slice(0, 80) + "…";
  return t;
}

function cleanLabel(raw) {
  if (typeof raw !== "string") return null;
  var t = raw.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "").trim();
  if (!t || /[<>]|https?:|javascript:|\bdata:/i.test(t) || /\d{4,}/.test(t)) return null;
  return t.length > 80 ? t.slice(0, 80) : t;
}

function unavailable() {
  return {
    schema_version: "readable-list-draft-1",
    status: "unavailable",
    measurement: "none",
    productionReady: false,
    privacyVerified: false,
    server: "none",
    implementation: "contract-test-only",
    items: []
  };
}

export function projectReadableList(entries, policy) {
  if (!policy || policy.syntheticOnly !== true) return unavailable();
  if (policy.periodKind === "window" && /累計/.test(policy.periodLabel || "") && !/累計ではない/.test(policy.periodLabel || "")) return unavailable();
    var rows = [];
    (entries || []).forEach(function (e, index) {
    if (!e || e.permitted !== true || e.reviewed !== true || e.basisConfirmed !== true) return;
    if (e.permitAddress !== e.address) return;
    if (typeof e.exactCount !== "number" || e.exactCount < policy.minPublish) return;
    var band = null;
    (policy.bands || []).forEach(function (b) {
      var underMax = b.max == null || e.exactCount <= b.max;
      if (e.exactCount >= b.min && underMax) band = b;
    });
    if (!band) return;
    rows.push({
      published_address: e.address,
      display_label: cleanLabel(e.reviewedLabel),
      count_band: band.label,
      bandRank: band.rank,
      tieKey: typeof e.tieKey === "string" ? e.tieKey : "",
      exactCount: e.exactCount,
      inputIndex: index,
      subject: subjectText(e.subject),
      subject_visibility: "shown",
      nameText: cleanLabel(e.reviewedLabel)
    });
  });
  rows.sort(function (a, b) {
    if (a.exactCount !== b.exactCount) return b.exactCount - a.exactCount;
    return a.inputIndex - b.inputIndex;
  });
  if (rows.length > 30) rows = rows.slice(0, 30);
  return {
    schema_version: "readable-list-draft-1",
    status: rows.length ? "available" : "empty",
    measurement: "synthetic-only",
    productionReady: false,
    privacyVerified: false,
    server: "none",
    implementation: "contract-test-only",
    period_kind: policy.periodKind === "window" ? "window" : "cumulative",
    period_label: String(policy.periodLabel || ""),
    as_of_jst: String(policy.asOfJst || ""),
    items: rows.map(function (r) {
      return { published_address: r.published_address, display_label: r.display_label, count_band: r.count_band, subject: r.subject, subject_visibility: "shown" };
    }),
    names: rows.filter(function (r) { return r.nameText; }).map(function (r) { return { text: r.nameText, count_band: r.count_band }; }),
    subjects: rows.map(function (r) { return { text: r.subject, count_band: r.count_band }; }),
    next_cursor: null
  };
}
