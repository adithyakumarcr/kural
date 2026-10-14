// "Kural: Remove Kural's Data…" (extension/lib/remove-data/core.js): Gemini's gate comes out of Antigravity's hooks (your
// own entries stay), the connectors whose key Kural keeps are found, and only plainly-Kural folders inside your home are
// ever deleted, after Kural has quit (the updater's afterQuit script). Everything here happens in temp folders.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawn, spawnSync } = require("child_process");
const core = require("../extension/lib/remove-data/core");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kural-remove-test-")));
const home = path.join(tmp, "home");
fs.mkdirSync(home);

(async () => {
  await check("Gemini's gate: Kural's entry, its backup and launcher go; your own hooks stay", () => {
    const cfg = path.join(home, ".gemini", "config"), old = path.join(home, ".gemini", "antigravity-cli");
    fs.mkdirSync(cfg, { recursive: true }); fs.mkdirSync(old, { recursive: true });
    const mine = { PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "my-linter" }] }] };
    fs.writeFileSync(path.join(cfg, "hooks.json"), JSON.stringify({ "my-hook": mine, "kural-gate": { PreToolUse: [] } }));
    fs.writeFileSync(path.join(cfg, "hooks.json.kural-backup"), JSON.stringify({ "my-hook": mine }));
    fs.writeFileSync(path.join(old, "hooks.json"), JSON.stringify({ "kural-gate": {} }));
    fs.mkdirSync(path.join(home, ".kural", "agy-gate", "conversations"), { recursive: true });
    assert.strictEqual(core.gateInstalled(home), true);
    const done = core.removeGate(home);
    assert.strictEqual(done.filter((d) => !d.error).length, 3, JSON.stringify(done));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(cfg, "hooks.json"), "utf8")), { "my-hook": mine });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(old, "hooks.json"), "utf8")), {});
    assert.ok(!fs.existsSync(path.join(cfg, "hooks.json.kural-backup")));
    assert.ok(!fs.existsSync(path.join(home, ".kural", "agy-gate")));
    assert.strictEqual(core.gateInstalled(home), false);
    assert.deepStrictEqual(core.removeGate(home), [], "nothing left: nothing done");
  });

  await check("a hooks file that isn't JSON is left alone, and says so", () => {
    const f = path.join(home, ".gemini", "config", "hooks.json");
    fs.writeFileSync(f, '{ "kural-gate": oops');
    const done = core.removeGate(home);
    assert.ok(done[0].error && /by hand/.test(done[0].error));
    assert.strictEqual(fs.readFileSync(f, "utf8"), '{ "kural-gate": oops');
  });

  await check("connectors whose key Kural keeps: one per AI and name", () => {
    const keys = path.join(tmp, "connector-keys");
    fs.mkdirSync(keys);
    for (const f of ["claude-github.headers.json", "claude-github.env", "codex-linear.env", "notes.txt", "gemini-x.env"]) fs.writeFileSync(path.join(keys, f), "x");
    assert.deepStrictEqual(core.keyedConnectors(keys).sort((a, b) => a.name.localeCompare(b.name)), [{ ai: "claude", name: "github" }, { ai: "codex", name: "linear" }]);
    assert.deepStrictEqual(core.keyedConnectors(path.join(tmp, "none")), []);
  });

  await check("only plainly Kural's folders, all inside your home", () => {
    const ud = path.join(home, ".config", "Kural");
    assert.deepStrictEqual(core.wipeTargets({ userDataDir: ud, home, platform: "linux" }), [ud, path.join(home, ".kural"), path.join(home, ".kural-shared")]);
    // A folder given with --user-data-dir isn't called Kural: not deleted.
    assert.ok(!core.wipeTargets({ userDataDir: path.join(home, "my-data"), home, platform: "linux" }).includes(path.join(home, "my-data")));
    // Outside your home: never.
    assert.ok(!core.wipeTargets({ userDataDir: path.join(tmp, "Kural"), home, platform: "linux" }).includes(path.join(tmp, "Kural")));
    const mac = core.wipeTargets({ userDataDir: path.join(home, "Library", "Application Support", "Kural"), home, platform: "darwin" });
    assert.ok(mac.includes(path.join(home, "Library", "Caches", "com.kural")) && mac.includes(path.join(home, "Library", "Preferences", "com.kural.plist")));
    for (const t of mac) assert.ok(core.insideHome(t, home) && t !== home, t);
    assert.strictEqual(core.insideHome(home, home), false);
    assert.strictEqual(core.insideHome(path.join(home, ".."), home), false);
  });

  if (process.platform === "win32") { console.log("skip the after-quit script (Windows: PowerShell)"); }
  else await check("after Kural quits, the script deletes the targets (names with spaces and quotes too)", async () => {
    const ud = path.join(home, "Kural Data's", "Kural");
    const targets = [ud, path.join(home, ".kural")];
    for (const t of targets) { fs.mkdirSync(path.join(t, "sub"), { recursive: true }); fs.writeFileSync(path.join(t, "sub", "chat.json"), "{}"); }
    const keep = path.join(home, "Kural Data's", "keep.txt");
    fs.writeFileSync(keep, "mine");
    // A stand-in for Kural's main process; the script waits for it.
    const kural = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
    const dir = fs.mkdtempSync(path.join(tmp, "script-"));
    const logFile = path.join(tmp, "removed.log");
    const { afterQuit } = loadUpdates();
    afterQuit({ pid: kural.pid, inside: `${tmp}/no-such-app-${process.pid}/`, logFile, dir, steps: core.wipeSteps(targets, process.platform === "darwin" ? "linux" : process.platform) });
    await new Promise((r) => setTimeout(r, 700));
    assert.ok(fs.existsSync(ud), "nothing is deleted while Kural runs");
    kural.kill();
    for (let i = 0; i < 50 && targets.some((t) => fs.existsSync(t)); i++) await new Promise((r) => setTimeout(r, 200));
    for (const t of targets) assert.ok(!fs.existsSync(t), `${t} deleted`);
    assert.strictEqual(fs.readFileSync(keep, "utf8"), "mine", "a file beside them stays");
    const text = fs.readFileSync(logFile, "utf8");
    assert.match(text, /deleted .*Kural Data's\/Kural/); assert.match(text, /done/);
  });

  // The PowerShell steps: each target removed by its literal path, then logged.
  await check("Windows steps quote paths for PowerShell", () => {
    const steps = core.wipeSteps(["C:\\Users\\Zoë\\AppData\\Roaming\\Kural", "C:\\Users\\O'Neil\\.kural"], "win32");
    assert.match(steps, /Remove-Item -LiteralPath 'C:\\Users\\Zoë\\AppData\\Roaming\\Kural' -Recurse -Force/);
    assert.match(steps, /'C:\\Users\\O''Neil\\\.kural'/);
    assert.match(steps, /Log 'done'$/);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `remove-data: ${failed} FAILED` : "remove-data: ALL PASS");
  process.exitCode = failed ? 1 : 0;
})();

// lib/updates.js needs vscode only for the Updater class: a stand-in is enough for afterQuit.
function loadUpdates() {
  const Module = require("module"), load = Module._load;
  Module._load = function (r, ...a) { return r === "vscode" ? {} : load.call(this, r, ...a); };
  try { return require("../extension/lib/updates"); } finally { Module._load = load; }
}
