// Comparing Kural's version numbers (1.2.0 > 1.2.0-rc.1 > 1.2.0-beta.2 > 1.2.0-alpha.3). No vscode inside: used by
// the updater (lib/updates.js) and What's new (lib/whats-new).

// "1.2.0-beta.2" → { nums: [1,2,0], pre: ["beta", 2] }
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v || "").trim());
  if (!m) return null;
  return { nums: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split(".").map((x) => /^\d+$/.test(x) ? +x : x) : [] };
}

// <0 if a is older than b, 0 if the same, >0 if newer. A final version is newer than its alpha/beta/rc.
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (!x.pre.length || !y.pre.length) return (x.pre.length ? -1 : 0) - (y.pre.length ? -1 : 0);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p - q;
    if (typeof p === "number") return -1;               // numbers sort before words
    if (typeof q === "number") return 1;
    return p < q ? -1 : 1;                               // alpha < beta < rc
  }
  return 0;
}

module.exports = { parseVersion, compareVersions };
