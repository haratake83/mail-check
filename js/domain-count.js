/* 判定回数。判定のあと、登録ドメインだけを同一オリジンへ送る。
 * 正規化は取得日の照会と同じ。メールアドレス、名前、件名、本文、URLは送らない。
 * 回数は判定区分を変えない。取れないとき、5回未満のときは、何も足さない。 */
(function (g) {
  "use strict";
  var ENDPOINT = "/api/domain-count";
  var TIMEOUT_MS = 5000;
  var inflight = null;

  function planCount(fromEmail) {
    var age = g.MH_DOMAIN_AGE;
    if (!age || typeof age.planLookup !== "function") return null;
    var planned = age.planLookup(fromEmail);
    if (!planned || !planned.body || typeof planned.body.domain !== "string") return null;
    var domain = planned.body.domain;
    if (!domain || domain.indexOf("@") >= 0) return null;
    return { url: ENDPOINT, method: "POST", body: { domain: domain } };
  }

  function wholeCount(n) {
    return typeof n === "number" && isFinite(n) && Math.floor(n) === n && n >= 0;
  }

  function viewFor(data) {
    if (!data || typeof data !== "object" || data.status !== "ok") return null;
    if (!wholeCount(data.total) || data.total < 5) return null;
    if (!wholeCount(data.day) || !wholeCount(data.week) || !wholeCount(data.month) || !wholeCount(data.half_year) || !wholeCount(data.year)) return null;
    return {
      heading: "このドメインが判定された回数",
      lead: "このドメインは、このサイトでこれまでに判定されています。",
      lines: [
        "1日：" + data.day + "回",
        "1週間：" + data.week + "回",
        "1ヶ月：" + data.month + "回",
        "半年：" + data.half_year + "回",
        "1年：" + data.year + "回"
      ],
      note: "※判定された回数は、詐欺かどうかを示すものではありません。"
    };
  }

  function lookup(domain, signal, timeoutMs) {
    if (typeof domain !== "string" || domain.indexOf("@") >= 0) {
      return Promise.resolve({ status: "unavailable" });
    }
    var body = JSON.stringify({ domain: domain });
    if (body.indexOf("@") >= 0) return Promise.resolve({ status: "unavailable" });
    var limit = typeof timeoutMs === "number" ? timeoutMs : TIMEOUT_MS;
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = null;
    if (ctrl) {
      timer = setTimeout(function () { ctrl.abort(); }, limit);
      if (signal) {
        if (signal.aborted) ctrl.abort();
        else if (typeof signal.addEventListener === "function") signal.addEventListener("abort", function () { ctrl.abort(); });
      }
    }
    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual",
      signal: ctrl ? ctrl.signal : signal
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res || !res.ok || res.type === "opaqueredirect") return { status: "unavailable" };
      return res.json().then(function (data) {
        return data && typeof data === "object" ? data : { status: "unavailable" };
      }, function () { return { status: "unavailable" }; });
    }, function () {
      if (timer) clearTimeout(timer);
      return { status: "unavailable" };
    });
  }

  function paint(data) {
    if (typeof document === "undefined") return;
    var view = viewFor(data);
    if (!view) return;
    var box = document.getElementById("result");
    if (!box || box.className.indexOf("show") < 0) return;
    var old = box.querySelector(".domain-count-note");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var note = document.createElement("section");
    note.className = "domain-count-note";
    var heading = document.createElement("h3");
    heading.className = "domain-count-head";
    heading.textContent = view.heading;
    note.appendChild(heading);
    var lead = document.createElement("p");
    lead.textContent = view.lead;
    note.appendChild(lead);
    var list = document.createElement("ul");
    list.className = "domain-count-list";
    view.lines.forEach(function (line) {
      var item = document.createElement("li");
      item.textContent = line;
      list.appendChild(item);
    });
    note.appendChild(list);
    var foot = document.createElement("p");
    foot.className = "domain-count-foot";
    foot.textContent = view.note;
    note.appendChild(foot);
    var age = box.querySelector(".domain-age-note");
    var anchor = age || box.querySelector(".verdict-body");
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
    try {
      cancel();
      var plan = planCount(fromEmail);
      if (!plan) return;
      var ctrl = typeof AbortController === "function" ? new AbortController() : null;
      inflight = ctrl;
      lookup(plan.body.domain, ctrl ? ctrl.signal : undefined).then(function (data) {
        try {
          if (inflight === ctrl) inflight = null;
          if (typeof isCurrent === "function" && !isCurrent()) return;
          paint(data);
        } catch (e) { /* 回数の表示で結果を壊さない */ }
      }, function () {
        if (inflight === ctrl) inflight = null;
      });
    } catch (e) { /* 回数の照会で結果を壊さない */ }
  }

  g.MH_DOMAIN_COUNT = {
    ENDPOINT: ENDPOINT,
    TIMEOUT_MS: TIMEOUT_MS,
    planCount: planCount,
    viewFor: viewFor,
    lookup: lookup,
    paint: paint,
    attach: attach,
    cancel: cancel
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
