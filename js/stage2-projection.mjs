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

function domainFromAddress(raw) {
  var s = String(raw || "").trim();
  var at = s.lastIndexOf("@");
  if (at <= 0 || at === s.length - 1) return null;
  var host = s.slice(at + 1).trim().replace(/\.+$/, "");
  if (!host || host.indexOf(".") < 0 || /[\s/?#@]/.test(host)) return null;
  var unicode = host.toLowerCase();
  var ascii = unicode;
  try { ascii = new URL("http://" + host + "/").hostname.replace(/\.$/, "").toLowerCase(); } catch (e) { ascii = unicode; }
  if (!ascii || ascii.indexOf(".") < 0) return null;
  return { domain: unicode, ascii: ascii, text: unicode === ascii ? ascii : unicode + "（" + ascii + "）" };
}

function linkHost(raw) {
  var s = String(raw || "").trim();
  if (!s) return null;
  var withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : "http://" + s;
  var host = "";
  try { host = new URL(withScheme).hostname.replace(/\.$/, "").toLowerCase(); } catch (e) { return null; }
  if (!host || /[@/?#]/.test(host)) return null;
  return host;
}

function uniqueHosts(list) {
  var out = [];
  var seen = {};
  (list || []).forEach(function (item) {
    var host = linkHost(item && (item.host || item.text || item.url || item));
    if (!host || seen[host]) return;
    seen[host] = 1;
    out.push(host);
  });
  return out;
}

function bandFor(count, bands) {
  var found = null;
  (bands || []).forEach(function (b) {
    var underMax = b.max == null || count <= b.max;
    if (count >= b.min && underMax) found = b;
  });
  return found;
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

function domainList(entries, policy) {
  var grouped = [];
  var seen = {};
  (entries || []).forEach(function (e, index) {
    if (!e || e.permitted !== true || e.reviewed !== true || e.basisConfirmed !== true) return;
    if (e.permitAddress !== e.address) return;
    if (typeof e.exactCount !== "number" || e.exactCount < policy.minPublish) return;
    var parsed = domainFromAddress(e.address);
    if (!parsed) return;
    var key = parsed.ascii;
    if (!seen[key]) {
      seen[key] = { text: parsed.text, domain: parsed.domain, ascii: parsed.ascii, exactCount: 0, inputIndex: index };
      grouped.push(seen[key]);
    }
    seen[key].exactCount += e.exactCount;
    if (index < seen[key].inputIndex) seen[key].inputIndex = index;
  });
  grouped.sort(function (a, b) {
    if (a.exactCount !== b.exactCount) return b.exactCount - a.exactCount;
    return a.inputIndex - b.inputIndex;
  });
  if (grouped.length > 30) grouped = grouped.slice(0, 30);
  return grouped.map(function (g) {
    var band = bandFor(g.exactCount, policy.bands);
    var out = { text: g.text, domain: g.domain, ascii: g.ascii };
    if (band) out.count_band = band.label;
    return out;
  });
}

function linkDomainList(entries, policy) {
  var grouped = [];
  var seen = {};
  (entries || []).forEach(function (e, index) {
    if (!e || e.permitted !== true || e.reviewed !== true || e.basisConfirmed !== true) return;
    if (e.permitAddress !== e.address) return;
    if (typeof e.exactCount !== "number" || e.exactCount < policy.minPublish) return;
    uniqueHosts(e.linkHosts || e.body_hosts).forEach(function (host) {
      if (!seen[host]) {
        seen[host] = { text: host, exactCount: 0, inputIndex: index };
        grouped.push(seen[host]);
      }
      seen[host].exactCount += e.exactCount;
    });
  });
  grouped.sort(function (a, b) {
    if (a.exactCount !== b.exactCount) return b.exactCount - a.exactCount;
    return a.inputIndex - b.inputIndex;
  });
  if (grouped.length > 30) grouped = grouped.slice(0, 30);
  return grouped.map(function (g) {
    var band = bandFor(g.exactCount, policy.bands);
    var out = { text: g.text };
    if (band) out.count_band = band.label;
    return out;
  });
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
    domains: domainList(entries, policy),
    link_domains: linkDomainList(entries, policy),
    next_cursor: null
  };
}
