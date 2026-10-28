// Every chat, from every workspace, in full: History (the clock button) lists them all.
//
// Each chat is two files in Kural's own storage folder (one per computer, shared by all Kural windows):
//   <id>.json        the whole chat (never trimmed)
//   <id>.meta.json   a small card for the History list: title, preview, when, workspace, pinned
// One file per chat (not one big list) so several Kural windows can save at the same time without
// overwriting each other's chats. A deleted chat's id is remembered (deleted.json), so a window that still
// has it open doesn't bring it back: that is an empty <id>.deleted file per chat (a list in one file lost ids when two
// windows or an old version wrote it at once, and was cut at 5000), and deleted.json too for the versions before.
// A file that can't be read is never dropped or overwritten: it is renamed to <name>.<time>.corrupt, and a chat whose
// card is damaged or missing is listed anyway (the card is made again from the chat).
//
// No vscode here (tests run without it).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { privateFolder } = require("../private-file");

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;   // ids become file names: nothing else gets in

class ChatArchive {
  constructor(dir) {
    this.dir = dir;
    this.metas = new Map();     // id -> card (what's on disk, as far as we know)
    this.written = new Map();   // id -> signature of what we last wrote (skip unchanged chats)
    this.deleted = new Set();
    try { privateFolder(dir); } catch { /* read-only: History just stays empty */ }
    this.loadDeleted();
    this.sweepTmp();
    this.refresh();
  }

  file(id, ext) { return path.join(this.dir, `${id}${ext}`); }

  // Write to a temporary file, then rename: a crash never leaves half a chat.
  put(file, data) {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      // (flushed before the rename: after a power cut the renamed file could otherwise be empty)
      const fd = fs.openSync(tmp, "w", 0o600);
      try { fs.writeSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, file);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* not there */ }   // (a failed write or rename used to leave the .tmp for ever)
      throw e;
    }
  }

  // Temporary files left by a window that was killed between writing and renaming: removed when the archive opens.
  // Only old ones: another window may be writing one right now.
  sweepTmp(maxAgeMs = 3600000) {
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch { return 0; }
    let n = 0;
    for (const name of names) {
      if (!/\.\d+\.tmp$/.test(name)) continue;
      const f = path.join(this.dir, name);
      try { if (Date.now() - fs.statSync(f).mtimeMs > maxAgeMs) { fs.unlinkSync(f); n++; } } catch { /* gone */ }
    }
    return n;
  }

  // A file we can't read is kept for recovery, never overwritten or deleted.
  quarantine(file) {
    try { fs.renameSync(file, `${file}.${Date.now()}.corrupt`); return true; } catch { return false; }
  }

  tomb(id) { return this.file(id, ".deleted"); }
  isDeleted(id) { return this.deleted.has(id) || fs.existsSync(this.tomb(id)); }

  // deleted.json (older versions; still written) joins what we know. Unreadable: kept as .corrupt, ours stays as it is.
  loadDeleted() {
    const f = path.join(this.dir, "deleted.json");
    let text;
    try { text = fs.readFileSync(f, "utf8"); } catch { return; }   // none yet
    try {
      const list = JSON.parse(text);
      if (!Array.isArray(list)) throw new Error("not a list");
      for (const id of list) if (typeof id === "string") this.deleted.add(id);
    } catch { this.quarantine(f); }
  }

  // The card of a chat, made from the chat itself (its card was lost or damaged).
  rebuildCard(id) {
    let t;
    try { t = JSON.parse(fs.readFileSync(this.file(id, ".json"), "utf8")); } catch { return null; }
    if (!t || !Array.isArray(t.messages) || !t.messages.length) return null;
    const first = t.messages.find((m) => m && m.role === "user");
    const preview = first ? (first.segments || []).filter((x) => x && x.t === "text").map((x) => x.v).join("").replace(/\s+/g, " ").trim().slice(0, 90) : "";
    return { id, title: t.title || preview.slice(0, 40) || "Chat", preview, when: t.updatedAt || t.createdAt || 0,
      count: t.messages.filter((m) => m && m.role === "user").length, model: t.model, mode: t.mode, workspace: t.workspace, pinned: false };
  }

  // Read every card from disk again (other windows may have saved chats).
  refresh() {
    this.loadDeleted();
    const metas = new Map();
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch { /* no folder */ }
    for (const n of names) if (n.endsWith(".deleted") && SAFE_ID.test(n.slice(0, -8))) this.deleted.add(n.slice(0, -8));
    for (const n of names) {
      if (!n.endsWith(".meta.json")) continue;
      const f = path.join(this.dir, n), id = n.slice(0, -10);
      try {
        const m = JSON.parse(fs.readFileSync(f, "utf8"));
        if (m && SAFE_ID.test(m.id) && !this.deleted.has(m.id)) metas.set(m.id, m);
      } catch { this.quarantine(f); }   // (a damaged card: the chat is listed from its own file below)
    }
    // A chat without a (readable) card is listed anyway.
    for (const n of names) {
      if (!n.endsWith(".json") || n.endsWith(".meta.json")) continue;
      const id = n.slice(0, -5);
      if (id === "deleted" || !SAFE_ID.test(id) || metas.has(id) || this.deleted.has(id)) continue;
      const card = this.rebuildCard(id);
      if (card) metas.set(id, card);
    }
    this.metas = metas;
    return this.list();
  }

  list() { return [...this.metas.values()]; }
  has(id) { return this.metas.has(id); }

  // Save a chat (only if it changed since we last saved it). card: what History shows about it.
  save(tab, card) {
    if (!SAFE_ID.test(tab.id) || this.isDeleted(tab.id) || !tab.messages || !tab.messages.length) return false;
    const body = JSON.stringify(tab.messages);
    // (a hash, not the length: an edit of the same length with the same updatedAt used to count as unchanged)
    const sig = `${crypto.createHash("sha1").update(body).digest("hex")}|${tab.title}|${tab.updatedAt}|${card.pinned ? 1 : 0}|${tab.model}|${!!tab.autoRoute}|${tab.routingProfile || ""}`;
    if (this.written.get(tab.id) === sig) return false;
    this.loadDeleted();                          // deleted in another window? Then it stays deleted.
    if (this.isDeleted(tab.id)) return false;
    // Pinned is kept from the card on disk: another window may have pinned it since.
    let pinned = card.pinned;
    if (pinned == null) { try { pinned = JSON.parse(fs.readFileSync(this.file(tab.id, ".meta.json"), "utf8")).pinned; } catch { pinned = false; } }
    const meta = { ...card, id: tab.id, pinned: !!pinned };
    try {
      this.put(this.file(tab.id, ".json"), { ...tab, status: "idle" });
      this.put(this.file(tab.id, ".meta.json"), meta);
    } catch { return false; }
    this.metas.set(tab.id, meta);
    this.written.set(tab.id, sig);
    return true;
  }

  // The whole chat, or null. A file that can't be parsed is kept as .corrupt (with its card), so the next save can't lose it.
  read(id) {
    if (!SAFE_ID.test(id) || this.isDeleted(id)) return null;
    const f = this.file(id, ".json");
    let text;
    try { text = fs.readFileSync(f, "utf8"); } catch { return null; }
    try {
      const t = JSON.parse(text);
      if (!t || typeof t !== "object") throw new Error("not a chat");
      return t;
    } catch {
      this.quarantine(f); this.quarantine(this.file(id, ".meta.json"));
      this.metas.delete(id); this.written.delete(id);
      return null;
    }
  }

  pin(id, on) {
    const m = this.metas.get(id);
    if (!m) return false;
    m.pinned = !!on;
    try { this.put(this.file(id, ".meta.json"), m); } catch { return false; }
    return true;
  }

  // Gone for good, in every window.
  remove(id) {
    if (!SAFE_ID.test(id)) return;
    try { fs.writeFileSync(this.tomb(id), "", { mode: 0o600 }); } catch { /* the list below still has it */ }
    this.loadDeleted();   // (another window may have deleted chats since: merged, never replaced)
    this.deleted.add(id);
    this.metas.delete(id);
    this.written.delete(id);
    for (const ext of [".json", ".meta.json"]) { try { fs.unlinkSync(this.file(id, ext)); } catch { /* already gone */ } }
    try { this.put(path.join(this.dir, "deleted.json"), [...this.deleted].slice(-5000)); } catch { /* best effort */ }
  }
}

module.exports = { ChatArchive };
