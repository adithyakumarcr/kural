// What the Projects bar draws, worked out from the windows' status files (status.js), the pins and VS Code's recent
// list. Pure functions: the view only has to draw the result. No vscode inside.
const os = require("os");
const path = require("path");

const WORKSPACE_EXT = /\.code-workspace$/i;
const ORDER = { ask: 0, done: 1, run: 2, idle: 3 };

// One project is one folder, or one .code-workspace file; a window with neither has no project.
function keyOf({ folders, workspaceFile } = {}) {
  if (workspaceFile) return path.resolve(workspaceFile);
  if (folders && folders[0]) return path.resolve(folders[0]);
  return null;
}

// Waiting for you first, then finished, then working, then the rest; inside a group the tab order stays.
function chatOrder(chats) {
  const rank = (c) => (c.state in ORDER ? ORDER[c.state] : ORDER.idle);
  return (chats || []).map((c, i) => [c, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
}

// "5 min ago": elapsed time, not calendar days, so it reads the same at any hour.
function ago(at, now = Date.now()) {
  const s = Math.max(0, now - at) / 1000;
  if (s < 60) return "just now";
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  if (h < 48) return "yesterday";
  return `${Math.floor(h / 24)} days ago`;
}

function nameOf(p, fallback) {
  const base = path.basename(p.workspaceFile || p.path || "").replace(WORKSPACE_EXT, "");
  return base || fallback || p.path || "";
}

function shorten(p, home) {
  if (!p || !home) return p || "";
  if (p === home) return "~";
  return p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p;
}

function labelOf(chat, now) {
  if (chat.state === "run") return "Working";
  if (chat.state === "ask") return chat.ask || "Needs you";
  if (chat.state === "done") return typeof chat.doneAt === "number" ? `Done · ${ago(chat.doneAt, now)}` : "Done";
  return chat.onScreen ? "on screen" : "";
}

function chatsOf(list, now) {
  return chatOrder((list || []).map((c) => ({
    id: c.id, title: typeof c.title === "string" ? c.title : "", state: c.state in ORDER ? c.state : "idle",
    ask: typeof c.ask === "string" ? c.ask : "", doneAt: typeof c.doneAt === "number" ? c.doneAt : null, onScreen: !!c.onScreen,
  }))).map((c) => ({ ...c, label: labelOf(c, now) }));
}

// Of several status files for one project: a live one beats a dead one, this window's beats another live one,
// then the one that was seen last.
function better(a, b, here) {
  if (!b) return true;
  if (a.alive !== b.alive) return a.alive;
  if ((a.windowId === here) !== (b.windowId === here)) return a.windowId === here;
  return (Number(a.seen) || 0) > (Number(b.seen) || 0);
}

function buildModel({ windows = [], pins = [], recent = [], here = null, query = "", home = os.homedir(), now = Date.now() } = {}) {
  const byKey = new Map();
  for (const w of windows) {
    const key = w.key || keyOf(w);
    if (!key) continue; // no folder open: nothing to list
    if (better(w, byKey.get(key), here)) byKey.set(key, w);
  }

  const make = (key, base, w) => {
    const open = !!(w && w.alive);
    // A closed or crashed window only keeps what is unseen and finished.
    const chats = chatsOf(w && w.chats, now).filter((c) => open || c.state === "done");
    const folder = w && w.folders && w.folders[0];
    const p = folder || base.path || (base.workspaceFile ? path.dirname(base.workspaceFile) : "");
    const workspaceFile = (w ? w.workspaceFile : base.workspaceFile) || null;
    const name = (w && w.name) || nameOf({ path: p, workspaceFile }, base.label);
    return {
      key, name, letter: (name.trim()[0] || "?").toUpperCase(), color: (w && w.color) || null,
      path: p, workspaceFile, shortPath: shorten(p, home), branch: (w && w.branch) || null,
      open, here: open && w.windowId === here, windowId: open ? w.windowId : null, pinned: false,
      unseen: chats.filter((c) => c.state === "done").length,
      attention: chats.some((c) => c.state === "ask") ? "ask" : chats.some((c) => c.state === "run") ? "run" : null,
      chats,
    };
  };

  const used = new Set();
  const take = (entry) => {
    const key = keyOf({ folders: [entry.path], workspaceFile: entry.workspaceFile });
    if (!key || used.has(key)) return null;
    used.add(key);
    return make(key, entry, byKey.get(key));
  };

  const pinned = [];
  for (const entry of pins) { const p = take(entry); if (p) { p.pinned = true; pinned.push(p); } }

  const live = [...byKey.entries()].filter(([key, w]) => w.alive && !used.has(key));
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.key.localeCompare(b.key);
  const open = live.map(([key, w]) => { used.add(key); return make(key, {}, w); })
    .sort((a, b) => (b.here - a.here) || byName(a, b));

  const recents = [];
  for (const entry of recent) { const p = take(entry); if (p) recents.push(p); }
  // A project that closed with finished answers you haven't seen stays reachable even when it left the recent list.
  const extras = [...byKey.entries()].filter(([key, w]) => !used.has(key) && !w.alive)
    .map(([key, w]) => make(key, {}, w)).filter((p) => p.unseen > 0)
    .sort((a, b) => (byKey.get(b.key).seen || 0) - (byKey.get(a.key).seen || 0));
  recents.push(...extras);

  const all = [...pinned, ...open, ...recents];
  let badge = 0, needLook = 0;
  for (const p of all) {
    const asking = p.chats.filter((c) => c.state === "ask" && !(p.here && c.onScreen)).length;
    badge += asking + (p.here ? 0 : p.unseen);
    if (!p.here && (p.unseen > 0 || p.chats.some((c) => c.state === "ask"))) needLook++;
  }

  const q = String(query || "").trim().toLowerCase();
  const filter = (p) => {
    if (!q) return p;
    if (p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)) return p;
    const hit = p.chats.filter((c) => c.title.toLowerCase().includes(q));
    return hit.length ? { ...p, chats: hit } : null;
  };
  const sections = [["pinned", "Pinned", pinned], ["open", "Open", open], ["recent", "Recent", recents]]
    .map(([id, title, list]) => ({ id, title, projects: list.map(filter).filter(Boolean) }))
    .filter((s) => s.projects.length);

  return { sections, badge, needLook };
}

module.exports = { keyOf, chatOrder, buildModel, ago };
