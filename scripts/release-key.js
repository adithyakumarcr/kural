#!/usr/bin/env node
// Release signing (see docs/release-signing.md). Ed25519 from Node's own crypto: nothing to install.
//   node scripts/release-key.js generate               a new key pair (private: GitHub secret; public: release-keys.js)
//   node scripts/release-key.js sign <file>            writes <file>.sig (needs env KURAL_RELEASE_PRIVATE_KEY)
//   node scripts/release-key.js verify <file> <sig>    checks it with the keys in extension/lib/release-keys.js

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const [cmd, a, b] = process.argv.slice(2);

if (cmd === "generate") {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  console.log("Store this as the GitHub Actions secret `KURAL_RELEASE_PRIVATE_KEY`. Never commit it.\n");
  console.log(privateKey.export({ type: "pkcs8", format: "pem" }));
  console.log("Put this in `extension/lib/release-keys.js`.\n");
  console.log(publicKey.export({ type: "spki", format: "pem" }));
} else if (cmd === "sign" && a) {
  const pem = process.env.KURAL_RELEASE_PRIVATE_KEY;
  if (!pem || !pem.trim()) { console.error("KURAL_RELEASE_PRIVATE_KEY is not set: add it as a GitHub Actions secret (node scripts/release-key.js generate)."); process.exit(1); }
  const sig = crypto.sign(null, fs.readFileSync(a), crypto.createPrivateKey(pem));
  fs.writeFileSync(`${a}.sig`, sig.toString("base64") + "\n");
  console.log(`signed ${a} -> ${a}.sig`);
} else if (cmd === "verify" && a && b) {
  const { RELEASE_PUBLIC_KEYS } = require(path.join(__dirname, "..", "extension", "lib", "release-keys.js"));
  const { verifySignature } = require(path.join(__dirname, "..", "extension", "lib", "release-verify.js"));
  const r = verifySignature(fs.readFileSync(a), fs.readFileSync(b, "utf8"), RELEASE_PUBLIC_KEYS);
  console.log(r.ok ? `OK (key #${r.keyIndex})` : "FAILED");
  process.exit(r.ok ? 0 : 1);
} else {
  console.error("usage: release-key.js generate | sign <file> | verify <file> <file>.sig");
  process.exit(2);
}
