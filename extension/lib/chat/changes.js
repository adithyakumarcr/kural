// Tracks files an Agent changes in your project, so you can Review, Keep or Undo each one, and put the code back as it
// was before any message of the chat ("Restore code", or editing an earlier message). (Files outside the project
// aren't tracked: inProject.)
// Before the AI edits a file, Kural saves its current content (a "snapshot", a checkpoint). Undo writes the snapshot
// back; Review opens a diff: snapshot vs. now. Snapshots are also saved to disk (globalStorage checkpoints/), so a chat
// can be rolled back after Kural restarts and after you pressed Keep; they're deleted after 30 days.

const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { diffLines } = require("../edit/diff");
const { within } = require("../paths");

const SCHEME = "kural-before";
const MAX_DISK = 10 * 1024 * 1024;   // a bigger file's snapshot stays in memory only
const KEEP_DAYS = 30;
const hash = (text) => text == null ? null : crypto.createHash("sha1").update(text).digest("hex");

// Only files in the chat's project are its changes (the Files changed card, Review / Undo / Keep, Restore code, what Tab
// and Auto learn from them): not a note the AI writes in the temp folder, not Claude Code's own files (~/.claude: plans,
// memory), not anywhere else (Adithya: "only the files that have been changed inside the repo"). roots: the project's
// folders (with none open, Kural's work folder). A project that is itself in one of those places (a folder in /tmp)
// still counts.
function inProject(file, roots) {
  if (!file || !path.isAbsolute(String(file))) return false;
  const away = [path.join(os.homedir(), ".claude"), os.tmpdir(), ...(process.platform === "win32" ? [] : ["/tmp"])];
  return (roots || []).filter(Boolean).some((r) => within(file, [r]) && !away.some((a) => within(file, [a]) && !within(r, [a])));
}

class ChangeTracker {
  constructor(dir = null) {
    this.dir = dir;
    this.snapshots = new Map(); // id -> { file, content (null = file didn't exist) }
    this.emitter = new vscode.EventEmitter();
    if (dir) setTimeout(() => this.cleanup(), 30000);
  }

  diskFile(id) { return this.dir && /^[\w-]+$/.test(id) ? path.join(this.dir, `${id}.json`) : null; }
  get(id) {
    if (this.snapshots.has(id)) return this.snapshots.get(id);
    try { const s = JSON.parse(fs.readFileSync(this.diskFile(id), "utf8")); if (s && s.file) { this.snapshots.set(id, s); return s; } } catch { /* gone */ }
    return null;
  }
  // Old checkpoints go (a chat older than that can't be rolled back any more).
  cleanup(days = KEEP_DAYS) {
    try {
      const cut = Date.now() - days * 86400000;
      for (const f of fs.readdirSync(this.dir)) {
        const p = path.join(this.dir, f);
        try { if (fs.statSync(p).mtimeMs < cut) fs.unlinkSync(p); } catch { /* in use */ }
      }
    } catch { /* no folder yet */ }
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
    if (this.dir && (content == null || content.length <= MAX_DISK)) {
      try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(this.diskFile(id), JSON.stringify({ file, content })); } catch { /* memory only */ }
    }
  }

  // What changed in this turn, for the "Files changed" card.
  summary(turn, root) {
    const out = [];
    for (const [file, id] of Object.entries(turn.snaps)) {
      const snap = this.get(id);
      if (!snap) continue;
      let now = null;
      try { now = fs.readFileSync(file, "utf8"); } catch { /* deleted */ }
      if (snap.content === now) continue;
      const ops = diffLines((snap.content || "").split("\n"), (now || "").split("\n"));
      out.push({
        id, file, rel: require("../workspace").label(file),
        added: ops.filter((o) => o.op === "add").length, removed: ops.filter((o) => o.op === "del").length,
        created: snap.content == null, deleted: now == null, state: "pending",
        after: hash(now),   // the file as the AI left it: a later rollback can tell whether you changed it since
      });
    }
    return out;
  }

  async review(id) {
    const s = this.get(id);
    if (!s) return;
    const before = vscode.Uri.from({ scheme: SCHEME, path: s.file, query: `id=${id}` });
    await vscode.commands.executeCommand("vscode.diff", before, vscode.Uri.file(s.file), `${path.basename(s.file)} (before ↔ after)`);
  }

  async undo(id) {
    const s = this.get(id);
    if (!s) return false;
    const uri = vscode.Uri.file(s.file);
    if (s.content == null) await vscode.workspace.fs.delete(uri, { useTrash: true }).then(undefined, () => {});
    else await vscode.workspace.fs.writeFile(uri, Buffer.from(s.content, "utf8"));
    // If the file is open with no unsaved edits, it reloads by itself.
    return true;
  }

  // Keep = done reviewing; the checkpoint stays (Restore code can still go back to before it).
  keep() {}

  // Whether `file` is still as the AI left it (after = its hash then).
  unchangedSince(file, after) {
    let now = null;
    try { now = fs.readFileSync(file, "utf8"); } catch { /* deleted */ }
    return hash(now) === after;
  }
}

module.exports = { ChangeTracker, hash, inProject };
