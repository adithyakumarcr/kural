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
const { ChangeTracker, inProject } = require("./changes");
const ws = require("../workspace");
const { Attachments } = require("./attachments");
const { within, isHomeOrAbove, HOME_PROTECTED, privateTmp } = require("../paths");
const { ChatArchive } = require("./archive");
const { forkConversation } = require("./fork");
const { Ollama, memoryGB, totalMemoryGB, MIN_VERSION } = require("../ai/ollama");
const brain = require("../ai");
const { installOllama } = require("../tab/local");
const { watchSetup } = require("../ai/claude-setup");
const { Tickets, atlassianState, ticketNote, isAtlassianRead } = require("./tickets");
const { PROMPTS, MOODS, MOOD_PROMPTS } = require("./prompts");
const { GUIDE } = require("./guide");
const { registerTabEditor, openBeside, tabOf, SCHEME } = require("./tab-editor");
const { FRIENDS, TEAM_TOOLS, ROLES, DEVELOPERS, TEAM_STYLES, teamMembers, teamPrompt, teamServer } = require("./team");
const { profileOf } = require("../router/policy");
const journal = require("../router/journal");
const usageHub = require("../ai/usage");
const { retrieve } = require("../router/retrieve");
const { excludedModel, completionModel } = require("../ai/model-policy");

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
const validModel = (m) => valid(MODELS, m) || ((/^ollama:./.test(m || "") || !!cliOf(m)) && m.length < 200);
// Which program has the conversation: "claude" (Claude Code), "ollama" (Kural's own engine), "codex", "agy" (Gemini).
const { CLIS, IDS: CLI_IDS, cliOf, cliModel } = require("../ai/clis");
const { splitLevel } = require("../ai/agy");
const engineOf = (m) => brain.engineOf(m);
// A linked device's tools need the model's program to take Kural's MCP server and ask Kural before each command:
// Claude Code and Codex do; Kural's own engine (Ollama) has no MCP, and Gemini (Antigravity) can't ask.
const deviceOk = (m) => ["claude", "codex"].includes(engineOf(m));
const isClaude = (m) => engineOf(m) === "claude";
const whoOf = (m) => brain.providerOf(m).label;   // "Claude", "ChatGPT (Codex)", "Google Gemini", "Your own model"

const READ_TOOLS = ["Read", "Grep", "Glob"];
// Every mode may look things up on the web (docs, versions, current facts), without asking: it changes nothing here.
const WEB_TOOLS = ["WebSearch", "WebFetch"];
const AGENT_TOOLS = ["Read", "Grep", "Glob", "Edit", "Write", "NotebookEdit", "Bash", "WebSearch", "WebFetch"];
const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);   // Claude Code's tool for starting a helper agent
const DEVICE_TOOLS = ["run_command", "read_file", "write_file", "list_dir"];   // a linked device's tools (lib/devices)
const DEVICE_TOOL_RE = new RegExp(`^mcp__device__(${DEVICE_TOOLS.join("|")})$`);


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
    this.tickets = new Tickets(() => vscode.workspace.isTrusted ? this.root() : ws.workDir());   // Jira search for "+ → Link ticket"
    // ("v1.1.0-alpha.3", or "Unreleased version · main (…)" when built from the code: lib/version.js)
    this.version = require("../version").versionLabel(context.extensionPath, context.extension.packageJSON.version);
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
    this.routingJobs = new Map(); // Cancellation is runtime state, never saved with the chat.
    this.changes = new ChangeTracker(path.join(context.globalStorageUri.fsPath, "checkpoints"));
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
    registerTabEditor(c, this);   // a chat tab dragged into the editor area opens there (tab-editor.js)
    watchFontScale(c, (m) => this.post(m));
    watchSetup(c, () => ws.folders().map((f) => f.path), () => { if (fullSetup()) this.setupChanged("changed"); });
    let lastFocusReload = Date.now();
    c.subscriptions.push(vscode.window.onDidChangeWindowState((st) => {
      if (!st.focused || !fullSetup() || Date.now() - lastFocusReload < 60000) return;
      lastFocusReload = Date.now();
      this.setupChanged("may have changed while you were away");
    }));
    const refreshFiles = debounce(() => { this.files = null; if (this.panes.some((p) => p.ready)) this.sendFiles(); }, 1500);
    // You trusted this folder: Claude restarts with your full setup.
    c.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => this.setupChanged("trusted")));
    // "Did you know?" under a working answer turned on or off (setting kural.chat.didYouKnow).
    c.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("kural.chat.didYouKnow")) this.post({ type: "didYouKnow", on: didYouKnow() });
    }));
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
      // Kural: Devices → "Link it to the current chat".
      vscode.commands.registerCommand("kural.chat.linkDevice", async (id) => {
        const t = this.active();
        if (!t || !id) return;
        await this.handle({ type: "linkDevice", tabId: t.id, id }, this.cur());
        this.open();
      }),
      vscode.commands.registerCommand("kural.chat.split", () => this.openSplit()),
      // (Panels opened by older versions come back through this serializer; new ones are tab editors, tab-editor.js.)
      vscode.window.registerWebviewPanelSerializer("kural.chatEditor", { deserializeWebviewPanel: async (panel) => this.restoreSplit(panel) }),
      vscode.commands.registerCommand("kural.chat.newTab", async () => {
        // (From a chat dragged into the editor area: the new chat goes into the side panel, which has the tabs.)
        if (this.cur() && this.cur().single) { await vscode.commands.executeCommand("kural.chat.focus"); this.focusPane = this.side() || null; }
        this.reveal(); this.newTab(true);
      }),
      vscode.commands.registerCommand("kural.chat.nextTab", () => this.cycle(1)),
      vscode.commands.registerCommand("kural.chat.prevTab", () => this.cycle(-1)),
      vscode.commands.registerCommand("kural.chat.closeTab", () => this.closeTab(this.activeId)),
      vscode.commands.registerCommand("kural.chat.moveToPanel", (uri) => this.moveToPanel(uri)),
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
      { dispose: () => { for (const c of this.routingJobs.values()) c.abort(); for (const r of this.runtime.values()) { if (r.checkpointAbort) r.checkpointAbort.abort(); if (r.proc) r.proc.kill(); } } },
    );
  }

  // ---------- your last choices, for new tabs ----------
  lastChoices() {
    const last = this.context.globalState.get(LAST_KEY) || {};
    return {
      model: this.usableModel(validModel(last.model) ? last.model : (valid(MODELS, cfg().get("chat.model")) ? cfg().get("chat.model") : "sonnet")),
      autoRoute: !!last.autoRoute, routingProfile: profileOf(last.routingProfile || cfg().get("modelRouter.profile")),
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
    if (this.onChoice) try { this.onChoice(tab); } catch { /* (the status bar's own problem) */ }
    const prev = this.context.globalState.get(LAST_KEY) || {};
    this.context.globalState.update(LAST_KEY, { ...prev, model: tab.model, effort: tab.effort, mode: tab.mode, team: tab.team || 0,
      autoRoute: !!tab.autoRoute, routingProfile: tab.routingProfile,
      mood: tab.mood, roles: tab.roles, teamStyle: tab.teamStyle });
  }

  // Old saved tabs may lack a field or hold one that no longer exists ("undefined" in the menu).
  fix(tab) {
    const d = this.lastChoices();
    if (!validModel(tab.model)) tab.model = d.model;
    tab.autoRoute = !!tab.autoRoute; tab.routingProfile = profileOf(tab.routingProfile || d.routingProfile);
    delete tab.routingState;
    // Which engine has this conversation (chats from before Kural had its own engine: the one their model uses).
    if (!tab.engine && tab.messages && tab.messages.length) tab.engine = engineOf(tab.model);
    if (tab.engine === "local") tab.engine = "ollama";   // (its old name)
    if (!valid(EFFORTS, tab.effort)) tab.effort = d.effort;
    // A Gemini model saved with its level in the name ("agy:gemini-3.8-flash-high"): the model, and the level becomes
    // the intensity (the menu lists each Gemini model once now).
    const lv = cliOf(tab.model) === "agy" && splitLevel(cliModel(tab.model));
    if (lv) { tab.model = `agy:${lv.base}`; tab.effort = { minimal: "low", xhigh: "max" }[lv.level] || lv.level; }
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
      autoRoute: d.autoRoute, routingProfile: d.routingProfile,
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

  // "Fork from here" on an earlier message: when answers after it changed files (not undone), ask first whether the code
  // goes back too, like editing a message does: Restore Code / Keep Code (closing the dialog = no fork). The new chat
  // starts from that message either way; this chat's conversation stays (restored changes show as Undone in it).
  async forkAsk(source, index, pane = this.cur()) {
    const m = source && source.messages[index];
    if (!m || source.status !== "idle" || source.visiting) return null;
    const files = this.laterChanges(source, index);
    if (files.length) {
      const since = files.filter((f) => f.changedSince).map((f) => f.rel);
      const go = await vscode.window.showWarningMessage("Also put the code back as it was at this message?", { modal: true,
        detail: `The answers after it changed ${files.length} file${files.length === 1 ? "" : "s"}: ${files.map((f) => f.rel).join(", ")}.` +
          (since.length ? `\n\nYou changed ${since.join(", ")} yourself since then: restoring loses those edits.` : "") +
          "\n\nThe new chat starts from this message. This chat's conversation stays as it is." }, "Restore Code", "Keep Code");
      if (!go || source.status !== "idle") return null;
      if (go === "Restore Code") {
        const { restored, missing } = await this.restoreCode(source, index);
        this.redraw(source);
        if (missing.length) this.post({ type: "flash", text: `Restored ${restored.length}; no checkpoint for ${missing.join(", ")}` });
      }
    }
    return this.forkFrom(source, index, pane);
  }

  forkFrom(source, index, pane = this.cur()) {
    const tab = forkConversation(source, index, { id: shortId(), sessionId: newSessionId() });
    if (!tab) return;
    this.tabs.push(tab);
    // An editor containing a single chat keeps its original conversation in place.
    if (pane && pane.single) { this.openSplit(tab.id); this.postTabs(); }
    else { this.activate(tab.id, pane); if (pane) this.postTo(pane, { type: "focus" }); }
    this.postHistory();
    this.save();
    return tab;
  }

  // ---------- panes ----------
  // The pane a command or reply is for: the one that sent the message being handled, else the one you used last.
  cur() { return this.pane || this.focusPane || this.side() || null; }
  side() { return this.panes.find((p) => p.kind === "side"); }
  get activeId() { const p = this.cur(); return p ? p.activeId : this._activeId; }
  set activeId(v) { const p = this.cur(); if (p) p.activeId = v; else this._activeId = v; }
  shown(id) { return this.panes.some((p) => p.activeId === id); }   // is this tab on screen somewhere?
  // The whole chat again, in every pane that shows it (after its messages changed: a rollback, an edit).
  redraw(tab) { for (const p of this.panes) if (p.activeId === tab.id) this.postTo(p, { type: "full", tab: this.viewTab(tab) }); }

  activate(id, pane = this.cur()) {
    const tab = this.tab(id);
    if (!tab) return;
    // Open in its own editor already (dragged out): go there instead of showing it twice.
    const own = this.panes.find((p) => p.single && p.activeId === id && p !== pane);
    if (own && own.panel) { own.panel.reveal(); return; }
    if (pane) pane.activeId = id; else this._activeId = id;
    tab.unread = false;
    if (this.onChoice) try { this.onChoice(tab); } catch { /* (the status bar's own problem) */ }
    if (pane) this.postTo(pane, { type: "full", tab: this.viewTab(tab) });
    this.postTabs();
    if (tab.setup) this.post({ type: "setup", tabId: tab.id, setup: tab.setup });
    this.warm(tab);
    this.save();
  }

  cycle(dir) {
    const pane = this.cur();
    if (pane && pane.single) return;   // (a dragged-out chat has no other tabs)
    const out = new Set(this.panes.filter((p) => p.single).map((p) => p.activeId));
    const list = this.tabs.filter((t) => !out.has(t.id) || t.id === this.activeId);
    if (!list.length) return;
    const i = list.findIndex((t) => t.id === this.activeId);
    this.activate(list[(i + dir + list.length) % list.length].id);
  }

  // Closing a tab keeps it in History (clock button), unless it was never used (or you deleted it: keep = false).
  closeTab(id, keep = true) {
    const tab = this.tab(id);
    if (!tab) return;
    const routing = this.routingJobs.get(id); if (routing) { routing.abort(); this.routingJobs.delete(id); }
    const r = this.runtime.get(id);
    if (r && r.checkpointAbort) r.checkpointAbort.abort();
    if (r && r.proc) { r.stale = true; r.proc.kill(); }
    this.endDevice(r);
    this.runtime.delete(id);
    const i = this.tabs.indexOf(tab);
    this.tabs.splice(i, 1);
    if (keep && tab.messages.length) this.archive.save(tab, this.card(tab));
    if (!this.tabs.length) this.newTab(true);
    // Its own editor (dragged out) closes with it; every other pane that showed it moves to the tab before it.
    for (const p of this.panes.filter((q) => q.single && q.activeId === id)) { p.closing = true; p.panel.dispose(); }
    const showing = this.panes.filter((p) => p.activeId === id && !p.single);
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

  // The running model's way to the linked device ends (its token stops working in the bridge).
  endDevice(r) {
    if (r && r.deviceToken && this.devices) this.devices.endSession(r.deviceToken);
    if (r) r.deviceToken = null;
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
    autoRoute: !!t.autoRoute, routingProfile: t.routingProfile, routingState: t.routingState || null, modelName: t.modelName || null,
    tokens: t.tokens || null, context: t.context || null, queued: this.queuedOf(this.runtime.get(t.id)),
    mood: t.mood, roles: t.roles || [], teamStyle: t.teamStyle, teamSize: this.teamSize(t), ticket: t.ticket || null,
    device: t.device && this.devices && this.devices.get(t.device) ? (({ id, name, host, user }) => ({ id, name, host, user }))(this.devices.get(t.device)) : null,
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
    const roots = this.projectRoots(t);
    for (const m of t.messages) if (m.role === "assistant") {
      if (m.running) { m.running = false; m.error = m.error || "stopped"; }
      for (const b of m.blocks || []) {
        if (b.k === "perm" && b.state === "pending") b.state = "denied";
        if (b.k === "question" && b.state === "pending") b.state = "skipped";
      }
      // Older chats also listed files outside the project (a note in /tmp, Claude Code's plans): left out (inProject).
      if (Array.isArray(m.changes)) { m.changes = m.changes.filter((c) => !c.file || inProject(c.file, roots)); if (!m.changes.length) delete m.changes; }
    }
    return t;
  }

  // The chat's project: its workspace's folders (and this window's), or Kural's work folder when no folder was open.
  // Only files in there count as the chat's changes (changes.js inProject).
  projectRoots(tab) {
    const own = tab && tab.workspace && tab.workspace.key ? String(tab.workspace.key).split("|") : [];
    return [...new Set([...ws.folders().map((f) => f.path), ...own, ws.workDir()])];
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

  // Folders whose pictures the chat may show: Kural's page files, your project folders, Kural's storage (pictures a
  // model made), the temp folder (pasted screenshots, and copies of pictures you attach: attachments.js), and pictures
  // in the open chats (attached by an older Kural), each file only. Not your whole home folder: an answer could then show (and so open) anything in Documents or
  // Desktop, and on a Mac that makes macOS ask about Kural. Only pictures: the page's rules (CSP) let it load nothing
  // else, and nothing it loads can be sent anywhere.
  resourceRoots() {
    const pics = new Set();
    for (const t of this.tabs) for (const m of t.messages || []) for (const a of m.attachments || []) if (a.kind === "image" && a.path) pics.add(a.path);
    return [vscode.Uri.joinPath(this.context.extensionUri, "media"), ...ws.folders().map((f) => vscode.Uri.file(f.path)),
      this.context.globalStorageUri, vscode.Uri.file(os.tmpdir()), ...[...pics].slice(-200).map((f) => vscode.Uri.file(f))];
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
<body><div id="app"><div class="booting">Starting Kural chat…</div></div><script nonce="${nonce}" src="${uri("facts.js")}"></script><script nonce="${nonce}" src="${uri("chat.js")}"></script></body></html>`;
    webview.onDidReceiveMessage((m) => this.onMessage(m, pane).catch((e) => log(`chat: ${e.stack}`)));
    return pane;
  }

  // Split: a chat beside the code (an editor you can move anywhere), next to the side panel. Usually by dragging a chat
  // tab into the editor area (lib/chat/tab-editor.js); the command opens a new chat that way. Its tab bar switches
  // between all your chats, like the side panel's.
  openSplit(tabId) {
    const tab = tabId ? this.tab(tabId) : this.newTab(false);
    openBeside(tab.id);
  }
  // A chat tab dropped in the editor area (or brought back after a restart): show it there. Like moving an editor tab
  // in VS Code, it leaves the side panel, which shows another chat instead.
  adoptDragged(panel, tabId) {
    const id = tabId && this.tab(tabId) ? tabId : (this.tabs[0] || this.newTab(false)).id;
    panel.title = this.tab(id).title;
    for (const p of this.panes) {
      if (p.kind === "editor" || p.activeId !== id) continue;
      const other = this.tabs.find((t) => t.id !== id && !this.panes.some((q) => q.activeId === t.id)) || this.newTab(false);
      this.activate(other.id, p);
    }
    const pane = this.adoptSplit(panel, id);
    pane.single = true;
    this.postTabs();
    this.save();
  }
  // A chat in the editor area goes back among the side panel's tabs, and the side panel shows it (the button in the chat
  // editor's title bar, its tab's right-click menu, or the Command Palette). Closing that editor does the first part too.
  async moveToPanel(uri) {
    const fromUri = uri && uri.scheme === SCHEME ? tabOf(uri) : null;
    const pane = this.panes.find((p) => p.kind === "editor" && (fromUri ? p.activeId === fromUri : p === this.focusPane))
      || this.panes.find((p) => p.kind === "editor" && p.panel && p.panel.active);
    if (!pane) return;
    const id = pane.activeId;
    pane.closing = true; pane.panel.dispose();
    await vscode.commands.executeCommand("kural.chat.focus");
    const side = this.side();
    if (side && this.tab(id)) this.activate(id, side);
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
      this.postTabs();   // (a dragged-out chat goes back into the side panel's tabs)
      this.save();
    });
    this.postTabs();
    return pane;
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
    if (msg.type === "tabs") {
      // A chat dragged into the editor area (a "single" pane) shows only itself, and leaves the other panes' tab bars
      // until its editor closes (like moving a tab in VS Code).
      const out = new Set(this.panes.filter((p) => p.single).map((p) => p.activeId));
      for (const p of this.panes) {
        const tabs = p.single ? msg.tabs.filter((t) => t.id === p.activeId) : msg.tabs.filter((t) => !out.has(t.id) || t.id === p.activeId);
        this.postTo(p, { ...msg, tabs, activeId: p.activeId, single: !!p.single });
      }
      return;
    }
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
      // Your home folder (or a folder above it) open as a project: not into Desktop, Documents, Music, Photos… (macOS
      // asks about each). Per folder, since the patterns are relative to it.
      const SKIP = "**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/__pycache__/**,**/.venv/**,**/venv/**,**/.mypy_cache/**,**/.pytest_cache/**";
      const uris = [];
      for (const f of ws.folders()) {
        let extra = "";
        if (isHomeOrAbove(f.path)) {
          const rel = path.relative(f.path, os.homedir()).split(path.sep).join("/");
          extra = HOME_PROTECTED.map((n) => `,${rel ? `${rel}/` : ""}${n}/**`).join("");
        }
        uris.push(...await vscode.workspace.findFiles(new vscode.RelativePattern(f.path, "**/*"), `{${SKIP}${extra}}`, 20000 - uris.length));
        if (uris.length >= 20000) break;
      }
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
    return `${claude ? "claude" : tab.model}|${tab.mode}|${tab.effort}|${this.teamSize(tab)}|${tab.mood}|${(tab.roles || []).join(",")}|${tab.teamStyle}|${ws.key()}|${tab.device || ""}` +
      (claude ? `|${fullSetup()}|${this.setupVersion}` : "");
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

  // Saved devices for the + menu (no passwords: Kural logs in with its own SSH key).
  deviceList() { return this.devices ? this.devices.list().map((d) => ({ id: d.id, name: d.name, host: d.host, port: d.port, user: d.user, system: d.system || "" })) : []; }

  // Gemini and Codex for the model menu: set up or not, and their models.
  cliInfo() {
    return CLI_IDS.map((id) => ({ id, label: CLIS[id].label, short: CLIS[id].short, ready: brain.providerOf(`${id}:x`).ready(),
      models: brain.cli[id].models || [], account: brain.cli[id].account || "" }));
  }

  routerModels() {
    const claude = MODELS.map((m) => ({ ...m, provider: "Claude", providerId: "claude", description: m.hint,
      ready: isSetUp(), local: false, team: true, device: true, images: true, pdf: true, commands: true, connectors: true }));
    const clis = this.cliInfo().flatMap((c) => (c.models.length ? c.models : [{ id: "default", label: `${c.short} default` }]).map((m) => ({
      id: `${c.id}:${m.id}`, label: m.label || m.id, description: m.description || "", provider: c.label, providerId: c.id,
      ready: c.ready, local: false, team: false, device: c.id === "codex", images: true, pdf: false,
      commands: c.id === "codex", connectors: false,
    })));
    const installed = new Map((this.routerLocalList || []).filter((m) => m.chat && !(m.capabilities || []).includes("cloud") && !/cloud/i.test(m.name)).map((m) => [m.name,m]));
    const fallback = this.localDefault && this.localDefault();
    if (fallback && !/cloud/i.test(fallback) && !(this.localReady.get(fallback) || []).includes("cloud") && !installed.has(localName(fallback))) installed.set(localName(fallback), { name: localName(fallback), capabilities: this.localReady.get(fallback) || [] });
    const local = [...installed.values()].map((m) => ({ id: `ollama:${m.name}`, label: m.name, description: `${m.params || ""} on this computer`,
      provider: "Ollama", providerId: "ollama", ready: true, local: true, team: false, device: false,
      images: (m.capabilities || []).includes("vision"), pdf: false, commands: true, connectors: false }));
    const tabModel = completionModel(cfg().get("tabCompletion.localModel"));
    const tabInstalled = (this.routerLocalList || []).find((m) => m.name === tabModel || m.name === `${tabModel}:latest`);
    const completion = tabModel && !local.some((m) => m.id === `ollama:${tabModel}` || m.id === `ollama:${tabModel}:latest`)
      ? [{ id: `ollama:${tabModel}`,label: `${tabModel} (Tab only)`,provider: "Ollama",providerId: "ollama",local: true,
        ready: !!tabInstalled && !(tabInstalled.capabilities || []).includes("cloud") && !/cloud/i.test(tabModel),completionOnly: true }] : [];
    return [...claude,...clis,...local,...completion].filter((model) => !excludedModel(model.id));
  }

  // ---------- tokens ----------
  // This chat's tokens (all answers) and how full its context is now ({ used, window } tokens). Shown under the input.
  countTokens(tab, reply, t, context) {
    const add = (a, b) => { const o = { ...(a || {}) }; for (const k of ["input", "output", "cacheRead", "cacheWrite"]) o[k] = (o[k] || 0) + (Number(b[k]) || 0); return o; };
    if (t) { tab.tokens = add(tab.tokens, t); if (reply) reply.tokens = add(reply.tokens, t); }
    if (context) {
      const window = context.window || (tab.context && tab.context.window) || null;
      tab.context = { used: context.used != null ? context.used : (tab.context && tab.context.used) || 0, window };
    }
    clearTimeout(this.tokenPost);
    this.tokenPost = setTimeout(() => this.postTabs(), 150);
  }

  // ---------- checkpoints: back to before an earlier message ----------
  // Files the AI changed in answers after message `index` that aren't undone yet: { file, rel, change (the earliest
  // answer's: its snapshot is the file as it was before), changedSince (you edited it after the AI's last change) }.
  laterChanges(tab, index) {
    const byFile = new Map(), last = new Map();
    tab.messages.slice(index + 1).forEach((m) => {
      if (m.role !== "assistant" || m.inherited) return;
      for (const c of m.changes || []) {
        if (c.state === "undone" || !c.file) continue;
        if (!byFile.has(c.file)) byFile.set(c.file, c);
        last.set(c.file, c);
      }
    });
    return [...byFile.values()].map((c) => ({ file: c.file, rel: c.rel, change: c,
      changedSince: !!last.get(c.file).after && !this.changes.unchangedSince(c.file, last.get(c.file).after) }));
  }

  // Puts each of those files back as it was before message `index`. { restored: [rel], missing: [rel] }
  async restoreCode(tab, index) {
    const files = this.laterChanges(tab, index), restored = [], missing = [];
    for (const f of files) ((await this.changes.undo(f.change.id)) ? restored : missing).push(f.rel);
    tab.messages.slice(index + 1).forEach((m) => {
      if (m.inherited) return;
      for (const c of m.changes || []) if (c.state !== "undone" && !missing.includes(c.rel)) { c.state = "undone"; if (this.activity) this.activity.undone(c.rel); }
    });
    log(`chat ${tab.id}: code restored to before message ${index}: ${restored.length} file(s)${missing.length ? `, checkpoint missing for ${missing.join(", ")}` : ""}`);
    return { restored, missing };
  }

  // "Restore code" on a message: asks first (it overwrites files), then rolls back. The conversation stays.
  async restoreTo(tab, index) {
    const m = tab.messages[index];
    if (!m || m.role !== "user" || tab.status !== "idle") return;
    const files = this.laterChanges(tab, index);
    if (!files.length) { this.post({ type: "flash", text: "Nothing to restore: no changes after this message" }); return; }
    const since = files.filter((f) => f.changedSince).map((f) => f.rel);
    const go = await vscode.window.showWarningMessage("Put the code back as it was before this message?", { modal: true,
      detail: `${files.length} file${files.length === 1 ? "" : "s"} the AI changed after it go${files.length === 1 ? "es" : ""} back: ${files.map((f) => f.rel).join(", ")}.` +
        (since.length ? `\n\nYou changed ${since.join(", ")} yourself since then: those edits go too.` : "") +
        "\n\nWhat commands changed (installs, generated files) isn't undone. The conversation stays." }, "Restore Code");
    if (go !== "Restore Code") return;
    const { restored, missing } = await this.restoreCode(tab, index);
    this.redraw(tab);
    this.save();
    this.post({ type: "flash", text: missing.length ? `Restored ${restored.length}; no checkpoint for ${missing.join(", ")}` : `Code restored to before that message (${restored.length} file${restored.length === 1 ? "" : "s"})` });
  }

  // Editing message `index`: the chat goes back to just before it. Asks whether the code goes back too when answers after
  // it changed files. The AI starts a new session that gets the conversation up to there (journal.handoff), the same way
  // a switch to another AI does, so it doesn't remember the replaced part. false = cancelled.
  async rewindTo(tab, index) {
    const m = tab.messages[index];
    if (!m || m.role !== "user") return false;
    const files = this.laterChanges(tab, index);
    if (files.length) {
      const since = files.filter((f) => f.changedSince).map((f) => f.rel);
      const go = await vscode.window.showWarningMessage("Also put the code back as it was before this message?", { modal: true,
        detail: `The answers after it changed ${files.length} file${files.length === 1 ? "" : "s"}: ${files.map((f) => f.rel).join(", ")}.` +
          (since.length ? `\n\nYou changed ${since.join(", ")} yourself since then: restoring loses those edits.` : "") }, "Restore Code", "Keep Code");
      if (!go) return false;
      if (go === "Restore Code") await this.restoreCode(tab, index);
    }
    const old = this.runtime.get(tab.id);
    if (old && old.proc) { old.stale = true; old.proc.kill(); old.proc = null; }
    this.endDevice(old);
    tab.messages = tab.messages.slice(0, index);
    tab.sessionId = newSessionId(); tab.started = false; tab.context = null;
    tab.carryOver = index > 0 ? { model: true, edited: true, text: journal.handoff(tab.messages) } : null;
    if (!tab.carryOver) delete tab.carryOver;
    log(`chat ${tab.id}: edited message ${index}: the conversation goes back to before it`);
    this.redraw(tab);
    return true;
  }

  routingRequest(tab, text, attachments = [], contexts = []) {
    return { prompt: text, recentContext: ChatView.transcript(tab, 10000), current: tab.model,
      historyChars: ChatView.conversationSize(tab), context: ChatView.routingContext(contexts, attachments),
      profile: tab.routingProfile, mode: tab.mode, editing: tab.mode === "agent" || tab.mode === "auto",
      team: tab.team > 1, device: !!tab.device, connectors: !!tab.ticket,
      images: attachments.some((a) => a.kind === "image"), pdf: attachments.some((a) => a.kind === "pdf") };
  }

  // How long the conversation is (characters): switching models costs more the longer it is (lib/router/policy.js).
  static conversationSize(tab) {
    return (tab.messages || []).reduce((n, m) => n + String(m.sentText || ChatView.textOf(m.segments || [])).length +
      (m.blocks || []).reduce((k, b) => k + String(b.text || "").length, 0), 0);
  }

  // What came with the message, for Auto (Cursor's "attached context"): files and selections (not the open file, which
  // always comes), their size (file sizes, not read: routing must stay instant), browser elements, attached text files.
  static routingContext(contexts = [], attachments = []) {
    let files = 0, chars = 0, elements = 0;
    const size = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
    for (const c of contexts || []) {
      if (c.kind === "selection") { files++; chars += String(c.code || "").length; }
      else if (c.kind === "file") { files++; chars += size(c.path); }
      else if (c.kind === "element") elements++;
    }
    for (const a of attachments || []) if (a && a.path && !["image", "pdf"].includes(a.kind)) { files++; chars += size(a.path); }
    return { files, chars, elements };
  }

  // Auto learns from what you do after its answers (lib/router/learn.js): carried on = fine, undid all its changes =
  // that model didn't manage it, picked another model = that one suits such requests better.
  // (Undoing later still counts after you carried on: "bad" replaces "good".)
  routedAnswer(tab, index = tab.messages.length - 1, kind = "good") {
    for (let i = index; i >= 1; i--) {
      const a = tab.messages[i];
      if (a.role !== "assistant") continue;
      if (a.inherited || !a.routing || !a.routing.model || a.running || (kind === "good" && a.error) ||
        (a.routingJudged && !(kind === "bad" && a.routingJudged === "good"))) return null;
      const u = tab.messages[i - 1];
      return u && u.role === "user" ? { answer: a, prompt: ChatView.textOf(u.segments || []), model: a.routing.model } : null;
    }
    return null;
  }
  routerFeedback(tab, kind, better, index) {
    const memory = this.router && this.router.memory, r = this.routedAnswer(tab, index, kind);
    if (!memory || !r) return;
    if (memory.record(kind, { prompt: r.prompt, model: r.model, better })) { r.answer.routingJudged = kind; log(`model router: learned "${kind}" for ${r.model}${better ? ` (you picked ${better})` : ""}`); }
  }

  async routingCheckpoint(tab, r) {
    if (!tab.autoRoute || !this.router || !this.router.options().checkpoints || !journal.canCheckpoint(r) ||
      r.turn.switches || !r.turn.journal.tools.some((t) => t.status === "failed" && !/permission|declined|denied|cancelled|not authorized/i.test(t.result || ""))) return;
    // Claude supports native set_model; Kural's local engine can await this checkpoint. Other adapters switch next turn.
    const provider = engineOf(tab.model);
    if (!["claude","ollama"].includes(provider)) return;
    r.routingCheckpoint = true;
    const ctl = new AbortController(); r.checkpointAbort = ctl;
    const reply = r.turn.reply, was = tab.model;
    try {
      const result = await this.router.route({ ...this.routingRequest(tab,r.turn.ask, r.turn.attachments || []),
        recentContext: JSON.stringify({ tools: r.turn.journal.tools.slice(-8) }), provider, checkpoint: true },ctl.signal);
      r.routingCheckpoint = false;
      if (!journal.canCheckpoint(r) || ctl.signal.aborted || !tab.autoRoute || tab.model !== was || !result.model || result.model === was || result.error) return;
      if (provider === "ollama") {
        const checked = await this.prepareLocal({ ...tab,model: result.model });
        if (checked.error || ctl.signal.aborted || !tab.autoRoute || tab.model !== was || !journal.canCheckpoint(r)) return;
        r.proc.setModel(localName(result.model));
        r.proc.opts.capabilities = this.localReady.get(result.model) || [];
      } else {
        const accepted = await r.proc.request({ subtype: "set_model", model: result.model },1500);
        if (accepted === null || r.stale || !reply.running || ctl.signal.aborted || !tab.autoRoute || tab.model !== was) return;
      }
      tab.model = result.model; tab.modelName = null; r.turn.switches = 1;
      reply.models = [...new Set([...(reply.models || [was]),result.model])];
      reply.routing = result;
      this.post({ type: "patch",tabId: tab.id,msg: this.patchOf(reply) });
      this.remember(tab); this.postTabs(); this.save();
    } catch (e) { if (!ctl.signal.aborted) log("model router: checkpoint unavailable; current model continues"); }
    finally { r.routingCheckpoint = false; r.checkpointAbort = null; }
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
    if (r && r.steers && r.steers.length) return;      // … or with a queued message it hasn't taken in yet
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
    this.routerLocalList = models;
    if (this.router) this.router.changed();
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
    this.endDevice(old);
    const full = fullSetup();
    const instr = full ? { text: "", files: [] } : projectInstructions(this.root());
    const editing = tab.mode === "agent" || tab.mode === "auto";
    const team = this.teamSize(tab);
    // steers: messages you sent while it answered, given to the program but not taken in yet (see queueSend);
    // expect: every message given to the program, in order, until its echo says it was taken in (onEcho).
    const r = { proc: null, turn: null, perms: new Map(), procKey: this.procKey(tab), gotOutput: false, started: Date.now(), agents: new Map(), tasks: new Map(),
      steers: [], expect: [] };
    // The board reads who has finished from this file (see team-mcp.js): agents stop waiting for them.
    r.teamFile = team ? path.join(privateTmp("teams"), `${tab.id}-${Date.now()}.json`) : null;
    if (fresh) { tab.sessionId = newSessionId(); tab.started = false; }
    // Every mode can ask you a multiple-choice question (AskUserQuestion), shown as a card.
    // With your full setup, Claude can also use your skills.
    const tools = [...(editing ? AGENT_TOOLS : [...READ_TOOLS, ...WEB_TOOLS]),...(team ? ["Task"] : []), "AskUserQuestion", ...(full ? ["Skill"] : [])];
    // A Claude model: Claude Code. A model on this computer: Kural's own engine, with the same tools and events.
    // A linked device (SSH): its tools for the AI, through Kural (lib/devices). Kural asks you before each command per your
    // mode (approveDevice), so the AI's own program doesn't ask again (the tools are pre-allowed). Not for a model on
    // this computer: Kural's own engine has no MCP.
    const dev = tab.device && this.devices && deviceOk(tab.model) ? this.devices.session(tab.device, (tool, args) => this.approveDevice(tab, r, tool, args)) : null;
    if (dev) { r.deviceToken = dev.token; r.deviceDevice = tab.device; }
    const deviceTools = dev ? DEVICE_TOOLS.map((t) => `mcp__device__${t}`) : [];
    const local = isLocal(tab.model);
    const localTools = [...(editing ? ["Read", "Write", "Edit", "Glob", "Grep", "Bash"] : ["Read", "Glob", "Grep"]), "AskUserQuestion"];
    const proc = brain.makeAgent(tab.model, {
      name: `chat ${tab.id}`, effort: tab.effort, partial: true, showThinking: true, replay: true, mode: tab.mode,
      safeMode: !full, appendSystemPrompt: PROMPTS[tab.mode] + GUIDE + (MOOD_PROMPTS[tab.mood] || "") +
        (team ? teamPrompt(team, tab.roles || [], tab.teamStyle) : "") + ws.promptNote() + instr.text,
      addDirs: ws.extraDirs(),
      // (Read, Grep, Glob aren't pre-allowed: Claude Code reads inside the project by itself and asks Kural for anywhere
      // else, onPermission.)
      tools, allowedTools: [...WEB_TOOLS,...(team ? ["Task", "Agent", ...TEAM_TOOLS] : []), ...(full ? ["Skill"] : []), ...deviceTools],
      mcpServers: team || dev ? { ...(team ? { team: teamServer(teamMembers(team, tab.roles || [], tab.teamStyle).map((m) => m.name), r.teamFile) } : {}),
        ...(dev ? { device: dev.server } : {}) } : null,
      strictMcp: !full,     // full setup: your MCP servers and claude.ai connectors too
      hostPermissions: true, cwd: this.root() || ws.workDir(), persist: true,
      resume: tab.started ? tab.sessionId : null, sessionId: tab.started ? null : tab.sessionId,
    }, local ? { tools: localTools, allowedTools: ["Read", "Grep", "Glob"], readRoots: ws.aiRoots(), capabilities: this.localReady.get(tab.model) || [],
      store: brain.localStore(this.context) } : null, {
      onMessage: (m) => { if (r.stale) return; r.gotOutput = true; this.onClaude(tab, r, m); },
      onPermission: (req) => r.stale ? { allow: false, message: "Stopped." } : this.onPermission(tab, r, req),
      onExit: (info) => this.onExit(tab, r, info),
      onCheckpoint: () => this.routingCheckpoint(tab,r),
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
      this.giveBack(tab, r);
      const nr = this.startProc(tab, true);
      if (nr && pending) { nr.pendingSend = pending; nr.turn = r.turn; this.sendTo(nr, pending, "turn"); }
      return;
    }
    r.proc = null;
    // Messages you queued that it never took in: back into the box, not lost.
    this.giveBack(tab, r);
    if (last && last.role === "assistant" && last.running) {
      last.running = false;
      last.error = info.login ? "login" : "The model stopped unexpectedly. See Kural's log (Kural: Show Log).";
      if (info.login) last.errorWho = whoOf(tab.model);
      tab.status = "idle";
      this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(last) });
      this.postTabs(); this.save();
    } else if (tab.status !== "idle") { tab.status = "idle"; this.postTabs(); }   // (it was waiting for a queued message)
  }

  // ---------- messages sent while it answers (a queue) ----------
  // Enter while an answer runs doesn't stop it (Adithya): the message goes to the program at once, which takes it in at
  // its next step: Claude Code and Kural's engine add it to the running answer (after the tool it's running), Codex too
  // (turn/steer); otherwise (Gemini, or the answer ends first) it's answered next, as its own turn. Every program echoes
  // a message when it takes it in (Claude Code: --replay-user-messages), so the chat shows it where it went: inside the
  // answer ("steer" block) or as your next message. Until then it's in the queue above the box. Stop gives back what
  // wasn't taken in yet (into the box); for that the program is stopped for good, since it can't hand them back.

  // Give a message to the program, remembering it until its echo comes (onEcho).
  sendTo(r, content, kind, steer = null) {
    if (r.proc.echoes) (r.expect = r.expect || []).push({ kind, text: journal.textOf(content).trim(), steer });
    r.proc.send(content);
  }

  queuedOf(r) { return ((r && r.steers) || []).map((s) => ({ id: s.id, text: ChatView.textOf(s.segments).trim().slice(0, 300) })); }

  async queueSend(tab, segments, contexts, attachIds, requestId) {
    const r = this.runtime.get(tab.id);
    const live = (x) => x && !x.stale && x.proc && !x.proc.exited && x.turn && x.turn.dispatched && (x.turn.reply.running || (x.steers || []).length);
    if (!live(r)) { this.post({ type: "flash", text: "Kural is still starting the answer: send it in a moment" }); return; }
    if (!r.proc.echoes) { this.post({ type: "flash", text: "To send a message while it answers, update Claude Code (claude update)" }); return; }
    let text = ChatView.textOf(segments).trim();
    if (!text) { text = "Have a look at what I attached."; segments = [{ t: "text", v: text }]; }
    const built = await this.buildPrompt(text, contexts);
    if (!live(r) || this.runtime.get(tab.id) !== r) { this.post({ type: "flash", text: "The answer ended: send it again" }); return; }
    const { content, meta } = this.attachments.content(built, attachIds, []);
    if (meta.length) tab.granted = [...new Set([...(tab.granted || []), ...meta.flatMap((a) => [a.path, a.original]).filter(Boolean)])].slice(-50);
    const s = { id: shortId(), segments, attachments: meta, at: Date.now(),
      contexts: contexts.filter((c) => c.kind === "current").map((c) => ({ kind: c.kind, path: c.path, name: c.name })) };
    (r.steers = r.steers || []).push(s);
    this.sendTo(r, content, "steer", s);
    s.sentText = journal.textOf(content);
    this.post({ type: "queued", tabId: tab.id, requestId, queued: this.queuedOf(r) });
    log(`chat ${tab.id}: queued a message while it answers (${JSON.stringify(content).length} chars, ${meta.length} attachments)`);
  }

  // The program says it took in a message (its echo). A queued one goes into the running answer, or, if that answer is
  // over, becomes your next message with an answer of its own. (The echo of a normal message is just checked off.)
  onEcho(tab, r, m) {
    const text = journal.textOf(m.message && m.message.content).trim();
    r.expect = r.expect || []; r.steers = r.steers || [];
    let i = r.expect.findIndex((x) => x.text === text);
    if (i < 0) i = 0;
    const [x] = r.expect.splice(i, 1);
    if (!x || x.kind !== "steer") return;
    const s = x.steer;
    r.steers = r.steers.filter((y) => y !== s);
    clearTimeout(r.queueTimer);
    const reply = r.turn && r.turn.reply;
    if (reply && reply.running) {
      const block = { k: "steer", segments: s.segments, attachments: s.attachments.length ? s.attachments : undefined, at: Date.now() };
      reply.blocks.push(block);
      this.post({ type: "block", tabId: tab.id, block });
      if (r.turn.ask) r.turn.ask += `\n${ChatView.textOf(s.segments).trim()}`;
      log(`chat ${tab.id}: the queued message went into the running answer`);
    } else {
      const user = { role: "user", segments: s.segments, mode: tab.mode, contexts: s.contexts, sentText: s.sentText,
        ...(s.attachments.length ? { attachments: s.attachments } : {}) };
      const next = this.newReply(tab, null);
      tab.messages.push(user, next);
      tab.status = "running";
      tab.updatedAt = Date.now();
      this.post({ type: "append", tabId: tab.id, requestId: null, msgs: [user, next] });
      this.beginTurn(tab, r, next, ChatView.textOf(s.segments).trim(), s.attachments);
      log(`chat ${tab.id}: the queued message is answered next`);
    }
    this.post({ type: "queued", tabId: tab.id, queued: this.queuedOf(r) });
    this.postTabs(); this.save();
  }

  // Queued messages it never took in (it stopped, or you pressed Stop): back into the box.
  giveBack(tab, r) {
    if (!r) return;
    clearTimeout(r.queueTimer);
    const back = (r.steers || []).splice(0);
    r.expect = (r.expect || []).filter((x) => x.kind !== "steer");
    if (!back.length) return;
    log(`chat ${tab.id}: ${back.length} queued message${back.length === 1 ? "" : "s"} back in the box`);
    this.post({ type: "unqueue", tabId: tab.id, items: back.map((s) => ({ segments: s.segments, attachments: s.attachments.length })), queued: [] });
  }

  // ---------- sending ----------
  async buildPrompt(text, contexts) {
    const parts = [];
    const seen = new Set();
    for (const c of contexts) {
      const key = JSON.stringify([c.kind, c.path, c.startLine, c.endLine, c.element && c.element.selector]);   // (two elements of one page are two)
      if (seen.has(key)) continue; seen.add(key);
      if (c.kind === "selection") {
        parts.push(`${c.path} (lines ${c.startLine}-${c.endLine}):\n\`\`\`${c.lang || ""}\n${c.code}\n\`\`\``);
      } else if (c.kind === "element") {
        parts.push(elementNote(c.element || {}));
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
    return segments.map((s) => s.t === "text" ? s.v : s.ctx.kind === "element" ? `[element ${s.ctx.label} on ${s.ctx.path}]`
      : `@${s.ctx.path}${s.ctx.kind === "selection" ? ` (L${s.ctx.startLine}-${s.ctx.endLine})` : ""}`).join("");
  }

  // A tab title from your first message; pills read as "main.py (L3-9)".
  static titleOf(segments) {
    return segments.map((s) => s.t === "text" ? s.v : s.ctx.kind === "element" ? s.ctx.label : `${path.basename(s.ctx.path)}${s.ctx.kind === "selection" ? ` (L${s.ctx.startLine}-${s.ctx.endLine})` : ""}`)
      .join("").replace(/\s+/g, " ").trim().slice(0, 40);
  }

  // A new answer, empty for now.
  newReply(tab, routed) {
    return { role: "assistant", blocks: [], running: true, t0: Date.now(), mode: tab.mode, team: this.teamSize(tab), teamStyle: tab.teamStyle,
      teamLabel: this.teamLabel(tab), model: tab.model, models: [tab.model], routing: routed, journal: { tools: [] } };
  }

  // The program starts answering `reply`: what the turn tracks (changes, agents, the team's board).
  beginTurn(tab, r, reply, ask, attachments = null) {
    r.turn = { snaps: {}, reply, ask, journal: reply.journal, switches: 0, dispatched: !!attachments, ...(attachments ? { attachments } : {}) };
    r.agents = new Map();   // Task call id -> agent card
    r.turnStartAt = Date.now(); r.lastNotifyAt = 0; r.betweenTurns = false; r.concluded = 0;
    r.tasks = new Map();    // Claude's task id -> Task call id (team members' permission requests carry the task id)
    if (r.teamFile) { r.round = (r.round || 0) + 1; r.finished = []; this.writeTeamFile(r); }
    clearInterval(r.watchdog);
    if (reply.team) r.watchdog = setInterval(() => this.watchAgents(tab, r), 30 * 1000);
    clearInterval(r.busyTimer);
    if (reply.team && r.teamFile) r.busyTimer = setInterval(() => { if (r.stale || !reply.running) clearInterval(r.busyTimer); else this.writeTeamFile(r); }, 5000);
  }

  async send(tab, segments, contexts, attachIds = [], requestId = null, editIndex = null) {
    let text = ChatView.textOf(segments).trim();
    if (!text && !attachIds.length) return;
    if (tab.visiting) return;   // (a chat from another workspace: read only)
    // While it answers: into the queue (not an edit of an earlier message: that waits for the answer to end).
    if (tab.status !== "idle") { if (editIndex === null) await this.queueSend(tab, segments, contexts, attachIds, requestId); return; }
    if (!this.isReady()) { vscode.commands.executeCommand("kural.getStarted"); return; }   // nothing set up yet
    // An earlier message edited: the chat goes back to just before it (and the code too, if you say so), then this one is
    // sent in its place.
    if (editIndex !== null && !(await this.rewindTo(tab, editIndex))) return;
    let routed = null;
    const previousMedia = [...new Map(tab.messages.flatMap((m) => m.attachments || [])
      .filter((a) => ["image","pdf"].includes(a.kind)).map((a) => [a.path,a])).values()];
    if (tab.autoRoute && this.router) {
      this.routerFeedback(tab, "good");   // you carried on after Auto's last answer
      const ctl = new AbortController(); this.routingJobs.set(tab.id,ctl);
      tab.status = "running"; tab.routingState = "Choosing model…"; this.postTabs();
      const previous = tab.model;
      try {
        const attached = attachIds.map((id) => this.attachments.items.get(id)).filter(Boolean);
        // Attachments from earlier turns must remain usable after a provider handoff too.
        const historical = tab.messages.flatMap((m) => m.attachments || []);
        routed = await this.router.route(this.routingRequest(tab,text,[...attached,...historical],contexts),ctl.signal);
        if (ctl.signal.aborted || !this.tab(tab.id) || !tab.autoRoute || tab.model !== previous) return;
        if (routed.error) {
          // Nothing Auto may pick (no AI with an account set up, or none can do this): keep the chat's model if it works.
          if (!brain.providerOf(previous).ready()) { this.post({ type: "flash",text: routed.error }); return; }
          routed = { ...routed, model: previous, reason: `${routed.error} · kept ${previous}` };
        }
        // Another AI takes over with a record of the conversation (journal.handoff). When that record is too big for the
        // handoff budget, or an earlier picture/PDF is gone, Auto picks again within the current AI instead of refusing.
        const here = tab.engine || engineOf(previous);
        let changesProvider = engineOf(routed.model) !== here;
        const tooBig = () => journal.handoff(tab.messages).length > this.router.options().handoffChars;
        const missing = () => previousMedia.some((a) => !a.path || !fs.existsSync(a.path));
        if (changesProvider && tab.messages.length && (missing() || tooBig())) {
          const why = missing() ? "an earlier attachment is gone" : "the conversation is too long to hand over";
          // (On a model on this computer there's no "same AI" for Auto: that one stays.)
          const again = here === "ollama" ? { error: "local" }
            : await this.router.route({ ...this.routingRequest(tab,text,[...attached,...historical],contexts), provider: here }, ctl.signal);
          if (ctl.signal.aborted || !this.tab(tab.id) || !tab.autoRoute || tab.model !== previous) return;
          routed = again.error ? { ...routed, model: previous, reason: `${routed.reason} · kept ${previous}: ${why}` }
            : { ...again, reason: `${again.reason} · stayed with this AI: ${why}` };
          changesProvider = false;
        }
        tab.model = routed.model;
        // Auto also sets the intensity, unless you picked one yourself (picking a profile hands it back to Auto).
        if (routed.effort && !tab.effortPinned && valid(EFFORTS, routed.effort)) tab.effort = routed.effort;
        if (previous !== tab.model) { tab.modelName = null; tab.pendingModel = isClaude(tab.model); }
        this.remember(tab);
      } catch (e) { if (!ctl.signal.aborted) this.post({ type: "flash",text: "Model Router couldn't select a model. Check its panel." }); return; }
      finally {
        // Stop may already have begun another request. Only the owning request can reset this state.
        if (this.routingJobs.get(tab.id) === ctl) {
          this.routingJobs.delete(tab.id); delete tab.routingState; tab.status = "idle"; this.postTabs();
        }
      }
    }
    if (!brain.providerOf(tab.model).ready()) {   // e.g. a Claude model, but only your own model is set up
      const p = brain.providerOf(tab.model);
      this.post({ type: "flash", text: `${p.label} isn't set up: pick another model, or set it up in Get started` });
      vscode.commands.executeCommand("kural.getStarted", p.id === "ollama" ? "local" : p.id);
      return;
    }
    if (!text) { text = "Have a look at what I attached."; segments = [{ t: "text", v: text }]; }
    if (tab.title === "New chat" && !tab.renamed) tab.title = ChatView.titleOf(segments);
    const user = { role: "user", segments, mode: tab.mode, contexts: contexts.filter((c) => c.kind === "current").map((c) => ({ kind: c.kind, path: c.path, name: c.name })) };
    const reply = this.newReply(tab, routed);
    tab.messages.push(user, reply);
    tab.status = "running";
    tab.updatedAt = Date.now();
    this.post({ type: "append", tabId: tab.id, requestId, msgs: [user, reply] });
    this.postTabs();

    // The chat was on the other engine (Claude Code ↔ Kural's own): that one has the conversation, this one doesn't.
    // A new session, and this message carries the conversation so far (everything before it).
    const engine = engineOf(tab.model);
    const changedProvider = tab.engine && tab.engine !== engine;
    if (changedProvider) {
      if (tab.messages.length > 2) tab.carryOver = { model: true, text: journal.handoff(tab.messages.slice(0,-2)) };
      tab.sessionId = newSessionId(); tab.started = false; tab.context = null;
      const old = this.runtime.get(tab.id);
      if (old && old.proc) { old.stale = true; old.proc.kill(); old.proc = null; }
      this.endDevice(old);
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
    this.beginTurn(tab, r, reply, ask);
    // Continued from another workspace, or switched to a model on another engine (Claude ↔ your computer): the first
    // message carries the conversation so far.
    const carry = tab.carryOver && !tab.started ? (tab.carryOver.fork
      ? `<earlier_conversation>\n${tab.carryOver.text}\n</earlier_conversation>\nThis chat branches from that conversation at the selected message. Continue from it using my next message. The workspace files are still in their current state.\n\n`
      : tab.carryOver.edited
      ? `<earlier_conversation>\n${tab.carryOver.text}\n</earlier_conversation>\nThat's our conversation so far. I've changed my next message: answer it as it is now.\n\n`
      : tab.carryOver.model
      ? `<earlier_conversation>\n${tab.carryOver.text}\n</earlier_conversation>\nThat's our conversation so far (with another model). Carry on from it.\n\n`
      : `<earlier_conversation workspace="${tab.carryOver.from}">\n${tab.carryOver.text}\n</earlier_conversation>\n` +
        "That's our earlier conversation, from another workspace. Carry on from it here.\n\n") : "";
    const deviceNote = tab.device && this.devices && deviceOk(tab.model) ? this.devices.note(tab.device) : "";
    const ctl = new AbortController(); this.routingJobs.set(tab.id,ctl);
    let retrieved = "";
    if (this.router && this.router.options().context && vscode.workspace.isTrusted) {
      try {
        const candidates = await retrieve(text,ctl.signal,contexts.map((c) => c.path));
        const selected = await this.router.selectContext(text,candidates,ctl.signal);
        if (selected.candidates.length) retrieved = "<retrieved_context>\n" + selected.candidates.map((c) => `${c.file} (from line ${c.startLine}):\n${c.excerpt}`).join("\n\n") + "\n</retrieved_context>\n\n";
        reply.contextSelection = { count: selected.candidates.length, source: selected.source, ms: selected.ms };
      } catch { /* Context retrieval is optional; explicit context stays intact. */ }
    }
    if (ctl.signal.aborted || !reply.running) { if (this.routingJobs.get(tab.id) === ctl) this.routingJobs.delete(tab.id); return; }
    const built = await this.buildPrompt(text,contexts);
    if (ctl.signal.aborted || !reply.running) { if (this.routingJobs.get(tab.id) === ctl) this.routingJobs.delete(tab.id); return; }
    if (this.routingJobs.get(tab.id) === ctl) this.routingJobs.delete(tab.id);
    const { content: prompt, meta } = this.attachments.content(carry + ticketNote(tab.ticket) + deviceNote + retrieved + built, attachIds, carry ? previousMedia : []);
    user.sentText = journal.textOf(prompt).slice(carry.length);
    r.turn.attachments = [...meta,...previousMedia];
    if (meta.length) {
      user.attachments = meta; this.post({ type: "userAttachments", tabId: tab.id, attachments: meta });
      // What you attached the AI may read without asking, even outside the project (onPermission).
      tab.granted = [...new Set([...(tab.granted || []), ...meta.flatMap((a) => [a.path, a.original]).filter(Boolean)])].slice(-50);
    }
    r.pendingSend = prompt;
    r.turn.dispatched = true;
    this.sendTo(r, prompt, "turn");
    delete tab.carryOver;
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
    // The program took in a message we gave it (its echo): a queued one shows where it went.
    if (m.type === "user" && m.isReplay && !m.parent_tool_use_id) { this.onEcho(tab, r, m); return; }
    const turn = r.turn;
    const reply = turn && turn.reply;
    if (reply && reply.journal) journal.record(reply.journal,m);
    // Tokens and the context window (Codex, Gemini and Kural's engine say so with their own event; Claude in its messages).
    if (m.type === "kural_usage") { this.countTokens(tab, reply, m.tokens, m.context); return; }
    if (!m.parent_tool_use_id && m.type === "assistant" && m.message && m.message.usage && isClaude(tab.model)) {
      const u = m.message.usage, used = ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"].reduce((a, k) => a + (Number(u[k]) || 0), 0);
      if (used) this.countTokens(tab, null, null, { used });
    }
    if (m.type === "result" && isClaude(tab.model)) {
      const windows = Object.values(m.modelUsage || {}).map((x) => Number(x.contextWindow) || 0).filter(Boolean);
      this.countTokens(tab, reply, usageHub.fromResult(m), windows.length ? { window: Math.max(...windows) } : null);
    }
    if (reply && !m.parent_tool_use_id && m.type === "assistant" && m.message && m.message.model) {
      tab.modelName = shownModel(tab,m.message.model);
      this.post({ type: "modelName",tabId: tab.id,name: tab.modelName });
    }
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
      const owner = a || (m.task_id && r.agents.get(r.tasks.get(m.task_id)));
      // Only an agent's report wakes the lead. (Claude Code reports a long Bash command as a background task too: counted
      // as an agent, it made Kural send "All the agents you started have reported back…" after an ordinary command.)
      if (m.subtype === "task_notification" && owner) r.lastNotifyAt = Date.now();
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
      if (isClaude(tab.model)) this.routingCheckpoint(tab,r).catch(() => {});
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
    this.sendTo(r, "All the agents you started have reported back. If your instructions have a next phase (the user's OK, " +
      "building, checking), go on with it now. Otherwise give me the final answer: the result or decision, why, and any " +
      "disagreement that remains.", "nudge");
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
    setup.full = !!fullSetup();
    // Announce a connector that wasn't there before (not on the very first report).
    const known = tab.knownServers ? new Set(tab.knownServers) : null;
    // (Kural's own servers, the device's tools and the team's board, aren't news.)
    const added = known ? setup.servers.filter((x) => x.status === "connected" && !known.has(x.name) && x.name !== "device" && x.name !== "team").map((x) => x.name) : [];
    tab.knownServers = [...new Set([...(tab.knownServers || []), ...setup.servers.filter((x) => x.status === "connected").map((x) => x.name)])];
    setup.jira = atlassianState(setup);   // can "+ → Link ticket" work, and if not, why
    tab.setup = setup;
    // (A connector that connects is only logged: the "Now connected" pop-ups added nothing, Adithya.)
    if (added.length) log(`chat ${tab.id}: now connected: ${added.join(", ")}`);
    if (!this.shown(tab.id)) return;
    this.post({ type: "setup", tabId: tab.id, setup });
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
    if (this.router && (reply.models || []).length === 1) this.router.taskDone(reply.model,reply.ms,!m.is_error);
    // Stop can happen while context is still being prepared, before the provider receives anything.
    if (r.turn.dispatched !== false) tab.started = true;
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
    // A message you queued that it hasn't taken in yet: it's answered next (its echo opens that answer, onEcho), so the
    // chat stays busy meanwhile. Never taken in within 30 s (the program got stuck): back into the box.
    const queued = !!(r.steers || []).length && !r.stale && r.proc && !r.proc.exited;
    tab.status = queued ? "running" : "idle";
    if (queued) {
      clearTimeout(r.queueTimer);
      r.queueTimer = setTimeout(() => {
        if (!r.steers.length || r.turn.reply.running) return;
        this.giveBack(tab, r);
        if (tab.status !== "idle") { tab.status = "idle"; this.postTabs(); }
      }, 30000);
    }
    if (!this.shown(tab.id)) tab.unread = true;
    this.finishTurn(tab, r);
    // Tab learns what you're working on, and which files the chat changed for it.
    if (this.activity && r.turn.ask && reply.error !== "stopped") this.activity.addWork("chat", r.turn.ask, (reply.changes || []).map((c) => c.rel));
    this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) });
    this.postTabs(); this.save();
    // If you changed mode/intensity while it was answering, get the new setup ready now (not with a queued message
    // waiting in this one: warm() waits for that).
    if (r.procKey !== this.procKey(tab)) this.warm(tab);
  }

  // Stop no matter what state Claude is in.
  forceStop(tab, r) {
    const routing = this.routingJobs.get(tab.id); if (routing) { routing.abort(); this.routingJobs.delete(tab.id); }
    delete tab.routingState;
    if (r) {
      this.giveBack(tab, r);   // queued messages it hadn't taken in: back into the box
      if (r.checkpointAbort) r.checkpointAbort.abort();
      clearInterval(r.watchdog); clearInterval(r.busyTimer);
      if (r.teamFile) fs.rm(r.teamFile, { force: true }, () => {});
      r.stale = true;
      if (r.proc) r.proc.kill();
      r.proc = null;
      this.endDevice(r);
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
      const roots = this.projectRoots(tab);
      const files = this.changes.summary(r.turn, this.root()).filter((c) => inProject(c.file, roots));
      if (files.length) reply.changes = files;
    } catch (e) { log(`chat: couldn't list changes: ${e.message}`); }
  }

  patchOf(msg) { return { waitingFor: msg.waitingFor, running: msg.running, error: msg.error, errorWho: msg.errorWho, changes: msg.changes, ms: msg.ms, note: msg.note, blocks: msg.blocks, planReady: msg.planReady, planBuilt: msg.planBuilt, model: msg.model, models: msg.models, routing: msg.routing, contextSelection: msg.contextSelection }; }

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
        // A checkpoint (for Undo, Restore code and the Files changed card) only for a file in the project: not a note in
        // the temp folder, not Claude Code's own plans or memory (~/.claude).
        const abs = path.resolve(this.root() || ws.workDir(), String(file));
        if (inProject(abs, this.projectRoots(tab))) this.changes.snapshot(turn, abs);
      }
      // Inside your project (or Kural's own work folder, the temp folder): no asking, that's what Agent mode is for.
      // Anywhere else (~/.zshrc, a LaunchAgent, Claude Code's own settings with its hooks) a write can make the
      // computer run something later, so it asks like a command does (Auto still doesn't ask).
      // (agy only tells, `notice`: it doesn't wait for an answer, so no card.)
      if (!file || req.notice || ws.mayUse(file, true)) return { allow: true };
    }
    // Reading inside your project: no asking. Elsewhere (your Documents, Desktop…) it asks, like a command: on a Mac
    // reading there also makes macOS ask about Kural.
    if (READ_TOOLS.includes(req.tool_name)) {
      const where = input.file_path || input.path;
      if (!where || ws.mayUse(where) || within(where, tab.granted || [])) return { allow: true };
    }
    if (SUBAGENT_TOOLS.has(req.tool_name)) return { allow: true };
    // A linked device's tools: Kural asks before each command itself (approveDevice), so the program's own ask is a yes.
    if (tab.device && DEVICE_TOOL_RE.test(req.tool_name)) return { allow: true };
    // Reading Jira (the linked ticket, a search) changes nothing, so it doesn't ask. Writing to Jira
    // (comments, status changes, new issues) still asks below.
    if (isAtlassianRead(req.tool_name)) return { allow: true };
    if (req.tool_name === "AskUserQuestion") return this.askUser(tab, r, req);
    // "Allow all" is kept apart for a device: allowing every `npm test` here must not allow everything on the robot.
    const onDevice = req.tool_name === "DeviceCommand" || req.tool_name === "DeviceWrite";
    if (tab.mode === "auto" || (onDevice ? !!tab.device && tab.allowAllDevice === tab.device : tab.allowAll)) return { allow: true };
    // Agent mode: running commands asks you first.
    const pid = shortId();
    const owner = req.agent_id && r.agents.get(r.tasks.get(req.agent_id));   // a team member asking
    const block = { k: "perm", pid, tool: req.tool_name, detail: permDetail(req.tool_name, input), state: "pending", agent: owner ? owner.name || `Agent ${owner.n}` : undefined,
      where: input.device || undefined };   // (a linked device's name, for its commands and writes)
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

  // A command or a file write on the linked device: your mode decides, like a command here. (Reads just happen.)
  async approveDevice(tab, r, tool, args) {
    const d = this.devices && this.devices.get(tab.device);
    if (tab.mode === "plan" || tab.mode === "ask") return { allow: false, message: `${tab.mode === "plan" ? "Plan" : "Ask"} mode: nothing is run or changed on the device. Describe the command instead.` };
    if (!r.turn || !r.turn.reply.running) return { allow: false, message: "The answer was stopped." };
    return this.onPermission(tab, r, { tool_name: tool === "run_command" ? "DeviceCommand" : "DeviceWrite",
      input: { ...args, device: d ? d.name : "the device" } });
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
    // Gemini (Antigravity) can't be asked: what it may do is fixed when it starts, so every mode applies from the next message.
    if (engineOf(tab.model) === "agy") this.post({ type: "flash", text: "Gemini: the new mode applies from your next message" });
    else if (editing(was) !== editing(tab.mode)) this.post({ type: "flash", text: `${tab.mode === "plan" ? "Plan" : tab.mode === "ask" ? "Ask" : "Editing"} mode applies from your next message` });
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
          moods: MOODS, roles: ROLES, teamStyles: TEAM_STYLES, version: this.version, ready: this.isReady(), claudeReady: isSetUp(), clis: this.cliInfo(), pics: this.filesFor(w),
          didYouKnow: didYouKnow() });
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
      case "send": if (tab) await this.send(tab, m.segments, m.contexts, m.attachments || [], typeof m.requestId === "string" ? m.requestId.slice(0,100) : null,
        Number.isInteger(m.editIndex) ? m.editIndex : null); break;
      case "restore": if (tab && Number.isInteger(m.index)) await this.restoreTo(tab, m.index); break;
      case "fork": if (tab) await this.forkAsk(tab, m.index, pane); break;
      case "attachPick": {
        const uris = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFiles: true, openLabel: "Attach", title: "Attach files to your message" });
        const items = (uris || []).map((u) => this.attachments.add(u.fsPath)).filter(Boolean);
        if (items.length && pane) this.postTo(pane, { type: "attached", items });
        break;
      }
      // Web links open in Kural's browser tab (the Integrated Browser), where you can also pick elements of the page.
      case "openUrl":
        if (/^https?:\/\//i.test(m.url || "")) vscode.commands.executeCommand("kural.browser.open", m.url);   // (inside Kural)
        break;
      case "browser": vscode.commands.executeCommand("kural.browser.open", m.url); break;
      case "browserPick": vscode.commands.executeCommand("kural.browser.pick"); break;
      case "ticketSearch": {
        const out = await this.tickets.search(m.query || "", (text) => pane && this.postTo(pane, { type: "ticketStatus", id: m.id, text }));
        if (!out.cancelled && pane) this.postTo(pane, { type: "ticketResults", id: m.id, ...out });
        break;
      }
      case "devices": if (pane) this.postTo(pane, { type: "devices", list: this.deviceList() }); break;
      case "linkDevice": if (tab) {
        tab.device = m.id && this.devices && this.devices.get(m.id) ? m.id : null;
        tab.allowAllDevice = null;   // a new link asks again
        // Unlinked (or another device) mid-answer: the running model loses the device at once, not at the next message.
        const run = this.runtime.get(tab.id);
        if (run && run.deviceDevice !== tab.device) this.endDevice(run);
        log(`chat ${tab.id}: ${tab.device ? `linked device ${this.devices.get(tab.device).name}` : "device unlinked"}`);
        this.save(); this.postTabs();
        if (tab.status === "idle") this.warm(tab); else this.post({ type: "flash", text: "The device is linked from your next message" });
        break;
      }
      case "addDevice": if (this.devices) {
        const r = await this.devices.add(m.device || {});
        if (pane) this.postTo(pane, { type: "deviceAdded", id: m.reqId, ok: r.ok, error: r.error || "", list: this.deviceList(), device: r.device ? { id: r.device.id } : null });
        if (r.ok && tab) { tab.device = r.device.id; this.save(); this.postTabs(); if (tab.status === "idle") this.warm(tab); }
        break;
      }
      case "deviceTerminal": if (m.id) vscode.commands.executeCommand("kural.devices.terminal", m.id); break;
      case "manageDevices": vscode.commands.executeCommand("kural.devices"); break;
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
        const routing = this.routingJobs.get(tab.id);
        if (routing) { this.forceStop(tab,this.runtime.get(tab.id)); break; }
        const r = this.runtime.get(tab.id);
        // Agents working in the background don't stop on an interrupt, and a paused lead has
        // nothing to interrupt: end the whole process. The conversation is saved, so the next
        // message picks it up again. The same with a queued message it hasn't taken in: after an interrupt it would
        // answer that one; stopped, the message goes back into the box (giveBack).
        if (!r || !r.proc || r.proc.exited || [...r.agents.values()].some((a) => a.state === "running") || (r.steers || []).length) { this.forceStop(tab, r); break; }
        for (const res of r.perms.values()) res(false);
        r.perms.clear();
        r.proc.interrupt();
        const turn = r.turn;   // if Claude doesn't confirm within 5 s, stop it the hard way
        setTimeout(() => { if (r.turn === turn && turn && turn.reply.running) this.forceStop(tab, r); }, 5000);
        break;
      }
      case "setModel": {
        if (!validModel(m.model)) return;
        const choosing = this.routingJobs.get(tab.id); if (choosing) choosing.abort();
        const checkpoint = this.runtime.get(tab.id); if (checkpoint && checkpoint.checkpointAbort) checkpoint.checkpointAbort.abort();
        const was = tab.model;
        // Right after an Auto answer, picking another model says Auto chose wrong for this kind of request.
        if (tab.autoRoute && m.model !== was && tab.status === "idle") this.routerFeedback(tab, "better", m.model);
        tab.autoRoute = false;
        tab.model = m.model;
        const r = this.runtime.get(tab.id);
        if (engineOf(m.model) !== engineOf(was) || isLocal(m.model)) {
          // To another program (Claude Code, Codex, Gemini, Kural's own engine), which doesn't have this conversation:
          // send() notices (tab.engine) and starts a new session that carries the conversation.
          if (tab.status === "idle" && !(tab.engine && tab.engine !== engineOf(m.model))) this.warm(tab);
          else this.post({ type: "flash", text: "The new model takes over with your next message" });
        } else if (r && r.proc && !r.proc.exited) r.proc.setModel(isClaude(m.model) ? m.model : cliModel(m.model));
        // Switch right away, keeping the conversation — even in the middle of an answer:
        // Claude's next step already uses the new model.
        tab.modelName = null;
        this.post({ type: "modelName", tabId: tab.id, name: null });   // show the new choice right away
        this.remember(tab); this.postTabs(); this.save();
        break;
      }
      case "setRouterProfile": {
        if (!tab || !["balance","cost","intelligence"].includes(m.profile)) break;
        tab.autoRoute = true; tab.routingProfile = m.profile; tab.effortPinned = false;
        this.remember(tab); this.postTabs(); this.save();
        if (tab.status !== "idle") this.post({ type: "flash",text: "The routing profile applies at the next supported checkpoint or message" });
        break;
      }
      case "routerPanel": vscode.commands.executeCommand("kural.modelRouter"); break;
      case "setEffort": if (valid(EFFORTS, m.effort)) {
        tab.effort = m.effort; tab.effortPinned = !!tab.autoRoute; this.remember(tab); this.postTabs(); this.save();
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
        if (m.always) {
          const b = r && r.turn && r.turn.reply.blocks.find((x) => x.k === "perm" && x.pid === m.pid);
          if (b && b.where) tab.allowAllDevice = tab.device;   // only this device, only while it's linked
          else { tab.allowAll = true; this.post({ type: "allowAll", tabId: tab.id }); }
        }
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
      case "openFile": await this.openPath(m.path, m.line, m.endLine); break;
      // A picture in the chat, clicked: in its own editor tab, full size (VS Code's picture viewer; a web picture in a
      // small page of its own).
      case "openImage": await this.openImage(m.path, m.url); break;
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
    if (!msg || !msg.changes || (msg.inherited && m.action !== "review")) return;
    const targets = m.id === "*" ? msg.changes.filter((c) => c.state === "pending") : msg.changes.filter((c) => c.id === m.id);
    for (const c of targets) {
      if (m.action === "review") { await this.changes.review(c.id); continue; }
      if (m.action === "undo") { if (await this.changes.undo(c.id)) { c.state = "undone"; if (this.activity) this.activity.undone(c.rel); } }
      if (m.action === "keep") { this.changes.keep(c.id); c.state = "kept"; }
    }
    // Every change of an Auto answer undone: that model didn't manage this kind of request.
    if (msg.routing && msg.changes.length && msg.changes.every((c) => c.state === "undone")) this.routerFeedback(tab, "bad", null, m.msgIndex);
    this.post({ type: "patch", tabId: tab.id, index: m.msgIndex, msg: this.patchOf(msg) });
    this.save();
  }

  // What you last asked in this chat (Apply / Insert of its code is for that).
  lastAsk(tab) {
    const u = [...tab.messages].reverse().find((x) => x.role === "user");
    return u ? ChatView.textOf(u.segments || []) : "";
  }

  // An element picked in the Kural Browser (lib/browser): a pill in the message you're writing, in the chat you used
  // last; its details go to the model with the message (elementNote).
  async addElement(info) {
    const ctx = { kind: "element", path: info.url, label: `<${info.short}>`, element: info };
    await this.reveal();
    const pane = this.cur();
    if (pane) this.postTo(pane, { type: "insertPill", ctx });
    vscode.window.setStatusBarMessage(`Kural: added ${info.short} to the chat`, 3000);
  }

  // What VS Code's Integrated Browser sends ("Add Element to Chat", "Comment on Elements", screenshots, console logs;
  // rebrand.py routes it here as `kural.browser.attach`): elements and console logs become pills in the message
  // you're writing (with the comment typed in the browser as the start of your message); pictures become attachments.
  async addBrowserItems(items) {
    await this.reveal();
    const pane = this.cur();
    if (!pane) return;
    const added = [];
    for (const x of items || []) {
      if (x.image) {
        const ext = /png/i.test(x.mime || "") ? "png" : "jpg";
        const a = this.attachments.addData(`${x.kind === "element" ? "element" : "screenshot"}-${Date.now() % 100000}.${ext}`, x.image);
        if (a) this.postTo(pane, { type: "attached", items: [a] });
      }
      if (x.kind !== "element" || !x.value) { if (x.image) added.push("a screenshot"); continue; }
      const url = (/^URL: (\S+)/m.exec(x.value) || [])[1] || "browser";
      const label = x.name && x.name.length < 60 ? `<${x.name}>` : "<element>";
      const ctx = { kind: "element", path: url, label, element: { note: x.value, text: x.innerText || "", comment: x.comment || "", short: x.name || "element", url } };
      this.postTo(pane, { type: "insertPill", ctx, text: x.comment ? ` ${x.comment}` : "" });
      added.push(label);
    }
    if (added.length) vscode.window.setStatusBarMessage(`Kural: added ${added.join(", ")} to the chat`, 3000);
  }

  // A file the chat mentions or links: open it (at the line). A folder: show it in the Explorer. A picture or another
  // file that isn't text: VS Code's own viewer. Just a name ("devices.test.js") or a path from another folder: the
  // project's file it means (ws.find); several: you pick. Not there: say so (a model can name a file that doesn't exist).
  async openPath(p, line, endLine) {
    let uri = p ? null : this.resolvePath(p);
    if (p) {
      const found = await ws.find(p);
      if (found.length > 1) {
        const pick = await vscode.window.showQuickPick(found.map((f) => ({ label: path.basename(f.uri.fsPath), description: f.label, uri: f.uri })),
          { placeHolder: `More than one file matches ${p}: which one?` });
        if (!pick) return;
        uri = pick.uri;
      } else if (found.length) uri = found[0].uri;
      else { vscode.window.showWarningMessage(`Kural can't find ${p} in this project.`); return; }
    }
    if (!uri) return;
    let st;
    try { st = await vscode.workspace.fs.stat(uri); } catch { vscode.window.showWarningMessage(`Kural can't find ${p}.`); return; }
    if (st.type & vscode.FileType.Directory) { await vscode.commands.executeCommand("revealInExplorer", uri); return; }
    if (/\.(png|jpe?g|gif|webp|bmp|ico|svg|pdf|mp4|webm|mp3|wav|zip)$/i.test(uri.fsPath)) { await vscode.commands.executeCommand("vscode.open", uri, { preview: false }); return; }
    const l = Math.max(0, (line || 1) - 1), e = Math.max(l, (endLine || line || 1) - 1);
    try {
      await vscode.window.showTextDocument(uri, { preview: false, selection: line ? new vscode.Range(l, 0, e, 0) : undefined });
    } catch { await vscode.commands.executeCommand("vscode.open", uri, { preview: false }); }
  }

  async openImage(p, url) {
    if (p) {
      const uri = this.resolvePath(p);
      if (uri) { await vscode.commands.executeCommand("vscode.open", uri, { preview: false }); return; }
    }
    if (!/^https:\/\//.test(url || "")) return;
    const panel = vscode.window.createWebviewPanel("kural.picture", "Picture", vscode.ViewColumn.Active, { enableScripts: false });
    const safe = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    panel.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline';">
<style>html,body{height:100%;margin:0;background:var(--vscode-editor-background)}body{display:grid;place-items:center}img{max-width:100%;max-height:100vh;object-fit:contain}</style>
</head><body><img src="${safe}" alt=""></body></html>`;
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
    case "mcp__device__run_command": return input.command || "";
    case "mcp__device__read_file": case "mcp__device__write_file": case "mcp__device__list_dir": return input.path || "~";
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
  if (tool === "DeviceCommand") return input.command || "";
  if (tool === "DeviceWrite") return `${input.path || ""}\n\n${String(input.content || "").slice(0, 600)}${String(input.content || "").length > 600 ? "\n…" : ""}`;
  if (tool === "WebFetch") return input.url || "";
  if (EDIT_TOOLS.has(tool)) return `${input.file_path || input.notebook_path || ""}\n(outside this project)`;
  if (READ_TOOLS.includes(tool)) return `${input.file_path || input.path || ""}\n(outside this project)`;
  return JSON.stringify(input).slice(0, 300);
}

// Your full Claude Code setup (your MCP servers, hooks, skills, and the project's .claude settings) only in a folder
// you trust: a project's own .claude/settings.json can run commands (hooks), and Kural starts Claude early.
function fullSetup() { return !!cfg().get("chat.fullClaudeCodeSetup") && vscode.workspace.isTrusted; }
// While an answer is worked on, a "Did you know?" tip or fact under it (media/facts.js). On unless you turned it off.
function didYouKnow() { return cfg().get("chat.didYouKnow", true) !== false; }

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// What the model reads about an element you picked in the Kural Browser.
function elementNote(e) {
  // From VS Code's Integrated Browser: its own description of the element (HTML path, outer HTML, size, computed CSS).
  if (e.note) {
    const out = [e.note];
    if (e.comment) out.push(`My instruction for this element: ${e.comment}`);
    out.push("(Find the code that makes this element in my project, searching for its classes, id or text, before you change anything.)");
    return out.join("\n\n");
  }
  const lines = [`An element I picked on the page ${e.url || ""}${e.title ? ` ("${e.title}")` : ""}:`,
    `- element: <${e.short || e.tag}>, selector: ${e.selector || "?"}${e.size ? `, ${e.size[0]}x${e.size[1]} px` : ""}`];
  if (e.component && e.component.name) lines.push(`- ${e.component.framework || ""} component: ${e.component.name}${e.component.file ? ` (${e.component.file}${e.component.line ? `:${e.component.line}` : ""})` : ""}`);
  if (e.text) lines.push(`- text: ${JSON.stringify(e.text)}`);
  const st = Object.entries(e.styles || {}).map(([k, v]) => `${k}: ${v}`).join("; ");
  if (st) lines.push(`- styles: ${st}`);
  if (e.html) lines.push("```html\n" + e.html + "\n```");
  return lines.join("\n");
}

module.exports = { ChatView, MODELS, EFFORTS, MODES, _test: { PROMPTS, teamPrompt, FRIENDS, ROLES, MOOD_PROMPTS, toolDetail } };
