# Probe 専用ウォレット（公開アドレス）

`npm run wallet:new` が 2026-10-17 に生成。秘密鍵は `.keys/`（.gitignore 済み）にだけあり、このファイルには書かない。
Autonomous Agent の鍵・ウォレットとは別物。

| チェーン | 公開アドレス | 秘密鍵の置き場所 | GitHub Secret 名 |
|---|---|---|---|
| Solana | `xgtJ5j3VfuYG4cxAxsQjTKWsnVdFTLPYK8NxQnpFZW5` | `.keys/probe-solana.json` | `PROBE_SOLANA_SECRET_KEY` |
| Base | `0x9A1066FEec0822996875a28A3D4e058175AF6C92` | `.keys/probe-base.key` | `PROBE_EVM_PRIVATE_KEY` |

## 入金の目安（7日 $5 の上限に合わせる）

| チェーン | USDC | ガス代 |
|---|---|---|
| Solana | $5 | SOL 少額（例 0.01 SOL。通常はファシリテーターが手数料を払うが、USDC の受け取り口座作成などの予備） |
| Base | $5 | ETH 少額（例 0.0005 ETH。EIP-3009 なので通常は不要、予備） |

- Solana USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- Base USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
