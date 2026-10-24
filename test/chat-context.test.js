// Text you select in the chat ("Add to chat") goes to the AI as a quote; Ctrl+L shows or hides the chat; the chat's
// title bar has no log button; "Add your own mood…" uses the chat's font.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const load = Module._load;
const ran = [];
const vscode = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (k, d) => d, inspect: () => undefined }),
  onDidChangeConfiguration: () => ({ dispose() {} }) },
  window: { activeTextEditor: undefined }, env: { appRoot: "/unused" }, commands: { executeCommand: async (...a) => { ran.push(a); } },
  Uri: { file: (f) => ({ scheme: "file", fsPath: f }), joinPath: () => ({}) }, ConfigurationTarget: { Global: 1 },
  EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const { ChatView } = require("../extension/lib/chat");
const { segmentsText } = require("../extension/lib/router/journal");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const root = path.join(__dirname, "..", "extension");

(async () => {
  const chat = Object.create(ChatView.prototype);
  const quote = { kind: "quote", text: "Scoop: we can list Kural ourselves today.\nIt's the easiest way.", label: "Scoop: we can list Kural ourselves today…" };

  await check("a quote goes to the AI as quoted lines, with the message", async () => {
    const prompt = await chat.buildPrompt("Why is it the easiest?", [quote]);
    assert.strictEqual(prompt, "<context>\nPart of this chat I selected:\n> Scoop: we can list Kural ourselves today.\n> It's the easiest way.\n</context>\n\nWhy is it the easiest?");
  });
  await check("two different quotes are both sent; the same one twice once", async () => {
    const other = { ...quote, text: "winget: the best for users." };
    const two = await chat.buildPrompt("compare", [quote, other, quote]);
    assert.strictEqual(two.match(/Part of this chat I selected/g).length, 2);
  });
  await check("a quote reads as its first words in the message text, the tab title and a handoff", () => {
    const segs = [{ t: "pill", ctx: quote }, { t: "text", v: " why?" }];
    assert.strictEqual(ChatView.textOf(segs), "\"Scoop: we can list Kural ourselves today…\" why?");
    assert.strictEqual(ChatView.titleOf(segs), "\"Scoop: we can list Kural ourselves toda", "(a title is 40 characters)");
    assert.strictEqual(segmentsText(segs), "\"Scoop: we can list Kural ourselves today…\" why?");
  });
  await check("Auto counts a quote's size like attached text", () => {
    assert.deepStrictEqual(ChatView.routingContext([quote]), { files: 0, chars: quote.text.length, elements: 0 });
  });
  await check("the page keeps a quote short and doesn't open anything for it", () => {
    const page = fs.readFileSync(path.join(root, "media", "chat.js"), "utf8");
    assert.match(page, /const MAX_QUOTE = 8000;/);
    assert.match(page, /onclick: !openable \|\| quote \? null/);
    assert.match(page, /insertPill\(\{ kind: "quote", text, label/);
  });

  // Ctrl+L: a switch.
  const side = { kind: "side", view: { visible: true } };
  Object.assign(chat, { panes: [side], chatFocused: false, opened: 0, open() { this.opened++; } });
  const hide = () => ran.filter((a) => a[0] === "workbench.action.closeAuxiliaryBar").length;
  const editor = (empty) => ({ selection: { isEmpty: empty } });
  await check("Ctrl+L with the chat on screen hides it", async () => {
    ran.length = 0; vscode.window.activeTextEditor = editor(true);
    await chat.toggle();
    assert.strictEqual(hide(), 1); assert.strictEqual(chat.opened, 0);
  });
  await check("Ctrl+L with the chat hidden opens it", async () => {
    ran.length = 0; side.view.visible = false;
    await chat.toggle();
    assert.strictEqual(hide(), 0); assert.strictEqual(chat.opened, 1);
  });
  await check("Ctrl+L with code selected in the editor adds it, also while the chat is on screen", async () => {
    ran.length = 0; side.view.visible = true; vscode.window.activeTextEditor = editor(false); chat.opened = 0;
    await chat.toggle();
    assert.strictEqual(hide(), 0); assert.strictEqual(chat.opened, 1);
  });
  await check("Ctrl+L while typing in the chat hides it (the editor's old selection doesn't count)", async () => {
    ran.length = 0; chat.chatFocused = true; chat.opened = 0;
    await chat.toggle();
    assert.strictEqual(hide(), 1); assert.strictEqual(chat.opened, 0);
  });
  await check("Ctrl+L before the side panel ever opened: opens it", async () => {
    ran.length = 0; chat.panes = []; chat.chatFocused = false; vscode.window.activeTextEditor = undefined; chat.opened = 0;
    await chat.toggle();
    assert.strictEqual(hide(), 0); assert.strictEqual(chat.opened, 1);
  });

  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).contributes;
  await check("package.json: Ctrl/Cmd+L runs the switch (not in the terminal); no log button in the chat's title bar", () => {
    const keys = pkg.keybindings.filter((k) => k.key === "ctrl+l");
    // (The second one is the selection's "Add to Chat" button's own key, so the button reads "Add to Chat (⌘L)": with a
    // selection in the editor the switch adds it to the chat too, the same thing. Issue #104. The third: Ctrl+K's box sends
    // what you typed there to the chat.)
    assert.deepStrictEqual(keys.map((k) => [k.command, k.mac, k.when]), [["kural.chat.toggle", "cmd+l", "!terminalFocus"],
      ["kural.selection.addToChat", "cmd+l", "editorTextFocus && editorHasSelection"],
      ["kural.inlineEdit.toChat", "cmd+l", "commentEditorFocused && commentThread == kural-edit"]]);
    assert.ok(pkg.commands.some((c) => c.command === "kural.chat.toggle"));
    assert.ok(!pkg.menus["view/title"].some((m) => m.command === "kural.showLog"));
    assert.ok(pkg.commands.some((c) => c.command === "kural.showLog"), "Kural: Show Log stays in the Command Palette");
  });
  await check("\"Add your own mood…\" uses the chat's font (not the diff's monospace .add class)", () => {
    const page = fs.readFileSync(path.join(root, "media", "chat.js"), "utf8"), css = fs.readFileSync(path.join(root, "media", "chat.css"), "utf8");
    assert.match(page, /class: "mood-chip mood-add"/);
    assert.ok(!/\.mood-chip\.add\b/.test(css));
    assert.match(css, /^\.add \{[^}]*font-family/m, "(the rule it clashed with is still there, for the diff)");
  });
  await check("the home screen can't be selected (no \"Add to chat\" on it); the conversation can", () => {
    const css = fs.readFileSync(path.join(root, "media", "chat.css"), "utf8");
    assert.match(css, /^\.empty \{[^}]*user-select: none/m);
    assert.ok(!/^\.list \{[^}]*user-select: none/m.test(css), "(answers must stay selectable: Add to chat, Ask)");
  });

  await check("Ctrl+K's Send to Chat: the selected lines (nothing selected: the file) and your words go into the message", async () => {
    vscode.Range = class { constructor(a, b, c, d) { Object.assign(this, { a, b, c, d }); } };
    vscode.workspace.asRelativePath = (u) => u.path.replace(/^\/p\//, "");
    const text = ["import time", "while not ready():", "    sleep(1)", "print('go')"];
    const doc = { uri: { path: "/p/src/flow.py" }, languageId: "python", isClosed: false, lineAt: (l) => ({ text: text[l] }),
      getText: (r) => text.slice(r.a, r.c + 1).join("\n") };
    const posted = [], pane = { kind: "side" };
    Object.assign(chat, { reveal: async () => {}, cur: () => pane, postTo: (to, m) => posted.push([to, m]) });
    const sel = { isEmpty: false, start: { line: 1, character: 0 }, end: { line: 3, character: 0 } };
    await chat.addFromEditor(doc, sel, "explain this");
    assert.deepStrictEqual(posted[0], [pane, { type: "insertPill", text: " explain this", ctx: { kind: "selection", path: "src/flow.py", lang: "python",
      startLine: 2, endLine: 3, code: "while not ready():\n    sleep(1)" } }]);
    await chat.addFromEditor(doc, { isEmpty: true }, "");
    assert.deepStrictEqual(posted[1][1], { type: "insertPill", text: "", ctx: { kind: "file", path: "src/flow.py" } });
  });

  console.log(failed ? `chat-context: ${failed} FAILED` : "chat-context: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
