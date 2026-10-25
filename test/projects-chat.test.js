// What the Projects bar needs from the chat (lib/chat/index.js): per tab "unseen" (an answer finished while you weren't
// looking), projectChats() (run / ask / done / idle, in tab order), onChatsChanged, showChat, and cardElsewhere reaching the
// Notifier. The real ChatView on a stand-in vscode, like notify.test.js and split-chat.test.js.
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");
const load = Module._load;
const conf = { notifications: undefined };
const executed = [];
const vscode = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (k, d) => conf[k] === undefined ? d : conf[k], inspect: () => ({}), update: async () => {} }) },
  window: { state: { focused: false } }, ConfigurationTarget: { Global: 1 }, env: { appRoot: "/unused" },
  commands: { executeCommand: async (...a) => { executed.push(a); }, getCommands: async () => [] },
  Uri: { file: (f) => ({ scheme: "file", fsPath: f }), joinPath: (u, ...p) => ({ fsPath: path.join(u.fsPath, ...p) }) }, EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
const proxy = new Proxy(vscode, { get: (o, k) => o[k] || new Proxy(function () {}, { get: () => () => {} }) });
Module._load = function (r, ...a) { return r === "vscode" ? proxy : load.call(this, r, ...a); };
const { ChatView } = require("../extension/lib/chat");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const tick = () => new Promise((r) => setTimeout(r, 10));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-projects-chat-"));

// A real ChatView (its constructor makes the first, empty tab), with the parts that talk to programs and pages stood in for.
function fixture() {
  const mem = {};
  const store = () => ({ get: (k) => mem[k], update: async (k, v) => { mem[k] = v; }, keys: () => Object.keys(mem) });
  const context = { globalState: store(), workspaceState: store(), subscriptions: [], extensionUri: { fsPath: tmp }, globalStorageUri: { fsPath: tmp },
    extensionPath: tmp, extension: { packageJSON: { version: "1.0.0" } }, storageUri: { fsPath: tmp } };
  const chat = new ChatView(context, async () => {});
  Object.assign(chat, { post: () => {}, postTo: () => {}, save: () => {}, warm: () => {}, finishTurn: () => {}, switchUsage: async () => {}, router: null, activity: null });
  const events = [];
  chat.onChatsChanged = () => events.push(chat.projectChats().map((c) => `${c.id}:${c.state}`).join(","));
  const a = chat.tabs[0]; a.title = "Alpha";
  const b = chat.newTab(false); b.title = "Beta";
  const side = { kind: "side", activeId: a.id, view: { visible: true }, layout: null };
  chat.panes = [side];
  events.length = 0;
  return { chat, a, b, side, events };
}
// An answer that's running in `tab`: its reply is the last message.
function running(tab) {
  const reply = { role: "assistant", blocks: [{ k: "text", text: "Fixed it. Details follow." }], running: true, t0: Date.now(), mode: tab.mode, models: [tab.model] };
  tab.messages.push({ role: "user", segments: [] }, reply); tab.status = "running";
  return { turn: { reply, snaps: {}, ask: "fix", journal: { tools: [] } }, perms: new Map(), agents: new Map(), tasks: new Map(), steers: [] };
}
const ok = { type: "result", subtype: "success", is_error: false };
const stopped = { type: "result", subtype: "error_during_execution", is_error: true };

(async () => {
  await check("unseen: set when an answer finishes in a chat that isn't on screen, with the time and a change event", () => {
    const { chat, a, b, events } = fixture();
    const r = running(b); chat.runtime.set(b.id, r);
    assert.ok(!b.unseen);
    const before = Date.now();
    chat.finishReply(b, r, ok);
    assert.strictEqual(b.unseen, true);
    assert.ok(b.doneAt >= before && b.doneAt <= Date.now());
    assert.deepStrictEqual(chat.projectChats().map((c) => [c.id, c.state]), [[a.id, "idle"], [b.id, "done"]]);
    assert.strictEqual(chat.projectChats()[1].doneAt, b.doneAt);
    assert.ok(events.length >= 1 && events[events.length - 1].endsWith(`${b.id}:done`));
  });
  await check("unseen: not set while a pane shows the chat (the side panel, its own editor, a column)", () => {
    const { chat, a, b, side } = fixture();
    const r = running(a); chat.runtime.set(a.id, r);
    chat.finishReply(a, r, ok);
    assert.ok(!a.unseen); assert.strictEqual(chat.projectChats()[0].onScreen, true);
    for (const own of [{ kind: "editor", single: true, activeId: b.id, panel: { visible: true } }, { kind: "editor", single: true, col: true, activeId: b.id, view: { visible: true } }]) {
      chat.panes.push(own);
      const r2 = running(b); chat.runtime.set(b.id, r2); chat.finishReply(b, r2, ok);
      assert.ok(!b.unseen);
      chat.panes.pop();
    }
    const r3 = running(b); chat.runtime.set(b.id, r3); chat.finishReply(b, r3, ok);   // (no pane shows it any more)
    assert.strictEqual(b.unseen, true);
  });
  await check("unseen: not after Stop, not while a queued message is answered next; an error does count", () => {
    const { chat, b } = fixture();
    let r = running(b); chat.runtime.set(b.id, r);
    chat.finishReply(b, r, stopped);
    assert.ok(!b.unseen); assert.strictEqual(chat.projectChats()[1].state, "idle");
    r = running(b); r.steers = [{ segments: [], attachments: [] }]; r.proc = { exited: false }; chat.runtime.set(b.id, r);
    chat.finishReply(b, r, ok);
    assert.ok(!b.unseen); assert.strictEqual(b.status, "running");   // (queued: the chat is still busy)
    clearTimeout(r.queueTimer);
    r = running(b); chat.runtime.set(b.id, r);
    chat.finishReply(b, r, { ...ok, is_error: true, result: "Credit balance is too low" });
    assert.strictEqual(b.unseen, true);
  });
  await check("unseen: cleared by activate and by showChat (the side panel takes the chat and focus)", async () => {
    const { chat, a, b, side } = fixture();
    const finish = (t) => { const r = running(t); chat.runtime.set(t.id, r); chat.finishReply(t, r, ok); assert.strictEqual(t.unseen, true); };
    finish(b); chat.activate(b.id, side);
    assert.strictEqual(b.unseen, false); assert.strictEqual(side.activeId, b.id);
    chat.activate(a.id, side);
    finish(b); await chat.showChat(b.id);   // not on screen: the side panel takes it and takes focus
    assert.strictEqual(b.unseen, false); assert.strictEqual(side.activeId, b.id);
    assert.ok(executed.some((c) => c[0] === "kural.chat.focus"));
  });
  await check("showChat reveals the chat in its own editor or a column, or in the side panel, and ends unseen", async () => {
    const { chat, a, b, side } = fixture();
    const own = { kind: "editor", single: true, activeId: b.id, panel: { reveal() { own.revealed = true; } } };
    chat.panes.push(own);
    b.unseen = true;
    await chat.showChat(b.id);
    assert.strictEqual(own.revealed, true); assert.strictEqual(b.unseen, false);
    chat.panes.pop();
    const col = { kind: "editor", single: true, col: true, activeId: a.id, view: { visible: true } };
    chat.panes.push(col);
    a.unseen = true; executed.length = 0;
    await chat.showChat(a.id);
    assert.strictEqual(a.unseen, false); assert.ok(executed.some((c) => c[0] === "kural.chat.focus")); assert.strictEqual(side.activeId, a.id);
    await chat.showChat("nope");   // (no such chat: nothing)
  });
  await check("unseen: markSeen clears it; a new answer clears it", () => {
    const { chat, a, b } = fixture();
    const r = running(b); chat.runtime.set(b.id, r); chat.finishReply(b, r, ok);
    assert.strictEqual(b.unseen, true);
    chat.newReply(b, null);
    assert.strictEqual(b.unseen, false);
    const r2 = running(a); chat.runtime.set(a.id, r2); chat.finishReply(a, r2, ok);   // (on screen: nothing)
    b.unseen = true; chat.markSeen(b.id);   // (what a pane's visibility handler does)
    assert.strictEqual(b.unseen, false);
  });
  await check("unseen is saved with the tab (and survives clean)", () => {
    const { chat, b } = fixture();
    const r = running(b); chat.runtime.set(b.id, r); chat.finishReply(b, r, ok);
    const copy = chat.clean(JSON.parse(JSON.stringify(b)));
    assert.strictEqual(copy.unseen, true); assert.strictEqual(copy.doneAt, b.doneAt);
  });

  await check("projectChats: run while an answer runs, in tab order, not the chats from other workspaces", () => {
    const { chat, a, b } = fixture();
    running(a);
    const c = chat.newTab(false); c.title = "Gamma"; c.visiting = true;
    const d = chat.newTab(false); d.title = "Delta";
    assert.deepStrictEqual(chat.projectChats().map((x) => [x.title, x.state]), [["Alpha", "run"], ["Beta", "idle"], ["Delta", "idle"]]);
    assert.deepStrictEqual(Object.keys(chat.projectChats()[0]).sort(), ["ask", "doneAt", "empty", "id", "onScreen", "state", "title"]);
    assert.strictEqual(d.messages.length, 0);
    assert.strictEqual(chat.projectChats().find((x) => x.title === "Delta").empty, true, "nothing sent yet: empty (the bar leaves it out)");
    assert.strictEqual(chat.projectChats()[0].ask, null);
  });
  await check("projectChats: ask while a command waits for you, with a short text; run again once answered; events on both", async () => {
    const { chat, a, events } = fixture();
    const r = running(a); chat.runtime.set(a.id, r);
    const asked = chat.onPermission(a, r, { tool_name: "Bash", input: { command: "npm run build " + "x".repeat(200) } });
    await tick();
    const [card] = chat.projectChats();
    assert.strictEqual(card.state, "ask");
    assert.ok(card.ask.startsWith("Run this command? npm run build"));
    assert.ok(card.ask.length <= 80, card.ask.length);
    assert.ok(events.some((e) => e.startsWith(`${a.id}:ask`)));
    events.length = 0;
    [...r.perms.values()][0](true);
    assert.deepStrictEqual(await asked, { allow: true });
    assert.strictEqual(chat.projectChats()[0].state, "run");
    assert.ok(events.some((e) => e.startsWith(`${a.id}:run`)));
  });
  await check("projectChats: ask for a question and for the parallel agents' plan", async () => {
    const { chat, a } = fixture();
    let r = running(a); chat.runtime.set(a.id, r);
    const q = chat.askUser(a, r, { input: { questions: [{ question: "Which database?", options: [{ label: "Postgres" }] }] } });
    await tick();
    assert.deepStrictEqual([chat.projectChats()[0].state, chat.projectChats()[0].ask], ["ask", "Which database?"]);
    [...r.perms.values()][0](false); await q;
    assert.strictEqual(chat.projectChats()[0].state, "run");
    const plan = { summary: "Two", models: [{ id: "haiku" }], tasks: [{ title: "A", model: "haiku" }, { title: "B", model: "haiku" }] };
    const p = chat.askPlan(a, r, plan);
    await tick();
    assert.deepStrictEqual([chat.projectChats()[0].state, chat.projectChats()[0].ask], ["ask", "Split the work between 2 agents?"]);
    [...r.perms.values()].pop()(false); await p;
    assert.strictEqual(chat.projectChats()[0].state, "run");
  });
  await check("projectChats: ask beats run; done shows until the chat is seen, then idle", () => {
    const { chat, b, side } = fixture();
    const r = running(b); chat.runtime.set(b.id, r);
    b.status = "waiting"; r.turn.reply.blocks.push({ k: "question", pid: "p", state: "pending", questions: [{ question: "Sure?" }] });
    assert.strictEqual(chat.projectChats()[1].state, "ask");
    r.turn.reply.blocks.pop(); b.status = "running";
    chat.finishReply(b, r, ok);
    assert.strictEqual(chat.projectChats()[1].state, "done");
    chat.activate(b.id, side);
    assert.strictEqual(chat.projectChats()[1].state, "idle");
  });

  await check("moveOut: an idle chat leaves this window and stays in History; a working, waiting, empty or visiting one doesn't", () => {
    const { chat, a, b } = fixture();
    b.messages.push({ role: "user", segments: [{ t: "text", v: "make the mesh finer" }] }, { role: "assistant", blocks: [{ k: "text", text: "Done." }] });
    const r = running(a); chat.runtime.set(a.id, r);
    assert.strictEqual(chat.moveOut(a.id), false, "working");
    const empty = chat.newTab(false);
    assert.strictEqual(chat.moveOut(empty.id), false, "nothing sent yet");
    b.visiting = true;
    assert.strictEqual(chat.moveOut(b.id), false, "a chat from another project, here to read");
    b.visiting = false;
    const askOf = chat.askOf;
    chat.askOf = (t) => (t === b ? "Allow make?" : askOf.call(chat, t));
    assert.strictEqual(chat.moveOut(b.id), false, "waiting for you");
    chat.askOf = askOf;
    assert.strictEqual(chat.moveOut(b.id), true);
    assert.ok(!chat.tab(b.id), "gone from this window");
    assert.strictEqual(chat.archive.read(b.id).title, "Beta", "kept in History");
  });
  await check("adopt: a moved chat opens here with the same id, this project as its workspace, a fresh conversation and the old one carried over", () => {
    const one = fixture(), two = fixture();
    const { b } = one;
    b.messages.push({ role: "user", segments: [{ t: "text", v: "make the mesh finer" }] }, { role: "assistant", blocks: [{ k: "text", text: "Done." }] });
    b.workspace = { key: "f:/p/weld", name: "weld", open: "/p/weld" }; b.started = true;
    const oldSession = b.sessionId;
    assert.ok(one.chat.moveOut(b.id));
    two.chat.here = { key: "f:/p/kural", name: "kural", open: "/p/kural" };
    assert.strictEqual(two.chat.adopt(b.id, "weld"), true);
    const t = two.chat.tab(b.id);
    assert.ok(t && t.title === "Beta" && t.messages.length === 2);
    assert.deepStrictEqual(t.workspace, two.chat.here);
    assert.ok(t.sessionId !== oldSession && t.started === false && !t.visiting);
    assert.strictEqual(t.carryOver.from, "weld");
    assert.match(t.carryOver.text, /make the mesh finer/);
    assert.deepStrictEqual(two.chat.archive.read(b.id).workspace, two.chat.here, "History shows it under its new project");
    assert.strictEqual(two.chat.adopt("nope", "weld"), false, "not in History: nothing");
    assert.strictEqual(two.chat.adopt(b.id, "weld"), true, "already here: shown again");
    assert.strictEqual(two.chat.tabs.filter((x) => x.id === b.id).length, 1);
  });
  await check("onChatsChanged: tab added, renamed, closed; a throwing callback breaks nothing", () => {
    const { chat, a, events } = fixture();
    const c = chat.newTab(false); assert.ok(events.length >= 1); events.length = 0;
    chat.rename(c.id, "Renamed"); assert.ok(events.length >= 1); events.length = 0;
    chat.closeTab(c.id, false); assert.ok(events.length >= 1);
    chat.onChatsChanged = () => { throw new Error("the bar broke"); };
    chat.postTabs();   // (no throw)
    chat.onChatsChanged = null; chat.postTabs();
  });

  await check("cardElsewhere reaches the Notifier: a card instead of the other ways, with the chat's tab id", async () => {
    const { chat, a, b } = fixture();
    const got = [], other = [];
    chat.cardElsewhere = async (o) => { got.push(o); return true; };
    chat.notifier.e.run = async () => { other.push("os"); return true; };
    chat.notifier.e.inApp = async () => { other.push("app"); return false; };
    const route = await chat.notify(b, "done", { text: "All fixed." });
    assert.strictEqual(route, "card");
    assert.deepStrictEqual(got, [{ id: `kural-chat-${b.id}`, title: "Beta is done", body: "All fixed.", attention: false, tabId: b.id }]);
    assert.deepStrictEqual(other, []);
  });
  await check("cardElsewhere: false, a throw or not set: the old ways; the setting off: nothing at all", async () => {
    const { chat, b } = fixture();
    const other = [];
    chat.notifier.e.platform = "linux"; chat.notifier.e.hasToast = async () => false;
    chat.notifier.e.run = async () => { other.push("os"); return true; };
    for (const elsewhere of [null, async () => false, async () => { throw new Error("x"); }]) {
      chat.cardElsewhere = elsewhere;
      assert.strictEqual(await chat.notify(b, "done", { text: "ok" }), "os");
    }
    assert.deepStrictEqual(other, ["os", "os", "os"]);
    chat.cardElsewhere = async () => { assert.fail("asked although the setting is off"); };
    conf.notifications = "off";
    assert.strictEqual(await chat.notify(b, "done", { text: "ok" }), undefined);
    conf.notifications = undefined;
  });
  await check("Test Notification names the card route", () => {
    assert.ok(/a card in your other Kural window/.test(fs.readFileSync(path.join(__dirname, "../extension/lib/chat/index.js"), "utf8")));
  });

  console.log(failed ? `projects-chat: ${failed} FAILED` : "projects-chat: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
