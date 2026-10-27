// Debug mode was removed (Adithya, 27 Oct 2026: "unnecessary"). The mode menu, the kural.chat.mode setting and the code
// have no Debug any more, and a chat saved in Debug goes on in Agent: it asked before commands, so it must never come back
// as Auto (the default mode of a new chat may be Auto). The real ChatView on a stand-in vscode, like projects-chat.test.js.
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");
const load = Module._load;
const vscode = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (k, d) => d, inspect: () => ({}), update: async () => {} }) },
  window: { state: { focused: false } }, ConfigurationTarget: { Global: 1 }, env: { appRoot: "/unused" },
  commands: { executeCommand: async () => {}, getCommands: async () => [] },
  Uri: { file: (f) => ({ scheme: "file", fsPath: f }), joinPath: (u, ...p) => ({ fsPath: path.join(u.fsPath, ...p) }) }, EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
const proxy = new Proxy(vscode, { get: (o, k) => o[k] || new Proxy(function () {}, { get: () => () => {} }) });
Module._load = function (r, ...a) { return r === "vscode" ? proxy : load.call(this, r, ...a); };
const { ChatView, MODES } = require("../extension/lib/chat");
const { decide, gatedMode } = require("../extension/lib/chat/permission-policy");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const root = path.join(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-no-debug-"));

check("the mode menu has Agent, Auto, Plan and Ask, and no Debug", () => {
  assert.deepStrictEqual(MODES.map((m) => m.id), ["agent", "auto", "plan", "ask"]);
});
check("the kural.chat.mode setting offers no Debug", () => {
  const p = JSON.parse(fs.readFileSync(path.join(root, "extension/package.json"), "utf8")).contributes.configuration;
  const all = Array.isArray(p) ? Object.assign({}, ...p.map((x) => x.properties)) : p.properties;
  const mode = all["kural.chat.mode"];
  assert.deepStrictEqual(mode.enum, ["agent", "auto", "plan", "ask"]);
  assert.strictEqual(mode.enumDescriptions.length, mode.enum.length);
});
check("its code is gone: lib/debug, the prompt, the log note", () => {
  assert.ok(!fs.existsSync(path.join(root, "extension/lib/debug")));
  const prompts = require("../extension/lib/chat/prompts");
  assert.strictEqual(prompts.PROMPTS.debug, undefined);
  assert.strictEqual(prompts.debugNote, undefined);
  for (const f of ["extension/lib/chat/index.js", "extension/lib/chat/prompts.js", "extension/lib/ai/index.js", "extension/media/chat.js", "extension/media/split.js"]) {
    assert.ok(!/kural_debug|debugNote|DebugLogs|agentLike/.test(fs.readFileSync(path.join(root, f), "utf8")), f);
  }
});
check("a chat saved in Debug comes back in Agent, also when your last mode was Auto", () => {
  const mem = { "kural.chat.last": { mode: "auto" } };
  const store = () => ({ get: (k) => mem[k], update: async (k, v) => { mem[k] = v; }, keys: () => Object.keys(mem) });
  const context = { globalState: store(), workspaceState: store(), subscriptions: [], extensionUri: { fsPath: tmp }, globalStorageUri: { fsPath: tmp },
    extensionPath: tmp, extension: { packageJSON: { version: "1.0.0" } }, storageUri: { fsPath: tmp } };
  const chat = new ChatView(context, async () => {});
  assert.strictEqual(chat.lastChoices().mode, "auto", "(the stand-in's last mode)");
  assert.strictEqual(chat.fix({ mode: "debug", messages: [] }).mode, "agent");
  assert.strictEqual(chat.fix({ mode: "nonsense", messages: [] }).mode, "auto", "(any other unknown mode: the default, as before)");
});
check("a stray \"debug\" in the permission policy still asks before a command, like Agent; the gate refuses it", () => {
  const r = decide({ tool: "Bash", input: { command: "rm -rf build" }, mode: "debug", privateFolders: false });
  assert.ok(r.ask && !r.allow, JSON.stringify(r));
  assert.strictEqual(gatedMode("debug", "agent"), null);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `no-debug-mode: ${failed} FAILED` : "no-debug-mode: ALL PASS");
process.exit(failed ? 1 : 0);
