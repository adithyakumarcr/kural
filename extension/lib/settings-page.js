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

class SettingsPage {
  constructor(context, account, getStarted) {
    this.context = context;
    this.account = account;
    this.gs = getStarted;
    this.panel = null;
    this.checking = false;
    this.refreshing = false;
  }

  register() {
    this.account.onChange(() => this.push());
    this.gs.onChange(() => this.push());
    this.context.subscriptions.push(usage.onChange(() => this.push()));
  }

  async open() {
    if (this.panel) { this.panel.reveal(); }
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
      autoUpdates: vscode.workspace.getConfiguration("kural").get("updates.autoCheck") !== false };
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
      case "usagePanel": vscode.commands.executeCommand("kural.showUsage"); break;
      case "log": vscode.commands.executeCommand("kural.showLog"); break;
      case "allSettings": vscode.commands.executeCommand("workbench.action.openSettings", "@ext:kural.kural"); break;
      case "guide": open(WIKI); break;
      case "feature": open(ISSUES); break;
      case "exportSettings": vscode.commands.executeCommand("kural.settings.export"); break;
      case "crashes": vscode.commands.executeCommand("kural.showCrashReports"); break;
      case "importSettings": vscode.commands.executeCommand("kural.settings.import"); break;
    }
  }
}

module.exports = { SettingsPage };
