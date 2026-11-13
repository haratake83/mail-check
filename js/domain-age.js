/* 登録ドメインの取得日。判定のあと、登録ドメインだけを同一オリジンへ送る。
 * 名前・件名・本文・URL・メールアドレスの@より前は送らない。点数は変えない。 */
(function (g) {
  "use strict";
  var ENDPOINT = "/api/domain-created";
  var DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  var inflight = null;

  function registrableFrom(raw) {
    var util = g.MH_util;
    if (!util || typeof util.senderRegistrable !== "function") return "";
    var domain = util.senderRegistrable(raw);
    if (!domain || typeof domain !== "string") return "";
    if (domain.indexOf("@") >= 0 || !DOMAIN_RE.test(domain)) return "";
    return domain;
  }

  function planLookup(fromEmail) {
    var domain = registrableFrom(fromEmail);
    if (!domain) return null;
    return { url: ENDPOINT, method: "POST", body: { domain: domain } };
  }

  function sanitizeLookup(data) {
    if (!data || typeof data !== "object") return { status: "unavailable" };
    if (data.status === "unavailable") return { status: "unavailable" };
    var age = data.age_days;
    if (typeof age !== "number" || !isFinite(age) || Math.floor(age) !== age || age < 0) return { status: "unavailable" };
    var out = { age_days: age };
    if (typeof data.created === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.created)) out.created = data.created;
    return out;
  }

  function formatJaDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return "";
    var month = Number(m[2]);
    var day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    return Number(m[1]) + "年" + month + "月" + day + "日";
  }

  function notePresentation(info) {
    var clean = sanitizeLookup(info);
    if (!clean || clean.status === "unavailable") return { text: "", className: "" };
    var age = clean.age_days;
    var day = formatJaDate(clean.created);
    var head = "送信元ドメインの取得は、公開情報によると";
    if (age <= 30) {
      var recent = "大手の組織や公的機関が、取得から間もないドメインから重要なお知らせを送ることはあまりありません。公式の案内と照合するなど、しっかりと確認が必要です。※詐欺と確定したことにはなりません。";
      return {
        text: day ? head + day + "です（30日以内）。" + recent : head + "30日以内です。" + recent,
        className: "domain-age-note"
      };
    }
    if (age <= 364) {
      var year = "大手の組織や公的機関の公式な案内かどうかは、取得日だけでは分かりません。公式の案内と照合するなど、判断の材料にしてください。この期間であることだけを理由に、詐欺と確定したことにはなりません。";
      return {
        text: day ? head + day + "です（取得から31日以上、1年未満）。" + year : head + "取得から31日以上、1年未満です。" + year,
        className: "domain-age-note domain-age-mild"
      };
    }
    var older = "取得から一定の期間が経過しています。ただし、時間が経っていることと、正規の案内であることは同じではありません。なりすましや、正規のドメインに見せかける手口もあるため、文面と送信元を確認してください。この期間であることだけを理由に、安全と確認できたことにはなりません。";
    return {
      text: day ? head + day + "です（取得から1年以上）。" + older : head + "取得から1年以上です。" + older,
      className: "domain-age-note domain-age-mild"
    };
  }

  function cautionText(info) {
    return notePresentation(info).text;
  }

  function lookup(domain, signal) {
    if (typeof domain !== "string" || domain.indexOf("@") >= 0 || !DOMAIN_RE.test(domain)) {
      return Promise.resolve({ status: "unavailable" });
    }
    var body = JSON.stringify({ domain: domain });
    if (body.indexOf("@") >= 0) return Promise.resolve({ status: "unavailable" });
    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual",
      signal: signal
    }).then(function (res) {
      if (!res || !res.ok || res.type === "opaqueredirect") return { status: "unavailable" };
      return res.json().then(sanitizeLookup, function () { return { status: "unavailable" }; });
    }, function () { return { status: "unavailable" }; });
  }

  function paint(info) {
    if (typeof document === "undefined") return;
    var view = notePresentation(info);
    if (!view.text) return;
    var box = document.getElementById("result");
    if (!box || box.className.indexOf("show") < 0) return;
    if (box.querySelector(".domain-age-note")) return;
    var note = document.createElement("p");
    note.className = view.className;
    note.textContent = view.text;
    var anchor = box.querySelector(".verdict-body");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(note, anchor.nextSibling);
    else box.appendChild(note);
  }

  function cancel() {
    if (inflight) {
      inflight.abort();
      inflight = null;
    }
  }

  function attach(fromEmail, isCurrent) {
    cancel();
    var plan = planLookup(fromEmail);
    if (!plan) return;
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    inflight = ctrl;
    lookup(plan.body.domain, ctrl ? ctrl.signal : undefined).then(function (info) {
      if (inflight === ctrl) inflight = null;
      if (typeof isCurrent === "function" && !isCurrent()) return;
      paint(info);
    });
  }

  g.MH_DOMAIN_AGE = {
    planLookup: planLookup,
    cautionText: cautionText,
    notePresentation: notePresentation,
    sanitizeLookup: sanitizeLookup,
    lookup: lookup,
    attach: attach,
    cancel: cancel
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
