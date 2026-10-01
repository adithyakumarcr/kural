// "Drop files here": a small native area under the chat.
// Why not drop straight onto the chat? While you drag a file in from your file manager, VS Code
// shields web-based panels (like the chat) from the drag, so the chat never sees the drop.
// A native view does get it, without holding Shift.

const vscode = require("vscode");
const { log } = require("./claude");

class DropZone {
  constructor(chat) {
    this.chat = chat;
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
    this.dropMimeTypes = ["text/uri-list", "files"];
    this.dragMimeTypes = [];
  }

  register(context) {
    const view = vscode.window.createTreeView("kural.drop", { treeDataProvider: this, dragAndDropController: this });
    context.subscriptions.push(view);
  }

  getTreeItem(e) { return e; }
  getChildren() {
    const item = new vscode.TreeItem("Drop files here to attach them to your message");
    item.iconPath = new vscode.ThemeIcon("cloud-upload");
    item.tooltip = "Images, PDFs, code, anything. You can also use + in the chat, or paste a screenshot.";
    item.command = { command: "kural.chat.attach", title: "Attach files" };
    return [item];
  }

  async handleDrop(_target, data) {
    const items = [];
    const list = data.get("text/uri-list");
    if (list) {
      for (const line of (await list.asString()).split(/\r?\n/)) {
        const u = line.trim();
        if (!u || u.startsWith("#")) continue;
        try { const a = this.chat.attachments.add(vscode.Uri.parse(u).fsPath); if (a) items.push(a); } catch { /* not a file */ }
      }
    }
    if (!items.length) {
      // Some sources give the file's contents instead of its path.
      for (const [, it] of data) {
        const f = it.asFile && it.asFile();
        if (!f) continue;
        try { const a = this.chat.attachments.addData(f.name, Buffer.from(await f.data()).toString("base64")); if (a) items.push(a); } catch (e) { log(`drop: ${e.message}`); }
      }
    }
    log(`drop: attached ${items.length} file(s)`);
    if (!items.length) return;
    this.chat.reveal();
    this.chat.post({ type: "attached", items });
  }
}

module.exports = { DropZone };
