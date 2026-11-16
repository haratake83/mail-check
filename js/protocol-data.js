/* メール判定.com — 判定プロトコル v0.8 台帳データ（§7 から転記）
 * 記法: "host" = exact_host, "~domain" = domain_and_subdomains, "@addr" = exact_address
 * state: verified = 比較アンカーの資料確認済み（confirmed）。本番S経路の稼働承認ではない（route_enabled=false）。
 * 確認日 2026-11-06 JST / 有効期限 2027-02-04 JST（旧9件はv0.7取得記録を継承）。
 * 台帳は例示であり完全一覧ではない。未掲載＝非公式ではない。
 * officialKey は公式送信元リストのブランドキー。手口の一文を省く照合にだけ使う。
 */
(function (g) {
  "use strict";
  var B = function (o) {
    o.web = o.web || []; o.send = o.send || []; o.pending = o.pending || [];
    o.anchors = o.anchors || []; o.e03r = !!o.e03r; o.state = o.state || "verified";
    o.a11 = o.a11 || []; return o;
  };
  var brands = [
    B({ id: "amazon_jp", officialKey: "amazon", label: "Amazon", names: ["Amazon.co.jp", "アマゾンジャパン", "Amazonプライム", "Amazon", "アマゾン"], web: ["~amazon.co.jp"], anchors: ["amazon"] }),
    B({ id: "apple", officialKey: "apple", label: "Apple", names: ["Apple Account", "Apple ID", "App Store", "iCloud", "Apple", "アップル"], web: ["~apple.com"], pending: ["~icloud.com"], anchors: ["apple"] }),
    B({ id: "au", officialKey: "au", label: "au", names: ["au"], shortAscii: true, web: ["~au.com", "~auone.jp"], send: ["connect.auone.jp"], anchors: ["au", "auone"] }),
    B({ id: "softbank", officialKey: "softbank", label: "ソフトバンク", names: ["My SoftBank", "ソフトバンク", "SoftBank"], web: ["~softbank.jp"], send: ["oshirasemail.mb.softbank.jp"], anchors: ["softbank"] }),
    B({ id: "mercari", officialKey: "mercari", label: "メルカリ", names: ["メルカリ", "Mercari"], web: ["~mercari.jp"], send: ["~mercari.jp"], pending: ["~mercari.com"], anchors: ["mercari"], a11: ["identity_card"] }),
    B({ id: "paypay", officialKey: "paypay", label: "PayPay", names: ["PayPay", "ペイペイ"], web: ["~paypay.ne.jp", "~paypay-corp.co.jp", "~paypay.co.jp", "~paypay-business.jp"], send: ["~paypay-corp.co.jp"], anchors: ["paypay", "paypay-corp", "paypay-business"] }),
    B({ id: "smbc_bank", officialKey: "smbc_bank", label: "三井住友銀行", names: ["三井住友銀行", "SMBCダイレクト"], web: ["~smbc.co.jp"], anchors: ["smbc"] }),
    B({ id: "mizuho", officialKey: "mizuho", label: "みずほ銀行", names: ["みずほ銀行", "みずほダイレクト"], web: ["~mizuhobank.co.jp"], anchors: ["mizuhobank"] }),
    B({ id: "smbc_card", officialKey: "smbc_card", label: "三井住友カード", names: ["三井住友カード", "Vpass"], web: ["~vpass.ne.jp"], send: ["contact.vpass.ne.jp", "vpass.ne.jp", "mail.vpass.ne.jp", "smbc-card.com", "prepaid.smbc-card.com", "payment.vpass.ne.jp", "secure.payment.vpass.ne.jp", "contact.smbc-card.com"], pending: ["~smbc-card.com"], anchors: ["vpass"] }),
    B({ id: "japanpost", officialKey: "japanpost", label: "日本郵便", names: ["日本郵便", "JP POST", "郵便局"], web: ["post.japanpost.jp"], anchors: ["japanpost"] }),
    B({ id: "yucho", officialKey: "yucho", label: "ゆうちょ銀行", names: ["ゆうちょダイレクト", "ゆうちょ銀行"], web: ["jp-bank.japanpost.jp"], anchors: ["jp-bank"] }),
    B({ id: "yamato", officialKey: "yamato", label: "ヤマト運輸", names: ["クロネコヤマト", "ヤマト運輸"], web: ["~kuronekoyamato.co.jp"], send: ["kuronekoyamato.co.jp", "ml.kuronekoyamato.co.jp", "ml2.kuronekoyamato.co.jp"], sendExceptions: ["shop.rakuten.co.jp"], e03r: true, e03rScope: "delivery", anchors: ["kuronekoyamato"], a11: ["yamato_email_phrases"] }),
    B({ id: "mufg", officialKey: "mufg_bank", label: "三菱UFJ銀行", names: ["三菱UFJ銀行", "三菱UFJダイレクト"], web: ["bk.mufg.jp"], anchors: ["mufg"] }),
    B({ id: "docomo", officialKey: "docomo", label: "NTTドコモ", names: ["NTTドコモ", "ドコモ", "docomo", "ahamo"], web: ["~docomo.ne.jp"], anchors: ["docomo"], personalMailDomain: "docomo.ne.jp" }),
    B({ id: "nhk", label: "NHK", names: ["日本放送協会", "NHK受信料", "NHK"], shortAscii: true, web: ["provision-plus.nhk.jp"], pending: ["~nhk.or.jp", "~web.nhk"], anchors: ["nhk"] }),
    B({ id: "rakuten_card", officialKey: "rakuten_card", label: "楽天カード", names: ["楽天カード", "楽天e-NAVI"], web: ["~rakuten-card.co.jp"], send: ["mail.rakuten-card.co.jp", "bounce.rakuten-card.co.jp", "ad02clickmailer.jp"], pending: ["mkrm.rakuten.co.jp"], anchors: ["rakuten-card"], a11: ["rakuten_card_number"] }),
    B({ id: "rakuten_sec", officialKey: "rakuten_sec", label: "楽天証券", names: ["楽天証券", "iSPEED"], web: ["~rakuten-sec.co.jp"], send: ["~rakuten-sec.co.jp", "@economic-info@mk-economic-notify.jp"], e03r: true, e03rScope: "securities_notice", anchors: ["rakuten-sec"] }),
    B({ id: "rakuten_market", officialKey: "rakuten_ichiba", label: "楽天市場", names: ["楽天市場", "楽天会員", "Rakuten", "楽天"], web: ["~rakuten.co.jp", "account.rakuten.com"], send: ["account.rakuten.com", "emagazine.rakuten.co.jp", "faq.rakuten.co.jp", "id.rakuten.co.jp", "info.rakuten.co.jp", "mkrm.rakuten.co.jp", "rakuten.co.jp", "shop.rakuten.co.jp"], anchors: ["rakuten"], mall: true }),
    B({ id: "sbi_sec", officialKey: "sbisec", label: "SBI証券", names: ["SBI証券", "SBI Securities"], web: ["~sbisec.co.jp"], send: ["~sbisec.co.jp", "~trkd-hs.com"], anchors: ["sbisec"] }),
    B({ id: "etc_meisai", officialKey: "etc_meisai", label: "ETC利用照会サービス", names: ["ETC利用照会サービス", "ETC利用照会", "etc-meisai"], web: ["~etc-meisai.jp"], send: ["@admin@ml.etc-meisai.jp"], e03r: true, e03rScope: "service", anchors: ["etc-meisai"], a11: ["etc_billing"] }),
    B({ id: "nta_etax", officialKey: "nta", label: "e-Tax", names: ["国税電子申告納税システム", "イータックス", "e-Tax"], web: ["e-tax.nta.go.jp"], send: ["@info@e-tax.nta.go.jp"], e03r: true, e03rScope: "etax", anchors: ["e-tax"], a11: ["nta_demand"] }),
    B({ id: "nta_general", officialKey: "nta", label: "国税庁", names: ["国税庁", "国税局", "税務署"], web: ["~nta.go.jp"], anchors: ["nta"], a11: ["nta_demand"] }),
    // tier2 候補（比較アンカー未確認：candidate/empty）。未知を公式と捏造しない。
    B({ id: "rakuten_bank", officialKey: "rakuten_bank", label: "楽天銀行", names: ["楽天銀行"], state: "empty" }),
    B({ id: "rakuten_mobile", officialKey: "rakuten_mobile", label: "楽天モバイル", names: ["楽天モバイル"], state: "empty" }),
    B({ id: "paypay_card", officialKey: "paypay_card", label: "PayPayカード", names: ["PayPayカード"], state: "empty" }),
    B({ id: "paypay_bank", officialKey: "paypay_bank", label: "PayPay銀行", names: ["PayPay銀行"], state: "empty" }),
    B({ id: "monex", officialKey: "monex", label: "マネックス証券", names: ["マネックス証券", "Monex"], state: "candidate" }),
    B({ id: "merpay", label: "メルペイ", names: ["メルペイ"], state: "empty" }),
    B({ id: "ymobile", officialKey: "ymobile", label: "ワイモバイル", names: ["Y!mobile", "ワイモバイル"], state: "empty" }),
    B({ id: "uq", label: "UQ mobile", names: ["UQ mobile"], state: "empty" }),
    B({ id: "line", officialKey: "line", label: "LINE", names: ["LINE"], shortAscii: true, state: "candidate" }),
    B({ id: "google", officialKey: "google", label: "Google", names: ["Google", "グーグル"], state: "candidate" }),
    B({ id: "netflix", officialKey: "netflix", label: "Netflix", names: ["Netflix", "ネットフリックス"], web: ["~netflix.com"], anchors: ["netflix"], state: "verified" }),
    B({ id: "tepco_ep", label: "東京電力エナジーパートナー", names: ["東京電力エナジーパートナー", "くらしTEPCO"], state: "empty" }),
    B({ id: "tokyo_gas", label: "東京ガス", names: ["東京ガス", "myTOKYOGAS"], state: "empty" }),
    B({ id: "kepco", label: "関西電力", names: ["関西電力", "はぴeみる電"], state: "empty" }),
    B({ id: "osaka_gas", label: "大阪ガス", names: ["大阪ガス", "マイ大阪ガス"], state: "empty" }),
    B({ id: "chubu_miraiz", label: "中部電力ミライズ", names: ["中部電力ミライズ", "カテエネ"], state: "empty" }),
    B({ id: "public_agency", label: "公的機関", names: ["総務省", "厚生労働省", "財務省", "警察庁", "都道府県警察", "デジタル庁", "年金事務所", "警察署", "マイナポータル"], state: "empty", publicAgency: true }),
    // 公式ドメインは、各組織の公式ページで送信元またはサイトのドメインを確認できたものだけ。
    B({ id: "sagawa", officialKey: "sagawa", label: "佐川急便", names: ["佐川急便"], web: ["~sagawa-exp.co.jp"], anchors: ["sagawa"], state: "verified" }),
    B({ id: "nenkin", officialKey: "nenkin", label: "日本年金機構", names: ["日本年金機構", "ねんきんネット"], web: ["~nenkin.go.jp"], anchors: ["nenkin"], state: "verified", publicAgency: true }),
    B({ id: "jcb", officialKey: "jcb", label: "JCB", names: ["JCB", "MyJCB"], web: ["~jcb.co.jp", "~jcb.jp"], anchors: ["jcb"], shortAscii: true, state: "verified" }),
    // ドメインを公式ページで確認できていない対象は、名前だけを置く。
    B({ id: "ekinet", officialKey: "ekinet", label: "えきねっと", names: ["えきねっと"], state: "empty" }),
    B({ id: "vpoint", officialKey: "vpoint", label: "Vポイント", names: ["Vポイント"], state: "empty" }),
    B({ id: "ponta", officialKey: "ponta", label: "Ponta", names: ["Ponta", "ポンタ"], state: "empty" }),
    B({ id: "waon", officialKey: "waon", label: "WAON POINT", names: ["WAON POINT", "WAON"], state: "empty" }),
    B({ id: "jrepoint", officialKey: "jrepoint", label: "JRE POINT", names: ["JRE POINT"], state: "empty" }),
    B({ id: "myna_point", officialKey: "mynapoint", label: "マイナポイント", names: ["マイナポイント"], state: "empty" }),
    B({ id: "ana", officialKey: "ana", label: "ANA", names: ["ANA", "ANAマイレージクラブ"], shortAscii: true, state: "empty" }),
    B({ id: "jal", officialKey: "jal", label: "JAL", names: ["JAL"], shortAscii: true, state: "empty" }),
    B({ id: "spotify", officialKey: "spotify", label: "Spotify", names: ["Spotify"], state: "empty" }),
    B({ id: "unext", officialKey: "unext", label: "U-NEXT", names: ["U-NEXT"], state: "empty" }),
    B({ id: "disney_plus", officialKey: "disneyplus", label: "Disney+", names: ["Disney+"], state: "empty" }),
    B({ id: "instagram", officialKey: "instagram", label: "Instagram", names: ["Instagram"], state: "empty" }),
    B({ id: "microsoft", officialKey: "microsoft", label: "Microsoft", names: ["Microsoft", "マイクロソフト"], state: "empty" }),
    B({ id: "mcafee", officialKey: "mcafee", label: "マカフィー", names: ["マカフィー", "McAfee"], state: "empty" }),
    B({ id: "norton", officialKey: "norton", label: "ノートン", names: ["ノートン", "Norton"], state: "empty" }),
    B({ id: "booking", officialKey: "booking", label: "Booking.com", names: ["Booking.com"], state: "empty" }),
    B({ id: "expedia", officialKey: "expedia", label: "Expedia", names: ["Expedia"], state: "empty" }),
    B({ id: "pia", officialKey: "pia", label: "チケットぴあ", names: ["チケットぴあ"], state: "empty" }),
    B({ id: "eplus", officialKey: "eplus", label: "イープラス", names: ["イープラス"], state: "empty" }),
    B({ id: "bitflyer", officialKey: "bitflyer", label: "bitFlyer", names: ["bitFlyer"], state: "empty" }),
    B({ id: "coincheck", officialKey: "coincheck", label: "Coincheck", names: ["Coincheck"], state: "empty" }),
    B({ id: "gmo_coin", officialKey: "gmo_coin", label: "GMOコイン", names: ["GMOコイン"], state: "empty" }),
    B({ id: "sbi_vc", officialKey: "sbivc", label: "SBI VCトレード", names: ["SBI VCトレード"], state: "empty" }),
    B({ id: "metamask", officialKey: "metamask", label: "MetaMask", names: ["MetaMask"], state: "empty" }),
    B({ id: "dpoint", officialKey: "dpoint", label: "dポイント", names: ["dポイント"], state: "empty" })
  ];
  g.MH_PROTOCOL = {
    version: "v0.10",
    schema_version: "0.9-jp-email",
    verified_on_jst: "2026-11-06",
    expires_on_jst: "2027-02-04",
    route_enabled: false, // G0/G1b/G3/G4 未達。新規P16/P17のSは内部shadowのみ、表示はM
    brands: brands,
    freeMail: ["gmail.com", "googlemail.com", "yahoo.co.jp", "ymail.ne.jp", "yahoo.com", "outlook.com", "outlook.jp", "hotmail.com", "hotmail.co.jp", "live.jp", "live.com", "icloud.com", "me.com", "mac.com", "aol.com", "gmx.com", "mail.ru", "yandex.ru", "proton.me", "protonmail.com",
      // 携帯キャリアの個人向けアドレス（企業senderの公式許可にしない）
      "docomo.ne.jp", "ezweb.ne.jp", "au.com", "softbank.ne.jp", "i.softbank.jp", "rakuten.jp"],
    otherEntities: [],         // 確認済み「別主体」ドメイン（本番は未整備）
    shorteners: ["bit.ly", "t.co", "tinyurl.com", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly", "x.gd", "t.ly", "shorturl.at", "amzn.to", "amzn.asia", "rb.gy", "lnkd.in", "s.id", "v.gd"],
    tracking: [],              // 本番の計測host台帳は未整備（G4未達）。本文の自己申告で分類しない
    redirects: [],
    scopedRoutes: []           // 承認済みscoped_routeなし
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
