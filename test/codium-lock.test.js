// codium.lock and the three build scripts must name the same VSCodium version, and the lock must list all three files.
const assert = require("assert");
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const lock = fs.readFileSync(path.join(root, "codium.lock"), "utf8");
const ver = /^# VSCodium (\S+)\./m.exec(lock)[1];
for (const f of ["make-deb.sh", "build-mac.sh", "build-win.sh"]) {
  const m = /CODIUM_VER="\$\{CODIUM_VER:-([0-9.]+)\}"/.exec(fs.readFileSync(path.join(root, f), "utf8"));
  assert(m, `${f} has no CODIUM_VER`);
  assert.strictEqual(m[1], ver, `${f} uses VSCodium ${m[1]} but codium.lock is for ${ver}: run scripts/update-codium.sh`);
}
for (const name of [`codium_${ver}_amd64.deb`, `VSCodium-darwin-arm64-${ver}.zip`, `VSCodium-win32-x64-${ver}.zip`])
  assert(new RegExp(`^${name.replace(/\./g, "\\.")}  [0-9a-f]{64}$`, "m").test(lock), `codium.lock has no checksum for ${name}`);
console.log("codium-lock ok");
