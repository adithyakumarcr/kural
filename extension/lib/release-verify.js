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
    if (out.has(m[2])) throw new Error("the checksum list has duplicate filenames");
    if (/[\\/\x00-\x1f\x7f]/.test(m[2]) || m[2] === "." || m[2] === "..") throw new Error("unsafe release filename");
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


// The signed asset name binds its hash to a version. Unsigned release tags cannot relabel old binaries as new.
function validateAssetVersion(assetName, version, currentVersion) {
  const { parseVersion, compareVersions } = require("./version-compare");
  if (!parseVersion(version) || !parseVersion(currentVersion) || compareVersions(version, currentVersion) <= 0)
    throw new Error("invalid version or update would not advance this installation");
  const v = String(version).replace(/^v/, "");
  const safe = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const forms = new RegExp(`^(?:Kural-${safe}-(?:macos-arm64\\.zip|windows-x64-setup\\.exe)|kural_${safe}(?:\\+[0-9A-Za-z.-]+)?_amd64\\.deb)$`);
  if (!forms.test(String(assetName))) throw new Error("the signed asset filename does not match the requested release version");
}

// Right before a verified download is handed to an installer with administrator rights (Ubuntu: pkexec dpkg -i): copy
// it into a new private folder and hash the copy again. Returns the copy's path; throws if it no longer matches.
// (Narrows, doesn't close, the window in which another program running as you could swap the file: only a privileged
// step that checks the signature itself would close it.)
function verifiedCopy(file, sha) {
  const fs = require("fs"), os = require("os"), path = require("path");
  if (!/^[0-9a-f]{64}$/.test(String(sha || ""))) throw new Error("no signed checksum to check the download against");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kural-install-"));   // 0700: only you
  const copy = path.join(dir, path.basename(file));
  fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(copy, 0o400);
  const h = crypto.createHash("sha256"), buf = Buffer.alloc(1 << 20), fd = fs.openSync(copy, "r");
  try { for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  const got = h.digest("hex");
  if (got !== sha) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error("the download changed after it was checked; not installing it"); }
  return copy;
}

module.exports = { verifiedCopy, validateAssetVersion, parseSums, verifySignature, expectedSha, pickManifest };
