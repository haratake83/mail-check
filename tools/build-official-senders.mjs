#!/usr/bin/env node
// 公式送信元モジュールと除外ドメインを生成する。ネットワーク取得はしない。
// 使い方: node tools/build-official-senders.mjs path/to/official-senders.json
// 出力: js/official-senders.js と js/domain-exclusions.js
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error("usage: node tools/build-official-senders.mjs <official-senders.json>");
  process.exit(1);
}

const FREE_MAIL = [
  "gmail.com", "googlemail.com", "yahoo.co.jp", "yahoo.com", "yahoo.ne.jp", "ymail.com",
  "ymail.ne.jp", "rocketmail.com", "icloud.com", "me.com", "mac.com", "outlook.com", "outlook.jp",
  "hotmail.com", "hotmail.co.jp", "hotmail.co.uk", "hotmail.fr", "live.com", "live.jp", "msn.com",
  "passport.com", "aol.com", "aol.jp", "aim.com", "proton.me", "protonmail.com", "protonmail.ch",
  "pm.me", "zoho.com", "zohomail.com", "gmx.com", "gmx.net", "gmx.de", "mail.com", "email.com",
  "yandex.com", "yandex.ru", "mail.ru", "inbox.ru", "list.ru", "bk.ru", "qq.com", "foxmail.com",
  "163.com", "126.com", "yeah.net", "sina.com", "sohu.com", "naver.com", "daum.net", "hanmail.net",
  "tutanota.com", "tuta.io", "fastmail.com", "hushmail.com", "excite.co.jp", "goo.jp", "goo.ne.jp",
  "livedoor.com", "infoseek.jp", "freemail.ne.jp", "line.me", "ybb.ne.jp"
];
const CARRIER = [
  "docomo.ne.jp", "mopera.net", "dwmail.jp", "ezweb.ne.jp", "au.com", "biz.au.com", "auone.jp",
  "uqmobile.jp", "uq.jp", "povo.jp", "softbank.ne.jp", "softbank.jp", "i.softbank.jp",
  "disney.ne.jp", "vodafone.ne.jp", "ymobile.ne.jp", "ymobile.jp", "y-mobile.ne.jp",
  "emobile.ne.jp", "emnet.ne.jp", "willcom.com", "pdx.ne.jp", "wcm.ne.jp", "linemo.jp",
  "rakumail.jp", "rakuten.jp", "rakuten-mobile.co.jp", "mineo.jp", "ahamo.com", "ocn.ne.jp",
  "nifty.com", "nifty.ne.jp", "biglobe.ne.jp", "so-net.ne.jp", "plala.or.jp", "dion.ne.jp",
  "zaq.ne.jp", "home.ne.jp", "jcom.home.ne.jp", "asahi-net.or.jp", "odn.ne.jp", "eonet.ne.jp",
  "commufa.jp", "tnc.ne.jp", "hi-ho.ne.jp", "bb.excite.co.jp", "yahoo-bb.jp"
];
const COMPANY = [
  "amazon.co.jp", "amazon.jp", "amazon.com", "amazon.co.uk", "amzn.asia", "rakuten.co.jp",
  "rakuten.com", "rakuten-card.co.jp", "rakuten-bank.co.jp", "rakuten-sec.co.jp", "apple.com",
  "google.com", "google.co.jp", "youtube.com", "microsoft.com", "office.com", "microsoftonline.com",
  "meta.com", "facebook.com", "facebookmail.com", "instagram.com", "x.com", "twitter.com",
  "linecorp.com", "lycorp.co.jp", "yahoo-corp.jp", "paypay.ne.jp", "paypay-card.co.jp",
  "paypay-bank.co.jp", "paypay-corp.co.jp", "paypay.co.jp", "paypay-business.jp", "mercari.com",
  "mercari.jp", "paypal.com", "paypal.jp", "netflix.com", "spotify.com", "kuronekoyamato.co.jp",
  "yamato-hd.co.jp", "sagawa-exp.co.jp", "japanpost.jp", "post.japanpost.jp",
  "jp-bank.japanpost.jp", "seino.co.jp", "fukutsu.co.jp", "mufg.jp", "bk.mufg.jp", "smbc.co.jp",
  "smbc-card.com", "vpass.ne.jp", "smbc-gp.co.jp", "mizuhobank.co.jp", "mizuho-fg.co.jp",
  "resonabank.co.jp", "jcb.co.jp", "jcb.jp", "aeon.co.jp", "aeon.com", "aeonbank.co.jp",
  "saisoncard.co.jp", "credit-saison.co.jp", "eposcard.co.jp", "orico.co.jp", "americanexpress.com",
  "aexp.com", "visa.co.jp", "visa.com", "mastercard.com", "sbisec.co.jp", "netbk.co.jp",
  "sonybank.net", "au-jibunbank.co.jp", "nttdocomo.co.jp", "docomo.com", "kddi.com",
  "softbank.co.jp", "ntt.com", "ntt-east.co.jp", "ntt-west.co.jp", "tepco.co.jp", "kepco.co.jp",
  "tokyo-gas.co.jp", "osakagas.co.jp", "nhk.or.jp", "nhk.jp", "jr-central.co.jp", "jreast.co.jp",
  "westjr.co.jp", "ana.co.jp", "jal.co.jp", "jal.com", "etc-meisai.jp", "nexco.co.jp",
  "yodobashi.com", "biccamera.com", "uniqlo.com", "nitori-net.jp", "zozo.jp", "dmm.com", "ebay.com",
  "aliexpress.com", "temu.com"
];
const OFFICIAL_SENDER = [
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
  "kaspersky.com", "lifelock.com", "mail.nortonstore.jp", "mcafee.com", "mcafeemobilesecurity.com",
  "metamail.com", "norton.com", "nortonlifelock.com", "notify.jp.trendlife.com", "securenorton.com",
  "tiktok.com", "trendmicro-email.com", "trendmicro.co.jp", "trendmicro.com", "booking.com",
  "c-nexco.co.jp", "e-nexco.co.jp", "eki-net.com", "ent.lawson.co.jp", "eplus.co.jp", "eplus.jp",
  "expedia.co.jp", "expy.jp", "flypeach.com", "ikyu.com", "jalan.net", "l-tike.com",
  "lawsonticket.jp", "pia.co.jp", "pia.jp", "point.recruit.co.jp", "rakutentravelxchange.com",
  "recruit-id-point.jp", "smart-ex.jp", "smile-etc.jp", "w-nexco.co.jp", "bitbank.cc",
  "bitflyer.com", "coincheck.com", "metamask.com", "metamask.io", "rakuten-wallet.co.jp",
  "sbivc.co.jp", "uqwimax.jp"
];
const PARTNER = [
  "amadeus.com", "cl-cards.com", "coin.z.com", "e.fanaticsretailgroup.com", "fc67176.cuenote.jp",
  "finemax.net", "hmv.co.jp", "immersve.com", "mail-jcn.dnp-cdms.jp", "marketmail.jp",
  "mk-economic-notify.jp", "otp-auth.net", "paysec.cacs.jp", "proxyvote.com"
];
const SUFFIX = [
  ".go.jp", ".lg.jp", ".gov", ".mil", ".gov.uk", ".gov.au", ".gc.ca", ".gouv.fr", ".bund.de",
  ".go.kr", ".gov.cn", ".gov.tw", ".gov.sg", ".gov.hk", ".gov.in", ".gob.mx", ".gov.br", ".int",
  ".ac.jp", ".ed.jp", ".edu"
];

const PATTERN_SRC = "(^|\\.)(pref|metro|city|town|vill)\\.[a-z0-9-]+\\.jp$";
const EXACT_LIST = FREE_MAIL.concat(CARRIER, COMPANY, OFFICIAL_SENDER, PARTNER);
if (EXACT_LIST.length !== 331 || new Set(EXACT_LIST).size !== 331) {
  console.error("EXACT list must be 331 unique domains, got " + EXACT_LIST.length + " / " + new Set(EXACT_LIST).size);
  process.exit(1);
}
if (SUFFIX.length !== 21 || new Set(SUFFIX).size !== 21) {
  console.error("SUFFIX list must be 21, got " + SUFFIX.length);
  process.exit(1);
}

const MUST_NOT = [
  "amazonaws.com", "s3.amazonaws.com", "dpoint.jp", "taotao-ex.com", "resv.jp",
  "cuenote.jp", "dkim.cuenote.jp", "z.com", "zendesk.com", "bitbankcc.zendesk.com",
  "discoursemail.com", "adobe-campaign.com", "email-ssl.com", "cleverbridge.com",
  "zuberance.com", "ifeelgoods.com", "trustpilot.com", "club-off.com", "onetrust.com",
  "creditview.co.uk", "cacs.jp", "dnp-cdms.jp", "example.com", "example.co.jp",
  "q7v9z.example", "support-amazon.example", "evil.zendesk.com", "evil.z.com"
];
const MUST = [
  "amazon.co.jp", "mail.amazon.co.jp", "google.com", "city.sapporo.jp", "pref.osaka.jp",
  "nta.go.jp", "01epos.jp", "gmail.com", "yahoo.co.jp", "outlook.com", "icloud.com",
  "docomo.ne.jp", "ezweb.ne.jp", "softbank.ne.jp", "au.com", "www.nta.go.jp", "city.lg.jp",
  "u-tokyo.ac.jp", "example.ed.jp", "apple.com", "mail.google.com", "shop.amazon.co.jp"
];

const CLASS = { current_official: 0, shared_platform: 1, free_or_carrier: 2, old_domain: 3, naming_rule: 4 };
const MATCH = { suffix: 0, exact_host: 1, exact_address: 2, rule: 3, none: 4 };
const NO_PASS_CLASS = { 2: 1, 3: 1, 4: 1 };

function asciiHost(h) {
  h = String(h || "").trim().replace(/\.$/, "").toLowerCase();
  if (!h) return "";
  try { return new URL("http://" + h + "/").hostname.replace(/\.$/, ""); }
  catch (e) { return h; }
}

function normalizeAddress(raw) {
  const s = String(raw || "").trim().toLowerCase();
  const at = s.lastIndexOf("@");
  let local = "";
  let host = s;
  if (at >= 0) {
    local = s.slice(0, at).trim();
    host = s.slice(at + 1).trim();
  }
  host = asciiHost(host);
  if (!host || host.indexOf("/") >= 0 || host.indexOf("@") >= 0) return null;
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((part) => !part)) return null;
  return { host: host, addr: at >= 0 ? local + "@" + host : host, hasAt: at >= 0 };
}

function storedAddress(raw) {
  const n = normalizeAddress(raw);
  if (!n || !n.hasAt) throw new Error("address is not usable: " + raw);
  return n.addr;
}

const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
if (!data || !Array.isArray(data.entries)) {
  console.error("JSON has no entries array");
  process.exit(1);
}
if (data.entries.length !== 550) {
  console.error("expected 550 entries, got " + data.entries.length);
  process.exit(1);
}

const groups = {};
const rows = [];
for (const entry of data.entries) {
  const cls = CLASS[entry.class];
  const match = MATCH[entry.match];
  if (cls === undefined || match === undefined) throw new Error("bad entry " + entry.domain + " " + entry.class + " " + entry.match);
  if (!entry.domain || !entry.brand || !entry.group) throw new Error("missing field " + JSON.stringify(entry.domain));
  if (groups[entry.brand] && groups[entry.brand] !== entry.group) throw new Error("group conflict " + entry.brand);
  groups[entry.brand] = entry.group;
  if (entry.domain === "google.com" || entry.domain.endsWith(".google.com")) {
    if (entry.pass !== false) throw new Error("google.com must not pass: " + entry.domain);
  }
  if (entry.brand === "police" || entry.brand === "npa" || entry.brand === "npsc") {
    if (entry.pass !== false) throw new Error("police must not pass: " + entry.domain);
  }
  if ((entry.domain === "dpoint.jp" || entry.domain === "taotao-ex.com" || entry.domain === "jp.nomura.com") && (entry.class !== "old_domain" || entry.pass !== false)) {
    throw new Error("old domain drifted: " + entry.domain);
  }
  const row = [entry.domain, entry.brand, cls, match, entry.pass === true ? 1 : 0];
  if (match === 2) {
    if (!Array.isArray(entry.addresses) || !entry.addresses.length) throw new Error("exact address missing list " + entry.domain);
    row.push(entry.addresses.map(storedAddress));
  }
  if (Array.isArray(entry.deny_addresses) && entry.deny_addresses.length) {
    if (match === 2) row.push(entry.deny_addresses.map(storedAddress));
    else row.push([], entry.deny_addresses.map(storedAddress));
  }
  if (match === 3) {
    if (!entry.pattern) throw new Error("rule missing pattern " + entry.domain);
    row.push(entry.pattern);
  }
  rows.push(row);
}

function wrapItems(items) {
  const lines = [];
  let cur = "    ";
  for (const item of items) {
    const bit = JSON.stringify(item) + ",";
    if (cur.length > 4 && cur.length + bit.length > 100) {
      lines.push(cur.replace(/,$/, ""));
      cur = "    ";
    }
    cur += bit + " ";
  }
  if (cur.trim()) lines.push(cur.replace(/,\s*$/, ""));
  return lines.join("\n");
}

function exclusionSource() {
  return [
    "/* tools/build-official-senders.mjs が生成する。手で直さない。",
    " * 判定回数・週間ランキング・訪問回数に残さないドメイン。ドメインページも作らない。",
    " * EXACT はホスト一致とサブドメイン。SUFFIX は末尾。PATTERN は地域型。",
    " * 記録しないことと、送信元の真偽は別である。",
    " */",
    "(function (g) {",
    '  "use strict";',
    "  var FREEMAIL = [",
    wrapItems(FREE_MAIL),
    "  ];",
    "  var CARRIERS = [",
    wrapItems(CARRIER),
    "  ];",
    "  var COMPANY = [",
    wrapItems(COMPANY),
    "  ];",
    "  var SENDERS = [",
    wrapItems(OFFICIAL_SENDER),
    "  ];",
    "  var PARTNERS = [",
    wrapItems(PARTNER),
    "  ];",
    "  var SUFFIX = " + JSON.stringify(SUFFIX) + ";",
    "  var PATTERN = /(^|\\.)(pref|metro|city|town|vill)\\.[a-z0-9-]+\\.jp$/;",
    "  var EXACT = {};",
    "  FREEMAIL.concat(CARRIERS, COMPANY, SENDERS, PARTNERS).forEach(function (domain) { EXACT[domain] = 1; });",
    "",
    "  function asciiHost(h) {",
    "    h = String(h || \"\").replace(/^\\s+|\\s+$/g, \"\").replace(/\\.$/, \"\").toLowerCase();",
    "    if (!h) return \"\";",
    "    try { return new URL(\"http://\" + h + \"/\").hostname.replace(/\\.$/, \"\"); }",
    "    catch (e) { return h; }",
    "  }",
    "  function isExcludedDomain(domain) {",
    "    var host = asciiHost(domain);",
    "    if (!host || host.indexOf(\"@\") >= 0 || host.indexOf(\"/\") >= 0) return true;",
    "    var labels = host.split(\".\");",
    "    if (labels.length < 2 || labels.some(function (part) { return !part; })) return true;",
    "    var i, suf, bare;",
    "    for (i = 0; i < labels.length; i++) {",
    "      if (EXACT[labels.slice(i).join(\".\")]) return true;",
    "    }",
    "    for (i = 0; i < SUFFIX.length; i++) {",
    "      suf = SUFFIX[i];",
    "      bare = suf.slice(1);",
    "      if (host === bare) return true;",
    "      if (host.length > suf.length && host.slice(host.length - suf.length) === suf) return true;",
    "    }",
    "    if (PATTERN.test(host)) return true;",
    "    return false;",
    "  }",
    "  var official = COMPANY.concat(SENDERS, PARTNERS);",
    "  g.MH_DOMAIN_EXCLUSIONS = {",
    "    isExcludedDomain: isExcludedDomain,",
    "    freemail: FREEMAIL.slice(),",
    "    carriers: CARRIERS.slice(),",
    "    official: official.slice(),",
    "    exact: FREEMAIL.concat(CARRIERS, official).slice(),",
    "    suffix: SUFFIX.slice()",
    "  };",
    "})(typeof globalThis !== \"undefined\" ? globalThis : this);",
    ""
  ].join("\n");
}

const runtime = [
  "  var BY = {};",
  "  var RULES = [];",
  "  var i, row, dom;",
  "  for (i = 0; i < ROWS.length; i++) {",
  "    row = ROWS[i];",
  "    if (row[3] === 3) RULES.push([new RegExp(row[5]), row]);",
  "    else {",
  "      dom = row[0];",
  "      if (!BY[dom]) BY[dom] = [];",
  "      BY[dom].push(i);",
  "    }",
  "  }",
  "",
  "  function asciiHost(h) {",
  "    h = String(h || \"\").replace(/^\\s+|\\s+$/g, \"\").replace(/\\.$/, \"\").toLowerCase();",
  "    if (!h) return \"\";",
  "    try { return new URL(\"http://\" + h + \"/\").hostname.replace(/\\.$/, \"\"); }",
  "    catch (e) { return h; }",
  "  }",
  "  function normalize(raw) {",
  "    var s = String(raw || \"\").replace(/^\\s+|\\s+$/g, \"\").toLowerCase();",
  "    var at = s.lastIndexOf(\"@\");",
  "    var local = \"\", host = s;",
  "    if (at >= 0) {",
  "      local = s.slice(0, at).replace(/^\\s+|\\s+$/g, \"\");",
  "      host = s.slice(at + 1).replace(/^\\s+|\\s+$/g, \"\");",
  "    }",
  "    host = asciiHost(host);",
  "    if (!host || host.indexOf(\"/\") >= 0 || host.indexOf(\"@\") >= 0) return null;",
  "    var labels = host.split(\".\");",
  "    if (labels.length < 2 || labels.some(function (part) { return !part; })) return null;",
  "    return { host: host, addr: at >= 0 ? local + \"@\" + host : host, hasAt: at >= 0 };",
  "  }",
  "  function passes(raw, brandKey) {",
  "    if (!brandKey || !GROUPS[brandKey]) return false;",
  "    var parsed = normalize(raw);",
  "    if (!parsed) return false;",
  "    var parts = parsed.host.split(\".\");",
  "    var found = [], i, j, dom, idxs, row, len, best, use, group, addrs, deny, addr;",
  "    for (i = 0; i < parts.length; i++) {",
  "      dom = parts.slice(i).join(\".\");",
  "      idxs = BY[dom];",
  "      if (!idxs) continue;",
  "      for (j = 0; j < idxs.length; j++) {",
  "        row = ROWS[idxs[j]];",
  "        if (row[3] === 0) found.push(row);",
  "        else if (i === 0 && (row[3] === 1 || row[3] === 2 || row[3] === 4)) found.push(row);",
  "      }",
  "    }",
  "    if (!found.length) {",
  "      for (j = 0; j < RULES.length; j++) {",
  "        if (RULES[j][0].test(parsed.host)) found.push(RULES[j][1]);",
  "      }",
  "    }",
  "    if (!found.length) return false;",
  "    best = -1;",
  "    use = [];",
  "    for (j = 0; j < found.length; j++) {",
  "      len = found[j][0].length;",
  "      if (len > best) { best = len; use = [found[j]]; }",
  "      else if (len === best) use.push(found[j]);",
  "    }",
  "    for (j = 0; j < use.length; j++) {",
  "      if (use[j][2] === 2 || use[j][2] === 3 || use[j][2] === 4) return false;",
  "    }",
  "    addr = parsed.hasAt ? parsed.addr : \"\";",
  "    for (j = 0; j < use.length; j++) {",
  "      deny = use[j][6];",
  "      if (deny && addr && deny.indexOf(addr) >= 0) return false;",
  "    }",
  "    group = GROUPS[brandKey];",
  "    for (j = 0; j < use.length; j++) {",
  "      row = use[j];",
  "      if (!row[4] || row[3] === 3 || row[3] === 4) continue;",
  "      if (row[1] !== brandKey && GROUPS[row[1]] !== group) continue;",
  "      if (row[3] === 2) {",
  "        addrs = row[5] || [];",
  "        if (addr && addrs.indexOf(addr) >= 0) return true;",
  "        continue;",
  "      }",
  "      return true;",
  "    }",
  "    return false;",
  "  }",
  "",
  "  g.MH_OFFICIAL_SENDERS = { version: " + JSON.stringify(data.version || "") + ", passes: passes };"
].join("\n");

function officialSource() {
  const rowText = rows.map((row) => "    " + JSON.stringify(row)).join(",\n");
  return [
    "/* tools/build-official-senders.mjs が生成する。手で直さない。",
    " * passes が true のときだけ、名乗っているブランドと送信元が一致するとして",
    " * 「〇〇が広く見られる手口と一致します…」の一文を出さない。",
    " * 判定区分は変えない。フリーメール、旧ドメイン、名前の規則は true にしない。",
    " * script タグで読む。ネットワーク取得はしない。",
    " */",
    "(function (g) {",
    '  "use strict";',
    "  var GROUPS = " + JSON.stringify(groups) + ";",
    "  var ROWS = [",
    rowText,
    "  ];",
    runtime,
    "})(typeof globalThis !== \"undefined\" ? globalThis : this);",
    ""
  ].join("\n");
}

const cases = [
  ["info@e-tax.nta.go.jp", "nta", true],
  ["x@e-tax.nta.go.jp", "nta", false],
  ["a@mail.vpass.ne.jp", "smbc_card", true],
  ["admin@eposcard.co.jp", "epos", false],
  ["a@01epos.jp", "epos", true],
  ["shopping-order-master@mail.yahoo.co.jp", "yahoo_shopping", true],
  ["taro@yahoo.co.jp", "yahoo_shopping", false],
  ["info@wdy.docomo.ne.jp", "docomo", true],
  ["taro@docomo.ne.jp", "docomo", false],
  ["no-reply@accounts.google.com", "google", false],
  ["forms-receipts-noreply@google.com", "google", false],
  ["a@dpoint.jp", "dpoint", false],
  ["a@jp.nomura.com", "nomura", false],
  ["a@nomura.com", "nomura", true],
  ["noreply@trendmicro.com", "trendmicro", false],
  ["info@trendmicro.com", "trendmicro", true],
  ["no-reply@coin.z.com", "gmo_coin", true],
  ["a@evil.z.com", "gmo_coin", false],
  ["noreply-mizuhobank@resv.jp", "mizuho", true],
  ["other@resv.jp", "mizuho", false],
  ["a@rakuten.co.jp", "rakuten_card", true],
  ["a@rakuten.co.jp", "amazon", false],
  ["a@police.pref.osaka.lg.jp", "police", false],
  ["a@pref.osaka.lg.jp", "pref", true]
];

const officialPath = path.join(root, "js/official-senders.js");
const exclusionPath = path.join(root, "js/domain-exclusions.js");
fs.writeFileSync(officialPath, officialSource());
fs.writeFileSync(exclusionPath, exclusionSource());

delete require.cache[officialPath];
delete require.cache[exclusionPath];
require(officialPath);
require(exclusionPath);
const passes = globalThis.MH_OFFICIAL_SENDERS.passes;
const excluded = globalThis.MH_DOMAIN_EXCLUSIONS.isExcludedDomain;
let bad = 0;
for (const row of cases) {
  const got = passes(row[0], row[1]);
  if (got !== row[2]) {
    bad++;
    console.error("PASS FAIL", row[0], row[1], "expected", row[2], "got", got);
  }
}
for (const host of MUST_NOT) {
  if (excluded(host)) { bad++; console.error("excluded but must not", host); }
}
for (const host of MUST) {
  if (!excluded(host)) { bad++; console.error("not excluded", host); }
}
if (passes(" Info@E-Tax.NTA.go.jp. ", "nta") !== true) { bad++; console.error("normalize"); }
if (passes("foo@yahoo.co.jp", "yahoo_shopping") !== false) { bad++; console.error("yahoo parent"); }
if (passes("a@x.accounts.google.com", "google") !== false) { bad++; console.error("google child"); }
if (passes("a@go.jp.example", "nta") !== false) { bad++; console.error("embedded suffix"); }
const bytes = fs.statSync(officialPath).size;
console.log("entries", data.entries.length, "rows", rows.length, "brands", Object.keys(groups).length);
console.log("official-senders.js", bytes, "bytes");
console.log("domain-exclusions.js", fs.statSync(exclusionPath).size, "bytes");
if (bad) {
  console.error(bad + " generator checks failed");
  process.exit(1);
}
console.log("generator checks passed");
