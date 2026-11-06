# メール判定.com

貼り付けたメール／SMSの文字情報から、詐欺・フィッシングによく見られる特徴を指摘する静的サイトです。
判定はすべてブラウザ内の JavaScript で行い、入力内容はサーバーへ送信しません。

- 判定プロトコル: **v0.8**（2026-11-06 JST 凍結版）
- 出力スキーマ: `0.8-jp-4in+2opt`
- 精度は**未測定**です。精度・検出率の数値は表示・宣伝しないでください。
- 本実装はプロトコルのブラウザ内サブセットです。稼働ゲート G0/G1b/G3/G4 は未達で、`route_enabled=false`（新規 P16/P17 の S は内部 shadow とし、画面では「要確認」）。本番の判定経路として承認されたものではありません。

## 入力（§2.1）
| 項目 | 必須 | 内容 |
|---|---|---|
| display_name 送信元名 | 任意 | |
| from_email 送信元アドレス | email時は解析可能な@アドレス | SMS時は「SMSの送信元」（電話番号・短い名前・空欄可） |
| body 本文 | 必須（非空） | |
| context_answer | 必須 | 「このメール（SMS）に心当たりはありますか？」はい／いいえ／わからない（既定: わからない） |
| visible_link_url リンク先 | 任意 | 開かずにコピーできる場合のみ。空欄推奨 |
| channel | 任意 | email（既定）／sms |

## 結果（§3・§8）
`strong_suspicion`（詐欺メールの疑いが強いです）／`needs_review`（注意が必要です・要確認）／`no_clear_signal`（このツールでは判断できませんでした…＋必須バナー「安全ではありません…」、グレー表示）／`insufficient`（情報が足りず判定できません）。
「本物」「安全」「正規」「問題ありません」という判定は存在しません。`safety_guarantees` は常に false。結果中のURLはクリックできない文字列として表示します。

## ファイル構成
- `index.html` … 画面（インラインのscript/styleなし）
- `css/app.css` … スタイル
- `js/protocol-data.js` … §7 台帳（比較アンカー、送信台帳、短縮URL一覧など）
- `js/judge.js` … 判定エンジン（ネットワークアクセスなし）
- `js/ui.js` … フォームと結果表示
- `js/judge.test.mjs` … §10の一部を予約ドメインで実行する合成テスト（`node js/judge.test.mjs`）。全件合格を意味しません
- `vercel.json` … セキュリティヘッダー（CSP: `script-src 'self'; style-src 'self'; connect-src 'none'`）
- `robots.txt`

## デプロイ（GitHub → Vercel）
このフォルダをリポジトリに push し、Vercel の Add New → Project でインポート。Framework Preset は「Other」、Build Command / Output Directory は空欄。CLI の場合は `vercel --prod`。
独自ドメイン「メール判定.com」は Punycode `xn--4dkua4c743s94j.com` として Domains に追加します。

## 既知の制限（homepage担当向け）
- SPF/DKIM、真のリンク先（HTML href）、添付の中身、Reply-To は検証しません。From の一致は認証ではありません。
- 登録ドメイン判定は Public Suffix List の簡易近似、IDNA は URL API 依存。
- 本番の計測URL・リダイレクト・scoped_route 台帳は空（G4未達）。未登録の計測URLは普通のURLとして評価します。
- CTA とリンクの対応付けは文単位の近似。コピーURLは機微CTAが1つのときだけ対応付けます。
- E01（ランダム文字列）は研究候補の weak で閾値未校正。.xyz 等のTLDだけでは加点しません（v0.3の独自TLD判定は削除）。
- 台帳は例示で完全一覧ではありません。台帳更新は人手レビューで行い、入力内容から登録しないでください。

## 免責
本結果は入力された文字情報だけに基づく補助的な判定で、安全性や正当性を保証するものではありません。これは参考情報です。最終的な判断はご自身でお願いします。
