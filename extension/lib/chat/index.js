// The chat panel (Ctrl+L): tabs, history, modes (Agent / Auto / Plan / Ask),
// model + intensity, and agent teams. The panel itself is a small web page
// (media/chat.js); this file runs Claude for each tab and keeps the conversations.
// Each tab = one `claude` process = one conversation.

const vscode = require("vscode");
const { fontScale, watchFontScale } = require("../ui");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { ClaudeProcess, log, newSessionId, LOGIN_RE, findClaude, isSetUp } = require("../ai/claude");
const { projectInstructions } = require("./project");
const { ChangeTracker } = require("./changes");
const ws = require("../workspace");
const { Attachments } = require("./attachments");
const { ChatArchive } = require("./archive");
const { Ollama, memoryGB, totalMemoryGB, MIN_VERSION } = require("../ai/ollama");
const brain = require("../ai");
const { installOllama } = require("../tab/local");
const { watchSetup } = require("../ai/claude-setup");
const { Tickets, atlassianState, ticketNote, isAtlassianRead } = require("./tickets");
const { PROMPTS, MOODS, MOOD_PROMPTS } = require("./prompts");
const { GUIDE } = require("./guide");
const { FRIENDS, TEAM_TOOLS, ROLES, DEVELOPERS, TEAM_STYLES, teamMembers, teamPrompt, teamServer } = require("./team");

const MODELS = [
  { id: "opus", label: "Opus", hint: "most capable" },
  { id: "sonnet", label: "Sonnet", hint: "fast and smart" },
  { id: "haiku", label: "Haiku", hint: "fastest" },
];
const EFFORTS = [
  { id: "low", label: "Low" }, { id: "medium", label: "Medium" }, { id: "high", label: "High" }, { id: "max", label: "Max" },
];
const MODES = [
  { id: "agent", label: "Agent", hint: "edits; asks before commands" },
  { id: "auto", label: "Auto", hint: "edits and runs commands freely" },
  { id: "plan", label: "Plan", hint: "a plan first, no changes" },
  { id: "ask", label: "Ask", hint: "answers only" },
];
const TEAM_SIZES = [2, 3, 4, 5];
// A model on your own computer (Ollama) is saved as "ollama:<name>", e.g. "ollama:qwen3-coder:30b".
const isLocal = (model) => /^ollama:./.test(model || "");
const localName = (model) => String(model).slice("ollama:".length);
const validModel = (m) => valid(MODELS, m) || (/^(ollama|codex|gemini):./.test(m || "") && m.length < 200);
// Which program has the conversation: "claude" (Claude Code), "ollama" (Kural's own engine), "codex", "gemini".
const engineOf = (m) => brain.engineOf(m);
const isClaude = (m) => engineOf(m) === "claude";
const whoOf = (m) => brain.providerOf(m).label;   // "Claude", "ChatGPT (Codex)", "Gemini", "Your own model"

const READ_TOOLS = ["Read", "Grep", "Glob"];
const AGENT_TOOLS = ["Read", "Grep", "Glob", "Edit", "Write", "NotebookEdit", "Bash", "WebSearch", "WebFetch"];
const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);   // Claude Code's tool for starting a helper agent


// An agent with no sign of life for this long is stopped, so one stuck agent can't hold the answer forever.
const BUILD_TEXT = "Go ahead and implement the plan above.";
const MAX_NUDGES = 4;   // how often Kural may wake a paused lead for one question (a project team has phases)
const STUCK_MS = Number(process.env.KURAL_STUCK_MS) || 6 * 60 * 1000;   // (env: for testing)

const MAX_INLINE = 60000;       // files bigger than this are read by Claude instead of pasted in
const STORE_KEY = "kural.chat.v4";
const LAST_KEY = "kural.chat.last";   // your last model / intensity / mode / team, for new tabs

const cfg = () => vscode.workspace.getConfiguration("kural");
const shortId = () => Math.random().toString(36).slice(2, 9);
const valid = (list, v) => list.some((x) => x.id === v);

// Messages meant only for the pane you're using (see ChatView.post).
const ONE_PANE = new Set(["full", "attached", "pasted", "insertPill", "focus", "showHistory", "flash"]);

class ChatView {
  constructor(context, apply) {
    this.context = context;
    this.apply = apply;          // (code, uri, ask) => Promise   (Apply button on code blocks)
    this.activity = null;        // what you've been doing, for Tab (activity.js); set by extension.js
    this.tickets = new Tickets(() => this.root());   // Jira search for "+ → Link ticket"
    this.version = context.extension.packageJSON.version;
    // Where chats are shown: the side panel, plus any chats opened beside the code (Split). Each pane
    // shows one tab: { id, kind: "side" | "editor", webview, panel?, ready, queue, activeId }.
    this.panes = [];
    this.pane = null;            // the pane whose message is being handled right now
    this.focusPane = null;       // the pane you used last (keyboard shortcuts and commands act on it)
    this._activeId = null;       // the side panel's tab before the panel exists
    this.tabs = [];              // open tabs; see newTab() for the shape
    // Every chat from every workspace, in full (History). this.here: which workspace this window is.
    this.archive = new ChatArchive(path.join(context.globalStorageUri.fsPath, "chats"));
    this.here = ChatView.workspaceInfo();
    // Models on your own computer (Ollama): the same address as Tab's local model.
    this.ollama = new Ollama(() => cfg().get("tabCompletion.ollamaUrl"));
    this.localReady = new Map();   // "ollama:<name>" -> the larger-context copy's name, once prepared
    this.pulls = new Map();        // model downloads in progress: name -> { percent, status }
    this.runtime = new Map();    // tabId -> { proc, turn, perms, procKey, agents }
    this.changes = new ChangeTracker();
    this.attachments = new Attachments();   // files added to the message you're writing
    this.setupVersion = 0;                  // goes up when your Claude Code setup changes
    this.lastEditor = vscode.window.activeTextEditor;
    this.lastSelection = null;   // for turning pasted code into a "main.py (L3-9)" reference
    this.files = null;
    this.load();
  }

  register() {
    const c = this.context;
    this.changes.register(c);
    watchFontScale(c, (m) => this.post(m));
    watchSetup(c, () => ws.folders().map((f) => f.path), () => { if (cfg().get("chat.fullClaudeCodeSetup")) this.setupChanged("changed"); });
    let lastFocusReload = Date.now();
    c.subscriptions.push(vscode.window.onDidChangeWindowState((st) => {
      if (!st.focused || !cfg().get("chat.fullClaudeCodeSetup") || Date.now() - lastFocusReload < 60000) return;
      lastFocusReload = Date.now();
      this.setupChanged("may have changed while you were away");
    }));
    const refreshFiles = debounce(() => { this.files = null; if (this.panes.some((p) => p.ready)) this.sendFiles(); }, 1500);
    const watcher = vscode.workspace.createFileSystemWatcher("**/*", false, true, false);
    watcher.onDidCreate(refreshFiles); watcher.onDidDelete(refreshFiles);
    c.subscriptions.push(
      watcher,
      vscode.window.registerWebviewViewProvider("kural.chat", this, { webviewOptions: { retainContextWhenHidden: true } }),
      vscode.window.onDidChangeActiveTextEditor((ed) => { if (ed) { this.lastEditor = ed; this.postActive(); } }),
      // A folder added to (or removed from) the workspace: Claude gets access on its next start,
      // and @ mentions list its files.
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.files = null;
        if (this.panes.some((p) => p.ready)) this.sendFiles();
        // Pictures from the new folder: the pages may load files from it now.
        for (const p of this.panes) {
          p.webview.options = { ...p.webview.options, localResourceRoots: this.resourceRoots() };
          this.postTo(p, { type: "pics", pics: this.filesFor(p.webview) });
        }
        for (const t of this.tabs) { const r = this.runtime.get(t.id); if (r && r.proc && t.status === "idle") this.warm(t); }
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        const s = e.selections[0];
        if (s && !s.isEmpty && e.textEditor.document.uri.scheme === "file") this.lastSelection = { doc: e.textEditor.document, range: new vscode.Range(s.start, s.end) };
      }),
      vscode.commands.registerCommand("kural.chat.open", () => this.open()),
      vscode.commands.registerCommand("kural.chat.split", () => this.openSplit()),
      vscode.window.registerWebviewPanelSerializer("kural.chatEditor", { deserializeWebviewPanel: async (panel) => this.restoreSplit(panel) }),
      vscode.commands.registerCommand("kural.chat.newTab", () => { this.reveal(); this.newTab(true); }),
      vscode.commands.registerCommand("kural.chat.nextTab", () => this.cycle(1)),
      vscode.commands.registerCommand("kural.chat.prevTab", () => this.cycle(-1)),
      vscode.commands.registerCommand("kural.chat.closeTab", () => this.closeTab(this.activeId)),
      vscode.commands.registerCommand("kural.reloadSetup", () => this.setupChanged("reload asked for")),
      vscode.commands.registerCommand("kural.chat.localModels", async () => { await this.reveal(); this.post({ type: "showLocal" }); }),
      vscode.commands.registerCommand("kural.chat.attach", async () => { this.reveal(); await this.onMessage({ type: "attachPick" }); }),
      // Keyboard shortcuts while the chat has focus (Ctrl+M/H/O intensity, Ctrl+P plan). "Next model" has no
      // shortcut (Ctrl+S is Save); it's in the command palette.
      vscode.commands.registerCommand("kural.chat.nextModel", () => this.shortcut((t) => {
        const i = MODELS.findIndex((x) => x.id === t.model);
        const next = MODELS[(i + 1) % MODELS.length];
        return [{ type: "setModel", model: next.id }, next.label];
      })),
      ...["medium", "high", "max"].map((e) => vscode.commands.registerCommand(`kural.chat.effort${e[0].toUpperCase()}${e.slice(1)}`,
        () => this.shortcut(() => [{ type: "setEffort", effort: e }, `Intensity: ${EFFORTS.find((x) => x.id === e).label}`]))),
      vscode.commands.registerCommand("kural.chat.togglePlan", () => this.shortcut((t) => {
        if (t.mode === "plan") return [{ type: "setMode", mode: t.prevMode && t.prevMode !== "plan" ? t.prevMode : "agent" }, null];
        t.prevMode = t.mode;
        return [{ type: "setMode", mode: "plan" }, null];
      })),
      vscode.commands.registerCommand("kural.chat.history", async () => { await this.reveal(); this.post({ type: "showHistory" }); }),
      { dispose: () => { for (const r of this.runtime.values()) if (r.proc) r.proc.kill(); } },
    );
  }

  // ---------- your last choices, for new tabs ----------
  lastChoices() {
    const last = this.context.globalState.get(LAST_KEY) || {};
    return {
      model: this.usableModel(validModel(last.model) ? last.model : (valid(MODELS, cfg().get("chat.model")) ? cfg().get("chat.model") : "sonnet")),
      effort: valid(EFFORTS, last.effort) ? last.effort : (valid(EFFORTS, cfg().get("chat.intensity")) ? cfg().get("chat.intensity") : "medium"),
      mode: valid(MODES, last.mode) ? last.mode : (valid(MODES, cfg().get("chat.mode")) ? cfg().get("chat.mode") : "agent"),
      team: TEAM_SIZES.includes(last.team) ? last.team : 0,
      mood: valid(MOODS, last.mood) ? last.mood : "default",
      roles: Array.isArray(last.roles) ? last.roles.filter((r) => valid(ROLES, r)) : [],
      teamStyle: valid(TEAM_STYLES, last.teamStyle) ? last.teamStyle : "split",
    };
  }

  // Set by extension.js from Get started: is anything set up, and the model on this computer that passed its test.
  isReady() { return this.readyCheck ? this.readyCheck() : isSetUp(); }
  // A new chat's model: your last one, unless it's a Claude model and only your own model is set up (or the reverse).
  usableModel(m) {
    if (!brain.providerOf(m).ready()) { const other = brain.fallbackModel(); if (other) return other; }
    return m;
  }

  remember(tab) {
    const prev = this.context.globalState.get(LAST_KEY) || {};
    this.context.globalState.update(LAST_KEY, { ...prev, model: tab.model, effort: tab.effort, mode: tab.mode, team: tab.team || 0,
      mood: tab.mood, roles: tab.roles, teamStyle: tab.teamStyle });
  }

  // Old saved tabs may lack a field or hold one that no longer exists ("undefined" in the menu).
  fix(tab) {
    const d = this.lastChoices();
    if (!validModel(tab.model)) tab.model = d.model;
    // Which engine has this conversation (chats from before Kural had its own engine: the one their model uses).
    if (!tab.engine && tab.messages && tab.messages.length) tab.engine = engineOf(tab.model);
    if (tab.engine === "local") tab.engine = "ollama";   // (its old name)
    if (!valid(EFFORTS, tab.effort)) tab.effort = d.effort;
    if (!valid(MODES, tab.mode)) tab.mode = d.mode;
    if (!TEAM_SIZES.includes(tab.team)) tab.team = 0;
    if (tab.mood === "teacher") tab.mood = "learn";   // (the Teacher mood is now Learn)
    if (!valid(MOODS, tab.mood)) tab.mood = d.mood;
    if (!Array.isArray(tab.roles)) tab.roles = d.roles;
    tab.roles = tab.roles.filter((r) => valid(ROLES, r));
    if (!valid(TEAM_STYLES, tab.teamStyle)) tab.teamStyle = d.teamStyle;
    tab.createdAt = tab.createdAt || Date.now();
    tab.updatedAt = tab.updatedAt || tab.createdAt;
    tab.workspace = tab.workspace || this.here;   // older chats: from this workspace
    return tab;
  }

  // ---------- tabs ----------
  newTab(activate) {
    // An empty chat is already there: use it instead of piling up empty tabs.
    // (Not one that's open in another pane: both would show the same chat.)
    const here = this.cur();
    const blank = activate && this.tabs.find((t) => !t.messages.length && t.status === "idle" && !this.panes.some((p) => p !== here && p.activeId === t.id));
    if (blank) { Object.assign(blank, this.lastChoices()); this.activate(blank.id); return blank; }
    const d = this.lastChoices();
    const tab = {
      id: shortId(), title: "New chat", renamed: false,
      model: d.model, effort: d.effort, mode: d.mode, team: d.team, mood: d.mood, roles: d.roles, teamStyle: d.teamStyle,
      sessionId: newSessionId(), started: false, workspace: this.here,
      messages: [], status: "idle", unread: false, allowAll: false, modelName: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    this.tabs.push(tab);
    if (activate) this.activate(tab.id); else this.postTabs();
    this.save();
    return tab;
  }

  tab(id) { return this.tabs.find((t) => t.id === id); }
  active() { return this.tab(this.activeId); }

  // ---------- panes ----------
  // The pane a command or reply is for: the one that sent the message being handled, else the one you used last.
  cur() { return this.pane || this.focusPane || this.side() || null; }
  side() { return this.panes.find((p) => p.kind === "side"); }
  get activeId() { const p = this.cur(); return p ? p.activeId : this._activeId; }
  set activeId(v) { const p = this.cur(); if (p) p.activeId = v; else this._activeId = v; }
  shown(id) { return this.panes.some((p) => p.activeId === id); }   // is this tab on screen somewhere?

  activate(id, pane = this.cur()) {
    const tab = this.tab(id);
    if (!tab) return;
    if (pane) pane.activeId = id; else this._activeId = id;
    tab.unread = false;
    if (pane) this.postTo(pane, { type: "full", tab: this.viewTab(tab) });
    this.postTabs();
    if (tab.setup) this.post({ type: "setup", tabId: tab.id, setup: tab.setup });
    this.warm(tab);
    this.save();
  }

  cycle(dir) {
    if (!this.tabs.length) return;
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    this.activate(this.tabs[(i + dir + this.tabs.length) % this.tabs.length].id);
  }

  // Closing a tab keeps it in History (clock button), unless it was never used (or you deleted it: keep = false).
  closeTab(id, keep = true) {
    const tab = this.tab(id);
    if (!tab) return;
    const r = this.runtime.get(id);
    if (r && r.proc) { r.stale = true; r.proc.kill(); }
    this.runtime.delete(id);
    const i = this.tabs.indexOf(tab);
    this.tabs.splice(i, 1);
    if (keep && tab.messages.length) this.archive.save(tab, this.card(tab));
    if (!this.tabs.length) this.newTab(true);
    // Every pane that showed it moves to the tab before it.
    const showing = this.panes.filter((p) => p.activeId === id);
    for (const p of showing) this.activate(this.tabs[Math.max(0, Math.min(i - 1, this.tabs.length - 1))].id, p);
    if (!showing.length) this.postTabs();
    this.postHistory();
    this.save();
  }

  // Reopen a chat from History. From this workspace, Claude continues the same conversation. From another
  // workspace it opens to read ("visiting"): Claude keeps conversations per folder, so to go on you open that
  // folder, or Continue here (a new conversation that's given the old one).
  reopen(id) {
    const open = this.tab(id);
    if (open) { this.activate(id); return; }
    const tab = this.archive.read(id);
    if (!tab) { this.postHistory(true); return; }
    this.clean(tab);
    tab.visiting = !!(tab.workspace && tab.workspace.key !== this.here.key);
    // A fresh, unused tab gets replaced instead of piling up.
    const blank = this.tabs.find((t) => !t.messages.length && t.status === "idle");
    if (blank) this.tabs.splice(this.tabs.indexOf(blank), 1, tab); else this.tabs.push(tab);
    this.activate(tab.id);
    this.postHistory();
    this.save();
  }

  rename(id, title) {
    const t = this.tab(id) || this.archive.read(id);
    if (!t) return;
    const clean = String(title || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!clean) return;
    t.title = clean; t.renamed = true;
    if (!this.tab(id)) this.archive.save(t, this.card(t));
    this.postTabs(); this.postHistory(); this.save();
  }

  // A chat from another workspace, carried on here: a new conversation that starts with the old one.
  continueHere(id) {
    const old = this.tab(id);
    if (!old || !old.visiting) return;
    const tab = { ...old, id: shortId(), sessionId: newSessionId(), started: false, visiting: false, workspace: this.here,
      carryOver: { from: old.workspace.name, text: ChatView.transcript(old) }, createdAt: Date.now(), updatedAt: Date.now(),
      messages: JSON.parse(JSON.stringify(old.messages)) };
    this.tabs.splice(this.tabs.indexOf(old), 1, tab);
    this.runtime.delete(old.id);
    for (const p of this.panes) if (p.activeId === old.id) this.activate(tab.id, p);
    this.save();
  }

  // Open the folder a visiting chat came from, in a new window.
  openWorkspaceOf(id) {
    const t = this.tab(id);
    const where = t && t.workspace && t.workspace.open;
    if (!where || !fs.existsSync(where)) { vscode.window.showWarningMessage(`Kural: the folder of "${t ? t.workspace.name : "this chat"}" isn't on this computer anymore.`); return; }
    vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(where), { forceNewWindow: true });
  }

  // Delete a chat for good: from this window, History, and every workspace.
  deleteChat(id) {
    if (this.tab(id)) this.closeTab(id, false);
    this.archive.remove(id);
    this.postHistory();
  }

  // The chat as plain text (for Continue here). The newest part if it's long.
  static transcript(t, max = 30000) {
    const lines = [];
    for (const m of t.messages) {
      if (m.role === "user") lines.push(`User: ${ChatView.textOf(m.segments || [])}`);
      else {
        const text = (m.blocks || []).filter((b) => b.k === "text").map((b) => b.text).join("").trim();
        if (text) lines.push(`Claude: ${text}`);
      }
    }
    const all = lines.join("\n\n");
    return all.length > max ? "…" + all.slice(-max) : all;
  }

  static workspaceInfo() {
    const f = ws.folders();
    const file = vscode.workspace.workspaceFile;
    return {
      key: ws.key() || "",
      name: vscode.workspace.name || (f.length ? f.map((x) => x.name).join(", ") : "No folder"),
      open: file && file.scheme === "file" ? file.fsPath : f.length ? f[0].path : null,
    };
  }

  // What History shows about a chat.
  card(t) {
    const firstUser = t.messages.find((m) => m.role === "user");
    return { title: t.title, preview: firstUser ? ChatView.titleOf(firstUser.segments || []).slice(0, 90) : "",
      when: t.updatedAt || t.createdAt, count: t.messages.filter((m) => m.role === "user").length,
      model: t.model, mode: t.mode, workspace: t.workspace || this.here };
  }

  summary(t) { return { id: t.id, title: t.title, status: t.status, unread: t.unread, model: t.model, effort: t.effort, mode: t.mode, team: t.team || 0,
    mood: t.mood, roles: t.roles || [], teamStyle: t.teamStyle, teamSize: this.teamSize(t), ticket: t.ticket || null,
    visiting: t.visiting ? { name: t.workspace.name, canOpen: !!t.workspace.open } : null }; }
  viewTab(t) { return { ...this.summary(t), messages: t.messages, modelName: t.modelName, allowAll: t.allowAll }; }
  postTabs() {
    this.post({ type: "tabs", tabs: this.tabs.map((t) => this.summary(t)) });   // each pane gets its own activeId (post)
    for (const p of this.panes) if (p.panel) { const t = this.tab(p.activeId); p.panel.title = t ? t.title : "Kural chat"; }
  }

  // History: every saved chat (all workspaces), with this window's open tabs as they are right now.
  // fromDisk: read the cards again (other windows may have saved chats).
  postHistory(fromDisk = false) {
    if (fromDisk) this.archive.refresh();
    const byId = new Map(this.archive.list().map((m) => [m.id, { ...m, open: false }]));
    for (const t of this.tabs) if (t.messages.length) byId.set(t.id, { ...this.card(t), id: t.id, open: true, pinned: !!(byId.get(t.id) || {}).pinned });
    const items = [...byId.values()].map((m) => {
      const w = m.workspace || {};
      return { id: m.id, title: m.title, open: m.open, pinned: !!m.pinned, model: m.model, mode: m.mode, when: m.when, count: m.count,
        preview: m.preview, ws: w.name || "", here: !w.key || w.key === this.here.key };
    }).sort((a, b) => (b.pinned - a.pinned) || (b.when - a.when));
    this.post({ type: "history", items, here: this.here.name });
  }

  // ---------- saving across restarts ----------
  // A saved chat, ready to show again: nothing half-running or waiting.
  clean(t) {
    this.fix(t);
    t.status = "idle"; t.pendingModel = false; delete t.worktree; delete t.closedAt;
    for (const m of t.messages) if (m.role === "assistant") {
      if (m.running) { m.running = false; m.error = m.error || "stopped"; }
      for (const b of m.blocks || []) {
        if (b.k === "perm" && b.state === "pending") b.state = "denied";
        if (b.k === "question" && b.state === "pending") b.state = "skipped";
      }
    }
    return t;
  }

  load() {
    const saved = this.context.workspaceState.get(STORE_KEY) || this.context.workspaceState.get("kural.chat.v3");
    const clean = (t) => this.clean(t);
    // Closed chats used to be kept per workspace (up to 100): move them into the shared History once.
    if (saved && Array.isArray(saved.history) && saved.history.length) {
      for (const h of saved.history) if (!this.archive.has(h.id)) { clean(h); this.archive.save(h, this.card(h)); }
      log(`chat: moved ${saved.history.length} closed chats of this workspace into History`);
    }
    if (saved && Array.isArray(saved.tabs) && saved.tabs.length) {
      // The window keeps a shortened copy of its open tabs; History has them in full.
      this.tabs = saved.tabs.map((t) => {
        const full = this.archive.read(t.id);
        if (full && full.messages && full.messages.length >= t.messages.length) t.messages = full.messages;
        return clean(t);
      });
      this._activeId = this.tab(saved.activeId) ? saved.activeId : this.tabs[0].id;
      this.splitIds = (saved.splitIds || []).filter((id) => this.tab(id));   // reopened by restoreSplit()
    } else {
      this.tabs = [];
      const t = this.newTab(false);
      this._activeId = t.id;
    }
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      // Keep the last ~150 KB of each conversation (60 KB for closed ones) so this stays quick.
      const trim = (t, max) => {
        let msgs = t.messages, size = JSON.stringify(msgs).length;
        while (size > max && msgs.length > 2) { msgs = msgs.slice(2); size = JSON.stringify(msgs).length; }
        return { ...t, messages: msgs, status: "idle" };
      };
      for (const t of this.tabs) if (t.messages.length) this.archive.save(t, this.card(t));   // History: in full
      this.context.workspaceState.update(STORE_KEY, {
        tabs: this.tabs.map((t) => trim(t, 150000)),
        activeId: this.side() ? this.side().activeId : this._activeId, splitIds: this.panes.filter((p) => p.kind === "editor").map((p) => p.activeId),
      });
    }, 800);
  }

  // ---------- the panel ----------
  resolveWebviewView(view) {
    const old = this.side();
    if (old) this.panes.splice(this.panes.indexOf(old), 1);
    const pane = this.attach(view.webview, "side", null, old ? old.activeId : this._activeId);
    view.onDidDispose(() => { this._activeId = pane.activeId; this.panes.splice(this.panes.indexOf(pane), 1); });
  }

  // Folders whose pictures the chat may show: Kural's page files, your project folders, Kural's storage (attachments,
  // pictures a model made), the temp folder and your home folder (a picture you attached from Downloads, say). Only
  // pictures: the page's rules (CSP) let it load nothing else, and nothing it loads can be sent anywhere.
  resourceRoots() {
    return [vscode.Uri.joinPath(this.context.extensionUri, "media"), ...ws.folders().map((f) => vscode.Uri.file(f.path)),
      this.context.globalStorageUri, vscode.Uri.file(os.tmpdir()), vscode.Uri.file(os.homedir())];
  }
  // For the page: how to turn a file path into an address it can load (fileSrc in media/chat.js).
  filesFor(webview) {
    return { base: webview.asWebviewUri(vscode.Uri.file("/")).toString().replace(/\/$/, ""), root: this.root() || "", home: os.homedir() };
  }

  // A picture a model made (Ollama image models): saved as a file in Kural's storage, shown in the answer.
  saveImage(data, mime) {
    const ext = { "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[mime] || "png";
    const dir = path.join(this.context.globalStorageUri.fsPath, "images");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${shortId()}.${ext}`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    return file;
  }

  // Show the chat page in a webview (the side panel or a panel beside the code) and track it as a pane.
  attach(webview, kind, panel, activeId) {
    const pane = { id: shortId(), kind, webview, panel, ready: false, queue: [], activeId };
    this.panes.push(pane);
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    webview.options = { enableScripts: true, localResourceRoots: this.resourceRoots() };
    const nonce = shortId() + shortId();
    const uri = (f) => webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    webview.html = `<!doctype html><html data-fs="${fontScale()}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: https:;">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${uri("codicons/codicon.css")}"><link rel="stylesheet" href="${uri("chat.css")}"></head>
<body><div id="app"><div class="booting">Starting Kural chat…</div></div><script nonce="${nonce}" src="${uri("chat.js")}"></script></body></html>`;
    webview.onDidReceiveMessage((m) => this.onMessage(m, pane).catch((e) => log(`chat: ${e.stack}`)));
    return pane;
  }

  // Split: a chat beside the code (an editor panel you can move anywhere), next to the side panel.
  // It starts with a new chat; its tab bar switches between all your chats, like the side panel's.
  openSplit(tabId) {
    const tab = tabId ? this.tab(tabId) : this.newTab(false);
    const panel = vscode.window.createWebviewPanel("kural.chatEditor", tab.title, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true });
    this.adoptSplit(panel, tab.id);
    this.save();
  }
  // After a restart VS Code brings the panel back; give it the chat it showed before.
  restoreSplit(panel) {
    const id = (this.splitIds || []).shift();
    this.adoptSplit(panel, id && this.tab(id) ? id : (this.tabs[0] || this.newTab(false)).id);
  }
  adoptSplit(panel, tabId) {
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "chat-icon.svg");
    const pane = this.attach(panel.webview, "editor", panel, tabId);
    this.focusPane = pane;
    panel.onDidChangeViewState((e) => { if (e.webviewPanel.active) this.focusPane = pane; });
    panel.onDidDispose(() => {
      this.panes.splice(this.panes.indexOf(pane), 1);
      if (this.focusPane === pane) this.focusPane = null;
      this.save();
    });
    this.postTabs();
  }

  // Show the chat you're working in: the panel beside the code, or the side panel.
  reveal() {
    const p = this.cur();
    if (p && p.panel) { p.panel.reveal(); return Promise.resolve(); }
    return vscode.commands.executeCommand("kural.chat.focus");
  }

  // Replies to one pane (the tab it opened, a file it picked, focus, short notices) go only to that pane.
  // Everything else goes to all panes; each one keeps what's about the tab it shows.
  post(msg) {
    if (msg.type === "tabs") { for (const p of this.panes) this.postTo(p, { ...msg, activeId: p.activeId }); return; }
    if (ONE_PANE.has(msg.type)) { const p = this.cur(); if (p) this.postTo(p, msg); return; }
    for (const p of this.panes) this.postTo(p, msg);
  }
  postTo(pane, msg) { if (pane.ready) pane.webview.postMessage(msg); else pane.queue.push(msg); }

  postActive() {
    const ed = this.lastEditor;
    if (!ed || ed.document.uri.scheme !== "file") return this.post({ type: "activeFile", file: null });
    this.post({ type: "activeFile", file: { path: vscode.workspace.asRelativePath(ed.document.uri), name: path.basename(ed.document.uri.fsPath) } });
  }

  async sendFiles() {
    if (!this.files) {
      const uris = await vscode.workspace.findFiles("**/*", "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/__pycache__/**,**/.venv/**,**/venv/**,**/.mypy_cache/**,**/.pytest_cache/**}", 20000);
      this.files = uris.map((u) => vscode.workspace.asRelativePath(u)).sort();
    }
    this.post({ type: "files", files: this.files });
  }

  selectionCtx(doc, range) {
    const endLine = range.end.character === 0 && range.end.line > range.start.line ? range.end.line - 1 : range.end.line;
    const code = doc.getText(new vscode.Range(range.start.line, 0, endLine, doc.lineAt(endLine).text.length));
    return { kind: "selection", path: vscode.workspace.asRelativePath(doc.uri), lang: doc.languageId, startLine: range.start.line + 1, endLine: endLine + 1, code };
  }

  // Ctrl+L: open the chat; with code selected, put "file (L10-20)" into your message.
  async open() {
    const ed = vscode.window.activeTextEditor || this.lastEditor;
    const sel = ed && !ed.selection.isEmpty ? this.selectionCtx(ed.document, ed.selection) : null;
    await this.reveal();
    if (sel) this.post({ type: "insertPill", ctx: sel });
    this.post({ type: "focus" });
  }

  // ---------- Claude process per tab ----------
  // How many agents this tab's team has (0 = no team). Splitting work needs a mode that can edit;
  // a discussion works in every mode. With roles picked, one agent per role.
  // Shown above a team answer: "Project team: Researcher, Architect, Developers (1–3), Tester · you talk to the PM".
  teamLabel(tab) {
    const roles = tab.roles || [];
    if (!this.teamSize(tab) || !roles.length) return null;
    const labels = ROLES.filter((r) => roles.includes(r.id)).map((r) => r.id === "developer" && tab.teamStyle !== "discuss" ? `Developers (1–${DEVELOPERS.length})` : r.label);
    return tab.teamStyle === "discuss" ? `Discussion: ${labels.join(", ")}` : `Project team: ${labels.join(", ")} · led by the PM`;
  }

  teamSize(tab) {
    if (!(tab.team > 1) || !isClaude(tab.model)) return 0;   // (agent teams need a Claude model)
    const editing = tab.mode === "agent" || tab.mode === "auto";
    if (tab.teamStyle !== "discuss" && !editing) return 0;
    const roles = tab.roles || [];
    return roles.length ? teamMembers(0, roles, tab.teamStyle).length : tab.team;
  }
  // When this changes, the tab's Claude restarts (same conversation) before your next message.
  // (Claude Code's setup and its reloads only matter to Claude: other programs don't restart for them.)
  procKey(tab) {
    const claude = isClaude(tab.model);
    return `${claude ? "claude" : tab.model}|${tab.mode}|${tab.effort}|${this.teamSize(tab)}|${tab.mood}|${(tab.roles || []).join(",")}|${tab.teamStyle}|${ws.key()}` +
      (claude ? `|${cfg().get("chat.fullClaudeCodeSetup")}|${this.setupVersion}` : "");
  }

  // Your Claude Code setup changed (a connector or MCP server added, a plugin, a skill…), or you
  // came back to Kural (connectors added on claude.ai don't leave a file to watch): reload
  // Claude for the open chat now, in the same conversation; other chats reload when you use them.
  // Get started passed (or something broke since): the panes show the chat (or "Set up Kural first").
  readyChanged(ready) {
    // Empty chats on a Claude model while only your own model is set up: switch them to it.
    for (const t of this.tabs) if (!t.messages.length && !brain.providerOf(t.model).ready()) {
      const other = brain.fallbackModel(); if (other) { t.model = other; t.modelName = null; }
    }
    this.postTabs();
    this.post({ type: "setupReady", ready, claudeReady: isSetUp(), clis: this.cliInfo() });
    if (ready) for (const p of this.panes) { const t = this.tab(p.activeId); if (t && t.status === "idle") this.warm(t); }
  }

  // Codex and Gemini for the model menu: set up or not, and their models.
  cliInfo() {
    const { CLIS } = require("../ai/clis");
    return ["codex", "gemini"].map((id) => ({ id, label: CLIS[id].label, short: CLIS[id].short, ready: brain.providerOf(`${id}:x`).ready(),
      models: brain.cli[id].models || [], account: brain.cli[id].account || "" }));
  }

  setupChanged(why) {
    this.setupVersion++;
    log(`chat: Claude Code setup ${why}; Claude reloads in the same conversation when it's not busy`);
    const t = this.active();
    const r = t && this.runtime.get(t.id);
    if (t && r && r.proc && t.status === "idle") this.warm(t);
  }

  root() { return ws.root(); }

  // Start the tab's Claude process ahead of time, so your first message is answered quickly.
  warm(tab) {
    if (!brain.providerOf(tab.model).ready() || (isClaude(tab.model) && !findClaude())) return;   // not set up (Get started)
    const r = this.runtime.get(tab.id);
    if (r && r.proc && !r.proc.exited && r.procKey === this.procKey(tab)) return;
    if (r && r.turn && r.turn.reply.running) return;   // never restart in the middle of an answer
    if (r && [...r.agents.values()].some((a) => a.state === "running")) return;   // … or while agents still work
    if (isLocal(tab.model) && !this.localReady.has(tab.model)) {   // a local model is prepared first (quietly)
      this.prepareLocal(tab).then((p) => { if (!p.error && tab.status === "idle") this.warm(tab); });
      return;
    }
    this.startProc(tab);
  }

  // ---------- models on your computer (Ollama) ----------
  // A local model runs on Kural's own engine (lib/engine.js): Ollama directly, no Claude Code, no account, offline.
  // Before the first message: is Ollama there and new enough, is the model downloaded, can it use tools?
  // Returns { ok } or { error } (said in the chat).
  async prepareLocal(tab) {
    const name = localName(tab.model);
    const st = await this.ollama.status();
    if (!st.running) return { error: "Ollama isn't running. Start Ollama (or get it from ollama.com), then send again." };
    if (!st.ok) return { error: `Your Ollama is version ${st.version}; using it in the chat needs ${MIN_VERSION} or newer. Update Ollama, then send again.` };
    let models = [];
    try { models = await this.ollama.models(); } catch (e) { return { error: `Couldn't ask Ollama for its models: ${e.message}` }; }
    const m = models.find((x) => x.name === name || x.name === `${name}:latest`);
    if (!m) return { error: `${name} isn't on this computer (anymore). Download it in Local models (model menu), or pick another model.` };
    if (!m.chat) return { error: `${name} can't use tools, so it can't edit files or run commands. Pick a model with "tools".` };
    this.localReady.set(tab.model, m.capabilities);   // (thinking models get thinking turned on by intensity)
    return { ok: true };
  }

  // The model menu's "On this computer" list and the Local models page.
  async postLocal(pane = null) {
    const status = await this.ollama.status();
    let models = [];
    if (status.running) { try { models = await this.ollama.models(); } catch (e) { log(`local models: ${e.message}`); } }
    const msg = { type: "localModels", status, models, memory: totalMemoryGB(), pulls: Object.fromEntries(this.pulls), minVersion: MIN_VERSION };
    if (pane) this.postTo(pane, msg); else this.post(msg);
  }

  async searchLocal(pane, q) {
    const r = await this.ollama.search(q);
    const results = r.results.map((m) => ({ ...m, sizes: m.sizes.map((s) => ({ size: s, memory: memoryGB(s) })) }));
    this.postTo(pane, { type: "localSearch", q, from: r.from, results });
  }

  async pullLocal(name) {
    name = String(name || "").trim();
    if (!/^[A-Za-z0-9._\/-]+(:[A-Za-z0-9._-]+)?$/.test(name) || this.pulls.has(name)) return;
    this.pulls.set(name, { percent: 0, status: "starting" });
    log(`local models: downloading ${name}`);
    let last = 0;
    try {
      await this.ollama.pull(name, (p) => {
        this.pulls.set(name, { percent: p.percent, status: p.status });
        if (Date.now() - last > 400) { last = Date.now(); this.post({ type: "localPull", name, percent: p.percent, status: p.status }); }
      });
      log(`local models: ${name} downloaded`);
      this.post({ type: "flash", text: `${name} is downloaded` });
    } catch (e) {
      log(`local models: downloading ${name} failed: ${e.message}`);
      vscode.window.showWarningMessage(`Kural: couldn't download ${name}: ${e.message}`);
    } finally {
      this.pulls.delete(name);
      this.postLocal();
    }
  }

  async deleteLocal(name) {
    try { await this.ollama.remove(name); log(`local models: deleted ${name}`); }
    catch (e) { vscode.window.showWarningMessage(`Kural: couldn't delete ${name}: ${e.message}`); }
    this.localReady.delete(`ollama:${name}`);
    this.postLocal();
  }

  startProc(tab, fresh = false) {
    const old = this.runtime.get(tab.id);
    if (old && old.proc) { old.stale = true; old.proc.kill(); }
    const full = cfg().get("chat.fullClaudeCodeSetup");
    const instr = full ? { text: "", files: [] } : projectInstructions(this.root());
    const editing = tab.mode === "agent" || tab.mode === "auto";
    const team = this.teamSize(tab);
    const r = { proc: null, turn: null, perms: new Map(), procKey: this.procKey(tab), gotOutput: false, started: Date.now(), agents: new Map(), tasks: new Map() };
    // The board reads who has finished from this file (see team-mcp.js): agents stop waiting for them.
    r.teamFile = team ? path.join(os.tmpdir(), `kural-team-${tab.id}-${Date.now()}.json`) : null;
    if (fresh) { tab.sessionId = newSessionId(); tab.started = false; }
    // Every mode can ask you a multiple-choice question (AskUserQuestion), shown as a card.
    // With your full setup, Claude can also use your skills.
    const tools = [...(editing ? AGENT_TOOLS : READ_TOOLS), ...(team ? ["Task"] : []), "AskUserQuestion", ...(full ? ["Skill"] : [])];
    // A Claude model: Claude Code. A model on this computer: Kural's own engine, with the same tools and events.
    const local = isLocal(tab.model);
    const localTools = [...(editing ? ["Read", "Write", "Edit", "Glob", "Grep", "Bash"] : ["Read", "Glob", "Grep"]), "AskUserQuestion"];
    const proc = brain.makeAgent(tab.model, {
      name: `chat ${tab.id}`, effort: tab.effort, partial: true, showThinking: true, mode: tab.mode,
      safeMode: !full, appendSystemPrompt: PROMPTS[tab.mode] + GUIDE + (MOOD_PROMPTS[tab.mood] || "") +
        (team ? teamPrompt(team, tab.roles || [], tab.teamStyle) : "") + ws.promptNote() + instr.text,
      addDirs: ws.extraDirs(),
      tools, allowedTools: [...(editing ? ["Read", "Grep", "Glob", "WebSearch"] : READ_TOOLS), ...(team ? ["Task", "Agent", ...TEAM_TOOLS] : []), ...(full ? ["Skill"] : [])],
      mcpServers: team ? { team: teamServer(teamMembers(team, tab.roles || [], tab.teamStyle).map((m) => m.name), r.teamFile) } : null,
      strictMcp: !full,     // full setup: your MCP servers and claude.ai connectors too
      hostPermissions: true, cwd: this.root() || ws.workDir(), persist: true,
      resume: tab.started ? tab.sessionId : null, sessionId: tab.started ? null : tab.sessionId,
    }, local ? { tools: localTools, allowedTools: ["Read", "Grep", "Glob"], capabilities: this.localReady.get(tab.model) || [],
      store: brain.localStore(this.context) } : null, {
      onMessage: (m) => { if (r.stale) return; r.gotOutput = true; this.onClaude(tab, r, m); },
      onPermission: (req) => r.stale ? { allow: false, message: "Stopped." } : this.onPermission(tab, r, req),
      onExit: (info) => this.onExit(tab, r, info),
    });
    r.proc = proc;
    this.runtime.set(tab.id, r);
    if (!proc.start()) { r.proc = null; return null; }
    // Ask which connectors / MCP servers it has (they connect in the background, so twice).
    if (full && isClaude(tab.model)) for (const ms of [1500, 7000]) setTimeout(() => { if (!r.stale && r.proc) this.checkServers(tab, r); }, ms);
    if (instr.files.length) log(`chat ${tab.id}: using instructions from ${instr.files.join(", ")}`);
    return r;
  }

  onExit(tab, r, info) {
    if (r.stale || this.runtime.get(tab.id) !== r) return;
    const last = tab.messages[tab.messages.length - 1];
    // A saved conversation that can't be reopened: start a new one and carry on.
    if (tab.started && !r.gotOutput && Date.now() - r.started < 15000 && /no conversation|not found|session/i.test(info.stderr)) {
      log(`chat ${tab.id}: couldn't reopen the saved conversation; starting a fresh one`);
      tab.started = false;
      const pending = r.pendingSend;
      const nr = this.startProc(tab, true);
      if (nr && pending) { nr.pendingSend = pending; nr.turn = r.turn; nr.proc.send(pending); }
      return;
    }
    r.proc = null;
    if (last && last.role === "assistant" && last.running) {
      last.running = false;
      last.error = info.login ? "login" : "The model stopped unexpectedly. See View → Output → Kural.";
      if (info.login) last.errorWho = whoOf(tab.model);
      tab.status = "idle";
      this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(last) });
      this.postTabs(); this.save();
    }
  }

  // ---------- sending ----------
  async buildPrompt(text, contexts) {
    const parts = [];
    const seen = new Set();
    for (const c of contexts) {
      const key = JSON.stringify([c.kind, c.path, c.startLine, c.endLine]);
      if (seen.has(key)) continue; seen.add(key);
      if (c.kind === "selection") {
        parts.push(`${c.path} (lines ${c.startLine}-${c.endLine}):\n\`\`\`${c.lang || ""}\n${c.code}\n\`\`\``);
      } else if (c.kind === "file" || c.kind === "current") {
        const uri = this.resolvePath(c.path);
        let body = null;
        try { body = await this.readText(uri); } catch { /* unreadable: let Claude try */ }
        const label = c.kind === "current" ? `The file I have open: ${c.path}` : `${c.path}:`;
        parts.push(body != null && body.length <= MAX_INLINE
          ? `${label}\n\`\`\`${path.extname(c.path).slice(1)} path=${c.path}\n${body}\n\`\`\``
          : `${label} (large — read it with your tools if you need it)`);
      }
    }
    return parts.length ? `<context>\n${parts.join("\n\n")}\n</context>\n\n${text}` : text;
  }

  // What you typed, with pills written as @main.py or @main.py (L3-9).
  static textOf(segments) {
    return segments.map((s) => s.t === "text" ? s.v : `@${s.ctx.path}${s.ctx.kind === "selection" ? ` (L${s.ctx.startLine}-${s.ctx.endLine})` : ""}`).join("");
  }

  // A tab title from your first message; pills read as "main.py (L3-9)".
  static titleOf(segments) {
    return segments.map((s) => s.t === "text" ? s.v : `${path.basename(s.ctx.path)}${s.ctx.kind === "selection" ? ` (L${s.ctx.startLine}-${s.ctx.endLine})` : ""}`)
      .join("").replace(/\s+/g, " ").trim().slice(0, 40);
  }

  async send(tab, segments, contexts, attachIds = []) {
    let text = ChatView.textOf(segments).trim();
    if (!text && !attachIds.length) return;
    if (tab.status !== "idle" || tab.visiting) return;   // (a chat from another workspace: read only)
    if (!this.isReady()) { vscode.commands.executeCommand("kural.getStarted"); return; }   // nothing set up yet
    if (!brain.providerOf(tab.model).ready()) {   // e.g. a Claude model, but only your own model is set up
      const p = brain.providerOf(tab.model);
      this.post({ type: "flash", text: `${p.label} isn't set up: pick another model, or set it up in Get started` });
      vscode.commands.executeCommand("kural.getStarted", p.id === "ollama" ? "local" : p.id);
      return;
    }
    if (!text) { text = "Have a look at what I attached."; segments = [{ t: "text", v: text }]; }
    if (tab.title === "New chat" && !tab.renamed) tab.title = ChatView.titleOf(segments);
    const user = { role: "user", segments, mode: tab.mode, contexts: contexts.filter((c) => c.kind === "current").map((c) => ({ kind: c.kind, path: c.path, name: c.name })) };
    const reply = { role: "assistant", blocks: [], running: true, t0: Date.now(), mode: tab.mode, team: this.teamSize(tab), teamStyle: tab.teamStyle,
      teamLabel: this.teamLabel(tab) };
    tab.messages.push(user, reply);
    tab.status = "running";
    tab.updatedAt = Date.now();
    this.post({ type: "append", tabId: tab.id, msgs: [user, reply] });
    this.postTabs();

    // The chat was on the other engine (Claude Code ↔ Kural's own): that one has the conversation, this one doesn't.
    // A new session, and this message carries the conversation so far (everything before it).
    const engine = engineOf(tab.model);
    if (tab.engine && tab.engine !== engine) {
      if (tab.messages.length > 2) tab.carryOver = { model: true, text: ChatView.transcript({ ...tab, messages: tab.messages.slice(0, -2) }) };
      tab.sessionId = newSessionId(); tab.started = false;
      const old = this.runtime.get(tab.id);
      if (old && old.proc) { old.stale = true; old.proc.kill(); old.proc = null; }
    }
    tab.engine = engine;
    let r = this.runtime.get(tab.id);
    // A model on this computer: check Ollama and prepare the model first (says what's missing if it can't).
    if (isLocal(tab.model) && (!r || !r.proc || r.proc.exited || r.procKey !== this.procKey(tab) || !this.localReady.has(tab.model))) {
      const p = await this.prepareLocal(tab);
      if (!reply.running) return;   // you pressed Stop meanwhile
      if (p.error) {
        reply.running = false; reply.error = p.error; tab.status = "idle";
        this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) }); this.postTabs(); this.save();
        return;
      }
      if (r && r.proc && !r.proc.exited && r.procKey === this.procKey(tab)) { /* already running with it */ } else r = null;
    }
    if (!r || !r.proc || r.proc.exited || r.procKey !== this.procKey(tab)) r = this.startProc(tab);
    if (!r) {   // the program didn't start (moved, uninstalled): say which, and open its steps in Get started
      const p = brain.providerOf(tab.model);
      reply.running = false; tab.status = "idle";
      reply.error = p.id === "claude" ? "missing" : `${p.label} didn't start. Check it in Get started (it may have been moved or uninstalled).`;
      this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) }); this.postTabs();
      vscode.commands.executeCommand("kural.getStarted", p.id === "ollama" ? "local" : p.id);
      return;
    }
    if (tab.pendingModel && isClaude(tab.model)) { r.proc.setModel(tab.model); tab.pendingModel = false; }
    // (For "Build it", what the plan was for is the earlier question.)
    const ask = text === BUILD_TEXT ? this.lastAsk({ messages: tab.messages.slice(0, -2) }) : text;
    r.turn = { snaps: {}, reply, ask };
    r.agents = new Map();   // Task call id -> agent card
    r.turnStartAt = Date.now(); r.lastNotifyAt = 0; r.betweenTurns = false; r.concluded = 0;
    r.tasks = new Map();    // Claude's task id -> Task call id (team members' permission requests carry the task id)
    if (r.teamFile) { r.round = (r.round || 0) + 1; r.finished = []; this.writeTeamFile(r); }
    clearInterval(r.watchdog);
    if (reply.team) r.watchdog = setInterval(() => this.watchAgents(tab, r), 30 * 1000);
    clearInterval(r.busyTimer);
    if (reply.team && r.teamFile) r.busyTimer = setInterval(() => { if (r.stale || !reply.running) clearInterval(r.busyTimer); else this.writeTeamFile(r); }, 5000);
    // Continued from another workspace, or switched to a model on another engine (Claude ↔ your computer): the first
    // message carries the conversation so far.
    const carry = tab.carryOver && !tab.started ? (tab.carryOver.model
      ? `<earlier_conversation>\n${tab.carryOver.text}\n</earlier_conversation>\nThat's our conversation so far (with another model). Carry on from it.\n\n`
      : `<earlier_conversation workspace="${tab.carryOver.from}">\n${tab.carryOver.text}\n</earlier_conversation>\n` +
        "That's our earlier conversation, from another workspace. Carry on from it here.\n\n") : "";
    delete tab.carryOver;
    const { content: prompt, meta } = this.attachments.content(carry + ticketNote(tab.ticket) + await this.buildPrompt(text, contexts), attachIds);
    if (meta.length) { user.attachments = meta; this.post({ type: "userAttachments", tabId: tab.id, attachments: meta }); }
    r.pendingSend = prompt;
    r.proc.send(prompt);
    log(`chat ${tab.id}: sent (${JSON.stringify(prompt).length} chars, ${contexts.length} context items, ${meta.length} attachments, ${tab.model}/${tab.effort}, ${tab.mode}${reply.team ? `, team of ${reply.team}` : ""})`);
    this.save();
  }

  // "Build it" under a plan: switch to Agent (or Auto, if you last used it) and carry the plan out.
  async buildPlan(tab) {
    if (tab.status !== "idle") return;
    const last = this.context.globalState.get(LAST_KEY) || {};
    tab.mode = last.buildMode === "auto" ? "auto" : "agent";
    this.postTabs();
    await this.send(tab, [{ t: "text", v: BUILD_TEXT }], []);
  }

  // ---------- Claude's output ----------
  onClaude(tab, r, m) {
    const turn = r.turn;
    const reply = turn && turn.reply;
    if (m.type === "kural_image" && r.turn) {   // (Kural's engine: a picture from the model)
      try {
        const block = { k: "image", path: this.saveImage(m.data, m.mime) };
        r.turn.reply.blocks.push(block);
        this.post({ type: "block", tabId: tab.id, block });
      } catch (e) { log(`chat: couldn't save a picture: ${e.message}`); }
      return;
    }
    if (m.type === "system" && m.subtype === "init" && m.model) {
      tab.modelName = shownModel(tab, m.model);
      if (this.shown(tab.id)) this.post({ type: "modelName", tabId: tab.id, name: tab.modelName });
      this.noteSetup(tab, r, m);
      return;
    }
    if (!reply) return;
    // Team members: Claude reports each one's start and end as system events, keyed by the Task call.
    // With Opus they often run in the background: the lead's turn ends ("result") while they keep
    // working, and Claude starts a new lead turn as each one reports back. So the answer stays open
    // until every agent is finished.
    if (m.type === "system" && /^task_/.test(m.subtype || "")) {
      const a = m.tool_use_id && r.agents.get(m.tool_use_id);
      if (m.subtype === "task_started" && m.task_id && m.tool_use_id) r.tasks.set(m.task_id, m.tool_use_id);
      const end = m.subtype === "task_notification" ? m.status : m.subtype === "task_updated" && m.patch ? m.patch.status : null;
      if (m.subtype === "task_notification") r.lastNotifyAt = Date.now();
      const owner = a || (m.task_id && r.agents.get(r.tasks.get(m.task_id)));
      if (owner) owner.lastActive = Date.now();
      // What the agent is doing right now ("Running the tests"), shown on its card.
      if (m.subtype === "task_progress" && owner && owner.state === "running" && m.description) {
        owner.activity = String(m.description).replace(/^Running /, "");
        this.post({ type: "agentActivity", tabId: tab.id, agentId: owner.id, activity: owner.activity });
      }
      const END = { completed: "done", failed: "failed", error: "failed", killed: "stopped", stopped: "stopped", cancelled: "stopped", canceled: "stopped" };
      if (end && !END[end] && end !== "running" && end !== "pending") log(`chat ${tab.id}: agent status "${end}" (still counted as working)`);
      if (owner && owner.state === "running" && END[end]) {
        owner.state = END[end];
        this.teamFinished(r, owner);
        if (reply && (reply.waitingFor || []).length) {
          reply.waitingFor = reply.waitingFor.filter((n) => n !== (owner.name || `Agent ${owner.n}`));
          this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) });
        }
        this.post({ type: "agentState", tabId: tab.id, agentId: owner.id, state: owner.state });
      }
      return;
    }
    // Messages from a team member carry the id of the Task call that started it.
    const parent = m.parent_tool_use_id || null;
    if (!parent && (m.type === "stream_event" || m.type === "assistant") && r.betweenTurns) {
      r.betweenTurns = false;               // the lead started another turn
      r.turnStartAt = Date.now();
      clearTimeout(r.idleTimer);
      if ((reply.waitingFor || []).length) { reply.waitingFor = []; this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) }); }
    }
    // The lead speaks again after the answer was closed (an agent reported back just as it finished):
    // reopen the same answer instead of gluing text onto a finished one.
    if (!parent && (m.type === "stream_event" || m.type === "assistant") && !reply.running && tab.status === "idle" && !r.stale) {
      reply.running = true;
      delete reply.error;
      tab.status = "running";
      r.turnStartAt = Date.now();
      const last = reply.blocks[reply.blocks.length - 1];
      if (last && last.k === "text" && !/\n\n$/.test(last.text)) last.text += "\n\n";
      this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) });
      this.postTabs();
    }
    if (m.type === "stream_event") {
      if (parent) return;   // helpers' own text stays inside their card; only the lead talks in the chat
      const e = m.event;
      // Claude's thinking, as short summaries (only when Claude Code supports --thinking-display).
      if (e.type === "content_block_start") r.blockType = e.content_block && e.content_block.type;
      if (e.type === "content_block_delta" && e.delta.type === "thinking_delta" && e.delta.thinking) {
        let last = reply.blocks[reply.blocks.length - 1];
        if (!last || last.k !== "think" || last.done) {
          last = { k: "think", text: "", t0: Date.now() };
          reply.blocks.push(last);
          this.post({ type: "block", tabId: tab.id, block: last });
        }
        last.text += e.delta.thinking;
        this.post({ type: "thinkDelta", tabId: tab.id, text: e.delta.thinking });
      }
      if (e.type === "content_block_stop" && r.blockType === "thinking") {
        const last = reply.blocks[reply.blocks.length - 1];
        if (last && last.k === "think" && !last.done) {
          last.done = true; last.ms = Date.now() - last.t0;
          this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) });
        }
      }
      if (m.event.type === "content_block_delta" && m.event.delta.type === "text_delta") {
        let last = reply.blocks[reply.blocks.length - 1];
        if (!last || last.k !== "text") { last = { k: "text", text: "" }; reply.blocks.push(last); }
        last.text += m.event.delta.text;
        this.post({ type: "delta", tabId: tab.id, text: m.event.delta.text });
      }
    } else if (m.type === "assistant") {
      // Show the model that's actually answering (it changes when you switch mid-answer).
      if (!parent && m.message.model) {
        const name = shownModel(tab, m.message.model);
        if (name !== tab.modelName) { tab.modelName = name; if (this.shown(tab.id)) this.post({ type: "modelName", tabId: tab.id, name }); }
      }
      const from = parent && r.agents.get(parent);
      if (from) from.lastActive = Date.now();
      for (const b of m.message.content || []) {
        // What an agent writes and thinks (needs --forward-subagent-text): into its card.
        if (from && (b.type === "text" || b.type === "thinking")) {
          const said = (b.type === "text" ? b.text : b.thinking || "").trim();
          if (!said) continue;
          const step = { k: b.type === "text" ? "say" : "think", text: said };
          from.steps.push(step);
          this.post({ type: "agentStep", tabId: tab.id, agentId: from.id, step });
          continue;
        }
        if (b.type !== "tool_use") continue;
        if (SUBAGENT_TOOLS.has(b.name)) {
          const n = r.agents.size + 1;
          const said = /\bYou are (\w+)(?:, the (\w+))?/.exec((b.input && b.input.prompt) || "");
          const name = said && FRIENDS.includes(said[1]) ? said[1] : FRIENDS[(n - 1) % FRIENDS.length];
          const role = said && said[2] && ROLES.some((x) => x.label === said[2]) ? said[2] : null;
          const block = { k: "agent", id: b.id, n, name, role, title: (b.input && b.input.description) || name, steps: [], state: "running", lastActive: Date.now() };
          r.agents.set(b.id, block);
          this.writeTeamFile(r);   // the board now knows who's on the team for this question
          reply.blocks.push(block);
          this.post({ type: "block", tabId: tab.id, block });
          continue;
        }
        if (b.name === "AskUserQuestion") continue;   // shown as a question card instead
        const step = { k: "tool", name: b.name, detail: toolDetail(b.name, b.input, this.root()), id: b.id };
        const owner = parent && r.agents.get(parent);
        if (owner && b.name === "mcp__team__post") {
          // The agents' discussion: shown in the answer itself, in order, where you're reading
          // (inside the cards it ended up above the lead's text, out of sight).
          step.agent = owner.name; step.role = owner.role;
          reply.blocks.push(step);
          this.post({ type: "block", tabId: tab.id, block: step });
        } else if (owner) {
          owner.steps.push(step);
          this.post({ type: "agentStep", tabId: tab.id, agentId: owner.id, step });
        } else {
          reply.blocks.push(step);
          this.post({ type: "block", tabId: tab.id, block: step });
        }
      }
    } else if (m.type === "user" && !parent) {
      // A Task call that failed to start. (A finished agent is reported by task_notification;
      // a background agent's Task call returns at once with "Async agent launched".)
      for (const c of (m.message && Array.isArray(m.message.content) ? m.message.content : [])) {
        const a = c.type === "tool_result" && c.is_error && r.agents.get(c.tool_use_id);
        if (a && a.state === "running") { a.state = "failed"; this.teamFinished(r, a); this.post({ type: "agentState", tabId: tab.id, agentId: a.id, state: a.state }); }
      }
    } else if (m.type === "result") {
      r.pendingSend = null;
      const working = [...r.agents.values()].filter((a) => a.state === "running");
      // An agent that reported back during this turn wakes the lead once more.
      const wakeUp = r.lastNotifyAt > r.turnStartAt;
      if (working.length || (wakeUp && !m.is_error)) {
        // The lead paused while its team keeps working. Hold the answer open — only Stop ends it now —
        // and Claude wakes the lead as each agent reports back.
        r.betweenTurns = true;
        const last = reply.blocks[reply.blocks.length - 1];
        if (last && last.k === "text" && !/\n\n$/.test(last.text)) { last.text += "\n\n"; this.post({ type: "delta", tabId: tab.id, text: "\n\n" }); }
        reply.waitingFor = working.map((a) => a.name || `Agent ${a.n}`);
        this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) });
        log(`chat ${tab.id}: lead paused${m.is_error ? " (with an error)" : ""}; ${working.length ? `waiting for ${reply.waitingFor.join(", ")}` : "an agent just reported"}`);
        clearTimeout(r.idleTimer);
        if (!working.length) r.idleTimer = setTimeout(() => this.conclude(tab, r, reply, m), 5000);
        return;
      }
      if (r.agents.size && !m.is_error && Date.now() - r.lastNotifyAt < 4000) {
        // The last agents reported while the lead was still talking: Claude wakes it once more for
        // them in a moment. Hold the answer a few seconds instead of closing and reopening it.
        r.betweenTurns = true;
        clearTimeout(r.idleTimer);
        r.idleTimer = setTimeout(() => { if (r.betweenTurns && reply.running && !r.stale) this.finishReply(tab, r, m); }, 4000);
        return;
      }
      if (r.agents.size && r.concluded < MAX_NUDGES && m.is_error) {
        // The team finished but the lead's last turn failed: ask it for the conclusion.
        r.idleTimer = setTimeout(() => this.conclude(tab, r, reply, m), 500);
        return;
      }
      this.finishReply(tab, r, m);
    }
  }

  // ---------- agents that get stuck ----------
  // The board (team-mcp.js) reads this file to learn who has finished, so nobody waits for them.
  // started: the agents the lead actually started; busy: those with a sign of life in the last minute (the board
  // doesn't count waiting for a busy teammate as "nobody answers").
  writeTeamFile(r) {
    if (!r.teamFile) return;
    const now = Date.now(), all = [...(r.agents || new Map()).values()];
    const lower = (a) => String(a.name || "").toLowerCase();
    const state = { round: r.round || 0, finished: r.finished || [], started: all.map(lower).filter(Boolean),
      busy: all.filter((a) => a.state === "running" && now - (a.lastActive || 0) < 60000).map(lower) };
    const text = JSON.stringify(state);
    if (text === r.teamFileText) return;
    r.teamFileText = text;
    try { fs.writeFileSync(r.teamFile, text); } catch (e) { log(`team file: ${e.message}`); }
  }
  teamFinished(r, agent) {
    if (!r.teamFile || !agent.name) return;
    r.finished = r.finished || [];
    if (!r.finished.includes(agent.name.toLowerCase())) { r.finished.push(agent.name.toLowerCase()); this.writeTeamFile(r); }
  }

  // Every 30 s while a team works: an agent with no sign of life for STUCK_MS is stuck (usually waiting
  // for a teammate's message that never comes). Stop it, so the lead can answer with what it has.
  // (Not while you're being asked something: an agent waiting for your OK isn't stuck.)
  watchAgents(tab, r) {
    if (r.stale || !r.turn || !r.turn.reply.running) { clearInterval(r.watchdog); return; }
    const running = [...r.agents.values()].filter((a) => a.state === "running");
    if (r.perms.size) { for (const a of running) a.lastActive = Date.now(); return; }
    for (const a of running) {
      if (Date.now() - (a.lastActive || 0) > STUCK_MS) this.stopAgent(tab, r, a, `stuck: nothing for ${Math.round(STUCK_MS / 60000)} min`);
    }
  }

  // Stop one agent (Claude's stop_task control request) and carry on without it.
  stopAgent(tab, r, a, why) {
    if (a.state !== "running") return;
    const taskId = [...r.tasks].find(([, use]) => use === a.id);
    if (taskId && r.proc && !r.proc.exited) {
      r.proc.request({ subtype: "stop_task", task_id: taskId[0] }).then((res) => log(`chat ${tab.id}: stop_task ${taskId[0]} → ${JSON.stringify(res)}`));
    }
    log(`chat ${tab.id}: stopping ${a.name || `Agent ${a.n}`} (${why})${taskId ? "" : " — no task id, marked stopped only"}`);
    a.state = "stopped"; a.why = why;
    this.teamFinished(r, a);
    this.post({ type: "agentState", tabId: tab.id, agentId: a.id, state: a.state, why });
    const reply = r.turn && r.turn.reply;
    if (!reply) return;
    reply.waitingFor = (reply.waitingFor || []).filter((n) => n !== (a.name || `Agent ${a.n}`));
    this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) });
    // Nobody left and the lead is paused: ask it for the answer (if Claude doesn't wake it first).
    if (r.betweenTurns && ![...r.agents.values()].some((x) => x.state === "running")) {
      clearTimeout(r.idleTimer);
      r.idleTimer = setTimeout(() => this.conclude(tab, r, reply), 5000);
    }
  }

  // "Finish now": stop every agent still working; the lead answers with what it has.
  finishTeam(tab) {
    const r = this.runtime.get(tab.id);
    if (!r || !r.turn || !r.turn.reply.running) return;
    for (const a of r.agents.values()) this.stopAgent(tab, r, a, "stopped by you");
  }

  // Every agent has reported. Claude normally wakes the lead by itself; if it hasn't within a few
  // seconds, ask the lead for the conclusion, so it always reaches you.
  conclude(tab, r, reply, m) {
    if (!r.betweenTurns && !(m && m.is_error) || !r.turn || r.turn.reply !== reply || !reply.running || r.stale) return;
    if (r.concluded >= MAX_NUDGES || !r.proc || r.proc.exited) { this.finishReply(tab, r, m); return; }
    r.concluded++;
    r.betweenTurns = false;
    r.turnStartAt = Date.now();
    reply.waitingFor = [];
    log(`chat ${tab.id}: all agents reported; asking the lead for the conclusion`);
    // (A project team works in phases: after the planners report, the next phase starts; so don't say "final".)
    r.proc.send("All the agents you started have reported back. If your instructions have a next phase (the user's OK, " +
      "building, checking), go on with it now. Otherwise give me the final answer: the result or decision, why, and any " +
      "disagreement that remains.");
  }

  // What Claude loaded from your setup: connectors / MCP servers, plugins, skills. Shown in the
  // model menu; a newly added connector is announced once.
  noteSetup(tab, r, m) {
    const prev = tab.setup || {};
    this.showSetup(tab, {
      servers: (m.mcp_servers || []).filter((x) => x.name !== "team").map((x) => ({ id: x.name, name: prettyServer(x.name), status: x.status })),
      plugins: (m.plugins || []).filter((x) => x.path !== "builtin").map((x) => x.name),
      skills: (m.skills || []).length || prev.skills || 0,
    });
  }

  async checkServers(tab, r) {
    const res = await r.proc.request({ subtype: "mcp_status" });
    if (!res || !Array.isArray(res.mcpServers) || r.stale) return;
    const prev = tab.setup || {};
    this.showSetup(tab, {
      servers: res.mcpServers.filter((x) => x.name !== "team").map((x) => ({ id: x.name, name: prettyServer(x.name), status: x.status, tools: (x.tools || []).length })),
      plugins: prev.plugins || [], skills: prev.skills || 0,
    });
  }

  showSetup(tab, setup) {
    setup.full = !!cfg().get("chat.fullClaudeCodeSetup");
    // Announce a connector that wasn't there before (not on the very first report).
    const known = tab.knownServers ? new Set(tab.knownServers) : null;
    const added = known ? setup.servers.filter((x) => x.status === "connected" && !known.has(x.name)).map((x) => x.name) : [];
    tab.knownServers = [...new Set([...(tab.knownServers || []), ...setup.servers.filter((x) => x.status === "connected").map((x) => x.name)])];
    setup.jira = atlassianState(setup);   // can "+ → Link ticket" work, and if not, why
    tab.setup = setup;
    if (!this.shown(tab.id)) return;
    this.post({ type: "setup", tabId: tab.id, setup });
    if (added.length) this.post({ type: "flash", text: `Now connected: ${added.join(", ")}` });
  }

  // The answer is complete (or stopped): close it and tidy up.
  finishReply(tab, r, m) {
    const reply = r.turn.reply;
    reply.waitingFor = [];
    clearTimeout(r.idleTimer);
    clearInterval(r.watchdog); clearInterval(r.busyTimer);
    r.betweenTurns = false;
    reply.running = false;
    reply.ms = Date.now() - reply.t0;
    tab.started = true;
    tab.updatedAt = Date.now();
    r.pendingSend = null;
    if (m.subtype === "error_during_execution") reply.error = "stopped";
    else if (m.is_error) reply.error = LOGIN_RE.test(m.result || "") ? "login" : (m.result || "Something went wrong.");
    if (reply.error === "login") reply.errorWho = whoOf(tab.model);
    for (const b of reply.blocks) {
      if (b.k === "perm" && b.state === "pending") b.state = "denied";
      if (b.k === "question" && b.state === "pending") b.state = "skipped";
      if (b.k === "agent" && b.state === "running") b.state = reply.error ? "stopped" : "done";
    }
    if (reply.mode === "plan" && !reply.error) reply.planReady = true;
    tab.status = "idle";
    if (!this.shown(tab.id)) tab.unread = true;
    this.finishTurn(tab, r);
    // Tab learns what you're working on, and which files the chat changed for it.
    if (this.activity && r.turn.ask && reply.error !== "stopped") this.activity.addWork("chat", r.turn.ask, (reply.changes || []).map((c) => c.rel));
    this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) });
    this.postTabs(); this.save();
    // If you changed mode/intensity while it was answering, get the new setup ready now.
    if (r.procKey !== this.procKey(tab)) this.warm(tab);
  }

  // Stop no matter what state Claude is in.
  forceStop(tab, r) {
    if (r) {
      clearInterval(r.watchdog); clearInterval(r.busyTimer);
      if (r.teamFile) fs.rm(r.teamFile, { force: true }, () => {});
      r.stale = true;
      if (r.proc) r.proc.kill();
      r.proc = null;
      for (const res of r.perms.values()) res(false);
      r.perms.clear();
    }
    if (r && r.turn && r.turn.reply.running) {
      clearTimeout(r.idleTimer);
      this.finishReply(tab, r, { type: "result", subtype: "error_during_execution", is_error: true });   // agents → stopped
      return;
    }
    const last = tab.messages[tab.messages.length - 1];
    if (last && last.role === "assistant" && last.running) {
      last.running = false; last.error = "stopped";
      for (const b of last.blocks || []) if (b.k === "agent" && b.state === "running") b.state = "stopped";
      this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(last) });
    }
    tab.status = "idle";
    this.postTabs(); this.save();
  }

  finishTurn(tab, r) {
    const reply = r.turn.reply;
    if (reply.mode !== "agent" && reply.mode !== "auto") return;
    try {
      const files = this.changes.summary(r.turn, this.root());
      if (files.length) reply.changes = files;
    } catch (e) { log(`chat: couldn't list changes: ${e.message}`); }
  }

  patchOf(msg) { return { waitingFor: msg.waitingFor, running: msg.running, error: msg.error, errorWho: msg.errorWho, changes: msg.changes, ms: msg.ms, note: msg.note, blocks: msg.blocks, planReady: msg.planReady, planBuilt: msg.planBuilt }; }

  // Claude (or a team member) wants to edit a file or run a command.
  async onPermission(tab, r, req) {
    const turn = r.turn;
    const input = req.input || {};
    if (EDIT_TOOLS.has(req.tool_name)) {
      const file = input.file_path || input.notebook_path;
      if (file && turn) {
        // Save the file if it has unsaved edits, so Claude edits what you see.
        const same = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
        const open = vscode.workspace.textDocuments.find((d) => same(d.uri.fsPath, file));
        if (open && open.isDirty) await open.save();
        this.changes.snapshot(turn, file);
      }
      return { allow: true };
    }
    if (SUBAGENT_TOOLS.has(req.tool_name)) return { allow: true };
    // Reading Jira (the linked ticket, a search) changes nothing, so it doesn't ask. Writing to Jira
    // (comments, status changes, new issues) still asks below.
    if (isAtlassianRead(req.tool_name)) return { allow: true };
    if (req.tool_name === "AskUserQuestion") return this.askUser(tab, r, req);
    if (tab.mode === "auto" || tab.allowAll) return { allow: true };
    // Agent mode: running commands, fetching web pages ask you first.
    const pid = shortId();
    const owner = req.agent_id && r.agents.get(r.tasks.get(req.agent_id));   // a team member asking
    const block = { k: "perm", pid, tool: req.tool_name, detail: permDetail(req.tool_name, input), state: "pending", agent: owner ? owner.name || `Agent ${owner.n}` : undefined };
    if (turn) turn.reply.blocks.push(block);
    tab.status = "waiting";
    this.post({ type: "block", tabId: tab.id, block });
    this.postTabs();
    if (!this.shown(tab.id)) vscode.window.showInformationMessage(`Kural: "${tab.title}" is waiting for your OK to run a command.`, "Show").then((p) => p && (this.reveal(), this.activate(tab.id)));
    const allow = await new Promise((resolve) => r.perms.set(pid, resolve));
    block.state = allow ? "allowed" : "denied";
    // (After Stop the answer is already over: don't flip the tab back to "running".)
    if (turn && turn.reply.running) tab.status = "running";
    this.post({ type: "permState", tabId: tab.id, pid, state: block.state });
    this.postTabs(); this.save();
    return allow ? { allow: true } : { allow: false, message: "The user chose not to run this. Continue without it or ask them." };
  }

  // You changed the mode while an answer is running. Asking (Agent ↔ Auto) is decided per request, so it applies at once:
  // to Auto, the commands waiting for your OK run now, and later ones don't ask. Which tools the model has (Plan and Ask
  // can't edit) is fixed when it starts, so that part applies from your next message.
  modeChangedMidAnswer(tab, was) {
    const r = this.runtime.get(tab.id);
    if (tab.mode === "auto" && r) {
      const turn = r.turn;
      for (const b of (turn && turn.reply.blocks) || []) {
        if (b.k !== "perm" || b.state !== "pending") continue;
        const resolve = r.perms.get(b.pid);
        if (resolve) { r.perms.delete(b.pid); resolve(true); }
      }
    }
    const editing = (x) => x === "agent" || x === "auto";
    if (editing(was) !== editing(tab.mode)) this.post({ type: "flash", text: `${tab.mode === "plan" ? "Plan" : tab.mode === "ask" ? "Ask" : "Editing"} mode applies from your next message` });
    else if (tab.mode === "auto") this.post({ type: "flash", text: "Auto: commands run without asking from now on" });
    else if (tab.mode === "agent") this.post({ type: "flash", text: "Agent: Kural asks before the next command" });
  }

  // Claude asks you a question with options: show a card, wait for your pick.
  async askUser(tab, r, req) {
    const input = req.input || {};
    const questions = Array.isArray(input.questions) ? input.questions : [];
    if (!questions.length) return { allow: false, message: "No question given." };
    const owner = req.agent_id && r.agents.get(r.tasks.get(req.agent_id));
    const pid = shortId();
    const block = { k: "question", pid, questions, state: "pending", answers: null, agent: owner ? owner.name : undefined };
    if (r.turn) r.turn.reply.blocks.push(block);
    tab.status = "waiting";
    this.post({ type: "block", tabId: tab.id, block });
    this.postTabs();
    if (!this.shown(tab.id)) vscode.window.showInformationMessage(`Kural: "${tab.title}" has a question for you.`, "Show").then((p) => p && (this.reveal(), this.activate(tab.id)));
    const answers = await new Promise((resolve) => r.perms.set(pid, resolve));
    const ok = answers && typeof answers === "object";
    block.state = ok ? "answered" : "skipped";
    block.answers = ok ? answers : null;
    if (r.turn && r.turn.reply.running) tab.status = "running";
    this.post({ type: "questionState", tabId: tab.id, pid, state: block.state, answers: block.answers });
    this.postTabs(); this.save();
    return ok ? { allow: true, updatedInput: { ...input, answers } }
      : { allow: false, message: "The user skipped the question. Continue with your best judgment, and say what you assumed." };
  }

  afterTeamChange(tab) {
    this.remember(tab); this.postTabs(); this.save();
    if (tab.status === "idle") this.warm(tab);
    else this.post({ type: "flash", text: "Applies from your next message" });
  }

  async shortcut(make) {
    const tab = this.active();
    if (!tab) return;
    const [msg, flash] = make(tab);
    await this.onMessage({ ...msg, tabId: tab.id });
    const t = this.active();
    this.post({ type: "flash", text: flash || `${MODES.find((x) => x.id === t.mode).label} mode` });
  }

  // ---------- messages from the panel ----------
  async onMessage(m, pane = this.cur()) {
    this.pane = pane;                          // replies and "the current tab" mean this pane's
    if (pane && m.type !== "ready" && m.type !== "log" && !(m.type === "focusChanged" && !m.focused)) this.focusPane = pane;
    try { await this.handle(m, pane); } finally { if (this.pane === pane) this.pane = null; }
  }

  async handle(m, pane) {
    const tab = m.tabId ? this.tab(m.tabId) : this.active();
    switch (m.type) {
      case "ready": {
        if (!pane) break;
        if (!this.tab(pane.activeId)) pane.activeId = (this.tab(this._activeId) || this.tabs[0] || this.newTab(false)).id;
        const w = pane.webview, t = this.tab(pane.activeId);
        w.postMessage({ type: "config", models: MODELS, efforts: EFFORTS, modes: MODES, teamSizes: TEAM_SIZES,
          moods: MOODS, roles: ROLES, teamStyles: TEAM_STYLES, version: this.version, ready: this.isReady(), claudeReady: isSetUp(), clis: this.cliInfo(), pics: this.filesFor(w) });
        w.postMessage({ type: "tabs", tabs: this.tabs.map((x) => this.summary(x)), activeId: pane.activeId });
        w.postMessage({ type: "full", tab: this.viewTab(t) });
        if (t.setup) w.postMessage({ type: "setup", tabId: t.id, setup: t.setup });
        pane.ready = true;
        for (const q of pane.queue.splice(0)) w.postMessage(q);
        this.postActive();
        this.postHistory();
        this.sendFiles();
        this.warm(t);
        break;
      }
      case "log": log(`chat panel: ${m.message}`); break;
      case "focusChanged": vscode.commands.executeCommand("setContext", "kural.chatFocused", !!m.focused); break;
      case "newTab": this.newTab(true); break;
      case "switchTab": this.activate(m.id, pane); break;
      case "closeTab": this.closeTab(m.id); break;
      case "renameTab": this.rename(m.id, m.title); break;
      case "history": this.postHistory(true); break;
      case "reopen": this.reopen(m.id); break;
      case "forget": this.deleteChat(m.id); this.save(); break;
      case "pin": {
        const t = this.tab(m.id);
        if (t && t.messages.length) this.archive.save(t, this.card(t));   // an open chat may not be saved yet
        this.archive.pin(m.id, !!m.value);
        this.postHistory();
        break;
      }
      case "continueHere": this.continueHere(m.id); break;
      case "localModels": await this.postLocal(pane); break;
      case "localSearch": await this.searchLocal(pane, m.q); break;
      case "localPull": this.pullLocal(m.name); break;
      case "localDelete": await this.deleteLocal(m.name); break;
      case "installOllama": installOllama(); break;
      case "openWorkspace": this.openWorkspaceOf(m.id); break;
      case "send": if (tab) await this.send(tab, m.segments, m.contexts, m.attachments || []); break;
      case "attachPick": {
        const uris = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFiles: true, openLabel: "Attach", title: "Attach files to your message" });
        const items = (uris || []).map((u) => this.attachments.add(u.fsPath)).filter(Boolean);
        if (items.length && pane) this.postTo(pane, { type: "attached", items });
        break;
      }
      case "openUrl": if (/^https?:\/\//.test(m.url || "")) vscode.env.openExternal(vscode.Uri.parse(m.url)); break;
      case "ticketSearch": {
        const out = await this.tickets.search(m.query || "", (text) => pane && this.postTo(pane, { type: "ticketStatus", id: m.id, text }));
        if (!out.cancelled && pane) this.postTo(pane, { type: "ticketResults", id: m.id, ...out });
        break;
      }
      case "linkTicket": if (tab) {
        const k = m.ticket || {};
        tab.ticket = k.key ? { key: k.key, summary: k.summary || "", type: k.type || "", status: k.status || "", url: k.url || "" } : null;
        log(`chat ${tab.id}: ${tab.ticket ? `linked ${tab.ticket.key}` : "ticket unlinked"}`);
        this.save(); this.postTabs();
        break;
      }
      case "attachData": { const a = this.attachments.addData(m.name, m.data); if (a && pane) this.postTo(pane, { type: "attached", items: [a] }); break; }
      case "attachUris": {
        const items = (m.uris || []).map((u) => { try { return this.attachments.add(vscode.Uri.parse(u).fsPath); } catch { return null; } }).filter(Boolean);
        if (items.length && pane) this.postTo(pane, { type: "attached", items });
        break;
      }
      case "buildPlan": if (tab) {
        const msg = tab.messages[m.msgIndex];
        if (msg) { msg.planBuilt = true; this.post({ type: "patch", tabId: tab.id, index: m.msgIndex, msg: this.patchOf(msg) }); }
        await this.buildPlan(tab);
      } break;
      case "finishTeam": if (tab) this.finishTeam(tab); break;
      case "stop": {
        const r = this.runtime.get(tab.id);
        // Agents working in the background don't stop on an interrupt, and a paused lead has
        // nothing to interrupt: end the whole process. The conversation is saved, so the next
        // message picks it up again.
        if (!r || !r.proc || r.proc.exited || [...r.agents.values()].some((a) => a.state === "running")) { this.forceStop(tab, r); break; }
        for (const res of r.perms.values()) res(false);
        r.perms.clear();
        r.proc.interrupt();
        const turn = r.turn;   // if Claude doesn't confirm within 5 s, stop it the hard way
        setTimeout(() => { if (r.turn === turn && turn && turn.reply.running) this.forceStop(tab, r); }, 5000);
        break;
      }
      case "setModel": {
        if (!validModel(m.model)) return;
        const was = tab.model;
        tab.model = m.model;
        const r = this.runtime.get(tab.id);
        if (engineOf(m.model) !== engineOf(was) || isLocal(m.model)) {
          // To another program (Claude Code, Codex, Gemini, Kural's own engine), which doesn't have this conversation:
          // send() notices (tab.engine) and starts a new session that carries the conversation.
          if (tab.status === "idle" && !(tab.engine && tab.engine !== engineOf(m.model))) this.warm(tab);
          else this.post({ type: "flash", text: "The new model takes over with your next message" });
        } else if (r && r.proc && !r.proc.exited) r.proc.setModel(isClaude(m.model) ? m.model : m.model.replace(/^(codex|gemini):/, "").replace(/^default$/, ""));
        // Switch right away, keeping the conversation — even in the middle of an answer:
        // Claude's next step already uses the new model.
        tab.modelName = null;
        this.post({ type: "modelName", tabId: tab.id, name: null });   // show the new choice right away
        this.remember(tab); this.postTabs(); this.save();
        break;
      }
      case "setEffort": if (valid(EFFORTS, m.effort)) {
        tab.effort = m.effort; this.remember(tab); this.postTabs(); this.save();
        if (tab.status === "idle") this.warm(tab);
        else this.post({ type: "flash", text: "Intensity applies from your next message" });   // set when Claude starts
      } break;
      case "setMode": if (valid(MODES, m.mode)) {
        const was = tab.mode;
        tab.mode = m.mode; this.remember(tab);
        if (m.mode === "agent" || m.mode === "auto") this.context.globalState.update(LAST_KEY, { ...this.context.globalState.get(LAST_KEY), buildMode: m.mode });
        if (tab.status !== "idle") this.modeChangedMidAnswer(tab, was);
        this.postTabs(); this.save(); if (tab.status === "idle") this.warm(tab);
      } break;
      case "setMood": if (valid(MOODS, m.mood)) { tab.mood = m.mood; this.afterTeamChange(tab); } break;
      case "toggleRole": if (valid(ROLES, m.role)) {
        const roles = tab.roles || [];
        tab.roles = roles.includes(m.role) ? roles.filter((r) => r !== m.role) : [...roles, m.role].slice(0, FRIENDS.length);
        if (tab.roles.length && !tab.team) tab.team = TEAM_SIZES[1];   // picking a role turns the team on
        this.afterTeamChange(tab);
      } break;
      case "setTeamStyle": if (valid(TEAM_STYLES, m.style)) { tab.teamStyle = m.style; if (!tab.team) tab.team = TEAM_SIZES[1]; this.afterTeamChange(tab); } break;
      case "reloadSetup": this.setupChanged("reload asked for"); break;
      case "getStarted": vscode.commands.executeCommand("kural.getStarted", m.path); break;
      case "useFullSetup":
        await cfg().update("chat.fullClaudeCodeSetup", !!m.on, vscode.ConfigurationTarget.Global);
        this.setupChanged(m.on ? "switched to your full setup" : "switched to the minimal setup");
        break;
      case "setTeam": tab.team = TEAM_SIZES.includes(m.team) ? m.team : 0; this.remember(tab); this.postTabs(); this.save(); if (tab.status === "idle") this.warm(tab); break;
      case "permission": {
        const r = this.runtime.get(tab.id);
        if (m.always) { tab.allowAll = true; this.post({ type: "allowAll", tabId: tab.id }); }
        const res = r && r.perms.get(m.pid);
        if (res) { r.perms.delete(m.pid); res(!!m.allow); }
        break;
      }
      case "answer": {
        const r = this.runtime.get(tab.id);
        const res = r && r.perms.get(m.pid);
        if (res) { r.perms.delete(m.pid); res(m.answers && typeof m.answers === "object" ? m.answers : false); }
        break;
      }
      case "change": await this.onChangeAction(tab, m); break;
      case "apply": {
        const uri = this.resolvePath(m.path);
        if (!uri) { vscode.window.showWarningMessage("Kural: open the file you want to apply this to, then click Apply again."); return; }
        await this.apply(m.code, uri, this.lastAsk(tab));
        break;
      }
      case "insert": {
        const ed = this.lastEditor;
        if (!ed) { vscode.window.showWarningMessage("Kural: open a file first."); return; }
        await vscode.window.showTextDocument(ed.document, ed.viewColumn);
        await ed.edit((b) => b.replace(ed.selection, m.code));
        if (this.activity) this.activity.addWork("chat Insert", this.lastAsk(tab), [vscode.workspace.asRelativePath(ed.document.uri)]);
        break;
      }
      case "copy": await vscode.env.clipboard.writeText(m.code); vscode.window.setStatusBarMessage("Copied", 1500); break;
      case "openFile": {
        const uri = this.resolvePath(m.path);
        if (!uri) return;
        const line = Math.max(0, (m.line || 1) - 1), end = Math.max(line, (m.endLine || m.line || 1) - 1);
        await vscode.window.showTextDocument(uri, { preview: false, selection: m.line ? new vscode.Range(line, 0, end, 0) : undefined });
        break;
      }
      case "files": await this.sendFiles(); break;
      case "paste": this.post({ type: "pasted", ctx: this.pasteToRef(m.text), text: m.text }); break;
      case "login": {   // log in to the program the chat's model needs
        const p = tab ? brain.providerOf(tab.model) : null;
        vscode.commands.executeCommand("kural.getStarted", !p || p.id === "claude" ? "claude" : p.id === "ollama" ? "local" : p.id);
        break;
      }
      case "showLog": vscode.commands.executeCommand("kural.showLog"); break;
    }
  }

  // Pasted code that came from the editor becomes a reference like "main.py (L3-9)".
  pasteToRef(text) {
    const norm = (s) => s.replace(/\r\n/g, "\n").replace(/\s+$/, "");
    const t = norm(text);
    if (!t.includes("\n") && t.length < 40) return null;
    const s = this.lastSelection;
    if (s && !s.doc.isClosed && norm(s.doc.getText(s.range)) === t) return this.selectionCtx(s.doc, s.range);
    const ed = this.lastEditor;
    if (ed) {
      const all = ed.document.getText().replace(/\r\n/g, "\n");
      const at = all.indexOf(t);
      if (at >= 0) {
        const start = ed.document.positionAt(at), end = ed.document.positionAt(at + t.length);
        return this.selectionCtx(ed.document, new vscode.Range(start, end));
      }
    }
    return null;
  }

  async onChangeAction(tab, m) {
    const msg = tab.messages[m.msgIndex];
    if (!msg || !msg.changes) return;
    const targets = m.id === "*" ? msg.changes.filter((c) => c.state === "pending") : msg.changes.filter((c) => c.id === m.id);
    for (const c of targets) {
      if (m.action === "review") { await this.changes.review(c.id); continue; }
      if (m.action === "undo") { if (await this.changes.undo(c.id)) { c.state = "undone"; if (this.activity) this.activity.undone(c.rel); } }
      if (m.action === "keep") { this.changes.keep(c.id); c.state = "kept"; }
    }
    this.post({ type: "patch", tabId: tab.id, index: m.msgIndex, msg: this.patchOf(msg) });
    this.save();
  }

  // What you last asked in this chat (Apply / Insert of its code is for that).
  lastAsk(tab) {
    const u = [...tab.messages].reverse().find((x) => x.role === "user");
    return u ? ChatView.textOf(u.segments || []) : "";
  }

  resolvePath(p) {
    if (!p) return this.lastEditor ? this.lastEditor.document.uri : null;
    return ws.resolve(p);
  }

  async readText(uri) {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (open) return open.getText();                      // includes unsaved edits
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
  }
}

// "claude_ai_Notion" / "claude.ai Notion" -> "Notion"
function prettyServer(name) { return String(name).replace(/^claude[._ ]ai[_ ]/i, "").replace(/_/g, " "); }

// The model's name under the input: "Opus 4.7", or "qwen3-coder:30b · local" (not its larger-context copy's name).
function shownModel(tab, id) { return isLocal(tab.model) ? localName(tab.model) : isClaude(tab.model) ? prettyModel(id) : String(id || "").replace(/^models\//, ""); }

function prettyModel(id) {
  const m = id.match(/claude-(opus|sonnet|haiku)-(\d+)-(\d+)/i);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id;
}

function toolDetail(name, input, root) {
  const rel = (p) => ws.label(p);   // "src/app.py", or "<folder>/src/app.py" in a multi-folder workspace
  switch (name) {
    case "Read": return rel(input.file_path);
    case "Grep": return `"${input.pattern}"${input.path ? " in " + rel(input.path) : ""}`;
    case "Glob": return input.pattern || "";
    case "Edit": return `${rel(input.file_path)}  (+${lines(input.new_string)} −${lines(input.old_string)})`;
    case "Write": return rel(input.file_path);
    case "NotebookEdit": return rel(input.notebook_path);
    case "Bash": return input.command || "";
    case "WebSearch": return input.query || "";
    case "WebFetch": return input.url || "";
    case "mcp__team__post": return `${cap(input.from)} → ${input.to === "all" ? "everyone" : cap(input.to)}: ${input.message || ""}`;
    case "mcp__team__read": return `${cap(input.name)} checks messages${input.wait_seconds ? " and waits for a reply" : ""}`;
    default: return "";
  }
}
const lines = (s) => (s ? String(s).split("\n").length : 0);
const cap = (s) => { s = String(s || "").trim(); return s ? s[0].toUpperCase() + s.slice(1) : "?"; };

// The team's message board, run by Kural's own executable as plain Node.

function permDetail(tool, input) {
  if (tool === "Bash") return input.command || "";
  if (tool === "WebFetch") return input.url || "";
  return JSON.stringify(input).slice(0, 300);
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

module.exports = { ChatView, MODELS, EFFORTS, MODES, _test: { PROMPTS, teamPrompt, FRIENDS, ROLES, MOOD_PROMPTS, toolDetail } };
