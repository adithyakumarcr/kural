// What each Kural window tells the others (the Projects bar): one status file per window, an inbox per window for
// requests ("show this chat", "close", "show a card"), and the pins. Everything sits in one shared folder that only
// this user can read. No vscode inside.
//
//   <dir>/windows/<windowId>.json        the window's state, rewritten when it changes and every minute (`seen`)
//   <dir>/inbox/<windowId>/<time>-<random>.json   one request each; the owner acts on it, then deletes it
//   <dir>/pins.json                      [{path, workspaceFile}]
//
// Other windows write into this folder at any moment (and a crash can leave anything behind), so every write is a
// temp file + rename and every read skips what is missing, half written or not ours.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { privateFolder, writePrivate } = require("../private-file");

const ALIVE_MS = 3 * 60 * 1000;          // a window that hasn't refreshed `seen` for this long has crashed or hung
const KEEP_MS = 30 * 24 * 60 * 60 * 1000; // closed/dead windows' files are kept this long (their finished chats)
const REQUEST_MS = 30 * 1000;            // a request nobody picked up by then is stale: the owner is gone or busy
const CHANGE_MS = 50;                    // watch events for one write come in bursts

const hex = (n) => crypto.randomBytes(n).toString("hex");
const defaultAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

// A window id becomes a file and a folder name, and other windows write what we read: nothing but plain names.
const plainId = (id) => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !id.includes("..");

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; }
}

// Temp file in the same folder (a rename can't cross disks), named so no reader mistakes it for a record.
function writeAtomic(file, text) {
  const tmp = path.join(path.dirname(file), `.tmp-${process.pid}-${hex(4)}`);
  try {
    writePrivate(tmp, text);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* never written */ }
    throw e;
  }
}

function remove(file) { try { fs.unlinkSync(file); } catch { /* gone already */ } }
function removeDir(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
function names(dir) { try { return fs.readdirSync(dir); } catch { return []; } }

const isRecord = (name) => name.endsWith(".json") && !name.startsWith(".");

class ProjectStatus {
  constructor({
    dir, windowId = `${process.pid}-${hex(4)}`, pid = process.pid, now = Date.now, isAlive = defaultAlive,
    debounceMs = 300, heartbeatMs = 60000, pollMs = 5000,
  } = {}) {
    if (!dir) throw new Error("ProjectStatus needs a folder");
    if (!plainId(windowId)) throw new Error("ProjectStatus: windowId must be a plain name");
    Object.assign(this, { dir, windowId, pid, now, isAlive, debounceMs, heartbeatMs, pollMs });
    this.windows = path.join(dir, "windows");
    this.inbox = path.join(dir, "inbox");
    this.pinsFile = path.join(dir, "pins.json");
    this.state = null;        // what publish() last got
    this.dirty = false;       // not written yet
    this.timers = { debounce: null, heartbeat: null, poll: null, change: null, requests: null };
    this.watchers = [];
    this.changeListeners = new Set();
    this.requestListeners = new Set();
    this.signature = "";
    this.started = false;
    this.disposed = false;
  }

  get ownFile() { return path.join(this.windows, `${this.windowId}.json`); }
  get ownInbox() { return path.join(this.inbox, this.windowId); }

  start() {
    if (this.started || this.disposed) return;
    this.started = true;
    privateFolder(this.windows);
    privateFolder(this.ownInbox);
    this.signature = this.sign();
    this.timers.heartbeat = setInterval(() => { if (this.state && !this.disposed) this.flush(); }, this.heartbeatMs);
    // Watching is quick but not dependable everywhere (network disks, some containers): the poll is the safety net.
    this.timers.poll = setInterval(() => this.poll(), this.pollMs);
    for (const t of [this.timers.heartbeat, this.timers.poll]) if (t.unref) t.unref();
    this.watch(this.windows, () => this.changed());
    this.watch(this.dir, (file) => { if (file === "pins.json") this.changed(); });
    this.watch(this.ownInbox, () => this.later("requests", 20, () => this.takeRequests()));
    this.prune();
  }

  watch(target, onEvent) {
    try {
      const w = fs.watch(target, (_event, file) => onEvent(file ? String(file) : ""));
      w.on("error", () => { /* the poll carries on */ });
      this.watchers.push(w);
    } catch { /* the poll carries on */ }
  }

  // One pending timer per purpose: events that arrive while it waits are covered by it.
  later(name, ms, fn) {
    if (this.disposed || this.timers[name]) return;
    this.timers[name] = setTimeout(() => { this.timers[name] = null; if (!this.disposed) fn(); }, ms);
    if (this.timers[name].unref) this.timers[name].unref();
  }

  // ----- this window's file -----

  publish(state) {
    if (this.disposed) return;
    this.state = { ...state, chats: (state.chats || []).map((c) => ({ ...c })) };
    this.dirty = true;
    this.later("debounce", this.debounceMs, () => this.flush());
  }

  body(closed) {
    const state = this.state || {};
    const chats = closed ? (state.chats || []).filter((c) => c.state === "done") : state.chats || [];
    return { ...state, chats, v: 1, windowId: this.windowId, pid: this.pid, seen: this.now(), closed: !!closed };
  }

  flush() {
    if (this.timers.debounce) { clearTimeout(this.timers.debounce); this.timers.debounce = null; }
    if (!this.state) return;
    this.dirty = false;
    try { privateFolder(this.windows); writeAtomic(this.ownFile, JSON.stringify(this.body(false))); } catch { /* disk full or folder gone: the next write tries again */ }
  }

  dispose({ closed = true } = {}) {
    if (this.disposed) return;
    if (closed && this.state) {
      try { privateFolder(this.windows); writeAtomic(this.ownFile, JSON.stringify(this.body(true))); } catch { /* nothing more to do */ }
      this.dirty = false;
    } else if (this.dirty) this.flush();
    this.disposed = true;
    for (const k of Object.keys(this.timers)) { clearTimeout(this.timers[k]); clearInterval(this.timers[k]); this.timers[k] = null; }
    for (const w of this.watchers) { try { w.close(); } catch { /* closed */ } }
    this.watchers = [];
    this.changeListeners.clear();
    this.requestListeners.clear();
  }

  // ----- the other windows -----

  readAll() {
    if (this.dirty) this.flush(); // our own entry is what we last published, not what the timer hasn't written yet
    const out = [];
    const t = this.now();
    for (const name of names(this.windows)) {
      if (!isRecord(name)) continue;
      const rec = readJson(path.join(this.windows, name));
      if (!rec || typeof rec !== "object" || Array.isArray(rec) || rec.v !== 1) continue;
      const windowId = name.slice(0, -5); // the name is what the file system says; the content is only a claim
      if (!plainId(windowId)) continue;
      const own = windowId === this.windowId;
      const alive = own || (!rec.closed && t - Number(rec.seen) < ALIVE_MS && this.isAlive(rec.pid));
      out.push({ ...rec, windowId, alive: !!alive });
    }
    return out;
  }

  // A project that opens again replaces its old entry (closed, or crashed) instead of listing twice.
  adopt(key) {
    if (!key) return;
    for (const w of this.readAll()) {
      if (w.windowId === this.windowId || w.alive || w.key !== key) continue;
      remove(path.join(this.windows, `${w.windowId}.json`));
      removeDir(path.join(this.inbox, w.windowId));
    }
  }

  prune() {
    const t = this.now();
    for (const w of this.readAll()) {
      if (w.alive || t - Number(w.seen) < KEEP_MS) continue;
      remove(path.join(this.windows, `${w.windowId}.json`));
      removeDir(path.join(this.inbox, w.windowId));
    }
    for (const id of names(this.inbox)) {
      const folder = path.join(this.inbox, id);
      for (const name of names(folder)) {
        if (isRecord(name) && t - this.requestTime(folder, name) > REQUEST_MS) remove(path.join(folder, name));
        else if (name.startsWith(".tmp-")) { try { if (Date.now() - fs.statSync(path.join(folder, name)).mtimeMs > REQUEST_MS) remove(path.join(folder, name)); } catch { /* gone */ } }
      }
      // A folder of a window that never wrote a file (or whose file is long gone) and has nothing in it.
      if (id !== this.windowId && !fs.existsSync(path.join(this.windows, `${id}.json`)) && !names(folder).length) {
        try { if (Date.now() - fs.statSync(folder).mtimeMs > KEEP_MS) fs.rmdirSync(folder); } catch { /* in use */ }
      }
    }
  }

  // ----- requests -----

  send(windowId, request) {
    if (!plainId(windowId)) throw new Error("send: not a window id");
    const folder = path.join(this.inbox, windowId);
    const file = path.join(folder, `${String(this.now()).padStart(15, "0")}-${hex(4)}.json`);
    const text = JSON.stringify(request);
    try { writeAtomic(file, text); } catch (e) {
      if (e.code !== "ENOENT") throw e;
      privateFolder(folder); // a prune removed the empty folder between the mkdir and the rename
      writeAtomic(file, text);
    }
  }

  // The time a request was sent: its name starts with it (our clock, so tests can fake it); else the file's own.
  requestTime(folder, name) {
    const m = /^(\d{15})-/.exec(name);
    if (m) return Number(m[1]);
    try { return fs.statSync(path.join(folder, name)).mtimeMs; } catch { return 0; }
  }

  onRequest(cb) {
    this.requestListeners.add(cb);
    if (this.started) this.later("requests", 0, () => this.takeRequests());
    return () => this.requestListeners.delete(cb);
  }

  takeRequests() {
    // With nobody listening the requests stay (a window that is still starting up); prune drops them after 30 s.
    if (!this.requestListeners.size) return;
    const t = this.now();
    const files = names(this.ownInbox).filter(isRecord).sort();
    for (const name of files) {
      const file = path.join(this.ownInbox, name);
      const stale = t - this.requestTime(this.ownInbox, name) > REQUEST_MS;
      const request = stale ? undefined : readJson(file);
      if (!stale && request === undefined) {
        // Unreadable: written by something that isn't us, or cut off. Leave a fresh one a moment, drop an old one.
        try { if (Date.now() - fs.statSync(file).mtimeMs < 2000) continue; } catch { continue; }
      }
      remove(file);
      if (!request || typeof request !== "object" || typeof request.type !== "string") continue;
      for (const cb of [...this.requestListeners]) { try { cb(request); } catch { /* one listener's trouble isn't another's */ } }
    }
  }

  // ----- changes -----

  onChange(cb) {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }

  sign() {
    const parts = [];
    for (const name of names(this.windows).filter(isRecord).sort()) {
      try { const s = fs.statSync(path.join(this.windows, name)); parts.push(`${name}:${s.mtimeMs}:${s.size}`); } catch { /* gone */ }
    }
    try { const s = fs.statSync(this.pinsFile); parts.push(`pins:${s.mtimeMs}:${s.size}`); } catch { parts.push("pins:-"); }
    return parts.join("|");
  }

  changed() {
    this.later("change", CHANGE_MS, () => {
      this.signature = this.sign();
      for (const cb of [...this.changeListeners]) { try { cb(); } catch { /* ignore */ } }
    });
  }

  poll() {
    if (this.sign() !== this.signature) this.changed();
    this.takeRequests();
  }

  // ----- pins -----

  readPins() {
    const list = readJson(this.pinsFile);
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const p of list) {
      if (!p || typeof p.path !== "string" || !p.path) continue;
      out.push({ path: p.path, workspaceFile: typeof p.workspaceFile === "string" && p.workspaceFile ? p.workspaceFile : null });
    }
    return out;
  }

  setPinned(entry, on) {
    if (!entry || typeof entry.path !== "string" || !entry.path) return;
    const rest = this.readPins().filter((p) => p.path !== entry.path);
    if (on) rest.push({ path: entry.path, workspaceFile: entry.workspaceFile || null });
    privateFolder(this.dir);
    writeAtomic(this.pinsFile, JSON.stringify(rest));
  }
}

module.exports = { ProjectStatus };
