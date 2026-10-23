// Select code in the editor and, a moment after the selection stops changing, two buttons show right at the cursor:
// "Add to Chat · Edit Selection" (Adithya, 23 Oct 2026: show that design directly, not a plain label you have to point
// at). Extensions can't put clickable things inside the code, so it's the editor's hover, opened by Kural without taking
// the keyboard (editor.action.showHover, focus "noAutoFocus"): you keep typing or extending the selection, and it goes
// when the cursor moves, you type, or press Esc. Another extension's hover for that spot (a type, a blame line) can show
// in the same box. Pointing at the selected code brings it back. Without that command (an older editor), the plain label
// after the line's end comes instead ("Add to Chat ⌘L · Edit ⌘K"; it never moves the code). Setting
// kural.editor.selectionButtons turns both off.
const vscode = require("vscode");

const SCHEMES = new Set(["file", "untitled", "vscode-remote", "vscode-userdata"]);
const WAIT_MS = 250;   // (while you drag, the selection changes all the time: shown when it rests)

function registerSelectionBar(context, { busy = () => false } = {}) {
  const mac = process.platform === "darwin";
  const key = (k) => (mac ? `⌘${k}` : `Ctrl+${k}`);
  const on = () => vscode.workspace.getConfiguration("kural").get("editor.selectionButtons") !== false;
  const look = (editable) => vscode.window.createTextEditorDecorationType({
    after: {
      contentText: editable ? `Add to Chat ${key("L")}  ·  Edit ${key("K")}` : `Add to Chat ${key("L")}`,
      color: new vscode.ThemeColor("editorCodeLens.foreground"),
      backgroundColor: new vscode.ThemeColor("editorWidget.background"),
      border: "1px solid", borderColor: new vscode.ThemeColor("editorWidget.border"),
      margin: "0 0 0 2ch",
      // (No decoration option for these: VS Code puts this value into the label's CSS as it is.)
      textDecoration: "none; border-radius: 4px; padding: 0 6px; font-size: 90%",
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  const types = { edit: look(true), read: look(false) };
  let shown = null, timer = null;   // shown: { editor, line }

  const hide = () => {
    clearTimeout(timer);
    if (shown) { for (const t of Object.values(types)) shown.editor.setDecorations(t, []); shown = null; }
  };
  // The line the label goes on: where the selection ends (a selection ending at a line's start: the line before).
  const lineOf = (sel) => (sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line - 1 : sel.end.line);
  let noHover = false;   // (editor.action.showHover failed once: the label from then on)
  const show = async (editor) => {
    hide();
    const sel = editor.selection, doc = editor.document;
    if (!on() || busy() || sel.isEmpty || !SCHEMES.has(doc.uri.scheme) || editor.selections.length > 1) return;
    const line = lineOf(sel), end = doc.lineAt(line).range.end;
    const editable = !doc.isClosed && vscode.workspace.fs.isWritableFileSystem(doc.uri.scheme) !== false;
    shown = { editor, line, editable };
    // (Only in the editor you're typing in: the hover opens at its cursor.)
    if (!noHover && vscode.window.state.focused && vscode.window.activeTextEditor === editor) {
      try { await vscode.commands.executeCommand("editor.action.showHover", { focus: "noAutoFocus" }); return; }
      catch { noHover = true; }
    }
    if (shown && shown.editor === editor) editor.setDecorations(editable ? types.edit : types.read, [new vscode.Range(end, end)]);
  };
  const later = (editor) => {
    clearTimeout(timer);
    if (shown && shown.editor !== editor) hide();
    if (!editor || editor.selection.isEmpty) return hide();
    if (shown) hide();
    timer = setTimeout(() => show(editor), WAIT_MS);
  };

  // Pointing at the label (or the selected code): the two as buttons.
  const hover = {
    provideHover(doc, pos) {
      const ed = vscode.window.activeTextEditor;
      if (!shown || !ed || ed !== shown.editor || ed.document !== doc || ed.selection.isEmpty) return undefined;
      const atLabel = pos.line === shown.line && pos.character >= doc.lineAt(pos.line).range.end.character;
      if (!atLabel && !ed.selection.contains(pos)) return undefined;
      const md = new vscode.MarkdownString(
        `[$(comment-discussion) Add to Chat](command:kural.selection.addToChat "Add the selected code to your chat message (${key("L")})")` +
        (shown.editable ? `&nbsp;&nbsp;&nbsp;[$(sparkle) Edit Selection](command:kural.selection.edit "Tell Kural how to change it (${key("K")})")` : ""), true);
      md.isTrusted = { enabledCommands: ["kural.selection.addToChat", "kural.selection.edit"] };
      return new vscode.Hover(md);
    },
  };

  context.subscriptions.push(...Object.values(types),
    vscode.window.onDidChangeTextEditorSelection((e) => later(e.textEditor)),
    vscode.window.onDidChangeActiveTextEditor((ed) => { hide(); if (ed) later(ed); }),
    vscode.workspace.onDidChangeTextDocument((e) => { if (shown && e.document === shown.editor.document && e.contentChanges.length) hide(); }),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration("kural.editor.selectionButtons") && !on()) hide(); }),
    vscode.languages.registerHoverProvider([...SCHEMES].map((scheme) => ({ scheme })), hover),
    { dispose: () => clearTimeout(timer) });
  return { hide, refresh: () => { const ed = vscode.window.activeTextEditor; if (ed) later(ed); else hide(); } };
}

module.exports = { registerSelectionBar };
