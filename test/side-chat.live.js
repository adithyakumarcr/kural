// Live check of side chat (needs `claude` installed and logged in): one side question through the real code path
// (lib/chat/side.js → brain.makeAgent → a real `claude` with Haiku, no tools), then a follow-up that needs the first answer.
// Run: node test/side-chat.live.js
const Module = require("module");
const path = require("path");
const orig = Module._load;
const vscode = { window: { createOutputChannel: () => ({ appendLine() {} }) }, workspace: { workspaceFolders: [], isTrusted: true, getConfiguration: () => ({ get: (k, d) => d, inspect: () => undefined }), onDidChangeConfiguration: () => ({ dispose() {} }) },
  env: {}, commands: { executeCommand: async () => {} }, Uri: { file: (f) => ({ scheme: "file", fsPath: f }) }, EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
Module._load = function (req, ...a) { return req === "vscode" ? vscode : orig.call(this, req, ...a); };
const ext = path.resolve(__dirname, "../extension");
const claude = require(ext + "/lib/ai/claude.js");
claude.setSetupGate(() => true);
const brain = require(ext + "/lib/ai");
const { SideChats } = require(ext + "/lib/chat/side.js");

const tab = { id: "live", status: "idle", messages: [
  { role: "user", segments: [{ t: "text", v: "How does Kural's model router choose a model?" }] },
  { role: "assistant", blocks: [{ k: "text", text: "The router first classifies the request by size. Then it picks the lightest model that has the needed tier. If that AI is near its usage limit, the request moves to another AI, carrying a handoff of the conversation." }] },
] };
const posts = [];
const side = new SideChats({
  makeAgent: brain.makeAgent, model: () => "haiku", check: () => ({ ok: true }), isClaude: () => true, nameOf: (m) => m[0].toUpperCase() + m.slice(1),
  localOpts: () => null, textOf: (s) => s.map((x) => x.v).join(""), cwd: () => process.cwd(), post: (m) => posts.push(m), save() {} });
const run = (question) => new Promise((resolve) => {
  const t0 = Date.now(); let first = 0;
  const before = posts.length;
  const timer = setInterval(() => {
    for (const p of posts.slice(before)) {
      if (p.type === "sideDelta" && !first) first = Date.now() - t0;
      if (p.type === "sideState" && !p.item.running) { clearInterval(timer); resolve({ ms: Date.now() - t0, first, item: p.item }); return; }
    }
  }, 20);
  side.ask(tab, { index: 1, thread: "live1", quote: "the lightest model that has the needed tier", question });
});
(async () => {
  const a = await run("What does tier mean here?");
  console.log(`Q1  ${a.ms} ms (first text after ${a.first} ms) by ${a.item.model}${a.item.error ? " ERROR " + a.item.error : ""}\n${a.item.a}\n`);
  const b = await run("And what happens to that when it is near a limit?");
  console.log(`Q2  ${b.ms} ms (first text after ${b.first} ms) by ${b.item.model}${b.item.error ? " ERROR " + b.item.error : ""}\n${b.item.a}\n`);
  console.log("main conversation untouched:", tab.status === "idle" && tab.messages.length === 2 && tab.messages[1].blocks.length === 1);
  process.exit(a.item.error || b.item.error ? 1 : 0);
})();
