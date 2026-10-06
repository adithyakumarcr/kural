// A chat beside the code, by dragging: drag a chat tab out of the Kural panel into the editor area and it opens there,
// split the way VS Code splits (drop on a side of an editor: beside it, above or below; in the middle: as its tab).
// How: the page's tab carries an address, kural-chat:/<tab id>.kuralchat (as "ResourceURLs", what VS Code's editor
// area opens when something is dropped on it). That address opens in Kural's own editor ("kural.chatTab", a custom
// editor: a chat page), so VS Code does the drop zones, the split, moving it around and bringing it back after a
// restart. (No file system behind the address on purpose: with one, VS Code shows a breadcrumb bar with the made-up
// file name above the chat.)

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

// Open a chat tab beside the code (the command "Kural: Open a Chat Beside the Code"; dragging does the same).
const openBeside = (id) => vscode.commands.executeCommand("vscode.openWith", tabUri(id), VIEW, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false });

module.exports = { registerTabEditor, openBeside, tabUri, tabOf, SCHEME };
