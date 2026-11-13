/* 週間ランキング。送るのは登録ドメインと、選択したジャンル・内容だけ。 */
(function (g) {
  "use strict";
  var ENDPOINT = "/api/weekly-rank";
  var GENRE = { delivery: "宅配便・配送業者", bank: "銀行・カード会社", ec: "通販サイト", carrier: "通信キャリア", gov: "官公庁・税務署", other: "その他・不明" };
  var CONTENT = { undelivered: "不在通知・再配達", lock: "アカウント停止・ロック", unpaid: "未払い料金の請求", prize: "当選・給付金の案内" };
  var EMPTY = "今週、10回以上判定された項目はまだありません。";

  function recordBody(input) {
    var domain = input && input.domain;
    if (typeof domain !== "string" || !domain || domain.indexOf("@") >= 0) return null;
    var body = { domain: domain };
    if (input.genre && GENRE[input.genre]) body.genre = input.genre;
    if (input.content && CONTENT[input.content]) body.content = input.content;
    var keys = Object.keys(body);
    if (keys.some(function (key) { return key !== "domain" && key !== "genre" && key !== "content"; })) return null;
    return body;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function labelFor(kind, key) {
    if (kind === "domain") return typeof key === "string" && key.indexOf("@") < 0 ? key : "";
    if (kind === "genre") return GENRE[key] || "";
    return CONTENT[key] || "";
  }

  function paintList(id, kind, rows) {
    var box = document.getElementById(id);
    if (!box) return;
    box.textContent = "";
    var list = [];
    (rows || []).forEach(function (row) {
      if (!row || typeof row.count !== "number") return;
      var label = row.label || labelFor(kind, row.key);
      if (!label || label.indexOf("@") >= 0) return;
      list.push({ label: label, count: row.count });
    });
    if (!list.length) {
      box.appendChild(el("p", "weekly-rank-empty", EMPTY));
      return;
    }
    var ol = el("ol", "weekly-rank-list");
    list.slice(0, 10).forEach(function (row, index) {
      var li = document.createElement("li");
      li.appendChild(el("span", "rank-pos", (index + 1) + "位"));
      li.appendChild(el("span", "rank-label", row.label));
      li.appendChild(el("span", "rank-count", row.count + "回"));
      ol.appendChild(li);
    });
    box.appendChild(ol);
  }

  function paint(data) {
    var body = data || {};
    paintList("rank_domains", "domain", body.domains);
    paintList("rank_genres", "genre", body.genres);
    paintList("rank_contents", "content", body.contents);
  }

  function fetchRank(method, body) {
    return fetch(ENDPOINT, {
      method: method,
      headers: method === "POST" ? { "content-type": "application/json" } : {},
      body: method === "POST" ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual"
    }).then(function (res) {
      if (!res || !res.ok || res.type === "opaqueredirect") return null;
      return res.json();
    }, function () { return null; });
  }

  function record(input) {
    var body = recordBody(input);
    if (!body) return;
    fetchRank("POST", body).then(function (data) { if (data) paint(data); });
  }

  function load() {
    fetchRank("GET").then(function (data) { paint(data || {}); });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
    else load();
  }

  g.MH_WEEKLY = { recordBody: recordBody, record: record, load: load, paint: paint };
})(typeof globalThis !== "undefined" ? globalThis : this);
