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
    var name = sanitizeName(fields.display_name);
    if (name) payload.display_name = name;
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
        if (names.length >= 3) return;
        var text = sanitizeName(n && n.text);
        if (text) names.push({ text: text });
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
        subject_display: subjectText(response.subject)
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
    sanitizeName: sanitizeName,
    buildQueryPayload: buildQueryPayload,
    buildSubmitPayload: buildSubmitPayload,
    createDisabledAdapter: createDisabledAdapter,
    presentHistory: presentHistory,
    createSession: createSession
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
