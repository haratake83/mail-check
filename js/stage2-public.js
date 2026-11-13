/* 第2段階の公開画面用。照会先は未設定。fetch も保存領域への書き込みもしない。
 * productionReady / privacyVerified は常に false。数値閾値はここへ置かない。 */
(function (g) {
  "use strict";
  var SCHEMA = "sender-history-draft-1";

  function subjectText(raw) {
    var t = String(raw == null ? "" : raw).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
    if (!t) return "（件名なし）";
    if (t.length > 80) return t.slice(0, 80) + "…";
    return t;
  }
  function nfkc(s) {
    try { return String(s || "").normalize("NFKC"); } catch (e) { return String(s || ""); }
  }
  function host2ascii(h) {
    h = nfkc(h).trim().replace(/\.$/, "").toLowerCase();
    if (!h) return "";
    try { return new URL("http://" + h + "/").hostname.replace(/\.$/, ""); } catch (e2) { return h; }
  }
  function normalizeAddress(raw) {
    var s = String(raw || "").trim();
    var m = s.match(/^([^@\s<>]+)@([^@\s<>]+)$/);
    if (!m) return { ok: false, reason: "unusable" };
    var local = m[1];
    var domain = host2ascii(m[2]);
    if (!domain || domain.indexOf(".") < 0 || /[/?#]/.test(local)) return { ok: false, reason: "unusable" };
    return { ok: true, local: local, domain: domain, address: local + "@" + domain };
  }
  function domainFromAddress(raw) {
    var s = String(raw || "").trim();
    var at = s.lastIndexOf("@");
    if (at <= 0 || at === s.length - 1) return null;
    var host = s.slice(at + 1).trim().replace(/\.+$/, "");
    if (!host || host.indexOf(".") < 0 || /[\s/?#@]/.test(host)) return null;
    var unicode = host.toLowerCase();
    var ascii = host2ascii(host);
    if (!ascii || ascii.indexOf(".") < 0) return null;
    var text = unicode === ascii ? ascii : unicode + "（" + ascii + "）";
    return { domain: unicode, ascii: ascii, text: text };
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
  /* 画面側の名前フィルタは公開の安全保証ではない。掲載してよいかの確認はサーバ側の審査であり、この関数が漏えいを防ぐとは限らない。 */
  function sanitizeName(raw) {
    var t = nfkc(raw).replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "").trim();
    if (!t) return null;
    if (/[<>]|https?:|javascript:|\bdata:/i.test(t)) return null;
    if (/\d{4,}/.test(t)) return null;
    if (t.length > 80) t = t.slice(0, 80);
    return t;
  }
  var FORBIDDEN = ["body", "url", "visible_link_url", "subject", "context_answer", "verdict", "danger_level", "purpose", "purpose_assessment", "spans", "span", "otp", "token", "display"];
  function pickAllowed(arr, allowed) {
    if (!Array.isArray(arr)) return [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (allowed.indexOf(v) >= 0 && out.indexOf(v) < 0) out.push(v);
    }
    return out;
  }
  function forbidden(fields) {
    if (!fields || typeof fields !== "object") return false;
    for (var i = 0; i < FORBIDDEN.length; i++) {
      if (fields[FORBIDDEN[i]] != null && String(fields[FORBIDDEN[i]]).length) return true;
    }
    return false;
  }
  function buildQueryPayload(fields) {
    if (forbidden(fields)) return { ok: false, reason: "forbidden_field" };
    var n = normalizeAddress(fields && fields.address);
    if (!n.ok) return { ok: false, reason: "unusable" };
    return {
      ok: true,
      payload: {
        schema_version: SCHEMA,
        flow: "query",
        consent_purpose: "history_query",
        address: n.address
      }
    };
  }
  function buildSubmitPayload(fields) {
    if (forbidden(fields)) return { ok: false, reason: "forbidden_field" };
    if (!fields || fields.consent !== true) return { ok: false, reason: "consent_required" };
    var n = normalizeAddress(fields.address);
    if (!n.ok) return { ok: false, reason: "unusable" };
    var payload = {
      schema_version: SCHEMA,
      flow: "submit",
      consent_purpose: "stats_submit",
      address: n.address,
      idempotency_key: fields.idempotency_key || freshKey()
    };
    // 送信元の名前は集めない。選択式のジャンルと内容だけ付ける。
    var genres = pickAllowed(fields.genres, ["delivery", "bank", "ec", "carrier", "gov", "other"]);
    var tactics = pickAllowed(fields.tactics, ["undelivered", "lock", "unpaid", "prize"]);
    if (genres.length) payload.genres = genres;
    if (tactics.length) payload.tactics = tactics;
    return { ok: true, payload: payload };
  }
  function freshKey() {
    var bytes = new Uint8Array(16);
    if (g.crypto && g.crypto.getRandomValues) g.crypto.getRandomValues(bytes);
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += ("0" + bytes[i].toString(16)).slice(-2);
    return out;
  }
  function unavailable() {
    return { schema_version: SCHEMA, status: "unavailable", productionReady: false, privacyVerified: false, acceptance_increment: 0 };
  }
  function createDisabledAdapter() {
    return {
      enabled: false,
      productionReady: false,
      privacyVerified: false,
      query: function () { return Promise.resolve(unavailable()); },
      submit: function () { return Promise.resolve(Object.assign(unavailable(), { accepted: false })); }
    };
  }
  function bandFloor(label) {
    var m = String(label || "").match(/(\d+)/);
    return m ? Number(m[1]) : 0;
  }
  function itemRank(item) {
    if (item && typeof item.exactCount === "number" && isFinite(item.exactCount)) return item.exactCount;
    return bandFloor(item && item.count_band);
  }
  function groupCounts(items, keyFn) {
    var grouped = [];
    var seen = {};
    items.forEach(function (item, index) {
      var key = keyFn(item);
      if (!key) return;
      if (!seen[key]) {
        seen[key] = Object.assign({}, item, { exactCount: 0, _hasCount: false, _index: index });
        grouped.push(seen[key]);
      }
      if (typeof item.exactCount === "number") {
        seen[key].exactCount += item.exactCount;
        seen[key]._hasCount = true;
      }
    });
    grouped.forEach(function (g) { if (!g._hasCount) delete g.exactCount; });
    return grouped;
  }
  function sortAndLimit(items) {
    var rows = [];
    for (var i = 0; i < items.length; i++) rows.push({ item: items[i], i: i, rank: itemRank(items[i]) });
    rows.sort(function (a, b) {
      if (a.rank !== b.rank) return b.rank - a.rank;
      return a.i - b.i;
    });
    if (rows.length > 30) rows = rows.slice(0, 30);
    return rows.map(function (row) { return row.item; });
  }
  function publicBand(item) {
    var band = item && item.count_band != null ? String(item.count_band) : "";
    if (!band || /^\d+$/.test(band)) return "";
    return band;
  }
  function presentHistory(response) {
    var base = { schema_version: SCHEMA, productionReady: false, privacyVerified: false, acceptance_increment: 0 };
    if (!response || response.status === "unavailable" || response.acceptance_increment) return Object.assign(base, { status: "unavailable" });
    if (response.status === "undisclosed") return Object.assign(base, { status: "undisclosed" });
    if (response.status === "stale") {
      return Object.assign(base, { status: "stale", as_of_jst: typeof response.as_of_jst === "string" ? response.as_of_jst : "" });
    }
    if (response.status === "available") {
      var period = response.period || {};
      if (response.measurement !== "synthetic-only" || response.productionReady || response.privacyVerified) return Object.assign(base, { status: "unavailable" });
      if (period.kind === "window" && /累計/.test(period.label || "") && !/累計ではない/.test(period.label || "")) return Object.assign(base, { status: "unavailable" });
      if (/^\d+$/.test(String(response.count_band || ""))) return Object.assign(base, { status: "unavailable" });
      var names = [];
      (response.names || []).forEach(function (n) {
        var text = sanitizeName(n && n.text);
        if (!text) return;
        names.push({ text: text, exactCount: n.exactCount, count_band: publicBand(n) });
      });
      names = sortAndLimit(names).map(function (n) {
        var out = { text: n.text };
        if (n.count_band) out.count_band = n.count_band;
        return out;
      });
      var subjects = [];
      var sourceSubjects = response.subjects || (response.subject != null ? [{ text: response.subject, count_band: response.count_band }] : []);
      sourceSubjects.forEach(function (s) {
        var text = subjectText(s && (s.text != null ? s.text : s));
        subjects.push({ text: text, exactCount: s && s.exactCount, count_band: publicBand(s) });
      });
      subjects = sortAndLimit(subjects).map(function (s) {
        var out = { text: s.text };
        if (s.count_band) out.count_band = s.count_band;
        return out;
      });
      var addresses = [];
      (response.addresses || []).forEach(function (a) {
        var n = normalizeAddress(a && (a.address || a.text || ""));
        if (!n.ok) return;
        addresses.push({ address: n.address, exactCount: a.exactCount, count_band: publicBand(a) });
      });
      addresses = sortAndLimit(addresses).map(function (a) {
        var out = { address: a.address };
        if (a.count_band) out.count_band = a.count_band;
        return out;
      });
      var domains = [];
      var domainSource = response.domains;
      if (!domainSource) {
        domainSource = (response.addresses || []).map(function (a) { return { address: a && (a.address || a.text || ""), exactCount: a && a.exactCount, count_band: a && a.count_band }; });
      }
      domainSource.forEach(function (d) {
        var parsed = domainFromAddress(d && (d.address || (d.domain ? "x@" + d.domain : "")));
        if (!parsed) return;
        domains.push({ text: parsed.text, domain: parsed.domain, ascii: parsed.ascii, exactCount: d.exactCount, count_band: publicBand(d) });
      });
      domains = sortAndLimit(groupCounts(domains, function (d) { return d.ascii; })).map(function (d) {
        var out = { text: d.text, domain: d.domain, ascii: d.ascii };
        if (d.count_band) out.count_band = d.count_band;
        return out;
      });
      var linkDomains = [];
      (response.link_domains || []).forEach(function (d) {
        var host = linkHost(d && (d.host || d.text || d.url || d));
        if (!host) return;
        linkDomains.push({ text: host, exactCount: d && d.exactCount, count_band: publicBand(d) });
      });
      linkDomains = sortAndLimit(groupCounts(linkDomains, function (d) { return d.text; })).map(function (d) {
        var out = { text: d.text };
        if (d.count_band) out.count_band = d.count_band;
        return out;
      });
      return Object.assign(base, {
        status: "available",
        measurement: "synthetic-only",
        count_band: String(response.count_band || ""),
        period: {
          kind: period.kind === "window" ? "window" : "cumulative",
          label: String(period.label || ""),
          start_date: String(period.start_date || ""),
          as_of_jst: String(period.as_of_jst || "")
        },
        names: names,
        subjects: subjects,
        addresses: addresses,
        domains: domains,
        link_domains: linkDomains,
        subject_display: subjects.length ? subjects[0].text : subjectText(response.subject)
      });
    }
    return Object.assign(base, { status: "unavailable" });
  }
  function createSession() {
    var gen = 0;
    var view = { status: "not_queried" };
    return {
      generation: function () { return gen; },
      invalidate: function () { gen += 1; view = { status: "not_queried" }; return view; },
      begin: function () { view = { status: "checking", generation: gen }; return gen; },
      apply: function (g, response) {
        if (g !== gen) return { applied: false, view: view };
        view = presentHistory(response);
        return { applied: true, view: view };
      },
      view: function () { return view; }
    };
  }
  g.MH_STAGE2 = {
    schema_version: SCHEMA,
    productionReady: false,
    privacyVerified: false,
    normalizeAddress: normalizeAddress,
    domainFromAddress: domainFromAddress,
    linkHost: linkHost,
    sanitizeName: sanitizeName,
    buildQueryPayload: buildQueryPayload,
    buildSubmitPayload: buildSubmitPayload,
    createDisabledAdapter: createDisabledAdapter,
    presentHistory: presentHistory,
    createSession: createSession
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
