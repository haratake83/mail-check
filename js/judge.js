/* メール判定.com — 判定エンジン（表示プロトコル v0.10。差出人はメールアドレスのみ）
 * ネットワークアクセスなし。入力URLへのアクセス・DNS・短縮展開・リダイレクト追跡・QR解析・SPF/DKIM検証はしない。
 * 入力文字列は全て信頼できないデータとして扱い、命令として解釈しない（§9）。
 * 第1段階の purpose_assessment / url_assessments / statistics は説明専用。
 * 危険度・4 verdict・重複排除・ゲート・既存の T* / A* / P* は変えない。統計案A/B/Cは保存しない。
 * 実ホストと eTLD+1 を混ぜない。PSL private を完全には同梱していないため、登録境界は運営者として使わず不明にする。
 */
(function (g) {
  "use strict";
  var W = { strong: 3, medium: 2, weak: 1, none: 0 };
  var LV = { N: 0, W: 1, M: 2, S: 3 };
  var LVN = ["N", "W", "M", "S"];

  // ---------- 正規化 ----------
  function nfkc(s) { try { return (s || "").normalize("NFKC"); } catch (e) { return s || ""; } }
  function norm(s) { return nfkc(s).toLowerCase(); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function maskSecrets(s) { return String(s).replace(/\d[\d\- ]{5,}\d/g, function (m) { return m.replace(/\d/g, "＊"); }); }
  // 表示はホストまで。userinfo / パス / query / fragment は長さや区切りに関係なく出さない。
  function redactUrl(raw) {
    var original = String(raw || "").trim();
    if (!original) return "";
    if (/^(?:javascript|data)\s*:/i.test(original)) return (/^data/i.test(original) ? "data:" : "javascript:") + "＊＊＊";
    var hxx = original.match(/^(hxxps?):\/\//i);
    var hadHttp = /^https?:\/\//i.test(original);
    var full = hxx ? original.replace(/^hxxp/i, "http") : (hadHttp ? original : "http://" + original);
    try {
      var x = new URL(full);
      if (x.protocol === "javascript:" || x.protocol === "data:") return x.protocol + "＊＊＊";
      var host = x.hostname.replace(/\.$/, "");
      if (!host) return "＊＊＊";
      var port = x.port ? ":" + x.port : "";
      var beyondHost = !!(x.username || x.password) || !!(x.pathname && x.pathname !== "/") || !!x.search || !!x.hash;
      var prefix = hxx ? hxx[1].toLowerCase() + "://" : (hadHttp ? x.protocol + "//" : "");
      return prefix + host + port + (beyondHost ? "/＊＊＊" : (hadHttp || hxx ? "/" : ""));
    } catch (e2) {
      var cut = original.replace(/^[a-z][a-z0-9+.-]*:\/*[^/\s@]*@/i, "");
      cut = cut.replace(/[?#;].*$/, "");
      cut = cut.replace(/\/.*$/, "/＊＊＊");
      return cut.slice(0, 80);
    }
  }
  function maskSpanSecrets(s) {
    var t = String(s || "");
    t = t.replace(/(認証コード|確認コード|セキュリティコード|ワンタイムパスワード|ワンタイム|パスコード|暗証番号|パスワード|コード|PIN|OTP)([:：\s]*)([A-Za-z0-9_-]{4,})/gi, function (_m, label, sep) {
      return label + sep + "＊＊＊";
    });
    t = t.replace(/\d(?:[\d\- ]*\d){3,}/g, function (m) {
      var digits = (m.match(/\d/g) || []).length;
      if (digits < 4) return m;
      return m.replace(/\d/g, "＊");
    });
    return t;
  }
  function redactSpan(s) {
    var t = String(s || "");
    t = t.replace(/(^|[^A-Za-z0-9_])((?:javascript|data)\s*:)\S*/gi, function (_m, pre, scheme) {
      return pre + (/^data/i.test(scheme) ? "data:" : "javascript:") + "＊＊＊";
    });
    t = t.replace(/hxxps?:\/\/\S+/gi, function (u) { return redactUrl(u); });
    t = t.replace(/https?:\/\/\S+/gi, function (u) { return redactUrl(u); });
    t = t.replace(/(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[A-Za-z0-9\-._~%!$&'()*+,;=:@?#/]*)?/gi, function (u, at, whole) {
      var prev = at > 0 ? whole.charAt(at - 1) : "";
      if (/[A-Za-z0-9@_-]/.test(prev) || prev === "/") return u;
      return redactUrl(u);
    });
    t = maskSpanSecrets(t);
    if (t.length > 80) t = t.slice(0, 80) + "…";
    return t;
  }
  function host2ascii(h) {
    h = (h || "").trim().replace(/\.$/, "").toLowerCase();
    if (!h) return "";
    try { return new URL("http://" + h + "/").hostname.replace(/\.$/, ""); } catch (e) { return h; }
  }
  var SLD = { co: 1, or: 1, ne: 1, go: 1, ac: 1, ad: 1, ed: 1, gr: 1, lg: 1, com: 1, net: 1, org: 1, gov: 1, edu: 1 };
  // 簡易登録ドメイン（PSL近似。.example等の予約TLDはモックとして末尾2ラベル）
  function registrable(h) {
    var p = h.split(".");
    if (p.length <= 2) return h;
    var tld = p[p.length - 1], sld = p[p.length - 2];
    if (tld.length === 2 && SLD[sld]) return p.slice(-3).join(".");
    return p.slice(-2).join(".");
  }
  function hostIn(host, list) {
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (d.charAt(0) === "@") continue;
      if (d.charAt(0) === "~") { d = d.slice(1); if (host === d || host.slice(-(d.length + 1)) === "." + d) return true; }
      else if (host === d) return true;
    }
    return false;
  }
  function addrIn(addr, list) {
    for (var i = 0; i < list.length; i++) if (list[i].charAt(0) === "@" && list[i].slice(1) === addr) return true;
    return false;
  }
  function hasAddrRule(list) { return list.some(function (d) { return d.charAt(0) === "@"; }); }

  // ---------- 字面比較（T*） ----------
  function lev(a, b) {
    var m = a.length, n = b.length, d = [], i, j;
    for (i = 0; i <= m; i++) { d[i] = [i]; }
    for (j = 0; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function deHomoglyph(s) {
    return s.replace(/rn/g, "m").replace(/vv/g, "w").replace(/0/g, "o").replace(/1/g, "l").replace(/3/g, "e").replace(/5/g, "s")
      .replace(/[а]/g, "a").replace(/[е]/g, "e").replace(/[о]/g, "o").replace(/[р]/g, "p").replace(/[с]/g, "c").replace(/[х]/g, "x").replace(/[і]/g, "i");
  }
  var GENERIC = { com: 1, co: 1, jp: 1, go: 1, lg: 1, ne: 1, or: 1, net: 1, org: 1, mail: 1, login: 1, support: 1, bank: 1, card: 1, pay: 1, post: 1, www: 1, example: 1 };
  var CTAWORDS = ["secure", "login", "signin", "support", "account", "verify", "update", "auth", "security", "id", "help", "service", "info", "member", "jp"];
  /* 戻り値: {rel:'related'|'typo'|'unrelated', tid, detail} */
  function lexical(host, anchors) {
    var reg = registrable(host);
    var regLabels = reg.split(".").slice(0, -1).filter(function (l) { return !GENERIC[l]; });
    var subLabels = host.slice(0, host.length - reg.length).split(".").filter(function (l) { return l && !GENERIC[l]; });
    var best = { rel: "unrelated" };
    anchors.forEach(function (a) {
      var short = a.replace(/-/g, "").length <= 4;
      // T03: 偽サブドメイン（ブランドが登録ドメインの外にある）
      if (subLabels.some(function (l) { return l === a || l.split("-").indexOf(a) >= 0; }) && regLabels.indexOf(a) < 0) {
        best = { rel: "typo", tid: "T03", detail: a }; return;
      }
      regLabels.forEach(function (l) {
        if (best.rel === "typo") return;
        var toks = l.split("-");
        if (l === a || l.replace(/-/g, "") === a.replace(/-/g, "")) { if (best.rel !== "typo") best = { rel: "related", detail: a }; return; }
        if (!short) {
          var hg = deHomoglyph(l);
          if (hg !== l && (hg === a || hg.replace(/-/g, "") === a.replace(/-/g, ""))) { best = { rel: "typo", tid: "T02", detail: a }; return; }
          // T04: ブランド＋secure/login等の連結
          var rest = l.replace(a, "").replace(/-/g, "");
          if (l.indexOf(a) >= 0 && rest && CTAWORDS.indexOf(rest) >= 0) { best = { rel: "typo", tid: "T04", detail: a }; return; }
          var L = a.replace(/-/g, "").length, dist = lev(l.replace(/-/g, ""), a.replace(/-/g, ""));
          if (dist > 0 && ((L >= 5 && L <= 7 && dist === 1) || (L >= 8 && dist <= 2))) { best = { rel: "typo", tid: "T01", detail: a }; return; }
        }
        if (toks.indexOf(a) >= 0) { best = { rel: "related", detail: a }; return; }
        if (!short && l.indexOf(a.replace(/-/g, "")) >= 0) best = { rel: "related", detail: a };
      });
    });
    return best;
  }

  // ---------- ランダム文字列（E01、研究候補・weak・閾値未校正） ----------
  function looksRandom(label) {
    if (!label || label.length < 4) return false;
    if (/^(no-?reply|info|support|mail|news|notice|admin|order|service|staff|contact|bounce)/.test(label)) return false;
    var s = label.replace(/[-_.]/g, "");
    var vowels = (s.match(/[aeiou]/g) || []).length;
    var digits = (s.match(/\d/g) || []).length;
    var letters = (s.match(/[a-z]/g) || []).length;
    if (letters >= 4 && vowels === 0) return true;                 // pfcrz, bxwv
    if (s.length >= 5 && digits >= 2 && letters >= 3 && /\d[a-z]+\d/.test(s)) return true; // q7v9z
    if (s.length >= 7 && vowels / Math.max(letters, 1) < 0.15) return true;
    return false;
  }

  // ---------- 送信元パーサー ----------
  function parseEmail(raw) {
    var s = nfkc(raw).trim();
    var m = s.match(/<([^<>]+)>\s*$/); if (m) s = m[1].trim();
    m = s.match(/^([^\s@<>()",;:]+)@([a-z0-9.\-\u0080-\uffff]+\.[a-z0-9\-\u0080-\uffff]{2,})$/i);
    if (!m) return null;
    var host = host2ascii(m[2]);
    if (!host || host.indexOf(".") < 0) return null;
    return { kind: "email", local: m[1].toLowerCase(), host: host, addr: m[1].toLowerCase() + "@" + host, raw: raw };
  }
  // v0.9: 電話番号・ショートコード・SMS送信元の解析は削除した。差出人はメールアドレスだけ。

  // ---------- URL抽出（ネットワークなし） ----------
  var URL_RE = /(?:https?:\/\/|hxxps?:\/\/|www\.)[^\s<>"'「」『』（）()]+|(?:[a-z0-9\-]+\.)+[a-z]{2,}\/[^\s<>"'「」『』（）()]*/gi;
  function extractUrls(body, P) {
    var out = [], seen = {};
    function add(raw, source, idx) {
      var u = raw.replace(/[。、，．,.)）」』】>\]]+$/, "").replace(/^hxxp/i, "http");
      var full = /^https?:\/\//i.test(u) ? u : "http://" + u;
      var host = "", userinfo = false, ip = false;
      try { var x = new URL(full); host = x.hostname.replace(/\.$/, "").toLowerCase(); userinfo = !!(x.username || x.password); } catch (e) { return; }
      if (!host || host.indexOf(".") < 0) return;
      ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\[/.test(host);
      var key = source + "|" + u;
      if (seen[key]) return; seen[key] = 1;
      var flags = [];
      if (userinfo) flags.push("userinfo");
      if (ip) flags.push("ip_host");
      if (hostIn(host, P.shorteners.map(function (d) { return "~" + d; }))) flags.push("shortener");
      if (hostIn(host, P.tracking)) flags.push("tracking");
      if (hostIn(host, P.redirects)) flags.push("redirect");
      if (/^http:\/\//i.test(full) && /^http:/i.test(u)) flags.push("http");
      out.push({ raw: u, host: host, registrable: registrable(host), flags: flags, source: source, index: idx });
    }
    var m; URL_RE.lastIndex = 0;
    var b = nfkc(body);
    while ((m = URL_RE.exec(b))) add(m[0], "body", m.index);
    return { urls: out, text: b };
  }
  function findLiteralSchemes(text) {
    var out = [], seen = {}, re = /(?:^|[^A-Za-z0-9_])((?:javascript|data)\s*:)/ig, m, s = String(text || "");
    while ((m = re.exec(s))) {
      var scheme = m[1].replace(/\s+/g, "").toLowerCase().replace(/:$/, "");
      if (scheme !== "javascript" && scheme !== "data") continue;
      if (seen[scheme]) continue;
      seen[scheme] = 1;
      out.push(scheme);
      if (out.length >= 5) break;
    }
    return out;
  }

  // ---------- 文単位の要求・否定ガード ----------
  function sentences(text) {
    var out = [], re = /[^。！!？?\n]+[。！!？?]?/g, m;
    while ((m = re.exec(text))) { var s = m[0].trim(); if (s) out.push({ text: s, start: m.index, end: m.index + m[0].length }); }
    return out;
  }
  var REQ = /(してください|して下さい|ください|下さい|願います|お願いします|お願い致します|のうえ|の上|しなさい|せよ|して$)/;
  var NEG = /(しないでください|しないで下さい|ないでください|ないで下さい|ことはありません|ことはございません|一切|決して|求めません|お尋ねしません|お伺いしません|送らないで|教えないで|入力しないで|返信しないで|必要はありません|不要です|操作不要)/;
  var QUOTE = /(詐欺|偽の|偽装|なりすまし|ご注意ください|注意喚起|不審なメール|フィッシング)/;
  function isRequest(s) { return REQ.test(s) && !NEG.test(s) && !QUOTE.test(s); }

  var SECRET = /(ワンタイムパスワード|ワンタイム|認証コード|確認コード|セキュリティコード|OTP|暗証番号|CVV|CVC|カード番号|クレジットカード番号|有効期限とセキュリティ|新しいパスワード|パスワード|マイナンバー|口座番号|ログインID|PIN)/i;
  var SECRET_VERB = /(入力|送信|返信|教えて|お知らせ|ご提供|提供|お伝え|伝えて|記入|送って|ご記載|記載|登録)/;
  var APP_SELF = /(アプリを(ご)?自分で開|自分で開|ブックマーク|公式アプリから|公式アプリを開)/;
  var LINKWORD = /(こちら|下記|以下|ボタン|リンク|URL|ＵＲＬ|タップ|クリック)/i;

  function nameRegex(name, shortAscii) {
    var e = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (/^[A-Za-z0-9 .!\-]+$/.test(name)) return new RegExp("(^|[^A-Za-z0-9])" + e + "(?![A-Za-z0-9])", shortAscii ? "" : "i");
    return new RegExp("()" + e);
  }
  var CLAIM_CTX = /^(\s|様)?(?:です|でございます|より|から(?:の)?(?:お知らせ|ご案内|ご連絡|重要)|カスタマー|サポート|事務局|運営|セキュリティ|アカウント|会員|サービス|センター|お客様|株式会社|公式|ヘルプ|本部|管理)/;
  var MERCHANT = /(マーケットプレイス|出品者)\s*\S+|\s+\S+(店|ショップ|SHOP|shop)(\s|$)/;

  /* 自称・店舗・言及の分離（§4.1） */
  function detectClaims(display, body, P) {
    var dn = nfkc(display || "").trim(), bd = nfkc(body || "");
    var names = [];
    P.brands.forEach(function (b) { b.names.forEach(function (n) { names.push({ b: b, n: n }); }); });
    names.sort(function (x, y) { return y.n.length - x.n.length; });
    var sender = [], merchant = [], mention = [];
    function scan(text, isDisplay) {
      var used = [];
      names.forEach(function (o) {
        var re = nameRegex(o.n, o.b.shortAscii), m = re.exec(text);
        if (!m) return;
        var st = m.index + m[1].length, en = st + o.n.length;
        if (used.some(function (u) { return st < u[1] && en > u[0]; })) return;
        used.push([st, en]);
        var after = text.slice(en, en + 24), before = text.slice(Math.max(0, st - 4), st);
        var rec = { brand: o.b, name: o.n, where: isDisplay ? "display" : "body" };
        if (o.b.mall || o.b.id === "amazon_jp") {
          if (MERCHANT.test(after) && !/(本部|アカウント管理|カスタマー|サポート|事務局)/.test(after)) { merchant.push(rec); return; }
        }
        if (o.b.shortAscii) { // au/NHK等: 主体文脈を要求
          if (!(isDisplay ? text.trim().length <= o.n.length + 12 : CLAIM_CTX.test(after))) { mention.push(rec); return; }
        }
        if (isDisplay) { sender.push(rec); return; }
        var lineStart = text.lastIndexOf("\n", st) + 1;
        var prefix = text.slice(lineStart, st);
        var signature = text.slice(en).trim() === "" || /^[\s　]*$/.test(text.slice(en, text.indexOf("\n", en) < 0 ? text.length : text.indexOf("\n", en)));
        if (CLAIM_CTX.test(after) || /【$/.test(before) || /発行元[:：]\s*$/.test(prefix) || (signature && prefix.trim().length <= 2 && lineStart > 0)) sender.push(rec);
        else mention.push(rec);
      });
    }
    if (dn) scan(dn, true);
    scan(bd, false);
    // 親子重複: 子ブランドがあれば親の重ね自称を外す
    var ids = sender.map(function (c) { return c.brand.id; });
    sender = sender.filter(function (c, i) {
      if (ids.indexOf(c.brand.id) !== i) return false;
      if (c.brand.id === "rakuten_market" && ids.some(function (x) { return /^rakuten_/.test(x) && x !== "rakuten_market"; })) return false;
      if (c.brand.id === "paypay" && ids.some(function (x) { return /^paypay_/.test(x); })) return false;
      if (c.brand.id === "nta_general" && ids.indexOf("nta_etax") >= 0) return false;
      return true;
    });
    return { sender: sender, merchant: merchant, mention: mention };
  }

  // ---------- 送信元／URLとブランドの関係 ----------
  function fromRelation(sender, b, P) {
    var h = sender.host;
    if (hostIn(h, b.send) || addrIn(sender.addr, b.send) || hostIn(h, b.sendExceptions || [])) return { rel: "send_matched" };
    if (hostIn(h, b.pending)) return { rel: "pending" };
    if (hasAddrRule(b.send) && b.e03r && hostIn(h, b.web)) return { rel: "web_aligned" };
    if (hostIn(h, b.web)) return { rel: "web_aligned" };
    if (hostIn(h, P.freeMail.map(function (d) { return "~" + d; }))) return { rel: "free" };
    if (hostIn(h, P.otherEntities)) return { rel: "other_entity" };
    if (b.state !== "verified" || !b.anchors.length) return { rel: "unknown_" + b.state };
    var lx = lexical(h, b.anchors);
    if (lx.rel === "typo") return { rel: "typo", tid: lx.tid, anchor: lx.detail };
    if (lx.rel === "related") return { rel: "related" };
    return { rel: "unrelated" };
  }
  function urlRelation(u, b, P, scopedFor) {
    if (u.flags.indexOf("shortener") >= 0 || u.flags.indexOf("tracking") >= 0 || u.flags.indexOf("redirect") >= 0) {
      return { rel: "opaque", scoped: !!scopedFor(u) };
    }
    if (u.flags.indexOf("ip_host") >= 0) return { rel: "unknown_ip" };
    if (hostIn(u.host, b.web)) return { rel: "official_web" };
    if (hostIn(u.host, b.pending)) return { rel: "pending" };
    if (hostIn(u.host, P.otherEntities)) return { rel: "other_entity" };
    if (b.state !== "verified" || !b.anchors.length) return { rel: "unknown_" + b.state };
    var lx = lexical(u.host, b.anchors);
    if (lx.rel === "typo") return { rel: "typo", tid: lx.tid };
    if (lx.rel === "related") return { rel: "related_unverified" };
    return { rel: "unrelated" };
  }

  // ---------- 第1段階（説明専用。addEv / addComp / 危険度には触らない） ----------
  var URL_LIMITS = [
    "評価しているのは、本文や入力欄に見えているURL文字列だけです。表示文字と実際のhrefの違いは、hrefが入力にないため確認できません。",
    "台帳と一致して見えても、それは見える文字列上の一致だけです。実際のリンク先や送信者の正当性は確認していません。",
    "正規のホストに見えても、公開ストレージ、フォーム、文書共有、乗っ取られたアカウントの悪用は区別できません。URLの構造は安全の根拠にしません。",
    "公開サフィックス一覧の private 区画を完全には同梱していないため、eTLD+1 を運営者の単位としては使いません。別テナントを同一運営とは判断しません。登録境界は不明です。",
    "同じホストでも、パスごとのテナントや利用者の投稿は区別できず、内容の正当性は証明できません。",
    "短縮URLの展開、DNS照会、転送先、QR、添付、評判の照会はしていません。",
    "末尾の句読点や括弧の切り違い、本文の途切れがあり得ます。"
  ];
  function visibleLedgerMatch(host, brand) {
    if (!brand) return { match: "none", role: null };
    if (hostIn(host, brand.web || [])) return { match: "visible_string_only", role: "web" };
    if (hostIn(host, brand.send || [])) return { match: "visible_string_only", role: "send" };
    if (hostIn(host, brand.pending || [])) return { match: "visible_string_only", role: "pending" };
    return { match: "none", role: null };
  }
  function boundaryOf(host) {
    return {
      real_host: host || "",
      etld1: null,
      etld1_status: "unknown",
      etld1_reason: "psl_private_section_not_fully_bundled",
      operator_id: null,
      used_as_operator: false,
      same_operator: false,
      comparison: "normalized_host_or_ledger_suffix",
      approx_suffix_not_operator: host ? registrable(host) : ""
    };
  }
  function isCitation(s) {
    return /(と書か|と書い|という文|という指示|というメール|引用します|例として|詐欺メール|フィッシングメール|フィッシングでは)/.test(s);
  }
  function actionableText(text) {
    if (!text || isCitation(text)) return "";
    return text.split(/[、，,\n]/).filter(function (c) {
      if (/(完了しました|完了しています|受け付けました|設定済みです|操作は不要)/.test(c) && !/(してください|して下さい|開いて|実行して)/.test(c)) return false;
      if (/(ご注意ください|注意喚起|注意してください)/.test(c) && !/(してください|して下さい|開いて|実行して|インストールして)/.test(c)) return false;
      if (/(しないで|しないこと|しません|開かない|実行しない|有効にしない|インストールしない|クリックしない|展開しない|してはいけません|添付しません)/.test(c)) {
        var rest = c.replace(/[^、]{0,40}(しないでください|しないで下さい|ないでください|ないで下さい|しないで|しないこと|しません|開かない|実行しない|有効にしない|インストールしない|クリックしない|展開しない|してはいけません|添付しません)/g, " ");
        return /(してください|して下さい|開いて実行|実行してください|インストールしてください)/.test(rest);
      }
      return true;
    }).join(" ");
  }
  function isOrdinaryStoreInstall(text) {
    if (!/(App\s*Store|Google\s*Play|Play\s*ストア|公式アプリストア)/i.test(text)) return false;
    if (/(AnyDesk|TeamViewer|powershell|マクロ|コマンドを実行|cmd\.exe|\.exe|\.scr|\.apk|構成プロファイル|mobileconfig)/i.test(text)) return false;
    return true;
  }
  function positiveExec(text) {
    if (!text || isOrdinaryStoreInstall(text)) return null;
    if (!/(してください|して下さい|開いて|実行して|インストールして|貼り付けて)/.test(text)) return null;
    var hits = [];
    if (/マクロ/.test(text) && /有効/.test(text) && !/有効にしない/.test(text)) hits.push("macro");
    var passwordZip = /(パスワード付き\s*ZIP|パスワード付きZIP|パスワード付ZIP)/i.test(text);
    var zipWord = passwordZip || /(?:\bZIP\b|ＺＩＰ|圧縮ファイル)/i.test(text);
    var runProg = /(実行してください|実行して|起動して|ダブルクリック)/.test(text);
    var openIt = /(開いて|開封して|展開して|開封|展開)/.test(text);
    if (passwordZip && (openIt || runProg || /実行/.test(text))) hits.push("zip_password");
    else if (zipWord && runProg) hits.push("zip_run");
    if (/(powershell|コマンドプロンプト|cmd\.exe|Win\s*\+\s*R|ファイル名を指定して実行)/i.test(text) && /(実行|貼り付)/.test(text)) hits.push("clickfix");
    if (/(AnyDesk|TeamViewer|遠隔操作|リモート操作)/i.test(text) && /(インストール|実行|起動)/.test(text)) hits.push("remote");
    if (/\.(exe|scr|bat|cmd|vbs)(\s|$|を)/i.test(text) && /(実行|起動|開)/.test(text)) hits.push("exe");
    if (/(?:\.apk\b|apkを)/i.test(text) && /(インストール|実行|開)/.test(text)) hits.push("apk");
    if (/(構成プロファイル|mobileconfig)/i.test(text) && /(インストール|開|導入)/.test(text)) hits.push("profile");
    return hits.length ? hits : null;
  }
  function buildPurpose(body, ev) {
    var tags = [];
    var sents = sentences(body || "");
    var adSpan = "";
    var adImp = false, adObj = false;
    var execRules = [], execSpans = [], zipPassword = false, sawExec = false;
    var credRules = [], credSpans = [], sawCred = false;
    function addExec(hits, raw) {
      hits.forEach(function (h) {
        if (h === "macro") {
          if (ev.some(function (e) { return e.rule_id === "A05"; }) && execRules.indexOf("A05") < 0) execRules.push("A05");
          if (ev.some(function (e) { return e.rule_id === "B07"; }) && execRules.indexOf("B07") < 0) execRules.push("B07");
        }
        if ((h === "zip_password" || h === "zip_run") && execRules.indexOf("OBS_ZIP_EXEC") < 0) execRules.push("OBS_ZIP_EXEC");
        if (h === "zip_password") zipPassword = true;
        if (h === "clickfix") {
          if (execRules.indexOf("OBS_CLICKFIX") < 0) execRules.push("OBS_CLICKFIX");
          if (ev.some(function (e) { return e.rule_id === "A05"; }) && execRules.indexOf("A05") < 0) execRules.push("A05");
        }
        if (h === "remote") {
          if (ev.some(function (e) { return e.rule_id === "A05"; }) && execRules.indexOf("A05") < 0) execRules.push("A05");
          if (execRules.indexOf("OBS_REMOTE") < 0) execRules.push("OBS_REMOTE");
        }
        if (h === "exe") {
          if (ev.some(function (e) { return e.rule_id === "B07"; }) && execRules.indexOf("B07") < 0) execRules.push("B07");
          if (execRules.indexOf("OBS_EXE") < 0) execRules.push("OBS_EXE");
        }
        if (h === "apk" && execRules.indexOf("OBS_APK") < 0) execRules.push("OBS_APK");
        if (h === "profile" && execRules.indexOf("OBS_PROFILE") < 0) execRules.push("OBS_PROFILE");
      });
      sawExec = true;
      var sp = redactSpan(raw);
      if (sp && execSpans.length < 3 && execSpans.indexOf(sp) < 0) execSpans.push(sp);
    }
    sents.forEach(function (s, i) {
      if (isCitation(s.text)) return;
      var t = actionableText(s.text);
      if (/(ご購入ください|お買い求めください|購入してください|お申し込みください|ご注文ください)/.test(t)) { adImp = true; adSpan = adSpan || s.text; }
      if (/(新商品|セール|割引|キャンペーン|期間限定|おすすめ商品)/.test(t)) adObj = true;
      var hits = positiveExec(t);
      if (hits) addExec(hits, s.text);
      else if (i + 1 < sents.length && !isCitation(sents[i + 1].text) && s.text.length <= 80 && sents[i + 1].text.length <= 80) {
        var next = actionableText(sents[i + 1].text);
        if (!positiveExec(next)) {
          var pair = positiveExec(actionableText(s.text + "\n" + sents[i + 1].text));
          if (pair) addExec(pair, s.text + " " + sents[i + 1].text);
        }
      }
      var device = /(デバイスコード|device\s*code)/i.test(t) && /(入力|貼り付け|送信|教えて)/.test(t);
      var oauth = /(OAuth|認可コード|同意画面)/i.test(t) && /(入力|同意|許可|サインイン)/.test(t) && /(コード|トークン|許可|同意)/.test(t);
      if (device || oauth) {
        sawCred = true;
        if (device && ev.some(function (e) { return e.rule_id === "A06"; }) && credRules.indexOf("A06") < 0) credRules.push("A06");
        if (oauth && credRules.indexOf("OBS_OAUTH") < 0) credRules.push("OBS_OAUTH");
        var csp = redactSpan(s.text);
        if (csp && credSpans.length < 3) credSpans.push(csp);
      }
    });
    if (adImp && adObj) {
      tags.push({
        tag: "advertising_or_bulk",
        rule_ids: ["OBS_AD"],
        spans: adSpan ? [redactSpan(adSpan)] : [],
        explanation: "商品やサービスの宣伝・一斉配信型の文面の特徴があります。未承諾の広告かどうかは、この入力だけでは確認できません。"
      });
    }
    if (sawExec) {
      var expl = "アプリやコマンド等の実行を促す文面の特徴があります。マルウェアの有無や感染は、この入力からは確認できません。添付やリンクを開かず、公式アプリやブックマークから確認してください。";
      if (zipPassword) expl += "入力には、パスワード付きの圧縮ファイルを開くか実行する依頼がありました。ファイルがあること自体を悪性と断定したものではありません。";
      tags.push({ tag: "malware_or_execution", rule_ids: execRules, spans: execSpans, explanation: expl });
    }
    ["A01", "A02", "A03", "B04"].forEach(function (id) {
      if (ev.some(function (e) { return e.rule_id === id; }) && credRules.indexOf(id) < 0) credRules.push(id);
    });
    if (credRules.some(function (id) { return id === "A01" || id === "A02" || id === "A03" || id === "B04"; })) sawCred = true;
    if (sawCred) {
      var cexpl = "認証情報や支払い情報の入力・送信を促す文面の特徴があります。この入力だけでは、本物の手続きかどうかは確認できません。";
      if (credRules.indexOf("A06") >= 0 || credRules.indexOf("OBS_OAUTH") >= 0) cexpl += "デバイスコードやOAuthの誘導は、感染ではなく認証情報の目的候補です。";
      tags.push({ tag: "credential_or_payment", rule_ids: credRules, spans: credSpans, explanation: cexpl });
    }
    if (!tags.length) {
      tags.push({
        tag: "unknown",
        rule_ids: [],
        spans: [],
        explanation: "根拠のある目的の候補はありません。タグがないことは、安全である証明ではありません。感染しているか、添付ファイルの中身が何かは、この入力からは確認できません。"
      });
    }
    return tags;
  }
  function buildUrlAssessments(urls, ctas, ev, comps, urlRels, claim, body) {
    var items = [];
    var ctaByKey = {};
    ctas.forEach(function (c) {
      (c.urls || []).forEach(function (u) {
        var k = u.source + "|" + u.raw;
        if (!ctaByKey[k]) ctaByKey[k] = [];
        ctaByKey[k].push(c);
      });
    });
    urls.forEach(function (u, idx) {
      var features = [];
      function addF(id, text) { features.push({ id: id, text: text }); }
      if (u.flags.indexOf("userinfo") >= 0) addF("userinfo", "URLに利用者情報（@の前）が含まれ、接続先を見誤りやすい形です。この特徴だけでは悪性と判断しません。");
      if (u.flags.indexOf("ip_host") >= 0) addF("ip_host", "ホストがIPアドレスの形です。この特徴だけでは悪性と判断しません。");
      if ((u.host || "").indexOf("xn--") >= 0) addF("punycode", "ホストにpunycode（xn--）が含まれます。この特徴だけでは悪性と判断しません。");
      if (u.flags.indexOf("shortener") >= 0) addF("shortener", "短縮URLの形です。展開していないため最終的な行き先は不明です。この特徴だけでは悪性と判断しません。");
      if (u.flags.indexOf("tracking") >= 0) addF("tracking", "計測用とされるホストの台帳に含まれます。中身は確認していません。この特徴だけでは悪性と判断しません。");
      if (u.flags.indexOf("redirect") >= 0) addF("redirect", "転送用とされるホストです。転送先は展開していません。この特徴だけでは悪性と判断しません。");
      if (u.flags.indexOf("http") >= 0) addF("http", "http（暗号化されていない表記）です。この特徴だけでは悪性と判断しません。");
      if (/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/.test(u.raw)) addF("invisible", "URL文字列に見えない文字が含まれます。この特徴だけでは悪性と判断しません。");
      var led = visibleLedgerMatch(u.host, claim && claim.brand);
      var matchNote;
      if (!claim) matchNote = "送り主の名乗りと台帳を一対にできなかったため、公式かどうかは不明です。比較しているのは実ホストだけで、eTLD+1 では判断しません。";
      else if (led.match === "visible_string_only") matchNote = "見える文字列のホストが、台帳の許すホスト境界（完全一致、または台帳に書かれたサブドメイン）と一致しました。これは見える文字列上の一致だけであり、実際のhref・送信者・安全性は確認していません。";
      else matchNote = "実ホストは、名乗っている組織の台帳が許すホスト境界（完全一致、または台帳に書かれたサブドメイン）と一致しません。左側のラベルや eTLD+1 の近似では公式にしません。";
      var ctaNotes = [], ctaRules = [];
      (ctaByKey[u.source + "|" + u.raw] || []).forEach(function (c) {
        if (c.q && c.q.a01) citeRule("A01", ev, ctaRules, ctaNotes);
        if (c.q && c.q.b04) citeRule("B04", ev, ctaRules, ctaNotes);
        comps.forEach(function (comp) {
          if (comp.cta_id === c.idx && comp.note && ctaNotes.indexOf(comp.note) < 0) {
            ctaNotes.push(comp.note);
            if (ctaRules.indexOf(comp.rule_id) < 0) ctaRules.push(comp.rule_id);
          }
        });
      });
      var existingNotes = [], existingRules = [];
      ev.forEach(function (e) {
        if (!e.note || e.note.indexOf(u.host) < 0) return;
        if (e.family === "F_url_mismatch" || e.rule_id === "SHORT" || e.rule_id === "A12" || e.rule_id === "T03" || e.rule_id === "T01" || e.rule_id === "T02" || e.rule_id === "T04") {
          if (existingNotes.indexOf(e.note) < 0) existingNotes.push(e.note);
          if (existingRules.indexOf(e.rule_id) < 0) existingRules.push(e.rule_id);
        }
      });
      var rel = urlRels[u.source + "|" + u.raw] || null;
      items.push({
        url_index: idx,
        source: u.source,
        display: redactUrl(u.raw),
        host: u.host,
        boundary: boundaryOf(u.host),
        ledger_match: led.match,
        ledger_role: led.role,
        ledger_relation: rel ? rel.rel : null,
        match_note: matchNote,
        features: features,
        cta_rule_ids: ctaRules,
        cta_notes: ctaNotes,
        existing_rule_ids: existingRules,
        existing_notes: existingNotes,
        unknowns: URL_LIMITS.slice(),
        structure_not_conclusive: true,
        fetched: false,
        executed: false
      });
    });
    var seenScheme = {};
    findLiteralSchemes(body).forEach(function (scheme) {
      if (seenScheme[scheme]) return;
      seenScheme[scheme] = 1;
      var label = scheme === "data"
        ? "data: で始まる文字列です。リンクにせず、中身を読み込んでいません。この文字列だけでは悪性と判断しません。"
        : "javascript: で始まる文字列です。リンクにせず、実行していません。この文字列だけでは悪性と判断しません。";
      items.push({
        url_index: null,
        source: "literal_scheme",
        display: scheme + ":＊＊＊",
        host: "",
        boundary: boundaryOf(""),
        ledger_match: "none",
        ledger_role: null,
        ledger_relation: null,
        match_note: "スクリプトやデータの文字列であり、リンク先としては扱いません。",
        features: [{ id: scheme, text: label }],
        cta_rule_ids: [],
        cta_notes: [],
        existing_rule_ids: [],
        existing_notes: [],
        unknowns: URL_LIMITS.slice(),
        structure_not_conclusive: true,
        fetched: false,
        executed: false
      });
    });
    var unmatched = [];
    ctas.forEach(function (c) {
      if (c.route === "missing" || !c.urls || !c.urls.length) {
        unmatched.push({
          rule_ids: c.viewOnly ? ["A04"] : [],
          span: redactSpan(c.text),
          note: "この行動要求に対応するURL文字列は取れていません。ほかのURLがあっても、この要求は消していません。"
        });
      }
    });
    return { items: items, unmatched: unmatched, limits: URL_LIMITS.slice() };
  }
  function citeRule(ruleId, ev, rules, notes) {
    var e = null, i;
    for (i = 0; i < ev.length; i++) if (ev[i].rule_id === ruleId) { e = ev[i]; break; }
    if (!e) return;
    if (rules.indexOf(ruleId) < 0) rules.push(ruleId);
    if (e.note && notes.indexOf(e.note) < 0) notes.push(e.note);
  }

  // ---------- メイン ----------
  function judge(input, opts) {
    opts = opts || {};
    var P = opts.protocol || g.MH_PROTOCOL;
    var routeEnabled = opts.routeEnabled === true; // テスト用モック。本番は常にfalse
    var res = {
      schema_version: P.schema_version, verdict: null, danger_level: "N", confidence_band: "low",
      channel: "email", context_answer: "unknown", sender_kind: "unknown", safety_guarantees: false,
      input_issues: [], evidence: [], composite_rules: [], namespace_assessments: [], route_assessments: [],
      gate_evaluations: [], auxiliary_flags: [], context_evidence: [], unknowns: [], urls_parsed: [],
      disclaimer_ja: "本結果は入力された文字情報だけに基づく補助的な判定で、安全性や正当性を保証するものではありません。",
      recommended_actions_ja: [], privacy: { retention: "minimize", mask: ["otp", "card", "account", "phone"] }
    };
    // --- 入力検証（§2.2） ---
    var ch = "email";
    if (input.channel === "sms") res.unknowns.push("sms_channel_not_supported");
    else if (input.channel && input.channel !== "email") res.input_issues.push("channel_invalid");
    res.channel = ch;
    var ctx = input.context_answer;
    if (ctx === "yes" || ctx === "no" || ctx === "unknown") res.context_answer = ctx;
    else { res.input_issues.push("context_invalid"); res.context_answer = "unknown"; }
    res.context_evidence.push({ kind: "user_self_report", value: res.context_answer });
    var body = nfkc(input.body || "");
    if (!body.trim()) res.input_issues.push("body_empty");
    var display = nfkc(input.display_name || "");
    var sender = null;
    sender = parseEmail(input.from_email || "");
    if (!sender) res.input_issues.push("from_unparseable"); else res.sender_kind = "email";
    res.unknowns.push("sender_auth_unavailable", "html_href_unavailable");
    var isEmail = sender && sender.kind === "email";
    var chName = "メール";

    var ev = [], aux = {}, comps = [];
    function addEv(rule, family, key, strength, mismatch, note, basis, extra) {
      var e = { rule_id: rule, matched_rule_ids: [rule], family: family, evidence_key: key, strength: strength, is_mismatch: !!mismatch, spans: (extra && extra.spans) || [], basis: basis || "official_support", note: note };
      var ex = ev.filter(function (x) { return x.evidence_key === key; })[0];
      if (ex) { // dedupe: maxで1つ、履歴は残す
        if (ex.matched_rule_ids.indexOf(rule) < 0) ex.matched_rule_ids.push(rule);
        if (W[strength] > W[ex.strength]) { ex.strength = strength; ex.rule_id = rule; ex.note = note; }
        ex.is_mismatch = ex.is_mismatch || !!mismatch; return ex;
      }
      ev.push(e); return e;
    }
    function addComp(id, policy, note, isNew) {
      var eff = policy;
      var c = { rule_id: id, policy_level: policy, effective_level: eff, note: note, gate_ids: [] };
      if (isNew && policy === "S" && !routeEnabled) {
        c.effective_level = "M"; c.shadow = true;
        c.gate_ids = /^P16s$/.test(id) ? ["G0", "G1b", "G2", "G3"] : /^P16/.test(id) ? ["G0", "G1b", "G3"] : ["G0", "G4"];
        res.gate_evaluations.push({ rule_id: id, route_enabled: false, failed_gate_ids: c.gate_ids, note: "稼働ゲート未達のため内部shadow S、表示はM" });
      }
      comps.push(c); return c;
    }

    var ex = extractUrls(body, P);
    var urls = ex.urls;
    res.urls_parsed = urls.map(function (u) { return { raw: redactUrl(u.raw), host: u.host, registrable: u.registrable, flags: u.flags.slice(), source: u.source }; });
    var sents = sentences(body);
    var claims = detectClaims(display, body, P);
    var claim = claims.sender[0] || null;
    var hasClaim = !!claim;
    if (claims.sender.length || claims.merchant.length) res.unknowns.push("ledger_incomplete");
    if (claims.sender.length >= 2) {
      var distinct = claims.sender.filter(function (c) { return !c.brand.publicAgency; }).map(function (c) { return c.brand.id.split("_")[0]; });
      var uniq = distinct.filter(function (x, i) { return distinct.indexOf(x) === i; });
      if (uniq.length >= 2 && !/(配送|お届け|代行|提携|経由)/.test(body))
        addEv("A08", "F_other", "other:multi_claim", "medium", false, "無関係な複数の会社・機関（" + claims.sender.map(function (c) { return c.brand.label; }).join("・") + "）を同時に名乗っています。");
    }
    function urlsInSent(s) { return urls.filter(function (u) { return u.source === "body" && u.index >= s.start && u.index < s.end; }); }

    // --- 本文ルール（文単位） ---
    var hasAddressee = /(様|さま|殿|さん)([\s、,。]|$)/.test(body);
    var f = { A01x: false, B04: false, L: false, U1: false, U2: false, U3: true, reply_secret: false, A02: false };
    var ctas = [];
    var dateRe = /(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/;
    if (dateRe.test(body)) f.U3 = false;
    sents.forEach(function (s, i) {
      var t = s.text, req = isRequest(t);
      var su = urlsInSent(s);
      var adj = [];
      if (!su.length && /(下記|以下|次の)/.test(t) && sents[i + 1]) adj = urlsInSent(sents[i + 1]);
      var linked = su.concat(adj);
      var selfOpen = APP_SELF.test(t);
      var route = linked.length ? "url" : (selfOpen ? "app" : (LINKWORD.test(t) ? "missing" : "none"));
      var q = { a01: false, b04: false, l: false };
      // A01_explicit
      if (req && SECRET.test(t) && SECRET_VERB.test(t) && !/(末尾\s*\d|下\s*4\s*桁|発行しました|お知らせします|です。?$)/.test(t)) {
        if (!/(パスワード.{0,3}(再設定|変更)|再設定)/.test(t) || /新しいパスワード.{0,6}入力|パスワードを入力/.test(t) || /(コード|暗証|CVV|カード番号)/i.test(t)) {
          q.a01 = true; f.A01x = true;
          var replyish = /(返信|このメール|ご返送|メッセージで|電話で|お伝え|伝えて|メールで|送って|送信してください|reply@|@)/.test(t) && route !== "url";
          if (replyish) f.reply_secret = true;
          addEv("A01", "F_identity", "identity:secret", "medium", false, "認証コード・暗証番号・カード番号・パスワード等の具体的な秘密情報の入力や送信を求めています。", "official_support", { spans: [t] });
        }
      }
      // B04
      if ((req || (/(しないと|しない場合|されない場合)/.test(t) && !NEG.test(t) && !QUOTE.test(t))) && /(カード|クレジット|お支払い方法|支払方法|支払い方法|決済方法)/.test(t) && /(再登録|登録し直|情報.{0,2}更新|を更新|の更新|再設定|情報.{0,2}変更)/.test(t) && !/(完了|しました|受け付けました|ご確認ください$)/.test(t)) {
        q.b04 = true; f.B04 = true;
        addEv("B04", "F_identity", "identity:card_update", "medium", false, "カード情報の再登録・更新を求めています。");
      }
      // L（能動的な再認証・本人確認・制限解除・パスワード再設定）
      if (req && route !== "app" && route !== "none" && /(再認証|本人確認|制限解除|ロック解除|再ログイン|ログイン|サインイン|パスワード.{0,4}再設定|再設定|アカウント.{0,4}(確認|認証))/.test(t) && !/(ご覧|閲覧|購入履歴|内容をご確認)/.test(t)) {
        q.l = true; f.L = true;
      }
      // 急迫（U_high要素）
      if (/(今すぐ|直ちに|ただちに|至急|即時|即座|即日|本日中|今日中|\d+\s*時間以内|すぐに)/.test(t) && !/有効期限は/.test(t) && !QUOTE.test(t)) f.U1 = true;
      if (/(凍結|利用停止|停止|強制解約|解約|差押|差し押さえ|制限|ロック|永久|閉鎖|無効)/.test(t) && /(しないと|しない場合|されない場合|なければ|ないと|恐れ|されます|します|いたします|となります|になります)/.test(t) && !QUOTE.test(t) && !NEG.test(t)) f.U2 = true;
      // A02
      if (/(ギフトカード|ギフト券|ギフトコード|プリペイドカード|電子マネー|iTunesカード|Google\s*Playカード|Apple\s*Gift\s*Card)/i.test(t) && /(番号|コード|PIN|裏面)/i.test(t) && /(送|返信|教えて|入力|お知らせ|撮影|伝え)/.test(t) && req) {
        f.A02 = true; addEv("A02", "F_money", "money:gift_code", "strong", false, "ギフトカード等の番号・コードの送信や入力を求めています（詐欺でよく使われる手口です）。");
      }
      if (/(振込先|振込口座|お振込み先).{0,8}(変更|変わり)/.test(t) && !NEG.test(t) && !QUOTE.test(t)) { f.A02 = true; addEv("A02", "F_money", "money:payee_change", "strong", false, "振込先の変更を伝えています。振込前に、既知の連絡先へ別経路で確認してください。"); }
      // A03
      if (req && /(お電話|電話|返信)/.test(t) && /(支払|振込|返金|未納|未払|滞納|料金)/.test(t) && !/(お問い合わせ|問い合わせ窓口)/.test(t))
        addEv("A03", "F_money", "money:phone_only", "medium", false, "電話や返信だけでお金の手続きを済ませるよう求めています。本文の番号には電話しないでください。");
      if (req && !q.a01 && !q.b04 && !NEG.test(t) && !QUOTE.test(t) && /(LINE|ＬＩＮＥ|ライン).{0,16}(友だち|友達|追加|登録)/.test(t))
        addEv("A03L", "F_other", "channel:line", "weak", false, "LINEへの切り替えや友だち追加を求めています。メール内の案内からは開かず、公式アプリで確認してください。");
      if (req && !NEG.test(t) && !QUOTE.test(t) && /(お電話ください|電話してください|電話でご連絡|記載の番号に電話)/.test(t) && !ev.some(function (e) { return e.rule_id === "A03"; }))
        addEv("A03P", "F_other", "channel:phone", "weak", false, "電話での連絡を求めています。本文に書かれた番号には電話しないでください。");
      // A05 / A06
      if (req && /(遠隔操作|リモート操作|AnyDesk|TeamViewer|アプリをインストール|インストールしてください|コマンドを実行|マクロを有効)/i.test(t))
        addEv("A05", "F_other", "other:remote", "medium", false, "遠隔操作アプリのインストールやマクロ・コマンドの実行を求めています。");
      if (req && /(デバイスコード|device\s*code)/i.test(t)) addEv("A06", "F_other", "other:device_code", "medium", false, "デバイスコード等の入力・転送を求めています。");
      if (q.a01 || q.b04 || q.l) ctas.push({ idx: i, text: t, route: route, urls: linked, q: q });
      // A04（可視リンク先欠落CTA）
      if (route === "missing" && /(ボタン|こちら|リンク|タップ|クリック)/.test(t) && !selfOpen) {
        ctas.missingSeen = true;
        if (!ctas.some(function (c) { return c.idx === i; })) ctas.push({ idx: i, text: t, route: "missing", urls: [], q: { a01: false, b04: false, l: false }, viewOnly: true });
      }
    });

    ctas.forEach(function (c) {
      if (c.route === "missing") addEv("A04", "F_cta_href", "cta:missing:" + c.idx, "weak", false, "ボタン等の本当の行き先を確認できません。押さないでください。");
    });
    // A04は同じ未観測性をmax1つ
    var a04s = ev.filter(function (e) { return e.rule_id === "A04"; });
    if (a04s.length > 1) { ev = ev.filter(function (e) { return e.rule_id !== "A04"; }); a04s[0].evidence_key = "cta:missing"; ev.push(a04s[0]); }
    var hasA04 = ev.some(function (e) { return e.rule_id === "A04"; });

    f.U_high = (f.U1 ? 1 : 0) + (f.U2 ? 1 : 0) + ((f.U1 || f.U2) && f.U3 ? 1 : 0) >= 2;
    var routine = /(\d+\s*月分|請求番号|\d[\d,]*\s*円)/.test(body) && !f.U3 && /(支払|お支払|更新|請求)/.test(body) && !f.U1 && !f.A01x && !f.reply_secret;
    f.routine_billing = routine;
    // B06（weak）。通常期限通知（routine）・引用は除外
    if ((f.U1 || f.U2) && !routine) addEv("B06", "F_urgency", "urgency", "weak", false, "「今すぐ」「本日中」「停止」などの言葉で手続きを急がせています。");
    // B05 / A10 / B07
    if (/[这您请们账码为您]|。。|、、|様様|頂きますようお願いします|ご確認してください|お客様各位様/.test(body)) addEv("B05", "F_language", "lang", "weak", false, "日本語として不自然な表現（翻訳調・不自然な漢字・句読点）があります。");
    if (/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/.test((input.body || "") + (input.display_name || ""))) addEv("A10", "F_language", "lang", "weak", false, "見えない文字や文字方向を変える制御文字が含まれています。");
    if (/\.(exe|scr|vbs|js|bat|cmd|lnk|iso|docm|xlsm|pptm)(\s|$|[」』）)])|\.(pdf|docx?|xlsx?)\.(exe|scr|js)|マクロを有効/i.test(body)) addEv("B07", "F_attachment", "attachment", "weak", false, "実行ファイルやマクロ付きなど、不審な添付ファイルに触れています。開かないでください。");
    if (/添付/.test(body)) res.unknowns.push("attachment_unverified");

    // 短縮URL・userinfo（§5.4）
    urls.forEach(function (u) {
      if (u.flags.indexOf("shortener") >= 0) addEv("SHORT", "F_cta_href", "cta:short:" + u.host, "weak", false, "短縮URL（" + u.host + "）が使われていて、最終的な行き先を確認できません。");
      if (u.flags.indexOf("userinfo") >= 0) addEv("A12", "F_url_mismatch", "url:userinfo:" + u.host, "medium", false, "「@」を含むURLで、実際の接続先（" + u.host + "）を見誤らせる形になっています。");
    });

    // 補助weak（sender_claim時のみ）
    if (hasClaim) {
      if (/(円|料金|支払|請求|返金|口座|振込)/.test(body)) aux.B01 = 1;
      if (urls.length || LINKWORD.test(body)) { if (!hasA04) aux.B02 = 1; }
      if (!hasAddressee) aux.B03 = 1;
      if (/(配信停止|配信解除|退会)/.test(body)) aux.B08 = 1;
    }

    // --- 送信元（email専用 E*/D*/From T*） ---
    var fromRel = null;
    if (isEmail) {
      if (looksRandom(sender.local) && !/^[a-z]+\d{0,4}$/.test(sender.local))
        addEv("E01", "F_sender_format", "sender_format", "weak", false, "送信元アドレスの@より前（" + sender.local + "）が意味のない文字列に見えます。", "research_proposal");
      var reg = registrable(sender.host), regLabel = reg.split(".")[0];
      var sub = sender.host.slice(0, sender.host.length - reg.length).replace(/\.$/, "");
      if (looksRandom(regLabel)) addEv("E01", "F_sender_format", "sender_format", "weak", false, "送信元のドメイン（" + reg + "）がランダムな文字列に見えます。", "research_proposal");
      else if (sub && sub.split(".").some(looksRandom)) addEv("E01", "F_sender_format", "sender_format", "weak", false, "送信元のサブドメイン（" + sub + "）が意味のない文字列に見えます。", "research_proposal");
      if (claim) {
        var b = claim.brand;
        fromRel = fromRelation(sender, b, P);
        res.namespace_assessments.push({ brand_id: b.id, host: sender.host, role: "sender", state: b.state, relation: fromRel.rel, anchors: b.anchors });
        var key = "sender:" + b.id + ":" + sender.host;
        if (fromRel.rel === "free") addEv("E03c", "F_sender_claim", key, "medium", true, b.label + "を名乗っていますが、送信元がフリーメール（" + sender.host + "）です。");
        if (fromRel.rel === "other_entity") { addEv("D01", "F_sender_claim", key, "medium", true, b.label + "を名乗っていますが、送信元（" + sender.host + "）は別の主体のドメインです。"); }
        if (fromRel.rel === "typo") addEv(fromRel.tid, "F_sender_claim", key, "medium", true, b.label + "を名乗っていますが、送信元に紛らわしい表記（" + sender.host + "）があります。");
        // E03r: 範囲内の完全台帳のみ
        if (b.e03r && ["send_matched", "pending"].indexOf(fromRel.rel) < 0) {
          var inScope = b.e03rScope === "delivery" ? /(配送|お届け|荷物|発送|配達|不在)/.test(body)
            : b.e03rScope === "securities_notice" ? /(約定|取引|口座|入出金|注文)/.test(body) : true;
          if (inScope) addEv("E03r", "F_sender_claim", key, "strong", true, "公式が案内する、この種類の" + chName + "の送信元と一致しません（" + b.label + "、送信元: " + sender.host + "）。");
          else res.unknowns.push("ledger_scope_unknown");
        }
        if (fromRel.rel === "unrelated") {
          res.unknowns.push("namespace_from_unrelated:" + b.id);
          var ex0 = (b.web[0] || "").replace(/^[~@]/, "");
          addEv("NS_from", "F_info", "info:from_ns:" + b.id, "none", false, b.label + "を名乗っていますが、送信元（" + sender.host + "）は" + b.label + "の確認済みドメイン" + (ex0 ? "（例: " + ex0 + "）" : "") + "と結びつきません。公式の送信元一覧は完全ではないため、これだけで非公式と確定したものではありません。", "official_support");
        }
        if (/^unknown_/.test(fromRel.rel)) res.unknowns.push("namespace_unavailable");
      }
      // 表示名とlocal-partの具体的他者偽装（D02）: 例 amazon を名乗る local に別ブランド
    }
    // D03: 表示名のホモグリフ
    if (display) {
      var dl = norm(display), mixed = /[a-z]/i.test(display) && /[\u0400-\u04FF]/.test(display);
      P.brands.forEach(function (b) {
        b.names.forEach(function (n) {
          if (!/^[A-Za-z]{5,}/.test(n)) return;
          var nl = n.toLowerCase();
          var tok = dl.split(/[^a-z0-9\u0400-\u04ff]+/).filter(Boolean);
          tok.forEach(function (t) { if (t !== nl && deHomoglyph(t) === nl) addEv("D03", "F_display_other", "display:" + b.id, "medium", true, "表示名の「" + display + "」が" + b.label + "に似せた紛らわしい文字を使っています。"); });
        });
      });
      if (mixed && !ev.some(function (e) { return e.rule_id === "D03"; })) addEv("D03", "F_display_other", "display:mixed", "medium", false, "表示名にラテン文字とキリル文字が混在しています。");
    }

    // --- URL側 T*/A07 と関係（全チャネル） ---
    var scopedFor = function (u) {
      return claim && P.scopedRoutes.some(function (r) { return r.brand === claim.brand.id && r.channel === ch && hostIn(u.host, [r.host]) && (!r.purpose || new RegExp(r.purpose).test(body)); });
    };
    var urlRels = {};
    if (claim) {
      urls.forEach(function (u) {
        var r = urlRelation(u, claim.brand, P, scopedFor);
        urlRels[u.source + "|" + u.raw] = r;
        res.namespace_assessments.push({ brand_id: claim.brand.id, host: u.host, role: "url", source: u.source, relation: r.rel });
        var key = "url:" + claim.brand.id + ":" + u.host + ":deception";
        if (r.rel === "typo") addEv(r.tid, "F_url_mismatch", key, "medium", true, claim.brand.label + "を名乗っていますが、リンク先（" + u.host + "）が" + claim.brand.label + "に似せた紛らわしいドメインです。");
        if (r.rel === "other_entity") addEv("A07", "F_url_mismatch", key, "medium", true, claim.brand.label + "を名乗っていますが、リンク先（" + u.host + "）は別の主体のドメインです。");
        if (r.rel === "unrelated") res.unknowns.push("namespace_url_unrelated:" + u.host);
      });
    }

    // --- A11（§7.5の有効行のみ） ---
    if (claim) {
      var bid = claim.brand.id, a11 = claim.brand.a11;
      var a11note = function (act) { return claim.brand.label + "は、この" + chName + "で" + act + "を行わないと案内しています。"; };
      if (a11.indexOf("yamato_email_phrases") >= 0 && /(お届け先情報が不完全です|配送先住所が間違っています|配達失敗通知|配送中止のお知らせ)/.test(body) && !QUOTE.test(body)) addEv("A11", "F_official_policy", "a11:yamato:email", "strong", false, a11note("このような配送通知メール"));
      if (a11.indexOf("nta_demand") >= 0) {
        var etaxNotice = /(メッセージボックス|格納|登録到達確認|宛名確認|再設定)/.test(body);
        var demand = sents.some(function (s) { return /(納付|納税|未納|滞納|差押|差し押さえ|お支払)/.test(s.text) && (isRequest(s.text) || /(差押|差し押さえ).{0,10}(します|いたします|となります|執行)/.test(s.text)) && !QUOTE.test(s.text); });
        if (demand && !etaxNotice) addEv("A11", "F_official_policy", "a11:nta:demand", "strong", false, a11note("国税の納付や差押えを求める連絡"));
      }
      if (a11.indexOf("etc_billing") >= 0 && ch === "email" && sents.some(function (s) { return /(請求|未払|未納|料金|お支払)/.test(s.text) && isRequest(s.text); })) addEv("A11", "F_official_policy", "a11:etc:billing", "strong", false, a11note("費用請求のメール"));
      if (a11.indexOf("rakuten_card_number") >= 0 && ch === "email" && sents.some(function (s) { return /カード番号/.test(s.text) && isRequest(s.text) && SECRET_VERB.test(s.text) && !/末尾/.test(s.text); })) addEv("A11", "F_official_policy", "a11:rakuten_card:number", "strong", false, a11note("カード番号の聞き取り"));
      if (a11.indexOf("identity_card") >= 0 && /(本人確認|出金制限)/.test(body) && sents.some(function (s) { return /(カード番号|有効期限|CVV|セキュリティコード|クレジットカード情報)/.test(s.text) && isRequest(s.text); })) addEv("A11", "F_official_policy", "a11:mercari:identity_card", "strong", false, a11note("本人確認でのカード情報入力の要求"));
    }

    // --- P16/P17（CTA単位、§4.8–4.9） ---
    var fromWeak = false, fromUnrel = false, fromFree = false, senderAligned = false, fromTypo = false;
    if (isEmail && fromRel) {
      fromFree = fromRel.rel === "free"; fromUnrel = fromRel.rel === "unrelated"; fromTypo = fromRel.rel === "typo";
      senderAligned = ["send_matched", "web_aligned", "related"].indexOf(fromRel.rel) >= 0;
      fromWeak = fromFree || fromUnrel;
    }
    if (ch === "email" && !sender) fromWeak = true;
    var hasA11 = ev.some(function (e) { return e.rule_id === "A11"; });
    var routineGuard = routine && senderAligned && !fromTypo && !f.A01x && !f.reply_secret && !hasA11;
    f.routine_guard = routineGuard;
    if (claim) {
      ctas.forEach(function (c) {
        var a01 = c.q.a01, b04l = c.q.b04 && (c.route === "url" || c.route === "missing"), L = c.q.l;
        var Q = a01 || b04l || L;
        if (!Q) return;
        var H = a01 || ((b04l || L) && f.U_high && !routine);
        var best = null;
        function cand(id, lvl, note, isNew) { var x = addComp(id, lvl, note, isNew); x.cta_id = c.idx; if (!best || LV[x.effective_level] > LV[best.effective_level]) best = x; }
        var targets = c.route === "missing" ? [{ rel: "opaque", missing: true }] : c.urls.map(function (u) { var r = urlRelation(u, claim.brand, P, scopedFor); r.u = u; return r; });
        res.route_assessments.push({ cta_id: c.idx, link_state: c.route === "missing" ? "missing" : targets.some(function (t) { return t.rel === "opaque"; }) ? "opaque" : c.route, source: "body", reply_request: f.reply_secret });
        targets.forEach(function (t) {
          if (t.rel === "unrelated") {
            if (a01 || (b04l && (f.U_high || fromUnrel || fromFree))) cand("P16uH", routineGuard ? "M" : "S", "名乗った会社の確認済みドメインと結びつかないリンクで、情報入力を求めています。", true);
            else if (L && (f.U_high || fromFree || fromUnrel)) cand("P16uL", routineGuard ? "M" : "S", "名乗った会社の確認済みドメインと結びつかないリンクで、再認証・本人確認を求めています。", true);
            else cand("P16u", "M", "情報の入力・手続きを求めていますが、入力された情報だけでは送信元やリンク先の正当性を確認できません。", true);
          } else if (t.rel === "related_unverified") {
            if (H) cand("P16bH", "S", "会社名に似た未確認のドメインで、強い期限圧力とともに情報入力を求めています。", true);
            else cand("P16b", "M", "会社名を含む未確認のドメインで情報入力を求めています。正当性は確認できません。", true);
          } else if (/^unknown_(candidate|empty)/.test(t.rel)) {
            cand("P16c/f", "M", "情報の入力・手続きを求めていますが、この会社の公式ドメインはこのツールの台帳に未登録で確認できません。", true);
          } else if (t.rel === "opaque") {
            var scopedOK = t.scoped && senderAligned;
            if (a01) cand("P17a", "S", "情報の入力を求めていますが、リンクの最終的な行き先を確認できません。具体的な秘密情報の入力も求めています。送信元が公式に見えても信用しないでください。", true);
            else if (b04l && f.U_high && !routineGuard) cand("P17b", scopedOK ? "M" : "S", "カード情報の更新を急がせていますが、リンクの最終的な行き先を確認できません。", true);
            else if (L && f.U_high && !routineGuard) cand("P17c", scopedOK ? "M" : "S", "再認証を急がせていますが、リンクの最終的な行き先を確認できません。", true);
            else if (!t.missing && L && fromWeak && !t.scoped) cand("P17d", "S", "リンクの最終的な行き先を確認できず、送信元にも不整合があります。", true);
            else cand("P17e", "M", routine ? "請求や更新の案内ですが、リンク先の正当性は確認できません。" : "情報の入力を求めていますが、リンクの最終的な行き先を確認できません。", true);
          }
          // P6/P11/P12: 確認できた欺瞞URL＋機微CTA（既存）
          if (t.rel === "typo" || t.rel === "other_entity") cand("P6/P11/P12", "S", "紛らわしいドメインのリンクで情報入力を求めています。", false);
          // P10: userinfo＋A01/B04、短縮＋A01
          if (t.u && t.u.flags.indexOf("userinfo") >= 0 && (a01 || c.q.b04)) cand("P10", "S", "接続先を見誤らせるURLで情報入力を求めています。", false);
        });
        if (isEmail && fromRel && fromUnrel) {
          if (claim.brand.e03r) cand("P16s", "S", "送信元が名乗った会社の確認済みの送信元と結びつきません。", true);
          else cand("P16s_open", "M", "送信元が名乗った会社の確認済みドメインと結びつきません（公式の送信元一覧は完全ではないため、非公式と確定したわけではありません）。", true);
        }
        if (best) best.selected = true;
      });
      // P17r（秘密の返信・送付要求）
      if (f.reply_secret) addComp("P17r", "S", "認証コードやカード情報などを返信・送信するよう求めています。返信せず別経路で確認してください。", true);
    }
    // 自称なしでも有効な既存P10（短縮＋A01）
    ctas.forEach(function (c) {
      if (c.q.a01 && c.urls.some(function (u) { return u.flags.indexOf("shortener") >= 0; })) addComp("P10", "S", "短縮URLの先で秘密情報の入力を求めています。", false);
    });

    // --- 集計（§4.4–4.5、context不使用） ---
    var score = 0, nWeak = 0, nStrong = 0, mediums = [];
    ev.forEach(function (e) {
      score += W[e.strength];
      if (e.strength === "weak") nWeak++;
      if (e.strength === "strong") nStrong++;
      if (e.strength === "medium") mediums.push(e);
    });
    var nAux = Object.keys(aux).filter(function (k) { return k !== "B08"; }).length;
    res.auxiliary_flags = Object.keys(aux);
    var fams = {}; mediums.forEach(function (m) { fams[m.family] = 1; });
    var level = "N";
    var hasFromMis = ev.some(function (e) { return e.family === "F_sender_claim" && e.strength !== "weak" && e.is_mismatch; });
    var hasUrlMis = ev.some(function (e) { return e.family === "F_url_mismatch" && e.is_mismatch; });
    var linkLure = urls.some(function (u) { return u.source === "body"; }) || hasA04 || ctas.length > 0;
    var comboS = [], comboM = [];
    if (hasClaim && fromRel && fromRel.rel === "free") { if (linkLure || f.U1 || f.U2 || f.A01x || f.B04) comboS.push("P1"); else comboM.push("P1"); }
    if (hasFromMis && ev.some(function (e) { return e.family === "F_sender_claim" && e.rule_id !== "E03r" && e.is_mismatch; }) && (linkLure || f.A02 || f.U1 || f.U2)) comboS.push("P4");
    if (ev.some(function (e) { return e.rule_id === "D03"; }) && hasFromMis) comboS.push("P5");
    if (hasFromMis && hasUrlMis) comboS.push("P13");
    if (hasA04 && ev.some(function (e) { return e.rule_id === "B06"; })) comboM.push("P7");
    if (hasA04 && (f.B04 || f.A01x)) comboM.push("P8");
    if (hasClaim && urls.some(function (u) { return u.flags.indexOf("shortener") >= 0; })) comboM.push("P9");
    if (ev.some(function (e) { return e.rule_id === "B06"; }) && (f.A02 || f.B04 || f.A01x) && aux.B03) comboM.push("P14");
    comboS.forEach(function (id) { addComp(id, "S", "組合せ昇格（§4.5）", false); });
    comboM.forEach(function (id) { addComp(id, "M", "組合せ昇格（§4.5）", false); });

    if (nStrong >= 1) level = "S";
    else if (comboS.length) level = "S";
    else if (Object.keys(fams).length >= 2 && mediums.some(function (m) { return m.is_mismatch; })) level = "S";
    else if (mediums.length >= 1 || score >= 4 || (nWeak >= 2 && hasClaim) || comboM.length) level = "M";
    else if (nWeak >= 1 || nAux >= 2) level = "W";
    comps.forEach(function (c) { if (LV[c.effective_level] > LV[level]) level = c.effective_level; });
    // P16/P17のMは最低M（§4.8.5）
    res.danger_level = level;
    res.evidence = ev;
    res.composite_rules = comps;

    // --- verdict（§4.6–4.7） ---
    var fromMissing = res.input_issues.indexOf("from_unparseable") >= 0;
    var otherBlock = res.input_issues.filter(function (x) { return x !== "context_invalid" && x !== "from_unparseable"; });
    if (fromMissing && !otherBlock.length) res.verdict = "insufficient";
    else if (level === "S") res.verdict = "strong_suspicion";
    else if (otherBlock.length || fromMissing) res.verdict = "insufficient";
    else {
      var c2 = res.context_answer;
      if (level === "M") res.verdict = "needs_review";
      else if (level === "W") {
        if (c2 === "yes") {
          var exc = hasClaim || nWeak >= 2 || hasUrlMis || hasA04 || f.B04 || f.A01x;
          res.verdict = exc ? "needs_review" : "no_clear_signal";
        } else res.verdict = "needs_review";
      } else res.verdict = c2 === "no" ? "needs_review" : "no_clear_signal";
    }
    res.flags = f;
    ev.forEach(function (e) {
      if (e.spans && e.spans.length) e.spans = e.spans.map(redactSpan);
    });
    res.display = buildDisplay(res, ch);
    res.recommended_actions_ja = res.display.actions;
    var stage1 = buildUrlAssessments(urls, ctas, ev, comps, urlRels, claim, body);
    res.purpose_assessment = buildPurpose(body, ev);
    res.url_assessments = stage1.items;
    res.url_limits = stage1.limits;
    res.unmatched_ctas = stage1.unmatched;
    res.statistics = null;
    if (display && !claim) res.unknowns.push("unlisted_brand_claim");
    applyPurposeLead(res);
    applyInputGapLead(res);
    res.subject_display = formatSubject(input.subject);
    res.subject_used_in_score = false;
    return res;
  }
  function formatSubject(raw) {
    var t = String(raw == null ? "" : raw).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
    if (!t) return "（件名なし）";
    if (t.length > 80) return t.slice(0, 80) + "…";
    return t;
  }
  function applyInputGapLead(res) {
    var issues = res.input_issues || [];
    var onlyFrom = issues.indexOf("from_unparseable") >= 0 && issues.every(function (x) { return x === "from_unparseable" || x === "context_invalid"; });
    if (res.verdict === "insufficient" && onlyFrom && (res.danger_level === "M" || res.danger_level === "S")) {
      res.display.input_gap_lead = {
        headline: "入力が足りませんが、注意すべき特徴があります",
        body: "メールに記載されたアドレスが読み取れませんでした。スマホでは差出人の詳細表示から From を確認してください。下に、本文側で検出した注意点があります。アドレス未入力でも安全という意味ではありません。"
      };
    }
  }
  function applyPurposeLead(res) {
    var exec = (res.purpose_assessment || []).filter(function (p) { return p.tag === "malware_or_execution"; })[0];
    res.display.lead = null;
    if (!exec) return;
    res.display.lead = {
      headline: "先に読んでください：操作の実行を求める文面があります（確定ではありません）",
      body: exec.explanation,
      note: "この欄は、下の判定区分より先に読むための表示です。下の区分は従来の危険度の集計結果で、4つの判定区分と点数は変えていません。実行を求める文面があっても、その集計が強い危険にしていないことがあります。安全という意味ではありません。"
    };
  }

  // ---------- 表示文言（§8） ----------
  function buildDisplay(r, ch) {
    var M = "メール";
    var d = { tone: "grey", headline: "", body: "", banner: "", notes: [], reasons: [], actions: [] };
    var sorted = r.evidence.slice().sort(function (a, b) { return W[b.strength] - W[a.strength]; });
    var compNotes = r.composite_rules.filter(function (c) { return c.selected || c.rule_id === "P17r"; }).map(function (c) {
      return c.shadow || c.effective_level === "M" ? "情報の入力・手続きを求めていますが、入力された情報だけでは送信元やリンク先の正当性を確認できません。" + M + "内のリンクを使わず、公式アプリやブックマークから直接確認してください。" : c.note;
    });
    var seen = {};
    compNotes.concat(sorted.map(function (e) { return e.note; })).forEach(function (n) { if (n && !seen[n]) { seen[n] = 1; d.reasons.push(n); } });
    if (r.verdict === "strong_suspicion") {
      d.tone = "red"; d.headline = "詐欺" + M + "の疑いが強いです";
      d.body = "詐欺" + M + "によく見られる強い特徴があります。" + M + "内のリンク・電話番号・添付ファイルは使わず、公式アプリやブックマークから直接確認してください。";
      if (r.context_answer === "yes") d.notes.push("心当たりがあっても、本物の通知を装った可能性があります。");
      if (r.input_issues.length) d.notes.push("入力に不足があります（" + issueText(r.input_issues, ch).join("、") + "）。");
    } else if (r.verdict === "needs_review") {
      d.tone = "yellow"; d.headline = "注意が必要です（要確認）";
      d.body = "本物かどうか確認が必要です。" + M + "内のリンクからではなく、公式アプリやブックマークした公式サイトで同じ通知があるか確認してください。";
      if (r.context_answer === "no" && r.danger_level === "N") {
        d.notes.push("心当たりがないとの回答を踏まえた確認のご案内です。これだけで詐欺と断定したわけではありません。");
        if (!d.reasons.length) d.reasons.push("根拠：心当たりなしの回答のみ");
      }
    } else if (r.verdict === "no_clear_signal") {
      d.tone = "grey"; d.headline = "このツールでは判断できませんでした。公式アプリやブックマークから直接確認してください";
      d.banner = "安全ではありません。" + M + "内のリンクは開かず、公式アプリやブックマークから直接確認してください。";
      d.body = "これは詐欺と確定した意味でも、安全と確認できた意味でもありません。送信元の偽装やリンクの本当の行き先を確認できず、特徴が出ない詐欺もあります。";
    } else {
      d.tone = "grey"; d.headline = "情報が足りず判定できません";
      d.body = "メールに記載されたアドレス（@を含む全体）、本文、心当たりの回答を確認してください。メール内のリンクは開かないでください。";
      d.notes = issueText(r.input_issues, ch);
    }
    d.actions = [
      M + "内のリンクや添付ファイルは開かず、返信や本文に書かれた番号への電話もしないでください。",
      "公式アプリや、登録済みのブックマークから開いた公式サイトで、同じ通知があるか確認してください。",
      "配信停止・退会も、" + M + "内のリンクではなく公式サイトやアプリの設定から行ってください。",
      "すでにパスワード等を入力した場合は、自分で開いた公式サイトでパスワードを変更し、カード会社・金融機関の公式窓口へ連絡してください。",
      "送金してしまった場合は、金融機関・警察・消費生活センターへ早めに相談してください（連絡先は公式サイトでご確認ください）。"
    ];
    var auxNote = { B01: "お金に関する言葉があります。これだけでは詐欺とは断定しません。", B02: "リンクやボタンの案内があります。", B03: "宛名がありません。" };
    if (r.danger_level === "W" && r.verdict === "needs_review") {
      (r.auxiliary_flags || []).forEach(function (k) { if (k !== "B08" && auxNote[k] && d.reasons.indexOf(auxNote[k]) < 0) d.reasons.push(auxNote[k]); });
    }
    if ((r.unknowns || []).indexOf("unlisted_brand_claim") >= 0 && (r.evidence || []).length) {
      d.notes.push("名乗っている名前は、このツールの台帳では確認できない相手です。未掲載は公式でも非公式でも断定できません。");
    }
    return d;
  }
  function issueText(list) {
    var T = { body_empty: "本文が空です", from_unparseable: "メールに記載されたアドレス（@を含む全体）を読み取れません", context_invalid: "「心当たり」の回答を選び直してください", channel_invalid: "このサービスはメールだけを判定します" };
    return list.map(function (x) { return T[x] || x; });
  }

  g.MH_judge = judge;
  g.MH_util = { esc: esc, maskSecrets: maskSecrets, registrable: registrable, lexical: lexical };
})(typeof globalThis !== "undefined" ? globalThis : this);
