/* メール判定.com — 画面処理。結果中のURLはリンクにしない（textContentのみ）。
 * 入力は localStorage 等へ書かない。統計の件数は描画しない。 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var generation = 0;
  function radio(name) { var x = document.querySelector('input[name="' + name + '"]:checked'); return x ? x.value : null; }
  function checkedValues(name) {
    var out = [];
    document.querySelectorAll('input[name="' + name + '"]:checked').forEach(function (c) { out.push(c.value); });
    return out;
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  var COPY = {
    emailLabel: "メールに記載されたアドレス",
    emailWarn: "届いたメールの送り主のアドレスを入力してください。あなた自身のアドレス（宛先／To）や、パスワード・カード番号は入力しないでください。",
    emailHint: "例: notice@example.com",
    emailHelp: "メール上部の差出人名の横にある詳細表示（▼など）を開き、『差出人／From』の@を含むアドレス全体を確認してください。アプリにより表示方法が異なります。返信画面や本文のリンクを開く必要はありません。見つからなければ無理に操作しないでください。",
    emailNote: "表示名やFromも偽装されるため、本物とは確認できません。"
  };
  var judgmentKey = null;
  function sessionKey() {
    if (judgmentKey) return judgmentKey;
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    judgmentKey = Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    return judgmentKey;
  }

  function applyChannel() {
    $("from_label").textContent = COPY.emailLabel;
    $("from_warn").textContent = COPY.emailWarn;
    $("from_hint").textContent = COPY.emailHint;
    $("from_help").textContent = COPY.emailHelp;
    $("from_note").textContent = COPY.emailNote;
    $("from_email").setAttribute("inputmode", "email");
    if ($("dn_hint")) $("dn_hint").textContent = "メールアプリに表示されている名前（例: ヤマト運輸）。判定のためだけに使い、保存や公開はしません。";
    $("body_label").textContent = "メール本文";
    $("ctx_q").textContent = "このメールに心当たりはありますか？";
  }

  function clearAll() {
    generation += 1;
    if (window.MH_DOMAIN_AGE) window.MH_DOMAIN_AGE.cancel();
    ["display_name", "subject", "from_email", "body"].forEach(function (id) { if ($(id)) $(id).value = ""; });
    ["sender_genre", "mail_content"].forEach(function (name) {
      var picked = document.querySelector('input[name="' + name + '"][value="other"]');
      if (picked) picked.checked = true;
    });
    var unk = document.querySelector('input[name="context_answer"][value="unknown"]');
    if (unk) unk.checked = true;
    judgmentKey = null;
    applyChannel();
    var box = $("result");
    box.textContent = "";
    box.className = "";
    var consent = $("history_consent");
    if (consent) consent.checked = false;
    var sub = $("history_submit_result");
    if (sub) sub.textContent = "";
    if (historySession) { historySession.invalidate(); paintHistory(historySession.view()); }
    paintSubject("（件名なし）");
  }
  $("clear").addEventListener("click", clearAll);

  $("form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var gen = ++generation;
    var r;
    try {
      r = window.MH_judge({
        display_name: $("display_name") ? $("display_name").value : "",
        subject: $("subject").value,
        from_email: $("from_email").value,
        body: $("body").value,
        context_answer: radio("context_answer"),
        channel: "email"
      });
    } catch (e) {
      if (gen !== generation) return;
      renderFailure();
      return;
    }
    if (gen !== generation) return;
    sessionKey();
    render(r);
    if (window.MH_DOMAIN_AGE) {
      var ageGen = gen;
      window.MH_DOMAIN_AGE.attach($("from_email").value, function () { return ageGen === generation; });
    }
    if (window.MH_WEEKLY && window.MH_DOMAIN_AGE) {
      var rankPlan = window.MH_DOMAIN_AGE.planLookup($("from_email").value);
      if (rankPlan) window.MH_WEEKLY.record({ domain: rankPlan.body.domain, genre: radio("sender_genre"), content: radio("mail_content") });
    }
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
    if (!items.length) wrap.appendChild(el("p", null, "本文からURL文字列は見つかりませんでした。見つからないことは、安全という意味ではありません。"));
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

  function hasSubstantivePurpose(r) {
    return (r.purpose_assessment || []).some(function (p) { return p.tag && p.tag !== "unknown"; });
  }

  function render(r) {
    var d = r.display, box = $("result");
    box.textContent = "";
    box.className = "show v-" + d.tone;
    paintSubject(r.subject_display || "（件名なし）");
    var summary = el("div", "input-summary");
    summary.appendChild(el("h2", "summary-head", "判定したメール"));
    summary.appendChild(el("p", "summary-label", "件名"));
    summary.appendChild(el("p", "summary-subject", r.subject_display || "（件名なし）"));
    box.appendChild(summary);
    if (d.lead) {
      var lead = el("div", "lead-alert");
      lead.appendChild(el("h2", null, d.lead.headline));
      lead.appendChild(el("p", null, d.lead.body));
      lead.appendChild(el("p", null, d.lead.note));
      box.appendChild(lead);
    }
    if (d.input_gap_lead) {
      var gap = el("div", "lead-alert");
      gap.appendChild(el("h2", null, d.input_gap_lead.headline));
      gap.appendChild(el("p", null, d.input_gap_lead.body));
      box.appendChild(gap);
    }
    box.appendChild(el("h2", "verdict-head", d.headline));
    if (d.banner) box.appendChild(el("p", "safety-banner", d.banner));
    box.appendChild(el("p", "verdict-body", d.body));
    if (d.tone === "grey" || d.tone === "yellow") box.appendChild(el("p", "button-gap", "ボタンや画像、QRコードの本当の行き先は見ていません。見た目のリンク文字だけを判断材料にはできません。"));
    if (d.notes.length) { var ul0 = el("ul", "notes"); d.notes.forEach(function (n) { ul0.appendChild(el("li", null, n)); }); box.appendChild(ul0); }
    if (r.verdict !== "insufficient" || d.reasons.length) {
      box.appendChild(el("h3", "sec", "怪しいポイント"));
      if (!d.reasons.length) {
        if (hasSubstantivePurpose(r)) box.appendChild(el("p", null, "従来の危険度の集計では数えていない文面の特徴が、上の注意または目的の欄にあります。特徴が無いという意味ではありません。"));
        else box.appendChild(el("p", null, "このツールで検出できた特徴はありませんでした。特徴が出ない詐欺もあるため、安全という意味ではありません。"));
      }
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
    meta.appendChild(el("span", null, "この判定方式の精度は未測定です"));
    box.appendChild(meta);
    var near = el("p", "terms-near");
    near.appendChild(document.createTextNode("本結果は入力された文字情報に基づく参考情報であり、メールの真偽や安全性を保証するものではありません。"));
    if (window.MH_FLAGS && window.MH_FLAGS.FEATURE_TERMS_PUBLIC) {
      near.appendChild(document.createTextNode("詳しくは"));
      var termsLink = el("a", null, "利用規約");
      termsLink.href = "terms.html";
      near.appendChild(termsLink);
      near.appendChild(document.createTextNode("をご覧ください。"));
    }
    box.appendChild(near);
    var guides = el("p", "result-guides");
    function addGuide(href, label) {
      var a = el("a", null, label);
      a.href = href;
      guides.appendChild(a);
      guides.appendChild(document.createTextNode(" "));
    }
    addGuide("guides/how-to-spot.html", "見分け方");
    addGuide("guides/if-you-opened.html", "リンクを開いてしまったら");
    if (d.lead) addGuide("guides/malware.html", "マルウェアメールとは");
    if ((r.purpose_assessment || []).some(function (p) { return p.tag === "credential_or_payment"; })) addGuide("guides/billing.html", "架空請求メールとは");
    box.appendChild(guides);
    box.appendChild(el("small", "disclaimer", r.disclaimer_ja + " これは参考情報です。最終的な判断はご自身でお願いします。"));
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  var historySession = null;
  function maskHistorySubject(text) {
    var t = String(text || "");
    t = t.replace(/https?:\/\/\S+/gi, "＊＊＊");
    t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "＊＊＊");
    t = t.replace(/\d{4,}/g, "＊＊＊");
    return t || "（件名なし）";
  }
  function paintSubject(text) {
    var node = $("history_subject");
    if (node) node.textContent = maskHistorySubject(text || "（件名なし）");
  }
  function paintList(box, label, items, line) {
    box.appendChild(el("p", null, label));
    if (!items || !items.length) {
      box.appendChild(el("p", null, "表示できる" + label + "はありません。"));
      return;
    }
    var ul = el("ul");
    items.forEach(function (item) { ul.appendChild(el("li", null, line(item))); });
    box.appendChild(ul);
  }
  function paintHistory(view) {
    var box = $("history_result");
    if (!box) return;
    box.textContent = "";
    if (!view || view.status === "not_queried") {
      if ($("history_query_note")) $("history_query_note").textContent = "まだ照会していません。この画面には履歴の照会先がありません。";
      return;
    }
    if (view.status === "checking") { box.appendChild(el("p", null, "履歴を確認中です")); return; }
    if (view.status === "undisclosed") { box.appendChild(el("p", null, "表示できる履歴はありません（0件・少数等を含みます）。")); return; }
    if (view.status === "stale") {
      box.appendChild(el("p", null, "集計更新が遅れています。"));
      if (view.as_of_jst) box.appendChild(el("p", null, "基準日時（JST）: " + view.as_of_jst));
      return;
    }
    if (view.status === "available" && view.measurement === "synthetic-only" && view.productionReady === false && view.privacyVerified === false) {
      box.appendChild(el("p", "history-banner", "これは合成データの表示です。実績ではありません。"));
      var windowed = view.period && view.period.kind === "window";
      box.appendChild(el("p", null, (windowed ? "期間の概数（累計ではありません）" : "本サービスの有効判定受付概数") + ": " + (view.count_band || "")));
      if (view.period && view.period.label) box.appendChild(el("p", null, view.period.label));
      if (view.period && view.period.start_date) box.appendChild(el("p", null, "開始日: " + view.period.start_date));
      if (view.period && view.period.as_of_jst) box.appendChild(el("p", null, "基準日時（JST）: " + view.period.as_of_jst));
      box.appendChild(el("p", null, "回数の多い順に、最大30件まで表示します。"));
      paintList(box, "名前", view.names, function (n) { return n.text + (n.count_band ? "（" + n.count_band + "）" : ""); });
      paintList(box, "件名", view.subjects, function (s) { return s.text + (s.count_band ? "（" + s.count_band + "）" : ""); });
      paintList(box, "アドレス", view.addresses, function (a) { return a.address + (a.count_band ? "（" + a.count_band + "）" : ""); });
      paintList(box, "ドメイン", view.domains, function (d) { return d.text + (d.count_band ? "（" + d.count_band + "）" : ""); });
      paintList(box, "本文内のリンク先ドメイン", view.link_domains, function (d) { return d.text + (d.count_band ? "（" + d.count_band + "）" : ""); });
      if (!view.subjects || !view.subjects.length) box.appendChild(el("p", "history-record-subject", "件名: " + (view.subject_display || "（件名なし）")));
      box.appendChild(el("p", null, "投稿者が入力した自称の名前です。本人・所有者・真正性を確認したものではありません。送信元は偽装できます。"));
      return;
    }
    box.appendChild(el("p", null, "現在履歴を取得できません。"));
  }
  if (window.MH_STAGE2) {
    historySession = window.MH_STAGE2.createSession();
    window.MH_STAGE2.adapter = window.MH_STAGE2.createDisabledAdapter();
    $("history_query").addEventListener("click", function () {
      var built = window.MH_STAGE2.buildQueryPayload({ address: $("from_email").value });
      var box = $("history_result");
      if (!built.ok) {
        box.textContent = "";
        box.appendChild(el("p", null, "メールに記載されたアドレスの形式を確認してください。"));
        return;
      }
      var gen = historySession.begin();
      paintHistory(historySession.view());
      window.MH_STAGE2.adapter.query(built.payload).then(function (res) {
        var applied = historySession.apply(gen, res);
        if (!applied.applied) return;
        paintHistory(applied.view);
      });
    });
    $("history_submit").addEventListener("click", function () {
      var box = $("history_submit_result");
      box.textContent = "";
      if (!$("history_consent").checked) {
        box.appendChild(el("p", null, "統計への受付登録には、別の同意が必要です。同意がないので送信しません。"));
        return;
      }
      var built = window.MH_STAGE2.buildSubmitPayload({ address: $("from_email").value, genres: checkedValues("sender_genre"), tactics: checkedValues("mail_content"), consent: true, idempotency_key: sessionKey() });
      if (!built.ok) {
        box.appendChild(el("p", null, "メールに記載されたアドレスの形式を確認してください。送信しません。"));
        return;
      }
      var gen = historySession.generation();
      window.MH_STAGE2.adapter.submit(built.payload).then(function (res) {
        if (gen !== historySession.generation()) return;
        box.textContent = "";
        box.appendChild(el("p", null, "現在、統計対象としての送信先はありません。送信していません。"));
      });
    });
    $("from_email").addEventListener("input", function () {
        if (!historySession) return;
        historySession.invalidate();
        paintHistory(historySession.view());
        var sub = $("history_submit_result");
        if (sub) sub.textContent = "";
      });
  }
  function applyFlags() {
    var f = window.MH_FLAGS || {};
    if (f.FEATURE_HISTORY_PANEL && $("history_panel")) {
      $("history_panel").hidden = false;
      if ($("history_pending")) $("history_pending").hidden = true;
    }
    if (f.FEATURE_LIST_PUBLIC && $("list_link")) $("list_link").hidden = false;
    if (f.FEATURE_TERMS_PUBLIC) {
      document.querySelectorAll(".terms-public").forEach(function (node) { node.hidden = false; });
      document.querySelectorAll(".terms-fallback").forEach(function (node) { node.hidden = true; });
    }
  }
  applyChannel();
  applyFlags();
})();
