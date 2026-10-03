// Get started: what Kural needs before it can use Claude, checked and fixed in one page (an editor tab).
//
// Why: Kural has no AI of its own. Chat, Tab, Ctrl+K and Ask all run your `claude` program (Claude Code) in the
// background, with its login. Without it (or without a login) every one of them failed with an error when you
// used it. Now Kural checks first:
//   1. Claude Code installed       → "Install for me" runs Anthropic's official installer in a terminal
//   2. Logged in                   → "Log in" runs `claude auth login` (opens the browser)
//   3. A test request works        → one tiny request (Haiku), sent the way Kural sends them
// Only when all three pass is Kural "set up" (remembered on this computer). Until then nothing starts `claude`
// in the background (claude.js setSetupGate) and the chat shows "Set up Kural first".
// Optional, for the full experience: Git, and Ollama (fast local Tab model, offline chat models).
//
// On later starts a quick check (version + login, no request) runs in the background; if something broke
// (Claude Code removed, logged out), the page opens again at that step.

const vscode = require("vscode");
const path = require("path");
const os = require("os");
const { findClaude, cleanEnv, setSetupGate, log } = require("./claude");
const checks = require("./checks");
const { installOllama, LOCAL_MODELS } = require("./local");
const { Ollama } = require("./ollama");

const KEY = "kural.setup.v1";   // { bin, version, at }: the test passed with this Claude Code
const DOCS = "https://code.claude.com/docs/en/setup";
const cfg = () => vscode.workspace.getConfiguration("kural");
const tilde = (p) => p && p.startsWith(os.homedir()) ? "~" + p.slice(os.homedir().length) : p;

class GetStarted {
  constructor(context) {
    this.context = context;
    this.passed = context.globalState.get(KEY) || null;
    this.problem = null;      // what a quick check (or a failing feature) found broken since the test passed
    this.panel = null;
    this.waiting = null;      // "install" | "login": polling until it's done
    this.listeners = [];
    this.s = { claude: { state: "checking" }, login: { state: "checking" }, test: { state: "idle" }, optional: {} };
    this.autoTested = null;   // the claude path the test already ran for automatically
    this.ollama = new Ollama(() => cfg().get("tabCompletion.ollamaUrl") || "http://127.0.0.1:11434");
    setSetupGate(() => this.ready);
  }

  // Kural may use Claude: the test passed once on this computer, and nothing is known to be broken since.
  get ready() { return !!this.passed && !this.problem; }
  onChange(f) { this.listeners.push(f); }
  changed() { for (const f of this.listeners) { try { f(this.ready); } catch (e) { log(`get started: ${e.stack}`); } } this.post(); }

  register() {
    this.context.subscriptions.push(
      vscode.commands.registerCommand("kural.getStarted", () => this.open()),
      { dispose: () => clearInterval(this.poll) },
    );
  }

  // At startup: never set up → open the page. Set up → check quietly (a moment later, not to slow the start).
  start() {
    const shell = findClaude.lookInShell();   // in the background: where your terminal finds claude
    if (!this.passed) { shell.then(() => this.open()); return; }
    setTimeout(() => this.quickCheck(), 2500);
  }

  // What's broken now, if anything: "missing" | "broken" | "login" | null. No request to Claude.
  async findProblem() {
    let bin = findClaude();
    if (!bin) { await findClaude.lookInShell(); bin = findClaude(); }
    if (!bin) return "missing";
    const env = cleanEnv({});
    const v = await checks.claudeVersion(bin, env);
    if (v.error && !v.timeout) return "broken";   // (slow isn't broken: the first start after an update can be)
    const a = await checks.claudeAuth(bin, env);
    // Logged in another way (an API key, Bedrock…), `auth status` can say "no" while requests work: if it said
    // so when the test passed, it doesn't count.
    return a.loggedIn === false && this.passed && this.passed.authSaid !== "no" ? "login" : null;
  }

  async quickCheck() {
    const problem = await this.findProblem();
    log(`get started: quick check: ${problem || "ok"}`);
    if (problem) this.lock(problem);
  }

  // A feature found Claude Code missing or logged out (from its error message, which can be wrong): check for real,
  // and only then back to Get started.
  async broke(kind) {
    if (this.problem || this.confirming) return;
    this.confirming = true;
    const problem = await this.findProblem().finally(() => { this.confirming = false; });
    log(`get started: a feature reported "${kind}"; checked: ${problem || "fine, carrying on"}`);
    if (problem) this.lock(problem);
  }

  lock(problem) {
    if (this.problem === problem) return;
    this.problem = problem;
    this.s.test = { state: "idle" };
    this.autoTested = null;
    this.changed();
    this.open();
  }

  open() {
    if (this.panel) { this.panel.reveal(); this.refresh(); return; }
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const p = vscode.window.createWebviewPanel("kural.getStarted", "Get started", vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media] });
    p.iconPath = vscode.Uri.joinPath(media, "chat-icon.svg");
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const uri = (f) => p.webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    p.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${p.webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${uri("getstarted.css")}"></head>
<body><div id="app"></div><script nonce="${nonce}" src="${uri("getstarted.js")}"></script></body></html>`;
    p.webview.onDidReceiveMessage((m) => this.onMessage(m).catch((e) => log(`get started: ${e.stack}`)));
    p.onDidDispose(() => { this.panel = null; this.wait(null); });
    this.panel = p;
    this.refresh();
  }

  post() {
    if (!this.panel) return;
    const install = checks.installFor(process.platform);
    this.panel.webview.postMessage({ type: "state", ...this.s, ready: this.ready, waiting: this.waiting, install,
      platform: process.platform, tabModel: (LOCAL_MODELS.find((m) => m.id === (cfg().get("tabCompletion.localModel") || LOCAL_MODELS[1].id)) || LOCAL_MODELS[1]) });
  }

  // Check everything again (the page shows each step as it's found). shell: also ask your shell where claude is
  // (not on every poll: an interactive shell start is slow, and the installer puts claude where Kural looks anyway).
  async refresh(shell = true) {
    if (this.refreshing) return;
    this.refreshing = true;
    try { await this.check(shell); } finally { this.refreshing = false; }
  }

  async check(shell) {
    const env = cleanEnv({});
    let bin = findClaude();
    if (!bin && shell) { await findClaude.lookInShell(); bin = findClaude(); }
    const chosen = !!(cfg().get("claudePath") || "").trim();
    if (!bin) this.s.claude = { state: "missing", chosen, chosenPath: chosen ? cfg().get("claudePath") : "" };
    else {
      const v = await checks.claudeVersion(bin, env);
      this.s.claude = v.error ? { state: "broken", path: tilde(bin), error: v.error, chosen } : { state: "ok", path: tilde(bin), version: v.version, chosen };
    }
    if (this.s.claude.state !== "ok") this.s.login = { state: "blocked" };
    else {
      const a = await checks.claudeAuth(bin, env);
      this.s.login = a.loggedIn === true ? { state: "ok", method: a.method } : a.loggedIn === false ? { state: "no" } : { state: "unknown" };
    }
    if (this.s.login.state === "no" || this.s.claude.state !== "ok") this.s.test = { state: "blocked" };
    else if (this.s.test.state === "blocked") this.s.test = { state: "idle" };
    // (Something that broke since the last test stays a problem until the test passes again.)
    if (this.waiting === "install" && this.s.claude.state === "ok") this.wait(this.s.login.state === "no" ? "login" : null);
    if (this.waiting === "login" && this.s.login.state === "ok") this.wait(null);
    this.post();
    this.refreshOptional();
    // Installed and logged in (or can't tell): run the test once by itself.
    if (this.s.test.state === "idle" && this.autoTested !== bin && this.s.claude.state === "ok") { this.autoTested = bin; this.test(); }
  }

  async refreshOptional() {
    const o = { git: await checks.gitVersion(cleanEnv({})) };
    const st = await this.ollama.status();
    o.ollama = { running: st.running, version: st.version, ok: st.ok };
    if (st.running) {
      try {
        const models = await this.ollama.models();
        const want = cfg().get("tabCompletion.localModel") || LOCAL_MODELS[1].id;
        o.tabModel = models.some((m) => m.name === want || m.name === `${want}:latest`);
        o.chatModels = models.filter((m) => m.chat).map((m) => m.name);
      } catch { /* Ollama stopped meanwhile */ }
    }
    this.s.optional = o;
    this.post();
  }

  async test() {
    const bin = findClaude();
    if (!bin) return this.refresh();
    if (this.s.test.state === "running") return;
    this.s.test = { state: "running" };
    this.post();
    const root = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    const r = await checks.claudeTest(bin, cleanEnv({}), { cwd: root ? root.uri.fsPath : os.homedir() });
    log(`get started: test ${r.ok ? `passed in ${r.ms} ms` : `failed: ${r.error}`}`);
    if (r.ok) {
      this.s.test = { state: "ok", ms: r.ms };
      const v = this.s.claude.version || "";
      this.passed = { bin, version: v, at: Date.now(), authSaid: this.s.login.state };
      this.problem = null;
      await this.context.globalState.update(KEY, this.passed);
    } else {
      this.s.test = { state: "fail", error: r.error, hint: checks.explain(r.error) };
      if (r.login) this.s.login = { state: "no" };
    }
    this.changed();
  }

  // Poll while you install or log in in the terminal, so the page turns green by itself.
  wait(what) {
    this.waiting = what;
    clearInterval(this.poll);
    if (what) { const until = Date.now() + 15 * 60 * 1000; this.poll = setInterval(() => { if (Date.now() > until) this.wait(null); else this.refresh(false); }, 3000); }
    this.post();
  }

  terminal(name, text) {
    const win = process.platform === "win32";
    const t = vscode.window.createTerminal({ name, shellPath: win ? "powershell.exe" : undefined, location: vscode.TerminalLocation.Panel });
    t.show();
    t.sendText(text);
  }

  async onMessage(m) {
    switch (m.type) {
      case "ready": this.post(); break;
      case "recheck": if (this.s.test.state === "fail") this.s.test = { state: "idle" }; this.autoTested = null; await this.refresh(); break;
      case "install": {
        const i = checks.installFor(process.platform);
        this.terminal("Install Claude Code", process.platform === "win32" ? `${i.command}; Write-Host 'Done. Back to Kural.'` : `${i.command} && echo 'Done. Back to Kural.'`);
        this.wait("install");
        break;
      }
      case "login": {
        const bin = findClaude();
        if (!bin) break;
        const q = process.platform === "win32" ? `& "${bin}"` : `"${bin}"`;
        // `claude auth login` opens the browser to log in. Older Claude Code: start it, then type /login; it can't
        // say when that's done, so you run the test yourself afterwards (no polling).
        if (this.s.login.state === "unknown") {
          this.terminal("Log in to Claude", q);
          vscode.window.showInformationMessage("In the Claude Code terminal, type /login and follow the steps. Then run the test.");
          break;
        }
        this.terminal("Log in to Claude", `${q} auth login`);
        this.s.test = { state: "idle" }; this.autoTested = null;
        this.wait("login");
        break;
      }
      case "test": await this.test(); break;
      case "choose": {
        const pick = await vscode.window.showOpenDialog({ title: "Where is the claude program?", canSelectMany: false, openLabel: "Use this claude",
          defaultUri: vscode.Uri.file(os.homedir()) });
        if (!pick || !pick[0]) break;
        await cfg().update("claudePath", pick[0].fsPath, vscode.ConfigurationTarget.Global);
        this.autoTested = null; this.s.test = { state: "idle" };
        await this.refresh();
        break;
      }
      case "forgetPath": await cfg().update("claudePath", undefined, vscode.ConfigurationTarget.Global); await this.refresh(); break;
      case "copy": await vscode.env.clipboard.writeText(String(m.text || "")); vscode.window.setStatusBarMessage("Copied", 1500); break;
      case "docs": vscode.env.openExternal(vscode.Uri.parse(DOCS)); break;
      case "git": vscode.env.openExternal(vscode.Uri.parse("https://git-scm.com/downloads")); break;
      case "ollama": installOllama(); break;
      case "tabModel": vscode.commands.executeCommand("kural.tabPanel.focus"); break;
      case "chatModels": vscode.commands.executeCommand("kural.chat.localModels"); break;
      case "done":
        if (!this.ready) break;
        if (this.panel) this.panel.dispose();
        await vscode.commands.executeCommand("kural.chat.focus");
        break;
    }
  }
}

module.exports = { GetStarted, KEY };
