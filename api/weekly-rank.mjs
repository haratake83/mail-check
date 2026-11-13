// 週間ランキング。直近7日・10回以上・最大10件。
// 残すのは登録ドメインと、選択されたジャンル・内容の回数だけ。メールアドレスは残さない。
import net from "node:net";
import tls from "node:tls";
import { normalizeDomain, isSameOrigin } from "./domain-created.mjs";

export const WEEK_MS = 7 * 86400000;
export const MIN_COUNT = 10;
export const MAX_ROWS = 10;
const EVENT_KEY = "mc:week:events";

const SLD = { co: 1, or: 1, ne: 1, go: 1, ac: 1, ad: 1, ed: 1, gr: 1, lg: 1, com: 1, net: 1, org: 1, gov: 1, edu: 1 };

export const GENRE_LABELS = {
  delivery: "宅配便・配送業者",
  bank: "銀行・カード会社",
  ec: "通販サイト",
  carrier: "通信キャリア",
  gov: "官公庁・税務署",
  other: "その他・不明"
};
export const CONTENT_LABELS = {
  undelivered: "不在通知・再配達",
  lock: "アカウント停止・ロック",
  unpaid: "未払い料金の請求",
  prize: "当選・給付金の案内"
};

export function toRegistrable(host) {
  const p = String(host || "").split(".");
  if (p.length <= 2) return host;
  const tld = p[p.length - 1];
  const sld = p[p.length - 2];
  if (tld.length === 2 && SLD[sld]) return p.slice(-3).join(".");
  return p.slice(-2).join(".");
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

function allowIp(ip, now, limit, windowMs, buckets) {
  let stamps = buckets.get(ip) || [];
  stamps = stamps.filter(function (t) { return now - t < windowMs; });
  if (stamps.length >= limit) {
    buckets.set(ip, stamps);
    return false;
  }
  stamps.push(now);
  buckets.set(ip, stamps);
  if (buckets.size > 2000) buckets.delete(buckets.keys().next().value);
  return true;
}

function withinWeek(at, now) {
  return typeof at === "number" && now - at < WEEK_MS && now - at >= 0;
}

export function rankRows(events, kind, labelOf) {
  const counts = new Map();
  events.forEach(function (event) {
    if (!event || event.kind !== kind || typeof event.key !== "string") return;
    counts.set(event.key, (counts.get(event.key) || 0) + 1);
  });
  const rows = [];
  counts.forEach(function (count, key) {
    if (count < MIN_COUNT) return;
    const label = labelOf(key);
    if (!label || label.indexOf("@") >= 0) return;
    rows.push({ key: key, label: label, count: count });
  });
  rows.sort(function (a, b) {
    if (b.count !== a.count) return b.count - a.count;
    const byLabel = a.label.localeCompare(b.label, "ja");
    if (byLabel) return byLabel;
    return a.key.localeCompare(b.key);
  });
  return rows.slice(0, MAX_ROWS).map(function (row) { return { key: row.key, label: row.label, count: row.count }; });
}

export function rankingsFromEvents(events) {
  return {
    domains: rankRows(events, "domain", function (key) { return key; }),
    genres: rankRows(events, "genre", function (key) { return GENRE_LABELS[key] || ""; }),
    contents: rankRows(events, "content", function (key) { return CONTENT_LABELS[key] || ""; })
  };
}

export function judgmentEvents(input, at) {
  if (!input || typeof input !== "object") return null;
  const keys = Object.keys(input);
  if (keys.some(function (key) { return key !== "domain" && key !== "genre" && key !== "content"; })) return null;
  if (typeof input.domain !== "string" || input.domain.indexOf("@") >= 0) return null;
  const host = normalizeDomain(input.domain);
  const domain = host ? toRegistrable(host) : "";
  if (!domain || domain.indexOf("@") >= 0) return null;
  if (input.genre != null && input.genre !== "" && !GENRE_LABELS[input.genre]) return null;
  if (input.content != null && input.content !== "" && !CONTENT_LABELS[input.content]) return null;
  const events = [{ kind: "domain", key: domain, at: at }];
  if (GENRE_LABELS[input.genre]) events.push({ kind: "genre", key: input.genre, at: at });
  if (CONTENT_LABELS[input.content]) events.push({ kind: "content", key: input.content, at: at });
  return events;
}

export function createMemoryWeeklyStore() {
  let events = [];
  function prune(now) {
    events = events.filter(function (event) { return withinWeek(event.at, now); });
    if (events.length > 10000) events = events.slice(events.length - 10000);
  }
  return {
    kind: "memory",
    async add(items, now) {
      items.forEach(function (item) {
        events.push({ kind: item.kind, key: item.key, at: item.at });
      });
      prune(now);
    },
    async read(now) {
      prune(now);
      return events.map(function (event) { return { kind: event.kind, key: event.key, at: event.at }; });
    }
  };
}

function memberOf(event, nonce) {
  return event.kind + "\t" + event.key + "\t" + nonce;
}

function eventFromMember(member, score) {
  const parts = String(member || "").split("\t");
  if (parts.length < 3) return null;
  if (parts[0] !== "domain" && parts[0] !== "genre" && parts[0] !== "content") return null;
  if (!parts[1] || parts[1].indexOf("@") >= 0) return null;
  return { kind: parts[0], key: parts[1], at: Number(score) };
}

export function createCommandWeeklyStore(exec) {
  return {
    kind: "command",
    async add(items, now) {
      const commands = items.map(function (item, index) {
        return ["ZADD", EVENT_KEY, String(item.at), memberOf(item, item.at + ":" + index + ":" + Math.random().toString(36).slice(2))];
      });
      commands.push(["ZREMRANGEBYSCORE", EVENT_KEY, "-inf", String(now - WEEK_MS)]);
      await exec(commands);
    },
    async read(now) {
      const cutoff = now - WEEK_MS;
      const result = await exec([
        ["ZREMRANGEBYSCORE", EVENT_KEY, "-inf", String(cutoff)],
        ["ZRANGEBYSCORE", EVENT_KEY, "(" + cutoff, "+inf", "WITHSCORES"]
      ]);
      const flat = result && result[1];
      const events = [];
      if (Array.isArray(flat)) {
        for (let i = 0; i < flat.length; i += 2) {
          const event = eventFromMember(flat[i], flat[i + 1]);
          if (event && withinWeek(event.at, now)) events.push(event);
        }
      }
      return events;
    }
  };
}

function encodeCommand(args) {
  const chunks = [Buffer.from("*" + args.length + "\r\n")];
  args.forEach(function (arg) {
    const buf = Buffer.from(String(arg));
    chunks.push(Buffer.from("$" + buf.length + "\r\n"));
    chunks.push(buf);
    chunks.push(Buffer.from("\r\n"));
  });
  return Buffer.concat(chunks);
}

function parseResp(buffer) {
  if (!buffer.length) return null;
  const type = String.fromCharCode(buffer[0]);
  const end = buffer.indexOf("\r\n");
  if (end < 0) return null;
  if (type === "+" || type === "-" || type === ":") {
    const text = buffer.slice(1, end).toString("utf8");
    return { value: type === ":" ? Number(text) : text, rest: buffer.slice(end + 2), error: type === "-" };
  }
  if (type === "$") {
    const len = Number(buffer.slice(1, end).toString("utf8"));
    if (len < 0) return { value: null, rest: buffer.slice(end + 2) };
    const start = end + 2;
    if (buffer.length < start + len + 2) return null;
    return { value: buffer.slice(start, start + len).toString("utf8"), rest: buffer.slice(start + len + 2) };
  }
  if (type === "*") {
    const count = Number(buffer.slice(1, end).toString("utf8"));
    let rest = buffer.slice(end + 2);
    const values = [];
    for (let i = 0; i < count; i++) {
      const parsed = parseResp(rest);
      if (!parsed) return null;
      values.push(parsed.value);
      rest = parsed.rest;
    }
    return { value: values, rest: rest };
  }
  return null;
}

export function execRedis(urlStr, commands) {
  const u = new URL(urlStr);
  const secure = u.protocol === "rediss:";
  const port = Number(u.port || 6379);
  const auth = decodeURIComponent(u.password || "");
  const queued = auth ? [["AUTH", auth]].concat(commands) : commands.slice();
  return new Promise(function (resolve, reject) {
    const socket = (secure ? tls : net).connect({ host: u.hostname, port: port, servername: u.hostname });
    let buf = Buffer.alloc(0);
    const values = [];
    let settled = false;
    function finish(err, value) {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    }
    socket.setTimeout(4000, function () { finish(new Error("redis-timeout")); });
    socket.on("error", function (err) { finish(err); });
    socket.on("data", function (chunk) {
      buf = Buffer.concat([buf, chunk]);
      while (values.length < queued.length) {
        const parsed = parseResp(buf);
        if (!parsed) return;
        if (parsed.error) { finish(new Error("redis")); return; }
        values.push(parsed.value);
        buf = parsed.rest;
      }
      finish(null, auth ? values.slice(1) : values);
    });
    socket.on("connect", function () {
      socket.write(Buffer.concat(queued.map(encodeCommand)));
    });
  });
}

export function createKvExec(fetchImpl, url, token) {
  return async function exec(commands) {
    const res = await fetchImpl(String(url).replace(/\/$/, "") + "/pipeline", {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify(commands)
    });
    if (!res.ok) throw new Error("kv");
    const data = await res.json();
    return data.map(function (item) { return item && Object.prototype.hasOwnProperty.call(item, "result") ? item.result : item; });
  };
}

export function createWeeklyStore(env, deps) {
  const source = env || {};
  const fetchImpl = deps && deps.fetch;
  const restUrl = source.KV_REST_API_URL || source.UPSTASH_REDIS_REST_URL;
  const restToken = source.KV_REST_API_TOKEN || source.UPSTASH_REDIS_REST_TOKEN;
  if (restUrl && restToken && fetchImpl) return createCommandWeeklyStore(createKvExec(fetchImpl, restUrl, restToken));
  if (source.REDIS_URL) return createCommandWeeklyStore(function (commands) { return execRedis(source.REDIS_URL, commands); });
  return createMemoryWeeklyStore();
}

function send(res, code, payload) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.status(code).json(payload);
    return;
  }
  res.statusCode = code;
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  const len = Number(header(req.headers, "content-length") || 0);
  if (Number.isFinite(len) && len > 512) return null;
  const body = req.body;
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) return body;
  if (typeof body === "string") {
    if (body.length > 512) return null;
    try { return JSON.parse(body); } catch (e) { return null; }
  }
  if (Buffer.isBuffer(body)) {
    if (body.length > 512) return null;
    try { return JSON.parse(body.toString("utf8")); } catch (e) { return null; }
  }
  return null;
}

export function createWeeklyHandler(options) {
  const opts = options || {};
  const nowFn = opts.now || function () { return Date.now(); };
  const store = opts.store || createMemoryWeeklyStore();
  const limitPerIp = opts.limitPerIp || 30;
  const windowMs = opts.windowMs || 10 * 60 * 1000;
  const globalPerMinute = opts.globalPerMinute || 60;
  const buckets = new Map();
  let globalStamps = [];

  async function replyRankings(res, now) {
    const events = await store.read(now);
    send(res, 200, rankingsFromEvents(events));
  }

  return async function handler(req, res) {
    const unavailable = function (code) { send(res, code, { domains: [], genres: [], contents: [] }); };
    if (!req || (req.method !== "GET" && req.method !== "POST")) {
      if (res.setHeader) res.setHeader("allow", "GET, POST");
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
    const ip = (header(req.headers, "x-forwarded-for").split(",")[0] || "unknown").trim() || "unknown";
    if (!allowIp(ip, now, limitPerIp, windowMs, buckets)) {
      unavailable(429);
      return;
    }
    globalStamps.push(now);
    if (req.method === "GET") {
      await replyRankings(res, now);
      return;
    }
    const input = readJson(req);
    const events = judgmentEvents(input, now);
    if (!events) {
      unavailable(400);
      return;
    }
    await store.add(events, now);
    await replyRankings(res, now);
  };
}

const handler = createWeeklyHandler({ store: createWeeklyStore(process.env, { fetch: globalThis.fetch }) });
export default handler;
