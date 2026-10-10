// Kural Settings: an editor tab with everything the Account menu had (it had grown into a long pop-up list). One card
// per AI (Claude, Google Gemini, ChatGPT (Codex), your own model): who's logged in, plan, each usage limit with a bar,
// and its buttons (usage page, switch account, log out / log in / set up). Below: Kural itself (version and updates,
// Get started, Tab Completion, the log, the guide, asking for a feature). Opened by the person icon in the status bar,
// the Chat panel's ... menu and "Kural: Settings". The work itself stays in lib/account.js and lib/getstarted.js.

const vscode = require("vscode");
const usage = require("./ai/usage");
const brain = require("./ai");
const { CLIS, IDS: CLI_IDS } = require("./ai/clis");
const { WIKI, ISSUES } = require("./chat/guide");
const { fontScale } = require("./ui");
const { versionLabel } = require("./version");
const { USAGE } = require("./account");
const { MOODS, MOOD_EXAMPLES, MOOD_LIMITS, customMoods, moodId } = require("./chat/prompts");
const usageSwitch = require("./ai/usage-switch");
const connectors = require("./ai/connectors");

// Your own moods: the user setting kural.chat.moods (never a project's).
const userMoods = () => { const i = vscode.workspace.getConfiguration("kural").inspect("chat.moods"); return customMoods(i ? i.globalValue : undefined); };
const saveMoods = (list) => vscode.workspace.getConfiguration("kural").update("chat.moods",
  list.map((m) => ({ id: m.id, name: m.label, hint: m.hint, instructions: m.instructions })), vscode.ConfigurationTarget.Global);
// Built-in moods removed from the chat's menu (kural.chat.hiddenMoods): their ids, in the built-in order.
const hiddenMoods = () => {
  const i = vscode.workspace.getConfiguration("kural").inspect("chat.hiddenMoods"), v = i && Array.isArray(i.globalValue) ? i.globalValue : [];
  return MOODS.map((m) => m.id).filter((id) => v.includes(id));
};

class SettingsPage {
  constructor(context, account, getStarted) {
    this.context = context;
    this.account = account;
    this.gs = getStarted;
    this.panel = null;
    this.checking = false;
    this.refreshing = false;
    this.conn = {};       // ai -> { loading, servers, error, supported, at, busy, message }
    this.chat = null;     // (set by extension.js: Claude's setup is reloaded through the chat)
  }

  // Each AI's program and the environment to run it in (for its connectors).
  program(id) {
    if (id === "claude") { const c = require("./ai/claude"); return { bin: c.findClaude(), env: c.cleanEnv() }; }
    return { bin: brain.cli && brain.cli[id] ? brain.cli[id].bin : null, env: process.env };
  }
  // List an AI's connectors (asked when its card shows; Claude checks each one, which takes a few seconds).
  async loadConnectors(id, force) {
    if (!connectors.SUPPORTED[id]) return;
    const c = this.conn[id] || (this.conn[id] = {});
    if (c.loading || (!force && c.at && Date.now() - c.at < 60000)) return;
    c.loading = true; this.push();
    try { const { bin, env } = this.program(id); Object.assign(c, await connectors.list(id, bin, env), { at: Date.now() }); }
    finally { c.loading = false; this.push(); }
  }
  // After a connector was added or removed: Claude's chats start again with it (same conversations); Codex reads its
  // settings when it starts, so the next Codex chat has it.
  afterConnectorChange(id) {
    if (id === "claude" && this.chat) this.chat.setupChanged("connectors changed");
    this.loadConnectors(id, true);
  }

  register() {
    this.account.onChange(() => this.push());
    this.gs.onChange(() => this.push());
    this.context.subscriptions.push(usage.onChange(() => this.push()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (["kural.chat.moods", "kural.chat.hiddenMoods", "kural.usageSwitch", "kural.chat.fullClaudeCodeSetup"].some((k) => e.affectsConfiguration(k))) this.push();
      }));
  }

  // section: Moods from the chat's model menu; usage controls from the AI Usage panel.
  async open(section) {
    this.section = section || null;
    if (this.panel) { this.panel.reveal(); if (section) this.panel.webview.postMessage({ type: "show", section }); }
    else {
      const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
      const p = this.panel = vscode.window.createWebviewPanel("kural.settings", "Kural Settings", vscode.ViewColumn.Active,
        { enableScripts: true, localResourceRoots: [media], retainContextWhenHidden: false });
      p.iconPath = vscode.Uri.joinPath(media, "chat-icon.svg");
      const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      const uri = (f) => p.webview.asWebviewUri(vscode.Uri.joinPath(media, f));
      p.webview.html = `<!doctype html><html data-fs="${fontScale()}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${p.webview.cspSource}; font-src ${p.webview.cspSource}; img-src ${p.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${uri("codicons/codicon.css")}"><link rel="stylesheet" href="${uri("settings.css")}"></head>
<body><div id="app"></div><script nonce="${nonce}" src="${uri("settings.js")}"></script></body></html>`;
      p.webview.onDidReceiveMessage((m) => this.onMessage(m).catch((e) => vscode.window.showErrorMessage(`Kural: ${e.message}`)));
      p.onDidChangeViewState(() => { if (p.visible) this.push(); });
      p.onDidDispose(() => { this.panel = null; });
    }
    // Who's logged in, asked fresh (the page shows the last answer meanwhile).
    this.loading = true; this.push();
    await this.account.update().catch(() => {});
    this.loading = false; this.push();
  }

  state() {
    const a = this.account.auth;
    const limits = (id) => {
      const u = usage.current(id);
      return {
        at: u ? u.at : null,
        windows: u ? (u.windows || []).map((w) => ({ name: usage.limitName(w), used: Math.round(w.usedPercent), resetsAt: w.resetsAt || null, reset: !!w.reset })) : [],
        tokens: u && u.tokens && (u.tokens.input || u.tokens.output) ? { input: u.tokens.input, output: u.tokens.output } : null,
      };
    };
    const cards = [];
    // Claude
    const claude = { id: "claude", name: "Claude", what: "Claude's models with your Claude plan, through Claude Code.", ...limits("claude") };
    if (!this.gs.passed) claude.state = "off";
    else if (a && a.loggedIn) {
      Object.assign(claude, { state: "on", who: a.name || a.email || a.method || "Logged in", email: a.name ? a.email : "", plan: [a.plan && `Claude ${a.plan}`, a.org].filter(Boolean).join(" · "),
        note: a.provider !== "firstParty" || a.apiKey ? `Logged in with ${a.method}` : "", page: a.provider === "firstParty" ? (a.apiKey ? USAGE.apiKey : USAGE.claude) : "" });
    } else if (a && a.loggedIn === false) claude.state = "out";
    else claude.state = "set";   // (this Claude Code can't say who's logged in)
    cards.push(claude);
    // Google Gemini, ChatGPT (Codex)
    for (const id of CLI_IDS) {
      const C = CLIS[id], c = this.account.cliAuth[id];
      const card = { id, name: C.label, what: C.what, ...limits(id) };
      if (!this.gs.cliReady(id)) card.state = "off";
      else if (c && c.loggedIn) Object.assign(card, { state: "on", who: c.name || c.email || c.method || "Logged in", email: c.name ? c.email : "", plan: [c.plan, c.email ? c.method : ""].filter(Boolean).join(" · "), page: C.usageUrl });
      else if (c && c.loggedIn === false) card.state = "out";
      else card.state = "set";
      cards.push(card);
    }
    // Your own model
    const local = this.gs.localModel;
    cards.push({ id: "local", name: "Your own model", what: "A model on this computer, with Ollama. Works offline, no account.",
      state: local ? "on" : "off", who: local ? local.slice("ollama:".length) : "", plan: local ? "on this computer" : "", windows: [], tokens: null });
    const engine = (() => { try { return brain.engineOf(brain.currentModel()); } catch { return null; } })();
    return { type: "state", cards, loading: !!this.loading, refreshing: this.refreshing, checking: this.checking, chatAI: engine === "ollama" ? "local" : engine,
      version: versionLabel(this.context.extensionPath, this.context.extension.packageJSON.version),
      autoUpdates: vscode.workspace.getConfiguration("kural").get("updates.autoCheck") !== false,
      usageSwitch: usageSwitch.options(vscode.workspace.getConfiguration("kural")),
      connectors: Object.fromEntries(["claude", ...CLI_IDS, "local"].map((id) => [id, connectors.SUPPORTED[id] ? { supported: true, ...(this.conn[id] || {}) } : { supported: false }])),
      fullSetup: vscode.workspace.getConfiguration("kural").get("chat.fullClaudeCodeSetup") !== false,
      moods: { builtIn: MOODS.map(({ id, label, hint }) => ({ id, label, hint })), hidden: hiddenMoods(), mine: userMoods(), examples: MOOD_EXAMPLES, limits: MOOD_LIMITS },
      section: this.section || null };
  }

  // Add or change one of your moods ({ id?, name, hint, instructions }); returns an error to show, or "".
  async saveMood(m) {
    const name = String((m && m.name) || "").replace(/\s+/g, " ").trim(), instructions = String((m && m.instructions) || "").trim();
    if (!name) return "Give the mood a name.";
    if (!instructions) return "Write what the AI should do in this mood.";
    if (name.length > MOOD_LIMITS.name) return `Keep the name to ${MOOD_LIMITS.name} characters.`;
    if (instructions.length > MOOD_LIMITS.instructions) return `Keep the instructions to ${MOOD_LIMITS.instructions} characters: a few sentences work best.`;
    const list = userMoods(), others = list.filter((x) => x.id !== m.id);
    if ([...MOODS, ...others].some((x) => x.label.toLowerCase() === name.toLowerCase())) return `There's already a mood called ${name}.`;
    const mood = { id: m.id && list.some((x) => x.id === m.id) ? m.id : null, label: name, hint: String(m.hint || "").replace(/\s+/g, " ").trim().slice(0, MOOD_LIMITS.hint), instructions };
    if (!mood.id) {   // a new one: an id from its name ("custom-pair-programmer"), kept when you rename it later
      const base = moodId(name);
      let id = base;
      for (let n = 2; list.some((x) => x.id === id); n++) id = `${base}-${n}`;
      mood.id = id;
    }
    const next = list.some((x) => x.id === mood.id) ? list.map((x) => x.id === mood.id ? mood : x) : [...list, mood];
    await saveMoods(next);
    return "";
  }

  // Remove a built-in mood from the chat's menu, or bring it back. The last mood left can't be removed.
  async hideMood(id, hidden) {
    if (!MOODS.some((x) => x.id === id)) return;
    const now = new Set(hiddenMoods());
    if (hidden) now.add(id); else now.delete(id);
    if (now.size === MOODS.length && !userMoods().length) return;
    await vscode.workspace.getConfiguration("kural").update("chat.hiddenMoods", MOODS.map((x) => x.id).filter((x) => now.has(x)), vscode.ConfigurationTarget.Global);
  }

  push() { if (this.panel) this.panel.webview.postMessage(this.state()); }

  async onMessage(m) {
    const a = this.account, open = (url) => /^https:\/\//.test(url || "") && vscode.env.openExternal(vscode.Uri.parse(url));
    switch (m.type) {
      case "ready": this.push(); break;
      case "setUp": this.gs.open(m.id === "claude" ? "claude" : m.id); break;
      case "logIn": if (m.id === "claude") this.gs.signIn(); else this.gs.signInCli(m.id); break;
      case "logOut": if (m.id === "claude") await a.logOut(); else await a.logOutCli(m.id); break;
      case "switch": if (m.id === "claude") await a.switchAccount(); else await a.switchCli(m.id); break;
      case "usagePage": { const c = this.state().cards.find((x) => x.id === m.id); if (c) open(c.page); break; }
      case "refresh":
        if (this.refreshing) break;
        this.refreshing = true; this.push();
        try { await a.refreshUsage(true); await a.update(); } finally { this.refreshing = false; this.push(); }
        break;
      case "updates":
        this.checking = true; this.push();
        try { await vscode.commands.executeCommand("kural.checkForUpdates"); } finally { this.checking = false; this.push(); }
        break;
      case "autoUpdates": await vscode.workspace.getConfiguration("kural").update("updates.autoCheck", !!m.value, vscode.ConfigurationTarget.Global); this.push(); break;
      case "getStarted": this.gs.open(); break;
      case "tab": vscode.commands.executeCommand("kural.tabPanel.focus"); break;
      case "router": vscode.commands.executeCommand("kural.modelRouter"); break;
      case "findModels": vscode.commands.executeCommand("kural.findModels"); break;
      case "connectors": await this.loadConnectors(m.id, !!m.force); break;
      case "addConnector": case "removeConnector": {
        const c = this.conn[m.id] || (this.conn[m.id] = {});
        if (c.busy) break;
        c.busy = true; c.message = ""; this.push();
        let r;
        try {
          const { bin, env } = this.program(m.id);
          r = m.type === "addConnector" ? await connectors.add(m.id, bin, env, m.connector || {}) : await connectors.remove(m.id, bin, env, m.name);
        } finally { c.busy = false; }
        if (this.panel) this.panel.webview.postMessage({ type: "connectorDone", id: m.id, reqId: m.reqId, error: r.error || "" });
        if (r.ok) this.afterConnectorChange(m.id); else this.push();
        break;
      }
      case "fullSetup":
        await vscode.workspace.getConfiguration("kural").update("chat.fullClaudeCodeSetup", !!m.on, vscode.ConfigurationTarget.Global);
        if (this.chat) this.chat.setupChanged(m.on ? "switched to your full setup" : "switched to the minimal setup");
        this.push();
        break;
      case "reloadSetup": if (this.chat) this.chat.setupChanged("reload asked for"); this.loadConnectors("claude", true); break;
      case "usagePanel": vscode.commands.executeCommand("kural.showUsage"); break;
      case "usageSwitch": {
        const c = vscode.workspace.getConfiguration("kural");
        if (typeof m.enabled === "boolean") await c.update("usageSwitch.enabled", m.enabled, vscode.ConfigurationTarget.Global);
        if (typeof m.threshold === "number" && Number.isInteger(m.threshold) && m.threshold >= 1 && m.threshold <= 99)
          await c.update("usageSwitch.threshold", m.threshold, vscode.ConfigurationTarget.Global);
        // One AI's switch point: { ai, which: "session" | "weekly", value }.
        if (usageSwitch.AIS.includes(m.ai) && ["session", "weekly"].includes(m.which) && Number.isInteger(m.value) && m.value >= 1 && m.value <= 99) {
          const i = c.inspect("usageSwitch.limits"), now = i && i.globalValue && typeof i.globalValue === "object" ? i.globalValue : {};
          await c.update("usageSwitch.limits", { ...now, [m.ai]: { ...(now[m.ai] || {}), [m.which]: m.value } }, vscode.ConfigurationTarget.Global);
        }
        this.push();
        break;
      }
      case "log": vscode.commands.executeCommand("kural.showLog"); break;
      case "allSettings": vscode.commands.executeCommand("workbench.action.openSettings", "@ext:kural.kural"); break;
      case "guide": open(WIKI); break;
      case "feature": open(ISSUES); break;
      case "exportSettings": vscode.commands.executeCommand("kural.settings.export"); break;
      case "crashes": vscode.commands.executeCommand("kural.showCrashReports"); break;
      case "importSettings": vscode.commands.executeCommand("kural.settings.import"); break;
      case "saveMood": {
        const error = await this.saveMood(m.mood || {});
        if (this.panel) this.panel.webview.postMessage({ type: "moodSaved", reqId: m.reqId, error });
        this.push();
        break;
      }
      case "deleteMood": await saveMoods(userMoods().filter((x) => x.id !== m.id)); this.push(); break;
      case "hideMood": await this.hideMood(m.id, !!m.hidden); this.push(); break;
      case "shown": this.section = null; break;   // (the page scrolled to the section it was asked to show)
    }
  }
}

module.exports = { SettingsPage };
