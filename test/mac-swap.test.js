// extension/lib/mac-swap.sh: putting a new Kural.app in place of the old one. Run for real on stand-in app folders
// (on Linux, where there is no codesign: that check is skipped with a warning, and `ditto` is a `cp -a` shim).
// The rule under test: the old app is only ever renamed, and it stays exactly as it was unless the new one is whole.
// Also the same text as updates.js pastes into the update script (macSteps).
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const Module = require("module");
const load = Module._load;
Module._load = function (req, ...a) { return req === "vscode" ? {} : load.call(this, req, ...a); };
const { unixScript, macSteps, _test } = require("../extension/lib/updates");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

if (process.platform === "win32") { console.log("mac-swap: SKIP (sh)"); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-swap-"));
const LIB = _test.MAC_SWAP;
const realMv = spawnSync("/bin/sh", ["-c", "command -v mv"], { encoding: "utf8" }).stdout.trim();
let n = 0;
const fresh = () => { const d = path.join(tmp, `t${++n}`); fs.mkdirSync(path.join(d, "Applications"), { recursive: true }); return d; };

// Shims first on PATH: `ditto` (not on Linux) and a `mv` that fails on request (FAIL_MV_TO / FAIL_MV_FROM: a name ending).
const shims = path.join(tmp, "shims"); fs.mkdirSync(shims);
const hasDitto = spawnSync("/bin/sh", ["-c", "command -v ditto"]).status === 0;
if (!hasDitto) fs.writeFileSync(path.join(shims, "ditto"), '#!/bin/sh\nexec cp -a "$1" "$2"\n', { mode: 0o755 });
fs.writeFileSync(path.join(shims, "mv"), `#!/bin/sh
# (fails like a Mac that protects the app: the last two arguments are what is moved and where)
for a in "$@"; do last2="$last1"; last1="$a"; done
case "$last2" in *"$FAIL_MV_FROM") [ -n "$FAIL_MV_FROM" ] && { echo "mv: simulated failure (from)" >&2; exit 1; } ;; esac
case "$last1" in *"$FAIL_MV_TO") [ -n "$FAIL_MV_TO" ] && { echo "mv: simulated failure (to)" >&2; exit 1; } ;; esac
exec ${realMv} "$@"
`, { mode: 0o755 });

// A stand-in Kural.app with everything the check looks at, and a marker saying which one it is.
function mkApp(dir, marker, { framework = true, helpers = ["", " (GPU)", " (Renderer)", " (Plugin)"] } = {}) {
  const put = (rel, text = "x") => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text, { mode: 0o755 }); };
  put("Contents/MacOS/Kural"); put("Contents/marker", marker);
  if (framework) {
    put("Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework");
    fs.symlinkSync("A", path.join(dir, "Contents/Frameworks/Electron Framework.framework/Versions/Current"));
    fs.symlinkSync("Versions/Current/Electron Framework", path.join(dir, "Contents/Frameworks/Electron Framework.framework/Electron Framework"));
  }
  for (const h of helpers) put(`Contents/Frameworks/Kural Helper${h}.app/Contents/MacOS/Kural Helper${h}`);
  return dir;
}
const marker = (app) => { try { return fs.readFileSync(path.join(app, "Contents/marker"), "utf8"); } catch { return null; } };
const sh = (script, env = {}) => spawnSync("/bin/sh", ["-c", script], { encoding: "utf8", env: { ...process.env, ...env, PATH: `${shims}:${process.env.PATH}` }, timeout: 60000 });
const swap = (newApp, app, env) => sh(`. '${LIB}'\nkural_swap '${newApp}' '${app}'`, env);
const names = (d) => fs.readdirSync(d).sort();

check("a good new app replaces the old one, and the old copy is gone afterwards", () => {
  const d = fresh(), app = mkApp(path.join(d, "Applications/Kural.app"), "old"), nw = mkApp(path.join(d, "new/Kural.app"), "new");
  const r = swap(nw, app); assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(marker(app), "new");
  assert.deepStrictEqual(names(path.join(d, "Applications")), ["Kural.app"]);
  assert.ok(fs.existsSync(path.join(app, "Contents/Frameworks/Electron Framework.framework/Versions/Current/Electron Framework")));
});

check("a new app without its Electron Framework is refused, and the old app is untouched", () => {
  const d = fresh(), app = mkApp(path.join(d, "Applications/Kural.app"), "old"), nw = mkApp(path.join(d, "new/Kural.app"), "new", { framework: false });
  const r = swap(nw, app); assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout, /Electron Framework/); assert.match(r.stdout, /Nothing was changed/);
  assert.strictEqual(marker(app), "old");
  assert.deepStrictEqual(names(path.join(d, "Applications")), ["Kural.app"], "no half-made copy left beside it");
});

check("a new app missing one of the four helpers is refused", () => {
  const d = fresh(), app = mkApp(path.join(d, "Applications/Kural.app"), "old"), nw = mkApp(path.join(d, "new/Kural.app"), "new", { helpers: ["", " (GPU)", " (Renderer)"] });
  const r = swap(nw, app); assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout, /Kural Helper \(Plugin\)\.app is missing/);
  assert.strictEqual(marker(app), "old");
});

check("a Versions/Current that doesn't resolve is refused", () => {
  const d = fresh(), app = mkApp(path.join(d, "Applications/Kural.app"), "old"), nw = mkApp(path.join(d, "new/Kural.app"), "new");
  const cur = path.join(nw, "Contents/Frameworks/Electron Framework.framework/Versions/Current");
  fs.rmSync(cur); fs.symlinkSync("B", cur);
  const r = swap(nw, app); assert.notStrictEqual(r.status, 0);
  assert.strictEqual(marker(app), "old");
});

check("when the old app can't be moved aside, the new copy is removed and the old app is intact", () => {
  const d = fresh(), app = mkApp(path.join(d, "Applications/Kural.app"), "old"), nw = mkApp(path.join(d, "new/Kural.app"), "new");
  const r = swap(nw, app, { FAIL_MV_TO: ".kural-old" }); assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout, /couldn't move the old version aside/);
  assert.strictEqual(marker(app), "old");
  assert.deepStrictEqual(names(path.join(d, "Applications")), ["Kural.app"]);
});

check("when the new app can't be moved in, the old one is put back", () => {
  const d = fresh(), app = mkApp(path.join(d, "Applications/Kural.app"), "old"), nw = mkApp(path.join(d, "new/Kural.app"), "new");
  const r = swap(nw, app, { FAIL_MV_FROM: ".kural-new" }); assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout, /The old version is back/);
  assert.strictEqual(marker(app), "old");
  assert.deepStrictEqual(names(path.join(d, "Applications")), ["Kural.app"]);
});

check("a leftover .kural-old with the live app missing is restored (even when the new app is bad)", () => {
  const d = fresh(), nw = mkApp(path.join(d, "new/Kural.app"), "new", { framework: false });
  mkApp(path.join(d, "Applications/Kural.app.kural-old"), "old");
  const app = path.join(d, "Applications/Kural.app");
  const r = swap(nw, app); assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout, /restoring/);
  assert.strictEqual(marker(app), "old");
  assert.deepStrictEqual(names(path.join(d, "Applications")), ["Kural.app"]);
});

check("a leftover .kural-old beside a broken live app is restored, then the good new app goes in", () => {
  const d = fresh(), nw = mkApp(path.join(d, "new/Kural.app"), "new");
  mkApp(path.join(d, "Applications/Kural.app.kural-old"), "old");
  const app = mkApp(path.join(d, "Applications/Kural.app"), "broken", { framework: false });
  const r = swap(nw, app); assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(marker(app), "new");
  assert.deepStrictEqual(names(path.join(d, "Applications")), ["Kural.app"]);
});

check("a leftover .kural-old beside a good live app is just removed", () => {
  const d = fresh(), nw = mkApp(path.join(d, "new/Kural.app"), "new"), app = mkApp(path.join(d, "Applications/Kural.app"), "live");
  mkApp(path.join(d, "Applications/Kural.app.kural-old"), "older");
  const r = swap(nw, app); assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(marker(app), "new");
  assert.deepStrictEqual(names(path.join(d, "Applications")), ["Kural.app"]);
});

check("no app installed yet: the new one is simply put in place", () => {
  const d = fresh(), nw = mkApp(path.join(d, "new/Kural.app"), "new"), app = path.join(d, "Applications/Kural.app");
  const r = swap(nw, app); assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(marker(app), "new");
});

check("a parent folder that can't be written to is refused with what to do, nothing changed", () => {
  if (process.getuid && process.getuid() === 0) return;   // (root writes anywhere)
  const d = fresh(), app = mkApp(path.join(d, "Applications/Kural.app"), "old"), nw = mkApp(path.join(d, "new/Kural.app"), "new");
  fs.chmodSync(path.join(d, "Applications"), 0o555);
  try {
    const r = swap(nw, app); assert.notStrictEqual(r.status, 0);
    assert.match(r.stdout, /no permission/); assert.strictEqual(marker(app), "old");
  } finally { fs.chmodSync(path.join(d, "Applications"), 0o755); }
});

check("not enough free space is refused before anything is copied", () => {
  const d = fresh(), app = mkApp(path.join(d, "Applications/Kural.app"), "old"), nw = mkApp(path.join(d, "new/Kural.app"), "new");
  // A `df` that says the disk is full.
  const dfDir = path.join(d, "bin"); fs.mkdirSync(dfDir);
  fs.writeFileSync(path.join(dfDir, "df"), '#!/bin/sh\necho "Filesystem 1024-blocks Used Available Capacity Mounted"\necho "x 100 100 0 100% /"\n', { mode: 0o755 });
  const r = sh(`PATH='${dfDir}':$PATH; . '${LIB}'\nkural_swap '${nw}' '${app}'`);
  assert.notStrictEqual(r.status, 0); assert.match(r.stdout, /not enough free space/);
  assert.strictEqual(marker(app), "old"); assert.deepStrictEqual(names(path.join(d, "Applications")), ["Kural.app"]);
});

check("the folder swap (the extension): good copy goes in; a copy without package.json leaves the old one alone", () => {
  const d = fresh(), put = (rel, t) => { const f = path.join(d, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
  put("ext/kural/package.json", "old"); put("ext/kural/extension.js", "old");
  put("src/package.json", "new"); put("src/extension.js", "new"); put("bad/extension.js", "new");
  const run = (src) => sh(`. '${LIB}'\nkural_swap_dir '${path.join(d, src)}' '${path.join(d, "ext/kural")}' package.json extension.js`);
  let r = run("bad"); assert.notStrictEqual(r.status, 0); assert.match(r.stdout, /package\.json is missing/);
  assert.strictEqual(fs.readFileSync(path.join(d, "ext/kural/package.json"), "utf8"), "old");
  assert.deepStrictEqual(names(path.join(d, "ext")), ["kural"]);
  r = run("src"); assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(fs.readFileSync(path.join(d, "ext/kural/package.json"), "utf8"), "new");
  assert.deepStrictEqual(names(path.join(d, "ext")), ["kural"]);
});

// The text updates.js pastes into the update script: the same checks, logged to the update log.
const viaUpdater = (d, nw, app, env) => {
  const logFile = path.join(d, "update.log"), script = path.join(d, "u.sh");
  fs.writeFileSync(script, unixScript({ pid: 999999, inside: path.join(d, "nothing-runs-here") + "/", logFile, steps: macSteps({ app, fresh: nw, version: "9.9.9", open: "true" }) }));
  const r = sh(`/bin/sh '${script}'`, env);
  return { r, log: fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "" };
};
check("updates.js: the embedded script swaps a good app and logs it", () => {
  const d = fresh(), app = mkApp(path.join(d, "Applications/Kural.app"), "old"), nw = mkApp(path.join(d, "new/Kural.app"), "new");
  const { r, log } = viaUpdater(d, nw, app); assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(marker(app), "new"); assert.match(log, /installed 9\.9\.9/); assert.match(log, /started/);
  assert.deepStrictEqual(names(path.join(d, "Applications")), ["Kural.app"]);
});
check("updates.js: the embedded script keeps the old app when the new one is broken, and says so in the log", () => {
  const d = fresh(), app = mkApp(path.join(d, "Applications/Kural.app"), "old"), nw = mkApp(path.join(d, "new/Kural.app"), "new", { framework: false });
  const { log } = viaUpdater(d, nw, app);
  assert.strictEqual(marker(app), "old"); assert.match(log, /failed: couldn't put the new version in place/); assert.match(log, /Electron Framework/);
  assert.doesNotMatch(log, /installed 9\.9\.9/);
});
check("updates.js: a failing mv leaves the old app intact", () => {
  const d = fresh(), app = mkApp(path.join(d, "Applications/Kural.app"), "old"), nw = mkApp(path.join(d, "new/Kural.app"), "new");
  const { log } = viaUpdater(d, nw, app, { FAIL_MV_TO: ".kural-old" });
  assert.strictEqual(marker(app), "old"); assert.match(log, /failed/);
});
check("updates.js: the script text is the shared file's text", () => {
  assert.ok(macSteps({ app: "/A/Kural.app", fresh: "/N/Kural.app", version: "1" }).includes(fs.readFileSync(LIB, "utf8")));
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `mac-swap: ${failed} failed` : "mac-swap: all passed");
process.exitCode = failed ? 1 : 0;
