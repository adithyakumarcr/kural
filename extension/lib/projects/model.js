// What the Projects bar draws, worked out from the windows' status files (status.js), the pins and VS Code's recent
// list. Pure functions: the view only has to draw the result. No vscode inside.
const os = require("os");
const path = require("path");

const WORKSPACE_EXT = /\.code-workspace$/i;
const ORDER = { ask: 0, done: 1, run: 2, idle: 3 };
// A project's letter tile when it has no Workspace Color: calm, distinct colors, none of them Kural's purple (Adithya,
// 25 Oct 2026, from the design mockup). The same project always gets the same one.
const PALETTE = ["#4f7fb0", "#b0715a", "#4f8a6b", "#5f6b7a", "#8a6b3f", "#3f7a8a", "#9a5f6b", "#6f7a45"];
function colorFor(key) {
  let h = 0;
  for (const ch of String(key || "")) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// The path rules of a system. `platform` is injectable so Windows can be tested on a Mac; the running system's own
// `path` is used when it is the one asked for (as before), the others come from path.win32 / path.posix.
function pathApi(platform = process.platform) {
  if (platform === process.platform) return path;
  return platform === "win32" ? path.win32 : path.posix;
}

// What identifies a folder. On Windows the file system ignores case, VS Code gives "c:\Code\App" for a folder a dialog
// calls "C:\code\app\", and "/" and "\" mean the same: all of those are one key (lower case, "\", no trailing "\").
// Mac and Linux keep case: two folders that differ in case are two folders there. (A key is only an identity: the
// original spelling of the path is what the page shows.)
function pathKey(p, platform = process.platform) {
  if (typeof p !== "string" || !p) return null;
  return platform === "win32" ? winTidy(p).toLowerCase() : pathApi(platform).resolve(p);
}

// A Windows path with "\\" for separators, "." and ".." worked out, no trailing separator (except on a root), spelling kept.
function winTidy(p) {
  let n = path.win32.normalize(p);
  const root = path.win32.parse(n).root;
  while (n.length > root.length && /[\\/]$/.test(n)) n = n.slice(0, -1);
  return n;
}

// The same place? (Windows: compared by key; elsewhere: the paths, resolved, exactly.)
function samePath(a, b, platform = process.platform) {
  const x = pathKey(a, platform);
  return x !== null && x === pathKey(b, platform);
}

// Two keys (from status files) for the same project? A key written by an older Kural may not be normalised yet.
function sameKey(a, b, platform = process.platform) {
  if (!a || !b) return false;
  return platform === "win32" ? pathKey(a, platform) === pathKey(b, platform) : a === b;
}

// One project is one folder, or one .code-workspace file; a window with neither has no project.
function keyOf({ folders, workspaceFile } = {}, { platform = process.platform } = {}) {
  if (workspaceFile) return pathKey(workspaceFile, platform);
  if (folders && folders[0]) return pathKey(folders[0], platform);
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

function nameOf(p, fallback, platform) {
  const base = pathApi(platform).basename(p.workspaceFile || p.path || "").replace(WORKSPACE_EXT, "");
  return base || fallback || p.path || "";
}

// "/home/ada/proj" → "~/proj". On Windows the home is "C:\Users\ada", written with either separator and any case
// of the drive letter and the names; the rest keeps the spelling it came with.
function shorten(p, home, platform = process.platform) {
  if (!p || !home) return p || "";
  if (platform === "win32") {
    const h = winTidy(home), n = winTidy(p), lh = h.toLowerCase(), ln = n.toLowerCase();
    if (ln === lh) return "~";
    return ln.startsWith(lh.endsWith("\\") ? lh : lh + "\\") ? "~" + (h.endsWith("\\") ? "\\" : "") + n.slice(h.length) : p;
  }
  if (p === home) return "~";
  return p.startsWith(home + "/") ? "~" + p.slice(home.length) : p;
}

function labelOf(chat, now) {
  if (chat.state === "run") return "Working";
  if (chat.state === "ask") return chat.ask || "Needs you";
  if (chat.state === "done") return typeof chat.doneAt === "number" ? `Done · ${ago(chat.doneAt, now)}` : "Done";
  return "";
}

// A project's second line, only when there's news (no path or branch: those are in the tooltip).
function newsOf(chats, here) {
  const ask = chats.find((c) => c.state === "ask"), run = chats.find((c) => c.state === "run");
  const unseen = chats.filter((c) => c.state === "done").length;
  if (ask) return { kind: "ask", text: `Waiting for you: ${ask.ask || "a question"}` };
  if (run) return { kind: "run", text: `Working · ${run.title}` };
  if (unseen && !here) return { kind: "done", text: unseen === 1 ? "1 new answer" : `${unseen} new answers` };
  return null;
}

// A chat with nothing in it yet ("New chat", nothing sent) isn't listed unless it's working or waiting.
function chatsOf(list, now) {
  return chatOrder((list || []).filter((c) => !(c && c.empty && !(c.state in { run: 1, ask: 1 }))).map((c) => ({
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

// ---------- a project's History (every saved chat of it, from lib/chat/archive.js's cards) ----------
const HISTORY_MAX = 300;   // cards sent to the page per project; it pages through them ("Show N more")

// A card's workspace is {key, name, open}: key = the folders' uri paths joined by "|" (lib/workspace.js), open = the
// workspace file or the first folder. A uri path on Windows is "/c:/Code/App": the drive's own spelling is "c:\Code\App".
function fsOf(p, platform) {
  const s = String(p || "");
  return platform === "win32" && /^\/[a-zA-Z]:/.test(s) ? s.slice(1) : s;
}

// Does this saved chat belong to the project? Same key, or its folder / workspace file is the project's.
function belongs(meta, p, platform = process.platform) {
  const w = meta && meta.workspace;
  if (!w) return false;
  if (w.key && sameKey(w.key, p.key, platform)) return true;
  const mine = [p.workspaceFile, p.path].filter(Boolean);
  const theirs = [w.open, String(w.key || "").split("|")[0]].filter(Boolean).map((x) => fsOf(x, platform));
  return theirs.some((t) => mine.some((m) => samePath(t, m, platform)));
}

// The project's saved chats, newest first, without the ones its window shows as open chats (`exclude`: ids).
function historyOf(metas, p, { exclude = new Set(), now = Date.now(), platform = process.platform } = {}) {
  return (metas || []).filter((m) => m && m.id && !exclude.has(m.id) && belongs(m, p, platform))
    .map((m) => ({ id: m.id, title: String(m.title || m.preview || "Chat"), when: Number(m.when) || 0, count: Number(m.count) || 0 }))
    .sort((a, b) => b.when - a.when)
    .map((h) => ({ ...h, ago: h.when ? ago(h.when, now) : "" }));
}

// `archive`: the History cards (null = not read: no project's History is open, nothing is searched). `historyOpen`: keys of
// the projects whose History is unfolded; only those (and everything while searching) get their items.
function buildModel({ windows = [], pins = [], recent = [], here = null, query = "", home = os.homedir(), now = Date.now(), platform = process.platform, archive = null, historyOpen = [] } = {}) {
  const api = pathApi(platform);
  const byKey = new Map();
  for (const w of windows) {
    // (a status file's key was made by another window: on Windows it is normalised again, an old one may not be)
    const key = w.key ? (platform === "win32" ? pathKey(w.key, platform) : w.key) : keyOf(w, { platform });
    if (!key) continue; // no folder open: nothing to list
    if (better(w, byKey.get(key), here)) byKey.set(key, w);
  }

  const make = (key, base, w) => {
    const open = !!(w && w.alive);
    // A closed or crashed window only keeps what is unseen and finished.
    const chats = chatsOf(w && w.chats, now).filter((c) => open || c.state === "done");
    const folder = w && w.folders && w.folders[0];
    const p = folder || base.path || (base.workspaceFile ? api.dirname(base.workspaceFile) : "");
    const workspaceFile = (w ? w.workspaceFile : base.workspaceFile) || null;
    const name = (w && w.name) || nameOf({ path: p, workspaceFile }, base.label, platform);
    const isHere = open && w.windowId === here;
    return {
      key, name, letter: (name.trim()[0] || "?").toUpperCase(), color: (w && w.color) || colorFor(key),
      path: p, workspaceFile, shortPath: shorten(p, home, platform), branch: (w && w.branch) || null,
      open, here: isHere, windowId: open ? w.windowId : null, pinned: false,
      unseen: chats.filter((c) => c.state === "done").length,
      attention: chats.some((c) => c.state === "ask") ? "ask" : chats.some((c) => c.state === "run") ? "run" : null,
      news: newsOf(chats, isHere), chats,
    };
  };

  const used = new Set();
  const take = (entry) => {
    const key = keyOf({ folders: [entry.path], workspaceFile: entry.workspaceFile }, { platform });
    if (!key || used.has(key)) return null;
    used.add(key);
    return make(key, entry, byKey.get(key));
  };

  const pinned = [];
  for (const entry of pins) { const p = take(entry); if (p) { p.pinned = true; pinned.push(p); } }

  const live = [...byKey.entries()].filter(([key, w]) => w.alive && !used.has(key));
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.key.localeCompare(b.key);
  // By name only: the project you switch to stays where it is (Adithya, 25 Oct 2026: like a chat list in Teams; it
  // jumped to the top before), and its tinted card shows which one is here.
  const open = live.map(([key, w]) => { used.add(key); return make(key, {}, w); }).sort(byName);

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
  const unfolded = new Set(historyOpen || []);
  for (const p of all) {
    const want = unfolded.has(p.key) || !!q;
    const items = archive && want ? historyOf(archive, p, { exclude: new Set(p.chats.map((c) => c.id)), now, platform }) : [];
    p.history = { open: unfolded.has(p.key), loaded: !!(archive && want), total: items.length, items: items.slice(0, HISTORY_MAX) };
  }
  const filter = (p) => {
    if (!q) return p;
    if (p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)) return p;
    const hit = p.chats.filter((c) => c.title.toLowerCase().includes(q));
    const past = p.history.items.filter((h) => h.title.toLowerCase().includes(q));
    return hit.length || past.length ? { ...p, chats: hit, history: { ...p.history, total: past.length, items: past } } : null;
  };
  const sections = [["pinned", "Pinned", pinned], ["open", "Open", open], ["recent", "Recent", recents]]
    .map(([id, title, list]) => ({ id, title, projects: list.map(filter).filter(Boolean) }))
    .filter((s) => s.projects.length);

  return { sections, badge, needLook };
}

module.exports = { historyOf, belongs, HISTORY_MAX, keyOf, pathKey, samePath, sameKey, shorten, chatOrder, buildModel, ago, colorFor, PALETTE };
