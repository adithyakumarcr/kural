// A chat beside the code: drag a chat tab out of the Kural panel and let go (in the editor area, usually), and it opens
// there, in an editor group beside the one you're in. How: the page sees where the drag ended (media/chat-columns.js;
// VS Code's editor area never gets the drop: Chromium doesn't let a drag from one site's frame be dropped on another's)
// and Kural opens kural-chat:/<tab id>.kuralchat in its own editor ("kural.chatTab", a custom editor: a chat page). VS
// Code then moves it around like any editor and brings it back after a restart. (No file system behind the address on
// purpose: with one, VS Code shows a breadcrumb bar with the made-up file name above the chat.)

const vscode = require("vscode");

const SCHEME = "kural-chat";
const VIEW = "kural.chatTab";
const tabUri = (id) => vscode.Uri.from({ scheme: SCHEME, path: `/${id}.kuralchat` });
const tabOf = (uri) => (/^\/?([^/]+)\.kuralchat$/.exec(uri.path) || [])[1] || null;

function registerTabEditor(context, chat) {
  const editor = {
    openCustomDocument: (uri) => ({ uri, dispose() {} }),
    resolveCustomEditor: (doc, panel) => chat.adoptDragged(panel, tabOf(doc.uri)),
  };
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW, editor, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }));
}

// Open a chat tab beside the code (the command "Kural: Open a Chat Beside the Code"; dragging does the same). With no
// editor open it takes the editor area itself (beside an empty group would leave that group empty on the left).
const openBeside = (id) => {
  const empty = vscode.window.tabGroups.all.every((g) => !g.tabs.length);
  return vscode.commands.executeCommand("vscode.openWith", tabUri(id), VIEW, { viewColumn: empty ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside, preserveFocus: false });
};

module.exports = { registerTabEditor, openBeside, tabUri, tabOf, SCHEME };
