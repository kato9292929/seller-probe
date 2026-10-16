// Creates the Probe-only wallets (never the Autonomous Agent's keys).
//   .keys/probe-solana.json  Solana keypair, solana-keygen JSON array (64 bytes)
//   .keys/probe-base.key     Base private key, 0x hex
// Writes only the public addresses to docs/wallet.md and prints
// "Secret name → value to paste" for GitHub Actions.
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { webcrypto } from "node:crypto";
import bs58 from "bs58";
import { generatePrivateKey } from "viem/accounts";
import { evmSigner } from "../chains/base.js";
import { solanaSigner } from "../chains/solana.js";
import { ROOT } from "../config.js";
import { KEY_FILES, SECRET_NAMES } from "../wallet-env.js";

for (const f of [KEY_FILES.solana(), KEY_FILES.base()]) {
  if (existsSync(f)) {
    console.error(`${relative(ROOT, f)} already exists — refusing to overwrite a wallet. Move it away first if you really want a new one.`);
    process.exit(1);
  }
}

// Solana: Ed25519 keypair → 32-byte seed + 32-byte public key (solana-keygen layout).
const kp = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as unknown as CryptoKeyPair;
const seed = new Uint8Array(await webcrypto.subtle.exportKey("pkcs8", kp.privateKey)).slice(-32);
const pub = new Uint8Array(await webcrypto.subtle.exportKey("raw", kp.publicKey));
const solSecret = new Uint8Array([...seed, ...pub]);
const solBase58 = bs58.encode(solSecret);
const evmKey = generatePrivateKey();

// Round-trip through the same loaders the probe uses, so the printed values are known to work.
const solAddress = (await solanaSigner(solBase58)).address;
if (solAddress !== bs58.encode(pub)) throw new Error("Solana key round-trip mismatch");
const baseAddress = evmSigner(evmKey).address;

mkdirSync(dirname(KEY_FILES.solana()), { recursive: true, mode: 0o700 });
writeFileSync(KEY_FILES.solana(), JSON.stringify([...solSecret]) + "\n", { mode: 0o600 });
writeFileSync(KEY_FILES.base(), evmKey + "\n", { mode: 0o600 });
chmodSync(KEY_FILES.solana(), 0o600);
chmodSync(KEY_FILES.base(), 0o600);

const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  resolve(ROOT, "docs/wallet.md"),
  `# Probe 専用ウォレット（公開アドレス）

\`npm run wallet:new\` が ${today} に生成。秘密鍵は \`.keys/\`（.gitignore 済み）にだけあり、このファイルには書かない。
Autonomous Agent の鍵・ウォレットとは別物。

| チェーン | 公開アドレス | 秘密鍵の置き場所 | GitHub Secret 名 |
|---|---|---|---|
| Solana | \`${solAddress}\` | \`.keys/probe-solana.json\` | \`${SECRET_NAMES.solana}\` |
| Base | \`${baseAddress}\` | \`.keys/probe-base.key\` | \`${SECRET_NAMES.base}\` |

## 入金の目安（7日 $5 の上限に合わせる）

| チェーン | USDC | ガス代 |
|---|---|---|
| Solana | $5 | SOL 少額（例 0.01 SOL。通常はファシリテーターが手数料を払うが、USDC の受け取り口座作成などの予備） |
| Base | $5 | ETH 少額（例 0.0005 ETH。EIP-3009 なので通常は不要、予備） |

- Solana USDC: \`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\`
- Base USDC: \`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\`
`,
);

console.log(`Probe wallets created (keys in .keys/, mode 600; public addresses in docs/wallet.md)

  Solana address: ${solAddress}
  Base address:   ${baseAddress}

GitHub → Settings → Secrets and variables → Actions → New repository secret
Secret 名                   → 貼り付ける値
${SECRET_NAMES.solana.padEnd(27)} → ${solBase58}
${SECRET_NAMES.base.padEnd(27)} → ${evmKey}

この 2 つの値は秘密鍵です。Secrets に貼ったら画面のログを残さないでください。
Fund: Solana USDC $5 + a little SOL, Base USDC $5 + a little ETH. Then commit docs/wallet.md.`);
