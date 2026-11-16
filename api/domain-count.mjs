// 判定回数の照会。この Vercel 関数は何も保存しない。
// 確認用のサイトでは回数を出さないため、常に利用不可を返す。
// ドメインと日時の記録は、別の PHP サーバで行う。

function send(res, payload) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.status(200).json(payload);
    return;
  }
  res.statusCode = 200;
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export default function handler(req, res) {
  send(res, { status: "unavailable" });
}
