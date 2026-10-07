// The update's install script (lib/updates.js unixScript + macSteps), run for real on a stand-in Kural.app: it waits
// for Kural and everything started from inside the app to exit, swaps the app, and puts the old one back on failure.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawn, spawnSync } = require("child_process");
const Module = require("module");
const load = Module._load;
Module._load = function (req, ...a) { return req === "vscode" ? {} : load.call(this, req, ...a); };
const { unixScript, macSteps } = require("../extension/lib/updates");
let passed = 0, failed = 0;
const check = async (name, fn) => { try { await fn(); passed++; console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const run = (script) => spawnSync("/bin/sh", [script], { encoding: "utf8", timeout: 60000 });
// Started detached, like the real Kural (launchd is its parent): a child of this test would stay a zombie that
// "kill -0" still finds while the test waits.
const bg = (cmd) => Number(spawnSync("/bin/sh", ["-c", `${cmd} >/dev/null 2>&1 & echo $!`], { encoding: "utf8" }).stdout.trim());

(async () => {
  if (process.platform === "win32") { console.log("updates-script: SKIP (sh)"); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-upd-"));
  const app = path.join(tmp, "Applications", "Kural.app"), fresh = path.join(tmp, "new", "Kural.app"), logFile = path.join(tmp, "update.log");
  const mk = (dir, text) => { fs.mkdirSync(path.join(dir, "Contents", "MacOS"), { recursive: true }); fs.writeFileSync(path.join(dir, "Contents", "MacOS", "version"), text); };
  // "open" stand-in: records the app it was asked to start.
  const fakeOpen = path.join(tmp, "open.sh"); fs.writeFileSync(fakeOpen, `#!/bin/sh\necho "$1" > ${JSON.stringify(path.join(tmp, "opened"))}\n`, { mode: 0o755 });
  const ditto = process.platform === "darwin" ? "ditto" : null;

  await check("waits for Kural and a helper running from inside the app, then swaps the app and starts it", async () => {
    if (!ditto) return;
    mk(app, "old"); mk(fresh, "new");
    // A "main process" and a "helper" whose command line is inside the app (like Kural Helper).
    const main = { pid: bg("sleep 1") };
    // (A script, not a copy of /bin/sleep: macOS kills a copied system program.)
    const helperBin = path.join(app, "Contents", "MacOS", "helper"); fs.writeFileSync(helperBin, "#!/bin/sh\nsleep 2\n", { mode: 0o755 });
    bg(JSON.stringify(helperBin));
    const t0 = Date.now();
    const script = path.join(tmp, "a.sh");
    fs.writeFileSync(script, unixScript({ pid: main.pid, inside: `${app}/Contents/`, logFile, steps: macSteps({ app, fresh, version: "9.9.9", open: fakeOpen }) }));
    const r = run(script);
    assert.strictEqual(r.status, 0, `${r.signal || ""} ${r.stderr}`);
    assert.ok(Date.now() - t0 >= 1800, "it waited for the helper too");
    assert.strictEqual(fs.readFileSync(path.join(app, "Contents", "MacOS", "version"), "utf8"), "new");
    assert.ok(!fs.existsSync(`${app}.kural-old`));
    assert.strictEqual(fs.readFileSync(path.join(tmp, "opened"), "utf8").trim(), app);
    const logText = fs.readFileSync(logFile, "utf8");
    assert.match(logText, /waiting for Kural/); assert.match(logText, /installed 9\.9\.9/); assert.match(logText, /started/);
  });
  await check("a failed copy puts the old app back (never half an app) and says so in the log", async () => {
    if (!ditto) return;
    fs.rmSync(app, { recursive: true, force: true }); mk(app, "old"); fs.rmSync(logFile, { force: true });
    const script = path.join(tmp, "b.sh");
    fs.writeFileSync(script, unixScript({ pid: 999999, inside: `${app}/Contents/`, logFile, steps: macSteps({ app, fresh: path.join(tmp, "missing", "Kural.app"), version: "9.9.9", open: fakeOpen }) }));
    run(script);
    assert.strictEqual(fs.readFileSync(path.join(app, "Contents", "MacOS", "version"), "utf8"), "old");
    assert.match(fs.readFileSync(logFile, "utf8"), /failed: couldn't put the new version in place/);
  });
  await check("a helper that doesn't exit is stopped (after the wait)", async () => {
    fs.rmSync(app, { recursive: true, force: true }); mk(app, "old");
    // (Its command line keeps the app's path: a loop, not "exec sleep".)
    const helperBin = path.join(app, "Contents", "MacOS", "stuck"); fs.writeFileSync(helperBin, "#!/bin/sh\nwhile true; do sleep 1; done\n", { mode: 0o755 });
    const stuckPid = bg(JSON.stringify(helperBin));
    const script = path.join(tmp, "c.sh");
    fs.writeFileSync(script, unixScript({ pid: 999999, inside: `${app}/Contents/`, logFile, steps: `log "done"`, waitTicks: 3 }));
    run(script);
    await new Promise((r) => setTimeout(r, 300));
    let alive = true; try { process.kill(stuckPid, 0); } catch { alive = false; }
    assert.ok(!alive, "the stuck helper was stopped");
    assert.match(fs.readFileSync(logFile, "utf8"), /stopping what's still running/);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`updates-script: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})();
