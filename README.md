# x402 Seller Probe

x402 の売り手が「正しく動くか」を外から測り、ホストごとのスコアとして公開します（`probe.x402jp.com` を想定）。

- **無料の測定**（毎日）：支払わずに 402 応答を取得し、形式を検査する。全対象。
- **有料の測定**（週 1 回）：最小額で 1 コール購入し、決済と納品を検査する。上位の一部。
- **自社だけに当てる試験**（週 1 回）：同じ支払いヘッダの再送とキャッシュ。OSD・JIN にだけ当て、`self-check/` に別記録（スコアには入れない）。
- 結果は JSON API（`GET /scores`、`GET /scores/:host`）と公開ページで出す。
- x402 RFQ Market の買い手は、仕様 JSON の `min_probe_score` でスコアを見積もりの選定条件に使える（`kato9292929/RFQ` 側）。

## 構成

```
src/
  config.ts          チェーン・公式 USDC・支払い上限（コード内の定数。env では変えられない）
  catalog.ts         endpoint リポジトリのカタログ（読み取り専用、コミット固定）と代表エンドポイントの選定
  popularity.ts      直近 7 日のコール数（x402scan、取れなければ endpoint の rank.json＝1 日分で代替し明記）
  targets.ts         targets/YYYY-MM-DD.json を作る
  x402.ts            402 の解析（v1 本文 / v2 PAYMENT-REQUIRED ヘッダ）と項目検査
  probe-free.ts      §3.1 無料の測定
  probe-paid.ts      §3.2 有料の測定（not_delivered の判定を含む）
  outcome.ts         有料の測定の区分（delivered / not_delivered / request_rejected / failed）。古いログも同じ規則で読む
  pay.ts             支払いクライアント（@x402/* 2.28、exact・公式 USDC・Solana/Base 本番のみ）
  budget.ts          1 コール $0.01・7 日間 $5 の強制
  chains/solana.ts   自分の署名の抽出、tx の照会、USDC 送金の照合
  chains/base.ts     EIP-3009 の nonce、receipt の照会、USDC Transfer の照合
  facilitator.ts     402 の extra からファシリテーターを判定
  self-check.ts      §3.3（自社ホストの許可リストはコードに固定）
  wallet-env.ts      鍵の読み込み（env → .keys/）と Secret 名、未設定の判定
  score.ts           §4 スコア
  rfq.ts             RFQ indexer の GET /sellers（参考値。スコアには入れない）
  cli/               npm scripts の入口（wallet-new.ts はウォレット生成）
config/
  weights.json       スコアの重み（version と history で変更履歴を残す）
  probe.json         有料の測定の対象数（初週は top 10 のみ）
  facilitators.json  feePayer → ファシリテーター名（出典を確認できたものだけ）
log/                 全測定（YYYY-MM-DD.jsonl、追記のみ）
self-check/          §3.3 の結果（追記のみ）
targets/             日ごとの対象
data/rfq-sellers.json RFQ の売り手成績のスナップショット
docs/wallet.md       Probe 専用ウォレットの公開アドレス（npm run wallet:new が書く）
web/                 公開ページ（React + Vite + Tailwind + shadcn/ui）。ビルド先は dist/、dist/data/ はビルド時に log/ から生成（どちらもコミットしない）
```

## 対象の選び方（§2）

1. `kato9292929/endpoint` の `main` を `git ls-remote` で解決し、そのコミットの `data/endpoints_full.json.gz` を読む（`targets/*.json` の `catalog.commit` に記録）。
2. x402・USDC 建て・Solana か Base・https・パラメータのテンプレート（`{id}`）を含まない URL を抽出。
3. **無料**：ホストごとに価格が最小のエンドポイントを 1 つ。
4. **有料**：直近 7 日のコール数上位から、代表エンドポイントの価格が $0.01 以下のホストを `top_n` 件 ＋ 残りから無作為に `random_n` 件（乱数の種は日付。再現可能）。外したホストと理由は `paid.skipped_popular` に残す。
5. **実際に買える売り手だけで枠を埋める**：候補を上から順に見て、次のどれかに当たる売り手は理由付きで外し（`paid.screened.dropped` と `paid.skipped_popular`）、次点を繰り上げて `top_n` 件（無作為枠は `random_n` 件）にする。
   - `excluded: <category>`：`config/exclusions.json` の除外リストに載っている、またはホスト名・URL が除外の語（lottery・casino など）に当たる。**くじなどの賭博は買わない**（実際のお金で賭けをしたことになりうる＝刑法の賭博罪。当たり外れが結果そのものなので「届いたか」の判定も成り立たない）。理由は一覧に書く。有料の測定は買う直前にも同じ判定をし、targets に入っていても買わない（`skipped: "excluded: …"`）。無料の測定（支払いなしの GET）は対象のまま。
   - `no_402: …`：入力なしの GET で 402 が返らない（200・405・404・接続できない等）。
   - `not_payable: …`：402 は返るが、買う側の条件（exact・Solana/Base の公式 USDC・金額が 1 以上かつ $0.01 以下）を満たす提示がない（例：金額 0）。買うときと同じ `refuseReason` で判定する。
   - `requires_input: …`：下の入力スキーマの判定に当たる。
6. **入力が必要な売り手は外す**：有料の候補ごとに支払いなしの GET で 402 を取り、入力スキーマ（v2 の bazaar 拡張 `extensions.bazaar` の `schema.properties.input` / `info.input`、v1 の `accepts[].outputSchema.input`）に必須の入力があれば外す（`src/x402.ts` の `inputRequirement`）。必須とみなすのは、メソッドが GET/HEAD 以外・本文の必須項目（`body.required`）・クエリの必須項目（`queryParams.required` や `required: true` のフィールド）。外したホストは `paid.skipped_popular` と `paid.screened.requires_input` に `requires_input: <理由>` で残し、次点を繰り上げて `top_n` 件にする。URL の見た目では判定しない。スキーマを出していない売り手は対象に残す。買う直前にも同じ判定をし、必須入力があれば `skipped: "requires_input: …"`（スコアに数えない）。

`config/probe.json` は初週用に `top_n: 10, random_n: 0` にしてある。挙動を確認したら `phase: "full", top_n: 50, random_n: 20` に変える（§5）。

## 測定項目（§3）

無料（`kind: "free"`）：`reachable`（10 秒）、`status_402`、`spec_version`（v1/v2）、`fields_valid`（scheme・network・asset・payTo・金額・resource）、`asset_known`（公式 USDC）、`payto_stable`（同じホスト・チェーンの前回と比較。初回は null）、`latency_402_ms`。
GET が 405 のときだけ空の JSON 本文で POST して 402 を取る（`method` に記録）。

有料（`kind: "paid"`）：`settle_ok`（PAYMENT-RESPONSE / X-PAYMENT-RESPONSE の success）、`onchain_ok`（tx を照会し、402 の金額・payTo と USDC の移動が一致）、`delivered`（200 と空でない本文）、`not_delivered`、`latency_paid_ms`、`cache_header`（`Cache-Control: no-store`、記録のみ）、`facilitator`、`tx`。

`not_delivered` は RFQ の買い手と同じ方式：

1. 支払い付きリクエストを送る**前に**、自分の署名を `paid_attempt` としてログに書く（Solana は送金 tx 内の自分の署名、Base は EIP-3009 の nonce と署名）。
2. 200 以外が返ったら、その署名を含む tx をチェーンで探す（Solana：自分のアドレスに触れた直近 tx の署名一覧を照合、Base：USDC の `AuthorizationUsed(自分, nonce)` イベント）。
3. 見つかった tx が 402 の提示どおりの送金なら `not_delivered: true`（RFQ の理由コード 5 と同じ）。

**tx 署名の記録**：署名した支払いはすべて、送信前の `paid_attempt` と結果の `paid` の両方に自分の署名（`payer_signature`、Base は `authorization_nonce` と署名の SHA-256 `authorization_signature_sha256`）を持つ。Base の署名そのものはログに書かない（署名済み authorization は誰でも `transferWithAuthorization` で実行できるため）。チェーン上の tx が判明したもの（settle 応答、または上の検索で発見）は `tx` にその署名／ハッシュと出所（`tx_source`）を入れる。送金が着地しなかった場合だけ `tx: null` になり、そのときも自分の署名は残る。

**失敗時の記録**：有料の測定で 200 以外が返ったら、`http_status`、402 なら応答の `error` 欄（v2 は PAYMENT-REQUIRED の文書、v1 は本文の JSON。`x402_error`）、本文の先頭 300 文字（`error_body`、空白は詰める）を残す。無料の測定でも 402 以外が返ったら `error_body` を残す。応答ヘッダは `Cache-Control` 以外記録しない（Authorization 系は書かない）。

**有料の測定の判定**（`src/outcome.ts` の `classifyPaid`、各行に `outcome` として記録）：

| 区分 | 条件 | 集計での扱い |
|---|---|---|
| `delivered` | 送金成立（`tx` あり）かつ 200 と空でない本文 | 成功 |
| `not_delivered` | 送金成立かつ 200 以外（または空の本文） | 失敗 |
| `request_rejected` | 送金なし（`tx` なし）で 4xx または 402 | **失敗に数えない**。納品の成否の分母にも分子にも入れず、件数（`n_rejected`）と直近の理由（`last_rejection`）だけを出す |
| `failed` | 送金なしでそれ以外（5xx・タイムアウト・送金のない 200） | 失敗（従来どおり） |

**2026-10-19 分の読み替え**：10/19 の行は `outcome` を記録する前のもの。ログは書き換えず、集計（`src/score.ts`）と公開用の履歴（`src/cli/score.ts`）で、上の条件をそのまま当てはめて読み替える。`tx` が null で `http_status` が 400〜499（402 を含む）の行は `request_rejected`、`tx` があって 200 以外の行（x402.sniperx.fun の 400）は `not_delivered` のまま。10/19 の行には `x402_error` / `error_body` が無いので、理由は「未記録」と表示する。

有料で買うのは GET で 402 を返す、`exact`・公式 USDC・Solana/Base 本番の提示だけです（Base は EIP-3009 のみ、Permit2 は買わない）。買わなかった理由は `skipped` に残し、スコアには数えません。

## スコア（§4）

`config/weights.json` の重みで、直近 30 日の測定から項目ごとの合格率を出し、

```
score = 100 × Σ(重み × 合格率) ÷ Σ(重み)    （観測のない項目は除く）
```

- 前段の失敗は後段も不合格（応答なし → 402 なし → 形式・asset も不合格）。
- `payto_stable` は比較できたときだけ、`latency_paid` は納品できた回だけ数える。
- 応答時間は 1000 ms 以下を 1、10000 ms 以上を 0 として線形に換算。
- `not_delivered` は `1 − 発生率`。
- 有料の測定がないホストは無料の項目だけで計算し、`coverage: "free_only"`。`request_rejected` しかないホストもここに入る。
- `request_rejected` の行は有料の項目（settle_ok・onchain_ok・delivered・not_delivered・latency_paid）のどれにも入れない。

重みを変えるときは `version` を上げ、`history` に 1 行足す（Git の履歴と合わせて変更履歴になる）。式と重みは公開ページにそのまま表示される。

## 支払いの上限（§5）

`src/config.ts` の `LIMITS`（1 コール 10000 = $0.01、7 日間 5000000 = $5）。`src/budget.ts` が**署名する前**に検査し、超える購入は止めて `skipped: "budget: …"` を記録する。
使った額は `log/` と `self-check/` の `*_attempt` レコード（送信前に書く）を直近 7 日分足して求めるので、決済されなかった試行も使ったものとして数える（安全側）。
支払いライブラリ側にも `$0.01` の上限を重ねている。

**1 コール $0.01 の上限を強制している箇所**（行番号はテスト `test/readme-refs.test.ts` が実ファイルと照合する。コードを動かして行がずれると `npm test` が落ちる）：

| 順 | ファイル:行 | 内容 |
|---|---|---|
| 定義 | `src/config.ts:37` | `perCall: 10_000n`（USDC 6 桁で $0.01）。env や設定ファイルからは変えられない |
| 1 | `src/pay.ts:55` | `refuseReason`：402 の金額が `LIMITS.perCall` を超える提示は買わない（`src/probe-paid.ts:96` で呼ぶ） |
| 2 | `src/budget.ts:30` | `assertWithinBudget`：同じ上限を再検査し、7 日間 $5（`src/budget.ts:31`）も見る。署名の前に `src/probe-paid.ts:107` で呼ぶ |
| 3 | `src/pay.ts:23` | 支払いライブラリ（`@x402/core`）の `spendControls.maxAmountPerPayment: "$0.01"`。上の 2 つを抜けても署名しない二重の柵 |

署名は 1・2 を通った後の `src/probe-paid.ts:117`（`signFor`）でだけ行う。対象選定時のカタログ価格の上限（`src/config.ts:41` の `catalogMaxPriceUsd`）は対象を絞るためのもので、支払いの強制ではない。

## 実行

```bash
npm ci
npm test                    # 単体テスト（ネットワーク不要）
npm run wallet:new          # Probe 専用ウォレットを作る（下の「ウォレット」）
npm run targets             # targets/YYYY-MM-DD.json
npm run probe:free          # 無料の測定 → log/
npm run probe:dry-run       # 有料の測定の確認モード：402・上限判定・署名まで。送信しない → log/（dry_run: true）
npm run probe:paid          # 有料の測定（本番の支払い）→ log/
npm run self-check          # 自社の OSD / JIN だけ → self-check/
npm run score               # dist/data/ を生成（log/ → scores.json と hosts/*.json）
npm run dev                 # 公開ページの開発サーバー（先に npm run score。/scores は dist/data から返す）
npm run build               # 公開ページのビルド（vite build → score）。Vercel もこれを実行
```

鍵は環境変数（`.env` または Actions の Secrets）から読み、無ければ `npm run wallet:new` が書いた `.keys/` から読む。

## ウォレット（Probe 専用）

```bash
npm run wallet:new
```

- Solana と Base の鍵を新規に作り、`.keys/probe-solana.json`（solana-keygen と同じ 64 バイトの JSON 配列）と `.keys/probe-base.key`（0x hex）に書く（権限 600、`.keys/` は .gitignore 済み）。既にあれば上書きせずに止まる。
- 公開アドレスだけを `docs/wallet.md` に書く。こちらはコミットしてよい。
- 最後に「Secret 名 → 貼り付ける値」を表示する（Solana は base58、Base は 0x hex）。名前は下の Secrets 一覧と同じ。
- Autonomous Agent の鍵・ウォレットは使わない（AA の購入記録と混ぜないため）。

**入金の目安**（7 日 $5 の上限に合わせる）：

| チェーン | USDC | ガス代 |
|---|---|---|
| Solana | $5 | SOL 少額（例 0.01 SOL。手数料は通常ファシリテーターが払うので予備） |
| Base | $5 | ETH 少額（例 0.0005 ETH。EIP-3009 なので通常は不要、予備） |

## 本番前の確認（--dry-run）

`npm run probe:dry-run`（= `probe:paid --dry-run`）は、402 の取得 → 提示額の上限判定 → 署名までを行い、**送信しない**。結果は `log/` に `kind: "paid"`, `dry_run: true` で残る。

| 記録する | 記録しない |
|---|---|
| host / url / network / 提示額（`amount`）/ payTo | 支払いヘッダ（`PAYMENT-SIGNATURE` / `X-PAYMENT`）本体 |
| 上限判定の結果 `cap_check: {pass, reason}` | 署名済みの authorization / tx |
| Solana：`payer_signature` | Base の署名そのもの |
| Base：`authorization_nonce` と署名の SHA-256（`authorization_signature_sha256`） | |

署名済みのものを書かないのは、Base の署名済み authorization は誰でも `transferWithAuthorization` で実行でき、Solana の署名済み tx も blockhash が有効な間は送信できるため。

`dry_run: true` の行は、スコア（`src/score.ts` の 30 日窓）と使用額（`src/budget.ts` の 7 日集計）の両方で読み飛ばす。dry-run は `paid_attempt` も書かない（`test/dry-run.test.ts`）。

## 定期実行（GitHub Actions）

| workflow | 時刻（UTC） | 手動起動 | 内容 |
|---|---|---|---|
| `free-daily.yml` | 毎日 03:17 | ○ | targets → 無料の測定 → RFQ スナップショット → `log/` `targets/` `data/` を main にコミット |
| `paid-weekly.yml` | 月曜 04:41 | ○（`dry_run` 入力、既定 true） | 有料の測定 → `log/` を main にコミット |
| `self-check-weekly.yml` | 月曜 05:53 | ○ | 自社への再送・キャッシュ試験 → `self-check/` を main にコミット |

- 3 つとも `permissions: contents: write`、`concurrency: probe-data`（直列）、checkout は `ref: main`。
- **本番の支払いのスイッチ**：リポジトリ変数 `PROBE_PAID_ENABLED` が `true` のときだけ paid-probe は実際に支払い、self-check も動く。それまでは paid-probe は定期実行でも dry-run になり、self-check は「paid runs not enabled」と記録して終わる。dry-run の結果を確認してから `true` にする。
- **Secrets が無いとき**：paid-probe と self-check はエラーで落とさず、`kind: "run_skipped"`, `reason: "secrets not configured (未設定)"`, `missing: [...]` を記録して正常終了する（片方のチェーンだけ設定されていれば、そのチェーンだけ測る）。

### Secrets と Variables

GitHub → Settings → Secrets and variables → Actions。

| 種類 | 名前 | 値 | どこで作るか | 必須 |
|---|---|---|---|---|
| Secret | `PROBE_SOLANA_SECRET_KEY` | base58 の 64 バイト秘密鍵 | `npm run wallet:new` の表示 | paid / self-check（Solana） |
| Secret | `PROBE_EVM_PRIVATE_KEY` | 0x で始まる 32 バイト秘密鍵 | `npm run wallet:new` の表示 | paid / self-check（Base） |
| Secret | `SOLANA_RPC_URL` | Solana mainnet の RPC URL | RPC 事業者（Helius など） | 任意（無ければ公開 RPC。`getSignaturesForAddress` の制限が厳しいので推奨） |
| Secret | `BASE_RPC_URL` | Base mainnet の RPC URL | RPC 事業者（Alchemy など） | 任意（無ければ `mainnet.base.org`。`eth_getLogs` の範囲制限があるので推奨） |
| Variable | `PROBE_PAID_ENABLED` | `true` | 手で設定 | dry-run 確認後に設定 |
| Variable | `JIN_PAID_URL` | 既定 `https://jin.x402jp.com/api/jin/series` | — | 任意 |
| Variable | `OSD_PAID_URL` | 既定 `https://osd.x402jp.com/api/alpha/portfolio/current` | — | 任意 |
| Variable | `RFQ_INDEXER_URL` | 公開されている RFQ indexer の URL | — | 任意（未設定なら RFQ 参考値の列が空） |

自社ホストの許可リストは `src/self-check.ts` の `SELF_HOSTS`（`jin.x402jp.com`、`osd.x402jp.com`）。それ以外のホストに再送・キャッシュ試験は当たらない（テストあり）。

### 初回の手順（順番が大事）

1. 既定ブランチを `main` にする（GitHub → Settings → General → Default branch）。schedule トリガーは既定ブランチのワークフローで動く。
2. `npm run wallet:new` → 表示された 2 つの値を Secrets に登録 → 入金（上の目安）→ `docs/wallet.md` をコミット。
3. **free-probe を手動実行して 1 回通す。** paid-probe は free-probe が作る `targets/YYYY-MM-DD.json` を読むので、これがないと `no targets` で止まる。
4. **paid-probe を `dry_run: true` で手動実行**し、上位 10 ホストの提示額・`cap_check`・署名を `log/` で確認する（Actions のログにも 1 ホスト 1 行で出る）。
5. 問題なければ変数 `PROBE_PAID_ENABLED=true` を設定。以後、月曜の定期実行で本番の支払いと self-check が動く。
6. 初週の結果を確認してから `config/probe.json` を `phase: "full", top_n: 50, random_n: 20` に変える（§5）。

## デプロイ（Vercel + XServer DNS）

`vercel.json`：

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    { "source": "/scores", "destination": "/data/scores.json" },
    { "source": "/scores/:host", "destination": "/data/hosts/:host.json" }
  ]
}
```

（実ファイルには CORS 許可と 5 分キャッシュのヘッダ設定もある）

1. Vercel で本リポジトリを Import（Framework Preset: Other）。Production Branch は `main`。
2. 必要なら Vercel の Environment Variables に `RFQ_INDEXER_URL`。
3. Vercel の Domains に `probe.x402jp.com` を追加。
4. XServer の DNS レコード設定で、ホスト名 `probe`、種別 `CNAME`、内容 `cname.vercel-dns.com.` を追加。

**更新の仕組み**：ページのデータはコミットしない。`main` への push（定期実行のコミットを含む）が Vercel の再ビルドの引き金になり、ビルド時に `npm run build` が、`web/` の公開ページを `dist/` にビルドしたあと、`src/cli/score.ts` で `log/` から `dist/data/scores.json` と `dist/data/hosts/*.json` を作る。つまり毎日の free-probe のコミットで 1 日 1 回スコアが更新される。

測定データが 0 件でもビルドは通り、`GET /scores` は `{"hosts":0,"scores":[]}` を返し、公開ページは「まだ測定データがありません」と表示する。未測定のホストの `GET /scores/:host` は 404。

## API

```
GET /scores
  { generated_at, window_days, weights_version, hosts, rfq: {status, fetched_at, used_in_score: false},
    scores: [{ host, score, coverage, n_free, n_paid, last_free_at, last_paid_at, latest: {...}, rfq }] }

GET /scores/:host     （ホストは小文字・ポートなし・先頭の www. を除いたもの）
  { host, score, coverage, items: { reachable: {value, n, weight}, ... }, latest, rfq, history: [直近 60 件] }
```

## x402 RFQ Market との連携（§6）

`kato9292929/RFQ` 側：

- 仕様 JSON の任意項目 `min_probe_score`（0〜100）。
- 買い手は見積もりを集めたあと、売り手のエンドポイントのホストで `GET {PROBE_URL}/scores/:host` を引き、スコアが `min_probe_score` 未満の見積もりを除外してから採択する。除外と理由はログ（`quotes_collected.excluded`、`probe_filter`）に残す。
  - 未測定のホスト（404）は「未満」ではないので除外しない。`probe_unscored` を記録して従来どおり選ぶ。
  - Probe の API が応答しないときも除外せず、`probe_unavailable` を記録して従来どおり選ぶ。
- indexer の `GET /sellers` の各行に `endpoint_hosts` を追加（既存の項目は変えない）。Probe はこれでホストと突き合わせ、成立・拒否・not_delivered を参考値として公開ページに並べる（スコアには入れない）。

## やらないこと

第三者の売り手に対する再送・キャッシュ・負荷の試験、上限を超える支払い、既存リポジトリ（endpoint / aa / osd / jin）の変更。
