// REL-3: the Ubuntu update is installed by extension/lib/install-deb.sh, run as root, which copies the .deb into a
// root-only folder, checks THAT copy against the signed checksum and that it's Kural's package, then runs dpkg on it.
// The test runs a copy of the script with dpkg and the root check replaced (nothing is installed), on Linux with
// dpkg-deb (Ubuntu, CI); skipped elsewhere.
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const { spawnSync } = require("child_process");
let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

const real = fs.readFileSync(path.join(__dirname, "../extension/lib/install-deb.sh"), "utf8");
check("the real script checks root, the checksum and the package before dpkg, and installs its own copy", () => {
  const at = (s) => { const i = real.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at('[ "$(id -u)" = 0 ]') < at("cp -- ") && at("cp -- ") < at('[ "$got" = "$2" ]'));
  assert.ok(at('[ "$got" = "$2" ]') < at('[ "$pkg" = kural ]') && at('[ "$pkg" = kural ]') < at('/usr/bin/dpkg -i "$d/kural.deb"'));
  assert.match(real, /mktemp -d \/var\/tmp\//);
  const u = fs.readFileSync(path.join(__dirname, "../extension/lib/updates.js"), "utf8");
  assert.match(u, /\["pkexec", \["\/bin\/sh", helper, file, signedSha\]\]/);
});

const has = (p) => spawnSync("sh", ["-c", `command -v ${p}`]).status === 0;
if (process.platform !== "linux" || !has("dpkg-deb") || !has("sha256sum")) {
  console.log("skip  install-deb run (needs Linux with dpkg-deb)");
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kural-instdeb-")), log = path.join(dir, "dpkg.log");
  const stub = path.join(dir, "dpkg"); fs.writeFileSync(stub, `#!/bin/sh\necho "$@" >> '${log}'\nsha256sum "$2" >> '${log}'\n`, { mode: 0o755 });
  const script = path.join(dir, "install-deb.sh");
  fs.writeFileSync(script, real.replace('[ "$(id -u)" = 0 ]', "true").replace("/usr/bin/dpkg -i", `'${stub}' -i`));
  const deb = (name) => {
    const root = path.join(dir, `pkg-${name}`); fs.mkdirSync(path.join(root, "DEBIAN"), { recursive: true });
    fs.writeFileSync(path.join(root, "DEBIAN/control"), `Package: ${name}\nVersion: 1.0\nArchitecture: all\nMaintainer: t <t@t>\nDescription: t\n`);
    const out = path.join(dir, `${name}.deb`); assert.strictEqual(spawnSync("dpkg-deb", ["--build", root, out]).status, 0); return out;
  };
  const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  const run = (...a) => spawnSync("sh", [script, ...a], { encoding: "utf8" });
  const good = deb("kural"), other = deb("other");

  check("Kural's package with its signed checksum: dpkg installs root's copy, not the file it was given", () => {
    const r = run(good, sha(good));
    assert.strictEqual(r.status, 0, r.stderr);
    const l = fs.readFileSync(log, "utf8");
    assert.match(l, /^-i \/var\/tmp\/kural-install\.[^/]+\/kural\.deb$/m);
    assert.ok(l.includes(sha(good)));
    assert.ok(!fs.readdirSync("/var/tmp").some((n) => l.includes(`/var/tmp/${n}/`)), "root's copy is removed afterwards");
  });
  check("a file that doesn't match the signed checksum (swapped after Kural's check) is refused before dpkg", () => {
    fs.rmSync(log, { force: true });
    const r = run(other, sha(good));
    assert.strictEqual(r.status, 5); assert.match(r.stderr, /doesn't match/); assert.ok(!fs.existsSync(log));
  });
  check("another package, even with a matching checksum, is refused", () => {
    const r = run(other, sha(other));
    assert.strictEqual(r.status, 6); assert.ok(!fs.existsSync(log));
  });
  check("a missing or malformed checksum is refused", () => {
    assert.strictEqual(run(good, "abc").status, 4);
    assert.strictEqual(run(good, sha(good).toUpperCase()).status, 4);
    assert.strictEqual(run(good).status, 4);
    assert.ok(!fs.existsSync(log));
  });
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `install-deb: ${failed} FAILED` : "install-deb: ALL PASS");
process.exitCode = failed ? 1 : 0;
