// Memory: a chat's program stops when the chat is off screen and idle for 10 minutes, and at most two idle ones stay warm
// (Ross measured ~120 MB per Claude Code process). Busy chats and chats on screen keep theirs.
const assert = require("assert");
const Module = require("module");
const load = Module._load;
const vscode = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (_, d) => d }) },
  window: { state: { focused: true } }, env: { appRoot: "/unused" }, commands: { executeCommand: () => {} }, Uri: { file: (f) => ({ scheme: "file", fsPath: f }) } };
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const { ChatView } = require("../extension/lib/chat");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const now = Date.now(), min = 60000;
function setup(list) {
  const chat = Object.create(ChatView.prototype), killed = [];
  Object.assign(chat, { tabs: [], runtime: new Map(), routingJobs: new Map(), panes: [], endDevice: () => {} });
  for (const x of list) {
    const tab = { id: x.id, model: "sonnet", status: x.status || "idle" };
    chat.tabs.push(tab);
    chat.runtime.set(x.id, { proc: { kill: () => killed.push(x.id) }, lastUsed: now - x.ago * min, perms: new Map(), agents: new Map(x.agent ? [["a", { state: "running" }]] : []),
      steers: x.queued ? [{}] : [], turn: x.running ? { reply: { running: true } } : null });
    if (x.shown) chat.panes.push({ activeId: x.id, view: { visible: true } });
  }
  return { chat, killed };
}

check("off screen and idle for 10 minutes: its program stops; on screen, busy or recent: it stays", () => {
  const { chat, killed } = setup([{ id: "old", ago: 11 }, { id: "recent", ago: 2 }, { id: "shown", ago: 30, shown: true },
    { id: "answering", ago: 30, status: "running", running: true }, { id: "agents", ago: 30, agent: true }, { id: "queued", ago: 30, queued: true }]);
  chat.stopIdle(now);
  assert.deepStrictEqual(killed, ["old"]);
  const r = chat.runtime.get("old");
  assert.strictEqual(r.proc, null); assert.strictEqual(r.stale, true);   // (the next message or opening the chat starts it again)
});
check("at most two idle ones stay warm: the least recently used stop first", () => {
  const { chat, killed } = setup([{ id: "a", ago: 1 }, { id: "b", ago: 3 }, { id: "c", ago: 5 }, { id: "d", ago: 7 }]);
  chat.stopIdle(now);
  assert.deepStrictEqual(killed.sort(), ["c", "d"]);
});
check("a command still running in the background (a dev server) keeps the program, also after the answer ended", () => {
  const { chat, killed } = setup([{ id: "server", ago: 30 }, { id: "done", ago: 30 }]);
  const tab = (id) => chat.tabs.find((t) => t.id === id);
  // Claude Code reports a background command as a task; Kural sees it even with no answer running.
  chat.onClaude(tab("server"), chat.runtime.get("server"), { type: "system", subtype: "task_started", task_id: "t1", tool_use_id: "b1" });
  chat.onClaude(tab("done"), chat.runtime.get("done"), { type: "system", subtype: "task_started", task_id: "t2", tool_use_id: "b2" });
  chat.onClaude(tab("done"), chat.runtime.get("done"), { type: "system", subtype: "task_notification", task_id: "t2", status: "completed" });
  chat.stopIdle(now);
  assert.deepStrictEqual(killed, ["done"]);
});
check("a hidden side panel doesn't count as on screen", () => {
  const { chat, killed } = setup([{ id: "x", ago: 20 }]);
  chat.panes.push({ activeId: "x", view: { visible: false } });
  chat.stopIdle(now);
  assert.deepStrictEqual(killed, ["x"]);
});

console.log(failed ? `idle-chats: ${failed} FAILED` : "idle-chats: ALL PASS");
process.exit(failed ? 1 : 0);
