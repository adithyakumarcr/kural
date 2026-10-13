// BUG-7: Get started. A Claude (or Codex / Gemini) that passed its test, then fails a manual re-test, is no longer "set up":
// the page said "All set" beside the error and the chat kept using it.
// Also PERF-T1: the checkpoint cleanup timer must not keep a process alive for 30 s.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");
const { spawnSync } = require("child_process");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-gs-"));
const state = path.join(tmp, "state");
const fake = path.join(__dirname, "fake-claude.js");
fs.chmodSync(fake, 0o755);
process.env.FAKE_CLAUDE_FILE = state;
fs.writeFileSync(state, "ok");
const store = new Map();
const vscode = {
  workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (k, d) => k === "claudePath" ? fake : d, inspect: () => ({}) }), onDidChangeConfiguration: () => ({ dispose() {} }) },
  window: { state: { focused: true }, createTerminal: () => ({}), showInformationMessage: () => {}, showWarningMessage: () => {} },
  env: { appRoot: "/unused", openExternal: () => {} }, commands: { executeCommand: async () => {} },
  Uri: { file: (f) => ({ scheme: "file", fsPath: f }), joinPath: (b, ...p) => ({ fsPath: path.join(b.fsPath || "", ...p) }) },
  EventEmitter: class { constructor() { this.event = () => {}; } fire() {} }, ViewColumn: {}, ProgressLocation: {},
};
const load = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

(async () => {
  await check("a failed re-test takes Claude out of 'ready'; a passing one puts it back", async () => {
    const { GetStarted } = require("../extension/lib/getstarted");
    const context = { globalState: { get: (k) => store.get(k), update: async (k, v) => { store.set(k, v); } }, extensionUri: { fsPath: tmp }, subscriptions: [] };
    const gs = new GetStarted(context);
    gs.cwd = () => tmp;
    gs.post = () => {}; gs.changed = () => {};
    gs.save = async () => {};
    await gs.test();
    assert.strictEqual(gs.s.test.state, "ok");
    assert.strictEqual(gs.claudeReady, true);
    fs.writeFileSync(state, "nocredit");   // requests fail now
    await gs.test();
    assert.strictEqual(gs.s.test.state, "fail");
    assert.strictEqual(gs.claudeReady, false, "not ready after a failed test");
    assert.strictEqual(gs.ready, false);
    fs.writeFileSync(state, "ok");
    await gs.test();
    assert.strictEqual(gs.s.test.state, "ok");
    assert.strictEqual(gs.claudeReady, true, "ready again once a test passes");
  });

  await check("PERF-T1: a ChangeTracker with a folder doesn't keep the process alive for its 30 s cleanup timer", () => {
    const script = `const Module = require("module"); const l = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? { EventEmitter: class { constructor() { this.event = () => {}; } fire() {} }, workspace: {} } : l.call(this, r, ...a); };
const { ChangeTracker } = require(${JSON.stringify(path.join(__dirname, "../extension/lib/chat/changes"))});
new ChangeTracker(${JSON.stringify(path.join(tmp, "cp"))});`;
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 20000 });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(Date.now() - t0 < 10000, `took ${Date.now() - t0} ms (the timer held it ~30 s)`);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `getstarted-retest: ${failed} FAILED` : "getstarted-retest: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
