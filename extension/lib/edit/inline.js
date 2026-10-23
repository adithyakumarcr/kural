// Ctrl+K inline edit, and "Apply" for code blocks from the chat.
// Both ask Claude for new code, then hand it to the review (red/green) view.

const vscode = require("vscode");
const { log } = require("../ai/claude");
const { unwrap } = require("./code-reply");

const EDIT_SYSTEM_PROMPT =
  "You are the code-editing engine inside the Kural code editor. " +
  "EDIT requests give you part of a file with a marked region and an instruction: reply with the code that " +
  "replaces the marked region, complete and correctly indented, matching the file's style. " +
  "APPLY requests give you a whole file and a suggested change (which may skip unchanged parts with comments like " +
  "'... existing code ...'): reply with the complete updated file. " +
  "Always put the code between a <code> line and a </code> line, exactly like this:\n<code>\n    indented code here\n</code>\n" +
  "Nothing before <code> or after </code>: no explanations, no markdown fences. Each request is independent of earlier ones.";

let cancelledByYou = false;   // (the last request: you pressed Cancel, so a missing answer needs no message)
async function runWithProgress(session, title, prompt) {
  cancelledByYou = false;
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: true },
    (_p, token) => {
      token.onCancellationRequested(() => { cancelledByYou = true; log("edit: cancelled by you"); session.stop(); });
      return session.ask(prompt, token);
    });
}

// The answer had <code> tags that made no wrapper: nothing is inserted, and you are told (not a silent nothing).
function badReply() {
  log("edit: the reply had code tags in the wrong places; nothing inserted");
  vscode.window.showWarningMessage("Kural: the answer was not in the expected form, so nothing was changed. Try again.");
}

function notReady(state) {
  if (state() === "login") vscode.window.showWarningMessage("Kural: log in to Claude first.", "Log in")
    .then((p) => p && vscode.commands.executeCommand("kural.login"));
  else if (state() === "missing") vscode.commands.executeCommand("kural.install");
  else if (!cancelledByYou) {   // no answer, and not your Cancel: say so (it used to end in silence)
    log("edit: no answer came back; nothing changed");
    vscode.window.showWarningMessage("Kural: no answer came back, so nothing was changed. Try again (Kural: Show Log has the details).");
  }
}

// ---------- Ctrl+K ----------
// ask: lib/edit/inline-ask.js (the box under the selection); without it, the input bar at the top.
async function inlineEdit(session, review, state, ask) {
  const ed = vscode.window.activeTextEditor;
  if (!ed) return;
  if (review.busy()) { vscode.window.showInformationMessage("Kural: accept or reject the current change first."); return; }
  const doc = ed.document, sel = ed.selection;

  // Which lines are we replacing? With nothing selected, we write new code at the cursor.
  let start, end;
  if (!sel.isEmpty) {
    start = sel.start.line;
    end = sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line : sel.end.line + 1;
  } else if (doc.lineAt(sel.active.line).isEmptyOrWhitespace) {
    start = sel.active.line; end = start + 1;           // replace the blank line you're on
  } else {
    start = end = sel.active.line + 1;                   // insert below the current line
  }
  const generating = sel.isEmpty;

  // (The question opens under the last line it's about: the selection's, or the line you're on.)
  const instruction = ask ? await ask.ask(ed, Math.max(0, end - 1), { generating }) : await vscode.window.showInputBox({
    title: generating ? "Kural: generate code here" : "Kural: edit selection",
    prompt: generating ? "What should Kural write here?" : "How should Kural change the selected code?",
    placeHolder: generating ? "e.g. a function that converts mm/s to m/min" : "e.g. add input validation and a docstring",
    ignoreFocusOut: true,
  });
  if (!instruction) return;
  if (doc.isClosed) { log("edit: the file was closed meanwhile; nothing asked"); return; }

  const lines = (a, b) => { const o = []; for (let l = Math.max(0, a); l < Math.min(doc.lineCount, b); l++) o.push(doc.lineAt(l).text); return o.join("\n"); };
  const selected = lines(start, end);
  const prompt =
    `EDIT request\nFile: ${vscode.workspace.asRelativePath(doc.uri)} (${doc.languageId})\n\n` +
    `${lines(start - 80, start)}\n<<<REGION START>>>\n${generating && !selected.trim() ? "" : selected}\n<<<REGION END>>>\n${lines(end, end + 40)}\n\n` +
    `Instruction: ${instruction}\n` +
    (generating ? "The region is empty: write new code to insert there." : "Reply with the replacement for the region.");

  const version = doc.version;
  const thinking = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: "rgba(139,108,239,0.12)" });
  ed.setDecorations(thinking, [new vscode.Range(start, 0, Math.max(start, end - 1), 0)]);
  const reply = await runWithProgress(session, "Kural is editing…", prompt);
  thinking.dispose();

  if (reply == null) { notReady(state); return; }
  if (doc.version !== version) { vscode.window.showWarningMessage("Kural: the file changed while Kural was working, so the edit was not applied. Try again."); return; }
  const code = unwrap(reply);
  if (code == null) { badReply(); return; }
  await review.propose(doc, start, end, code, { source: "Ctrl+K", ask: instruction });
}

// ---------- Apply (from a chat code block) ----------
// ask: what you asked the chat for (so Tab knows why the code changed), or "".
async function applyCode(session, review, state, code, targetUri, ask = "") {
  if (review.busy()) { vscode.window.showInformationMessage("Kural: accept or reject the current change first."); return; }
  let doc;
  try { doc = await vscode.workspace.openTextDocument(targetUri); }
  catch {
    // A new file: create it with the code as-is.
    await vscode.workspace.fs.writeFile(targetUri, Buffer.from(code.endsWith("\n") ? code : code + "\n"));
    await vscode.window.showTextDocument(targetUri);
    vscode.window.showInformationMessage(`Kural created ${vscode.workspace.asRelativePath(targetUri)}.`);
    if (review.onDone) review.onDone({ source: "chat Apply", ask }, true, targetUri.toString());
    return;
  }
  await vscode.window.showTextDocument(doc, { preview: false });
  if (doc.lineCount > 3000) {
    const go = await vscode.window.showWarningMessage("This file is long; applying may take a while.", "Apply anyway");
    if (!go) return;
  }
  const prompt =
    `APPLY request\nFile: ${vscode.workspace.asRelativePath(doc.uri)} (${doc.languageId})\n\n` +
    `<<<FILE\n${doc.getText()}\nFILE>>>\n\n<<<CHANGE\n${code}\nCHANGE>>>\n\nReply with the complete updated file.`;
  const version = doc.version;
  const reply = await runWithProgress(session, `Kural is applying to ${vscode.workspace.asRelativePath(doc.uri)}…`, prompt);
  if (reply == null) { notReady(state); return; }
  if (doc.version !== version) { vscode.window.showWarningMessage("Kural: the file changed while Kural was working. Click Apply again."); return; }
  // Most files end with a line break, which shows up as an empty last line. Leave it alone.
  let end = doc.lineCount;
  if (end > 1 && doc.lineAt(end - 1).text === "") end--;
  const full = unwrap(reply);
  if (full == null) { badReply(); return; }
  await review.propose(doc, 0, end, full, { source: "chat Apply", ask });
}

module.exports = { EDIT_SYSTEM_PROMPT, inlineEdit, applyCode };
