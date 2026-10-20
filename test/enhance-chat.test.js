// Enhance prompt in the chat backend (lib/chat/index.js enhance/stopEnhance): the page hears what it's doing, then the
// prompt or what went wrong, with the request's id; one run per chat; closing the chat stops it.
const assert = require("assert");
const path = require("path"), Module = require("module");

const vscode = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (k, d) => d, inspect: () => ({}) }) },
  window: { state: { focused: true } }, env: { appRoot: "/unused" }, commands: { executeCommand: async () => {} },
  Uri: { file: (f) => ({ scheme: "file", fsPath: f }) }, EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
const load = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const { ChatView } = require("../extension/lib/chat");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const root = path.join(__dirname, "fixtures", "enhance-repo");

function makeChat(behave) {
  const posted = [], runs = [];
  const chat = Object.create(ChatView.prototype);
  Object.assign(chat, { posted, runs, enhancing: new Map(), post: (m) => posted.push(m), root: () => root,
    enhancer: { run: (o) => {
      let finish; const done = new Promise((r) => { finish = r; });
      const run = { o, stopped: false, stop() { this.stopped = true; finish({ error: "Stopped.", kind: "stopped", label: "Sonnet 5.5" }); }, done };
      runs.push(run); behave(o, finish);
      return run;
    } } });
  return chat;
}
const tab = () => ({ id: "t1", model: "opus", messages: [], status: "idle" });

(async () => {
  await check("what it's doing, then the prompt, each with the request's id; the text sent is what you typed (mentions as @path)", async () => {
    const chat = makeChat((o, finish) => { o.onStatus("Sonnet 5.5: Reading src/api/client.ts"); finish({ ok: true, prompt: "Better.", label: "Sonnet 5.5", calls: 3, ms: 9000, dropped: [] }); });
    await chat.enhance(tab(), { requestId: "r1", segments: [{ t: "text", v: "fix " }, { t: "pill", ctx: { kind: "file", path: "src/api/client.ts" } }] });
    assert.strictEqual(chat.runs[0].o.text, "fix @src/api/client.ts");
    assert.strictEqual(chat.runs[0].o.chatEngine, "claude");
    assert.deepStrictEqual(chat.posted, [
      { type: "enhanceState", tabId: "t1", id: "r1", state: "running", status: "Sonnet 5.5: Reading src/api/client.ts" },
      { type: "enhanceState", tabId: "t1", id: "r1", state: "done", prompt: "Better.", label: "Sonnet 5.5", calls: 3, ms: 9000, dropped: [], flagged: [] }]);
    assert.strictEqual(chat.enhancing.size, 0);
  });
  await check("an error comes back as its kind and words", async () => {
    const chat = makeChat((o, finish) => finish({ error: "Limit reached", kind: "rate", label: "Sonnet 5.5" }));
    await chat.enhance(tab(), { requestId: "r2", segments: [{ t: "text", v: "x" }] });
    assert.deepStrictEqual(chat.posted.pop(), { type: "enhanceState", tabId: "t1", id: "r2", state: "error", kind: "rate", message: "Limit reached", label: "Sonnet 5.5" });
  });
  await check("one at a time per chat; Stop (and closing the chat) stops it", async () => {
    const chat = makeChat(() => {});
    const t = tab();
    const first = chat.enhance(t, { requestId: "a", segments: [{ t: "text", v: "x" }] });
    await chat.enhance(t, { requestId: "b", segments: [{ t: "text", v: "y" }] });
    assert.strictEqual(chat.runs.length, 1);
    chat.stopEnhance("t1");
    await first;
    assert.ok(chat.runs[0].stopped);
    assert.strictEqual(chat.posted.pop().kind, "stopped");
  });
  await check("an untrusted folder: refused before anything starts", async () => {
    const chat = makeChat(() => {});
    vscode.workspace.isTrusted = false;
    await chat.enhance(tab(), { requestId: "c", segments: [{ t: "text", v: "x" }] });
    vscode.workspace.isTrusted = true;
    assert.strictEqual(chat.runs.length, 0); assert.strictEqual(chat.posted[0].state, "error");
  });
  console.log(failed ? `enhance-chat: ${failed} FAILED` : "enhance-chat: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
