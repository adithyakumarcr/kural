// Checks that a release's checksum list (SHA256SUMS) was signed with one of Kural's release keys. No vscode in here,
// so it can be tested. The list says which SHA-256 each release file must have; the signature says the list is ours.

const crypto = require("crypto");

// "<hex>  <name>" or "<hex> *<name>" lines (sha256sum's output) → Map(name → hex).
function parseSums(text) {
  const out = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line);
    if (!m) throw new Error(`the checksum list has a line that isn't a checksum: ${line.slice(0, 80)}`);
    out.set(m[2], m[1].toLowerCase());
  }
  return out;
}

// Does one of the keys verify the signature (one line of base64) over these bytes?
function verifySignature(sumsBytes, sigBase64, publicKeyPems) {
  const sig = Buffer.from(String(sigBase64).trim(), "base64");
  const data = Buffer.isBuffer(sumsBytes) ? sumsBytes : Buffer.from(sumsBytes);
  for (let i = 0; i < publicKeyPems.length; i++) {
    try {
      if (crypto.verify(null, data, crypto.createPublicKey(publicKeyPems[i]), sig)) return { ok: true, keyIndex: i };
    } catch { /* a malformed key or signature just doesn't verify */ }
  }
  return { ok: false };
}

// The SHA-256 the signed list gives for `assetName`, or an Error whose message is fit to show to people.
function expectedSha(sumsText, sigBase64, assetName, publicKeyPems) {
  const v = verifySignature(Buffer.from(sumsText), sigBase64, publicKeyPems);
  if (!v.ok) throw new Error("the release's checksum list isn't signed by Kural's key");
  const sha = parseSums(sumsText).get(assetName);
  if (!sha) throw new Error(`the release's checksum list doesn't mention ${assetName}`);
  return sha;
}

// The two files that must sit beside a release's download. Missing → the updater refuses to install.
function pickManifest(assets) {
  const by = (n) => (assets || []).find((a) => a.name === n);
  const sums = by("SHA256SUMS"), sig = by("SHA256SUMS.sig");
  return sums && sig ? { sums, sig } : null;
}

module.exports = { parseSums, verifySignature, expectedSha, pickManifest };
