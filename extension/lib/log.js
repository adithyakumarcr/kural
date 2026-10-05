// Kural's log: every request, its timing, and what went wrong. "Kural: Show Log" (or Kural Settings → Show log) opens
// it as a read-only editor tab that follows new lines. (It used to be View → Output → Kural; Kural hides VS Code's
// Output tab, see scripts/rebrand.py.) Kept in memory only: the last MAX lines of this window.
const vscode = require("vscode");

const MAX = 5000;
const lines = [];
let URI = null, changed = null, timer = null;   // (made in initLog: tests load this file without an editor)

function initLog(context) {
  URI = vscode.Uri.parse("kural-log:Kural%20log.log");
  changed = new vscode.EventEmitter();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("kural-log", { onDidChange: changed.event, provideTextDocumentContent: () => lines.join("\n") + "\n" }),
    changed,
  );
}

function log(msg) {
  lines.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  if (lines.length > MAX) lines.splice(0, lines.length - MAX);
  // (An open log tab redraws at most twice a second.)
  if (changed && !timer) timer = setTimeout(() => { timer = null; changed.fire(URI); }, 500);
}

async function showLog() {
  if (!URI) return;
  const doc = await vscode.workspace.openTextDocument(URI);
  const ed = await vscode.window.showTextDocument(doc, { preview: false });
  const end = new vscode.Position(doc.lineCount, 0);
  ed.revealRange(new vscode.Range(end, end));
}

module.exports = { initLog, log, showLog, _lines: lines };
