// Ctrl+K's question box (lib/edit/inline-ask.js) is a comment thread under the selection. When its input takes the
// keyboard, VS Code reports that input as the active editor (VS Code's comment editor isn't a "simple widget", so the
// extension host lists it: a document with the "comment" scheme). The box closed on any other active editor, so it
// opened and closed again at once ("something opens for a split second"). Another file in front still closes it.
const assert = require("assert");
const Module = require("module");

let activeListener = null;
const threads = [];
const vscode = {
  comments: {
    createCommentController: () => ({
      options: null,
      dispose() {},
      createCommentThread(uri, range) {
        const t = { uri, range, disposed: false, dispose() { this.disposed = true; }, reveal: async () => {} };
        threads.push(t);
        return t;
      },
    }),
  },
  commands: { registerCommand: (id, fn) => ({ id, fn, dispose() {} }) },
  window: {
    onDidChangeActiveTextEditor: (fn) => { activeListener = fn; return { dispose() {} }; },
    showInputBox: async () => undefined,
    createOutputChannel: () => ({ appendLine() {} }),
  },
  Range: class { constructor(a, b, c, d) { Object.assign(this, { a, b, c, d }); } },
  CommentThreadCollapsibleState: { Expanded: 1 },
  CommentThreadFocus: { Reply: 1 },
};
const orig = Module._load;
Module._load = function (req, ...a) { return req === "vscode" ? vscode : orig.call(this, req, ...a); };
const { InlineAsk, isCommentInput } = require("../extension/lib/edit/inline-ask");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.message); } };
const editor = (uri, scheme = "file") => ({ document: { uri: { scheme, toString: () => uri } } });
const tick = () => new Promise((r) => setImmediate(r));
const state = (p) => Promise.race([p.then((v) => ({ done: true, v })), tick().then(() => ({ done: false }))]);

(async () => {
  const context = { subscriptions: [] };
  const ask = new InlineAsk(context);
  const file = editor("file:///p/install.py");

  await check("the box's own input becoming the active editor doesn't close it", async () => {
    const p = ask.ask(file, 49, { generating: false });
    activeListener(editor("comment://kural.inlineEdit/1", "comment"));
    assert.strictEqual((await state(p)).done, false, "the question was given up");
    assert.strictEqual(threads[threads.length - 1].disposed, false, "the box was closed");
    ask.answer({ thread: threads[threads.length - 1], text: "  add a docstring " }, true);
    assert.deepStrictEqual(await state(p), { done: true, v: "add a docstring" });
  });

  await check("the same file in front again keeps it; another file closes it", async () => {
    const p = ask.ask(file, 10, { generating: true });
    activeListener(editor("file:///p/install.py"));
    assert.strictEqual((await state(p)).done, false);
    activeListener(editor("file:///p/other.py"));
    assert.deepStrictEqual(await state(p), { done: true, v: undefined });
    assert.strictEqual(threads[threads.length - 1].disposed, true);
  });

  await check("no editor at all (the last one closed) closes it", async () => {
    const p = ask.ask(file, 3, { generating: true });
    activeListener(undefined);
    assert.deepStrictEqual(await state(p), { done: true, v: undefined });
  });

  await check("isCommentInput: only a comment box's input", () => {
    assert.strictEqual(isCommentInput(editor("comment://x", "comment")), true);
    for (const e of [editor("file:///a"), editor("untitled:1", "untitled"), undefined, null]) assert.strictEqual(isCommentInput(e), false);
  });

  await check("the chat keeps the file, not a box's input, as where Insert/Apply go", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "../extension/lib/chat/index.js"), "utf8");
    assert.ok(/onDidChangeActiveTextEditor\(\(ed\) => \{ if \(ed && !isCommentInput\(ed\)\) this\.lastEditor = ed; \}\)/.test(src));
  });

  console.log(failed ? `inline-ask: ${failed} FAILED` : "inline-ask: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
