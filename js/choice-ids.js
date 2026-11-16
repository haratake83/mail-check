/* 送信元ジャンルとメール内容の短いID。画面・週間ランキング・履歴で同じ対応表を使う。 */
(function (g) {
  "use strict";
  var GENRE = {
    gov: "公的機関・自治体",
    ec: "通販・EC",
    delivery: "宅配・配送",
    bank: "銀行・証券",
    card: "クレジットカード",
    carrier: "携帯・通信会社",
    points: "ポイント・マイル",
    subscription: "動画・サブスク",
    it: "IT・SNS・セキュリティ",
    travel: "旅行・交通・チケット",
    crypto: "暗号資産・投資",
    other: "その他・不明"
  };
  var CONTENT = {
    undelivered: "不在通知・再配達・持ち戻り",
    lock: "アカウント停止・凍結・ロック",
    payment_update: "支払い方法の更新・支払いエラー",
    unpaid: "未払い・引き落とし失敗・差し押さえ予告",
    fraud_alert: "不正利用・異常ログインの検知",
    prize: "還付金・給付金・キャンペーンの受け取り",
    point_expiry: "ポイント失効・有効期限切れ",
    virus: "ウイルス感染・容量不足の警告",
    reservation: "予約確認・利用明細の確認",
    reauth: "再認証・秘密鍵やマイナンバーの入力",
    other: "その他・不明"
  };
  g.MH_CHOICES = { GENRE: GENRE, CONTENT: CONTENT };
})(typeof globalThis !== "undefined" ? globalThis : this);
