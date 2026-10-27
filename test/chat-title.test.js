// A new chat's title: first words at once, then a short summary from the quickest model (lib/chat/title.js, ChatView.summarizeTitle).
const assert = require("assert");
const path = require("path"), Module = require("module");
const vscode = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (k, d) => d, inspect: () => ({}) }) },
  window: { state: { focused: true } }, env: { appRoot: "/unused" }, commands: { executeCommand: async () => {} },
  Uri: { file: (f) => ({ scheme: "file", fsPath: f }) }, EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
const load = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const { Titler, cleanTitle } = require("../extension/lib/chat/title");
const { ChatView } = require("../extension/lib/chat");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

// A stand-in agent: `behave(handlers, proc)` runs when the prompt is sent.
function deps(behave, extra = {}) {
  const made = [];
  return { made, model: () => "haiku", check: () => ({ ok: true }), isClaude: () => true, emptyDir: () => "/tmp/x", cwd: () => "/tmp", timeoutMs: 80,
    makeAgent: (model, opts, local, h) => {
      const proc = { opts, model, killed: false, sent: [], start: () => true, kill() { this.killed = true; }, send(t) { this.sent.push(t); behave(h, proc); } };
      made.push(proc); return proc;
    }, ...extra };
}
const result = (text) => (h) => setImmediate(() => h.onMessage({ type: "result", result: text }));

const keepAlive = setInterval(() => {}, 1000);   // (the helper's timeout timer is unref'd, like Side chat's)
(async () => {
  await check("cleanTitle: one line, no quotes or markdown, at most 6 words", () => {
    assert.strictEqual(cleanTitle('"Fix the login redirect bug."'), "Fix the login redirect bug");
    assert.strictEqual(cleanTitle("Title: **Add dark mode** \nBecause you asked"), "Add dark mode");
    assert.strictEqual(cleanTitle("one two three four five six seven eight"), "one two three four five six");
    assert.strictEqual(cleanTitle("   \n  "), "");
    assert.strictEqual(cleanTitle(null), "");
  });
  await check("the quickest model, no tools, low effort, safe mode; the first message is in the prompt", async () => {
    const d = deps(result("Fix login redirect"));
    const t = await new Titler(d).ask("c1", "please fix the redirect after login");
    assert.strictEqual(t, "Fix login redirect");
    const o = d.made[0].opts;
    assert.deepStrictEqual([o.effort, o.noThinking, o.safeMode, o.tools, o.allowedTools], ["low", true, true, [], []]);
    assert.ok(d.made[0].sent[0].includes("please fix the redirect after login"));
    assert.ok(d.made[0].killed, "the helper is stopped after the answer");
  });
  await check("a refused permission, an error result, no answer, a timeout, a crash: null", async () => {
    assert.strictEqual(await new Titler(deps((h) => setImmediate(() => h.onMessage({ type: "result", is_error: true, result: "boom" })))).ask("c", "x"), null);
    assert.strictEqual(await new Titler(deps(result(""))).ask("c", "x"), null);
    assert.strictEqual(await new Titler(deps(() => {})).ask("c", "x"), null, "timeout");
    assert.strictEqual(await new Titler(deps((h) => setImmediate(() => h.onExit({})))).ask("c", "x"), null);
    assert.strictEqual(await new Titler(deps(() => { throw new Error("x"); })).ask("c", "x"), null);
    const d = deps(() => {}); d.makeAgent = () => { throw new Error("no program"); };
    assert.strictEqual(await new Titler(d).ask("c", "x"), null);
  });
  await check("no AI set up: nothing is started", async () => {
    const d = deps(result("T"), { check: () => ({ ok: false, why: "no" }) });
    assert.strictEqual(await new Titler(d).ask("c", "x"), null); assert.strictEqual(d.made.length, 0);
    const e = deps(result("T"), { model: () => null });
    assert.strictEqual(await new Titler(e).ask("c", "x"), null); assert.strictEqual(e.made.length, 0);
  });

  const makeChat = (titler, tabs) => {
    const chat = Object.create(ChatView.prototype);
    Object.assign(chat, { titler, tabs, calls: [], postTabs() { this.calls.push("tabs"); }, save() { this.calls.push("save"); } });
    return chat;
  };
  const newTab = (title) => ({ id: "t1", title, renamed: false, status: "running", messages: [{ role: "user" }] });
  const later = () => new Promise((r) => setTimeout(r, 20));

  await check("the summary replaces the first words; status and conversation are untouched", async () => {
    const tab = newTab("please fix the redirect"), chat = makeChat(new Titler(deps(result("Fix login redirect"))), [tab]);
    chat.summarizeTitle(tab, "please fix the redirect after login");
    assert.strictEqual(tab.title, "please fix the redirect", "the first words stay until the answer");
    await later();
    assert.strictEqual(tab.title, "Fix login redirect"); assert.strictEqual(tab.status, "running"); assert.strictEqual(tab.messages.length, 1);
    assert.deepStrictEqual(chat.calls, ["tabs", "save"]);
  });
  await check("renamed meanwhile, title changed meanwhile, or chat closed: the summary is dropped", async () => {
    for (const mutate of [(t) => { t.title = "My name"; t.renamed = true; }, (t) => { t.title = "Other"; }, null]) {
      const tab = newTab("first words"), chat = makeChat(new Titler(deps(result("Summary"))), [tab]);
      chat.summarizeTitle(tab, "first words and more");
      if (mutate) mutate(tab); else chat.tabs = [];
      const before = tab.title;
      await later();
      assert.strictEqual(tab.title, before); assert.deepStrictEqual(chat.calls, []);
    }
  });
  await check("a failure keeps the first words", async () => {
    const tab = newTab("first words"), chat = makeChat(new Titler(deps(() => {})), [tab]);
    chat.summarizeTitle(tab, "first words"); await later(); await later();
    assert.strictEqual(tab.title, "first words"); assert.deepStrictEqual(chat.calls, []);
  });
  console.log(failed ? `chat-title: ${failed} FAILED` : "chat-title: ALL PASS");
  clearInterval(keepAlive);
  process.exit(failed ? 1 : 0);
})();
