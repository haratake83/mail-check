/* tools/build-official-senders.mjs が生成する。手で直さない。
 * 判定回数・週間ランキング・訪問回数に残さないドメイン。ドメインページも作らない。
 * EXACT はホスト一致とサブドメイン。SUFFIX は末尾。PATTERN は地域型。
 * 記録しないことと、送信元の真偽は別である。
 */
(function (g) {
  "use strict";
  var FREEMAIL = [
    "gmail.com", "googlemail.com", "yahoo.co.jp", "yahoo.com", "yahoo.ne.jp", "ymail.com", 
    "ymail.ne.jp", "rocketmail.com", "icloud.com", "me.com", "mac.com", "outlook.com", "outlook.jp", 
    "hotmail.com", "hotmail.co.jp", "hotmail.co.uk", "hotmail.fr", "live.com", "live.jp", "msn.com", 
    "passport.com", "aol.com", "aol.jp", "aim.com", "proton.me", "protonmail.com", "protonmail.ch", 
    "pm.me", "zoho.com", "zohomail.com", "gmx.com", "gmx.net", "gmx.de", "mail.com", "email.com", 
    "yandex.com", "yandex.ru", "mail.ru", "inbox.ru", "list.ru", "bk.ru", "qq.com", "foxmail.com", 
    "163.com", "126.com", "yeah.net", "sina.com", "sohu.com", "naver.com", "daum.net", 
    "hanmail.net", "tutanota.com", "tuta.io", "fastmail.com", "hushmail.com", "excite.co.jp", 
    "goo.jp", "goo.ne.jp", "livedoor.com", "infoseek.jp", "freemail.ne.jp", "line.me", "ybb.ne.jp"
  ];
  var CARRIERS = [
    "docomo.ne.jp", "mopera.net", "dwmail.jp", "ezweb.ne.jp", "au.com", "biz.au.com", "auone.jp", 
    "uqmobile.jp", "uq.jp", "povo.jp", "softbank.ne.jp", "softbank.jp", "i.softbank.jp", 
    "disney.ne.jp", "vodafone.ne.jp", "ymobile.ne.jp", "ymobile.jp", "y-mobile.ne.jp", 
    "emobile.ne.jp", "emnet.ne.jp", "willcom.com", "pdx.ne.jp", "wcm.ne.jp", "linemo.jp", 
    "rakumail.jp", "rakuten.jp", "rakuten-mobile.co.jp", "mineo.jp", "ahamo.com", "ocn.ne.jp", 
    "nifty.com", "nifty.ne.jp", "biglobe.ne.jp", "so-net.ne.jp", "plala.or.jp", "dion.ne.jp", 
    "zaq.ne.jp", "home.ne.jp", "jcom.home.ne.jp", "asahi-net.or.jp", "odn.ne.jp", "eonet.ne.jp", 
    "commufa.jp", "tnc.ne.jp", "hi-ho.ne.jp", "bb.excite.co.jp", "yahoo-bb.jp"
  ];
  var COMPANY = [
    "amazon.co.jp", "amazon.jp", "amazon.com", "amazon.co.uk", "amzn.asia", "rakuten.co.jp", 
    "rakuten.com", "rakuten-card.co.jp", "rakuten-bank.co.jp", "rakuten-sec.co.jp", "apple.com", 
    "google.com", "google.co.jp", "youtube.com", "microsoft.com", "office.com", 
    "microsoftonline.com", "meta.com", "facebook.com", "facebookmail.com", "instagram.com", "x.com", 
    "twitter.com", "linecorp.com", "lycorp.co.jp", "yahoo-corp.jp", "paypay.ne.jp", 
    "paypay-card.co.jp", "paypay-bank.co.jp", "paypay-corp.co.jp", "paypay.co.jp", 
    "paypay-business.jp", "mercari.com", "mercari.jp", "paypal.com", "paypal.jp", "netflix.com", 
    "spotify.com", "kuronekoyamato.co.jp", "yamato-hd.co.jp", "sagawa-exp.co.jp", "japanpost.jp", 
    "post.japanpost.jp", "jp-bank.japanpost.jp", "seino.co.jp", "fukutsu.co.jp", "mufg.jp", 
    "bk.mufg.jp", "smbc.co.jp", "smbc-card.com", "vpass.ne.jp", "smbc-gp.co.jp", "mizuhobank.co.jp", 
    "mizuho-fg.co.jp", "resonabank.co.jp", "jcb.co.jp", "jcb.jp", "aeon.co.jp", "aeon.com", 
    "aeonbank.co.jp", "saisoncard.co.jp", "credit-saison.co.jp", "eposcard.co.jp", "orico.co.jp", 
    "americanexpress.com", "aexp.com", "visa.co.jp", "visa.com", "mastercard.com", "sbisec.co.jp", 
    "netbk.co.jp", "sonybank.net", "au-jibunbank.co.jp", "nttdocomo.co.jp", "docomo.com", 
    "kddi.com", "softbank.co.jp", "ntt.com", "ntt-east.co.jp", "ntt-west.co.jp", "tepco.co.jp", 
    "kepco.co.jp", "tokyo-gas.co.jp", "osakagas.co.jp", "nhk.or.jp", "nhk.jp", "jr-central.co.jp", 
    "jreast.co.jp", "westjr.co.jp", "ana.co.jp", "jal.co.jp", "jal.com", "etc-meisai.jp", 
    "nexco.co.jp", "yodobashi.com", "biccamera.com", "uniqlo.com", "nitori-net.jp", "zozo.jp", 
    "dmm.com", "ebay.com", "aliexpress.com", "temu.com"
  ];
  var SENDERS = [
    "01epos.jp", "aexpfeedback.com", "americanexpress.jp", "centurion.com", "d-card.jp", 
    "docomo-de.net", "email.amexnetwork.com", "email.kddi-fs.com", "mail2.apl01.spmode.ne.jp", 
    "mufgcard.com", "nicos.co.jp", "resonacard.co.jp", "saisonid.com", "system.kddi-fs.com", 
    "daiwa.co.jp", "daiwa.jp", "idecoentry-resonabank.com", "jp-bank-card.jp", "jp-bank.jp", 
    "kabu.com", "kansaimiraibank.co.jp", "matsui.co.jp", "minatobk.co.jp", "mizuho-bk.co.jp", 
    "monex.co.jp", "nomura.co.jp", "nomura.com", "resona-biz.jp", "resona-gr.co.jp", 
    "resona-hd.co.jp", "saitamaresona.co.jp", "smbcnikko.co.jp", "7card.co.jp", "ccc.co.jp", 
    "jrepoint.jp", "loyalty.co.jp", "nanaco-net.jp", "ponta.jp", "smartwaon.com", 
    "smbcgroup-point.jp", "tsite.jp", "dazn.com", "disneyplus.com", "hulu-japan.jp", "hulu.jp", 
    "mail.abema.tv", "performgroup.com", "primevideo.com", "unext-info.jp", "unext.jp", 
    "yumobile.co.jp", "yumobile.jp", "bytedance.com", "canon-its.jp", "canon-mj.co.jp", 
    "email.jp.trendlife.com", "email.trendlife.com", "eset.com", "fb.com", "kaspersky.co.jp", 
    "kaspersky.com", "lifelock.com", "mail.nortonstore.jp", "mcafee.com", 
    "mcafeemobilesecurity.com", "metamail.com", "norton.com", "nortonlifelock.com", 
    "notify.jp.trendlife.com", "securenorton.com", "tiktok.com", "trendmicro-email.com", 
    "trendmicro.co.jp", "trendmicro.com", "booking.com", "c-nexco.co.jp", "e-nexco.co.jp", 
    "eki-net.com", "ent.lawson.co.jp", "eplus.co.jp", "eplus.jp", "expedia.co.jp", "expy.jp", 
    "flypeach.com", "ikyu.com", "jalan.net", "l-tike.com", "lawsonticket.jp", "pia.co.jp", "pia.jp", 
    "point.recruit.co.jp", "rakutentravelxchange.com", "recruit-id-point.jp", "smart-ex.jp", 
    "smile-etc.jp", "w-nexco.co.jp", "bitbank.cc", "bitflyer.com", "coincheck.com", "metamask.com", 
    "metamask.io", "rakuten-wallet.co.jp", "sbivc.co.jp", "uqwimax.jp"
  ];
  var PARTNERS = [
    "amadeus.com", "cl-cards.com", "coin.z.com", "e.fanaticsretailgroup.com", "fc67176.cuenote.jp", 
    "finemax.net", "hmv.co.jp", "immersve.com", "mail-jcn.dnp-cdms.jp", "marketmail.jp", 
    "mk-economic-notify.jp", "otp-auth.net", "paysec.cacs.jp", "proxyvote.com"
  ];
  var SUFFIX = [".go.jp",".lg.jp",".gov",".mil",".gov.uk",".gov.au",".gc.ca",".gouv.fr",".bund.de",".go.kr",".gov.cn",".gov.tw",".gov.sg",".gov.hk",".gov.in",".gob.mx",".gov.br",".int",".ac.jp",".ed.jp",".edu"];
  var PATTERN = /(^|\.)(pref|metro|city|town|vill)\.[a-z0-9-]+\.jp$/;
  var EXACT = {};
  FREEMAIL.concat(CARRIERS, COMPANY, SENDERS, PARTNERS).forEach(function (domain) { EXACT[domain] = 1; });

  function asciiHost(h) {
    h = String(h || "").replace(/^\s+|\s+$/g, "").replace(/\.$/, "").toLowerCase();
    if (!h) return "";
    try { return new URL("http://" + h + "/").hostname.replace(/\.$/, ""); }
    catch (e) { return h; }
  }
  function isExcludedDomain(domain) {
    var host = asciiHost(domain);
    if (!host || host.indexOf("@") >= 0 || host.indexOf("/") >= 0) return true;
    var labels = host.split(".");
    if (labels.length < 2 || labels.some(function (part) { return !part; })) return true;
    var i, suf, bare;
    for (i = 0; i < labels.length; i++) {
      if (EXACT[labels.slice(i).join(".")]) return true;
    }
    for (i = 0; i < SUFFIX.length; i++) {
      suf = SUFFIX[i];
      bare = suf.slice(1);
      if (host === bare) return true;
      if (host.length > suf.length && host.slice(host.length - suf.length) === suf) return true;
    }
    if (PATTERN.test(host)) return true;
    return false;
  }
  var official = COMPANY.concat(SENDERS, PARTNERS);
  g.MH_DOMAIN_EXCLUSIONS = {
    isExcludedDomain: isExcludedDomain,
    freemail: FREEMAIL.slice(),
    carriers: CARRIERS.slice(),
    official: official.slice(),
    exact: FREEMAIL.concat(CARRIERS, official).slice(),
    suffix: SUFFIX.slice()
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
