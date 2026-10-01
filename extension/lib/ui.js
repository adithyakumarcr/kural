// Text size for Kural's panels: the same as your code editor's font (or kural.fontSize).
const vscode = require("vscode");

function fontScale() {
  const own = vscode.workspace.getConfiguration("kural").get("fontSize");
  const editor = vscode.workspace.getConfiguration("editor").get("fontSize") || 14;
  const px = own > 0 ? own : editor;
  return Math.max(0.7, Math.min(2, px / 13)).toFixed(3);   // the panels' styles are written for 13 px
}

// Keep an open panel in step when you change the size.
function watchFontScale(context, post) {
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("editor.fontSize") || e.affectsConfiguration("kural.fontSize")) post({ type: "fontScale", value: fontScale() });
  }));
}

module.exports = { fontScale, watchFontScale };
