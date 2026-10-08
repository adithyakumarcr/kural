const assert = require("assert");
const crypto = require("crypto");
const { parseSums, verifySignature, expectedSha, pickManifest } = require("../extension/lib/release-verify");
const { RELEASE_PUBLIC_KEYS } = require("../extension/lib/release-keys");

// The real key must be pasted in (node scripts/release-key.js generate), or releases can't be verified.
assert(RELEASE_PUBLIC_KEYS.length && RELEASE_PUBLIC_KEYS.every((k) => !/\.\.\./.test(k)), "release-keys.js has no public key yet: run `node scripts/release-key.js generate`");
for (const k of RELEASE_PUBLIC_KEYS) assert.doesNotThrow(() => crypto.createPublicKey(k), "release-keys.js holds a key that can't be read");

const pair = () => crypto.generateKeyPairSync("ed25519");
const pub = (k) => k.publicKey.export({ type: "spki", format: "pem" });
const sign = (data, k) => crypto.sign(null, Buffer.from(data), k.privateKey).toString("base64");

const hex = (c) => c.repeat(64);
const sums = `${hex("a")}  Kural-1.0.0-macos-arm64.zip\n${hex("b")} *kural_1.0.0_amd64.deb\n\n`;
const k1 = pair(), k2 = pair();
const sig = sign(sums, k1);

assert.deepStrictEqual(verifySignature(Buffer.from(sums), sig, [pub(k1)]), { ok: true, keyIndex: 0 });
assert.strictEqual(verifySignature(Buffer.from(sums), sig, [pub(k2)]).ok, false);
assert.strictEqual(verifySignature(Buffer.from(sums), sig, [pub(k2), pub(k1)]).keyIndex, 1);

// one changed byte in the signature or in the list
const bad = Buffer.from(sig, "base64"); bad[0] ^= 1;
assert.strictEqual(verifySignature(Buffer.from(sums), bad.toString("base64"), [pub(k1)]).ok, false);
const other = Buffer.from(sums); other[0] ^= 1;
assert.strictEqual(verifySignature(other, sig, [pub(k1)]).ok, false);
assert.strictEqual(verifySignature(Buffer.from(sums), "not base64 !!", [pub(k1)]).ok, false);

assert.strictEqual(expectedSha(sums, sig, "kural_1.0.0_amd64.deb", [pub(k1)]), hex("b"));
assert.throws(() => expectedSha(sums, sig, "kural_1.0.0_amd64.deb", [pub(k2)]), { message: "the release's checksum list isn't signed by Kural's key" });
assert.throws(() => expectedSha(sums, sig, "nope.zip", [pub(k1)]), { message: "the release's checksum list doesn't mention nope.zip" });

const m = parseSums(sums);
assert.strictEqual(m.get("Kural-1.0.0-macos-arm64.zip"), hex("a"));
assert.strictEqual(m.get("kural_1.0.0_amd64.deb"), hex("b"));
assert.throws(() => parseSums("garbage"));

assert.strictEqual(pickManifest([{ name: "SHA256SUMS" }]), null);
assert.strictEqual(pickManifest([]), null);
assert(pickManifest([{ name: "SHA256SUMS" }, { name: "SHA256SUMS.sig" }]));
console.log("release-verify ok");
