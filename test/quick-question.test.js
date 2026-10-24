// Ctrl+K's box, like Cursor's (lib/edit/inline-ask.js, lib/edit/quick-question.js): besides Edit (Enter) it has Quick
// Question (Alt+Enter: answered right in the box, which stays open for the next question or an edit) and Send to Chat
// (Ctrl/Cmd+L: the code and your words go into the chat's message box, the box closes). A key passes no text, so it goes
// through VS Code's own submit (which hands the first button, Edit, the text) and Edit then does what the key asked for.
const assert = require("assert");
const Module = require("module");

const handlers = {};
const threads = [];
let submitted = null;   // what VS Code's own submit would hand the first button
const ran = [];         // commands Kural ran
class CancellationTokenSource {
  constructor() { this.token = { isCancellationRequested: false }; }
  cancel() { this.token.isCancellationRequested = true; }
}
class MarkdownString {
  constructor(value = "", icons = false) { this.value = value; this.supportThemeIcons = icons; }
  appendText(t) { this.value += t; this.plain = true; return this; }
}
const vscode = {
  comments: {
    createCommentController: () => ({
      options: null, dispose() {},
      createCommentThread(uri, range) {
        const t = { uri, range, comments: [], disposed: false, reveals: 0, dispose() { this.disposed = true; }, reveal: async () => { t.reveals++; } };
        threads.push(t);
        return t;
      },
    }),
  },
  commands: {
    registerCommand: (id, fn) => { handlers[id] = fn; return { dispose() {} }; },
    // (Like VS Code: its submit returns at once, and the first button's command comes to Kural a moment later.)
    executeCommand: async (id) => { ran.push(id); if (id === "editor.action.submitComment" && submitted) { const r = submitted(); setTimeout(() => handlers["kural.inlineEdit.submit"](r), 5); } },
  },
  window: { onDidChangeActiveTextEditor: () => ({ dispose() {} }), showInputBox: async () => undefined, createOutputChannel: () => ({ appendLine() {} }) },
  Range: class { constructor(a, b, c, d) { Object.assign(this, { a, b, c, d }); } },
  CancellationTokenSource, MarkdownString,
  CommentMode: { Preview: 1 },
  CommentThreadCollapsibleState: { Expanded: 1 },
  CommentThreadFocus: { Reply: 1 },
};
const orig = Module._load;
Module._load = function (req, ...a) { return req === "vscode" ? vscode : orig.call(this, req, ...a); };
const { InlineAsk } = require("../extension/lib/edit/inline-ask");
const quick = require("../extension/lib/edit/quick-question");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.message); } };
const editor = { document: { uri: { scheme: "file", toString: () => "file:///p/flow.py" } } };
const tick = () => new Promise((r) => setImmediate(r));
const state = (p) => Promise.race([p.then((v) => ({ done: true, v })), tick().then(() => ({ done: false }))]);
const later = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };
const shown = (t) => t.comments.map((c) => `${c.author.name}: ${c.body.value}`);

(async () => {
  const ask = new InlineAsk({ subscriptions: [] });

  await check("Quick Question (its button): shown at once, answered in the box, which stays open; Edit afterwards still edits", async () => {
    const calls = [], answers = [later(), later()], talk = [];
    const p = ask.ask(editor, 12, { generating: false, talk, question: (text, earlier, token) => { calls.push({ text, earlier: earlier.slice(), token }); return answers[calls.length - 1].p; } });
    const t = threads[threads.length - 1];
    handlers["kural.inlineEdit.question"]({ thread: t, text: "  why a while loop? " });
    await tick();
    assert.deepStrictEqual(calls.map((c) => [c.text, c.earlier]), [["why a while loop?", []]]);
    assert.deepStrictEqual(shown(t), ["You: why a while loop?", "Kural: $(loading~spin) Thinking…"]);
    assert.strictEqual(t.comments[0].body.plain, true, "your words are shown as text, not Markdown");
    answers[0].resolve("  It waits for the **sensor**. ");
    await tick();
    assert.deepStrictEqual(shown(t), ["You: why a while loop?", "Kural: It waits for the **sensor**."]);
    assert.strictEqual(t.comments[1].body.isTrusted, false);
    assert.strictEqual((await state(p)).done, false, "the box closed after a question");
    assert.strictEqual(t.disposed, false);

    handlers["kural.inlineEdit.question"]({ thread: t, text: "and the timeout?" });
    await tick();
    assert.deepStrictEqual(calls[1].earlier, [{ q: "why a while loop?", a: "It waits for the **sensor**." }], "the next question knows the first");
    answers[1].resolve("30 s.");
    await tick();
    assert.strictEqual(t.comments.length, 4);
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(t.reveals >= 2, "the input came back for the next question");

    handlers["kural.inlineEdit.submit"]({ thread: t, text: "do what you suggested" });
    assert.deepStrictEqual(await state(p), { done: true, v: "do what you suggested" });
    assert.strictEqual(t.disposed, true);
    assert.deepStrictEqual(talk, [{ q: "why a while loop?", a: "It waits for the **sensor**." }, { q: "and the timeout?", a: "30 s." }]);
  });

  await check("Alt+Enter (no text from a key): through VS Code's submit, the first button asks the question", async () => {
    const asked = [];
    const p = ask.ask(editor, 3, { generating: false, question: async (text) => { asked.push(text); return "Yes."; } });
    const t = threads[threads.length - 1];
    submitted = () => ({ thread: t, text: "is this thread-safe?" });
    await handlers["kural.inlineEdit.question"]();
    submitted = null;
    await new Promise((r) => setTimeout(r, 30));
    assert.deepStrictEqual(asked, ["is this thread-safe?"]);
    assert.strictEqual(ask.nextMode, null, "the next Enter edits again");
    assert.strictEqual((await state(p)).done, false);
    handlers["kural.inlineEdit.cancel"]();
    assert.deepStrictEqual(await state(p), { done: true, v: undefined });
  });

  await check("Send to Chat (button, or Ctrl/Cmd+L): your words go to the chat, the box closes, nothing is edited", async () => {
    const sent = [];
    let p = ask.ask(editor, 7, { generating: false, toChat: (text) => sent.push(text) });
    handlers["kural.inlineEdit.toChat"]({ thread: threads[threads.length - 1], text: " explain this " });
    assert.deepStrictEqual(await state(p), { done: true, v: undefined });
    assert.strictEqual(threads[threads.length - 1].disposed, true);
    p = ask.ask(editor, 7, { generating: false, toChat: (text) => sent.push(text) });
    const t = threads[threads.length - 1];
    submitted = () => ({ thread: t, text: "" });
    await handlers["kural.inlineEdit.toChat"]();
    submitted = null;
    await new Promise((r) => setTimeout(r, 30));
    assert.deepStrictEqual(await state(p), { done: true, v: undefined });
    assert.deepStrictEqual(sent, ["explain this", ""], "nothing typed: just the code, like Ctrl+L");
  });

  await check("Esc while a question is answered: stopped, and a late answer isn't drawn", async () => {
    const a = later(); let token;
    const p = ask.ask(editor, 1, { generating: false, question: (text, e, tk) => { token = tk; return a.p; } });
    const t = threads[threads.length - 1];
    handlers["kural.inlineEdit.question"]({ thread: t, text: "what does it return?" });
    await tick();
    handlers["kural.inlineEdit.cancel"]();
    assert.deepStrictEqual(await state(p), { done: true, v: undefined });
    assert.strictEqual(token.isCancellationRequested, true);
    const before = shown(t);
    a.resolve("late");
    await tick();
    assert.deepStrictEqual(shown(t), before);
  });

  await check("no answer, or an error: said in the box, which stays open; an empty question asks nothing", async () => {
    let n = 0;
    const p = ask.ask(editor, 1, { generating: false, question: async () => { n++; if (n === 1) return null; throw new Error("Claude isn't logged in"); } });
    const t = threads[threads.length - 1];
    handlers["kural.inlineEdit.question"]({ thread: t, text: "   " });
    await tick();
    assert.strictEqual(n, 0);
    handlers["kural.inlineEdit.question"]({ thread: t, text: "one" });
    await tick(); await tick();
    assert.match(t.comments[1].body.value, /^\$\(warning\) No answer came back/);
    handlers["kural.inlineEdit.question"]({ thread: t, text: "two" });
    await tick(); await tick();
    assert.strictEqual(t.comments[3].body.value, "$(warning) Claude isn't logged in");
    assert.strictEqual((await state(p)).done, false);
    handlers["kural.inlineEdit.cancel"]();
    await p;
  });

  await check("buildPrompt: the file, the code around, the selection, earlier answered questions only, the question", () => {
    const s = quick.buildPrompt({ file: "src/flow.py", lang: "python", region: "while not ready():\n    sleep(1)", before: "import time",
      after: "print('go')", talk: [{ q: "q1", a: "a1" }, { q: "q2" }], question: "why a loop?" });
    for (const part of ["File: src/flow.py (python)", "<before>\nimport time\n</before>", "The code the user selected:\nwhile not ready():",
      "<after>\nprint('go')\n</after>", "Question: q1\nAnswer: a1", "Question about the selection:\nwhy a loop?"]) assert.ok(s.includes(part), part);
    assert.ok(!s.includes("q2"), "an unanswered question isn't sent");
    const none = quick.buildPrompt({ file: "a.js", region: "x()", selected: false, question: "what is x?" });
    assert.ok(none.includes("Nothing is selected; the line the user is on:\nx()") && !none.includes("<earlier>"));
  });

  await check("talkNote: what the edit is told about the box's questions (nothing when none); tidy", () => {
    assert.strictEqual(quick.talkNote([]), "");
    assert.strictEqual(quick.talkNote([{ q: "q" }]), "");
    assert.match(quick.talkNote([{ q: "why?", a: "because" }]), /^Before this instruction the user asked about this code[^\n]*\nQuestion: why\?\nAnswer: because\n\n$/);
    assert.strictEqual(quick.tidy("  <answer>Hi</answer> "), "Hi");
    assert.strictEqual(quick.tidy("   "), null);
    assert.strictEqual(quick.tidy(null), null);
  });

  await check("the box closed by Esc, Cancel or Edit gives the keyboard back to the code; Send to Chat and another box don't", async () => {
    const focus = () => ran.filter((id) => id === "workbench.action.focusActiveEditorGroup").length;
    // (Before: the keyboard stayed nowhere, so the next Ctrl/Cmd+K began one of VS Code's two-key shortcuts.)
    let n = focus(), p = ask.ask(editor, 1, { generating: false });
    handlers["kural.inlineEdit.cancel"]();
    await p; await tick();
    assert.strictEqual(focus(), n + 1, "Esc");
    n = focus(); p = ask.ask(editor, 1, { generating: false });
    handlers["kural.inlineEdit.submit"]({ thread: threads[threads.length - 1], text: "add a docstring" });
    await p; await tick();
    assert.strictEqual(focus(), n + 1, "Edit");
    n = focus(); p = ask.ask(editor, 1, { generating: false, toChat: () => {} });
    handlers["kural.inlineEdit.toChat"]({ thread: threads[threads.length - 1], text: "x" });
    await p; await tick();
    assert.strictEqual(focus(), n, "Send to Chat: the chat takes it");
    n = focus(); p = ask.ask(editor, 1, { generating: false });
    const second = ask.ask(editor, 2, { generating: false });
    await p; await tick();
    assert.strictEqual(focus(), n, "a second Ctrl+K: the new box takes it");
    handlers["kural.inlineEdit.cancel"](); await second;
  });

  await check("a quick question doesn't throw VS Code's Comments panel open (Kural's default)", () => {
    const pkg = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "../extension/package.json"), "utf8"));
    assert.strictEqual(pkg.contributes.configurationDefaults["comments.openView"], "never");
  });

  console.log(failed ? `quick-question: ${failed} FAILED` : "quick-question: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
