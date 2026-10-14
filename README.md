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
  pay.ts             支払いクライアント（@x402/* 2.28、exact・公式 USDC・Solana/Base 本番のみ）
  budget.ts          1 コール $0.01・7 日間 $5 の強制
  chains/solana.ts   自分の署名の抽出、tx の照会、USDC 送金の照合
  chains/base.ts     EIP-3009 の nonce、receipt の照会、USDC Transfer の照合
  facilitator.ts     402 の extra からファシリテーターを判定
  self-check.ts      §3.3（自社ホストの許可リストはコードに固定）
  score.ts           §4 スコア
  rfq.ts             RFQ indexer の GET /sellers（参考値。スコアには入れない）
  cli/               npm scripts の入口
config/
  weights.json       スコアの重み（version と history で変更履歴を残す）
  probe.json         有料の測定の対象数（初週は top 10 のみ）
  facilitators.json  feePayer → ファシリテーター名（出典を確認できたものだけ）
log/                 全測定（YYYY-MM-DD.jsonl、追記のみ）
self-check/          §3.3 の結果（追記のみ）
targets/             日ごとの対象
data/rfq-sellers.json RFQ の売り手成績のスナップショット
public/index.html    公開ページ（public/data/ はビルド時に log/ から生成、コミットしない）
```

## 対象の選び方（§2）

1. `kato9292929/endpoint` の `main` を `git ls-remote` で解決し、そのコミットの `data/endpoints_full.json.gz` を読む（`targets/*.json` の `catalog.commit` に記録）。
2. x402・USDC 建て・Solana か Base・https・パラメータのテンプレート（`{id}`）を含まない URL を抽出。
3. **無料**：ホストごとに価格が最小のエンドポイントを 1 つ。
4. **有料**：直近 7 日のコール数上位から、代表エンドポイントの価格が $0.01 以下のホストを `top_n` 件 ＋ 残りから無作為に `random_n` 件（乱数の種は日付。再現可能）。外したホストと理由は `paid.skipped_popular` に残す。

`config/probe.json` は初週用に `top_n: 10, random_n: 0` にしてある。挙動を確認したら `phase: "full", top_n: 50, random_n: 20` に変える（§5）。

## 測定項目（§3）

無料（`kind: "free"`）：`reachable`（10 秒）、`status_402`、`spec_version`（v1/v2）、`fields_valid`（scheme・network・asset・payTo・金額・resource）、`asset_known`（公式 USDC）、`payto_stable`（同じホスト・チェーンの前回と比較。初回は null）、`latency_402_ms`。
GET が 405 のときだけ空の JSON 本文で POST して 402 を取る（`method` に記録）。

有料（`kind: "paid"`）：`settle_ok`（PAYMENT-RESPONSE / X-PAYMENT-RESPONSE の success）、`onchain_ok`（tx を照会し、402 の金額・payTo と USDC の移動が一致）、`delivered`（200 と空でない本文）、`not_delivered`、`latency_paid_ms`、`cache_header`（`Cache-Control: no-store`、記録のみ）、`facilitator`、`tx`。

`not_delivered` は RFQ の買い手と同じ方式：

1. 支払い付きリクエストを送る**前に**、自分の署名を `paid_attempt` としてログに書く（Solana は送金 tx 内の自分の署名、Base は EIP-3009 の nonce と署名）。
2. 200 以外が返ったら、その署名を含む tx をチェーンで探す（Solana：自分のアドレスに触れた直近 tx の署名一覧を照合、Base：USDC の `AuthorizationUsed(自分, nonce)` イベント）。
3. 見つかった tx が 402 の提示どおりの送金なら `not_delivered: true`（RFQ の理由コード 5 と同じ）。

**tx 署名の記録**：署名した支払いはすべて、送信前の `paid_attempt` と結果の `paid` の両方に自分の署名（`payer_signature`、Base は `authorization_nonce` と `authorization_signature`）を持つ。チェーン上の tx が判明したもの（settle 応答、または上の検索で発見）は `tx` にその署名／ハッシュと出所（`tx_source`）を入れる。送金が着地しなかった場合だけ `tx: null` になり、そのときも自分の署名は残る。

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
- 有料の測定がないホストは無料の項目だけで計算し、`coverage: "free_only"`。

重みを変えるときは `version` を上げ、`history` に 1 行足す（Git の履歴と合わせて変更履歴になる）。式と重みは公開ページにそのまま表示される。

## 支払いの上限（§5）

`src/config.ts` の `LIMITS`（1 コール 10000 = $0.01、7 日間 5000000 = $5）。`src/budget.ts` が**署名する前**に検査し、超える購入は止めて `skipped: "budget: …"` を記録する。
使った額は `log/` と `self-check/` の `*_attempt` レコード（送信前に書く）を直近 7 日分足して求めるので、決済されなかった試行も使ったものとして数える（安全側）。
支払いライブラリ側にも `$0.01` の上限を重ねている。

## 実行

```bash
npm ci
cp .env.example .env    # Probe 専用ウォレットの鍵と RPC を入れる（コミットしない）
npm test                # 単体テスト（ネットワーク不要）
npm run targets         # targets/YYYY-MM-DD.json
npm run probe:free      # 無料の測定 → log/
npm run probe:paid      # 有料の測定 → log/（鍵が必要）
npm run self-check      # 自社の OSD / JIN だけ → self-check/（鍵が必要）
npm run score           # public/data/ を生成（Vercel のビルドでも実行）
```

GitHub Actions：

| workflow | 時刻（UTC） | 内容 |
|---|---|---|
| `free-daily.yml` | 毎日 03:17 | targets → 無料の測定 → RFQ スナップショット → log/targets/data をコミット |
| `paid-weekly.yml` | 月曜 04:41 | 有料の測定 → log をコミット |
| `self-check-weekly.yml` | 月曜 05:53 | 自社への再送・キャッシュ試験 → self-check をコミット |

3 つとも `concurrency: probe-data` で直列に実行する。

### 初回の手順（順番が大事）

1. 本ブランチを `main` にする（schedule トリガーはデフォルトブランチでしか動かないので、3 つのワークフローすべての前提）。
2. Secrets（ウォレット・RPC）と Variables を登録する（下の「用意するもの」）。
3. **free-probe を Actions 画面から手動実行（workflow_dispatch）して 1 回通す。** paid-probe は free-probe が作る `targets/YYYY-MM-DD.json` を読むので、これがないと `no targets` で止まる。
4. その後は定期実行に任せてよい。最初の有料の測定を早く見たいときは paid-probe も手動実行する。
5. 初週の結果を確認してから `config/probe.json` を `phase: "full", top_n: 50, random_n: 20` に変える（§5）。

### 用意するもの

- **Probe 専用ウォレット**（Autonomous Agent の鍵は使わない）
  - Solana：`solana-keygen new -o probe.json` → 秘密鍵を Secrets `PROBE_SOLANA_SECRET_KEY` に。USDC を少額（例 $6）入れる。手数料はファシリテーターが払うので SOL はほぼ不要。
  - Base：新規の鍵を Secrets `PROBE_EVM_PRIVATE_KEY` に。USDC を少額入れる（EIP-3009 なので ETH は不要）。
- Secrets：`SOLANA_RPC_URL`、`BASE_RPC_URL`（公開 RPC は `getSignaturesForAddress` / `eth_getLogs` の制限が厳しいので専用 RPC 推奨）
- Variables：`JIN_PAID_URL`（既定 `https://jin.x402jp.com/api/jin/series`）、`OSD_PAID_URL`（既定 `https://osd.x402jp.com/api/alpha/portfolio/current`）、`RFQ_INDEXER_URL`（公開されている RFQ indexer。未設定なら RFQ 参考値は出さない）
- 自社ホストの許可リストは `src/self-check.ts` の `SELF_HOSTS`（`jin.x402jp.com`、`osd.x402jp.com`）。それ以外のホストに再送・キャッシュ試験は当たらない（テストあり）。

### デプロイ（Vercel + XServer DNS）

1. Vercel で本リポジトリを Import（Framework Preset: Other。`vercel.json` の `buildCommand: npm run build`、`outputDirectory: public` が使われる）。
2. 必要なら Vercel の Environment Variables に `RFQ_INDEXER_URL`。
3. Vercel の Domains に `probe.x402jp.com` を追加。
4. XServer の DNS レコード設定で `probe` に `CNAME cname.vercel-dns.com.` を追加。
5. 以後、Actions が `log/` をコミットするたびに Vercel が再ビルドし、スコアが更新される。

`/scores` と `/scores/:host` は `vercel.json` の rewrite で `public/data/` の静的 JSON を返す（CORS 許可、5 分キャッシュ）。未測定のホストは 404。

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
