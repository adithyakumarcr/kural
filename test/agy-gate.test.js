// Kural's approval gate for Google Gemini (lib/ai/agy-gate.js, agy-gate-host.js, AgyAgent.gateDecide) against the
// stand-in test/fake-agy.js, which runs PreToolUse hooks from $HOME/.gemini/config/hooks.json the way
// Google documents them. The chat's own onPermission (a stand-in ChatView) decides, like in Kural.
// A temporary HOME: the real ~/.gemini is never touched. This proves Kural's side only; the real agy is checked by
// scripts/verify-agy-gate.sh.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");
const { spawn } = require("child_process");

if (process.platform === "win32") { console.log("agy-gate: skipped on Windows (the stand-in and launcher here are POSIX scripts)"); process.exit(0); }

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kural-agy-gate-test-")));
const HOME = path.join(tmp, "home");
fs.mkdirSync(HOME);
process.env.HOME = process.env.USERPROFILE = HOME;
process.env.FAKE_AGY_FILE = path.join(tmp, "state");
fs.writeFileSync(process.env.FAKE_AGY_FILE, "ok");
process.env.FAKE_AGY_HOOK_LOG = path.join(tmp, "hooks.log");
const BIN = path.join(__dirname, "fake-agy.js");
fs.chmodSync(BIN, 0o755);
const proj = path.join(tmp, "proj"), outside = path.join(tmp, "elsewhere");
fs.mkdirSync(proj); fs.mkdirSync(outside);
fs.writeFileSync(path.join(proj, "package.json"), "{\"name\":\"original\"}\n");
fs.writeFileSync(path.join(outside, "secret.txt"), "secret\n");
fs.symlinkSync(outside, path.join(proj, "link"));

const vscode = { workspace: { isTrusted: true, workspaceFolders: [{ name: "proj", uri: { scheme: "file", fsPath: proj } }], textDocuments: [],
  getConfiguration: () => ({ get: (_, d) => d }) },
  env: { appRoot: "/unused" }, commands: { executeCommand: () => {} }, Uri: { file: (f) => ({ scheme: "file", fsPath: f }) },
  window: { showWarningMessage: () => {} },
  EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
const originalLoad = Module._load;
Module._load = function (name, ...args) { return name === "vscode" ? vscode : originalLoad.call(this, name, ...args); };
require("../extension/lib/workspace").setWorkDir(path.join(tmp, "work"));
const agy = require("../extension/lib/ai/agy");
const gate = require("../extension/lib/ai/agy-gate-host");
const { ChangeTracker } = require("../extension/lib/chat/changes");
const { ChatView } = require("../extension/lib/chat");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.stack.split("\n").slice(0, 3).join(" ")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (f) => fs.existsSync(f);
async function until(fn, ms = 5000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out waiting"); await sleep(20); } }

// The chat as Kural has it (no panel): the real onPermission and permission policy, cards collected here.
const chat = Object.create(ChatView.prototype);
const cards = [];
Object.assign(chat, { changes: new ChangeTracker(null), here: { key: proj, name: "proj", open: proj }, postTabs: () => {}, save: () => {},
  shown: () => true, devices: null, notify: () => {}, clearNotice: () => {}, context: { globalState: { get: () => ({}) } }, runtime: new Map(),
  post: (m) => { if (m.type === "block" && m.block.k === "perm") cards.push(m.block); } });

// One chat with Gemini: the fake agy, the gate, and onPermission behind it.
function session(mode, env = {}) {
  const tab = { id: `t${Math.random().toString(36).slice(2, 7)}`, title: "Gate", model: "agy:default", mode, messages: [], status: "running", workspace: { key: proj, name: "proj", open: proj } };
  const r = { turn: { snaps: {}, reply: { blocks: [], running: true } }, perms: new Map(), agents: new Map(), tasks: new Map() };
  const results = [];
  let waiter = null;
  const old = {};
  for (const [k, v] of Object.entries(env)) { old[k] = process.env[k]; process.env[k] = v; }
  const a = new agy.AgyAgent({ bin: BIN, cwd: proj, mode, store: path.join(tmp, "store") }, {
    onMessage: (m) => { if (m.type === "result") { results.push(m); if (waiter) { const w = waiter; waiter = null; w(m); } } },
    onPermission: (req) => chat.onPermission(tab, r, req),
    onExit: () => {},
  });
  r.proc = a;
  chat.runtime.set(tab.id, r);
  a.start();
  return {
    tab, r, a, results,
    ask: (text) => new Promise((res) => { waiter = res; a.send(text); }),
    send: (text) => { const p = new Promise((res) => { waiter = res; }); a.send(text); return p; },
    answer: (allow) => { const b = cards[cards.length - 1]; const resolve = r.perms.get(b.pid); r.perms.delete(b.pid); resolve(allow); },
    done: () => { a.kill(); for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } },
  };
}
const call = (name, args) => `tool ${name} ${JSON.stringify(args)}`;
const hookLog = () => { try { return fs.readFileSync(process.env.FAKE_AGY_HOOK_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

// The launcher as agy would run it: the call on stdin. → { code, out }
function runLauncher(input, env) {
  return new Promise((resolve) => {
    const p = spawn(gate.launcherPath(), [], { env: { PATH: process.env.PATH, HOME, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.on("exit", (code) => resolve({ code, out: out.trim() }));
    p.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
  });
}
const sample = { hookEventName: "PreToolUse", conversationId: "c-1", workspacePaths: [proj], toolCall: { name: "run_command", args: { CommandLine: "ls" } }, stepIdx: 1 };

(async () => {
  await check("install: the hook goes where agy reads it (~/.gemini/config); Kural's entry in the old file is taken out", async () => {
    assert.strictEqual(gate.hooksFile(), path.join(os.homedir(), ".gemini", "config", "hooks.json"));
    const old = gate.oldHooksFile();
    fs.mkdirSync(path.dirname(old), { recursive: true });
    fs.writeFileSync(old, JSON.stringify({ mine: { PreToolUse: [] }, [gate.KEY]: { PreToolUse: [] } }));
    assert.ok(gate.ensureInstalled().ok);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(old, "utf8")), { mine: { PreToolUse: [] } });
    fs.rmSync(old); fs.rmSync(gate.hooksFile());
  });

  await check("install: Kural's hook entry is added, your own hooks stay, the old file is kept, a second run changes nothing", async () => {
    const file = gate.hooksFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lint = path.join(tmp, "lint-hook");   // (your own hook: says nothing, so agy goes on)
    fs.writeFileSync(lint, "#!/bin/sh\ncat >/dev/null\nexit 0\n", { mode: 0o755 });
    const mine = { "my-linter": { PreToolUse: [{ matcher: "write_to_file", hooks: [{ type: "command", command: lint, timeout: 10 }] }] } };
    fs.writeFileSync(file, JSON.stringify(mine));
    const r = gate.ensureInstalled();
    assert.ok(r.ok && r.changed, JSON.stringify(r));
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepStrictEqual(cfg["my-linter"], mine["my-linter"]);
    assert.deepStrictEqual(cfg[gate.KEY], { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: gate.launcherPath(), timeout: gate.HOOK_TIMEOUT_S }] }] });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(`${file}.kural-backup`, "utf8")), mine);
    assert.strictEqual(fs.statSync(gate.launcherPath()).mode & 0o777, 0o700);
    assert.strictEqual(fs.statSync(gate.gateDir()).mode & 0o777, 0o700);
    assert.strictEqual(gate.ensureInstalled().changed, false);
    assert.ok(gate.installed());
  });

  await check("your own agy (no KURAL_AGY_GATE, no Kural conversation): the gate says nothing and exits 0", async () => {
    const r = await runLauncher(sample, {});
    assert.deepStrictEqual(r, { code: 0, out: "" });
    // Another Kural conversation is registered: still nothing for a conversation that isn't Kural's.
    fs.writeFileSync(path.join(gate.registryDir(), "0".repeat(64) + ".json"), JSON.stringify({ socket: "/nonexistent", token: "x" }), { mode: 0o600 });
    const r2 = await runLauncher(sample, {});
    assert.deepStrictEqual(r2, { code: 0, out: "" });
    fs.unlinkSync(path.join(gate.registryDir(), "0".repeat(64) + ".json"));
  });

  await check("fail closed: Kural unreachable, a bad token, a malformed call, bad settings, no answer in time → deny (exit 0)", async () => {
    const denied = (r) => { assert.strictEqual(r.code, 0); const j = JSON.parse(r.out); assert.strictEqual(j.decision, "deny"); assert.strictEqual(j.allow_tool, false); assert.ok(j.deny_reason); };
    denied(await runLauncher(sample, { KURAL_AGY_GATE: JSON.stringify({ socket: path.join(tmp, "missing.sock"), token: "a".repeat(64) }) }));
    denied(await runLauncher(sample, { KURAL_AGY_GATE: "not json" }));
    const host = new gate.GateHost();
    let pending = null;
    const g = host.open({ decide: () => new Promise((res) => { pending = res; }), install: () => ({ ok: true }) });
    const t = JSON.parse(g.env);
    denied(await runLauncher(sample, { KURAL_AGY_GATE: JSON.stringify({ ...t, token: "b".repeat(64) }) }));      // bad token
    denied(await runLauncher("{not json", { KURAL_AGY_GATE: g.env }));                                          // malformed call
    denied(await runLauncher({ hookEventName: "PreToolUse", toolCall: {} }, { KURAL_AGY_GATE: g.env }));         // no tool name
    denied(await runLauncher(sample, { KURAL_AGY_GATE: g.env, KURAL_AGY_GATE_TIMEOUT_MS: "300" }));             // no answer in time
    // The session ends (Stop, restart, mode change) while a call waits: deny, and a later "yes" doesn't count.
    const p = runLauncher(sample, { KURAL_AGY_GATE: g.env });
    await until(() => pending);
    pending = null;
    await sleep(100);
    const waiting = pending;
    g.close();
    denied(await p);
    if (waiting) waiting({ allow: true });
    denied(await runLauncher(sample, { KURAL_AGY_GATE: g.env }));                                               // stale token
    host.stop();
    // A wrong-format answer from "Kural" is a no.
    const net = require("net");
    const sock = path.join(require("../extension/lib/paths").privateTmp("t"), "x.sock");
    const srv = net.createServer((c) => c.end("{\"decision\":\"yes\"}\n")).listen(sock);
    await new Promise((r) => srv.on("listening", r));
    denied(await runLauncher(sample, { KURAL_AGY_GATE: JSON.stringify({ socket: sock, token: "c".repeat(64) }) }));
    srv.close();
  });

  await check("an allowed answer comes back in both documented shapes", async () => {
    const host = new gate.GateHost();
    const g = host.open({ decide: async (c) => ({ allow: c.tool === "run_command" && c.args.CommandLine === "ls" }), install: () => ({ ok: true }) });
    const r = await runLauncher(sample, { KURAL_AGY_GATE: g.env });
    assert.deepStrictEqual(JSON.parse(r.out), { decision: "allow", allow_tool: true });
    g.close(); host.stop();
  });

  await check("Agent: a write in the project is approved by the gate, and its checkpoint is taken BEFORE the file changes", async () => {
    const f = path.join(proj, "notes.md");
    fs.writeFileSync(f, "before\n");
    const seen = [];
    const snap = chat.changes.snapshot.bind(chat.changes);
    chat.changes.snapshot = (turn, file) => { seen.push([file, fs.readFileSync(file, "utf8")]); return snap(turn, file); };
    const s = session("agent");
    const res = await s.ask(call("write_to_file", { TargetFile: f }));
    chat.changes.snapshot = snap;
    assert.match(res.result, /write_to_file done/);
    assert.deepStrictEqual(seen, [[f, "before\n"]]);
    assert.strictEqual(fs.readFileSync(f, "utf8"), "ok");
    assert.ok(s.r.turn.snaps[f]);
    assert.ok(hookLog().some((h) => h.tool === "write_to_file" && /"allow"/.test(h.out)));
    s.done();
  });

  await check("a pending approval: the file doesn't change until you allow it; the checkpoint comes first", async () => {
    const f = path.join(proj, "package.json");   // (a file that runs code later: asks in Agent)
    const s = session("agent");
    const n = cards.length;
    const p = s.send(call("write_to_file", { TargetFile: f }));
    await until(() => cards.length > n);
    await sleep(300);
    assert.strictEqual(fs.readFileSync(f, "utf8"), "{\"name\":\"original\"}\n", "unchanged while the card waits");
    assert.ok(!s.r.turn.snaps[f], "no checkpoint before the decision");
    s.answer(true);
    const res = await p;
    assert.match(res.result, /write_to_file done/);
    assert.strictEqual(fs.readFileSync(f, "utf8"), "ok");
    assert.strictEqual(chat.changes.get(s.r.turn.snaps[f]).content, "{\"name\":\"original\"}\n");
    fs.writeFileSync(f, "{\"name\":\"original\"}\n");
    s.done();
  });

  await check("a denied write leaves the marker absent", async () => {
    const f = path.join(proj, "Makefile");
    const s = session("agent");
    const n = cards.length;
    const p = s.send(call("write_to_file", { TargetFile: f }));
    await until(() => cards.length > n);
    s.answer(false);
    const res = await p;
    assert.match(res.result, /not allowed/);
    assert.ok(!exists(f));
    s.done();
  });

  await check("Ask and Plan: writes and commands are refused by Kural without a card (even if agy's own mode would let them)", async () => {
    for (const mode of ["ask", "plan"]) {
      const s = session(mode, { FAKE_AGY_PERMISSIVE: "1" });
      const n = cards.length;
      const m1 = path.join(proj, `ro-${mode}.txt`);
      assert.match((await s.ask(call("write_to_file", { TargetFile: m1 }))).result, /not allowed/);
      assert.match((await s.ask(call("run_command", { CommandLine: `touch ro-${mode}-cmd`, Cwd: proj }))).result, /not allowed/);
      assert.match((await s.ask(call("teleport", { Where: "moon" }))).result, /not allowed/);   // an unknown tool too
      assert.ok(!exists(m1) && !exists(path.join(proj, `ro-${mode}-cmd`)));
      assert.strictEqual(cards.length, n, "no card");
      s.done();
    }
  });

  await check("Auto: an ordinary command runs; a dangerous one still asks, and denied it doesn't run", async () => {
    const s = session("auto");
    assert.match((await s.ask(call("run_command", { CommandLine: "touch auto-ok", Cwd: proj }))).result, /run_command done/);
    assert.ok(exists(path.join(proj, "auto-ok")));
    const n = cards.length;
    const p = s.send(call("run_command", { CommandLine: "sudo touch auto-danger", Cwd: proj }));
    await until(() => cards.length > n);
    assert.ok(cards[cards.length - 1].risky);
    assert.ok(!exists(path.join(proj, "auto-danger")));
    s.answer(false);
    await p;
    assert.ok(!exists(path.join(proj, "auto-danger")));
    // A command started in a folder outside the project asks too.
    const n2 = cards.length;
    const p2 = s.send(call("run_command", { CommandLine: "touch moved", Cwd: outside }));
    await until(() => cards.length > n2);
    s.answer(false); await p2;
    assert.ok(!exists(path.join(outside, "moved")));
    s.done();
  });

  await check("Agent: reading outside the project asks; through a link inside the project too", async () => {
    const s = session("agent");
    for (const f of [path.join(outside, "secret.txt"), path.join(proj, "link", "secret.txt")]) {
      const n = cards.length;
      const p = s.send(call("view_file", { AbsolutePath: f }));
      await until(() => cards.length > n);
      s.answer(false);
      assert.match((await p).result, /not allowed/);
    }
    // Inside the project: no card.
    const n = cards.length;
    assert.match((await s.ask(call("view_file", { AbsolutePath: path.join(proj, "package.json") }))).result, /view_file done/);
    assert.strictEqual(cards.length, n);
    s.done();
  });

  await check("a write through a link in the project to a folder outside it asks (the real path counts)", async () => {
    const s = session("agent");
    const n = cards.length;
    const p = s.send(call("write_to_file", { TargetFile: path.join(proj, "link", "planted.txt") }));
    await until(() => cards.length > n);
    s.answer(false);
    await p;
    assert.ok(!exists(path.join(outside, "planted.txt")));
    s.done();
  });

  await check("an unknown tool asks even in Auto; agy's hooks file asks even in Auto", async () => {
    const s = session("auto");
    let n = cards.length;
    let p = s.send(call("teleport", { Where: "moon" }));
    await until(() => cards.length > n);
    assert.ok(cards[cards.length - 1].risky);
    s.answer(false);
    assert.match((await p).result, /not allowed/);
    n = cards.length;
    const hooks = gate.hooksFile(), before = fs.readFileSync(hooks, "utf8");
    p = s.send(call("write_to_file", { TargetFile: hooks }));
    await until(() => cards.length > n);
    assert.ok(cards[cards.length - 1].risky);
    s.answer(false);
    await p;
    assert.strictEqual(fs.readFileSync(hooks, "utf8"), before);
    s.done();
  });

  await check("a mode change while a card waits: the gate is revoked, the late \"yes\" (Auto) runs nothing", async () => {
    const f = path.join(proj, "Dockerfile");
    const s = session("agent");
    const n = cards.length;
    const p = s.send(call("write_to_file", { TargetFile: f }));
    await until(() => cards.length > n);
    s.r.turn.reply.blocks.push(cards[cards.length - 1]);
    s.tab.mode = "auto";
    chat.modeChangedMidAnswer(s.tab, "agent");   // (Auto approves the waiting cards; the gate has been revoked first)
    assert.match((await p).result, /not allowed/);
    assert.ok(!exists(f));
    s.done();
  });

  await check("a hook that doesn't get agy's environment still reaches Kural (conversation registry)", async () => {
    const f = path.join(proj, "justfile");
    const s = session("agent", { FAKE_AGY_HOOK_ENV: "strip" });
    const n = cards.length;
    const p = s.send(call("write_to_file", { TargetFile: f }));
    await until(() => cards.length > n);
    s.answer(false);
    await p;
    assert.ok(!exists(f));
    s.done();
    await sleep(100);
    assert.deepStrictEqual(fs.readdirSync(gate.registryDir()).filter((x) => x.endsWith(".json")), [], "its entry is gone after the chat closed");
  });

  await check("agy that doesn't run hooks: Kural notices the unapproved change and stops it", async () => {
    const s = session("agent", { FAKE_AGY_NO_HOOKS: "1" });
    const res = await s.ask(call("write_to_file", { TargetFile: path.join(proj, "unhooked.txt") }));
    assert.strictEqual(res.is_error, true);
    assert.match(res.result, /Kural stopped Gemini/);
    s.done();
  });

  await check("tampering: Kural's entry removed or pointed elsewhere → put back at the next start", async () => {
    const file = gate.hooksFile();
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    cfg[gate.KEY].PreToolUse[0].hooks[0].command = "/bin/true";
    fs.writeFileSync(file, JSON.stringify(cfg));
    fs.writeFileSync(gate.launcherPath(), "#!/bin/sh\nexit 0\n");
    const s = session("agent");
    assert.match((await s.ask("hello")).result, /You said: hello/);
    assert.ok(gate.installed());
    assert.match(fs.readFileSync(gate.launcherPath(), "utf8"), /agy-gate\.js/);
    assert.ok(JSON.parse(fs.readFileSync(file, "utf8"))["my-linter"]);
    s.done();
  });

  await check("an unreadable hooks file is left alone, and Gemini isn't started without the gate", async () => {
    const file = gate.hooksFile();
    const before = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, "{ this is not json");
    const runs = hookLog().length;
    const s = session("agent");
    const res = await s.ask("hello");
    assert.strictEqual(res.is_error, true);
    assert.match(res.result, /approval gate/);
    assert.strictEqual(fs.readFileSync(file, "utf8"), "{ this is not json");
    assert.strictEqual(hookLog().length, runs);
    s.done();
    fs.writeFileSync(file, before);
  });

  await check("tool mapping: agy's tools → Kural's policy words; unknown or pathless → unclassified", () => {
    const g = agy._test.gateCall;
    assert.deepStrictEqual(g("write_to_file", { TargetFile: "a.txt" }, proj), { tool: "Write", input: { file_path: path.join(proj, "a.txt") } });
    assert.deepStrictEqual(g("run_command", { CommandLine: "ls", Cwd: "/x" }, proj), { tool: "Bash", input: { command: "ls", description: "", cwd: "/x" } });
    assert.strictEqual(g("write_to_file", {}, proj).unclassified, true);
    assert.strictEqual(g("view_file", {}, proj).unclassified, true);
    assert.strictEqual(g("call_mcp_tool", { ServerName: "atlassian", ToolName: "getJiraIssue" }, proj).tool, "mcp__atlassian__getJiraIssue");
    assert.strictEqual(g("browser_click", {}, proj).tool, "Browser");
    assert.strictEqual(g("invoke_subagent", { Task: "x" }, proj).tool, "Task");
    assert.strictEqual(g("ask_question", {}, proj).safe, true);
    assert.strictEqual(g("something_new", {}, proj).unclassified, true);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `agy-gate: ${fail} FAILED` : "agy-gate: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
