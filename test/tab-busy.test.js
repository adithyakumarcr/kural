// Tab Completion keeps working while a chat answers (Adithya: "when my chat is thinking, Tab Completion is not working").
// Measured (docs/benchmarks/memory-2026-10-08.md, "Tab while the chat answers"): Ollama runs every model on one GPU, so
// while a chat answers with a model on this computer, Tab's local answers took 2-2.5 s instead of 0.3 s, and 6.4 s when
// Ollama first had to load the chat's model. And the first chat answer of each window froze the extension host for
// ~0.3 s while Kural asked claude which options it knows (spawnSync).
//   1. LocalEngine.busy(): the chat's hint, and answers much slower than usual (compared with this computer's usual).
//   2. The completion provider: while busy, Claude helps (also for "Local model") when it's set up; without Claude, the
//      wait between keys is longer (fewer requests competing with the chat).
//   3. Claude Code's options are asked once per Claude Code version, in the background, and saved.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");

const config = { "tabCompletion.enabled": true, "tabCompletion.engine": "local", "tabCompletion.debounceMs": 0, "tabCompletion.model": "haiku",
  "tabCompletion.localModel": "qwen2.5-coder:1.5b-base" };
class Range { constructor(a, b, c, d) { this.args = [a, b, c, d]; } }
class InlineCompletionItem { constructor(text, range) { this.insertText = text; this.range = range; } }
const vscode = {
  workspace: { getConfiguration: () => ({ get: (k, d) => (k in config ? config[k] : d) }), asRelativePath: (u) => String(u.path || u) },
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 }, InlineCompletionItem, Range, Position: class {},
  window: { onDidChangeTextEditorSelection: () => ({ dispose() {} }) }, commands: { executeCommand: () => {} },
};
const load = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const claude = require("../extension/lib/ai/claude");
const { LocalEngine } = require("../extension/lib/tab/local");
const { completionProvider, BUSY_HEAD_START, BUSY_WAIT } = require("../extension/lib/tab/completion");

let passed = 0, failed = 0;
const check = async (name, fn) => { try { await fn(); passed++; console.log("ok  ", name); } catch (e) { failed++; console.log("FAIL", name, e.stack); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A tiny document: "let x = " with the cursor at the end.
let version = 0;
function doc(text = "const total = items.length;\nlet x = ") {
  version++;
  return { uri: { scheme: "file", path: `/p/f${version}.js`, toString: () => `file:///p/f${version}.js` }, version, languageId: "javascript",
    getText: (range) => (range ? "" : text), offsetAt: () => text.length,
    lineAt: () => ({ text: text.split("\n").pop(), range: { end: { line: 1, character: text.split("\n").pop().length } } }) };
}
const token = () => ({ isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });
// Stand-ins: Claude's session and the local engine, each answering after a delay; they count their calls.
function engines({ localMs = 20, claudeMs = 20, busy = false } = {}) {
  const calls = { local: 0, claude: 0 }, toks = {};
  const session = { ask: async (_, tok) => { calls.claude++; toks.claude = tok; await sleep(claudeMs); return "<insert>fromClaude</insert>"; } };
  const local = { ready: async () => true, busy: () => busy,
    complete: async (_p, _s, tok) => { calls.local++; toks.local = tok; await sleep(localMs); return "fromLocal"; } };
  return { calls, session, local, toks };
}
async function suggest(e, trigger = vscode.InlineCompletionTriggerKind.Automatic) {
  const provider = completionProvider(e.session, { busy: () => false }, () => {}, e.local, null, null);
  const t0 = Date.now();
  const items = await provider.provideInlineCompletionItems(doc(), {}, { triggerKind: trigger }, token());
  return { text: items[0] && items[0].insertText, ms: Date.now() - t0 };
}

(async () => {
  // ---------- 1. LocalEngine.busy ----------
  await check("busy while a chat in this window answers with a local model (the hint)", () => {
    const l = new LocalEngine();
    assert.strictEqual(l.busy(), false);
    l.chatBusy = () => true; assert.strictEqual(l.busy(), true);
    l.chatBusy = () => { throw new Error("not ready"); }; assert.strictEqual(l.busy(), false);
  });
  await check("busy when an answer is much slower than usual, or none came; usual again = not busy", () => {
    const l = new LocalEngine();
    for (const ms of [250, 300, 280, 320]) l.noteTime(ms);
    assert.strictEqual(l.busy(), false);
    l.noteTime(2400); assert.strictEqual(l.busy(), true);          // the chat's model took the GPU
    l.noteTime(300); assert.strictEqual(l.busy(), false);          // back to usual
    l.noteTime(6000, true); assert.strictEqual(l.busy(), true);    // no answer in time
    assert.ok(!l.times.includes(6000));
  });
  await check("a computer that's always slow isn't 'busy' (compared with its own usual time)", () => {
    const l = new LocalEngine();
    l.noteTime(1500);                                               // first answer: slower than the 300 ms guess
    l.noteTime(1600); l.noteTime(1450);
    assert.strictEqual(l.busy(), false);
    assert.strictEqual(l.typical(), 1500);
  });
  await check("times while the chat is busy don't count as usual", () => {
    const l = new LocalEngine();
    l.chatBusy = () => true; l.noteTime(2500); l.chatBusy = () => false;
    assert.deepStrictEqual(l.times, []);
  });

  // ---------- 2. the completion provider ----------
  claude.setSetupGate(() => true);
  await check("Local model, Ollama not busy: only the local model is asked", async () => {
    const e = engines();
    const r = await suggest(e);
    assert.strictEqual(r.text, "fromLocal"); assert.deepStrictEqual(e.calls, { local: 1, claude: 0 });
  });
  await check("Local model, Ollama busy, Claude set up: Claude helps after a short head start and wins when local is slow", async () => {
    const e = engines({ localMs: 600, claudeMs: 30, busy: true });
    const r = await suggest(e);
    assert.strictEqual(r.text, "fromClaude"); assert.deepStrictEqual(e.calls, { local: 1, claude: 1 });
    assert.ok(r.ms >= BUSY_HEAD_START && r.ms < 450, `${r.ms} ms`);
    assert.strictEqual(e.toks.local.isCancellationRequested, true);   // the local request is stopped: it'd slow the chat
  });
  await check("Local model, Ollama busy: a quick local answer still wins (Claude isn't even asked)", async () => {
    const e = engines({ localMs: 40, claudeMs: 30, busy: true });
    const r = await suggest(e);
    assert.strictEqual(r.text, "fromLocal"); assert.deepStrictEqual(e.calls, { local: 1, claude: 0 });
    assert.strictEqual(e.toks.local.isCancellationRequested, false);
  });
  await check("Auto, Ollama busy: Claude starts sooner than usual (200 ms instead of 350 ms)", async () => {
    config["tabCompletion.engine"] = "auto";
    try {
      const e = engines({ localMs: 800, claudeMs: 20, busy: true });
      const r = await suggest(e);
      assert.strictEqual(r.text, "fromClaude"); assert.ok(r.ms < 340, `${r.ms} ms`);
    } finally { config["tabCompletion.engine"] = "local"; }
  });
  await check("Claude engine: Ollama's state doesn't matter", async () => {
    config["tabCompletion.engine"] = "claude";
    try {
      const e = engines({ busy: true });
      const r = await suggest(e);
      assert.strictEqual(r.text, "fromClaude"); assert.deepStrictEqual(e.calls, { local: 0, claude: 1 });
    } finally { config["tabCompletion.engine"] = "local"; }
  });
  await check("no Claude set up, Ollama busy: only local, after a longer pause while typing (fewer requests fighting the chat)", async () => {
    claude.setSetupGate(() => false);
    try {
      const e = engines({ localMs: 20, busy: true });
      const r = await suggest(e);
      assert.strictEqual(r.text, "fromLocal"); assert.deepStrictEqual(e.calls, { local: 1, claude: 0 });
      assert.ok(r.ms >= BUSY_WAIT, `${r.ms} ms`);
      const quick = await suggest(engines({ localMs: 20, busy: false }));
      assert.ok(quick.ms < BUSY_WAIT, `${quick.ms} ms`);                        // not busy: no extra pause
      const placed = await suggest(engines({ localMs: 20, busy: true }), vscode.InlineCompletionTriggerKind.Invoke);
      assert.ok(placed.ms < BUSY_WAIT, `${placed.ms} ms`);                      // placing the cursor: right away
    } finally { claude.setSetupGate(() => true); }
  });

  // ---------- 3. Claude Code's options ----------
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-flags-"));
  const bin = path.join(tmp, "claude"), calls = path.join(tmp, "calls.txt");
  fs.writeFileSync(bin, `#!${process.execPath}\nconst a = process.argv.slice(2);\nrequire("fs").appendFileSync(${JSON.stringify(calls)}, a.join(" ") + "\\n");\n` +
    `if (a.includes("--forward-subagent-text")) { console.error("error: unknown option '--forward-subagent-text'"); process.exit(1); }\nprocess.exit(0);\n`, { mode: 0o755 });
  const count = () => (fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n").length : 0);
  claude.setFlagsStore(tmp);
  await check("asked in the background (once, even when asked twice at the same time); the one it doesn't know is left out", async () => {
    claude.supportedFlags._reset();
    const [a, b] = await Promise.all([claude.prefetchFlags(bin), claude.prefetchFlags(bin)]);
    assert.strictEqual(a, b);
    assert.deepStrictEqual({ ...a, bin: undefined }, { bin: undefined, thinkingDisplay: true, replayUserMessages: true });
    assert.strictEqual(count(), 2);                                   // all three, then without the unknown one
    assert.ok(fs.existsSync(path.join(tmp, "claude-flags.json")));
  });
  await check("the next window (nothing in memory) reads the saved answer: claude isn't started at all", () => {
    claude.supportedFlags._reset();
    const f = claude.supportedFlags(bin);
    assert.strictEqual(f.thinkingDisplay, true); assert.strictEqual(f.forwardSubagentText, undefined);
    assert.strictEqual(count(), 2);
  });
  await check("Claude Code changed (an update): asked again", async () => {
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(bin, later, later);
    claude.supportedFlags._reset();
    await claude.prefetchFlags(bin);
    assert.strictEqual(count(), 4);
  });
  await check("no answer from claude (couldn't tell): none of the options, and nothing saved", async () => {
    fs.writeFileSync(bin, `#!${process.execPath}\nprocess.kill(process.pid, "SIGKILL");\n`, { mode: 0o755 });
    const before = fs.readFileSync(path.join(tmp, "claude-flags.json"), "utf8");
    claude.supportedFlags._reset();
    const f = await claude.prefetchFlags(bin);
    assert.ok(!f.thinkingDisplay && !f.replayUserMessages);
    assert.strictEqual(fs.readFileSync(path.join(tmp, "claude-flags.json"), "utf8"), before);
  });
  await check("the extension asks in the background at startup (Claude set up)", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "extension", "extension.js"), "utf8");
    assert.ok(/setFlagsStore\(context\.globalStorageUri\.fsPath\)/.test(src) && /if \(getStarted\.claudeReady\) require\("\.\/lib\/ai\/claude"\)\.prefetchFlags\(findClaude\(\)\)/.test(src));
    assert.ok(/local\.chatBusy = \(\) => chat\.tabs\.some\(\(t\) => t\.status === "running" && brain\.isLocal\(t\.model\)\)/.test(src));
  });
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`tab-busy: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
