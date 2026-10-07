// Enter while an answer runs queues the message (it used to stop the answer). The real chat code (lib/chat/index.js:
// send → queueSend → onEcho → finishReply / giveBack) with a stand-in program that echoes each message it takes in, as
// Claude Code does with --replay-user-messages (and Kural's Codex, Gemini and local agents do themselves).
const assert = require("assert"), Module = require("module");
const load = Module._load;
const vscode = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (_, d) => d }) },
  env: { appRoot: "/unused" }, commands: { executeCommand: () => {} }, Uri: { file: (f) => ({ scheme: "file", fsPath: f }) } };
const proxy = new Proxy(vscode, { get: (o, k) => o[k] || new Proxy(function () {}, { get: () => () => {} }) });
Module._load = function (r, ...a) { return r === "vscode" ? proxy : load.call(this, r, ...a); };
const { ChatView } = require("../extension/lib/chat");
const { Attachments } = require("../extension/lib/chat/attachments");
const journal = require("../extension/lib/router/journal");
const brain = require("../extension/lib/ai");
brain.providerOf = (model) => ({ ready: () => true, label: model, id: brain.engineOf(model) });

let passed = 0, failed = 0;
const check = async (name, fn) => { try { await fn(); passed++; console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const words = (v) => [{ t: "text", v }];

function fixture({ echoes = true } = {}) {
  const tab = { id: "chat", title: "Example", status: "idle", model: "sonnet", mode: "agent", effort: "medium", team: 0, messages: [], engine: "claude", started: true };
  const chat = Object.create(ChatView.prototype), posted = [], sent = [];
  let kills = 0;
  Object.assign(chat, { tabs: [tab], routingJobs: new Map(), runtime: new Map(), localReady: new Map(), attachments: new Attachments(),
    post: (m) => posted.push(m), postTo: (_, m) => posted.push(m), postTabs: () => {}, save: () => {}, remember: () => {}, isReady: () => true,
    teamSize: () => 0, teamLabel: () => null, endDevice: () => {}, finishTurn: () => {}, shown: () => true, warm: () => {},
    buildPrompt: async (text) => text, prepareLocal: async () => ({ ok: true }), procKey: (t) => t.model,
    startProc: (t) => {
      const r = { proc: { echoes, exited: false, send: (c) => sent.push(c), kill: () => { kills++; }, setModel: () => {}, interrupt: () => {}, request: async () => ({}) },
        procKey: t.model, agents: new Map(), perms: new Map(), tasks: new Map(), steers: [], expect: [] };
      chat.runtime.set(t.id, r); return r;
    },
  });
  const r = () => chat.runtime.get(tab.id);
  // What the program says: its echo of a message, the end of its turn.
  const echo = (content) => chat.onClaude(tab, r(), { type: "user", isReplay: true, message: { role: "user", content } });
  const result = (text = "done") => chat.onClaude(tab, r(), { type: "result", subtype: "success", is_error: false, result: text });
  const say = (text) => chat.onClaude(tab, r(), { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
  return { chat, tab, posted, sent, r, echo, result, say, kills: () => kills, of: (type) => posted.filter((m) => m.type === type) };
}

(async () => {
  await check("Enter while it answers: the message goes to the program at once and shows as queued (the answer goes on)", async () => {
    const f = fixture();
    await f.chat.send(f.tab, words("fix the login"), [], [], "req-1");
    f.echo(f.sent[0]);                                    // (the first message's own echo: nothing to show)
    assert.strictEqual(f.tab.status, "running");
    await f.chat.send(f.tab, words("also add a test"), [], [], "req-2");
    assert.strictEqual(f.sent.length, 2);
    assert.strictEqual(f.sent[1], "also add a test");
    assert.strictEqual(f.tab.status, "running");           // not stopped
    const q = f.of("queued").pop();
    assert.strictEqual(q.requestId, "req-2");              // (the page empties the box)
    assert.deepStrictEqual(q.queued.map((x) => x.text), ["also add a test"]);
    assert.strictEqual(f.kills(), 0);
  });

  await check("taken in at the next step: shown inside the running answer, the queue empties, one answer", async () => {
    const f = fixture();
    await f.chat.send(f.tab, words("fix the login"), [], [], "req-1");
    f.echo(f.sent[0]);
    f.say("Looking at login.js. ");
    await f.chat.send(f.tab, words("also add a test"), [], [], "req-2");
    f.echo(f.sent[1]);
    const reply = f.tab.messages[1];
    assert.deepStrictEqual(reply.blocks.map((b) => b.k), ["text", "steer"]);
    assert.deepStrictEqual(reply.blocks[1].segments, words("also add a test"));
    assert.deepStrictEqual(f.of("queued").pop().queued, []);
    f.say("Added the test too.");
    f.result();
    assert.strictEqual(f.tab.messages.length, 2);         // still one question, one answer
    assert.strictEqual(f.tab.status, "idle");
    assert.ok(!reply.running);
    // A switch to another AI (or a fork) carries it: the handoff record says what you added while it answered.
    assert.match(journal.handoff(f.tab.messages), /"userAddedWhileAnswering":\["also add a test"\]/);
  });

  await check("the answer ended before it was taken in: it stays busy, then the message is answered as the next one", async () => {
    const f = fixture();
    await f.chat.send(f.tab, words("write a poem"), [], [], "req-1");
    f.echo(f.sent[0]);
    await f.chat.send(f.tab, words("now a shorter one"), [], [], "req-2");
    f.say("Roses…");
    f.result("Roses…");
    assert.ok(!f.tab.messages[1].running);
    assert.strictEqual(f.tab.status, "running");          // waiting for the queued one
    f.echo(f.sent[1]);                                    // the program starts on it
    assert.strictEqual(f.tab.messages.length, 4);
    assert.deepStrictEqual(f.tab.messages[2].segments, words("now a shorter one"));
    assert.ok(f.tab.messages[3].running);
    const appended = f.of("append").pop();
    assert.deepStrictEqual(appended.msgs.map((m) => m.role), ["user", "assistant"]);
    f.say("Short.");
    f.result("Short.");
    assert.deepStrictEqual(f.tab.messages[3].blocks.map((b) => b.text), ["Short."]);
    assert.strictEqual(f.tab.status, "idle");
  });

  await check("two queued messages, taken in one by one, in order (the same words twice are told apart by order)", async () => {
    const f = fixture();
    await f.chat.send(f.tab, words("go on"), [], [], "req-1");
    await f.chat.send(f.tab, words("go on"), [], [], "req-2");   // same text as the first message
    await f.chat.send(f.tab, words("and check it"), [], [], "req-3");
    f.echo(f.sent[0]);                                    // the first message's echo is not the queued "go on"
    assert.deepStrictEqual(f.r().steers.map((s) => s.segments[0].v), ["go on", "and check it"]);
    f.echo(f.sent[1]); f.echo(f.sent[2]);
    assert.deepStrictEqual(f.tab.messages[1].blocks.filter((b) => b.k === "steer").map((b) => b.segments[0].v), ["go on", "and check it"]);
    assert.deepStrictEqual(f.r().steers, []);
  });

  await check("Stop with a queued message: the program is stopped for good and the message comes back into the box", async () => {
    const f = fixture();
    await f.chat.send(f.tab, words("fix the login"), [], [], "req-1");
    f.echo(f.sent[0]);
    await f.chat.send(f.tab, words("also add a test"), [], [], "req-2");
    await f.chat.onMessage({ type: "stop", tabId: f.tab.id }, null);
    assert.strictEqual(f.kills(), 1);                     // (an interrupt would have answered it next)
    const back = f.of("unqueue").pop();
    assert.deepStrictEqual(back.items.map((x) => x.segments), [words("also add a test")]);
    assert.deepStrictEqual(back.queued, []);
    assert.strictEqual(f.tab.status, "idle");
    assert.strictEqual(f.tab.messages[1].error, "stopped");
  });

  await check("Stop without a queued message: an interrupt, as before (the program keeps running)", async () => {
    const f = fixture();
    let interrupted = 0;
    await f.chat.send(f.tab, words("fix the login"), [], [], "req-1");
    f.r().proc.interrupt = () => { interrupted++; };
    await f.chat.onMessage({ type: "stop", tabId: f.tab.id }, null);
    assert.strictEqual(interrupted, 1);
    assert.strictEqual(f.kills(), 0);
  });

  await check("the program ends before taking it in: the message comes back into the box, the chat isn't stuck", async () => {
    const f = fixture();
    await f.chat.send(f.tab, words("fix the login"), [], [], "req-1");
    f.echo(f.sent[0]);
    await f.chat.send(f.tab, words("also add a test"), [], [], "req-2");
    f.result();
    assert.strictEqual(f.tab.status, "running");
    f.chat.onExit(f.tab, f.r(), { code: 1, login: false, stderr: "" });
    assert.deepStrictEqual(f.of("unqueue").pop().items.map((x) => x.segments), [words("also add a test")]);
    assert.strictEqual(f.tab.status, "idle");
  });

  await check("an older Claude Code (no echoes): it says to update, sends nothing, keeps your draft", async () => {
    const f = fixture({ echoes: false });
    await f.chat.send(f.tab, words("fix the login"), [], [], "req-1");
    await f.chat.send(f.tab, words("also add a test"), [], [], "req-2");
    assert.strictEqual(f.sent.length, 1);
    assert.ok(!f.of("queued").length);                    // no ack: the page keeps what you typed
    assert.match(f.of("flash").pop().text, /update Claude Code/);
  });

  await check("a long command Claude Code reports as a background task isn't an agent: no \"All the agents…\" nudge", async () => {
    const f = fixture();
    await f.chat.send(f.tab, words("run sleep 8"), [], [], "req-1");
    f.echo(f.sent[0]);
    const sys = (subtype, extra) => f.chat.onClaude(f.tab, f.r(), { type: "system", subtype, task_id: "bash1", tool_use_id: "toolu_bash", ...extra });
    sys("task_started", { description: "sleep 8" });
    await new Promise((r) => setTimeout(r, 20));          // (the command takes a while)
    sys("task_notification", { status: "completed" });
    f.say("It printed done.");
    f.result();
    assert.strictEqual(f.tab.status, "idle");             // closed at once, not held for agents
    assert.ok(!f.tab.messages[1].running);
    await new Promise((r) => setTimeout(r, 5600));        // (the nudge came 5 s after)
    assert.strictEqual(f.sent.length, 1);
  });

  await check("an edit of an earlier message while it answers waits (nothing is sent)", async () => {
    const f = fixture();
    await f.chat.send(f.tab, words("fix the login"), [], [], "req-1");
    await f.chat.send(f.tab, words("changed"), [], [], "req-2", 0);
    assert.strictEqual(f.sent.length, 1);
    assert.strictEqual(f.tab.messages.length, 2);
  });

  console.log(`queue: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
