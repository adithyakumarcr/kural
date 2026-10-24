// Fix with Kural (lib/fix): the text it makes (core.js), what the chat does with it (addProblem, buildPrompt's quote
// sources) and the editor/terminal side with a stand-in vscode (code actions, failed commands, the status bar item).
const assert = require("assert");
const Module = require("module");
const load = Module._load;
const ran = [], posted = [], items = [], handlers = {}, commands = {};
const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
const messages = [];
let diagnostics = [], shown = [];
const vscode = {
  workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (k, d) => d, inspect: () => undefined }),
    onDidChangeConfiguration: () => ({ dispose() {} }), asRelativePath: (u) => String(u.fsPath).replace(/^\/proj\//, ""),
    openTextDocument: async () => ({ getText: () => "a\nb\nc\nd\ne\nf\ng\nh\ni\nj" }) },
  window: { activeTextEditor: undefined, activeTerminal: null, setStatusBarMessage: (m) => messages.push(m), showInformationMessage: (m) => messages.push(m),
    createStatusBarItem: () => { const i = { shown: false, show() { this.shown = true; shown.push("show"); }, hide() { this.shown = false; shown.push("hide"); } }; items.push(i); return i; },
    onDidStartTerminalShellExecution: (f) => { handlers.start = f; return { dispose() {} }; },
    onDidEndTerminalShellExecution: (f) => { handlers.end = f; return { dispose() {} }; },
    onDidCloseTerminal: (f) => { handlers.close = f; return { dispose() {} }; } },
  languages: { getDiagnostics: () => diagnostics, registerCodeActionsProvider: (sel, p) => { handlers.provider = p; handlers.selector = sel; return { dispose() {} }; } },
  commands: { executeCommand: async (...a) => { ran.push(a); }, registerCommand: (id, f) => { commands[id] = f; return { dispose() {} }; } },
  env: { appRoot: "/unused" }, Uri: { file: (f) => ({ scheme: "file", fsPath: f }), parse: (s) => ({ scheme: "file", fsPath: s }), joinPath: () => ({}) },
  ConfigurationTarget: { Global: 1 }, DiagnosticSeverity, StatusBarAlignment: { Left: 1 },
  CodeActionKind: { QuickFix: "quickfix" },
  CodeAction: class { constructor(title, kind) { this.title = title; this.kind = kind; } },
  EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const core = require("../extension/lib/fix/core");
const { ChatView } = require("../extension/lib/chat");
const { registerFix } = require("../extension/lib/fix");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const ESC = "\u001b";

(async () => {
  // ---------- core.js ----------
  await check("ANSI colors, cursor moves, titles and shell marks are removed; text and tabs stay", () => {
    const raw = `${ESC}[31mred${ESC}[0m ${ESC}[1;32mgreen${ESC}[0m\r\nname\tvalue${ESC}[2K${ESC}]633;D;1${ESC}\\${ESC}]0;title\u0007 done\r\n`;
    assert.strictEqual(core.stripAnsi(raw), "red green\nname\tvalue done\n");
    assert.strictEqual(core.stripAnsi(undefined), "");
  });
  await check("output keeps its last 8,000 characters and says that the start was left out", () => {
    const out = core.tail("x".repeat(5000) + "y".repeat(8000));
    assert.ok(out.endsWith("y".repeat(8000)));
    assert.ok(!out.includes("x"));
    assert.match(out, /^\[…first 5000 characters left out\]\n/);
    assert.strictEqual(core.tail("short"), "short");
    const text = core.terminalText({ command: "npm test", exitCode: 1, output: "a".repeat(20000), cwd: "/p" });
    assert.ok(text.includes("a".repeat(8000)) && !text.includes("a".repeat(8001)));
  });
  await check("the snippet is the problem's lines ±3 with line numbers, cut at the file's ends", () => {
    const lines = "l1 l2 l3 l4 l5 l6 l7 l8 l9 l10".split(" ");
    assert.strictEqual(core.snippetOf(lines, 5), "  2 | l2\n  3 | l3\n  4 | l4\n> 5 | l5\n  6 | l6\n  7 | l7\n  8 | l8");
    assert.strictEqual(core.snippetOf(lines, 1), "> 1 | l1\n  2 | l2\n  3 | l3\n  4 | l4");
    assert.strictEqual(core.snippetOf(lines, 10).split("\n").length, 4);
    assert.strictEqual(core.snippetOf(lines, 0), "");
    assert.strictEqual(core.snippetOf([], 3), "");
  });
  await check("problemText: severity, file, line, source and code, message, then the code", () => {
    const t = core.problemText({ file: "src/a.ts", line: 12, severity: "Error", message: "Cannot find name 'x'.", source: "ts", code: 2304, snippet: "> 12 | x()" });
    assert.strictEqual(t, "Error in src/a.ts, line 12 (ts 2304): Cannot find name 'x'.\n```\n> 12 | x()\n```");
    assert.strictEqual(core.problemText({ file: "b.js", severity: "Warning", message: "m" }), "Warning in b.js: m");
  });
  await check("terminalText: command, folder, exit code, output without escapes", () => {
    const t = core.terminalText({ command: "npm test ", exitCode: 2, output: `${ESC}[31mFAIL${ESC}[0m a.test.js\n`, cwd: "/proj" });
    assert.strictEqual(t, "$ npm test\n(in /proj)\nExit code: 2\nOutput:\n```\nFAIL a.test.js\n```");
    assert.strictEqual(core.terminalText({ command: "false", exitCode: 1, output: "" }), "$ false\nExit code: 1\n(no output)");
  });
  await check("several problems come in line order, each with its snippet, and at most 25", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `row${i + 1}`);
    const problems = Array.from({ length: 30 }, (_, i) => ({ line: 30 - i, severity: "Error", message: `m${30 - i}` }));
    const t = core.problemsText({ file: "f.js", lines, problems });
    assert.ok(t.indexOf("line 1: m1") >= 0 && t.indexOf("line 1: m1") < t.indexOf("line 2: m2"));
    assert.ok(t.includes("> 25 | row25") && !t.includes("line 26: m26"));
    assert.ok(t.endsWith("…and 5 more problems in f.js."));
  });

  // ---------- the chat ----------
  const chat = Object.create(ChatView.prototype);
  const pane = { id: "p" };
  Object.assign(chat, { reveal: async () => {}, cur: () => pane, postTo: (p, m) => posted.push([p, m]) });

  await check("buildPrompt introduces each source and quotes the text", async () => {
    const q = (source) => ({ kind: "quote", source, text: "line one\nline two", label: "x" });
    assert.strictEqual(await chat.buildPrompt("Fix this.", [q("problem")]), "<context>\nA problem in my code:\n> line one\n> line two\n</context>\n\nFix this.");
    assert.ok((await chat.buildPrompt("go", [q("terminal")])).includes("A command that failed in my terminal:\n> line one"));
    assert.ok((await chat.buildPrompt("go", [q("review")])).includes("A finding from Kural's review of my changes:\n> line one"));
    assert.ok((await chat.buildPrompt("go", [q(undefined)])).includes("Part of this chat I selected:"));
    assert.ok((await chat.buildPrompt("go", [q("lesson")])).includes("From the lesson page"));
  });
  await check("addProblem puts a pill and the first line in the box and sends nothing", async () => {
    posted.length = 0; chat.send = () => { throw new Error("must not send"); }; chat.onMessage = chat.send;
    await chat.addProblem({ label: "Fix: Cannot find name 'x' and a long rest of the message", text: "T", source: "problem", prompt: "Fix this." });
    assert.strictEqual(posted.length, 1);
    const [p, m] = posted[0];
    assert.strictEqual(p, pane);
    assert.strictEqual(m.type, "insertPill");
    assert.strictEqual(m.text, " Fix this.");
    assert.deepStrictEqual({ ...m.ctx, label: m.ctx.label.length <= 41 }, { kind: "quote", source: "problem", text: "T", label: true });
    posted.length = 0;
    await chat.addProblem({ label: "L", text: "T", source: "review" });
    assert.strictEqual(posted[0][1].text, "");
    await chat.addProblem({ label: "L", text: "  " });
    assert.strictEqual(posted.length, 1, "no text, no pill");
  });

  // ---------- the editor and the terminal ----------
  const logs = [];
  const added = [];
  const reg = registerFix({ subscriptions: [] }, { chat: { addProblem: async (x) => { added.push(x); } }, log: (m) => logs.push(m) });
  const doc = { uri: { scheme: "file", fsPath: "/proj/src/a.ts" } };
  const diag = (line, message, severity = DiagnosticSeverity.Error) => ({ range: { start: { line } }, message, severity, source: "ts", code: { value: 2304 } });

  await check("the light bulb offers Fix with Kural for an error and a warning, not for hints", () => {
    assert.deepStrictEqual(handlers.selector, [{ scheme: "file" }, { scheme: "untitled" }]);
    const d1 = diag(3, "Cannot find name 'x'."), hint = diag(4, "unused", DiagnosticSeverity.Hint);
    diagnostics = [d1];
    const one = handlers.provider.provideCodeActions(doc, {}, { diagnostics: [d1, hint] });
    assert.deepStrictEqual(one.map((a) => a.title), ["Fix with Kural"]);
    assert.strictEqual(one[0].kind, "quickfix");
    assert.strictEqual(one[0].command.command, "kural.fix.problem");
    assert.deepStrictEqual(handlers.provider.provideCodeActions(doc, {}, { diagnostics: [hint] }), []);
  });
  await check("two or more problems in the file add 'Fix all problems in this file with Kural'", () => {
    const d1 = diag(3, "first"), d2 = diag(7, "second", DiagnosticSeverity.Warning);
    diagnostics = [d1, d2];
    const acts = handlers.provider.provideCodeActions(doc, {}, { diagnostics: [d1] });
    assert.deepStrictEqual(acts.map((a) => a.title), ["Fix with Kural", "Fix all problems in this file with Kural"]);
    assert.strictEqual(acts[1].command.arguments[0].diagnostics.length, 2);
  });
  await check("kural.fix.problem adds the problem with its code and 'Fix this.'", async () => {
    added.length = 0;
    await commands["kural.fix.problem"]({ uri: doc.uri, diagnostics: [diag(4, "Cannot find name 'x'.")] });
    assert.strictEqual(added.length, 1);
    assert.strictEqual(added[0].source, "problem");
    assert.strictEqual(added[0].prompt, "Fix this.");
    assert.match(added[0].label, /^Fix: Cannot find name/);
    assert.ok(added[0].text.startsWith("Error in src/a.ts, line 5 (ts 2304): Cannot find name 'x'."));
    assert.ok(added[0].text.includes("> 5 | e") && added[0].text.includes("  2 | b") && added[0].text.includes("  8 | h") && !added[0].text.includes("| i"));
    await commands["kural.fix.problem"]({ uri: doc.uri, diagnostics: [diag(1, "a"), diag(8, "b")] });
    assert.strictEqual(added[1].label, "2 problems in a.ts");
  });
  await check("kural.chat.addContext hands the object to the chat (Agent Review's way in)", async () => {
    added.length = 0;
    await commands["kural.chat.addContext"]({ label: "Finding", text: "Null check missing", source: "review", prompt: "Fix this." });
    assert.deepStrictEqual(added, [{ label: "Finding", text: "Null check missing", source: "review", prompt: "Fix this." }]);
    await commands["kural.chat.addContext"]({ text: "" });
    assert.strictEqual(added.length, 1);
  });

  const term = { name: "zsh" };
  const run = async (command, exitCode, chunks, cwd = "/proj") => {
    const execution = { commandLine: { value: command }, cwd: cwd && { fsPath: cwd }, read: async function* () { for (const c of chunks) yield c; } };
    handlers.start({ terminal: term, execution });
    await new Promise((r) => setImmediate(r));
    await handlers.end({ terminal: term, execution, exitCode });
  };
  await check("a failed command shows the status bar button for 15 s; success shows nothing", async () => {
    const realSet = global.setTimeout; const timers = [];
    global.setTimeout = (f, ms) => { timers.push([f, ms]); return timers.length; };
    try {
      await run("ls", 0, ["ok\n"]);
      assert.strictEqual(items.length, 0);
      await run("npm test", 1, [`${ESC}[31mFAIL`, ` a.test.js\n`]);
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].text, "$(wand) Fix with Kural");
      assert.strictEqual(items[0].command, "kural.fix.terminal");
      assert.strictEqual(items[0].shown, true);
      const t = timers.find(([, ms]) => ms === 15000);
      assert.ok(t, "hides after 15 s");
      t[0]();
      assert.strictEqual(items[0].shown, false);
    } finally { global.setTimeout = realSet; }
  });
  await check("kural.fix.terminal sends the last failed command of the active terminal", async () => {
    added.length = 0;
    vscode.window.activeTerminal = term;
    await commands["kural.fix.terminal"]();
    assert.strictEqual(added.length, 1);
    assert.strictEqual(added[0].source, "terminal");
    assert.strictEqual(added[0].prompt, "Fix this.");
    assert.strictEqual(added[0].text, "$ npm test\n(in /proj)\nExit code: 1\nOutput:\n```\nFAIL a.test.js\n```");
  });
  await check("a later failure replaces the earlier one; the buffer is capped", async () => {
    await run("node big.js", 3, ["z".repeat(100000), "END\n"]);
    added.length = 0;
    await commands["kural.fix.terminal"]();
    assert.ok(added[0].text.startsWith("$ node big.js"));
    assert.ok(added[0].text.includes("zzzEND") && added[0].text.length < 8400);
  });
  await check("no failed command, or no terminal: it says so and adds nothing", async () => {
    added.length = 0; messages.length = 0;
    vscode.window.activeTerminal = { name: "other" };
    await commands["kural.fix.terminal"]();
    vscode.window.activeTerminal = null;
    await commands["kural.fix.terminal"]();
    assert.strictEqual(added.length, 0);
    assert.strictEqual(messages.length, 2);
  });
  await check("closing a terminal forgets its failed command", async () => {
    vscode.window.activeTerminal = term; added.length = 0;
    handlers.close(term);
    await commands["kural.fix.terminal"]();
    assert.strictEqual(added.length, 0);
  });

  if (failed) { console.error(`${failed} failed`); process.exit(1); }
  console.log("all passed");
})();
