/* メール判定.com — 画面処理。結果中のURLはリンクにしない（textContentのみ）。
 * 入力は localStorage 等へ書かない。統計の件数は描画しない。 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var generation = 0;
  function radio(name) { var x = document.querySelector('input[name="' + name + '"]:checked'); return x ? x.value : null; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  var COPY = {
    emailLabel: "差出人（From）のメールアドレス",
    smsLabel: "SMSの送信元（電話番号・短い名前など。わからなければ空欄）",
    emailWarn: "届いたメールの送り主のアドレスを入力してください。あなた自身のアドレス（宛先／To）や、パスワード・カード番号は入力しないでください。",
    smsWarn: "パスワードやカード番号は入力しないでください。電話番号・短い名前・空欄のままで判定できます。",
    emailHint: "例: notice@example.com",
    smsHint: "メールアドレスの形式でなくても、そのままで判定できます。",
    emailHelp: "メール上部の差出人名の横にある詳細表示（▼など）を開き、『差出人／From』の@を含むアドレス全体を確認してください。アプリにより表示方法が異なります。返信画面や本文のリンクを開く必要はありません。見つからなければ無理に操作しないでください。",
    smsHelp: "SMSの送信元が分からないときは空欄で判定してください。メールアドレスに直す必要はありません。本文のリンクは開かないでください。",
    emailNote: "表示名やFromも偽装されるため、本物とは確認できません。",
    smsNote: "表示名も偽装されることがあります。本物とは確認できません。"
  };

  function applyChannel() {
    var sms = radio("channel") === "sms";
    $("from_label").textContent = sms ? COPY.smsLabel : COPY.emailLabel;
    $("from_warn").textContent = sms ? COPY.smsWarn : COPY.emailWarn;
    $("from_hint").textContent = sms ? COPY.smsHint : COPY.emailHint;
    $("from_help").textContent = sms ? COPY.smsHelp : COPY.emailHelp;
    $("from_note").textContent = sms ? COPY.smsNote : COPY.emailNote;
    $("from_email").setAttribute("inputmode", sms ? "text" : "email");
    $("dn_hint").textContent = sms ? "SMSに表示されている名前（空欄可）" : "メールアプリに表示されている名前（例: ヤマト運輸）";
    $("body_label").textContent = sms ? "SMS本文" : "メール本文";
    $("ctx_q").textContent = sms ? "このSMSに心当たりはありますか？" : "このメールに心当たりはありますか？";
  }
  document.querySelectorAll('input[name="channel"]').forEach(function (r) { r.addEventListener("change", applyChannel); });

  function clearAll() {
    generation += 1;
    ["display_name", "from_email", "body", "visible_link_url"].forEach(function (id) { $(id).value = ""; });
    var unk = document.querySelector('input[name="context_answer"][value="unknown"]');
    if (unk) unk.checked = true;
    var em = document.querySelector('input[name="channel"][value="email"]');
    if (em) em.checked = true;
    applyChannel();
    var box = $("result");
    box.textContent = "";
    box.className = "";
  }
  $("clear").addEventListener("click", clearAll);

  $("form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var gen = ++generation;
    var r;
    try {
      r = window.MH_judge({
        display_name: $("display_name").value,
        from_email: $("from_email").value,
        body: $("body").value,
        context_answer: radio("context_answer"),
        visible_link_url: $("visible_link_url").value,
        channel: radio("channel") || "email"
      });
    } catch (e) {
      if (gen !== generation) return;
      renderFailure();
      return;
    }
    if (gen !== generation) return;
    render(r);
  });

  function renderFailure() {
    var box = $("result");
    box.textContent = "";
    box.className = "show v-grey";
    box.appendChild(el("h2", "verdict-head", "判定を完了できませんでした"));
    box.appendChild(el("p", null, "画面上の処理を完了できませんでした。入力した本文は、この表示には出していません。"));
  }

  function renderUrls(r) {
    var wrap = el("div", "url-block");
    wrap.appendChild(el("h3", "sec", "本文に見えるURLの特徴"));
    wrap.appendChild(el("p", null, "リンク先には当サイトからもアクセスしていません。URLの文字列の形だけを確認した結果です。実際のリンク先や安全性は確認できません。"));
    var items = r.url_assessments || [];
    if (!items.length) wrap.appendChild(el("p", null, "本文と任意欄からURL文字列は見つかりませんでした。見つからないことは、安全という意味ではありません。"));
    items.slice(0, 20).forEach(function (a) {
      var box = el("div", "url-item");
      box.appendChild(el("p", "url-literal", a.display || ""));
      if (a.host) box.appendChild(el("p", "url-host", "実ホスト: " + a.host));
      box.appendChild(el("p", "url-boundary", "登録境界（eTLD+1）: 不明です。運営者の単位としては使っていません。"));
      if (a.match_note) box.appendChild(el("p", "url-match", a.match_note));
      (a.features || []).forEach(function (f) { box.appendChild(el("p", "url-feat", f.text || "")); });
      if (a.cta_notes && a.cta_notes.length) {
        box.appendChild(el("p", "url-cta", "同じ文にある行動要求の既存説明です。この欄では再加点していません。"));
        var ul = el("ul");
        a.cta_notes.forEach(function (n) { ul.appendChild(el("li", null, n)); });
        box.appendChild(ul);
      }
      if (a.existing_notes && a.existing_notes.length) {
        box.appendChild(el("p", "url-cta", "既存の判定根拠と同じ説明です。ここでは重ねて点数にしていません。"));
        var ul2 = el("ul");
        a.existing_notes.forEach(function (n) { ul2.appendChild(el("li", null, n)); });
        box.appendChild(ul2);
      }
      if (!(a.cta_notes && a.cta_notes.length) && a.source !== "literal_scheme") {
        box.appendChild(el("p", "url-feat", "このURLの形だけでは悪性と判断しません。"));
      }
      wrap.appendChild(box);
    });
    if (items.length > 20) wrap.appendChild(el("p", null, "ほか " + (items.length - 20) + " 件も、同じ方法で文字列だけを見ています。"));
    if (r.unmatched_ctas && r.unmatched_ctas.length) {
      wrap.appendChild(el("p", null, "URL文字列と対応していない行動要求があります。ほかのURLがあっても、この要求は消していません。"));
      var um = el("ul");
      r.unmatched_ctas.forEach(function (u) { um.appendChild(el("li", null, u.note + (u.span ? " 「" + u.span + "」" : ""))); });
      wrap.appendChild(um);
    }
    var limits = r.url_limits || [];
    if (limits.length) {
      wrap.appendChild(el("p", "hint", "確認していないこと"));
      var lim = el("ul", "notes");
      limits.forEach(function (t) { lim.appendChild(el("li", null, t)); });
      wrap.appendChild(lim);
    }
    return wrap;
  }

  function renderPurpose(r) {
    var wrap = el("div", "purpose-block");
    wrap.appendChild(el("h3", "sec", "本文から推定される目的（確定ではありません）"));
    (r.purpose_assessment || []).forEach(function (p) {
      wrap.appendChild(el("p", "purpose-expl", p.explanation || ""));
      if (p.spans && p.spans.length) {
        var ul = el("ul");
        p.spans.forEach(function (s) { ul.appendChild(el("li", "purpose-span", s)); });
        wrap.appendChild(ul);
      }
    });
    wrap.appendChild(el("p", "purpose-fixed", "タグがないことは、安全である証明ではありません。感染や添付の有無は、この入力からは確認できません。"));
    return wrap;
  }

  function render(r) {
    var d = r.display, box = $("result");
    box.textContent = "";
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
    box.appendChild(renderUrls(r));
    box.appendChild(renderPurpose(r));
    var meta = el("p", "meta-row");
    meta.appendChild(el("span", null, "判定の確からしさの目安: 低（確率ではありません）"));
    box.appendChild(meta);
    box.appendChild(el("small", "disclaimer", r.disclaimer_ja + " これは参考情報です。最終的な判断はご自身でお願いします。"));
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  applyChannel();
})();
