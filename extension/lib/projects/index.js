// Projects bar: every project with a Kural window, and every chat in it, in one list (the Projects tab, first in the left
// bar). Design: docs/superpowers/specs/2026-10-24-projects-bar-design.md.
// One window per project (VS Code's). This file is the part that needs vscode:
//   - it publishes THIS window's state (project, color, branch, focus, chats) into the shared folder through
//     lib/projects/status.js, and reads every window's back;
//   - lib/projects/model.js turns that, the pins and VS Code's recent list into sections and rows; media/projects.js draws them;
//   - clicks: bring a project's window forward (vscode.openFolder finds the window that has it), show a chat there, pin,
//     close a project (asked first), remove from Recent, open / clone / make a project;
//   - requests from other windows (show a chat, close, a card) come in through status.onRequest.
// The Open Recent list, the badge on the left bar's icon and the status bar item ("N projects need a look") follow the model.
const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const scope = require("../profiles/scope");
const { isProtected } = require("../paths");
const { findGit } = require("../git");
const { fontScale, watchFontScale } = require("../ui");

const CARD_MS = 12000;
const FOLDED_KEY = "kural.projects.folded.v1";
const PARENT_KEY = "kural.projects.lastParent.v1";
const BAD_NAME = /[\\/:]/;

const isFile = (u) => !!u && u.scheme === "file";
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// "Tune the arc model" is done → "weld-sim: Tune the arc model is done"; a title that names the project already stays.
const withName = (name, title) => (!name || String(title).startsWith(name) ? String(title) : `${name}: ${title}`);

class Projects {
  constructor(context, { chat, log, deps = {} }) {
    this.context = context;
    this.chat = chat;
    this.log = log || (() => {});
    this.d = deps;
    // (deps: stand-ins for tests; the real modules are loaded only when none is given.)
    this.model = deps.model || require("./model");
    this.status = deps.statusStore ||
      new (deps.ProjectStatus || require("./status").ProjectStatus)({ dir: scope.dir("projects", "data", context.globalStorageUri && context.globalStorageUri.fsPath) });
    this.views = new Set();
    this.recent = [];                // [{ path, workspaceFile }] from File → Open Recent
    this.built = { sections: [], badge: 0, needLook: 0 };
    this.query = "";
    this.folded = new Set(context.globalState.get(FOLDED_KEY) || []);
    this.branch = "";
    this.timers = {};
    this.item = null;
    this.oneFrame = false;           // true when Kural's own build puts every project in one window frame (see detectOneFrame)
  }

  // ---------- this window ----------
  folders() { return (vscode.workspace.workspaceFolders || []).filter((f) => isFile(f.uri)).map((f) => f.uri.fsPath); }
  workspaceFile() { const f = vscode.workspace.workspaceFile; return isFile(f) ? f.fsPath : null; }
  key() {
    const folders = this.folders(), workspaceFile = this.workspaceFile();
    return folders.length || workspaceFile ? this.model.keyOf({ folders, workspaceFile }) : null;
  }
  name() {
    const wf = this.workspaceFile(), f = this.folders();
    if (wf) return path.basename(wf).replace(/\.code-workspace$/i, "");
    if (!f.length) return "";
    return f.length === 1 ? path.basename(f[0]) : `${path.basename(f[0])} +${f.length - 1}`;
  }
  color() { const c = vscode.workspace.getConfiguration("kural").get("workspaceColor"); return /^#[0-9a-f]{6}$/i.test(c || "") ? c.toLowerCase() : null; }
  chats() { try { return this.chat.projectChats() || []; } catch (e) { this.log(`projects: chats: ${e.message}`); return []; } }
  state() {
    const key = this.key();
    return { key, name: this.name(), folders: this.folders(), workspaceFile: this.workspaceFile(), color: this.color(), branch: this.branch,
      focused: !!(vscode.window.state && vscode.window.state.focused), chats: this.chats() };
  }
  publish() {
    const s = this.state();
    if (s.key !== this.published) { this.published = s.key; if (s.key) this.status.adopt(s.key); }
    this.status.publish(s);
    this.refresh();
  }
  working() { return this.chats().filter((c) => c.state === "run" || c.state === "ask"); }

  // ---------- the branch (the git extension) ----------
  async watchGit() {
    const ext = vscode.extensions.getExtension("vscode.git");
    if (!ext) return;
    try {
      const exports = ext.isActive ? ext.exports : await ext.activate();
      const api = exports && exports.enabled !== false ? exports.getAPI(1) : null;
      if (!api) return;
      const seen = new Set();
      const watch = (repo) => {
        if (seen.has(repo)) return;
        seen.add(repo);
        if (repo.state && repo.state.onDidChange) this.context.subscriptions.push(repo.state.onDidChange(() => this.readBranch(api)));
      };
      api.repositories.forEach(watch);
      this.context.subscriptions.push(api.onDidOpenRepository((r) => { watch(r); this.readBranch(api); }), api.onDidCloseRepository(() => this.readBranch(api)));
      this.readBranch(api);
    } catch (e) { this.log(`projects: git: ${e.message}`); }
  }
  readBranch(api) {
    const first = this.folders()[0];
    const repos = api.repositories || [];
    const repo = repos.find((r) => r.rootUri && r.rootUri.fsPath === first) || repos[0];
    const head = repo && repo.state && repo.state.HEAD;
    const name = (head && head.name) || "";
    if (name !== this.branch) { this.branch = name; this.publish(); }
  }

  // ---------- one frame ----------
  // Kural built from source has `_kural.oneFrame` (patches/kural/0100-one-frame-windows.patch): every project keeps its own
  // window, but only one is visible; a window that is opened or brought forward takes the visible one's place and that one is
  // hidden, not closed, so its chats keep running. With it on, a project that isn't open opens in a new window and nothing
  // is stopped. Without it (VSCodium's build) or with `kural.window.oneFrame` off, opening a project reloads this window.
  // (getCommands(false): `true` leaves out the commands that start with an underscore, this one too.)
  async detectOneFrame() {
    try {
      const have = (await vscode.commands.getCommands()).includes("_kural.oneFrame");
      const r = have ? await vscode.commands.executeCommand("_kural.oneFrame") : null;
      this.oneFrame = !!(r && r.enabled);
    } catch (e) { this.oneFrame = false; this.log(`projects: one frame: ${e.message}`); }
  }

  // ---------- Open Recent ----------
  async loadRecent() {
    try {
      const r = (await vscode.commands.executeCommand("_workbench.getRecentlyOpened")) || {};
      const out = [];
      for (const w of r.workspaces || []) {
        if (w.folderUri) { if (isFile(w.folderUri)) out.push({ path: w.folderUri.fsPath, workspaceFile: null }); }
        else if (w.workspace && w.workspace.configPath) { const c = w.workspace.configPath; if (isFile(c)) out.push({ path: path.dirname(c.fsPath), workspaceFile: c.fsPath }); }
      }
      this.recent = out;
    } catch (e) { this.log(`projects: recent list: ${e.message}`); }
    this.refresh();
  }

  // ---------- the model and what shows it ----------
  later(name, ms, fn) { clearTimeout(this.timers[name]); this.timers[name] = setTimeout(fn, ms); }
  refresh() { this.later("refresh", 60, () => this.rebuild()); }
  rebuild() {
    let windows = [];
    try { windows = this.status.readAll(); } catch (e) { this.log(`projects: reading windows: ${e.message}`); }
    let pins = [];
    try { pins = this.status.readPins(); } catch (e) { this.log(`projects: reading pins: ${e.message}`); }
    // (`here` is this window's id: the model needs it before it counts the badge, where this window's own chats don't count.)
    this.built = this.model.buildModel({ windows, pins, recent: this.recent, here: this.status.windowId, query: this.query });
    this.show();
  }
  show() {
    const m = this.built, names = m.needLook;
    for (const v of this.views) {
      v.badge = m.badge ? { value: m.badge, tooltip: plural(m.badge, "chat needs a look", "chats need a look") } : undefined;
      v.webview.postMessage(this.message());
    }
    if (this.item) {
      if (names > 0) {
        this.item.text = `$(folder-library) ${plural(names, "project needs", "projects need")} a look`;
        this.item.tooltip = "Finished or waiting chats in other projects";
        this.item.show();
      } else this.item.hide();
    }
  }
  message() { return { type: "model", sections: this.built.sections, badge: this.built.badge, query: this.query, folded: [...this.folded] }; }
  find(key) {
    for (const s of this.built.sections) for (const p of s.projects) if (p.key === key) return p;
    return null;
  }

  // ---------- the view ----------
  register() {
    const c = this.context, sub = c.subscriptions;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
    this.item.command = "kural.projects.show";
    sub.push(this.item, vscode.window.registerWebviewViewProvider("kural.projects", { resolveWebviewView: (v) => this.resolve(v) }));
    sub.push(
      vscode.commands.registerCommand("kural.projects.show", () => vscode.commands.executeCommand("workbench.view.extension.kural-projects")),
      vscode.commands.registerCommand("kural.projects.open", () => this.pickFolder()),
      vscode.commands.registerCommand("kural.projects.newProject", () => this.newProject()),
      vscode.commands.registerCommand("kural.projects.clone", () => vscode.commands.executeCommand("git.clone")),
      vscode.commands.registerCommand("kural.projects.collapseAll", () => this.collapseAll()),
      vscode.window.onDidChangeWindowState(() => { this.publish(); if (vscode.window.state.focused) this.loadRecent(); }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.publish()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("kural.workspaceColor")) this.publish();
        if (e.affectsConfiguration("kural.window.oneFrame")) this.detectOneFrame();
      }),
      { dispose: () => this.stop() },
    );
    watchFontScale(c, (m) => { for (const v of this.views) v.webview.postMessage(m); });
    // (The chat tells when a tab's state changes: working, waiting for you, finished, seen.)
    const prev = this.chat.onChatsChanged;
    this.chat.onChatsChanged = () => { if (typeof prev === "function") prev(); this.publish(); };
    this.chat.cardElsewhere = (info) => this.cardElsewhere(info);

    this.status.start();
    this.status.onRequest((r) => this.onRequest(r).catch((e) => this.log(`projects: request ${r && r.type}: ${e.message}`)));
    this.status.onChange(() => this.refresh());
    this.publish();
    try { this.status.prune(); } catch (e) { this.log(`projects: prune: ${e.message}`); }
    this.loadRecent();
    this.watchGit();
    this.detectOneFrame();
    // (Without the workbench patch that opens it, Kural opens Projects when a window starts.)
    this.later("open", 800, () => vscode.commands.executeCommand("workbench.view.extension.kural-projects"));
  }
  stop() {
    for (const t of Object.values(this.timers)) clearTimeout(t);
    try { this.status.dispose({ closed: true }); } catch (e) { this.log(`projects: closing: ${e.message}`); }
  }

  resolve(view) {
    this.views.add(view);
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((m) => this.onMessage(m).catch((e) => this.log(`projects page: ${e.stack}`)));
    view.onDidChangeVisibility(() => { if (view.visible) { this.loadRecent(); this.show(); } });
    view.onDidDispose(() => this.views.delete(view));
  }
  html(webview) {
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const nonce = crypto.randomBytes(16).toString("base64"), uri = (f) => webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    return `<!doctype html><html data-fs="${fontScale()}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${uri("codicons/codicon.css")}"><link rel="stylesheet" href="${uri("projects.css")}"></head>
<body><div id="app"></div><script nonce="${nonce}" src="${uri("projects.js")}"></script></body></html>`;
  }

  // The page sends only keys and ids; what to open comes from the model the host built.
  async onMessage(m) {
    const p = m.key ? this.find(m.key) : null;
    switch (m.type) {
      case "ready": this.query = String(m.q || ""); this.rebuild(); this.loadRecent(); break;
      case "search": this.query = String(m.q || ""); this.rebuild(); break;
      case "fold": if (m.key) { if (m.folded) this.folded.add(m.key); else this.folded.delete(m.key); this.saveFolded(); } break;
      case "open": if (p) await this.openProject(p); break;
      case "openChat": if (p) await this.openProject(p, m.chatId); break;
      case "pin": if (p) { this.status.setPinned({ path: p.path, workspaceFile: p.workspaceFile || null }, !p.pinned); this.refresh(); } break;
      case "close": if (p) await this.closeProject(p); break;
      case "removeRecent": if (p) await this.removeRecent(p); break;
      case "log": this.log(`projects page: ${m.message}`); break;
    }
  }
  saveFolded() { this.context.globalState.update(FOLDED_KEY, [...this.folded]); }
  collapseAll() {
    for (const s of this.built.sections) for (const p of s.projects) this.folded.add(p.key);
    this.saveFolded();
    this.show();
  }

  // ---------- going to a project ----------
  uriOf(p) { return vscode.Uri.file(p.workspaceFile || p.path); }
  // A project open in another window: bring that window forward (VS Code looks for it first). One that isn't open
  // (Recent, a pin, Open folder) opens in a new window when windows share one frame (it takes this window's place, this one
  // is hidden, nothing stops). Otherwise it opens in THIS window, like VS Code's own Open Recent (Adithya: a new window per
  // click was too many windows); switching restarts the window, so a chat working or waiting here is named and asked about first.
  async openProject(p, chatId) {
    if (p.here) { if (chatId) await this.chat.showChat(chatId); return; }
    if (p.open) {
      await vscode.commands.executeCommand("vscode.openFolder", this.uriOf(p), { forceNewWindow: true });
      if (chatId && p.windowId) this.status.send(p.windowId, { type: "showChat", chatId });
      return;
    }
    if (this.oneFrame) { await vscode.commands.executeCommand("vscode.openFolder", this.uriOf(p), { forceNewWindow: true }); return; }
    const where = await this.whereToOpen(p);
    if (!where) return;
    await vscode.commands.executeCommand("vscode.openFolder", this.uriOf(p), where === "new" ? { forceNewWindow: true } : { forceReuseWindow: true });
  }
  // "here", "new", or null (the question was closed)
  async whereToOpen(p) {
    const working = this.working();
    if (!working.length) return "here";
    const detail = `${plural(working.length, "chat is", "chats are")} still working or waiting for you in this window. Opening ${p.name} here stops ${working.length === 1 ? "it" : "them"}:\n` +
      working.map((c) => `- ${c.title}${c.state === "ask" ? " (waiting for you)" : ""}`).join("\n") + "\n\nYour chats stay in History and open again with this project.";
    const here = "Open Here", fresh = "Open in New Window";
    const r = await vscode.window.showWarningMessage(`Open ${p.name} in this window?`, { modal: true, detail }, here, fresh);
    return r === here ? "here" : r === fresh ? "new" : null;
  }
  // A folder or workspace file you picked: the same rules, and a project that's open already is brought forward.
  async openPath(fsPath) {
    const isWs = /\.code-workspace$/i.test(fsPath);
    const key = this.model.keyOf({ folders: isWs ? [] : [fsPath], workspaceFile: isWs ? fsPath : null });
    const known = this.find(key) || { key, path: isWs ? path.dirname(fsPath) : fsPath, workspaceFile: isWs ? fsPath : null, open: false };
    await this.openProject(known);
  }
  async pickFolder() {
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: true, canSelectMany: false, openLabel: "Open Project",
      title: "Open a project", filters: { "Workspace files": ["code-workspace"] } });
    if (picked && picked[0] && isFile(picked[0])) await this.openPath(picked[0].fsPath);
  }

  // ---------- closing and forgetting ----------
  async closeProject(p) {
    const working = (p.chats || []).filter((c) => c.state === "run" || c.state === "ask");
    let detail = "";
    if (working.length) {
      detail += `${plural(working.length, "chat is", "chats are")} still working or waiting for you. Closing stops ${working.length === 1 ? "it" : "them"}:\n` +
        working.map((c) => `- ${c.title}${c.state === "ask" ? " (waiting for you)" : ""}`).join("\n") + "\n\n";
    } else detail += `${p.here ? "This window" : "Its window"} closes.\n\n`;
    detail += "Your chats stay in History and open again with the project. If a file isn't saved, you're asked about it first.";
    const button = "Close project";
    const r = await vscode.window.showWarningMessage(`Close ${p.name}?`, { modal: true, detail }, button);
    if (r !== button) return;
    if (p.here) { await vscode.commands.executeCommand("workbench.action.closeWindow"); return; }
    // (Brought forward first: VS Code's own question about unsaved files is then seen in that window.)
    await vscode.commands.executeCommand("vscode.openFolder", this.uriOf(p), { forceNewWindow: true });
    if (p.windowId) this.status.send(p.windowId, { type: "close" });
  }
  async removeRecent(p) {
    try { await vscode.commands.executeCommand("vscode.removeFromRecentlyOpened", p.workspaceFile || p.path); } catch (e) { this.log(`projects: remove from recent: ${e.message}`); }
    await this.loadRecent();
  }

  // ---------- a new project ----------
  parentFolder() {
    const last = this.context.globalState.get(PARENT_KEY);
    const ok = (d) => { try { return fs.statSync(d).isDirectory() && !isProtected(d); } catch { return false; } };
    return last && ok(last) ? last : os.homedir();
  }
  // null when the name is fine, else what's wrong with it
  nameProblem(name, parent) {
    const n = String(name || "").trim();
    if (!n) return "Give the project a name.";
    if (BAD_NAME.test(n)) return "The name can't contain / \\ or :.";
    if (n === "." || n === "..") return "Pick a name for a new folder.";
    if (parent && fs.existsSync(path.join(parent, n))) return `A folder named ${n} already exists in ${parent}.`;
    return null;
  }
  async newProject() {
    const first = this.parentFolder();
    const name = await vscode.window.showInputBox({ title: "New empty project", prompt: "Name of the project (the folder is made for you and set up with Git)",
      placeHolder: "my-project", validateInput: (v) => this.nameProblem(v, first) || undefined });
    if (name === undefined) return;
    const n = name.trim();
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, defaultUri: vscode.Uri.file(first),
      openLabel: "Make It Here", title: `Where should ${n} go?` });
    if (!picked || !picked[0] || !isFile(picked[0])) return;
    const parent = picked[0].fsPath, bad = this.nameProblem(n, parent);
    if (bad) { vscode.window.showErrorMessage(`Kural: ${bad}`); return; }
    const dir = path.join(parent, n);
    try { fs.mkdirSync(dir); } catch (e) { vscode.window.showErrorMessage(`Kural: couldn't make ${dir}: ${e.message}`); return; }
    this.context.globalState.update(PARENT_KEY, parent);
    await this.gitInit(dir);
    await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(dir), { forceNewWindow: true });
  }
  async gitInit(dir) {
    const git = await (this.d.findGit || findGit)();
    if (!git) { vscode.window.showInformationMessage("Kural: made the folder, but there's no Git on this computer, so it isn't set up with Git."); return false; }
    const run = this.d.execFile || execFile;
    const err = await new Promise((resolve) => run(git, ["init"], { cwd: dir, timeout: 20000 }, (e) => resolve(e)));
    if (err) { vscode.window.showWarningMessage(`Kural: made the folder, but git init failed: ${err.message}`); return false; }
    return true;
  }

  // ---------- requests between windows ----------
  windowRecord(id) { try { return this.status.readAll().find((w) => (w.windowId || w.id) === id) || null; } catch { return null; } }
  async onRequest(r) {
    if (!r) return;
    if (r.type === "showChat") await this.chat.showChat(r.chatId);
    else if (r.type === "close") await vscode.commands.executeCommand("workbench.action.closeWindow");
    else if (r.type === "card") await this.card(r);
  }
  // A chat finished (or needs you) in a window that isn't in front: the window that is, shows a card.
  async cardElsewhere({ tabId, title, body }) {
    try {
      const mine = this.status.windowId;
      const front = this.status.readAll().find((w) => (w.windowId || w.id) !== mine && w.focused && !w.closed && w.alive !== false);
      if (!front) return false;
      const s = this.state();
      this.status.send(front.windowId || front.id, { type: "card", from: mine, chatId: tabId, title: withName(s.name, title), body: body || "",
        button: `Go to ${s.name || "chat"}`, color: s.color || null, letter: (s.name || "K").charAt(0).toUpperCase() });
      return true;
    } catch (e) { this.log(`projects: card: ${e.message}`); return false; }
  }
  async card(r) {
    const id = `kural-card-${r.from}-${r.chatId}`;
    let clicked = false;
    const have = await vscode.commands.getCommands().then((l) => l.includes("_kural.card"), () => false);
    if (have) {
      try {
        const a = await vscode.commands.executeCommand("_kural.card", { id, title: r.title, body: r.body, button: r.button, color: r.color, letter: r.letter, timeout: CARD_MS });
        clicked = !!(a && a.clicked);
      } catch (e) { this.log(`projects: card command: ${e.message}`); }
    } else {
      const text = [r.title, r.body].filter(Boolean).join(". ");
      clicked = (await vscode.window.showInformationMessage(text, r.button)) === r.button;
    }
    if (clicked) await this.goBack(r);
  }
  // "Go to weld-sim": that project's window comes forward and shows the chat.
  async goBack(r) {
    const w = this.windowRecord(r.from);
    const target = w && (w.workspaceFile || (w.folders && w.folders[0]));
    if (target) await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(target), { forceNewWindow: true });
    this.status.send(r.from, { type: "showChat", chatId: r.chatId });
  }
}

function registerProjects(context, { chat, log, deps } = {}) {
  const p = new Projects(context, { chat, log, deps });
  p.register();
  return p;
}

module.exports = { registerProjects, Projects };
