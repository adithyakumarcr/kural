// No context loss when a chat moves to another AI (Adithya: "Kural behind the scenes must transfer the knowledge"):
// every direction between Claude, ChatGPT (Codex), Google Gemini and your own model, through the chat's real code and
// the real programs' adapters, each talking to its stand-in (test/fake-claude-chat.js, fake-codex.js, fake-agy.js,
// fake-ollama-chat.js). Checks what the next AI actually received: the conversation's record (your constraints, what was
// sent with your messages, the tool results, the files changed) and your new message, in a new session. Also after you
// switch an AI's account, and the record compacted for a small model.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");

if (process.platform === "win32") { console.log("handoff-fakes: skipped on Windows"); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-handoff-"));
const proj = path.join(tmp, "proj"); fs.mkdirSync(proj);
process.env.FAKE_CODEX_FILE = path.join(tmp, "codex-state"); delete process.env.FAKE_CODEX_STATE;
process.env.FAKE_AGY_FILE = path.join(tmp, "agy-state"); delete process.env.FAKE_AGY_STATE;
process.env.FAKE_CODEX_INPUT_LOG = path.join(tmp, "codex-input.jsonl");
process.env.FAKE_AGY_INPUT_LOG = path.join(tmp, "agy-input.jsonl");
const PORT = 11600 + Math.floor(Math.random() * 300);
const conf = { claudePath: path.join(__dirname, "fake-claude-chat.js"), "chat.fullClaudeCodeSetup": false, "tabCompletion.ollamaUrl": `http://127.0.0.1:${PORT}`,
  "localModels.contextLength": 32768 };
const vscode = { workspace: { isTrusted: true, workspaceFolders: [{ name: "proj", uri: { scheme: "file", fsPath: proj } }], textDocuments: [],
  getConfiguration: () => ({ get: (k, d) => Object.hasOwn(conf, k) ? conf[k] : d, inspect: () => ({}) }) },
  window: { state: { focused: true } }, env: { appRoot: "/unused" }, commands: { executeCommand: async () => {} },
  Uri: { file: (f) => ({ scheme: "file", fsPath: f }) }, EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
const load = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const claude = require("../extension/lib/ai/claude");
claude.setSetupGate(() => true);
const brain = require("../extension/lib/ai");
brain.setCli("codex", { bin: path.join(__dirname, "fake-codex.js"), ready: true, models: [{ id: "gpt-fake", label: "GPT-Fake", isDefault: true }] });
brain.setCli("agy", { bin: path.join(__dirname, "fake-agy.js"), ready: true, models: [{ id: "gemini-fake", label: "Gemini Fake" }] });
brain.setStore(path.join(tmp, "cli-store"));
const { ChatView } = require("../extension/lib/chat");
const { Attachments } = require("../extension/lib/chat/attachments");
const fakeOllama = require("./fake-ollama-chat").start(PORT);
fs.writeFileSync(process.env.FAKE_CODEX_FILE, "ok"); fs.writeFileSync(process.env.FAKE_AGY_FILE, "ok");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const MODEL = { claude: "sonnet", codex: "codex:gpt-fake", agy: "agy:gemini-fake", ollama: "ollama:qwen3-coder:30b" };
const SAID = ["SECRET-CONSTRAINT never deploy on Fridays", "SENT-WITH-IT export const version = 7", "TOOL-RESULT-42 tests passed", "src/login.js"];

function makeChat() {
  const chat = Object.create(ChatView.prototype);
  Object.assign(chat, { tabs: [], panes: [], runtime: new Map(), routingJobs: new Map(), localReady: new Map(), attachments: new Attachments(), pulls: new Map(),
    post: () => {}, postTo: () => {}, postTabs: () => {}, save: () => {}, remember: () => {}, isReady: () => true, devices: null, router: null, activity: null,
    setupVersion: 0, here: { key: proj, name: "proj", open: proj }, buildPrompt: async (text) => text,
    changes: { snapshot: () => {}, summary: () => [] },
    context: { globalStorageUri: { fsPath: path.join(tmp, "storage") }, globalState: { get: () => ({}), update: () => {} } },
    ollama: { status: async () => ({ running: true, ok: true, version: "0.20.0" }), models: async () => [{ name: "qwen3-coder:30b", chat: true, capabilities: ["completion", "tools"] }] } });
  return chat;
}
// A chat that has been talking with `from`: your constraint, what was sent with it, a tool's result, a file changed.
function history(from) {
  return { id: `t-${from}-${Math.random().toString(36).slice(2, 7)}`, title: "Work", model: MODEL[from], engine: from, effort: "medium", mode: "agent",
    mood: "default", team: 0, roles: [], teamStyle: "split", status: "idle", started: true, sessionId: "old-session", workspace: { key: proj, name: "proj", open: proj },
    messages: [
      { role: "user", segments: [{ t: "text", v: SAID[0] }], sentText: `${SAID[0]}\n<context>${SAID[1]}</context>` },
      { role: "assistant", model: MODEL[from], blocks: [{ k: "text", text: "I fixed the login and ran the tests." }],
        journal: { tools: [{ id: "t1", name: "Bash", input: { command: "npm test" }, status: "complete", result: SAID[2] }] },
        changes: [{ id: "c1", file: path.join(proj, "src/login.js"), rel: SAID[3], added: 3, removed: 1, state: "kept" }] }] };
}
const waitFor = async (cond, ms = 15000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 25)); } };
const lastLine = (f) => { try { const l = fs.readFileSync(f, "utf8").trim().split("\n"); return JSON.parse(l[l.length - 1]).text; } catch { return ""; } };
// What the program of `to` received as the new message.
async function received(to, chat, tab) {
  const reply = tab.messages[tab.messages.length - 1];
  await waitFor(() => !reply.running);
  if (to === "claude") return (reply.blocks.find((b) => b.k === "text") || { text: "" }).text;
  if (to === "codex") return lastLine(process.env.FAKE_CODEX_INPUT_LOG);
  if (to === "agy") return lastLine(process.env.FAKE_AGY_INPUT_LOG);
  const req = [...fakeOllama.requests].reverse().find((r) => r.url === "/api/chat" && r.body.stream !== false);
  const user = [...req.body.messages].reverse().find((m) => m.role === "user");
  return user.content;
}
const stop = (chat) => { for (const r of chat.runtime.values()) if (r.proc) r.proc.kill(); };

(async () => {
  for (const from of ["claude", "codex", "agy", "ollama"]) {
    for (const to of ["claude", "codex", "agy", "ollama"].filter((x) => x !== from)) {
      await check(`${from} → ${to}: the next AI gets the whole conversation and your new message, in a new session`, async () => {
        const chat = makeChat(), tab = history(from);
        chat.tabs.push(tab);
        await chat.handle({ type: "setModel", tabId: tab.id, model: MODEL[to] }, null);   // (picked in the model menu)
        await chat.send(tab, [{ t: "text", v: "NEW-REQUEST add a test for it" }], []);
        const got = await received(to, chat, tab);
        stop(chat);
        for (const s of ["<earlier_conversation>", "<kural_handoff>", ...SAID, "NEW-REQUEST add a test for it"]) assert.ok(got.includes(s), `${to} didn't get: ${s}\n${got.slice(0, 400)}`);
        assert.notStrictEqual(tab.sessionId, "old-session"); assert.strictEqual(tab.engine, to);
        const reply = tab.messages[tab.messages.length - 1];
        assert.ok(!reply.error, reply.error);
      });
    }
  }
  await check("after you switch Codex's (or Gemini's) account, the chat goes on in a new conversation that gets this one", async () => {
    for (const id of ["codex", "agy"]) {
      const chat = makeChat(), tab = history(id);
      chat.tabs.push(tab);
      chat.accountChanged(id);
      await chat.send(tab, [{ t: "text", v: "NEW-REQUEST after the switch" }], []);
      const got = await received(id, chat, tab);
      stop(chat);
      for (const s of ["before I switched accounts", ...SAID, "NEW-REQUEST after the switch"]) assert.ok(got.includes(s), `${id}: ${s}`);
      assert.notStrictEqual(tab.sessionId, "old-session");
    }
  });
  await check("a Claude chat goes on in its own conversation after an account switch (Claude Code keeps it on this computer)", async () => {
    const chat = makeChat(), tab = history("claude");
    chat.tabs.push(tab);
    chat.accountChanged("claude");
    await chat.send(tab, [{ t: "text", v: "NEW-REQUEST same conversation" }], []);
    const got = await received("claude", chat, tab);
    stop(chat);
    assert.ok(!got.includes("<earlier_conversation>") && got.includes("NEW-REQUEST same conversation"));
    assert.strictEqual(tab.sessionId, "old-session");
  });
  await check("a long conversation handed to your own model is compacted to fit its context, keeping every request", async () => {
    const chat = makeChat(), tab = history("claude");
    for (let i = 0; i < 40; i++) tab.messages.push({ role: "user", segments: [{ t: "text", v: `REQUEST-${i}` }], sentText: `REQUEST-${i}\n${"file contents ".repeat(2000)}` },
      { role: "assistant", model: "sonnet", blocks: [{ k: "text", text: `ANSWER-${i} ${"explained ".repeat(1500)}` }], journal: { tools: [{ id: `r${i}`, name: "Read", input: { file_path: `a${i}.js` }, status: "complete", result: "x".repeat(20000) }] } });
    chat.tabs.push(tab);
    await chat.handle({ type: "setModel", tabId: tab.id, model: MODEL.ollama }, null);
    await chat.send(tab, [{ t: "text", v: "NEW-REQUEST and now?" }], []);
    const got = await received("ollama", chat, tab);
    stop(chat);
    assert.ok(got.length < 32768 * 1.6 + 3000, `${got.length} characters`);
    assert.ok(/compacted/.test(got) && got.includes(SAID[0]) && got.includes("REQUEST-0") && got.includes("REQUEST-39") && got.includes("NEW-REQUEST and now?"));
  });
  fakeOllama.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `handoff-fakes: ${failed} FAILED` : "handoff-fakes: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
