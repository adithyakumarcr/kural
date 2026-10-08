// Forks keep the selected context, but never a provider session, pending approval, or writable checkpoint.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");
const originalLoad = Module._load;
const dialogs = [];   // what the chat asked (showWarningMessage) and what "you" answer: dialogs.answer
const vscode = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (_, d) => d }) },
  window: { showWarningMessage: async (text, opts, ...buttons) => { dialogs.push({ text, detail: opts && opts.detail, buttons }); return dialogs.answer; } },
  env: { appRoot: "/unused" }, commands: { executeCommand: () => {} }, Uri: { file: (f) => ({ scheme: "file", fsPath: f }) } };
Module._load = function (name, ...args) { return name === "vscode" ? vscode : originalLoad.call(this, name, ...args); };
const { ChatView } = require("../extension/lib/chat");
const { forkConversation } = require("../extension/lib/chat/fork");
const { Attachments } = require("../extension/lib/chat/attachments");
const { ChatArchive } = require("../extension/lib/chat/archive");
const brain = require("../extension/lib/ai");
brain.providerOf = (model) => ({ ready: () => true, label: model, id: brain.engineOf(model) });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-fork-test-"));
const image = path.join(tmp, "attached.png"), pdf = path.join(tmp, "attached.pdf"), code = path.join(tmp, "code.js");
fs.writeFileSync(image, "image bytes"); fs.writeFileSync(pdf, "pdf bytes"); fs.writeFileSync(code, "current code");
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const source = (model = "sonnet") => ({
  id: "original", sessionId: "original-session", title: "Work on the login", model, engine: brain.engineOf(model),
  effort: "high", effortPinned: true, mode: "ask", mood: "critic", team: 0, roles: ["tester"], teamStyle: "split",
  autoRoute: false, routingProfile: "cost", workspace: { key: tmp, name: "example", open: tmp },
  ticket: { key: "APP-1", summary: "Login" }, device: "test-device", status: "idle", started: true,
  allowAll: true, allowAllDevice: true, granted: ["/later/private"], tokens: { input: 900 }, context: { used: 1000 },
  setup: { servers: [] }, worktree: "/old/worktree", unread: true,
  messages: [
    { role: "user", segments: [{ t: "text", v: "Keep the API compatible" }], sentText: "Original file context: export const version = 1;",
      attachments: [{ kind: "image", name: "attached.png", path: image }, { kind: "pdf", name: "attached.pdf", path: pdf }] },
    { role: "assistant", running: false, blocks: [{ k: "text", text: "I checked the login" }], planReady: true,
      changes: [{ id: "original-change", file: code, rel: "code.js", state: "pending" }],
      journal: { tools: [{ id: "read", name: "Read", input: { file_path: code }, status: "complete", result: "original file contents" }] },
      routing: { model, source: "native" } },
    { role: "user", segments: [{ t: "text", v: "LATER MESSAGE MUST NOT LEAK" }], attachments: [{ path: "/later/private" }] },
    { role: "assistant", blocks: [{ k: "text", text: "LATER ANSWER MUST NOT LEAK" }] },
  ],
});
const copy = (s, index = 1) => forkConversation(s, index, { id: "fork", sessionId: "fork-session", now: 123 });
function fixture(tab) {
  const chat = Object.create(ChatView.prototype), sent = [], posted = [], opened = [];
  const pane = { kind: "side", activeId: tab.id };
  Object.assign(chat, { tabs: [tab], panes: [pane], runtime: new Map(), routingJobs: new Map(), localReady: new Map(),
    attachments: new Attachments(), here: tab.workspace, post: (m) => posted.push(m), postTo: (_, m) => posted.push(m),
    postTabs: () => {}, postHistory: () => {}, save: () => {}, warm: () => {}, isReady: () => true,
    teamSize: () => 0, teamLabel: () => null, endDevice: () => {}, prepareLocal: async () => ({ ok: true }),
    buildPrompt: async (text) => text, procKey: (t) => t.model, openSplit: (id) => opened.push(id), finishTurn: () => {},
    startProc: (t) => {
      const r = { proc: { send: (prompt) => sent.push(prompt), kill: () => {}, setModel: () => {} },
        procKey: t.model, agents: new Map(), perms: new Map(), tasks: new Map() };
      chat.runtime.set(t.id, r); return r;
    },
  });
  return { chat, pane, sent, posted, opened };
}

(async () => {
  await check("fork through an answer preserves context and choices, and leaves the original untouched", () => {
    const s = source(), before = JSON.stringify(s), f = copy(s);
    assert.strictEqual(f.messages.length, 2);
    for (const key of ["model", "effort", "mode", "mood", "roles", "routingProfile", "ticket", "device", "workspace"]) assert.deepStrictEqual(f[key], s[key]);
    assert.strictEqual(f.started, false); assert.strictEqual(f.allowAll, false); assert.strictEqual(f.status, "idle");
    for (const key of ["engine", "context", "tokens", "allowAllDevice", "setup", "worktree"]) assert.strictEqual(f[key], undefined);
    assert.deepStrictEqual(f.granted, [image, pdf]); assert.strictEqual(f.messages[1].inherited, true);
    for (const text of ["Keep the API compatible", "Original file context", "original file contents"]) assert.ok(f.carryOver.text.includes(text));
    assert.ok(!f.carryOver.text.includes("MUST NOT LEAK")); assert.strictEqual(f.messages[1].planReady, undefined);
    f.messages[0].segments[0].v = "Changed in fork"; f.roles.push("researcher"); f.ticket.summary = "New ticket";
    assert.strictEqual(JSON.stringify(s), before); assert.strictEqual(fs.readFileSync(code, "utf8"), "current code");
  });
  await check("a user-message boundary includes that message, but no answer or later history", () => {
    const f = copy(source(), 0);
    assert.strictEqual(f.messages.length, 1); assert.ok(f.carryOver.text.includes("Keep the API compatible"));
    assert.ok(!f.carryOver.text.includes("I checked the login"));
  });
  await check("invalid boundaries, running chats, and visiting chats cannot create a fork", () => {
    for (const index of [-1, 4, 1.5, "1", NaN, undefined]) assert.strictEqual(forkConversation(source(), index, { id: "fork", sessionId: "new" }), null);
    for (const status of ["running", "waiting"]) assert.strictEqual(copy({ ...source(), status }), null);
    assert.strictEqual(copy({ ...source(), visiting: true }), null);
  });
  await check("fork action opens a separate chat and keeps the source runtime and session", async () => {
    const s = source(), before = JSON.stringify(s), { chat, pane } = fixture(s);
    const runtime = { proc: { kill: () => assert.fail("fork killed the original") } }; chat.runtime.set(s.id, runtime);
    await chat.handle({ type: "fork", tabId: s.id, index: 1 }, pane);
    assert.strictEqual(chat.tabs.length, 2); assert.strictEqual(pane.activeId, chat.tabs[1].id);
    assert.notStrictEqual(chat.tabs[1].sessionId, s.sessionId); assert.strictEqual(chat.runtime.get(s.id), runtime);
    assert.strictEqual(JSON.stringify(s), before);
  });
  await check("forking a chat in an editor opens another editor without replacing the source", () => {
    const s = source(), { chat, pane, opened } = fixture(s); pane.kind = "editor"; pane.single = true;
    const f = chat.forkFrom(s, 1, pane);
    assert.strictEqual(pane.activeId, s.id); assert.deepStrictEqual(opened, [f.id]);
  });
  await check("a fork survives saving and reopening before its first message", () => {
    const archive = new ChatArchive(path.join(tmp, "archive")), s = source(), f = copy(s);
    archive.save(s, {}); archive.save(f, {});
    const reopened = new ChatArchive(archive.dir).read(f.id);
    assert.deepStrictEqual(reopened, f); assert.strictEqual(archive.read(s.id).messages.length, 4);
  });
  await check("every provider receives the selected history and earlier media on the first fork message", async () => {
    for (const model of ["sonnet", "codex:test", "agy:test", "ollama:test"]) {
      const s = source(model), before = JSON.stringify(s), f = copy(s), { chat, sent } = fixture(f);
      await chat.send(f, [{ t: "text", v: "Try another direction" }], []);
      assert.strictEqual(sent.length, 1); assert.ok(Array.isArray(sent[0]));
      const text = sent[0].find((b) => b.type === "text").text;
      for (const part of ["Keep the API compatible", "original file contents", "Original file context", "Try another direction"]) assert.ok(text.includes(part), model + ": " + part);
      assert.ok(!text.includes("MUST NOT LEAK"));
      assert.strictEqual(sent[0].find((b) => b.type === "image").source.data, Buffer.from("image bytes").toString("base64"));
      assert.strictEqual(sent[0].find((b) => b.type === "document").source.data, Buffer.from("pdf bytes").toString("base64"));
      assert.strictEqual(f.messages.at(-2).attachments, undefined); assert.ok(!f.messages.at(-2).sentText.includes("kural_handoff"));
      assert.strictEqual(JSON.stringify(s), before);
    }
  });
  await check("stopping before dispatch retains the fork context for the next attempt", async () => {
    const f = copy(source()), { chat, sent } = fixture(f); let built;
    chat.buildPrompt = () => new Promise((resolve) => { built = resolve; });
    const first = chat.send(f, [{ t: "text", v: "Cancelled attempt" }], []);
    chat.forceStop(f, chat.runtime.get(f.id)); built("Cancelled attempt"); await first;
    assert.strictEqual(sent.length, 0); assert.strictEqual(f.started, false); assert.ok(f.carryOver);
    chat.buildPrompt = async (text) => text;
    await chat.send(f, [{ t: "text", v: "Try again" }], []);
    assert.ok(sent[0][0].text.includes("Keep the API compatible"));
  });
  await check("inherited checkpoints cannot change files or train the router again", async () => {
    const f = copy(source()), { chat } = fixture(f), calls = [];
    chat.changes = { review: async (id) => calls.push(["review", id]), undo: async (id) => { calls.push(["undo", id]); return true; },
      keep: (id) => calls.push(["keep", id]), unchangedSince: () => true };
    for (const action of ["keep", "undo"]) await chat.onChangeAction(f, { msgIndex: 1, id: "original-change", action });
    await chat.onChangeAction(f, { msgIndex: 1, id: "original-change", action: "review" });
    assert.deepStrictEqual(calls, [["review", "original-change"]]); assert.strictEqual(chat.routedAnswer(f), null);
    assert.deepStrictEqual(chat.laterChanges(f, 0), []);
    f.messages.push({ role: "assistant", changes: [{ id: "own-change", file: code, rel: "code.js", state: "pending" }] });
    assert.deepStrictEqual((await chat.restoreCode(f, 0)).restored, ["code.js"]);
    assert.strictEqual(f.messages[1].changes[0].state, "pending"); assert.strictEqual(f.messages.at(-1).changes[0].state, "undone");
  });
  // Forking from an earlier message whose later answers changed files: like Edit, Kural asks whether the code goes back.
  const laterSource = () => {
    const s = source();
    s.messages[3] = { role: "assistant", blocks: [{ k: "text", text: "Changed it again" }], changes: [{ id: "later-change", file: code, rel: "code.js", state: "pending" }] };
    return s;
  };
  const tracker = (calls) => ({ undo: async (id) => { calls.push(["undo", id]); return true; }, unchangedSince: () => true, review: async () => {}, keep: () => {} });
  await check("fork with later file changes asks; Restore Code puts the code back and forks", async () => {
    const s = laterSource(), { chat, pane } = fixture(s), calls = []; chat.changes = tracker(calls); chat.redraw = () => {};
    dialogs.length = 0; dialogs.answer = "Restore Code";
    await chat.handle({ type: "fork", tabId: s.id, index: 1 }, pane);
    assert.strictEqual(dialogs.length, 1); assert.match(dialogs[0].text, /code back/); assert.deepStrictEqual(dialogs[0].buttons, ["Restore Code", "Keep Code"]);
    assert.match(dialogs[0].detail, /code\.js/);
    assert.deepStrictEqual(calls, [["undo", "later-change"]]); assert.strictEqual(s.messages[3].changes[0].state, "undone");
    assert.strictEqual(chat.tabs.length, 2); assert.strictEqual(chat.tabs[1].messages.length, 2);
  });
  await check("Keep Code forks and leaves the files; closing the dialog doesn't fork", async () => {
    for (const answer of ["Keep Code", undefined]) {
      const s = laterSource(), { chat, pane } = fixture(s), calls = []; chat.changes = tracker(calls);
      dialogs.length = 0; dialogs.answer = answer;
      await chat.handle({ type: "fork", tabId: s.id, index: 1 }, pane);
      assert.strictEqual(dialogs.length, 1); assert.deepStrictEqual(calls, []); assert.strictEqual(s.messages[3].changes[0].state, "pending");
      assert.strictEqual(chat.tabs.length, answer ? 2 : 1, String(answer));
    }
  });
  await check("no later changes (or only undone ones): forks without asking", async () => {
    const s = laterSource(); s.messages[3].changes[0].state = "undone";
    const { chat, pane } = fixture(s); chat.changes = tracker([]); dialogs.length = 0;
    await chat.handle({ type: "fork", tabId: s.id, index: 1 }, pane);
    assert.strictEqual(dialogs.length, 0); assert.strictEqual(chat.tabs.length, 2);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `fork: ${failed} FAILED` : "fork: ALL PASS"); process.exitCode = failed ? 1 : 0;
})();
