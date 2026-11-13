// 差出人の登録ドメインの取得日だけを返す。同一オリジンの POST のみ。
// RDAP だけを使う。WHOIS には切り替えない。登録者名・メール・住所は読んでも返さない。
// 繰り返す照会を避けるため、正規化した登録ドメインと取得日（YYYY-MM-DD）だけを
// プロセス内のメモリに最大7日残す。生の RDAP JSON は残さない。
import https from "node:https";

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const START_HOST = "rdap.org";
const MAX_HOPS = 3;
const DAY_MS = 86400000;

const bootstrapCache = { at: 0, hosts: null };
export const SUCCESS_TTL_MS = 7 * DAY_MS;
export const MISS_TTL_MS = 5 * 60 * 1000;

export function ageDaysFromCreated(created, now) {
  if (typeof created !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(created)) return null;
  const ms = Date.parse(created + "T00:00:00Z");
  if (!Number.isFinite(ms)) return null;
  const age = Math.floor((now - ms) / DAY_MS);
  if (!Number.isInteger(age) || age < 0 || age > 200000) return null;
  return age;
}

// Vercel ではインスタンスのメモリだけを使う。資格情報のある外部ストアは要らない。
// 後の Xserver / MySQL では、同じ get / setDate / setUnavailable を永続実装に差し替える。
export function createMemoryDateCache(options) {
  const opts = options || {};
  const map = new Map();
  const maxEntries = opts.maxEntries || 2000;
  const successTtl = opts.successTtlMs || SUCCESS_TTL_MS;
  const missTtl = opts.missTtlMs || MISS_TTL_MS;

  function prune(now) {
    const expired = [];
    map.forEach(function (entry, key) {
      if (!entry || entry.expiresAt <= now) expired.push(key);
    });
    expired.forEach(function (key) { map.delete(key); });
    while (map.size > maxEntries) {
      const first = map.keys().next().value;
      map.delete(first);
    }
  }

  return {
    get: function (domain, now) {
      const key = normalizeDomain(domain);
      if (!key) return null;
      const entry = map.get(key);
      if (!entry || entry.expiresAt <= now) {
        if (entry) map.delete(key);
        return null;
      }
      if (typeof entry.created === "string") return { created: entry.created };
      if (entry.unavailable === true) return { status: "unavailable" };
      map.delete(key);
      return null;
    },
    setDate: function (domain, created, now) {
      const key = normalizeDomain(domain);
      if (!key || typeof created !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(created)) return;
      map.delete(key);
      map.set(key, { created: created, expiresAt: now + successTtl });
      prune(now);
    },
    setUnavailable: function (domain, now) {
      const key = normalizeDomain(domain);
      if (!key) return;
      map.delete(key);
      map.set(key, { unavailable: true, expiresAt: now + missTtl });
      prune(now);
    },
    inspect: function () {
      const out = [];
      map.forEach(function (entry, domain) {
        if (entry && typeof entry.created === "string") out.push({ domain: domain, created: entry.created, expiresAt: entry.expiresAt });
        else out.push({ domain: domain, unavailable: true, expiresAt: entry && entry.expiresAt });
      });
      return out;
    }
  };
}

export function normalizeDomain(raw) {
  if (typeof raw !== "string") return null;
  if (raw.length > 253) return null;
  const s = raw.normalize("NFKC").trim().toLowerCase().replace(/\.$/, "");
  if (!s || s.length > 253) return null;
  if (/[@/\s:\\%?#]/.test(s) || s.includes("@")) return null;
  let host = "";
  try {
    host = new URL("https://" + s + "/").hostname.replace(/\.$/, "").toLowerCase();
  } catch (e) {
    return null;
  }
  if (!host || host.includes("@") || !DOMAIN_RE.test(host)) return null;
  return host;
}

export function hostsFromBootstrap(body) {
  const hosts = new Set([START_HOST]);
  let json;
  try {
    json = JSON.parse(String(body || "").replace(/^\uFEFF/, ""));
  } catch (e) {
    return hosts;
  }
  const services = json && Array.isArray(json.services) ? json.services : [];
  services.forEach(function (service) {
    const urls = Array.isArray(service) ? service[1] : null;
    if (!Array.isArray(urls)) return;
    urls.forEach(function (raw) {
      if (typeof raw !== "string") return;
      let u;
      try { u = new URL(raw); } catch (e) { return; }
      if (u.protocol !== "https:" || u.username || u.password) return;
      if (u.port && u.port !== "443") return;
      const host = u.hostname.replace(/\.$/, "").toLowerCase();
      if (host) hosts.add(host);
    });
  });
  return hosts;
}

function utcDay(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

export function registrationMs(json) {
  if (!json || typeof json !== "object" || !Array.isArray(json.events)) return null;
  let best = null;
  json.events.forEach(function (ev) {
    if (!ev || ev.eventAction !== "registration" || typeof ev.eventDate !== "string") return;
    const t = Date.parse(ev.eventDate);
    if (!Number.isFinite(t)) return;
    if (best === null || t > best) best = t;
  });
  return best;
}

function hostAllowed(urlStr, allow) {
  let u;
  try { u = new URL(urlStr); } catch (e) { return null; }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if (u.port && u.port !== "443") return null;
  const host = u.hostname.replace(/\.$/, "").toLowerCase();
  if (!host || !allow.has(host)) return null;
  return u;
}

export async function lookupRegistration(domain, deps) {
  const host = normalizeDomain(domain);
  if (!host) return { status: "unavailable" };
  const allow = deps.allowHosts instanceof Set ? deps.allowHosts : await deps.allowHosts();
  if (!allow || !allow.has(START_HOST)) return { status: "unavailable" };
  let url = "https://" + START_HOST + "/domain/" + encodeURIComponent(host);
  const seen = new Set();
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (seen.has(url)) return { status: "unavailable" };
    seen.add(url);
    if (!hostAllowed(url, allow)) return { status: "unavailable" };
    let res;
    try {
      res = await deps.request(url);
    } catch (e) {
      return { status: "unavailable" };
    }
    const status = res && res.status;
    if (status >= 300 && status < 400) {
      if (!res.location || String(res.location).length > 2048) return { status: "unavailable" };
      let next;
      try { next = new URL(res.location, url); } catch (e) { return { status: "unavailable" }; }
      if (!hostAllowed(next.toString(), allow)) return { status: "unavailable" };
      url = next.toString();
      continue;
    }
    if (status !== 200 || typeof res.body !== "string") return { status: "unavailable" };
    let json;
    try { json = JSON.parse(res.body.replace(/^\uFEFF/, "")); } catch (e) { return { status: "unavailable" }; }
    const ms = registrationMs(json);
    if (ms == null) return { status: "unavailable" };
    const now = typeof deps.now === "function" ? deps.now() : Date.now();
    const age = Math.floor((now - ms) / DAY_MS);
    if (!Number.isInteger(age) || age < 0 || age > 200000) return { status: "unavailable" };
    return { created: utcDay(ms), age_days: age };
  }
  return { status: "unavailable" };
}

export function httpsGet(urlStr, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 2000;
  const maxBytes = (opts && opts.maxBytes) || 1000000;
  return new Promise(function (resolve, reject) {
    let u;
    try { u = new URL(urlStr); } catch (e) { reject(e); return; }
    if (u.protocol !== "https:") { reject(new Error("not-https")); return; }
    const req = https.request({
      method: "GET",
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: {
        accept: "application/rdap+json, application/json",
        "user-agent": "mail-check-domain-age"
      },
      timeout: timeoutMs
    }, function (res) {
      const chunks = [];
      let size = 0;
      let failed = false;
      res.on("data", function (c) {
        if (failed) return;
        size += c.length;
        if (size > maxBytes) {
          failed = true;
          req.destroy();
          reject(new Error("too-large"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", function () {
        if (failed) return;
        const loc = res.headers.location;
        resolve({
          status: res.statusCode || 0,
          location: Array.isArray(loc) ? (loc[0] || "") : (loc || ""),
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    req.on("timeout", function () { req.destroy(new Error("timeout")); });
    req.on("error", reject);
    req.end();
  });
}

export async function loadAllowHosts(request, now) {
  const t = typeof now === "function" ? now() : Date.now();
  if (bootstrapCache.hosts && t - bootstrapCache.at < 6 * 3600 * 1000) return bootstrapCache.hosts;
  const hosts = new Set([START_HOST]);
  try {
    const res = await request(BOOTSTRAP_URL);
    if (!res || res.status !== 200) throw new Error("bootstrap");
    hostsFromBootstrap(res.body).forEach(function (h) { hosts.add(h); });
    bootstrapCache.at = t;
    bootstrapCache.hosts = hosts;
  } catch (e) {
    if (bootstrapCache.hosts) return bootstrapCache.hosts;
  }
  return hosts;
}

export function resetBootstrapCache() {
  bootstrapCache.at = 0;
  bootstrapCache.hosts = null;
}

function header(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") {
    const v = headers.get(name);
    return v == null ? "" : String(v);
  }
  const v = headers[name] ?? headers[name.toLowerCase()] ?? "";
  return Array.isArray(v) ? String(v[0] || "") : String(v || "");
}

export function isSameOrigin(headers) {
  const rawHost = header(headers, "x-forwarded-host") || header(headers, "host");
  const host = rawHost.split(",")[0].trim().toLowerCase();
  const site = header(headers, "sec-fetch-site").trim().toLowerCase();
  if (site && site !== "same-origin") return false;
  const origin = header(headers, "origin").trim();
  if (!origin || !host) return false;
  let u;
  try { u = new URL(origin); } catch (e) { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  return u.host.toLowerCase() === host;
}

function readJson(req) {
  const len = Number(header(req.headers, "content-length") || 0);
  if (Number.isFinite(len) && len > 256) return null;
  const b = req.body;
  if (b && typeof b === "object" && !Buffer.isBuffer(b)) return b;
  if (typeof b === "string") {
    if (b.length > 256) return null;
    try { return JSON.parse(b); } catch (e) { return null; }
  }
  if (Buffer.isBuffer(b)) {
    if (b.length > 256) return null;
    try { return JSON.parse(b.toString("utf8")); } catch (e) { return null; }
  }
  return null;
}

function allowIp(ip, now, limit, windowMs, buckets) {
  let stamps = buckets.get(ip) || [];
  stamps = stamps.filter(function (t) { return now - t < windowMs; });
  if (stamps.length >= limit) {
    buckets.set(ip, stamps);
    return false;
  }
  stamps.push(now);
  buckets.set(ip, stamps);
  if (buckets.size > 2000) {
    const first = buckets.keys().next().value;
    buckets.delete(first);
  }
  return true;
}

function send(res, code, payload) {
  const body = JSON.stringify(payload);
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.status(code).json(payload);
    return;
  }
  res.statusCode = code;
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(body);
}

export function createHandler(options) {
  const opts = options || {};
  const request = opts.request || httpsGet;
  const nowFn = opts.now || function () { return Date.now(); };
  const allowHosts = opts.allowHosts || function () { return loadAllowHosts(request, nowFn); };
  const limitPerIp = opts.limitPerIp || 20;
  const windowMs = opts.windowMs || 10 * 60 * 1000;
  const globalPerMinute = opts.globalPerMinute || 60;
  const buckets = new Map();
  let globalStamps = [];
  const cache = opts.cache || createMemoryDateCache();

  return async function handler(req, res) {
    const unavailable = function (code) { send(res, code, { status: "unavailable" }); };
    if (!req || req.method !== "POST") {
      if (res.setHeader) res.setHeader("allow", "POST");
      unavailable(405);
      return;
    }
    if (!isSameOrigin(req.headers || {})) {
      unavailable(403);
      return;
    }
    const now = nowFn();
    globalStamps = globalStamps.filter(function (t) { return now - t < 60000; });
    if (globalStamps.length >= globalPerMinute) {
      unavailable(429);
      return;
    }
    const ip = (header(req.headers, "x-forwarded-for").split(",")[0] || header(req.headers, "x-real-ip") || "unknown").trim() || "unknown";
    if (!allowIp(ip, now, limitPerIp, windowMs, buckets)) {
      unavailable(429);
      return;
    }
    globalStamps.push(now);
    const json = readJson(req);
    const domain = json && typeof json.domain === "string" ? normalizeDomain(json.domain) : null;
    if (!domain) {
      unavailable(400);
      return;
    }
    const cached = cache.get(domain, now);
    if (cached && cached.created) {
      const cachedAge = ageDaysFromCreated(cached.created, now);
      if (cachedAge != null) {
        send(res, 200, { created: cached.created, age_days: cachedAge });
        return;
      }
    } else if (cached && cached.status === "unavailable") {
      send(res, 200, { status: "unavailable" });
      return;
    }
    let result;
    try {
      result = await lookupRegistration(domain, { request: request, now: nowFn, allowHosts: allowHosts });
    } catch (e) {
      result = { status: "unavailable" };
    }
    if (!result || result.status === "unavailable" || typeof result.age_days !== "number" || typeof result.created !== "string") {
      cache.setUnavailable(domain, now);
      send(res, 200, { status: "unavailable" });
      return;
    }
    cache.setDate(domain, result.created, now);
    send(res, 200, { created: result.created, age_days: result.age_days });
  };
}

const handler = createHandler();
export default handler;
