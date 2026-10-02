// Every chat, from every workspace, in full: History (the clock button) lists them all.
//
// Each chat is two files in Kural's own storage folder (one per computer, shared by all Kural windows):
//   <id>.json        the whole chat (never trimmed)
//   <id>.meta.json   a small card for the History list: title, preview, when, workspace, pinned
// One file per chat (not one big list) so several Kural windows can save at the same time without
// overwriting each other's chats. A deleted chat's id is remembered (deleted.json), so a window that still
// has it open doesn't bring it back.
//
// No vscode here (tests run without it).

const fs = require("fs");
const path = require("path");

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;   // ids become file names: nothing else gets in

class ChatArchive {
  constructor(dir) {
    this.dir = dir;
    this.metas = new Map();     // id -> card (what's on disk, as far as we know)
    this.written = new Map();   // id -> signature of what we last wrote (skip unchanged chats)
    this.deleted = new Set();
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* read-only: History just stays empty */ }
    this.loadDeleted();
    this.refresh();
  }

  file(id, ext) { return path.join(this.dir, `${id}${ext}`); }

  // Write to a temporary file, then rename: a crash never leaves half a chat.
  put(file, data) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  }

  loadDeleted() {
    try { this.deleted = new Set(JSON.parse(fs.readFileSync(path.join(this.dir, "deleted.json"), "utf8"))); } catch { /* none yet */ }
  }

  // Read every card from disk again (other windows may have saved chats).
  refresh() {
    this.loadDeleted();
    const metas = new Map();
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch { /* no folder */ }
    for (const n of names) {
      if (!n.endsWith(".meta.json")) continue;
      try {
        const m = JSON.parse(fs.readFileSync(path.join(this.dir, n), "utf8"));
        if (m && SAFE_ID.test(m.id) && !this.deleted.has(m.id)) metas.set(m.id, m);
      } catch { /* a broken card: skip it */ }
    }
    this.metas = metas;
    return this.list();
  }

  list() { return [...this.metas.values()]; }
  has(id) { return this.metas.has(id); }

  // Save a chat (only if it changed since we last saved it). card: what History shows about it.
  save(tab, card) {
    if (!SAFE_ID.test(tab.id) || this.deleted.has(tab.id) || !tab.messages || !tab.messages.length) return false;
    const body = JSON.stringify(tab.messages);
    const sig = `${body.length}|${tab.title}|${tab.updatedAt}|${card.pinned ? 1 : 0}`;
    if (this.written.get(tab.id) === sig) return false;
    this.loadDeleted();                          // deleted in another window? Then it stays deleted.
    if (this.deleted.has(tab.id)) return false;
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

  // The whole chat, or null.
  read(id) {
    if (!SAFE_ID.test(id) || this.deleted.has(id)) return null;
    try { return JSON.parse(fs.readFileSync(this.file(id, ".json"), "utf8")); } catch { return null; }
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
    this.loadDeleted();   // (another window may have deleted chats since)
    this.deleted.add(id);
    this.metas.delete(id);
    this.written.delete(id);
    for (const ext of [".json", ".meta.json"]) { try { fs.unlinkSync(this.file(id, ext)); } catch { /* already gone */ } }
    try { this.put(path.join(this.dir, "deleted.json"), [...this.deleted].slice(-5000)); } catch { /* best effort */ }
  }
}

module.exports = { ChatArchive };
