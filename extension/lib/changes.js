// Tracks files an Agent changes, so you can Review, Keep or Undo each one.
// Before Claude edits a file, Kural saves its current content (a "snapshot").
// Undo writes the snapshot back; Review opens a diff: snapshot vs. now.

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { diffLines } = require("./diff");

const SCHEME = "kural-before";

class ChangeTracker {
  constructor() {
    this.snapshots = new Map(); // id -> { file, content (null = file didn't exist) }
    this.emitter = new vscode.EventEmitter();
  }

  register(context) {
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
      onDidChange: this.emitter.event,
      provideTextDocumentContent: (uri) => {
        const s = this.snapshots.get(new URLSearchParams(uri.query).get("id"));
        return s ? s.content || "" : "(snapshot no longer available)";
      },
    }));
  }

  // Called just before Claude edits `file`. Returns the snapshot id for this turn.
  snapshot(turn, file) {
    if (turn.snaps[file]) return;
    let content = null;
    try { content = fs.readFileSync(file, "utf8"); } catch { /* new file */ }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.snapshots.set(id, { file, content });
    turn.snaps[file] = id;
  }

  // What changed in this turn, for the "Files changed" card.
  summary(turn, root) {
    const out = [];
    for (const [file, id] of Object.entries(turn.snaps)) {
      const snap = this.snapshots.get(id);
      let now = null;
      try { now = fs.readFileSync(file, "utf8"); } catch { /* deleted */ }
      if (snap.content === now) continue;
      const ops = diffLines((snap.content || "").split("\n"), (now || "").split("\n"));
      out.push({
        id, file, rel: require("./workspace").label(file),
        added: ops.filter((o) => o.op === "add").length, removed: ops.filter((o) => o.op === "del").length,
        created: snap.content == null, deleted: now == null, state: "pending",
      });
    }
    return out;
  }

  async review(id) {
    const s = this.snapshots.get(id);
    if (!s) return;
    const before = vscode.Uri.from({ scheme: SCHEME, path: s.file, query: `id=${id}` });
    await vscode.commands.executeCommand("vscode.diff", before, vscode.Uri.file(s.file), `${path.basename(s.file)} (before ↔ after Claude)`);
  }

  async undo(id) {
    const s = this.snapshots.get(id);
    if (!s) return false;
    const uri = vscode.Uri.file(s.file);
    if (s.content == null) await vscode.workspace.fs.delete(uri, { useTrash: true }).then(undefined, () => {});
    else await vscode.workspace.fs.writeFile(uri, Buffer.from(s.content, "utf8"));
    // If the file is open with no unsaved edits, it reloads by itself.
    return true;
  }

  keep(id) { this.snapshots.delete(id); }
}

module.exports = { ChangeTracker };
