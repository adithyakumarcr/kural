// The UI clean-up of 22 Oct 2026 (Adithya): one place for the chat's buttons, a shorter + menu, Ctrl+K's question and
// the selection's buttons where the code is, Connectors beside Extensions and Plugins.
//   1. package.json: the chat's title bar has no buttons of its own (+, Kural Settings and … are on the tab line); the
//      selection's buttons left the editor's corner; Ctrl+K's box (a comment thread of Kural's) has Send / Cancel, Enter
//      and Esc; the Connectors views, the Explorer's colors.
//   2. the chat page: + has Add files and Link device only; the tab line has the gear and "…".
//   3. lib/edit/inline-ask.js on a stand-in vscode: the box opens under the line and takes the focus; Send gives the text
//      and closes it; Cancel / Esc / another file give nothing; without the comment widget, the input bar asks.
const assert = require("assert");
const fs = require("fs"), path = require("path"), Module = require("module");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "extension", "package.json"), "utf8"));
const C = pkg.contributes;

// ---- a stand-in vscode for inline-ask.js ----
function fakeVscode({ comments = true } = {}) {
  const S = { threads: [], inputBox: [], focus: [], handlers: {}, editorChange: null };
  const vscode = {
    Range: class { constructor(a, b, c, d) { Object.assign(this, { a, b, c, d }); } },
    CommentThreadCollapsibleState: { Collapsed: 0, Expanded: 1 },
    CommentThreadFocus: { Reply: 1, Comment: 2 },
    comments: { createCommentController: (id, label) => {
      if (!comments) throw new Error("no comments here");
      return { id, label, options: null, dispose() {},
        createCommentThread: (uri, range, list) => { const t = { uri, range, list, disposed: false, dispose() { this.disposed = true; },
          reveal: async (c, o) => { S.focus.push(o); } }; S.threads.push(t); return t; } };
    } },
    commands: { registerCommand: (id, f) => { S.handlers[id] = f; return { dispose() {} }; } },
    window: { onDidChangeActiveTextEditor: (f) => { S.editorChange = f; return { dispose() {} }; },
      showInputBox: async (o) => { S.inputBox.push(o); return "from the bar"; } },
  };
  return { vscode, S };
}
function loadAsk(fake) {
  const load = Module._load;
  Module._load = function (r, ...a) { return r === "vscode" ? fake.vscode : load.call(this, r, ...a); };
  const file = require.resolve("../extension/lib/edit/inline-ask");
  delete require.cache[file];
  try { return require(file).InlineAsk; } finally { Module._load = load; }
}
const editor = (u = "file:///w/a.js") => ({ document: { uri: { toString: () => u } } });
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  // ---------- 1. package.json ----------
  await check("the chat's title bar: no + / Kural Settings / Get started (they're on the tab line now)", () => {
    assert.ok(!C.menus["view/title"].some((m) => /view == kural\.chat\b/.test(m.when || "")), JSON.stringify(C.menus["view/title"]));
  });
  await check("the selection's buttons left the editor's bottom-right corner (the label sits after the selection)", () => {
    assert.ok(!(C.menus["editor/content"] || []).some((m) => /^kural\.selection\./.test(m.command)));
    assert.ok(!pkg.enabledApiProposals.includes("contribEditorContentMenu"));
    assert.strictEqual(C.configuration.properties["kural.editor.selectionButtons"].default, true);
  });
  await check("Ctrl+K's box: Edit, Quick Question, Send to Chat and Cancel on Kural's threads only, with their keys; it may take the focus", () => {
    const ctx = C.menus["comments/commentThread/context"], on = "commentController == kural.inlineEdit";
    const ids = ["kural.inlineEdit.submit", "kural.inlineEdit.question", "kural.inlineEdit.toChat", "kural.inlineEdit.cancel"];
    assert.deepStrictEqual(ctx.map((m) => [m.command, m.when, m.group]), ids.map((id, i) => [id, on, `inline@${i + 1}`]));
    const kb = (cmd) => C.keybindings.find((k) => k.command === cmd && /commentThread == kural-edit/.test(k.when || ""));
    assert.strictEqual(kb("editor.action.submitComment").key, "enter");
    assert.strictEqual(kb("kural.inlineEdit.cancel").key, "escape");
    assert.strictEqual(kb("kural.inlineEdit.question").key, "alt+enter");
    assert.deepStrictEqual([kb("kural.inlineEdit.toChat").key, kb("kural.inlineEdit.toChat").mac], ["ctrl+l", "cmd+l"]);
    // (Ctrl/Cmd+L in the box sends it to the chat: its binding comes after the chat's own Ctrl/Cmd+L, so it wins there.)
    const at = (cmd, re) => C.keybindings.findIndex((k) => k.command === cmd && (!re || re.test(k.when || "")));
    assert.ok(at("kural.inlineEdit.toChat") > at("kural.chat.toggle") && at("kural.inlineEdit.toChat") > at("kural.selection.addToChat"));
    assert.ok(pkg.enabledApiProposals.includes("commentReveal"));
    for (const id of ids) assert.ok(C.menus.commandPalette.some((m) => m.command === id && m.when === "false"), id);
  });
  await check("Connectors: a view in the Extensions side bar (its tab) and one for a side bar of its own; a command to show it", () => {
    assert.ok(C.views.extensions.some((v) => v.id === "kural.connectors" && v.when === "kural.extensionsTab == connectors"));
    assert.ok(C.views["kural-plugins"].some((v) => v.id === "kural.connectorsAlone" && v.when === "kural.connectorsAlone"));
    assert.ok(C.commands.some((c) => c.command === "kural.connectors.show"));
  });
  await check("the Explorer's colors: reading (blue) and changing (yellow), for dark, light and high contrast", () => {
    for (const id of ["kural.explorer.reading", "kural.explorer.changing"]) {
      const c = C.colors.find((x) => x.id === id);
      assert.ok(c && ["dark", "light", "highContrast", "highContrastLight"].every((k) => /^#[0-9A-F]{6}$/i.test(c.defaults[k])), id);
    }
  });

  // ---------- 2. the chat page ----------
  const chat = fs.readFileSync(path.join(root, "extension", "media", "chat.js"), "utf8");
  await check("+ in the chat: Add files and Link device; no Link ticket, no Pick from a browser", () => {
    const add = chat.slice(chat.indexOf('if (kind === "add") {'), chat.indexOf('} else if (kind === "more") {')).replace(/^\s*\/\/.*$/gm, "");   // (not the comments)
    assert.ok(/"Add files"/.test(add) && /Link device/.test(add));
    assert.ok(!/Link ticket|Pick from a browser|browserPick/.test(add), add);
  });
  await check("the tab line: +, split, history, Kural Settings and … (Get started, updates, What's new)", () => {
    assert.match(chat, /el\("div", \{ class: "tabbar" \}, tabsEl, newTabBtn, splitBtn, historyBtn, settingsBtn, moreBtn\)/);
    const more = chat.slice(chat.indexOf('} else if (kind === "more") {'), chat.indexOf('} else if (kind === "device") {'));
    for (const w of ["settings", "getStarted", "updates", "whatsNew"]) assert.ok(more.includes(`"${w}"`), w);
    const host = fs.readFileSync(path.join(root, "extension", "lib", "chat", "index.js"), "utf8");
    assert.match(host, /case "panelCommand": \{\s*const id = \{ settings: "kural\.account", getStarted: "kural\.getStarted", updates: "kural\.checkForUpdates", whatsNew: "kural\.whatsNew" \}\[m\.what\];/);
  });

  await check("the model menu: Search models, then an Auto switch (role=switch, aria-checked, Space/Enter); Auto on hides the models, keeps the router profile", () => {
    const menu = chat.slice(chat.indexOf("const auto = !!t.autoRoute;"), chat.indexOf("menuEl.replaceChildren(...items.filter(Boolean));"));
    assert.match(menu, /"Search models"/);
    assert.match(menu, /role: "switch", "aria-checked": String\(auto\)/);
    assert.match(menu, /e\.key === "Enter" \|\| e\.key === " "/);
    assert.match(menu, /Balanced quality and speed, recommended for most tasks/);
    assert.match(menu, /const models = auto \? \[\] :/);                       // on: no model rows or headings
    assert.match(menu, /const profiles = !auto \? \[\] : \[mhead\("Router profile", "", "router"\)/);   // on: Balance / Cost / Intelligence + the gear
    assert.match(menu, /post\(\{ type: "setRouterProfile", tabId: t\.id, profile: profileName\(t\.routingProfile\) \}\)/);   // off → on
    assert.match(menu, /post\(\{ type: "setModel", tabId: t\.id, model: back \}\)/);                                     // on → off: the model it had
    assert.ok(!/Auto · Model Router/.test(chat.replace(/^\s*\/\/.*$/gm, "").replace(/"aria-label": "Auto, Model Router[^"]*"/, "")));
    const css = fs.readFileSync(path.join(root, "extension", "media", "chat.css"), "utf8");
    assert.match(css, /\.switch\.on \{ background: var\(--green\); \}/);
    assert.ok(!/style:/.test(menu), "the CSP forbids style attributes");
  });
  await check("the \"/\" list opens after a space or new line too, with skills; a path there stays quiet", () => {
    const m = chat.slice(chat.indexOf("function checkMention()"), chat.indexOf("function slashScore"));
    assert.match(m, /\(\?:\^\|\\s\)\\\/\(\[\^\\s\/\]\*\)\$/);
    assert.match(m, /lead: sl\.index === 0 && atStart\(node\)/);
    const r = chat.slice(chat.indexOf("function renderSlash(P)"), chat.indexOf("function pickMention()"));
    assert.match(r, /const pool = \[\.\.\.mine, \.\.\.list\.items\.filter\(\(c\) => !names\.has\(c\.name\)\)\]/);
    assert.match(r, /if \(!P\.lead && !found && \(mine\.length \|\| P\.query\)\) \{ closePopup\(\)/);
    assert.match(chat, /r\.setStart\(P\.node, Math\.max\(0, P\.start\)\); r\.setEnd\(P\.node, Math\.min\(P\.node\.data\.length, P\.end\)\);\s*closePopup\(\);\s*const sel/);
  });
  await check("the '…' menu has only what's nowhere else on the tab line: Kural Settings, Get started, Check for updates, What's new (no History, +, Split)", () => {
    const more = chat.slice(chat.indexOf('} else if (kind === "more") {'), chat.indexOf('} else if (kind === "device") {'));
    assert.strictEqual((more.match(/row\("/g) || []).length, 4);
    assert.ok(!/history|split|"add"|attach/i.test(more.replace(/^\s*\/\/.*$/gm, "")));
  });

  // ---------- 3. Ctrl+K's box ----------
  await check("the box opens under the line, labelled, and takes the keyboard; Send gives what you typed and closes it", async () => {
    const fake = fakeVscode(), InlineAsk = loadAsk(fake), ask = new InlineAsk({ subscriptions: [] });
    const answer = ask.ask(editor(), 12, { generating: false });
    await tick();
    const t = fake.S.threads[0];
    assert.strictEqual(t.range.a, 12); assert.deepStrictEqual(t.list, []);
    assert.strictEqual(t.label, "Kural: edit the selection"); assert.strictEqual(t.contextValue, "kural-edit"); assert.strictEqual(t.collapsibleState, 1);
    assert.deepStrictEqual(fake.S.focus, [{ focus: 1 }]);
    fake.S.handlers["kural.inlineEdit.submit"]({ thread: t, text: "  add a docstring  " });
    assert.strictEqual(await answer, "add a docstring");
    assert.ok(t.disposed); assert.strictEqual(ask.pending, null);
  });
  await check("Cancel (or Esc, or an empty Send) gives nothing; another file in front closes it too", async () => {
    const fake = fakeVscode(), InlineAsk = loadAsk(fake), ask = new InlineAsk({ subscriptions: [] });
    let a = ask.ask(editor(), 1, { generating: true }); await tick();
    assert.strictEqual(fake.S.threads[0].label, "Kural: write code here");
    fake.S.handlers["kural.inlineEdit.cancel"](); assert.strictEqual(await a, undefined);
    a = ask.ask(editor(), 2, { generating: false }); await tick();
    fake.S.handlers["kural.inlineEdit.submit"]({ thread: fake.S.threads[1], text: "   " }); assert.strictEqual(await a, undefined);
    a = ask.ask(editor(), 3, { generating: false }); await tick();
    fake.S.editorChange(editor("file:///w/other.js")); assert.strictEqual(await a, undefined); assert.ok(fake.S.threads[2].disposed);
  });
  await check("a second Ctrl+K closes the first box; a box left from before closes when its button is pressed", async () => {
    const fake = fakeVscode(), InlineAsk = loadAsk(fake), ask = new InlineAsk({ subscriptions: [] });
    const first = ask.ask(editor(), 1, { generating: false }); await tick();
    const second = ask.ask(editor(), 5, { generating: false }); await tick();
    assert.strictEqual(await first, undefined); assert.ok(fake.S.threads[0].disposed);
    const stray = { disposed: false, dispose() { this.disposed = true; } };
    fake.S.handlers["kural.inlineEdit.submit"]({ thread: stray, text: "x" });
    assert.ok(stray.disposed); assert.ok(ask.pending, "the open one stays");
    fake.S.handlers["kural.inlineEdit.submit"]({ thread: fake.S.threads[1], text: "rename it" });
    assert.strictEqual(await second, "rename it");
  });
  await check("no comment widget here: the input bar at the top asks, as before", async () => {
    const fake = fakeVscode({ comments: false }), InlineAsk = loadAsk(fake), ask = new InlineAsk({ subscriptions: [] });
    assert.strictEqual(await ask.ask(editor(), 1, { generating: false }), "from the bar");
    assert.strictEqual(fake.S.inputBox[0].title, "Kural: edit selection");
  });

  console.log(failed ? `ui-cleanup: ${failed} FAILED` : "ui-cleanup: ALL PASS"); process.exitCode = failed ? 1 : 0;
})();
