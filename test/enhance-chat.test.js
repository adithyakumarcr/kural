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
  await check("the reply goes only to the pane that asked, tagged with its chat and request", async () => {
    const chat = makeChat((o, finish) => { o.onStatus("Reading"); finish({ ok: true, prompt: "P", label: "L", calls: 1, ms: 1000 }); });
    const asker = { id: "a" }, other = { id: "b" }, sent = [];
    Object.assign(chat, { panes: [asker, other], pane: asker, postTo: (p, m) => sent.push([p.id, m]) });
    await chat.enhance(tab(), { requestId: "r9", segments: [{ t: "text", v: "x" }] });
    assert.ok(sent.length >= 2 && sent.every(([p, m]) => p === "a" && m.tabId === "t1" && m.id === "r9" && m.type === "enhanceState"));
    assert.strictEqual(chat.posted.length, 0, "nothing goes to every pane");
  });
  await check("two chats can enhance at once; each result carries its own chat id", async () => {
    const chat = makeChat((o, finish) => { o.onStatus(o.text); setImmediate(() => finish({ ok: true, prompt: `P:${o.text}`, label: "L", calls: 1, ms: 1000 })); });
    await Promise.all([chat.enhance({ ...tab(), id: "t1" }, { requestId: "x1", segments: [{ t: "text", v: "one" }] }),
      chat.enhance({ ...tab(), id: "t2" }, { requestId: "x2", segments: [{ t: "text", v: "two" }] })]);
    const done = chat.posted.filter((m) => m.state === "done");
    assert.deepStrictEqual(done.map((m) => [m.tabId, m.id, m.prompt]).sort(), [["t1", "x1", "P:one"], ["t2", "x2", "P:two"]]);
  });

  // The page (media/chat.js): the result belongs to the chat that asked, not to the one on screen. The functions are cut out of the source.
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "extension", "media", "chat.js"), "utf8");
  const code = src.slice(src.indexOf("  function enhanceTab("), src.indexOf("  function renderEnhance()"));
  const page = () => {
    const log = { put: [], locked: false, renders: 0 };
    const S = { tab: { id: "t1" }, enh: null };
    const input = { setAttribute: (k, v) => { log.locked = v === "false"; }, classList: { add() {}, remove() {} } };
    const api = new Function("S", "input", "unlockInput", "putPrompt", "renderEnhance", `${code}; return { enhanceTab, onEnhanceState };`)(
      S, input, () => { log.locked = false; }, (t) => log.put.push(t), () => { log.renders++; });
    return { S, log, ...api };
  };
  await check("page: a result for a chat that isn't on screen never goes into the box; it waits for that chat", () => {
    const p = page();
    p.S.enh = { tabId: "t1", id: "r1", state: "running", before: ["orig"] };
    p.S.tab = { id: "t2" }; p.enhanceTab("t2");                   // you opened another chat while it loads
    assert.strictEqual(p.S.enh, null); assert.strictEqual(p.log.locked, false, "the other chat's box is not locked");
    p.onEnhanceState({ tabId: "t1", id: "r1", state: "done", prompt: "BETTER", label: "L", calls: 2, ms: 3000 });
    assert.deepStrictEqual(p.log.put, [], "the other chat's box got the text");
    p.S.tab = { id: "t1" }; p.enhanceTab("t1");                   // back
    assert.deepStrictEqual(p.log.put, ["BETTER"]);
    assert.strictEqual(p.S.enh.state, "done"); assert.deepStrictEqual(p.S.enh.before, ["orig"], "Undo still has that chat's own text");
  });
  await check("page: progress of the other chat is kept, the one on screen is not touched; back on screen it is locked again", () => {
    const p = page();
    p.S.enh = { tabId: "t1", id: "r1", state: "running", status: "Starting", before: [] };
    p.enhanceTab("t2");
    const renders = p.log.renders;
    p.onEnhanceState({ tabId: "t1", id: "r1", state: "running", status: "Reading a.js" });
    assert.strictEqual(p.log.renders, renders);
    p.enhanceTab("t1");
    assert.strictEqual(p.S.enh.status, "Reading a.js"); assert.strictEqual(p.log.locked, true);
  });
  await check("page: on the chat that asked, the result goes straight into the box", () => {
    const p = page();
    p.S.enh = { tabId: "t1", id: "r1", state: "running", before: [] };
    p.onEnhanceState({ tabId: "t1", id: "r1", state: "done", prompt: "NOW" });
    assert.deepStrictEqual(p.log.put, ["NOW"]);
  });
  await check("page: a reply with another request's id is ignored", () => {
    const p = page();
    p.S.enh = { tabId: "t1", id: "r1", state: "running", before: [] };
    p.onEnhanceState({ tabId: "t1", id: "old", state: "done", prompt: "NO" });
    assert.deepStrictEqual(p.log.put, []);
  });
  console.log(failed ? `enhance-chat: ${failed} FAILED` : "enhance-chat: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
