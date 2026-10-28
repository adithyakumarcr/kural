// The "/" list in the chat box (extension/lib/chat/slash.js and the chat's use of it): Claude Code's skills and commands,
// cleaned (screen-only ones left out, yours first); "/name …" recognised only for a command the chat has; and through the
// chat's real code with the stand-in Claude (test/fake-claude-chat.js answers `initialize`): the list reaches the page,
// and a message starting with a skill reaches Claude starting with it, Kural's notes after it.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");
const slash = require("../extension/lib/chat/slash");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

// (Shapes from Claude Code 2.1.296's answer to `initialize`.)
const FROM_CLAUDE = [
  { name: "deep-research", description: "Deep research harness", argumentHint: "", builtin: true },
  { name: "superpowers:brainstorming", description: "(Superpowers) You MUST use this before any creative work", argumentHint: "", aliases: ["brainstorming"] },
  { name: "code-review", description: "Review the current diff", argumentHint: "[low|medium|high]", aliases: ["review"], builtin: true },
  { name: "config", description: "Open the settings", argumentHint: "key=value", builtin: true },
  { name: "model", description: "Pick a model", argumentHint: "<model>", builtin: true },
  { name: "__remote-workflow", description: "", argumentHint: "", builtin: true },
  { name: "superpowers:brainstorming", description: "twice", argumentHint: "" },
  { name: "-rf", description: "not a name" }, null, "text",
];

(async () => {
  await check("clean: screen-only and internal commands out, duplicates and odd names out; yours first, then Claude Code's", () => {
    const l = slash.clean(FROM_CLAUDE);
    assert.deepStrictEqual(l.map((c) => c.name), ["superpowers:brainstorming", "code-review", "deep-research"]);
    assert.deepStrictEqual(l[0], { name: "superpowers:brainstorming", description: "(Superpowers) You MUST use this before any creative work", hint: "", aliases: ["brainstorming"], builtin: false });
    assert.strictEqual(l[1].hint, "[low|medium|high]");
    assert.deepStrictEqual(slash.clean(undefined), []);
  });
  await check("split: only a command the chat has, by name or alias; a path or plain text stays text", () => {
    const l = slash.clean(FROM_CLAUDE);
    assert.deepStrictEqual(slash.split("/superpowers:brainstorming a login page", l), { name: "superpowers:brainstorming", rest: "a login page" });
    assert.deepStrictEqual(slash.split("/brainstorming\nline two", l), { name: "brainstorming", rest: "\nline two" });
    assert.deepStrictEqual(slash.split("/code-review", l), { name: "code-review", rest: "" });
    for (const t of ["/usr/bin/env is missing", "/config", "/code-reviewer", "see /usr/bin and a/code-review", "/", ""]) assert.strictEqual(slash.split(t, l), null, t);
    assert.strictEqual(slash.split("/code-review", null), null);
  });
  await check("split: a command in the middle of a message comes out of the text (Claude Code runs it only at the start)", () => {
    const l = slash.clean(FROM_CLAUDE);
    assert.deepStrictEqual(slash.split("please /code-review this", l), { name: "code-review", rest: "please this" });
    assert.deepStrictEqual(slash.split("please /code-review", l), { name: "code-review", rest: "please" });
    assert.deepStrictEqual(slash.split("line one\n/brainstorming a page", l), { name: "brainstorming", rest: "line one\n a page" });
    assert.deepStrictEqual(slash.split("see /usr/bin then /code-review it", l), { name: "code-review", rest: "see /usr/bin then it" });
  });

  // ---------- through the chat ----------
  if (process.platform === "win32") { console.log("slash: the chat part skipped on Windows"); return done(); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-slash-"));
  const proj = path.join(tmp, "proj"); fs.mkdirSync(proj);
  const conf = { claudePath: path.join(__dirname, "fake-claude-chat.js"), "chat.fullClaudeCodeSetup": true };
  const vscode = { workspace: { isTrusted: true, workspaceFolders: [{ name: "proj", uri: { scheme: "file", fsPath: proj } }], textDocuments: [],
    getConfiguration: () => ({ get: (k, d) => Object.hasOwn(conf, k) ? conf[k] : d, inspect: () => ({}) }) },
    window: { state: { focused: true } }, env: { appRoot: "/unused" }, commands: { executeCommand: async () => {} },
    Uri: { file: (f) => ({ scheme: "file", fsPath: f }) }, EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
  const load = Module._load;
  Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
  require("../extension/lib/ai/claude").setSetupGate(() => true);
  const { ChatView } = require("../extension/lib/chat");
  const { Attachments } = require("../extension/lib/chat/attachments");
  const posted = [];
  const chat = Object.create(ChatView.prototype);
  Object.assign(chat, { tabs: [], panes: [], runtime: new Map(), routingJobs: new Map(), localReady: new Map(), attachments: new Attachments(), pulls: new Map(),
    post: (m) => posted.push(m), postTo: () => {}, postTabs: () => {}, save: () => {}, remember: () => {}, isReady: () => true, devices: null, router: null,
    activity: null, setupVersion: 0, here: { key: proj, name: "proj", open: proj }, changes: { snapshot: () => {}, summary: () => [] },
    context: { globalStorageUri: { fsPath: path.join(tmp, "storage") }, globalState: { get: () => ({}), update: () => {} } } });
  const tab = { id: "t-slash", title: "New chat", model: "sonnet", engine: "claude", effort: "medium", mode: "agent", mood: "default",
    status: "idle", started: false, sessionId: "slash-session", workspace: { key: proj, name: "proj", open: proj }, messages: [] };
  chat.tabs.push(tab);
  const waitFor = async (cond, ms = 15000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 25)); } };
  const listed = () => posted.filter((m) => m.type === "slash" && m.tabId === tab.id).pop();

  await check("the chat's Claude is asked for its skills when it starts; the page gets them (screen-only ones left out)", async () => {
    chat.warm(tab);
    await waitFor(() => listed() && listed().slash.items.length);
    assert.deepStrictEqual(listed().slash.items.map((c) => c.name), ["superpowers:brainstorming", "code-review"]);
  });
  await check("a message starting with a skill reaches Claude starting with it (the context Kural adds comes after), and is answered", async () => {
    await chat.send(tab, [{ t: "text", v: "/brainstorming a login page" }], [{ kind: "quote", text: "QUOTED-PART", label: "QUOTED-PART" }]);
    const reply = tab.messages[tab.messages.length - 1];
    await waitFor(() => !reply.running);
    const said = (reply.blocks.find((b) => b.k === "text") || { text: "" }).text;
    assert.ok(said.startsWith("You said: /brainstorming <context>"), said.slice(0, 200));
    assert.ok(said.includes("QUOTED-PART") && said.trimEnd().endsWith("a login page"), said);
    assert.ok(!reply.error, reply.error);
    assert.ok(tab.messages[tab.messages.length - 2].sentText.startsWith("/brainstorming "));
  });
  await check("slashOf: a skill typed in the middle moves to the front (lead + the rest)", async () => {
    assert.deepStrictEqual(chat.slashOf(tab, "please /code-review this"), { lead: "/code-review ", rest: "please this" });
    assert.strictEqual(chat.slashOf(tab, "see /usr/bin"), null);
  });
  await check("a model that isn't Claude: the list is empty and says why", async () => {
    tab.model = "codex:gpt-fake";
    assert.match(chat.slashView(tab).why, /pick a Claude model/);
    assert.strictEqual(chat.slashOf(tab, "/brainstorming x"), null);
    tab.model = "sonnet";
  });
  for (const r of chat.runtime.values()) if (r.proc) r.proc.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  done();
})();

function done() {
  console.log(failed ? `slash: ${failed} FAILED` : "slash: ALL PASS");
  process.exit(failed ? 1 : 0);
}
