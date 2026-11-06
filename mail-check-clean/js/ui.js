/* メール判定.com — 画面処理。結果中のURLはリンクにしない（textContentのみ使用） */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  function radio(name) { var x = document.querySelector('input[name="' + name + '"]:checked'); return x ? x.value : null; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function applyChannel() {
    var sms = radio("channel") === "sms";
    $("from_label").textContent = sms ? "SMSの送信元" : "送信元アドレス";
    $("from_hint").textContent = sms ? "電話番号・短い名前・英数字IDなど（空欄でも判定できます）" : "@ を含むメールアドレス全体（例: info@example.com）";
    $("from_email").setAttribute("inputmode", sms ? "text" : "email");
    $("dn_hint").textContent = sms ? "SMSに表示されている名前（空欄可）" : "メールアプリに表示されている名前（例: ヤマト運輸）";
    $("body_label").textContent = sms ? "SMS本文" : "メール本文";
    $("ctx_q").textContent = sms ? "このSMSに心当たりはありますか？" : "このメールに心当たりはありますか？";
  }
  document.querySelectorAll('input[name="channel"]').forEach(function (r) { r.addEventListener("change", applyChannel); });

  $("form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var r = window.MH_judge({
      display_name: $("display_name").value,
      from_email: $("from_email").value,
      body: $("body").value,
      context_answer: radio("context_answer"),
      visible_link_url: $("visible_link_url").value,
      channel: radio("channel") || "email"
    });
    render(r);
  });

  function render(r) {
    var d = r.display, box = $("result");
    box.innerHTML = "";
    box.className = "show v-" + d.tone;
    box.appendChild(el("h2", "verdict-head", d.headline));
    if (d.banner) box.appendChild(el("p", "safety-banner", d.banner));
    box.appendChild(el("p", "verdict-body", d.body));
    if (d.notes.length) { var ul0 = el("ul", "notes"); d.notes.forEach(function (n) { ul0.appendChild(el("li", null, n)); }); box.appendChild(ul0); }
    if (r.verdict !== "insufficient" || d.reasons.length) {
      box.appendChild(el("h3", "sec", "怪しいポイント"));
      if (!d.reasons.length) box.appendChild(el("p", null, "このツールで検出できた特徴はありませんでした。特徴が出ない詐欺もあるため、安全という意味ではありません。"));
      else {
        var ul = el("ul"); ul.id = "points";
        d.reasons.slice(0, 3).forEach(function (n) { ul.appendChild(el("li", null, n)); });
        box.appendChild(ul);
        if (d.reasons.length > 3) {
          var det = el("details", "more"); det.appendChild(el("summary", null, "ほかに " + (d.reasons.length - 3) + " 件"));
          var ul2 = el("ul"); d.reasons.slice(3).forEach(function (n) { ul2.appendChild(el("li", null, n)); });
          det.appendChild(ul2); box.appendChild(det);
        }
      }
    }
    box.appendChild(el("h3", "sec", "おすすめの行動"));
    var ua = el("ul"); ua.id = "actions";
    d.actions.forEach(function (a) { ua.appendChild(el("li", null, a)); });
    box.appendChild(ua);
    var meta = el("p", "meta-row");
    meta.appendChild(el("span", null, "判定の確からしさの目安: 低（確率ではありません）"));
    box.appendChild(meta);
    box.appendChild(el("small", "disclaimer", r.disclaimer_ja + " これは参考情報です。最終的な判断はご自身でお願いします。"));
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  applyChannel();
})();
