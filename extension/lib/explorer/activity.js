// What the AI is reading and changing right now, file by file (no vscode here: lib/explorer/index.js shows it in the
// Explorer: blue while a file is read, yellow while it's changed; Adithya, 22 Oct 2026). Fed by the chat from the tool
// calls every program reports in Claude Code's names (Read, Edit, Write…; Codex, Gemini and Kural's own engine too).
//   - a read shows while the tool runs and LINGER_MS after (most reads take a few milliseconds: you'd never see them);
//   - a change shows from the call until the answer ends, then END_MS more.
// A file both read and changed shows as changed.
const path = require("path");

const READS = new Set(["Read", "Grep", "Glob", "NotebookRead", "LS", "view_file", "read_file", "list_dir", "find_by_name", "grep_search"]);
const CHANGES = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "write_to_file", "replace_file_content", "multi_replace_file_content", "apply_patch"]);
const PATH_KEYS = ["file_path", "notebook_path", "path", "filePath", "file", "TargetFile", "AbsolutePath", "SearchPath", "DirectoryPath"];
const LINGER_MS = 2500, END_MS = 4000;

class Activity {
  // onChange(paths): these files' look changed. root(): the project folder (relative paths are inside it).
  constructor({ onChange = () => {}, root = () => null, timers = { set: setTimeout, clear: clearTimeout } } = {}) {
    Object.assign(this, { onChange, root, timers });
    this.calls = new Map();   // `${tab}|${id}` → { file, kind, tab }
    this.reads = new Map();   // file → number of reads running or lingering
    this.changes = new Map(); // file → Set of tabs changing it
    this.later = new Set();   // timers, for dispose
  }

  // The file a tool call is about (absolute), or null (a command, a web search, a folder-less call).
  static fileOf(input, root) {
    if (!input || typeof input !== "object") return null;
    for (const k of PATH_KEYS) {
      const v = input[k];
      if (typeof v !== "string" || !v.trim() || /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /[*?[\]{}]/.test(v)) continue;
      const p = v.trim().replace(/^~(?=$|[\\/])/, require("os").homedir());
      if (path.isAbsolute(p)) return path.normalize(p);
      return root ? path.resolve(root, p) : null;
    }
    return null;
  }
  static kindOf(name) {
    const n = String(name || "");
    if (CHANGES.has(n)) return "change";
    if (READS.has(n)) return "read";
    return null;
  }

  started(tab, id, name, input) {
    const kind = Activity.kindOf(name), file = kind && Activity.fileOf(input, this.root());
    if (!file) return;
    const key = `${tab}|${id}`;
    if (this.calls.has(key)) return;
    this.calls.set(key, { file, kind, tab });
    if (kind === "read") this.reads.set(file, (this.reads.get(file) || 0) + 1);
    else { const s = this.changes.get(file) || new Set(); s.add(tab); this.changes.set(file, s); }
    this.onChange([file]);
  }

  finished(tab, id) {
    const key = `${tab}|${id}`, c = this.calls.get(key);
    if (!c) return;
    this.calls.delete(key);
    if (c.kind === "read") this.after(LINGER_MS, () => this.dropRead(c.file));
    // (a change stays until the answer ends)
  }

  // The answer ended (done, stopped or failed): its reads and changes go after a moment.
  ended(tab) {
    const reads = [];
    for (const [key, c] of this.calls) if (c.tab === tab) { this.calls.delete(key); if (c.kind === "read") reads.push(c.file); }
    const mine = [...this.changes].filter(([, s]) => s.has(tab)).map(([f]) => f);
    if (!reads.length && !mine.length) return;
    this.after(END_MS, () => {
      for (const f of reads) this.dropRead(f);
      const gone = [];
      for (const f of mine) {
        const s = this.changes.get(f);
        if (!s || !s.delete(tab)) continue;
        if (!s.size) { this.changes.delete(f); gone.push(f); }
      }
      if (gone.length) this.onChange(gone);
    });
  }

  dropRead(file) {
    const n = (this.reads.get(file) || 0) - 1;
    if (n > 0) return this.reads.set(file, n);
    this.reads.delete(file);
    this.onChange([file]);
  }

  // "change" | "read" | null for a file.
  state(file) {
    const f = path.normalize(file);
    if (this.changes.has(f)) return "change";
    if (this.reads.has(f)) return "read";
    return null;
  }

  after(ms, fn) {
    const t = this.timers.set(() => { this.later.delete(t); fn(); }, ms);
    if (t && t.unref) t.unref();
    this.later.add(t);
  }
  dispose() { for (const t of this.later) this.timers.clear(t); this.later.clear(); }
}

module.exports = { Activity, LINGER_MS, END_MS, READS, CHANGES };
