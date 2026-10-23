// The Explorer shows what the AI is working on, as it happens: a file it reads turns blue, a file it changes turns yellow,
// with a dot (U+25CF, not a letter: git's own M is already there) and a tooltip, for every chat (lib/explorer/activity.js
// keeps track; the chat feeds it). The colors are Kural's theme colors kural.explorer.reading / kural.explorer.changing
// (package.json "colors"), so a theme can change them.
// Setting kural.explorer.showAIActivity turns it off.
const vscode = require("vscode");
const { Activity } = require("./activity");
const ws = require("../workspace");

const LOOK = {
  read: { badge: "\u25CF", tooltip: "Kural is reading this", color: "kural.explorer.reading" },
  change: { badge: "\u25CF", tooltip: "Kural is changing this", color: "kural.explorer.changing" },
};

function registerExplorerActivity(context) {
  const emitter = new vscode.EventEmitter();
  const on = () => vscode.workspace.getConfiguration("kural").get("explorer.showAIActivity") !== false;
  const activity = new Activity({ root: () => ws.root(), onChange: (files) => emitter.fire(files.map((f) => vscode.Uri.file(f))) });
  context.subscriptions.push(emitter, { dispose: () => activity.dispose() },
    vscode.window.registerFileDecorationProvider({
      onDidChangeFileDecorations: emitter.event,
      provideFileDecoration(uri) {
        if (uri.scheme !== "file" || !on()) return undefined;
        const look = LOOK[activity.state(uri.fsPath)];
        return look ? new vscode.FileDecoration(look.badge, look.tooltip, new vscode.ThemeColor(look.color)) : undefined;
      },
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("kural.explorer.showAIActivity")) return;
      const files = [...activity.reads.keys(), ...activity.changes.keys()];
      if (files.length) emitter.fire(files.map((f) => vscode.Uri.file(f)));
    }));
  return activity;
}

module.exports = { registerExplorerActivity };
