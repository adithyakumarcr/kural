// The chat panel (Ctrl+L): tabs, history, modes (Agent / Auto / Plan / Ask),
// model + intensity, and parallel agents. The panel itself is a small web page
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
const { isCommentInput } = require("../edit/inline-ask");
const { Attachments } = require("./attachments");
const { within, runsLater, isHomeOrAbove, HOME_PROTECTED, privateTmp } = require("../paths");
const { ChatArchive } = require("./archive");
const { trimMessages } = require("./trim");
const { forkConversation } = require("./fork");
const { Ollama, memoryGB, totalMemoryGB, MIN_VERSION } = require("../ai/ollama");
const brain = require("../ai");
const { installOllama } = require("../tab/local");
const { watchSetup } = require("../ai/claude-setup");
const { Tickets, atlassianState, ticketNote } = require("./tickets");
const { PROMPTS, MOOD_PROMPTS, customMoods, shownMoods, moodPrompt, lessonPrompt, debugNote } = require("./prompts");
const { DebugLogs } = require("../debug/server");
const { GUIDE, GUIDE_LOCAL } = require("./guide");
const { registerTabEditor, openBeside, tabOf, SCHEME } = require("./tab-editor");
const { profileOf, limitUsed, limitParts } = require("../router/policy");
const journal = require("../router/journal");
const handoffStore = require("./handoff-store");
const { SideChats } = require("./side");
const slashList = require("./slash");
const shortcuts = require("./shortcuts");
const projectRules = require("../rules/core");
const { Enhancer } = require("../enhance");
const { Titler } = require("./title");
const { Voice } = require("../voice");
const { Listen } = require("../listen");
const { pickModel } = require("../listen/script");
const scope = require("../profiles/scope");
const usageHub = require("../ai/usage");
const { retrieve } = require("../router/retrieve");
const { excludedModel, completionModel } = require("../ai/model-policy");
const { Notifier, notifyDecision, message: notifyText } = require("./notify");
const { NAME: BROWSER_SERVER, TOOLS: BROWSER_TOOLS } = require("../browser/bridge");

// A question card (AskUserQuestion) you asked about before answering: what the AI is told instead of an answer.
const ASK_ANSWER = (q) => `The user hasn't chosen yet and asks: "${q}". Answer that briefly, then ask your question again with AskUserQuestion, changed if your answer changes the options.`;
// The note you wrote in the chat box goes with the last question's answer: "Only if I was at the bottom. Note: keep it simple".
function withNote(answers, questions, note) {
  const n = typeof note === "string" ? note.trim().slice(0, 2000) : "";
  if (!n) return answers;
  const out = { ...answers };
  const asked = (questions || []).map((q) => q && q.question).filter((q) => q in out);
  const last = asked.length ? asked[asked.length - 1] : Object.keys(out).pop();
  if (last !== undefined) out[last] = `${String(out[last]).replace(/[.\s]+$/, "")}. Note: ${n}`;
  return out;
}

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
  { id: "debug", label: "Debug", hint: "finds the cause with logs" },
  { id: "auto", label: "Auto", hint: "edits and runs commands freely" },
  { id: "plan", label: "Plan", hint: "a plan first, no changes" },
  { id: "ask", label: "Ask", hint: "answers only" },
];
// A model on your own computer (Ollama) is saved as "ollama:<name>", e.g. "ollama:qwen3-coder:30b".
const isLocal = (model) => /^ollama:./.test(model || "");
const localName = (model) => String(model).slice("ollama:".length);
const validModel = (m) => valid(MODELS, m) || ((/^ollama:./.test(m || "") || !!cliOf(m)) && m.length < 200);
// Which program has the conversation: "claude" (Claude Code), "ollama" (Kural's own engine), "codex", "agy" (Gemini).
const { CLIS, IDS: CLI_IDS, cliOf, cliModel } = require("../ai/clis");
const { splitLevel } = require("../ai/agy");
const { isGateFile } = require("../ai/agy-gate-host");
const engineOf = (m) => brain.engineOf(m);
// A linked device's tools need the model's program to take Kural's MCP server and ask Kural before each command:
// Claude Code and Codex do; Kural's own engine (Ollama) has no MCP, and Gemini (Antigravity) can't ask.
const deviceOk = (m) => ["claude", "codex"].includes(engineOf(m));
const isClaude = (m) => engineOf(m) === "claude";
const whoOf = (m) => brain.providerOf(m).label;   // "Claude", "ChatGPT (Codex)", "Google Gemini", "Your own model"
// Your default model for parallel agents, per AI: { claude: "haiku", codex: "codex:…" } (an entry that doesn't fit goes).
const cleanWorkers = (w) => Object.fromEntries(Object.entries(w && typeof w === "object" ? w : {})
  .filter(([e, m]) => typeof m === "string" && validModel(m) && !isLocal(m) && engineOf(m) === e));

const { decide, gatedMode, grantKey, allowAllNow, allowKind, allowLabel, allowedKinds, autoWarning, READ_TOOLS, EDIT_TOOLS, DEVICE_TOOLS } = require("./permission-policy");
// Every mode may look things up on the web (docs, versions, current facts), without asking: it changes nothing here.
const WEB_TOOLS = ["WebSearch", "WebFetch"];
const AGENT_TOOLS = ["Read", "Grep", "Glob", "Edit", "Write", "NotebookEdit", "Bash", "WebSearch", "WebFetch"];
const AUTO_WARNED = "kural.auto.warned";   // the first switch to Auto explained what it means
const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);   // Claude Code's tool for starting a helper agent
const BUILD_TEXT = "Go ahead and implement the plan above.";
// Memory: a chat's program (Claude Code ~120 MB, Ross measured) stops when that chat isn't on screen and has been idle
// this long; at most this many such idle ones stay warm. It starts again with the same conversation when needed.
const IDLE_STOP_MS = 10 * 60 * 1000;
const MAX_IDLE_WARM = 2;

const MAX_INLINE = 60000;       // files bigger than this are read by Claude instead of pasted in
const STORE_BASE = "kural.chat.v4";   // open tabs, per window (a profile that doesn't share has its own: lib/profiles/scope.js)
const storeKey = () => scope.key(STORE_BASE, "data");
const LAST_KEY = "kural.chat.last";   // your last model / intensity / mode / parallel agents, for new tabs

const cfg = () => vscode.workspace.getConfiguration("kural");
const shortId = () => require("crypto").randomBytes(8).toString("hex").slice(0, 9);   // (chat and card ids: never guessable)
const valid = (list, v) => list.some((x) => x.id === v);
// Modes that edit files and ask before commands: Agent, and Debug (Agent with a way of working: lib/debug).
const agentLike = (m) => m === "agent" || m === "debug";
// The kural.chat.mode setting for new chats. Auto (commands run without asking) only from YOUR settings: a project's
// .vscode/settings.json can't turn it on for you (APP-8).
function settingMode() {
  const m = cfg().get("chat.mode"), i = cfg().inspect ? cfg().inspect("chat.mode") : null;
  if (m === "auto") return i && i.globalValue === "auto" ? "auto" : "agent";
  return valid(MODES, m) ? m : "agent";
}

// Messages meant only for the pane you're using (see ChatView.post).
const ONE_PANE = new Set(["full", "attached", "pasted", "insertPill", "focus", "showHistory", "flash"]);
// At most this many chats side by side in the side panel (media/chat-columns.js MAX_COLS).
const MAX_COLUMNS = 4;

class ChatView {
  constructor(context, apply) {
    this.context = context;
    this.apply = apply;          // (code, uri, ask) => Promise   (Apply button on code blocks)
    this.activity = null;        // what you've been doing, for Tab (activity.js); set by extension.js
    this.explorer = null;        // what the AI reads and changes now, shown in the Explorer (lib/explorer); set by extension.js
    this.tickets = new Tickets(() => vscode.workspace.isTrusted ? this.root() : ws.workDir());   // Jira search for "+ → Link ticket"
    // ("v1.1.0-alpha.3", or "Unreleased version · main (…)" when built from the code: lib/version.js)
    this.version = require("../version").versionLabel(context.extensionPath, context.extension.packageJSON.version);
    // Where chats are shown: the side panel (and its other columns: chats side by side), plus any chats opened beside
    // the code. Each pane shows one tab: { id, kind: "side" | "editor", webview, panel?, ready, queue, activeId,
    // single? (one chat, no tab bar), col?/main? (a column of the side panel), layout? (the side panel: its columns) }.
    this.panes = [];
    this.pane = null;            // the pane whose message is being handled right now
    this.focusPane = null;       // the pane you used last (keyboard shortcuts and commands act on it)
    this.chatFocused = false;    // the keyboard is in a chat page (Ctrl+L then hides the chat instead of adding code)
    this._activeId = null;       // the side panel's tab before the panel exists
    this.tabs = [];              // open tabs; see newTab() for the shape
    // Every chat from every workspace, in full (History). this.here: which workspace this window is.
    this.archive = new ChatArchive(scope.dir("chats", "data"));   // (a profile that shares: the main profile's; else its own)
    this.here = ChatView.workspaceInfo();
    // Models on your own computer (Ollama): the same address as Tab's local model.
    this.ollama = new Ollama(() => cfg().get("tabCompletion.ollamaUrl"));
    this.localReady = new Map();   // "ollama:<name>" -> the larger-context copy's name, once prepared
    this.pulls = new Map();        // model downloads in progress: name -> { percent, status }
    this.runtime = new Map();    // tabId -> { proc, turn, perms, procKey, agents }
    this.routingJobs = new Map(); // Cancellation is runtime state, never saved with the chat.
    // Side chat: a quick question about part of an answer, answered under it (side.js). Not part of the conversation.
    this.sideChats = new SideChats({
      makeAgent: (model, opts, local, handlers) => brain.makeAgent(model, opts, local, handlers),
      model: () => brain.fastestModel(undefined, ["codex"]),   // (Codex can run read-only commands, loads your MCP servers and searches the web: not answer-only)
      mode: (model) => brain.engineOf(model) === "agy" ? "plan" : "ask",   // (agy: its read-only mode; its default was never checked)
      emptyDir: () => privateTmp("side"), check: (model) => brain.usable(model), isClaude: (model) => brain.engineOf(model) === "claude",
      nameOf: (model) => brain.engineOf(model) === "claude" ? model[0].toUpperCase() + model.slice(1) : isLocal(model) ? localName(model) : model.replace(/^[a-z]+:/, "").replace(/^default$/, brain.providerOf(model).label),
      localOpts: (model) => isLocal(model) ? { tools: [], allowedTools: [], capabilities: [], store: brain.localStore(this.context) } : null,
      textOf: (segments) => ChatView.textOf(segments), cwd: () => this.root() || ws.workDir(),
      post: (msg) => this.post(msg), save: () => this.save(),
    });
    // A new chat's title: the first words at once, then a short summary from the quickest model (title.js).
    this.titler = new Titler({ ...this.sideChats.d });
    // Voice input (lib/voice): the page records; Whisper transcribes on this computer (downloaded the first time, after you
    // agree); Side chat's quick model tidies the text up. The result goes into the box, never sent by itself.
    this.voice = new Voice({ dir: path.join(context.globalStorageUri.fsPath, "voice"), post: (msg) => this.post(msg),
      cleanupDeps: this.sideChats.d, log });
    // Listen (lib/listen): an answer explained out loud, in a voice made on this computer (downloaded the first time, after
    // you agree); Side chat's quick model (or the chat's own model on this computer) writes the walkthrough. Its messages go
    // only to the pane that asked (a chat on screen twice would otherwise play twice).
    this.listen = new Listen({ dir: path.join(context.globalStorageUri.fsPath, "listen"), postTo: (pane, msg) => this.postTo(pane, msg),
      save: () => this.save(), pick: (tab) => pickModel(tab.model, { isLocal, fastest: (m, skip) => brain.fastestModel(m, skip) }),
      nameOf: this.sideChats.d.nameOf, scriptDeps: this.sideChats.d, log,
      // (the speed you last chose in the player is the default for every walkthrough)
      speed: () => context.globalState.get("kural.listen.speed", 1), setSpeed: (v) => context.globalState.update("kural.listen.speed", v) });
    // Enhance prompt: a model that looks through the project (read only) rewrites what you typed (lib/enhance). Not part of
    // the conversation either; the page puts the result in the box for you to check.
    this.enhancer = new Enhancer({
      makeAgent: (model, opts, local, handlers) => brain.makeAgent(model, opts, local, handlers),
      ready: (engine) => brain.providerOf(engine === "claude" ? "sonnet" : `${engine}:default`).ready(),
      models: (engine) => ((brain.cli && brain.cli[engine]) || {}).models || [],
      emptyDir: () => privateTmp("enhance"),
      server: (root, maxCalls) => ({ command: process.execPath, args: [path.join(__dirname, "..", "enhance", "repo-mcp.js")],
        env: { ELECTRON_RUN_AS_NODE: "1", KURAL_REPO_ROOT: root, KURAL_REPO_MAX_CALLS: String(maxCalls) } }),
      log,
    });
    this.enhancing = new Map();   // tabId -> the running Enhance (one per chat)
    this.changes = new ChangeTracker(scope.dir("checkpoints", "data"));
    this.attachments = new Attachments();   // files added to the message you're writing
    this.setupVersion = 0;                  // goes up when your Claude Code setup changes
    this.pluginVersion = {};                // codex / agy: goes up when the Plugins tab changes that AI's plugins
    this.lastEditor = vscode.window.activeTextEditor;
    this.lastSelection = null;   // for turning pasted code into a "main.py (L3-9)" reference
    this.files = null;
    // System notifications: an answer is done, or it needs you (lib/chat/notify.js).
    this.notifier = new Notifier({
      hasToast: async () => (await vscode.commands.getCommands(false)).includes("_kural.osToast"),
      toast: (o) => vscode.commands.executeCommand("_kural.osToast", o),
      clearToast: (id) => vscode.commands.executeCommand("_kural.osToastClear", { id }),
      run: (cmd, args, env) => new Promise((res) => require("child_process").execFile(cmd, args,
        { env: { ...process.env, ...env }, timeout: 15000, windowsHide: true, cwd: os.tmpdir() }, (err, _o, stderr) => { if (err) log(`notify: ${cmd} failed: ${err.message}${stderr ? ` (${String(stderr).trim().slice(0, 200)})` : ""}`); res(!err); })),
      inApp: async (title, body) => (await vscode.window.showInformationMessage(`${title}. ${body}`, "Show")) === "Show",
      // A card in another Kural window that's in front (lib/projects sets cardElsewhere): true = it was shown there.
      elsewhere: (o) => this.cardElsewhere ? this.cardElsewhere(o) : false,
      log, platform: process.platform,
    });
    // Set by lib/projects (the Projects bar): onChatsChanged() whenever what projectChats() reports may have changed;
    // cardElsewhere({ tabId, title, body }) → Promise<boolean>.
    this.onChatsChanged = null;
    this.cardElsewhere = null;
    this.load();
  }

  register() {
    const c = this.context;
    c.subscriptions.push(usageHub.onChange((provider) => {
      clearTimeout(this.usageTimer);
      this.usageTimer = setTimeout(() => this.usageChanged(provider), 0);
    }), { dispose: () => clearTimeout(this.usageTimer) });
    this.changes.register(c);
    registerTabEditor(c, this);   // a chat tab dragged into the editor area opens there (tab-editor.js)
    watchFontScale(c, (m) => this.post(m));
    watchSetup(c, () => ws.folders().map((f) => f.path), () => { if (fullSetup()) this.setupChanged("changed"); });
    // Idle chats' programs stop after a while (stopIdle), checked every minute.
    const sweep = setInterval(() => this.stopIdle(), 60 * 1000);
    c.subscriptions.push({ dispose: () => clearInterval(sweep) });
    let lastFocusReload = Date.now();
    c.subscriptions.push(vscode.window.onDidChangeWindowState((st) => {
      if (!st.focused || !fullSetup() || Date.now() - lastFocusReload < 60000) return;
      lastFocusReload = Date.now();
      this.setupChanged("may have changed while you were away");
    }));
    const refreshFiles = debounce(() => { this.files = null; if (this.panes.some((p) => p.ready)) this.sendFiles(); }, 1500);
    // You trusted this folder: Claude restarts with your full setup.
    c.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => this.setupChanged("trusted")));
    c.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("kural.chat.moods") || e.affectsConfiguration("kural.chat.hiddenMoods")) this.moodsChanged();
      if (e.affectsConfiguration("kural.chat.shortcuts")) this.post({ type: "shortcuts", shortcuts: userShortcuts() });
      if (e.affectsConfiguration("kural.usageSwitch")) this.usageChanged();
    }));
    const watcher = vscode.workspace.createFileSystemWatcher("**/*", false, true, false);
    watcher.onDidCreate(refreshFiles); watcher.onDidDelete(refreshFiles);
    c.subscriptions.push(
      watcher,
      vscode.window.registerWebviewViewProvider("kural.chat", this, { webviewOptions: { retainContextWhenHidden: true } }),
      // (A comment box's input isn't where Insert/Apply go: the file under it stays the last editor.)
      vscode.window.onDidChangeActiveTextEditor((ed) => { if (ed && !isCommentInput(ed)) this.lastEditor = ed; }),
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
      vscode.commands.registerCommand("kural.chat.toggle", () => this.toggle()),
      vscode.commands.registerCommand("kural.testNotification", () => this.testNotification()),
      // Kural Settings → Your own model → "Find & download models…": the chat's Models page (it was in the model menu).
      vscode.commands.registerCommand("kural.findModels", async () => {
        await this.reveal();
        const p = this.side();
        if (p) this.postTo(p, { type: "openLocal" }); else this.post({ type: "openLocal" });
      }),
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
      // (Ctrl+Alt+V: the mic of the chat you're in; the page starts or stops recording.)
      vscode.commands.registerCommand("kural.chat.voice", () => { const p = this.cur(); if (p) this.postTo(p, { type: "voiceToggle" }); }),
      vscode.commands.registerCommand("kural.chat.moveToPanel", (uri) => this.moveToPanel(uri)),
      vscode.commands.registerCommand("kural.reloadSetup", () => this.setupChanged("reload asked for")),
      // (Internal: lib/account.js, when you log out, log in again or switch an AI's account.)
      vscode.commands.registerCommand("kural.chat.accountChanged", (provider) => this.accountChanged(provider)),
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
      { dispose: () => { this.sideChats.stopAll(); if (this.debugServer) this.debugServer.stop(); this.voice.dispose(); this.listen.dispose(); for (const c of this.routingJobs.values()) c.abort(); for (const r of this.runtime.values()) { if (r.checkpointAbort) r.checkpointAbort.abort(); if (r.proc) r.proc.kill(); } } },
    );
  }

  // ---------- your last choices, for new tabs ----------
  lastChoices() {
    const last = this.context.globalState.get(LAST_KEY) || {};
    return {
      model: this.usableModel(validModel(last.model) ? last.model : (valid(MODELS, cfg().get("chat.model")) ? cfg().get("chat.model") : "sonnet")),
      autoRoute: !!last.autoRoute, routingProfile: profileOf(last.routingProfile || cfg().get("modelRouter.profile")),
      effort: valid(EFFORTS, last.effort) ? last.effort : (valid(EFFORTS, cfg().get("chat.intensity")) ? cfg().get("chat.intensity") : "medium"),
      mode: valid(MODES, last.mode) ? last.mode : settingMode(),
      split: !!last.split, workers: cleanWorkers(last.workers),
      mood: valid(allMoods(), last.mood) ? last.mood : firstMood(),
    };
  }

  // You added, changed or deleted one of your moods, or removed or restored a built-in one (Kural Settings → Moods): the
  // menus show the new list; a chat whose mood is gone gets the first mood left (Default, unless you removed it); an
  // idle chat with a changed mood gets its new instructions now (procKey).
  moodsChanged() {
    const ids = new Set(allMoods().map((m) => m.id));
    for (const t of this.tabs) if (!ids.has(t.mood)) t.mood = firstMood();
    this.post({ type: "moods", moods: allMoods() });
    this.postTabs(); this.save();
    for (const t of this.tabs) { const r = this.runtime.get(t.id); if (r && r.proc && t.status === "idle") this.warm(t); }
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
    const { team, roles, teamStyle, ...kept } = prev;   // (the old agent team's choices go)
    this.context.globalState.update(LAST_KEY, { ...kept, model: tab.model, effort: tab.effort, mode: tab.mode, split: !!tab.split, workers: tab.workers,
      autoRoute: !!tab.autoRoute, routingProfile: tab.routingProfile, mood: tab.mood });
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
    tab.split = !!tab.split; tab.workers = cleanWorkers(tab.workers);
    delete tab.team; delete tab.roles; delete tab.teamStyle; delete tab.noTeamOffer;   // (the old agent team, switched off since 1.1)
    if (tab.mood === "teacher") tab.mood = "learn";   // (the Teacher mood is now Learn)
    // (A mood of yours that you deleted: the first mood in the menu.)
    if (!valid(allMoods(), tab.mood)) tab.mood = /^custom-/.test(tab.mood || "") ? firstMood() : d.mood;
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
      model: d.model, effort: d.effort, mode: d.mode, split: d.split, workers: d.workers, mood: d.mood,
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
    // An editor or a column containing a single chat keeps its original conversation in place.
    if (pane && pane.col) { this.activate(tab.id, pane.main); this.postTo(pane.main, { type: "focus" }); }
    else if (pane && pane.single) { this.openSplit(tab.id); this.postTabs(); }
    else { this.activate(tab.id, pane); if (pane) this.postTo(pane, { type: "focus" }); }
    this.postHistory();
    this.save();
    return tab;
  }

  // ---------- panes ----------
  // The pane a command or reply is for: the one that sent the message being handled, else the one you used last.
  cur() { return this.pane || this.focusPane || this.side() || null; }
  side() { return this.panes.find((p) => p.kind === "side" && !p.col); }   // (the side panel itself: its first column)
  get activeId() { const p = this.cur(); return p ? p.activeId : this._activeId; }
  set activeId(v) { const p = this.cur(); if (p) p.activeId = v; else this._activeId = v; }
  shown(id) { return this.panes.some((p) => p.activeId === id); }   // is this tab on screen somewhere?
  // The whole chat again, in every pane that shows it (after its messages changed: a rollback, an edit).
  redraw(tab) { for (const p of this.panes) if (p.activeId === tab.id) this.postTo(p, { type: "full", tab: this.viewTab(tab) }); }

  activate(id, pane = this.cur()) {
    const tab = this.tab(id);
    if (!tab) return;
    // Open in its own editor already (dragged out), or in a column of the side panel: go there instead of showing it twice.
    const own = this.panes.find((p) => p.single && p.activeId === id && p !== pane);
    if (own && own.panel) { own.panel.reveal(); return; }
    if (own) { this.focusPane = own; this.postTo(own, { type: "focus" }); return; }
    if (pane) pane.activeId = id; else this._activeId = id;
    tab.unread = false; tab.unseen = false;
    this.clearNotice(id);   // (its notification, if any, is old news now)
    if (this.onChoice) try { this.onChoice(tab); } catch { /* (the status bar's own problem) */ }
    if (pane) this.postTo(pane, { type: "full", tab: this.viewTab(tab) });
    this.postTabs();
    if (tab.setup) this.post({ type: "setup", tabId: tab.id, setup: { ...tab.setup, jira: atlassianState(tab.setup) } });   // (a saved one may be older)
    this.post({ type: "slash", tabId: tab.id, slash: this.slashView(tab) });
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
    this.sideChats.stopAll(id);
    this.stopEnhance(id);
    this.voice.closed(id);
    this.listen.tabClosed(id);
    const r = this.runtime.get(id);
    if (r && r.checkpointAbort) r.checkpointAbort.abort();
    if (r && r.proc) { r.stale = true; r.proc.kill(); }
    this.endDevice(r);
    if (this.browserAi) this.browserAi.end(id);
    if (this.debugServer) this.debugServer.end(id);
    this.runtime.delete(id);
    this.slashes().delete(id);
    const i = this.tabs.indexOf(tab);
    this.tabs.splice(i, 1);
    if (keep && tab.messages.length) this.archive.save(tab, this.card(tab));
    if (!this.tabs.length) this.newTab(true);
    // Its own editor (dragged out) or column closes with it; every other pane that showed it moves to the tab before it.
    for (const p of this.panes.filter((q) => q.single && q.activeId === id)) { if (p.col) this.closeColumn(p); else { p.closing = true; p.panel.dispose(); } }
    const showing = this.panes.filter((p) => p.activeId === id && !p.single);
    for (const p of showing) {
      const prev = this.tabs[Math.max(0, Math.min(i - 1, this.tabs.length - 1))].id;
      // activate() won't move a pane to a chat that's open in a column or editor: it would stay on the closed one.
      if (this.panes.some((q) => q.single && q.activeId === prev && q !== p)) this.showOther(p, id); else this.activate(prev, p);
    }
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
    const blank = this.tabs.find((t) => !t.messages.length && t.status === "idle" && !this.panes.some((p) => p !== this.cur() && p.activeId === t.id));
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

  // The Projects bar moves a chat to another project (lib/projects): it leaves this window but stays in History, and that
  // project's window takes it in (adopt). Only a chat of this project with something in it that isn't working or waiting
  // for you. false: it can't go now.
  moveOut(id) {
    const tab = this.tab(id);
    if (!tab || tab.visiting || !tab.messages.length) return false;
    const state = (this.projectChats().find((c) => c.id === id) || {}).state;
    if (state === "run" || state === "ask") return false;
    this.closeTab(id, true);
    return true;
  }
  // A chat moved here from another project: like Continue here, a new conversation in this folder that's given the old
  // one (Claude keeps conversations per folder), but with the same id, so History, its lesson and handoff notes follow it.
  adopt(id, from) {
    if (this.tab(id)) { this.activate(id); return true; }
    const old = this.archive.read(id);
    if (!old) return false;
    this.clean(old);
    const tab = { ...old, sessionId: newSessionId(), started: false, visiting: false, workspace: this.here, updatedAt: Date.now(),
      carryOver: old.carryOver && old.carryOver.fork ? old.carryOver   // (a fork not sent yet keeps its own: "branches from that conversation")
        : { from: from || (old.workspace && old.workspace.name) || "another project", text: ChatView.transcript(old) } };
    const blank = this.tabs.find((t) => !t.messages.length && t.status === "idle" && !this.panes.some((p) => p !== this.cur() && p.activeId === t.id));
    if (blank) this.tabs.splice(this.tabs.indexOf(blank), 1, tab); else this.tabs.push(tab);
    this.archive.save(tab, this.card(tab));
    this.activate(tab.id);
    this.postHistory();
    this.save();
    return true;
  }

  // ---------- the Projects bar's History, moves to a project that isn't open, and forks (lib/projects) ----------
  // The saved chats' cards (all projects); fromDisk: other windows may have saved some since.
  historyCards(fromDisk = false) { return fromDisk ? this.archive.refresh() : this.archive.list(); }
  // A saved chat, not open here, moved to another project's History without that project's window (adopt does it for a
  // window that takes it in): same id, `home` ({key, name, open}) as its workspace, a fresh conversation given the old one.
  rehome(id, home, from) {
    if (this.tab(id) || !home) return false;
    this.archive.refresh();
    const old = this.archive.read(id);
    if (!old) return false;
    this.clean(old);
    const tab = { ...old, sessionId: newSessionId(), started: false, visiting: false, workspace: home, updatedAt: Date.now(),
      carryOver: old.carryOver && old.carryOver.fork ? old.carryOver
        : { from: from || (old.workspace && old.workspace.name) || "another project", text: ChatView.transcript(old) } };
    return this.archive.save(tab, this.card(tab));
  }
  // Fork: a copy of the whole recorded conversation (an open chat as it is now, else the saved one) as a NEW chat, saved in
  // History under `home`; the original stays. The window of the project that gets it then adopts it. The new id, or null.
  forkCopy(id, home) {
    let src = this.tab(id);
    if (!src) {
      src = this.archive.read(id);
      if (!src) return null;
      this.clean(src); src.visiting = false;
    }
    const tab = forkConversation(src, src.messages.length - 1, { id: shortId(), sessionId: newSessionId() });
    if (!tab) return null;
    if (home) tab.workspace = home;
    return this.archive.save(tab, this.card(tab)) ? tab.id : null;
  }

  // Open the folder a visiting chat came from, in a new window.
  openWorkspaceOf(id) {
    const t = this.tab(id);
    const where = t && t.workspace && t.workspace.open;
    if (!where || !fs.existsSync(where)) { vscode.window.showWarningMessage(`Kural: the folder of "${t ? t.workspace.name : "this chat"}" isn't on this computer anymore.`); return; }
    vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(where), { forceNewWindow: true });
  }

  // The running model's way to the linked device ends (its token stops working in the bridge). With the program itself
  // (all), also its way to Kural's browser, and Kural lets go of the tabs it used.
  endDevice(r, all = true) {
    if (r && r.deviceToken && this.devices) this.devices.endSession(r.deviceToken);
    if (r) r.deviceToken = null;
    if (all && r && r.browserToken && this.browserAi) { this.browserAi.endSession(r.browserToken, r.browserChat); r.browserToken = null; }
  }

  // Delete a chat for good: from this window, History, and every workspace.
  deleteChat(id) {
    if (this.tab(id)) this.closeTab(id, false);
    this.archive.remove(id);
    try { fs.rmSync(this.handoffDir({ id }), { recursive: true, force: true }); } catch { /* best effort, like History */ }
    if (this.lessons) this.lessons.forget(id);
    if (this.debugServer) this.debugServer.end(id);
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

  summary(t) { return { id: t.id, title: t.title, status: t.status, unread: t.unread, model: t.model, effort: t.effort, mode: t.mode,
    split: !!t.split, workers: this.workersFor(t), splitOn: this.splitOn(t),
    autoRoute: !!t.autoRoute, routingProfile: t.routingProfile, routingState: t.routingState || null, modelName: t.modelName || null,
    tokens: t.tokens || null, context: t.context || null, queued: this.queuedOf(this.runtime.get(t.id)),
    mood: t.mood, ticket: t.ticket || null,
    device: t.device && this.devices && this.devices.get(t.device) ? (({ id, name, host, user }) => ({ id, name, host, user }))(this.devices.get(t.device)) : null,
    visiting: t.visiting ? { name: t.workspace.name, canOpen: !!t.workspace.open } : null }; }
  viewTab(t) { return { ...this.summary(t), messages: t.messages, modelName: t.modelName, allowAll: t.allowAll, listenWhy: this.listen.why(t) }; }
  postTabs() {
    this.post({ type: "tabs", tabs: this.tabs.map((t) => this.summary(t)) });   // each pane gets its own activeId (post)
    for (const p of this.panes) if (p.panel) { const t = this.tab(p.activeId); p.panel.title = t ? t.title : "Kural chat"; }
    if (this.onTabs) try { this.onTabs(); } catch { /* (the caller's own problem) */ }
    this.chatsChanged();
  }

  // ---------- the Projects bar (lib/projects) ----------
  // Every change of a tab's state goes through postTabs (status, a card waiting or answered, a tab added, closed or renamed),
  // so that tells the bar; unseen and the shown tab call it themselves.
  chatsChanged() {
    if (this.onChatsChanged) try { this.onChatsChanged(); } catch { /* (the bar's own problem) */ }
  }
  // The card a tab is waiting on, in a few words (notify.js says it the same way), or null.
  askOf(tab) {
    const last = tab.messages[tab.messages.length - 1];
    const b = last && last.role === "assistant" ? (last.blocks || []).slice().reverse().find((x) => (x.k === "perm" || x.k === "question" || x.k === "split") && x.state === "pending") : null;
    if (!b) return tab.status === "waiting" ? "Waiting for you" : null;
    const text = b.k === "perm" ? notifyText("permission", { tool: b.tool, detail: b.detail, where: b.where, site: b.site, label: b.label }).body
      : b.k === "question" ? notifyText("question", { question: ((b.questions || [])[0] || {}).question }).body
      : `Split the work between ${(b.tasks || []).length} agents?`;
    return text.length > 80 ? `${text.slice(0, 79).trimEnd()}…` : text;
  }
  // This window's open chats in tab order, for the Projects bar: state run (answering), ask (a card waits for you), done
  // (finished while you weren't looking: tab.unseen), idle. Chats from other workspaces (visiting) aren't this project's.
  projectChats() {
    return this.tabs.filter((t) => !t.visiting).map((t) => {
      const ask = this.askOf(t);
      const last = t.messages[t.messages.length - 1];
      const state = ask ? "ask" : t.status !== "idle" || (last && last.role === "assistant" && last.running) ? "run" : t.unseen ? "done" : "idle";
      return { id: t.id, title: t.title, state, ask: state === "ask" ? ask : null, doneAt: t.unseen ? t.doneAt || null : null, onScreen: this.onScreen(t.id),
        empty: !t.messages.length };   // nothing sent yet: the Projects bar leaves it out
    });
  }
  // The tab is in front of you (activated, its pane became visible, a click on its notification): nothing unseen about it.
  markSeen(id) {
    const t = this.tab(id);
    if (!t || !t.unseen) return;
    t.unseen = false;
    this.postTabs(); this.save();
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
    // Claude Code and Codex keep a conversation in their account's own folder. One begun under another profile (the chat
    // is shared between profiles) can't be resumed with this profile's account: its next message starts a new
    // conversation that is handed the old one, the same as after a switch of account (tab.profile, freshSession).
    if (t.started && !t.freshSession && ["claude", "codex"].includes(t.engine || engineOf(t.model)) && (t.profile || "default") !== scope.profileId()) { t.freshSession = "account"; t.profileFresh = true; }
    // Back in the profile that holds the conversation: it can be resumed after all (the marker is ours, not an account change's).
    else if (t.profileFresh && (t.profile || "default") === scope.profileId()) { if (t.freshSession === "account") delete t.freshSession; delete t.profileFresh; }
    const roots = this.projectRoots(t);
    SideChats.clean(t.messages);
    Listen.clean(t.messages);
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
    const saved = this.context.workspaceState.get(storeKey()) || (scope.isMain() ? this.context.workspaceState.get("kural.chat.v3") : undefined);
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
      this.savedCols = Array.isArray(saved.cols) ? saved.cols : [];          // the side panel's columns (restoreCols)
    } else {
      this.tabs = [];
      const t = this.newTab(false);
      this._activeId = t.id;
    }
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 800);
  }

  // Save now (before the window reloads for another profile: the open tabs go to this profile's key). Resolves when saved.
  saveNow() {
    clearTimeout(this.saveTimer);
    // Keep the last ~150 KB of each conversation (60 KB for closed ones) so this stays quick.
    const trim = (t, max) => ({ ...t, messages: trimMessages(t.messages, max), status: "idle" });   // (chat/trim.js: sizes added up once)
    for (const t of this.tabs) if (t.messages.length) this.archive.save(t, this.card(t));   // History: in full
    const side = this.side();
    return this.context.workspaceState.update(storeKey(), {
      tabs: this.tabs.map((t) => trim(t, 150000)),
      activeId: side ? side.activeId : this._activeId, splitIds: this.panes.filter((p) => p.kind === "editor").map((p) => p.activeId),
      cols: side && side.layout ? this.layoutOf(side) : this.savedCols || [],
    });
  }

  // ---------- the panel ----------
  resolveWebviewView(view) {
    const old = this.side();
    // (The old page's columns go with it, and come back in the new one.)
    const cols = old && old.layout ? this.layoutOf(old) : this.savedCols;
    if (old) for (const p of old.layout || [old]) if (this.panes.includes(p)) { this.listen.paneGone(p); this.panes.splice(this.panes.indexOf(p), 1); }
    const pane = this.attach(view.webview, "side", null, old ? old.activeId : this._activeId);
    pane.view = view;   // (is the side panel on screen: notifications, stopIdle)
    pane.layout = [pane];
    this.restoreCols(pane, cols);
    view.onDidDispose(() => {
      this._activeId = pane.activeId;
      this.savedCols = this.layoutOf(pane);
      for (const p of pane.layout) if (this.panes.includes(p)) { this.listen.paneGone(p); this.panes.splice(this.panes.indexOf(p), 1); }
      if (pane.layout.includes(this.focusPane)) this.focusPane = null;
    });
    // The panel shown again: its chat's program back, ready for your next message (it may have stopped while idle).
    if (view.onDidChangeVisibility) view.onDidChangeVisibility(() => {
      const t = view.visible && this.tab(pane.activeId); if (t && t.status === "idle") this.warm(t);
      if (view.visible) for (const p of pane.layout || [pane]) this.markSeen(p.activeId);
      this.chatsChanged();   // (the Projects bar shows whether the chat is on screen)
    });
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
    const dir = scope.dir("images", "data");
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
    const nonce = require("crypto").randomBytes(16).toString("base64");
    const uri = (f) => webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    // (data-mermaid: loaded by media/mermaid-view.js only when an answer has a diagram.)
    webview.html = `<!doctype html><html data-fs="${fontScale()}" data-mermaid="${uri("mermaid/mermaid.min.js")}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: https:;">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${uri("codicons/codicon.css")}"><link rel="stylesheet" href="${uri("chat.css")}"></head>
<body><div id="app"><div class="booting">Starting Kural chat…</div></div><script nonce="${nonce}" src="${uri("side.js")}"></script><script nonce="${nonce}" src="${uri("voice.js")}"></script><script nonce="${nonce}" src="${uri("markdown.js")}"></script><script nonce="${nonce}" src="${uri("mermaid-view.js")}"></script><script nonce="${nonce}" src="${uri("timeline.js")}"></script><script nonce="${nonce}" src="${uri("choices.js")}"></script><script nonce="${nonce}" src="${uri("split.js")}"></script><script nonce="${nonce}" src="${uri("listen.js")}"></script><script nonce="${nonce}" src="${uri("chat.js")}"></script><script nonce="${nonce}" src="${uri("chat-columns.js")}"></script></body></html>`;
    // (A message from a column of the side panel (split) says which: that column is a pane of its own.)
    webview.onDidReceiveMessage((m) => {
      const p = m && m.col ? (pane.layout || []).find((q) => q.col === m.col) : pane;
      if (p) this.onMessage(m, p).catch((e) => log(`chat: ${e.stack}`));
    });
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
    for (const p of [...this.panes]) {
      if (p.kind === "editor" || p.activeId !== id) continue;
      if (p.col) this.closeColumn(p); else this.showOther(p, id);   // (a column of the side panel goes with it)
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
    panel.onDidChangeViewState((e) => { if (e.webviewPanel.active) this.focusPane = pane; if (e.webviewPanel.visible) this.markSeen(pane.activeId); this.chatsChanged(); });
    panel.onDidDispose(() => {
      this.listen.paneGone(pane);
      this.panes.splice(this.panes.indexOf(pane), 1);
      if (this.focusPane === pane) this.focusPane = null;
      this.postTabs();   // (a dragged-out chat goes back into the side panel's tabs)
      this.save();
    });
    this.postTabs();
    return pane;
  }

  // ---------- columns: chats side by side in the side panel ----------
  // The side panel's page can show several chats next to each other (when it's wide: maximized, say). The panel's own
  // pane is the first column, with the tab bar; every other column is a "single" pane (one chat, its title above it,
  // like a chat in the editor area) on the same page, whose messages carry `col` (media/chat-columns.js). The panel's
  // pane keeps them all in `layout`, in order (itself included); Kural saves that with the open tabs.
  addColumn(main, tabId, at = main.layout.length) {
    const real = main.webview, col = main.colSeq = (main.colSeq || 0) + 1;
    const webview = {   // (the same page: each message says which column it's for)
      postMessage: (m) => real.postMessage({ ...m, col }),
      asWebviewUri: (u) => real.asWebviewUri(u),
      get cspSource() { return real.cspSource; },
      get options() { return real.options; }, set options(_) { /* (the page's own: main.webview) */ },
    };
    const pane = { id: shortId(), kind: "side", col, main, view: main.view, webview, panel: null, ready: false, queue: [], activeId: tabId, single: true, size: 1 };
    this.panes.push(pane);
    main.layout.splice(Math.max(0, Math.min(at, main.layout.length)), 0, pane);
    for (const p of main.layout) p.size = 1;   // (a column more or less: equal widths again, like VS Code's editor groups)
    this.postCols(main);
    return pane;
  }
  closeColumn(pane) {
    const main = pane.main;
    if (this.panes.includes(pane)) { this.listen.paneGone(pane); this.panes.splice(this.panes.indexOf(pane), 1); }
    if (main && main.layout.includes(pane)) { main.layout.splice(main.layout.indexOf(pane), 1); for (const p of main.layout) p.size = 1; }
    if (this.focusPane === pane) this.focusPane = main || null;
    if (main) this.postCols(main);
    this.postTabs();   // (its chat is back among the tabs)
    this.save();
  }
  postCols(main) { this.postTo(main, { type: "cols", cols: main.layout.map((p) => ({ col: p.col || 0, size: p.size || 1 })) }); }
  layoutOf(main) { return main.layout.map((p) => p.col ? { id: p.activeId, size: p.size || 1 } : { main: true, size: p.size || 1 }); }
  // The columns from last time (or from the page before): each chat that's still open and not in the editor area.
  restoreCols(main, saved) {
    let at = 0;
    const sizes = new Map();
    for (const c of Array.isArray(saved) ? saved : []) {
      if (c && c.main) { sizes.set(main, c.size); at = main.layout.indexOf(main) + 1; continue; }
      if (!c || !this.tab(c.id) || this.panes.some((p) => p.single && p.activeId === c.id) || main.layout.length >= MAX_COLUMNS) continue;
      sizes.set(this.addColumn(main, c.id, at++), c.size);
    }
    for (const [p, size] of sizes) p.size = size > 0 ? size : 1;   // (after them all: adding one evens them out)
    if (main.layout.some((p) => p.col && p.activeId === main.activeId)) this.showOther(main, main.activeId);
  }
  // This pane shows another chat than `id`: one that's not on screen anywhere, or a new one.
  showOther(pane, id) {
    const other = this.tabs.find((t) => t.id !== id && !this.panes.some((q) => q.activeId === t.id)) || this.newTab(false);
    this.activate(other.id, pane);
  }

  // The Split button: a new chat in a column of its own when the side panel is wide enough (the page knows), else
  // beside the code.
  splitChat(pane, inPanel) {
    const main = pane && (pane.main || (pane.layout ? pane : null));
    if (!inPanel || !main || main.layout.length >= MAX_COLUMNS) { this.openSplit(); return; }
    const col = this.addColumn(main, this.newTab(false).id);
    this.focusPane = col;
    this.postTo(col, { type: "focus" });
    this.postTabs();
    this.save();
  }

  // A chat tab, or a column's title, dropped (media/chat-columns.js). Outside the panel: beside the code. On a side of a
  // column ("before"/"after"): a new column there, or that column moves there. On a column ("center"): it shows that
  // chat (its own goes back among the tabs). On the first column: back among the tabs.
  dropTab(pane, m) {
    const main = pane && (pane.main || pane), tab = this.tab(m.id);
    if (!tab || !main || !main.layout) return;
    const at = (col) => main.layout.find((p) => (p.col || 0) === (col || 0));
    const from = m.from ? at(m.from) : null;   // (a column; none: a tab of the first column)
    if (m.from && (!from || from.activeId !== tab.id)) return;   // (that column changed meanwhile)
    if (m.side === "outside") { this.openSplit(tab.id); return; }   // (adoptDragged takes it out of the panel)
    const to = at(m.to);
    if (!to || to === from) return;
    if (m.side === "before" || m.side === "after") {
      const index = () => main.layout.indexOf(to) + (m.side === "after" ? 1 : 0);
      if (from) { main.layout.splice(main.layout.indexOf(from), 1); main.layout.splice(index(), 0, from); this.postCols(main); }
      else if (main.layout.length < MAX_COLUMNS) { this.addColumn(main, tab.id, index()); if (main.activeId === tab.id) this.showOther(main, tab.id); }
    } else if (to.col) {
      if (from) this.closeColumn(from);
      this.activate(tab.id, to);
      if (main.activeId === tab.id) this.showOther(main, tab.id);
    } else {
      if (from) this.closeColumn(from);
      this.activate(tab.id, main);
    }
    this.postTabs();
    this.save();
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
    if (msg.type === "tabs") { for (const p of this.panes) this.postTo(p, this.tabsFor(p, msg.tabs)); return; }
    if (ONE_PANE.has(msg.type)) { const p = this.cur(); if (p) this.postTo(p, msg); return; }
    for (const p of this.panes) this.postTo(p, msg);
  }
  postTo(pane, msg) { if (pane.ready) pane.webview.postMessage(msg); else pane.queue.push(msg); }
  // The tab bar a pane shows. A chat dragged out of the tabs (into the editor area, or a column of the side panel: a
  // "single" pane) shows only itself, and leaves the other panes' tab bars until it goes back (like moving a tab in VS Code).
  tabsFor(p, tabs = this.tabs.map((t) => this.summary(t))) {
    const out = new Set(this.panes.filter((q) => q.single).map((q) => q.activeId));
    return { type: "tabs", tabs: p.single ? tabs.filter((t) => t.id === p.activeId) : tabs.filter((t) => !out.has(t.id) || t.id === p.activeId),
      activeId: p.activeId, single: !!p.single, column: !!p.col };
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

  // Ctrl+K's "Send to Chat": the selected code (nothing selected: the file) and what you typed in the box go into your
  // message, like Ctrl+L. Never sent by itself.
  async addFromEditor(doc, range, text = "") {
    await this.reveal();
    const pane = this.cur();
    if (!pane || doc.isClosed) return;
    const ctx = range && !range.isEmpty ? this.selectionCtx(doc, range) : { kind: "file", path: vscode.workspace.asRelativePath(doc.uri) };
    this.postTo(pane, { type: "insertPill", ctx, text: text ? ` ${text}` : "" });
  }

  // Ctrl+L as a switch: the side panel's chat on screen → hide it; otherwise open it. Code selected in the editor you're
  // typing in still goes into your message (open()), even while the chat is on screen.
  toggle() {
    const side = this.side(), ed = vscode.window.activeTextEditor;
    const adding = !this.chatFocused && ed && !ed.selection.isEmpty;
    if (side && side.view && side.view.visible && !adding) return vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    return this.open();
  }

  // ---------- parallel agents (lib/split) ----------
  // Does this chat's next answer split the work? Switched on in the model menu, in a mode that edits, with a cloud AI (a
  // model on this computer would run every agent on the one GPU: slower, not faster).
  splitOn(tab) { return !!tab.split && (agentLike(tab.mode) || tab.mode === "auto") && !isLocal(tab.model); }
  // The models the agents can use: the chat's AI's (the plan card and the model menu offer these).
  workerModels(tab) {
    const engine = engineOf(tab.model);
    if (engine === "claude") return MODELS.map((m) => ({ id: m.id, label: m.label }));
    const c = brain.cli[engine];
    return c ? (c.models || []).map((m) => ({ id: `${engine}:${m.id}`, label: m.label || m.id })) : [];
  }
  // The agents' model unless you pick another on the plan card: yours from the model menu for this AI, else its lightest.
  workersFor(tab) {
    const engine = engineOf(tab.model), mine = (tab.workers || {})[engine], models = this.workerModels(tab);
    if (mine && models.some((m) => m.id === mine)) return mine;
    const light = brain.fastestModel(tab.model);
    return light && engineOf(light) === engine ? light : tab.model;
  }
  // The chat's own record of the conversation before the newest message: each answer's lead starts afresh, with it.
  splitHistory(tab) {
    const upto = tab.messages.map((m) => m.role).lastIndexOf("user");
    const earlier = tab.messages.slice(0, Math.max(0, upto));
    return earlier.length ? `<earlier_conversation>\n${this.conversationRecord(tab, earlier)}\n</earlier_conversation>` : "";
  }

  // ---------- Claude process per tab ----------
  // When this changes, the tab's Claude restarts (same conversation) before your next message.
  // (Claude Code's setup and its reloads only matter to Claude: other programs don't restart for them.)
  procKey(tab) {
    const claude = isClaude(tab.model);
    // (The mood's text too: editing one of your moods restarts its chats with the new instructions.)
    const mood = `${tab.mood}:${require("crypto").createHash("sha1").update(moodPrompt(tab.mood, customMoods(userMoods()))).digest("hex").slice(0, 8)}`;
    return `${claude ? "claude" : tab.model}|${tab.mode}|${tab.effort}|${this.splitOn(tab) ? `split:${this.workersFor(tab)}` : ""}|${mood}|${ws.key()}|${tab.device || ""}` +
      `|${this.browserOn(tab) ? "browser" : ""}` + (claude ? `|${fullSetup()}|${this.setupVersion}` : `|${(this.pluginVersion || {})[engineOf(tab.model)] || 0}`);
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
      ready: isSetUp(), local: false, split: true, device: true, images: true, pdf: true, commands: true, connectors: true }));
    const clis = this.cliInfo().flatMap((c) => (c.models.length ? c.models : [{ id: "default", label: `${c.short} default` }]).map((m) => ({
      id: `${c.id}:${m.id}`, label: m.label || m.id, description: m.description || "", provider: c.label, providerId: c.id,
      ready: c.ready, local: false, split: true, device: c.id === "codex", images: true, pdf: false,
      commands: c.id === "codex", connectors: false,
    })));
    const installed = new Map((this.routerLocalList || []).filter((m) => m.chat && !(m.capabilities || []).includes("cloud") && !/cloud/i.test(m.name)).map((m) => [m.name,m]));
    const fallback = this.localDefault && this.localDefault();
    if (fallback && !/cloud/i.test(fallback) && !(this.localReady.get(fallback) || []).includes("cloud") && !installed.has(localName(fallback))) installed.set(localName(fallback), { name: localName(fallback), capabilities: this.localReady.get(fallback) || [] });
    const local = [...installed.values()].map((m) => ({ id: `ollama:${m.name}`, label: m.name, description: `${m.params || ""} on this computer`,
      provider: "Ollama", providerId: "ollama", ready: true, local: true, split: false, device: false,
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
    this.sideChats.stopAll(tab.id);
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
    this.sideChats.stopAll(tab.id);
    const old = this.runtime.get(tab.id);
    if (old && old.proc) { old.stale = true; old.proc.kill(); old.proc = null; }
    this.endDevice(old);
    tab.messages = tab.messages.slice(0, index);
    this.listen.cut(tab);
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
      profile: tab.routingProfile, mode: tab.mode, editing: agentLike(tab.mode) || tab.mode === "auto", wellDefined: text === BUILD_TEXT,
      split: !!tab.split, device: !!tab.device, connectors: !!tab.ticket,
      images: attachments.some((a) => a.kind === "image"), pdf: attachments.some((a) => a.kind === "pdf") };
  }

  // How long the conversation is (characters): switching models costs more the longer it is (lib/router/policy.js).
  static conversationSize(tab) {
    return (tab.messages || []).reduce((n, m) => n + String(m.sentText || ChatView.textOf(m.segments || [])).length +
      (m.blocks || []).reduce((k, b) => k + String(b.text || "").length, 0), 0);
  }

  // What came with the message, for Auto: explicitly attached files and selections, their size (stat only),
  // browser elements and attached text files.
  static routingContext(contexts = [], attachments = []) {
    let files = 0, chars = 0, elements = 0;
    const size = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
    for (const c of contexts || []) {
      if (c.kind === "selection") { files++; chars += String(c.code || "").length; }
      else if (c.kind === "file") { files++; chars += size(c.path); }
      else if (c.kind === "element") elements++;
      else if (c.kind === "quote") chars += String(c.text || "").length;
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

  // The Plugins tab added, removed or turned one of an AI's plugins on or off (lib/plugins). Claude's chats reload by
  // themselves (watchSetup sees Claude Code's plugin files change); Codex and Gemini read their plugins when they
  // start, so their chats start again in the same conversation: the open one now if it's idle, the others when used.
  pluginsChanged(ai) {
    if (ai !== "codex" && ai !== "agy") return;
    this.pluginVersion = this.pluginVersion || {};
    this.pluginVersion[ai] = (this.pluginVersion[ai] || 0) + 1;
    log(`chat: ${ai}'s plugins changed; its chats start again in the same conversation when they're not busy`);
    const t = this.active();
    const r = t && this.runtime.get(t.id);
    if (t && r && r.proc && t.status === "idle" && engineOf(t.model) === ai) this.warm(t);
  }

  root() { return ws.root(); }

  // Start the tab's Claude process ahead of time, so your first message is answered quickly.
  warm(tab) {
    if (tab.started && (tab.freshSession || tab.engine && tab.engine !== engineOf(tab.model))) return;
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
    if (vscode.workspace.isTrusted === false) return null;
    const old = this.runtime.get(tab.id);
    if (old && old.proc) { old.stale = true; old.proc.kill(); }
    this.endDevice(old);
    const full = fullSetup();
    const instr = full ? { text: "", files: [] } : projectInstructions(this.root(), vscode.workspace.isTrusted !== false);
    const editing = agentLike(tab.mode) || tab.mode === "auto";
    // steers: messages you sent while it answered, given to the program but not taken in yet (see queueSend);
    // expect: every message given to the program, in order, until its echo says it was taken in (onEcho).
    const r = { proc: null, turn: null, perms: new Map(), procKey: this.procKey(tab), gotOutput: false, started: Date.now(), agents: new Map(), tasks: new Map(),
      steers: [], expect: [], engine: engineOf(tab.model) };
    if (fresh) { tab.sessionId = newSessionId(); tab.started = false; }
    // Every mode can ask you a multiple-choice question (AskUserQuestion), shown as a card.
    // With your full setup, Claude can also use your skills, and ToolSearch: without it in --tools, Claude Code sends every
    // connector's whole tool list (Figma, Atlassian…) with every request instead of loading a tool when it needs one.
    // Measured 21 Oct 2026 (Claude Code 2.1.289, three claude.ai connectors): first request 67,800 → 34,400 tokens, the
    // model starting 4-6.7 s → 1.5-2.1 s; connector tools still work (one ToolSearch step first). It only loads tool
    // descriptions, so it's pre-allowed; the connector's own tools still ask (onPermission). An older Claude Code without
    // it ignores the name.
    const fullTools = full ? ["Skill", "ToolSearch"] : [];
    const tools = [...(editing ? AGENT_TOOLS : [...READ_TOOLS, ...WEB_TOOLS]), "AskUserQuestion", ...fullTools];
    // A Claude model: Claude Code. A model on this computer: Kural's own engine, with the same tools and events.
    // A linked device (SSH): its tools for the AI, through Kural (lib/devices). Kural asks you before each command per your
    // mode (approveDevice), so the AI's own program doesn't ask again (the tools are pre-allowed). Not for a model on
    // this computer: Kural's own engine has no MCP.
    const dev = tab.device && this.devices && deviceOk(tab.model) ? this.devices.session(tab.device, (tool, args) => this.approveDevice(tab, r, tool, args)) : null;
    if (dev) { r.deviceToken = dev.token; r.deviceDevice = tab.device; }
    const deviceTools = dev ? DEVICE_TOOLS.map((t) => `mcp__device__${t}`) : [];
    // Kural's browser (lib/browser): the AI opens, reads and uses pages there, never publishing. Kural asks you per your mode
    // (approveBrowser), so the tools are pre-allowed like the device's. Claude and Codex (an MCP server, like the device's).
    const brw = this.browserOn(tab) ? this.browserAi.session(tab.id, (req) => this.approveBrowser(tab, r, req), this.root() || ws.workDir()) : null;
    if (brw) { r.browserToken = brw.token; r.browserChat = tab.id; }
    const browserTools = brw ? BROWSER_TOOLS.map((t) => `mcp__${BROWSER_SERVER}__${t}`) : [];
    // Learn mood: the chat's lesson folder (lib/learn), watched from now on; the AI writes lesson pages there.
    const lessonDir = this.lessonDir(tab, true);
    const local = isLocal(tab.model);
    const localTools = [...(editing ? ["Read", "Write", "Edit", "Glob", "Grep", "Bash"] : ["Read", "Glob", "Grep"]), "AskUserQuestion"];
    const proc = brain.makeAgent(tab.model, {
      name: `chat ${tab.id}`, effort: tab.effort, partial: true, showThinking: true, replay: true, mode: tab.mode, commands: full,
      // (A model on this computer gets the short guide: each word of the instructions costs it time before it answers.)
      safeMode: !full, appendSystemPrompt: PROMPTS[tab.mode] + (isLocal(tab.model) ? GUIDE_LOCAL : GUIDE) + this.moodText(tab) + ws.promptNote() + instr.text + this.rulesText(tab),
      // Parallel agents (lib/split): the lead plans, the agents work at once in git worktrees, Kural merges.
      split: this.splitOn(tab) ? { workers: this.workersFor(tab), models: this.workerModels(tab), history: () => this.splitHistory(tab),
        instructions: PROMPTS[tab.mode] + ws.promptNote() + instr.text + this.rulesText(tab), dir: privateTmp("split") } : null,
      addDirs: [...ws.extraDirs(), ...(fs.existsSync(this.handoffDir(tab)) ? [this.handoffDir(tab)] : []), ...(lessonDir ? [lessonDir] : [])],
      // (Read, Grep, Glob aren't pre-allowed: Claude Code reads inside the project by itself and asks Kural for anywhere
      // else, onPermission.)
      tools, allowedTools: [...fullTools, ...deviceTools, ...browserTools],
      mcpServers: dev || brw ? { ...(dev ? { device: dev.server } : {}), ...(brw ? { [BROWSER_SERVER]: brw.server } : {}) } : null,
      strictMcp: !full,     // full setup: your MCP servers and claude.ai connectors too
      hostPermissions: true, cwd: this.root() || ws.workDir(), persist: true, handoffChars: this.handoffBudget(tab.model),
      resume: tab.started ? tab.sessionId : null, sessionId: tab.started ? null : tab.sessionId,
    }, local ? { tools: localTools, allowedTools: ["Read", "Grep", "Glob"], readRoots: ws.aiRoots(), capabilities: this.localReady.get(tab.model) || [],
      store: brain.localStore(this.context) } : null, {
      onMessage: (m) => { if (r.stale) return; r.gotOutput = true; this.onClaude(tab, r, m); },
      onCommands: (list) => { if (!r.stale) this.setSlash(tab, slashList.clean(list)); },
      onPermission: (req) => r.stale ? { allow: false, message: "Stopped." } : this.onPermission(tab, r, req),
      onExit: (info) => this.onExit(tab, r, info),
      onCheckpoint: () => this.routingCheckpoint(tab,r),
      onPlan: (plan) => this.askPlan(tab, r, plan),
    });
    r.proc = proc;
    this.runtime.set(tab.id, r);
    // (Skills and commands come only from Claude with your full setup: elsewhere the "/" list says so.)
    if (!full || !isClaude(tab.model)) this.setSlash(tab, null);
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
    // (Its first message is the one that was waiting, now starting with the conversation so far: nothing is lost.)
    if (tab.started && !r.gotOutput && Date.now() - r.started < 15000 && /no conversation|not found|session/i.test(info.stderr)) {
      log(`chat ${tab.id}: couldn't reopen the saved conversation; starting a fresh one with the conversation handed over`);
      tab.started = false;
      const pending = r.pendingSend;
      const reply = r.turn && r.turn.reply, upto = reply && tab.messages.indexOf(reply) > 0 ? tab.messages.indexOf(reply) - 1 : tab.messages.length;
      let carry = "";
      try { if (upto > 0) carry = this.carryText({ model: true }, this.handoffRecord(tab, tab.messages.slice(0, upto))); }
      catch (e) {
        if (reply && reply.running) this.finishReply(tab, r, { type: "result", is_error: true, result: `Kural couldn't preserve the complete conversation: ${e.message}` });
        return;
      }
      this.giveBack(tab, r);
      const nr = this.startProc(tab, true);
      if (nr && pending) {
        const content = !carry ? pending : typeof pending === "string" ? carry + pending
          : pending.map((b, k) => k === 0 && b.type === "text" ? { ...b, text: carry + b.text } : b);
        nr.pendingSend = content; nr.turn = r.turn; this.sendTo(nr, content, "turn");
      }
      return;
    }
    r.proc = null;
    // Messages you queued that it never took in: back into the box, not lost.
    this.giveBack(tab, r);
    if (last && last.role === "assistant" && last.running) {
      last.running = false;
      last.error = info.login ? "login" : "The model stopped unexpectedly. See Kural's log (Kural: Show Log).";
      if (info.login) last.errorWho = whoOf(tab.model);
      if (!last.notified) { last.notified = true; this.notify(tab, info.login ? "login" : "error", { who: last.errorWho, error: last.error }); }
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
    if (vscode.workspace.isTrusted === false) {
      vscode.window.showWarningMessage("Trust this workspace before using Kural AI. Repository files and provider setup may execute code.");
      return;
    }
    let text = ChatView.textOf(segments).trim();
    if (!text) { text = "Have a look at what I attached."; segments = [{ t: "text", v: text }]; }
    const slash = this.slashOf(tab, text);
    const built = await this.buildPrompt(slash ? slash.rest : text, contexts);
    if (!live(r) || this.runtime.get(tab.id) !== r) { this.post({ type: "flash", text: "The answer ended: send it again" }); return; }
    const { content, meta } = this.attachments.content((slash ? slash.lead : "") + built, attachIds, []);
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
    // (A skill or command is echoed as <command-name>/name</command-name>…, not as the text sent.)
    const cmd = i < 0 && /<command-name>(\/[^<\s]+)<\/command-name>/.exec(text);
    if (cmd) i = r.expect.findIndex((x) => x.text === cmd[1] || x.text.startsWith(cmd[1] + " ") || x.text.startsWith(cmd[1] + "\n"));
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

  // ---------- Enhance prompt ----------
  // The wand beside Send: what you typed → a better prompt in the box (lib/enhance). The page shows what it's doing
  // ("Sonnet 5.5: Reading lib/chat/index.js") and puts the result in the box; you check it and send it yourself.
  async enhance(tab, m) {
    if (!this.enhancing) this.enhancing = new Map();
    if (this.enhancing.has(tab.id) || tab.visiting) return;
    // The reply goes to the pane that asked, tagged with its chat and request: another chat on screen never gets it.
    const pane = this.pane, id = String(m.requestId || "").slice(0, 80);
    const state = (o) => { const msg = { type: "enhanceState", tabId: tab.id, id, ...o }; if (pane && this.panes && this.panes.includes(pane)) this.postTo(pane, msg); else this.post(msg); };
    if (vscode.workspace.isTrusted === false) { state({ state: "error", kind: "unavailable", message: "Trust this workspace before using Kural AI." }); return; }
    const run = this.enhancer.run({ text: ChatView.textOf(Array.isArray(m.segments) ? m.segments : []), root: this.root(), chatEngine: engineOf(tab.model),
      onStatus: (status) => state({ state: "running", status }) });
    this.enhancing.set(tab.id, run);
    const r = await run.done;
    if (this.enhancing.get(tab.id) === run) this.enhancing.delete(tab.id);
    if (r.ok) state({ state: "done", prompt: r.prompt, label: r.label, calls: r.calls, ms: r.ms, dropped: r.dropped || [], flagged: r.flagged || [] });
    else state({ state: "error", kind: r.kind, message: r.error, label: r.label });
  }
  stopEnhance(tabId) { const run = this.enhancing && this.enhancing.get(tabId); if (run) run.stop(); }

  // ---------- the "/" list ----------
  // tabId -> the skills and commands its Claude has (the "/" list in the box: lib/chat/slash.js).
  slashes() { return this.slash || (this.slash = new Map()); }

  // Debug mode (lib/debug): one log endpoint for every chat, started with the first Debug message. Each message of a chat in
  // Debug mode says where to send what the instrumentation logs and where to read it (the file is emptied by `clear`).
  debugLogs() { return this.debugServer || (this.debugServer = new DebugLogs({ log })); }
  async debugText(tab) {
    if (tab.mode !== "debug") return "";
    try { const s = await this.debugLogs().session(tab.id); return debugNote(s.url, s.file); }
    catch (e) { log(`chat ${tab.id}: debug log endpoint: ${e.message}`); return ""; }
  }
  // The chat's skills and commands (null: none here, a model that isn't Claude or Claude without your setup), to its page.
  setSlash(tab, list) {
    if (list) this.slashes().set(tab.id, list); else if (!this.slashes().delete(tab.id)) return;   // (none before, none now)
    this.post({ type: "slash", tabId: tab.id, slash: this.slashView(tab) });
  }
  slashView(tab) {
    const list = isClaude(tab.model) && this.slashes().get(tab.id);
    if (list) return { items: list };
    return { items: [], why: !isClaude(tab.model) ? "Skills and commands come from Claude: pick a Claude model to use them."
      : !fullSetup() ? "Turn on \"Use my Claude Code setup\" (Kural Settings, Claude) to use your skills and commands." : "Loading your skills…" };
  }
  // "/name rest" when name is one of this chat's commands: { lead: "/name ", rest }.
  // (Your shortcut wins over a skill with the same name: Kural expands it, Claude Code never sees it as a command.)
  slashOf(tab, text) {
    if (!isClaude(tab.model)) return null;
    const mine = new Set(userShortcuts().map((x) => x.name));
    const s = slashList.split(text, (this.slashes().get(tab.id) || []).filter((c) => !mine.has(c.name)));
    return s ? { lead: `/${s.name} `, rest: s.rest } : null;
  }

  // ---------- sending ----------
  async buildPrompt(text, contexts) {
    const parts = [];
    // What a quote pill from Fix with Kural / Agent Review is called for the AI.
    const FIX_SOURCES = { problem: "A problem in my code:", terminal: "A command that failed in my terminal:", review: "A finding from Kural's review of my changes:" };
    const seen = new Set();
    for (const c of contexts) {
      // (Two elements of one page are two; so are two quotes.)
      const key = JSON.stringify([c.kind, c.path, c.startLine, c.endLine, c.element && c.element.selector, c.kind === "quote" ? c.text : null]);
      if (seen.has(key)) continue; seen.add(key);
      if (c.kind === "selection") {
        parts.push(`${c.path} (lines ${c.startLine}-${c.endLine}):\n\`\`\`${c.lang || ""}\n${c.code}\n\`\`\``);
      } else if (c.kind === "quote" && c.source === "lesson") {
        // Part of a lesson page (Learn mood): "Add to chat" on a selection or on a visual marked data-concept.
        const where = `${c.slide ? ` (slide ${c.slide}${c.title ? `, "${String(c.title).slice(0, 120)}"` : ""})` : ""}${c.concept ? `, the visual "${String(c.concept).slice(0, 120)}"` : ""}`;
        const said = String(c.text || "").slice(0, 8001).trim();
        parts.push(`From the lesson page${where}, I picked:${said ? `\n${said.split("\n").map((l) => `> ${l}`).join("\n")}` : ""}`);
      } else if (c.kind === "quote" && FIX_SOURCES[c.source]) {
        // Fix with Kural (lib/fix) and Agent Review's findings: a problem, a failed command, a review finding.
        parts.push(`${FIX_SOURCES[c.source]}\n${String(c.text || "").slice(0, 12001).split("\n").map((l) => `> ${l}`).join("\n")}`);
      } else if (c.kind === "quote") {
        // Text you selected in this chat ("Add to chat"); the page keeps it to 8,000 characters.
        parts.push(`Part of this chat I selected:\n${String(c.text || "").slice(0, 8001).split("\n").map((l) => `> ${l}`).join("\n")}`);
      } else if (c.kind === "element") {
        parts.push(elementNote(c.element || {}));
      } else if (c.kind === "shortcut") {
        continue;   // (below: each shortcut once, chips and typed ones alike)
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
    // Your shortcuts (/pr-summary): what each one stands for (lib/chat/shortcuts.js).
    parts.push(...shortcuts.notes(text, contexts, userShortcuts()));
    return parts.length ? `<context>\n${parts.join("\n\n")}\n</context>\n\n${text}` : text;
  }

  // What you typed, with pills written as @main.py or @main.py (L3-9); a quote from the chat as "its first words…".
  // What you picked for options the AI wrote in its answer, kept on your message (the page shows them as chips):
  // [{ question, choices }], at most 6 questions of at most 6 choices; anything else is dropped.
  static cleanPicks(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const p of list) {
      if (out.length >= 6) break;
      if (!p || typeof p.question !== "string" || !p.question.trim() || !Array.isArray(p.choices)) continue;
      const choices = p.choices.filter((c) => typeof c === "string" && c.trim()).slice(0, 6).map((c) => c.trim().slice(0, 120));
      if (choices.length) out.push({ question: p.question.trim().slice(0, 300), choices });
    }
    return out;
  }

  static textOf(segments) {
    return segments.map((s) => s.t === "text" ? s.v : s.ctx.kind === "shortcut" ? `/${s.ctx.name}` : s.ctx.kind === "quote" ? `"${s.ctx.label}"` : s.ctx.kind === "element" ? `[element ${s.ctx.label} on ${s.ctx.path}]`
      : `@${s.ctx.path}${s.ctx.kind === "selection" ? ` (L${s.ctx.startLine}-${s.ctx.endLine})` : ""}`).join("");
  }

  // Replaces the first-words title with a summary, if the chat is still there, still has that title and wasn't renamed meanwhile.
  // Not the conversation: no status, no notification; a failure keeps the first words.
  summarizeTitle(tab, text) {
    const first = tab.title;
    if (!this.titler) return;
    this.titler.ask(tab.id, text).then((title) => {
      if (!title || tab.renamed || tab.title !== first || !this.tab(tab.id)) return;
      tab.title = title;
      this.postTabs(); this.save();
    }, () => {});
  }

  // A tab title from your first message; pills read as "main.py (L3-9)".
  static titleOf(segments) {
    return segments.map((s) => s.t === "text" ? s.v : s.ctx.kind === "shortcut" ? `/${s.ctx.name}` : s.ctx.kind === "quote" ? `"${s.ctx.label}"` : s.ctx.kind === "element" ? s.ctx.label
      : `${path.basename(s.ctx.path)}${s.ctx.kind === "selection" ? ` (L${s.ctx.startLine}-${s.ctx.endLine})` : ""}`)
      .join("").replace(/\s+/g, " ").trim().slice(0, 40);
  }

  // A new answer, empty for now.
  newReply(tab, routed) {
    tab.unseen = false;   // (a new answer starts: the old "done" is old news)
    return { role: "assistant", blocks: [], running: true, t0: Date.now(), mode: tab.mode, model: tab.model, models: [tab.model], routing: routed, journal: { tools: [] } };
  }

  // The program starts answering `reply`: what the turn tracks (changes, the agents of parallel agents).
  beginTurn(tab, r, reply, ask, attachments = null) {
    r.userStopped = false;
    delete r.usageHandoff;
    r.turn = { snaps: {}, reply, ask, journal: reply.journal, switches: 0, dispatched: !!attachments, ...(attachments ? { attachments } : {}) };
    r.lastUsed = Date.now();
    r.agents = new Map();   // Task call id -> agent card
    r.tasks = new Map();    // task id -> Task call id (an agent's permission requests carry its task id)
  }

  async send(tab, segments, contexts, attachIds = [], requestId = null, editIndex = null, picks = []) {
    if (vscode.workspace.isTrusted === false) {
      vscode.window.showWarningMessage("Trust this workspace before using Kural AI. Repository files and provider setup may execute code.");
      return;
    }
    let text = ChatView.textOf(segments).trim();
    if (!text && !attachIds.length) return;
    if (tab.visiting) return;   // (a chat from another workspace: read only)
    // While it answers: into the queue (not an edit of an earlier message: that waits for the answer to end).
    if (tab.status !== "idle") { if (editIndex === null) await this.queueSend(tab, segments, contexts, attachIds, requestId); return; }
    if (!this.isReady()) { vscode.commands.executeCommand("kural.getStarted"); return; }   // nothing set up yet
    // An earlier message edited: the chat goes back to just before it (and the code too, if you say so), then this one is
    // sent in its place.
    if (editIndex !== null && !(await this.rewindTo(tab, editIndex))) return;
    if (this.usageOptions().enabled) await this.switchUsage(tab, text, attachIds.map((id) => this.attachments.items.get(id)).filter(Boolean), contexts);
    if (tab.status !== "idle") return;
    let routed = null;
    const previousMedia = [...new Map(journal.attachmentsOf(tab.messages)
      .filter((a) => ["image","pdf"].includes(a.kind)).map((a) => [a.path,a])).values()];
    if (tab.autoRoute && this.router) {
      this.routerFeedback(tab, "good");   // you carried on after Auto's last answer
      const ctl = new AbortController(); this.routingJobs.set(tab.id,ctl);
      tab.status = "running"; tab.routingState = "Choosing model…"; this.postTabs();
      const previous = tab.model;
      try {
        const attached = attachIds.map((id) => this.attachments.items.get(id)).filter(Boolean);
        // Attachments from earlier turns must remain usable after a provider handoff too.
        const historical = journal.attachmentsOf(tab.messages);
        const guard = this.usageOptions(), live = this.runtime.get(tab.id);
        const holdProvider = guard.enabled && live && live.bg && live.bg.size ? engineOf(previous) : null;
        routed = await this.router.route({ ...this.routingRequest(tab,text,[...attached,...historical],contexts),
          ...(holdProvider ? { provider: holdProvider } : {}) },ctl.signal);
        if (ctl.signal.aborted || !this.tab(tab.id) || !tab.autoRoute || tab.model !== previous) return;
        if (routed.error) {
          // Nothing Auto may pick (no AI with an account set up, or none can do this): keep the chat's model if it works.
          if (!brain.providerOf(previous).ready()) { this.post({ type: "flash",text: routed.error }); return; }
          routed = { ...routed, model: previous, reason: `${routed.error} · kept ${previous}` };
        }
        // Another AI takes over with a record of the conversation (journal.handoff: everything visible, compacted to fit
        // the next model when it's long). Only when that would lose something (the record has to be shortened, or an
        // earlier picture/PDF is gone) and the chat's AI isn't near its limit, Auto picks again within the current AI,
        // whose own conversation keeps everything. Near its limit (80 %+) it moves anyway (Adithya: prioritize the other
        // AI, with the knowledge carried over).
        const here = tab.engine || engineOf(previous);
        let changesProvider = engineOf(routed.model) !== here;
        const tooBig = () => journal.handoff(tab.messages).length > this.handoffBudget(routed.model);
        const missing = () => previousMedia.some((a) => !a.path || !fs.existsSync(a.path));
        if (changesProvider && tab.messages.length && !(guard.enabled ? this.overLimit(here, previous) : this.limitOf(here, previous) >= 80) && (missing() || tooBig())) {
          const why = missing() ? "an earlier attachment is gone" : "the conversation is too long to hand over whole";
          // (On a model on this computer there's no "same AI" for Auto: that one stays.)
          const again = here === "ollama" ? { error: "local" }
            : await this.router.route({ ...this.routingRequest(tab,text,[...attached,...historical],contexts), provider: here }, ctl.signal);
          if (ctl.signal.aborted || !this.tab(tab.id) || !tab.autoRoute || tab.model !== previous) return;
          routed = again.error ? { ...routed, model: previous, reason: `${routed.reason} · kept ${previous}: ${why}` }
            : { ...again, reason: `${again.reason} · stayed with this AI: ${why}` };
          changesProvider = false;
        }
        log(`chat ${tab.id}: Auto chose ${routed.model} (was ${previous}): ${routed.reason || ""}`);
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
    if (tab.title === "New chat" && !tab.renamed) { tab.title = ChatView.titleOf(segments); this.summarizeTitle(tab, text); }
    const user = { role: "user", segments, mode: tab.mode, contexts: contexts.filter((c) => c.kind === "current").map((c) => ({ kind: c.kind, path: c.path, name: c.name })) };
    const picked = ChatView.cleanPicks(picks);
    if (picked.length) user.picks = picked;   // (options you picked in the answer: shown as chips on your message)
    const reply = this.newReply(tab, routed);
    tab.messages.push(user, reply);
    tab.status = "running";
    tab.updatedAt = Date.now();
    this.post({ type: "append", tabId: tab.id, requestId, msgs: [user, reply] });
    this.postTabs();

    // The chat was on the other engine (Claude Code ↔ Kural's own): that one has the conversation, this one doesn't.
    // A new session, and this message carries the conversation so far (everything before it).
    // The same after you switched that AI's account (Codex, Gemini: their conversations may not open for another
    // account; tab.freshSession, accountChanged).
    const engine = engineOf(tab.model);
    // Parallel agents answered before: their lead starts afresh each answer (with splitHistory), so the program's own
    // conversation never saw those answers. The next ordinary answer starts a new one that's handed the conversation.
    const split = this.splitOn(tab);
    if (!split && tab.splitTurns && tab.started) tab.freshSession = tab.freshSession || "split";
    if (split) tab.splitTurns = true; else delete tab.splitTurns;
    const changedProvider = (tab.engine && tab.engine !== engine) || (tab.freshSession && tab.started);
    if (changedProvider) {
      if (tab.messages.length > 2) tab.carryOver = tab.freshSession === "account" && tab.engine === engine ? { model: true, account: true } : { model: true };
      tab.sessionId = newSessionId(); tab.started = false; tab.context = null;
      const old = this.runtime.get(tab.id);
      if (old && old.proc) { old.stale = true; old.proc.kill(); old.proc = null; }
      this.endDevice(old);
    }
    tab.engine = engine;
    tab.profile = scope.profileId();   // (whose account holds this conversation: see clean())
    delete tab.freshSession; delete tab.profileFresh;
    // Prepare the complete record before starting the provider, so its read directory is available from launch.
    let carry = "";
    // (Parallel agents get the conversation through splitHistory: not twice.)
    try { if (tab.carryOver && !tab.started && !split) carry = this.carryText(tab.carryOver, this.handoffRecord(tab, tab.messages.slice(0, -2))); }
    catch (e) {
      reply.running = false; reply.error = `Kural couldn't preserve the complete conversation: ${e.message}`; tab.status = "idle";
      this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) }); this.postTabs(); this.save();
      this.notify(tab, "error", { error: reply.error });
      return;
    }
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
    const deviceNote = tab.device && this.devices && deviceOk(tab.model) ? this.devices.note(tab.device) : "";
    const ctl = new AbortController(); this.routingJobs.set(tab.id,ctl);
    const debugText = tab.mode === "debug" ? await this.debugText(tab) : "";   // (no extra wait in other modes)
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
    // A skill or command ("/superpowers:brainstorming …"): Claude Code runs it only when the message starts with it, so it
    // goes first and everything Kural adds (handoff, notes, context) follows as its arguments.
    const slash = this.slashOf(tab, text), lead = slash ? slash.lead : "";
    const built = await this.buildPrompt(slash ? slash.rest : text,contexts);
    if (ctl.signal.aborted || !reply.running) { if (this.routingJobs.get(tab.id) === ctl) this.routingJobs.delete(tab.id); return; }
    if (this.routingJobs.get(tab.id) === ctl) this.routingJobs.delete(tab.id);
    const { content: prompt, meta } = this.attachments.content(lead + carry + this.instructionsNote(tab) + ticketNote(tab.ticket) + deviceNote + this.rulesMessage(tab, contexts) + debugText + retrieved + built, attachIds, carry ? previousMedia : []);
    user.sentText = lead + journal.textOf(prompt).slice(lead.length + carry.length);
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
    log(`chat ${tab.id}: sent (${JSON.stringify(prompt).length} chars, ${contexts.length} context items, ${meta.length} attachments, ${tab.model}/${tab.effort}, ${tab.mode}${this.splitOn(tab) ? `, parallel agents on ${this.workersFor(tab)}` : ""})`);
    this.save();
  }

  // What the AI is told for this chat's mode and mood (the parts of its instructions you can change mid-chat).
  instructionsOf(tab) { return { mode: PROMPTS[tab.mode] || "", mood: this.moodText(tab).trim(), rules: this.rulesText(tab).trim() }; }
  // Claude Code keeps a resumed conversation's first instructions: on --resume it ignores a new --append-system-prompt
  // (checked with Claude Code 2.1.289). So a mood or mode you change after the first message would never reach it;
  // instead your next message starts with what changed. (The other programs get it the same way: harmless.)
  // tab.sessionInstructions: what this conversation was given so far.
  // (Kept as short fingerprints, saved with the chat.)
  instructionsNote(tab) {
    const now = this.instructionsOf(tab), was = tab.sessionInstructions;
    const print = (t) => require("crypto").createHash("sha1").update(t).digest("hex").slice(0, 12);
    tab.sessionInstructions = { mode: print(now.mode), mood: print(now.mood), rules: print(now.rules) };
    if (!tab.started || !was) return "";
    const changed = [];
    if (was.mode !== print(now.mode)) changed.push(now.mode);
    if (was.mood !== print(now.mood)) changed.push(now.mood || "Mood: Default. Drop the earlier mood's instructions and work in your normal, balanced way.");
    // (A chat saved before rules existed has no fingerprint for them: it was given none.)
    if ((was.rules === undefined ? print("") : was.rules) !== print(now.rules)) changed.push(now.rules || "The project's rules were removed. Drop the earlier rules' instructions.");
    return changed.length ? "<kural_instructions_update>\nI changed how you should work in this chat. These replace your earlier instructions about the " +
      "same things (mode, mood, project rules):\n" + changed.join("\n\n") + "\n</kural_instructions_update>\n\n" : "";
  }

  // The project's rules (lib/rules): the always ones and the list of the others, read from disk each time (small files).
  rulesText(tab) {
    try {
      const text = projectRules.systemText(projectRules.loadRules(ws.folders().map((f) => f.path)));
      return text ? `\n\n${text}` : "";
    } catch { return ""; }
  }
  // The rules this message brings along (a file of it matches their globs, or it mentions the rule file) that the AI wasn't
  // given yet in this conversation: tab.rulesSent, kept per session (a new session starts the list again). Parallel agents'
  // lead starts afresh each answer, so it gets them every time.
  rulesMessage(tab, contexts = []) {
    try {
      if (tab.rulesSession !== tab.sessionId) { tab.rulesSent = []; tab.rulesSession = tab.sessionId; }
      const files = [];
      for (const c of contexts || []) {
        if (!["file", "current", "selection"].includes(c && c.kind)) continue;
        const uri = this.resolvePath(c.path);
        if (uri && uri.fsPath) files.push(uri.fsPath);
      }
      if (!files.length) return "";
      const all = projectRules.loadRules(ws.folders().map((f) => f.path));
      const sent = this.splitOn(tab) ? [] : tab.rulesSent || [];
      const list = projectRules.unsent(all, files, sent);
      if (!list.length) return "";
      if (!this.splitOn(tab)) tab.rulesSent = [...sent, ...list.map((x) => x.rel)];
      return projectRules.messageText(all, files, sent);
    } catch { return ""; }
  }

  // The mood's instructions, and in Learn mood how to make a lesson page (lib/learn) in this chat's own folder.
  moodText(tab) {
    const dir = this.lessonDir(tab);
    return moodPrompt(tab.mood, customMoods(userMoods())) + (dir ? lessonPrompt(dir, tab.mode) : "");
  }
  // Learn mood's lesson folder for this chat (null in other moods); `make`: create it and watch it for lesson pages.
  lessonDir(tab, make = false) {
    if (!this.lessons || tab.mood !== "learn") return null;
    return make ? this.lessons.ensure(tab.id) : this.lessons.dir(tab.id);
  }

  // ---------- carrying the conversation over (another AI, a new session) ----------
  handoffDir(tab) {
    const storage = this.context && this.context.globalStorageUri && this.context.globalStorageUri.fsPath;
    return handoffStore.directory(storage ? scope.dir("handoffs", "data", storage) : privateTmp("handoffs"), tab.id);
  }

  // The inline overview fits the receiving model. Omitted details remain in a private, readable local file, which is
  // replaced on the next handoff and deleted with the chat. A failed save stops the handoff instead of losing details.
  handoffRecord(tab, messages, model = tab.model) {
    this.revokeAllowAll(tab);   // (another AI or a new conversation: "Allow all" was given to the old one)
    return this.conversationRecord(tab, messages, model);
  }
  // The record itself (also each parallel-agents lead's, which starts afresh every answer: splitHistory).
  conversationRecord(tab, messages, model = tab.model) {
    const budget = this.handoffBudget(model), whole = journal.handoff(messages);
    if (whole.length <= budget) {
      // An edit/fork can shorten a previously large chat. Its old record must not expose the discarded future turns.
      if (fs.existsSync(path.join(this.handoffDir(tab), "history.json"))) handoffStore.save(messages, this.handoffDir(tab));
      return whole;
    }
    const archive = handoffStore.save(messages, this.handoffDir(tab));
    tab.handoffFile = archive.path;
    return journal.handoff(messages, budget, archive);
  }

  // What the first message of a new session starts with: the record of the conversation (journal.handoff) and why.
  carryText(c, record) {
    const wrapped = (attrs, why) => `<earlier_conversation${attrs}>\n${record}\n</earlier_conversation>\n${why}\n\n`;
    if (c.fork) return wrapped("", "This chat branches from that conversation at the selected message. Continue from it using my next message. The workspace files are still in their current state.");
    if (c.edited) return wrapped("", "That's our conversation so far. I've changed my next message: answer it as it is now.");
    if (c.usage) return wrapped("", `That's our conversation so far. ${c.usage} paused at the user's usage threshold. Continue the latest request from where it stopped. Completed steps happened already; check the files before changing them.`);
    if (c.retry) return wrapped("", `That's our conversation so far. ${c.retry} stopped in the middle of my last request (above) because it reached its usage limit: carry that request on from where it got to. Steps marked complete happened already; check the files before you change them.`);
    if (c.account) return wrapped("", "That's our conversation so far (before I switched accounts). Carry on from it.");
    if (c.model) return wrapped("", "That's our conversation so far (with another model). Carry on from it.");
    return wrapped(` workspace="${String(c.from || "").replace(/"/g, "'").replace(/[<>\r\n]/g, " ")}"`, "That's our earlier conversation, from another workspace. Carry on from it here.");
  }

  // How many characters of conversation record the next model gets: the router's handoff setting (120,000 by default);
  // a model on this computer only what fits about half its context (setting kural.localModels.contextLength, in tokens).
  handoffBudget(model) {
    const set = this.router ? this.router.options().handoffChars : cfg().get("modelRouter.handoffChars", 120000);
    if (!isLocal(model)) return set;
    const ctx = Number(cfg().get("localModels.contextLength", 32768)) || 32768;
    return Math.max(8000, Math.min(set, Math.round(ctx * 1.6)));
  }

  // How much of an AI's usage limit is used now (0-100; 100 = it refused a request on its limit), from the programs'
  // own reports (lib/ai/usage.js).
  limitOf(provider, model) {
    try { const u = limitUsed({ id: model || "" }, usageHub.current(provider)); return Number.isFinite(u) ? u : 0; } catch { return 0; }
  }

  usageOptions() { return require("../ai/usage-switch").options(cfg()); }
  // Has this AI reached one of your switch points (its Session or Weekly limit, Kural Settings)?
  overLimit(provider, model) {
    let parts = null;
    try { parts = limitParts({ id: model || "" }, usageHub.current(provider)); } catch { /* no report yet */ }
    return !!require("../ai/usage-switch").over({ providerId: provider, limitUsed: this.limitOf(provider, model), ...(parts ? { limitParts: parts } : {}) }, this.usageOptions());
  }

  async usageChoice(tab, text = this.lastAsk(tab), attached = [], contexts = []) {
    const guard = this.usageOptions();
    if (!guard.enabled || !this.overLimit(engineOf(tab.model), tab.model)) return null;
    const models = this.router && this.router.availableModels ? await this.router.availableModels() : this.routerModels().map((m) =>
      ({ ...m, limitUsed: this.limitOf(m.providerId, m.id), ...(() => { try { const p = limitParts(m, usageHub.current(m.providerId)); return p ? { limitParts: p } : {}; } catch { return {}; } })() }));
    return require("../ai/usage-switch").choose(models,
      this.routingRequest(tab, text, [...journal.attachmentsOf(tab.messages), ...attached], contexts), guard);
  }

  usageChanged() {
    for (const tab of this.tabs) {
      if (tab.visiting) continue;
      const r = this.runtime.get(tab.id);
      const move = tab.status === "idle" ? this.switchUsage(tab) : this.usageCheckpoint(tab, r);
      move.catch((e) => log(`chat ${tab.id}: usage switch unavailable: ${e.message}`));
    }
  }

  // Completed answers switch before the next request. Running tools and parallel agents finish before a handoff.
  async switchUsage(tab, text, attached, contexts) {
    if (tab.status !== "idle" || tab.visiting) return;
    if (tab.usageChoosing) { await tab.usageChoosing; return this.switchUsage(tab, text, attached, contexts); }
    const r = this.runtime.get(tab.id), was = tab.model;
    if (r && ((r.steers || []).length || (r.bg && r.bg.size))) return;
    const pending = (async () => {
      const choice = await this.usageChoice(tab, text, attached, contexts);
      if (!choice || !this.usageOptions().enabled || tab.status !== "idle" || tab.model !== was || !this.tab(tab.id)) return;
      // Save the record before changing sessions; send() builds it again with the next message's attachments.
      if (tab.messages.length) this.handoffRecord(tab, tab.messages, choice.model);
      tab.model = choice.model; tab.modelName = null; tab.pendingModel = false;
      // Keep Auto's next decision on the new service, while starting it with the old conversation.
      if (tab.started) tab.freshSession = "usage";
      tab.engine = engineOf(choice.model);
      if (r && r.proc) { r.stale = true; r.proc.kill(); r.proc = null; this.endDevice(r); }
      this.remember(tab); this.postTabs(); this.save();
      this.post({ type: "flash", text: choice.reason });
      log(`chat ${tab.id}: ${choice.reason}`);
    })();
    tab.usageChoosing = pending;
    try { await pending; } finally { if (tab.usageChoosing === pending) delete tab.usageChoosing; }
  }

  // Interrupt only between tools, with no pending question, command, queued message or running agent.
  async usageCheckpoint(tab, r) {
    if (!r || r.usageChecking || r.usageHandoff || r.userStopped || (r.bg && r.bg.size) || !r.turn || !r.turn.dispatched ||
      (r.steers || []).length || !journal.canCheckpoint(r)) return;
    r.usageChecking = true;
    const was = tab.model, turn = r.turn;
    try {
      const choice = await this.usageChoice(tab, turn.ask, turn.attachments || []);
      if (!choice || !this.usageOptions().enabled || tab.model !== was || r.turn !== turn || this.runtime.get(tab.id) !== r ||
        r.userStopped || (r.bg && r.bg.size) || (r.steers || []).length || !journal.canCheckpoint(r)) return;
      r.usageHandoff = choice;
      r.proc.interrupt();
    } finally { r.usageChecking = false; }
  }

  // An answer of Auto's failed because its AI reached a usage limit (the error said so): the same request goes on with
  // another AI right away, with the conversation (and what the stopped answer had done) handed over, instead of just
  // failing. The stopped answer stays, with a note. false: nothing else can take it (the error stays).
  async retryElsewhere(tab, failed, usageChoice = null) {
    // (Your request: the message before it, or before the answers that already stopped on a limit.)
    const i = tab.messages.indexOf(failed), user = [...tab.messages.slice(0, Math.max(0, i))].reverse().find((m) => m.role === "user");
    const enabled = () => tab.autoRoute || this.usageOptions().enabled;
    const previous = this.runtime.get(tab.id);
    if (i < 1 || !user || i !== tab.messages.length - 1 || tab.status !== "idle" || !enabled() || !this.router ||
      (previous && previous.userStopped) || (usageChoice && !this.usageOptions().enabled) ||
      (this.usageOptions().enabled && previous && previous.bg && previous.bg.size)) return false;
    const from = engineOf(failed.model || tab.model), who = whoOf(failed.model || tab.model);
    const ask = ChatView.textOf(user.segments || []).trim() || "Have a look at what I attached.";
    const historical = journal.attachmentsOf(tab.messages);
    const media = [...new Map(historical.filter((a) => ["image", "pdf"].includes(a.kind)).map((a) => [a.path, a])).values()];
    const ctl = new AbortController(); this.routingJobs.set(tab.id, ctl);
    tab.status = "running"; tab.routingState = "Choosing another AI…"; this.postTabs();
    let routed;
    try { routed = usageChoice || (this.usageOptions().enabled ? await this.usageChoice(tab, ask) :
      await this.router.route({ ...this.routingRequest(tab, ask, historical, []), avoid: from }, ctl.signal)); }
    catch { routed = null; }
    finally { if (this.routingJobs.get(tab.id) === ctl) this.routingJobs.delete(tab.id); delete tab.routingState; tab.status = "idle"; this.postTabs(); }
    // (Not to an AI that's at its limit too: no going back and forth between two that are both out.)
    if (ctl.signal.aborted || (previous && previous.userStopped) || (usageChoice && !this.usageOptions().enabled) ||
      (this.usageOptions().enabled && previous && previous.bg && previous.bg.size) ||
      !routed || routed.error || engineOf(routed.model) === from || !brain.providerOf(routed.model).ready() || !enabled() || tab.status !== "idle" ||
      (this.usageOptions().enabled ? this.overLimit(engineOf(routed.model), routed.model) : this.limitOf(engineOf(routed.model), routed.model) >= 98)) return false;
    let record;
    try { record = this.handoffRecord(tab, tab.messages, routed.model); }
    catch (e) { log(`chat ${tab.id}: couldn't preserve its complete conversation for a handoff: ${e.message}`); return false; }
    log(`chat ${tab.id}: ${who} reached its limit; Auto carries the request on with ${routed.model}`);
    failed.note = usageChoice ? `${routed.reason}. The request continues below.` : `${who} reached its usage limit here. ${tab.autoRoute ? "Auto" : "Kural"} carried on with ${whoOf(routed.model)} below.`;
    failed.limitError = failed.error; delete failed.error;
    this.post({ type: "patch", tabId: tab.id, index: i, msg: this.patchOf(failed) });
    tab.model = routed.model; tab.modelName = null; tab.pendingModel = false;
    if (routed.effort && !tab.effortPinned && valid(EFFORTS, routed.effort)) tab.effort = routed.effort;
    this.remember(tab);
    const reply = this.newReply(tab, routed);
    tab.messages.push(reply);
    tab.status = "running"; tab.updatedAt = Date.now();
    this.post({ type: "append", tabId: tab.id, requestId: null, msgs: [reply] });
    this.postTabs();
    // A new session with the other AI; its first message: the conversation up to and including the stopped answer.
    const old = this.runtime.get(tab.id);
    if (old && old.proc) { old.stale = true; old.proc.kill(); old.proc = null; }
    this.endDevice(old);
    tab.sessionId = newSessionId(); tab.started = false; tab.context = null; tab.engine = engineOf(tab.model);
    const r = this.startProc(tab);
    if (!r) { reply.running = false; tab.status = "idle"; reply.error = `${whoOf(tab.model)} didn't start. Check it in Get started.`; this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) }); this.postTabs(); return false; }
    this.beginTurn(tab, r, reply, ask);
    const carry = this.carryText(usageChoice ? { usage: who } : { retry: who }, record);
    const { content } = this.attachments.content(carry + this.instructionsNote(tab) + ticketNote(tab.ticket) + await this.debugText(tab), [], media);
    r.turn.attachments = media;
    r.pendingSend = content; r.turn.dispatched = true;
    this.sendTo(r, content, "turn");
    log(`chat ${tab.id}: sent to ${tab.model} (${JSON.stringify(content).length} chars, the conversation handed over)`);
    this.save();
    return true;
  }

  // You logged out of an AI, logged in again, or switched its account (Kural Settings, or outside Kural): its chats go on
  // with everything they knew. Claude Code keeps its conversations on this computer, so a Claude chat just goes on (if
  // it can't, onExit starts it again with the conversation). Codex's and Gemini's conversations may belong to the
  // account: those chats start a new conversation that's handed this one at the next message (tab.freshSession).
  accountChanged(provider) {
    if (!provider) return;
    log(`chat: ${provider} account changed; its chats carry their conversations over`);
    for (const t of this.tabs) {
      if ((t.engine || engineOf(t.model)) !== provider || !t.started) continue;
      if (provider !== "claude") t.freshSession = "account";
      const r = this.runtime.get(t.id);
      if (r && r.proc && t.status === "idle") { r.stale = true; r.proc.kill(); r.proc = null; this.endDevice(r); }
    }
    this.save();
  }

  // "Save plan" under a plan: the answer's text as plans/plan-<date>.md in the project (the work folder with none open), then opened.
  async savePlan(tab, index) {
    const msg = tab.messages[index];
    const text = msg ? (msg.blocks || []).filter((b) => b.k === "text" && String(b.text || "").trim()).map((b) => b.text.trim()).join("\n\n") : "";
    if (!text) { vscode.window.showWarningMessage("Kural: there is no plan text to save."); return; }
    const d = new Date(), pad = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const dir = path.join(ws.root() || ws.workDir(), "plans");
    try {
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `plan-${stamp}.md`);
      fs.writeFileSync(file, `${text}\n`);
      await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
      vscode.window.setStatusBarMessage(`Plan saved to ${vscode.workspace.asRelativePath(file)}`, 3000);
    } catch (e) { vscode.window.showWarningMessage(`Kural couldn't save the plan: ${e.message}`); }
  }

  // "Build it" under a plan: switch to Agent and carry the plan out. Auto only when this chat is already in Auto: a plan
  // (shaped by whatever the AI read) must not start running commands unasked because another chat once used Auto.
  async buildPlan(tab) {
    if (tab.status !== "idle") return;
    const was = tab.mode;
    tab.mode = tab.mode === "auto" || tab.mode === "debug" ? tab.mode : "agent";
    if (tab.mode !== was) this.revokeAllowAll(tab);
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
    if (m.type === "kural_usage") { this.countTokens(tab, reply, m.tokens, m.context); this.usageCheckpoint(tab, r).catch(() => {}); return; }
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
      // (Only Claude reports your connectors. ChatGPT's, Gemini's and a local model's adapters send an empty list, which
      // said "Atlassian isn't connected" and closed Link ticket after every answer they gave: issue #105.)
      if (r.engine === "claude") this.noteSetup(tab, r, m);
      return;
    }
    // What Claude Code keeps running in the background (agents, a long command like a dev server), also after the answer
    // ended: while one runs, stopIdle leaves the chat's program alone (stopping it would stop them too).
    if (m.type === "system" && m.task_id && /^task_/.test(m.subtype || "")) {
      const st = m.subtype === "task_notification" ? m.status : m.subtype === "task_updated" && m.patch ? m.patch.status : null;
      if (m.subtype === "task_started") (r.bg || (r.bg = new Set())).add(m.task_id);
      else if (st && st !== "running" && st !== "pending" && r.bg) {
        r.bg.delete(m.task_id);
        if (!r.bg.size && this.usageOptions().enabled) setTimeout(() => {
          const move = tab.status === "idle" ? this.switchUsage(tab) : this.usageCheckpoint(tab, r);
          move.catch((e) => log(`chat ${tab.id}: ${e.message}`));
        }, 0);
      }
    }
    if (!reply) return;
    // Parallel agents (lib/split): each agent's start and end as system events, keyed by its Task call. The answer ends
    // when they all have (the result comes after the last one).
    if (m.type === "system" && /^task_/.test(m.subtype || "")) {
      if (m.subtype === "task_started" && m.task_id && m.tool_use_id) r.tasks.set(m.task_id, m.tool_use_id);
      const end = m.subtype === "task_notification" ? m.status : m.subtype === "task_updated" && m.patch ? m.patch.status : null;
      const owner = (m.tool_use_id && r.agents.get(m.tool_use_id)) || (m.task_id && r.agents.get(r.tasks.get(m.task_id)));
      if (!owner) return;
      // What the agent is doing right now ("Running the tests"), shown on its card.
      if (m.subtype === "task_progress" && owner.state === "running" && m.description) {
        owner.activity = String(m.description).replace(/^Running /, "");
        this.post({ type: "agentActivity", tabId: tab.id, agentId: owner.id, activity: owner.activity });
      }
      const END = { completed: "done", failed: "failed", error: "failed", killed: "stopped", stopped: "stopped", cancelled: "stopped", canceled: "stopped" };
      if (owner.state === "running" && END[end]) {
        owner.state = END[end];
        this.post({ type: "agentState", tabId: tab.id, agentId: owner.id, state: owner.state });
      }
      // While some still work: who, and "Finish now" (the others' work goes on without them).
      const names = [...r.agents.values()].filter((x) => x.state === "running").map((x) => x.name);
      if (reply.running && JSON.stringify(names) !== JSON.stringify(reply.waitingFor || [])) {
        reply.waitingFor = names;
        this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) });
      }
      return;
    }
    // An agent's messages carry the id of the Task call that started it.
    const parent = m.parent_tool_use_id || null;
    // The lead speaks again after the answer was closed (a background command reported back just as it finished):
    // reopen the same answer instead of gluing text onto a finished one.
    if (!parent && (m.type === "stream_event" || m.type === "assistant") && !reply.running && tab.status === "idle" && !r.stale) {
      reply.running = true;
      delete reply.error;
      tab.status = "running"; tab.unseen = false;
      const last = reply.blocks[reply.blocks.length - 1];
      if (last && last.k === "text" && !/\n\n$/.test(last.text)) last.text += "\n\n";
      this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) });
      this.postTabs();
    }
    // (A tool call's result: the Explorer stops showing a read soon after; the lead's and the agents' alike.)
    if (m.type === "user" && this.explorer && m.message && Array.isArray(m.message.content))
      for (const c of m.message.content) if (c && c.type === "tool_result") this.explorer.finished(tab.id, c.tool_use_id);
    if (m.type === "stream_event") {
      if (parent) return;   // helpers' own text stays inside their card; only the lead talks in the chat
      const e = m.event;
      // Claude's thinking, as short summaries (only when Claude Code supports --thinking-display).
      // (kural_raw: the AI's own thinking as it wrote it, not a summary: lib/ai/codex.js marks it. The timeline says so.)
      if (e.type === "content_block_start") { r.blockType = e.content_block && e.content_block.type; r.thinkRaw = !!(e.content_block && e.content_block.kural_raw); }
      if (e.type === "content_block_delta" && e.delta.type === "thinking_delta" && e.delta.thinking) {
        let last = reply.blocks[reply.blocks.length - 1];
        if (!last || last.k !== "think" || last.done) {
          last = { k: "think", text: "", t0: Date.now(), ...(r.thinkRaw ? { raw: true } : {}) };
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
      for (const b of m.message.content || []) {
        // What an agent writes and thinks: into its card.
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
          // A parallel agent (lib/split): "Agent 2 · Haiku · Docs and changelog", or the lead resolving a merge.
          const who = (b.input && b.input.kural_agent) || {}, n = r.agents.size + 1;
          const name = who.n === "Lead" ? "Lead" : `Agent ${who.n || n}`;
          const block = { k: "agent", id: b.id, n, name, role: who.label || null, title: (b.input && b.input.description) || name, steps: [], state: "running" };
          r.agents.set(b.id, block);
          reply.blocks.push(block);
          this.post({ type: "block", tabId: tab.id, block });
          continue;
        }
        if (b.name === "AskUserQuestion") continue;   // shown as a question card instead
        if (this.explorer) this.explorer.started(tab.id, b.id, b.name, b.input);
        const step = { k: "tool", name: b.name, detail: toolDetail(b.name, b.input, this.root()), id: b.id };
        const owner = parent && r.agents.get(parent);
        if (owner) {
          owner.steps.push(step);
          this.post({ type: "agentStep", tabId: tab.id, agentId: owner.id, step });
        } else {
          reply.blocks.push(step);
          this.post({ type: "block", tabId: tab.id, block: step });
        }
      }
    } else if (m.type === "user" && !parent) {
      if (isClaude(tab.model)) this.routingCheckpoint(tab,r).catch(() => {});
      this.usageCheckpoint(tab, r).catch(() => {});
    } else if (m.type === "result") {
      r.pendingSend = null;
      this.finishReply(tab, r, m);
    }
  }

  // "Finish now": the parallel agents still working stop; the finished ones' work goes on to the merge.
  finishAgents(tab) {
    const r = this.runtime.get(tab.id);
    if (r && r.turn && r.turn.reply.running && r.proc && r.proc.finishAgents) r.proc.finishAgents();
  }

  // What Claude loaded from your setup: connectors / MCP servers, plugins, skills. Shown in the
  // model menu; a newly added connector is announced once.
  noteSetup(tab, r, m) {
    const prev = tab.setup || {};
    this.showSetup(tab, {
      servers: (m.mcp_servers || []).map((x) => ({ id: x.name, name: prettyServer(x.name), status: x.status })),
      plugins: (m.plugins || []).filter((x) => x.path !== "builtin").map((x) => x.name),
      skills: (m.skills || []).length || prev.skills || 0,
    });
  }

  async checkServers(tab, r) {
    const res = await r.proc.request({ subtype: "mcp_status" });
    if (!res || !Array.isArray(res.mcpServers) || r.stale) return;
    const prev = tab.setup || {};
    this.showSetup(tab, {
      servers: res.mcpServers.map((x) => ({ id: x.name, name: prettyServer(x.name), status: x.status, tools: (x.tools || []).length })),
      plugins: prev.plugins || [], skills: prev.skills || 0,
    });
  }

  showSetup(tab, setup) {
    setup.full = !!fullSetup();
    // Announce a connector that wasn't there before (not on the very first report).
    const known = tab.knownServers ? new Set(tab.knownServers) : null;
    // (Kural's own servers, like the device's tools, aren't news.)
    const added = known ? setup.servers.filter((x) => x.status === "connected" && !known.has(x.name) && x.name !== "device").map((x) => x.name) : [];
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
    if (this.explorer) this.explorer.ended(tab.id);
    reply.waitingFor = [];
    reply.running = false;
    reply.ms = Date.now() - reply.t0;
    r.lastUsed = Date.now();
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
    // Its AI reached a usage limit: Auto avoids that AI until it resets, and (in Auto) the request goes on with another
    // AI at once, the conversation handed over (retryElsewhere). Not a second time for the same answer.
    const limited = journal.limitError(reply.error) && !r.stale;
    if (limited) usageHub.markLimited(engineOf(reply.model || tab.model));
    // (An answer that went through: that AI isn't at its limit, whatever was noted before.)
    else if (!reply.error) { const p = engineOf(reply.model || tab.model), u = usageHub.current(p); if (u && u.blockedUntil) usageHub.report(p, { allowed: true }); }
    const thresholdPause = r.usageHandoff && !r.userStopped && m.subtype === "error_during_execution";
    const retry = (limited && (tab.autoRoute || this.usageOptions().enabled) || thresholdPause) && this.router && !queued && !reply.retried;
    if (retry) {
      reply.retried = true;
      setTimeout(() => this.retryElsewhere(tab, reply, thresholdPause ? r.usageHandoff : null).then((moved) => {
        if (!moved && !reply.notified) { reply.notified = true; this.notify(tab, "error", { error: reply.error }); }
      }, (e) => log(`chat ${tab.id}: couldn't carry the request on elsewhere: ${e.message}`)), 0);
    }
    // Done (or it needs you: an error, a login, a plan to build): one notification per answer, while you're not looking.
    // Not after Stop (that was you), not while a message you queued is answered next (or Auto carries it on elsewhere).
    if (!reply.notified && reply.error !== "stopped" && !queued && !retry) {
      reply.notified = true;
      if (reply.error === "login") this.notify(tab, "login", { who: reply.errorWho });
      else if (reply.error) this.notify(tab, "error", { error: reply.error });
      else this.notify(tab, reply.planReady ? "plan" : "done", { text: answerText(reply) });
    } else if (reply.error !== "stopped") {
      log(`chat ${tab.id}: no notification: ${reply.notified ? "already notified for this answer" : queued ? "a queued message is answered next" : "carried on by another AI"}`);
    }
    // Finished while you weren't looking: the Projects bar shows "done" until you open the chat. Not after Stop (that was you),
    // not while a queued message is answered next or Auto carries the request on with another AI.
    if (reply.error !== "stopped" && !queued && !retry && !this.shown(tab.id)) { tab.unseen = true; tab.doneAt = Date.now(); }
    this.finishTurn(tab, r);
    // The answer is done: Kural lets go of the browser tabs it used (its network stop is lifted; the tab is yours again).
    if (this.browserAi) this.browserAi.release(tab.id);
    // Tab learns what you're working on, and which files the chat changed for it.
    if (this.activity && r.turn.ask && reply.error !== "stopped") this.activity.addWork("chat", r.turn.ask, (reply.changes || []).map((c) => c.rel));
    this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) });
    this.postTabs(); this.save();
    if (!retry && !queued && reply.error !== "stopped") setTimeout(() => this.switchUsage(tab).catch((e) => log(`chat ${tab.id}: ${e.message}`)), 0);
    // If you changed mode/intensity while it was answering, get the new setup ready now (not with a queued message
    // waiting in this one: warm() waits for that).
    if (r.procKey !== this.procKey(tab)) this.warm(tab);
  }

  // Stop no matter what state Claude is in.
  forceStop(tab, r) {
    const routing = this.routingJobs.get(tab.id); if (routing) { routing.abort(); this.routingJobs.delete(tab.id); }
    delete tab.routingState;
    if (r) {
      r.userStopped = true;
      this.giveBack(tab, r);   // queued messages it hadn't taken in: back into the box
      if (r.checkpointAbort) r.checkpointAbort.abort();
      r.stale = true;
      if (r.proc) r.proc.kill();
      r.proc = null;
      this.endDevice(r);
      for (const res of r.perms.values()) res(false);
      r.perms.clear();
    }
    if (r && r.turn && r.turn.reply.running) {
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
    if (!agentLike(reply.mode) && reply.mode !== "auto") return;
    try {
      const roots = this.projectRoots(tab);
      const files = this.changes.summary(r.turn, this.root()).filter((c) => inProject(c.file, roots));
      if (files.length) reply.changes = files;
    } catch (e) { log(`chat: couldn't list changes: ${e.message}`); }
  }

  patchOf(msg) { return { waitingFor: msg.waitingFor, running: msg.running, error: msg.error, errorWho: msg.errorWho, changes: msg.changes, ms: msg.ms, note: msg.note, blocks: msg.blocks, planReady: msg.planReady, planBuilt: msg.planBuilt, model: msg.model, models: msg.models, routing: msg.routing, contextSelection: msg.contextSelection }; }

  // The AI (or one of its parallel agents) wants to edit a file or run a command.
  async onPermission(tab, r, req) {
    const turn = r.turn;
    const input = req.input || {};
    if (vscode.workspace.isTrusted === false) return { allow: false, message: "Workspace trust is required." };
    // Gemini's approval gate (lib/ai/agy-gate-host.js): only for the answer that's running, and only for the mode agy was
    // started for (a mode change revokes the gate; the next message starts agy with the new mode).
    // A step of parallel agents brings its own mode (req.mode: the lead plans read only while the chat is in Agent): the
    // stricter one counts, like for Gemini's gate.
    let mode = tab.mode;
    if (req.gate || req.mode) {
      mode = gatedMode(tab.mode, req.gate ? req.gateMode : req.mode);
      if (!mode) return { allow: false, message: "The chat's mode changed; nothing more runs in this answer." };
      if (!turn || !turn.reply.running) return { allow: false, message: "The answer was stopped." };
    }
    const verdict = decide({ tool: req.tool_name, input, mode, allowAll: allowAllNow(tab), allowAllDevice: tab.allowAllDevice, device: tab.device,
      writeRoots: [...ws.aiRoots(true), ...(this.lessonDir(tab) ? [this.lessonDir(tab)] : [])], readRoots: ws.aiRoots(), granted: [...(tab.granted || []), tab.handoffFile], cwd: this.root() || ws.workDir(), notice: req.notice,
      unclassified: !!req.unclassified, guard: isGateFile });
    if (verdict.deny) return { allow: false, message: verdict.message };
    const prepareEdit = async () => {
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
    }
    };
    // Run at once or ask: permission-policy.js decides (its test is the table of every case).

    if (verdict.allow) { await prepareEdit(); return { allow: true }; }
    if (verdict.question) return this.askUser(tab, r, req);
    const risky = verdict.risky;
    // Agent mode: running commands asks you first.
    const pid = shortId();
    const owner = req.agent_id && r.agents.get(r.tasks.get(req.agent_id));   // one of its parallel agents asking
    const detail = permDetail(req.tool_name, input) + (risky ? `\n\nAsks first: ${risky.why}` : "");
    // ("Allow all" on this card covers only its kind of call: allowKind. None for a file or a tool Kural can't classify.)
    const block = { k: "perm", pid, tool: req.tool_name, detail, risky: !!risky || undefined, state: "pending", agent: owner ? owner.name || `Agent ${owner.n}` : undefined,
      private: verdict.private || undefined,   // (your Desktop, Downloads, Music…: asks in Auto too, no "Allow all")
      where: input.device || undefined,   // (a linked device's name, for its commands and writes)
      site: /^Browser(Site|Action|Upload)$/.test(req.tool_name) ? input.site : undefined, label: req.tool_name === "BrowserAction" ? input.label : undefined,
      reads: req.tool_name === "BrowserSite" && input.reads ? true : undefined,   // (Kural's browser: the site, the button, reading only)
      allowLabel: input.device || req.unclassified || verdict.private ? undefined : allowLabel(req.tool_name) || undefined };
    if (turn) turn.reply.blocks.push(block);
    tab.status = "waiting";
    this.post({ type: "block", tabId: tab.id, block });
    this.postTabs();
    this.notify(tab, "permission", { tool: req.tool_name, detail: block.detail, where: block.where, site: block.site, label: block.label });
    const allow = await new Promise((resolve) => r.perms.set(pid, resolve));
    this.clearNotice(tab.id);
    if (allow) await prepareEdit();
    block.state = allow ? "allowed" : "denied";
    // (After Stop the answer is already over: don't flip the tab back to "running".)
    if (turn && turn.reply.running) tab.status = "running";
    this.post({ type: "permState", tabId: tab.id, pid, state: block.state });
    this.postTabs(); this.save();
    return allow ? { allow: true } : { allow: false, message: "The user chose not to run this. Continue without it or ask them." };
  }

  // "Allow all" ends (a mode or model change, a handoff). A device's own "Allow all" (allowAllDevice) ends with its link.
  revokeAllowAll(tab) {
    if (!allowedKinds(tab.allowAll).length && !tab.allowAllFor) return;
    tab.allowAll = false; delete tab.allowAllFor;
    log(`chat ${tab.id}: "Allow all" ended (mode, model or conversation changed)`);
  }

  // Does this chat's AI get Kural's browser? (Claude and Codex take Kural's MCP servers; setting kural.browser.aiControl.)
  browserOn(tab) {
    return !!this.browserAi && this.browserAi.available() && deviceOk(tab.model) && cfg().get("browser.aiControl") !== false && vscode.workspace.isTrusted !== false;
  }

  // The AI in Kural's browser (lib/browser/control.js asks): your mode decides, as for a command. req.kind:
  //   site     the first use of a site in this chat: reading it (Ask, Plan) or using it (Agent); Auto doesn't ask
  //   commit   Submit, Pay, Delete, Discard, Leave the page…: asks in Agent (Allow all browser actions covers it)
  //   upload   files for a page: like reading them, but only the project's (and attached ones) go without asking
  //   refused  Kural stopped something that publishes (it never happens, in any mode): you see that it tried
  async approveBrowser(tab, r, req) {
    if (req.kind === "refused") {
      log(`chat ${tab.id}: Kural stopped the AI before "${req.label}" on ${req.site} (it publishes)`);
      this.post({ type: "flash", text: `Kural stopped the AI before "${String(req.label || "").slice(0, 40)}" on ${req.site}: the AI never publishes` });
      return { allow: false };
    }
    if (!r.turn || !r.turn.reply.running) return { allow: false, message: "The answer was stopped." };
    const plain = tab.mode === "plan" || tab.mode === "ask";
    const site = String(req.site || "this page");
    if (req.kind === "site") {
      if (plain && !req.readOnly) return { allow: false, message: `${tab.mode === "plan" ? "Plan" : "Ask"} mode only reads pages: it doesn't click, type or go anywhere in the browser. Say what you'd do instead, or ask the user to switch to Agent mode.` };
      // Once per site in this chat (in this mode, with this model and conversation, like "Allow all").
      const said = tab.browserSites && tab.browserSites.key === grantKey(tab) ? tab.browserSites.sites : [];
      if (said.includes(site)) return { allow: true };
      const v = await this.onPermission(tab, r, { tool_name: "BrowserSite", input: { site, url: req.url, reads: plain } });
      if (v.allow) tab.browserSites = { key: grantKey(tab), sites: [...said, site] };
      return v;
    }
    if (req.kind === "commit") return this.onPermission(tab, r, { tool_name: "BrowserAction", input: { site, label: String(req.label || req.word || "") } });
    if (req.kind === "upload") {
      for (const f of req.files || []) {
        const v = await this.onPermission(tab, r, { tool_name: "BrowserUpload", input: { file_path: f, site } });
        if (!v.allow) return v;
      }
      return { allow: true };
    }
    return { allow: false, message: "Kural doesn't know this browser request." };
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
        // (Auto is unrestricted: a risky one runs too. Not a look into your private folders: that asks in Auto as well.)
        if (b.k !== "perm" || b.state !== "pending" || b.private) continue;
        const resolve = r.perms.get(b.pid);
        if (resolve) { r.perms.delete(b.pid); resolve(true); }
      }
    }
    const editing = (x) => agentLike(x) || x === "auto";
    // Gemini (Antigravity): its flags are fixed when it starts. Kural's gate stops approving anything for the agy that was
    // started for the old mode (so a late "yes" can't count under the new one); the new mode applies from the next message.
    if (engineOf(tab.model) === "agy") {
      if (r && r.proc && typeof r.proc.revokeGate === "function") r.proc.revokeGate();
      this.post({ type: "flash", text: "Gemini: nothing more runs in this answer; the new mode applies from your next message" });
    }
    else if (editing(was) !== editing(tab.mode)) this.post({ type: "flash", text: `${tab.mode === "plan" || tab.mode === "ask" ? "Read-only permissions apply now; tools refresh" : "Editing tools become available"} from your next message` });
    else if (tab.mode === "auto") this.post({ type: "flash", text: "Auto: commands run without asking from now on" });
    else if (tab.mode === "agent") this.post({ type: "flash", text: "Agent: Kural asks before the next command" });
    else if (tab.mode === "debug") this.post({ type: "flash", text: "Debug: Kural asks before the next command" });
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
    this.notify(tab, "question", { question: (questions[0] || {}).question });
    // The page answers { answers, note } (your picks, and a note from the chat box), { ask } (a question about the
    // question: the AI answers it, then asks again, changed if needed), or false (Skip).
    const got = await new Promise((resolve) => r.perms.set(pid, resolve));
    this.clearNotice(tab.id);
    const ask = got && typeof got === "object" && typeof got.ask === "string" && got.ask.trim() ? got.ask.trim().slice(0, 1000) : "";
    const picked = got && typeof got === "object" && !ask ? (got.answers && typeof got.answers === "object" ? got.answers : got) : null;
    const answers = ask ? { [(questions[0] || {}).question]: ASK_ANSWER(ask) } : picked ? withNote(picked, questions, got.note) : null;
    block.state = ask ? "asked" : answers ? "answered" : "skipped";
    block.answers = ask ? null : answers;
    if (ask) block.ask = ask;
    if (r.turn && r.turn.reply.running) tab.status = "running";
    this.post({ type: "questionState", tabId: tab.id, pid, state: block.state, answers: block.answers, ...(ask ? { ask } : {}) });
    this.postTabs(); this.save();
    return answers ? { allow: true, updatedInput: { ...input, answers } }
      : { allow: false, message: "The user skipped the question. Continue with your best judgment, and say what you assumed." };
  }

  // Parallel agents' plan (lib/split): a card with each agent's task and a model for it (your default picked); Go ahead,
  // what to change, or Stop. (Auto doesn't ask: it never gets here.) → { go, models } | { change } | { stop }.
  async askPlan(tab, r, plan) {
    const pid = shortId(), ids = new Set(plan.models.map((m) => m.id));
    const block = { k: "split", pid, summary: plan.summary, tasks: plan.tasks, models: plan.models, state: "pending" };
    if (r.turn) r.turn.reply.blocks.push(block);
    tab.status = "waiting";
    this.post({ type: "block", tabId: tab.id, block });
    this.postTabs();
    this.notify(tab, "question", { question: `Split the work between ${plan.tasks.length} agents?` });
    const got = await new Promise((resolve) => r.perms.set(pid, resolve));   // (Stop answers false)
    this.clearNotice(tab.id);
    let out;
    if (got && got.go) {
      const models = plan.tasks.map((t, i) => ids.has(got.models[i]) ? got.models[i] : t.model);
      block.tasks = plan.tasks.map((t, i) => ({ ...t, model: models[i] }));
      block.state = "approved"; out = { go: true, models };
    } else if (got && got.change) { block.change = String(got.change).trim().slice(0, 2000); block.state = "changed"; out = { change: block.change }; }
    else { block.state = "stopped"; out = { stop: true }; }
    if (r.turn && r.turn.reply.running) tab.status = "running";
    this.post({ type: "splitState", tabId: tab.id, pid, state: block.state, tasks: block.tasks, change: block.change });
    this.postTabs(); this.save();
    return out;
  }

  // A choice in the model menu changed (mood, parallel agents): kept for new chats, applied from the next message.
  afterChoice(tab) {
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

  // ---------- memory: idle chats' programs ----------
  // A chat that isn't on screen and has had no answer, agent, background command, queued message or question for IDLE_STOP_MS: its program
  // stops (Claude Code, Codex, Gemini or Kural's engine). Of the idle ones off screen, at most MAX_IDLE_WARM stay warm
  // (the most recently used). It starts again, in the same conversation, when you open the chat or send to it (1-2 s).
  stopIdle(now = Date.now()) {
    const idle = [];
    for (const t of this.tabs) {
      const r = this.runtime.get(t.id);
      if (!r || !r.proc || r.proc.exited || r.stale) continue;
      const busy = t.status !== "idle" || (r.turn && r.turn.reply && r.turn.reply.running) || (r.steers || []).length || (r.perms && r.perms.size) ||
        [...(r.agents || new Map()).values()].some((a) => a.state === "running") || (r.bg && r.bg.size) || this.routingJobs.has(t.id);
      if (busy || this.onScreen(t.id)) continue;
      idle.push({ t, r, at: r.lastUsed || r.started || 0 });
    }
    idle.sort((a, b) => b.at - a.at);
    idle.forEach(({ t, r, at }, i) => {
      if (now - at < IDLE_STOP_MS && i < MAX_IDLE_WARM) return;
      log(`chat ${t.id}: its ${engineOf(t.model)} program stops while the chat is idle and off screen (it starts again when needed)`);
      r.stale = true; r.proc.kill(); r.proc = null;
      this.endDevice(r);
    });
  }

  // ---------- system notifications ----------
  // A system notification about this chat (lib/chat/notify.js): when it's done or needs you, while you're not looking at
  // it (setting kural.notifications: whenAway, always, off). One per chat at a time; clicking it shows the chat.
  notify(tab, kind, info = {}) {
    try {
      const setting = cfg().get("notifications", "whenAway");
      // (Checked now, when the answer is done: not when it started.)
      const focused = !!(vscode.window.state && vscode.window.state.focused);
      const d = info.force ? { send: true, why: "test" } : notifyDecision(setting, { focused, onScreen: this.onScreen(tab.id) });
      if (!d.send) { log(`chat ${tab.id}: no notification (${kind}): ${d.why}`); return; }
      const { title, body } = notifyText(kind, { chat: tab.title, ...info });
      log(`chat ${tab.id}: notification (${kind}): ${title}; ${d.why}`);
      if (!this.notifier) { log("notify: no notifier"); return; }
      return Promise.resolve(this.notifier.show({ id: `kural-chat-${tab.id}`, title, body, attention: ["permission", "question", "login"].includes(kind), tabId: tab.id }, () => this.showChat(tab.id)))
        .then((route) => { log(`chat ${tab.id}: notification route: ${route}`); return route; });
    } catch (e) { log(`chat: notification failed: ${e.message}`); }
  }
  // "Kural: Test Notification": one now, whatever the focus, the same way; then says which way and where to allow it.
  async testNotification() {
    const tab = this.tab(this.activeId) || { id: "test", title: "Kural" };
    const route = await this.notify(tab, "done", { force: true, text: "This is a test notification." });
    const names = { card: "a card in your other Kural window", toast: "Kural's own notification", os: process.platform === "darwin" ? "the Mac's notification (shown as Script Editor)" : "the system's notification command", app: "a message inside the Kural window", none: "nothing (every way failed; see Kural: Show Log)" };
    const mac = process.platform === "darwin" ? " If nothing appeared on screen: System Settings → Notifications → allow Script Editor (and Kural), and check that Focus / Do Not Disturb is off. (Clicking a Mac notification opens Script Editor, not the chat.)" : "";
    const linux = process.platform === "linux" ? " If nothing appeared: check that a notification service is running and that notify-send is installed (libnotify-bin)." : "";
    vscode.window.showInformationMessage(`Test notification sent through ${names[route] || route}.${mac}${linux}`);
  }
  clearNotice(id) { if (this.notifier) this.notifier.clear(`kural-chat-${id}`); }
  // Is this chat on screen: a pane shows it and that pane is visible (the side panel open, its editor in view).
  onScreen(id) {
    return this.panes.some((p) => p.activeId === id && (p.view ? p.view.visible !== false : p.panel ? p.panel.visible !== false : true));
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
        if (pane.col && !this.tab(pane.activeId)) { this.closeColumn(pane); break; }   // (its chat was closed meanwhile)
        if (!this.tab(pane.activeId)) pane.activeId = (this.tab(this._activeId) || this.tabs[0] || this.newTab(false)).id;
        const w = pane.webview, t = this.tab(pane.activeId);
        w.postMessage({ type: "config", models: MODELS, efforts: EFFORTS, modes: MODES,
          moods: allMoods(), shortcuts: userShortcuts(), version: this.version, ready: this.isReady(), claudeReady: isSetUp(), clis: this.cliInfo(), pics: this.filesFor(w) });
        w.postMessage(this.tabsFor(pane));
        w.postMessage({ type: "full", tab: this.viewTab(t) });
        if (t.setup) w.postMessage({ type: "setup", tabId: t.id, setup: { ...t.setup, jira: atlassianState(t.setup) } });
        pane.ready = true;
        for (const q of pane.queue.splice(0)) w.postMessage(q);
        // The side panel's page (re)loaded: its columns start again in it (each says "ready" in turn). (Also with one
        // column: "cols" tells the page it may split.)
        if (pane.layout) {
          for (const c of pane.layout) if (c !== pane) { c.ready = false; c.queue = []; }
          this.postCols(pane);
        }
        this.postHistory();
        this.sendFiles();
        this.warm(t);
        break;
      }
      case "log": log(`chat panel: ${m.message}`); break;
      case "focusChanged": this.chatFocused = !!m.focused; vscode.commands.executeCommand("setContext", "kural.chatFocused", !!m.focused); break;
      case "newTab": this.newTab(true); break;
      case "switchTab": this.activate(m.id, pane); break;
      // Chats side by side in the side panel (media/chat-columns.js).
      case "splitChat": this.splitChat(pane, !!m.inPanel); break;
      case "dropTab": if (typeof m.id === "string") this.dropTab(pane, m); break;
      case "closeColumn": if (pane && pane.col) this.closeColumn(pane); break;
      case "colSizes": if (pane && pane.layout && Array.isArray(m.sizes)) {
        for (const s of m.sizes) { const c = pane.layout.find((p) => (p.col || 0) === s.col); if (c && s.size > 0 && s.size < 100) c.size = s.size; }
        this.save();
        break;
      }
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
        Number.isInteger(m.editIndex) ? m.editIndex : null, Array.isArray(m.picks) ? m.picks : []); break;
      // Side chat (lib/chat/side.js): a quick question under an answer. Never a turn of the chat: no status, no journal.
      case "sideAsk": if (tab && Number.isInteger(m.index)) this.sideChats.ask(tab, m); break;
      case "enhance": if (tab) this.enhance(tab, m); break;
      case "enhanceStop": if (tab) this.stopEnhance(tab.id); break;
      // Voice input (lib/voice): the mic beside the wand.
      case "voiceStart": if (tab && !tab.visiting) await this.voice.start(tab.id); break;
      case "voiceDownload": if (tab) this.voice.download(tab.id); break;
      case "voiceDownloadStop": this.voice.stopDownload(); break;
      case "voiceChunk": if (tab && Number.isInteger(m.seq)) this.voice.chunk(tab.id, m.seq, m.samples); break;
      case "voiceStop": if (tab) this.voice.finish(tab.id); break;
      case "voiceCancel": if (tab) this.voice.cancel(tab.id); break;
      case "listenWarm": this.listen.warm(); break;
      case "listenStart": if (tab && pane && Number.isInteger(m.index) && Array.isArray(m.blocks)) await this.listen.start(pane, tab, m.index, m.blocks.slice(0, 400)); break;
      case "listenStop": if (tab && Number.isInteger(m.index)) this.listen.stop(tab.id, m.index); break;
      case "listenDownload": if (tab && pane) this.listen.download(pane, tab); break;
      case "listenDownloadStop": this.listen.stopDownload(); break;
      case "listenSpeed": if (tab) this.listen.setSpeed(tab.id, m.index, m.speed, m.from); break;
      case "sideStop": if (tab && typeof m.thread === "string") this.sideChats.stop(tab.id, m.thread); break;
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
        // Unlinked (or another device) mid-answer: the running model loses the device at once, not at the next message
        // (not the browser: endDevice(run, false)).
        const run = this.runtime.get(tab.id);
        if (run && run.deviceDevice !== tab.device) this.endDevice(run, false);
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
      case "savePlan": if (tab) await this.savePlan(tab, m.msgIndex); break;
      case "finishAgents": if (tab) this.finishAgents(tab); break;
      case "stop": {
        const stopping = this.runtime.get(tab.id); if (stopping) { stopping.userStopped = true; delete stopping.usageHandoff; }
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
        if (m.model !== was) this.revokeAllowAll(tab);
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
      // The gear beside an AI's name in the model menu: its settings (Kural Settings on its card; Auto: the Model Router).
      case "aiSettings":
        if (m.ai === "router") vscode.commands.executeCommand("kural.modelRouter");
        else if (["claude", "codex", "agy", "local"].includes(m.ai)) vscode.commands.executeCommand("kural.account", m.ai);
        break;
      case "showUsage": vscode.commands.executeCommand("kural.showUsage"); break;
      // The tab line's gear and "…" menu (they were in the panel's title bar).
      case "panelCommand": {
        const id = { settings: "kural.account", getStarted: "kural.getStarted", updates: "kural.checkForUpdates", whatsNew: "kural.whatsNew" }[m.what];
        if (id) vscode.commands.executeCommand(id);
        break;
      }
      case "setEffort": if (valid(EFFORTS, m.effort)) {
        tab.effort = m.effort; tab.effortPinned = !!tab.autoRoute; this.remember(tab); this.postTabs(); this.save();
        if (tab.status === "idle") this.warm(tab);
        else this.post({ type: "flash", text: "Intensity applies from your next message" });   // set when Claude starts
      } break;
      case "setMode": if (valid(MODES, m.mode)) {
        // The first switch to Auto with this AI: say what it means, once per AI (what still asks differs: autoWarning).
        // (Older versions saved `true`: that covered every AI but Gemini, whose gate is new.)
        const engine = engineOf(tab.model), warned = this.context.globalState.get(AUTO_WARNED);
        const seen = warned === true ? { claude: true, codex: true, ollama: true } : (warned && typeof warned === "object" ? warned : {});
        if (m.mode === "auto" && tab.mode !== "auto" && !seen[engine]) {
          const pick = await vscode.window.showWarningMessage(autoWarning(engine, isClaude(tab.model) && fullSetup()), { modal: true }, "Use Auto");
          if (pick !== "Use Auto") { this.postTabs(); break; }   // (the page goes back to the mode the tab has)
          await this.context.globalState.update(AUTO_WARNED, { ...seen, [engine]: true });
        }
        const was = tab.mode;
        tab.mode = m.mode; this.remember(tab);
        if (m.mode !== was) this.revokeAllowAll(tab);
        if (tab.status !== "idle") this.modeChangedMidAnswer(tab, was);
        this.postTabs(); this.save(); if (tab.status === "idle") this.warm(tab);
      } break;
      case "setMood": if (valid(allMoods(), m.mood)) { tab.mood = m.mood; this.afterChoice(tab); } break;
      // "Add your own mood…" in the model menu: Kural Settings, at Moods (lib/settings-page.js).
      case "editMoods": vscode.commands.executeCommand("kural.settings.moods"); break;
      case "editShortcuts": vscode.commands.executeCommand("kural.settings.shortcuts"); break;
      case "reloadSetup": this.setupChanged("reload asked for"); break;
      case "getStarted": vscode.commands.executeCommand("kural.getStarted", m.path); break;
      case "useFullSetup":
        await cfg().update("chat.fullClaudeCodeSetup", !!m.on, vscode.ConfigurationTarget.Global);
        this.setupChanged(m.on ? "switched to your full setup" : "switched to the minimal setup");
        break;
      // Parallel agents (model menu): on or off, and the agents' default model for this chat's AI.
      case "setSplit": tab.split = !!m.on; this.afterChoice(tab); break;
      case "setWorkers": if (typeof m.model === "string" && this.workerModels(tab).some((x) => x.id === m.model)) {
        tab.workers = { ...(tab.workers || {}), [engineOf(tab.model)]: m.model }; this.afterChoice(tab);
      } break;
      case "permission": {
        const r = this.runtime.get(tab.id);
        if (m.always) {
          const b = r && r.turn && r.turn.reply.blocks.find((x) => x.k === "perm" && x.pid === m.pid);
          const kind = b && allowKind(b.tool);
          if (b && b.where) tab.allowAllDevice = tab.device;   // only this device, only while it's linked
          // Only the card's kind (commands, web, one connector), for this mode, model and conversation (allowAllNow).
          else if (b && b.allowLabel && kind) {
            const now = allowAllNow(tab);
            tab.allowAll = [...new Set([...now, kind])]; tab.allowAllFor = grantKey(tab);
            this.post({ type: "allowAll", tabId: tab.id });
          }
        }
        const res = r && r.perms.get(m.pid);
        if (res) { r.perms.delete(m.pid); res(!!m.allow); }
        break;
      }
      case "answer": {
        const r = this.runtime.get(tab.id);
        const res = r && r.perms.get(m.pid);
        if (res) {
          r.perms.delete(m.pid);
          res(typeof m.ask === "string" && m.ask.trim() ? { ask: m.ask }
            : m.answers && typeof m.answers === "object" ? { answers: m.answers, note: typeof m.note === "string" ? m.note : "" } : false);
        }
        break;
      }
      // The parallel agents' plan card: Go ahead (a model per agent), what to change, or Stop.
      case "splitAnswer": {
        const r = this.runtime.get(tab.id);
        const res = r && r.perms.get(m.pid);
        if (res) {
          r.perms.delete(m.pid);
          res(m.go ? { go: true, models: Array.isArray(m.models) ? m.models.map(String) : [] }
            : typeof m.change === "string" && m.change.trim() ? { change: m.change } : false);
        }
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
      // A shell command goes to the terminal (typed, not run: you press Enter), not into the open file.
      case "terminal": {
        const term = vscode.window.activeTerminal || vscode.window.createTerminal({ cwd: ws.root() || ws.workDir() });
        term.show();
        term.sendText(String(m.code || "").replace(/\s+$/, ""), false);
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

  // Fix with Kural (lib/fix) and Agent Review's "Fix in Chat" (command kural.chat.addContext): a problem, a failed terminal
  // command or a review finding becomes a pill in the message you're writing, with a first line ("Fix this."). The chat
  // comes on screen first. It is never sent by itself: you read it and press Send.
  async addProblem({ label, text, source, prompt } = {}) {
    await this.reveal();
    const pane = this.cur();
    if (!pane || !String(text || "").trim()) return;
    const line = String(label || text).replace(/\s+/g, " ").trim();
    const ctx = { kind: "quote", source: source || "problem", text: String(text), label: line.length > 40 ? `${line.slice(0, 40).trimEnd()}…` : line };
    this.postTo(pane, { type: "insertPill", ctx, text: prompt ? ` ${prompt}` : "" });
    vscode.window.setStatusBarMessage("Kural: added to the chat. Press Send when you're ready", 3000);
  }

  // "Add to chat" on a lesson page (lib/learn): what you selected, or a visual you clicked, becomes a pill in that chat's
  // message box (the chat comes on screen first). Nothing goes to the AI until you send. false: no such chat any more.
  async addLessonItem(id, item) {
    const tab = this.tab(id);
    if (!tab) return false;
    await this.showChat(id);
    const pane = this.panes.find((p) => p.activeId === id) || this.cur();
    if (!pane) return false;
    const line = String(item.concept || item.text || "").split("\n").map((l) => l.trim()).find(Boolean) || "lesson";
    const ctx = { kind: "quote", source: "lesson", text: item.text || "", concept: item.concept || "", slide: item.slide || null, title: item.title || "",
      label: line.length > 40 ? `${line.slice(0, 40).trimEnd()}…` : line };
    this.postTo(pane, { type: "insertPill", ctx });
    vscode.window.setStatusBarMessage("Kural: added part of the lesson to the chat", 3000);
    return true;
  }
  // This chat on screen, in its own editor or the side panel: a clicked notification, a lesson beside it, another window's request
  // (the Projects bar). It's the one place that shows a chat, so it's also where "unseen" ends.
  async showChat(id) {
    if (!this.tab(id)) return;
    const own = this.panes.find((p) => p.single && p.activeId === id);
    if (own && own.panel) { own.panel.reveal(undefined, true); this.markSeen(id); return; }
    // (Not shown anywhere yet: the side panel takes it. In a column of the side panel it's there already.)
    if (!own && !this.shown(id)) this.activate(id, this.side() || this.cur());
    await vscode.commands.executeCommand("kural.chat.focus");
    if (own) this.postTo(own, { type: "focus" });
    this.markSeen(id);
  }
  // The chat shows in the editor area (dragged out of the panel): a lesson opens beside it instead of over it.
  inEditor(id) { return this.panes.some((p) => p.single && p.activeId === id && !!p.panel); }

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
    // (A diagram from the chat (media/mermaid-view.js) is an SVG data: address: a picture, nothing in it runs.)
    const diagram = /^data:image\/svg\+xml[;,]/.test(url || "");
    if (!diagram && !/^https:\/\//.test(url || "")) return;
    const panel = vscode.window.createWebviewPanel("kural.picture", diagram ? "Diagram" : "Picture", vscode.ViewColumn.Active, { enableScripts: false });
    const safe = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    panel.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${diagram ? "data:" : "https:"}; style-src 'unsafe-inline';">
<style>html,body{height:100%;margin:0;background:var(--vscode-editor-background)}body{display:grid;place-items:center}img{max-width:100%;max-height:100vh;object-fit:contain}${diagram ? "img{width:100%;height:100vh;padding:24px;box-sizing:border-box}" : ""}</style>
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

// An answer's own words (its text after the last step), for a notification.
function answerText(reply) {
  const texts = (reply.blocks || []).filter((b) => b.k === "text" && String(b.text || "").trim());
  return texts.length ? texts[texts.length - 1].text : "";
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
    case "Kural": return input.detail || "";   // (a step of Kural's own: parallel agents merging their work)
    default: return name.startsWith(`mcp__${BROWSER_SERVER}__`) ? browserDetail(name.slice(`mcp__${BROWSER_SERVER}__`.length), input) : "";
  }
}
const lines = (s) => (s ? String(s).split("\n").length : 0);
// A step in Kural's browser, after its verb (media/chat.js BROWSER_VERB): "Clicked" + "Next", "Typed" + "Morning run".
function browserDetail(tool, i) {
  const short = (s, n = 70) => { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const at = i.element ? short(i.element) : i.ref ? i.ref : i.x !== undefined ? `${Math.round(i.x)}, ${Math.round(i.y)}` : "";
  switch (tool) {
    case "open": return short(i.url, 90);
    case "navigate": return i.url ? short(i.url, 90) : i.back ? "back" : i.forward ? "forward" : "reload";
    case "snapshot": return i.find ? `looking for "${short(i.find, 40)}"` : "";
    case "click": return at;
    case "type": return `"${short(i.text, 50)}"${i.ref ? ` in ${i.ref}` : ""}`;
    case "press": return `${short(i.key, 30)}${i.ref ? ` on ${i.ref}` : ""}`;
    case "select": return (Array.isArray(i.values) ? i.values : [i.values]).map((v) => `"${short(v, 30)}"`).join(", ");
    case "upload": return (Array.isArray(i.files) ? i.files : [i.files]).filter(Boolean).map((f) => path.basename(String(f))).join(", ");
    case "drag": return at;
    case "scroll": return Number(i.dy) < 0 ? "up" : "down";
    case "wait": return i.text ? `for "${short(i.text, 40)}"` : i.gone ? `until "${short(i.gone, 40)}" is gone` : `${Number(i.seconds) || 2} s`;
    case "dialog": return i.accept ? "OK" : "Cancel";
    default: return "";
  }
}


function permDetail(tool, input) {
  if (tool === "Bash") return input.command || "";
  if (tool === "DeviceCommand") return input.command || "";
  if (tool === "DeviceWrite") return `${input.path || ""}\n\n${String(input.content || "").slice(0, 600)}${String(input.content || "").length > 600 ? "\n…" : ""}`;
  if (tool === "WebFetch") return input.url || "";
  // Kural's browser.
  if (tool === "BrowserSite") return `${input.url || input.site || ""}\n\n${input.reads ? "It can read this site's pages (Ask and Plan only read)." :
    "It can read this site's pages and click and type there, with your login."} Kural never lets it publish, post, share or send anything.`;
  if (tool === "BrowserAction") return `"${input.label || ""}" on ${input.site || "the page"}\n\nThis can send a form or change something on the site.`;
  if (tool === "BrowserUpload") return `${input.file_path || ""}\n(from outside this project) → ${input.site || "the page"}`;
  if (EDIT_TOOLS.has(tool)) {
    const f = input.file_path || input.notebook_path || "";
    return `${f}\n${runsLater(f) ? "This file can make your computer run something later." : "(outside this project)"}`;
  }
  if (READ_TOOLS.includes(tool)) return `${input.file_path || input.path || ""}\n(outside this project)`;
  return JSON.stringify(input).slice(0, 300);
}

// Your full Claude Code setup (your MCP servers, hooks, skills, and the project's .claude settings) only in a folder
// you trust: a project's own .claude/settings.json can run commands (hooks), and Kural starts Claude early.
function fullSetup() { return !!cfg().get("chat.fullClaudeCodeSetup") && vscode.workspace.isTrusted; }
// Your own moods, from your user settings only (never a project's: their instructions go into the AI's prompt).
function userMoods() { const c = cfg(), i = typeof c.inspect === "function" ? c.inspect("chat.moods") : null; return i ? i.globalValue : undefined; }
// Your shortcuts (Kural Settings → Shortcuts), from your user settings only too: their text goes to the AI.
function userShortcuts() { const c = cfg(), i = typeof c.inspect === "function" ? c.inspect("chat.shortcuts") : null; return shortcuts.clean(i ? i.globalValue : undefined); }
// Built-in moods you removed from the menu (Kural Settings → Moods): user settings only too.
function hiddenMoods() { const c = cfg(), i = typeof c.inspect === "function" ? c.inspect("chat.hiddenMoods") : null; return i ? i.globalValue : undefined; }
// The moods in the model menu: the built-in ones you kept, then yours (prompts.js shownMoods, customMoods).
function allMoods() {
  const mine = customMoods(userMoods());
  return [...shownMoods(hiddenMoods(), mine), ...mine.map(({ id, label, hint, custom }) => ({ id, label, hint, custom }))];
}
// The mood for a chat whose own is gone: the first in the menu (shownMoods keeps at least one).
function firstMood() { return allMoods()[0].id; }

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

module.exports = { ChatView, MODELS, EFFORTS, MODES, _test: { PROMPTS, MOOD_PROMPTS, toolDetail, settingMode } };
