/* 判定回数と週間ランキングに残さないドメイン。
 * フリーメール、携帯キャリア、公的ドメイン、よく知られた会社の公式ドメイン。
 * ブラウザと api/weekly-rank.mjs の両方から使う。 */
(function (g) {
  "use strict";
  var FREEMAIL = [
    "gmail.com", "googlemail.com", "yahoo.co.jp", "yahoo.ne.jp", "ymail.ne.jp", "yahoo.com",
    "outlook.com", "outlook.jp", "hotmail.com", "hotmail.co.jp", "live.jp", "live.com",
    "icloud.com", "me.com", "mac.com", "aol.com", "gmx.com", "mail.ru", "yandex.ru",
    "proton.me", "protonmail.com", "excite.co.jp", "infoseek.jp", "nifty.com", "nifty.ne.jp",
    "so-net.ne.jp", "ocn.ne.jp", "plala.or.jp", "biglobe.ne.jp", "dion.ne.jp", "zaq.ne.jp", "ybb.ne.jp"
  ];
  var CARRIERS = [
    "docomo.ne.jp", "ezweb.ne.jp", "au.com", "softbank.ne.jp", "i.softbank.jp", "vodafone.ne.jp",
    "disney.ne.jp", "ymobile.ne.jp", "ymobile.jp", "willcom.com", "wcm.ne.jp", "pdx.ne.jp",
    "emnet.ne.jp", "rakuten.jp"
  ];
  // 台帳にある公式の登録ドメインと、同種の大手。個人のフリーメールとは別に、ランキングへ出さない。
  var OFFICIAL = [
    "amazon.co.jp", "amazon.com", "apple.com", "auone.jp", "softbank.jp", "mercari.jp", "mercari.com",
    "paypay.ne.jp", "paypay-corp.co.jp", "paypay.co.jp", "paypay-business.jp", "smbc.co.jp",
    "mizuhobank.co.jp", "vpass.ne.jp", "smbc-card.com", "japanpost.jp", "mufg.jp", "nhk.jp", "nhk.or.jp",
    "rakuten-card.co.jp", "rakuten-sec.co.jp", "rakuten.co.jp", "rakuten.com", "sbisec.co.jp",
    "etc-meisai.jp", "google.com", "google.co.jp", "microsoft.com", "office.com", "line.me"
  ];
  var EXACT = {};
  FREEMAIL.concat(CARRIERS, OFFICIAL).forEach(function (domain) { EXACT[domain] = 1; });
  var PUBLIC_RE = /^(?:.+\.)?(?:go|lg|ac|ed)\.jp$/;

  function isExcludedDomain(domain) {
    var host = String(domain || "").trim().toLowerCase().replace(/\.$/, "");
    if (!host || host.indexOf("@") >= 0 || host.indexOf("/") >= 0) return true;
    if (PUBLIC_RE.test(host)) return true;
    var parts = host.split(".");
    var i;
    for (i = 0; i < parts.length - 1; i++) {
      if (EXACT[parts.slice(i).join(".")]) return true;
    }
    return false;
  }

  g.MH_DOMAIN_EXCLUSIONS = {
    isExcludedDomain: isExcludedDomain,
    freemail: FREEMAIL.slice(),
    carriers: CARRIERS.slice(),
    official: OFFICIAL.slice()
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
