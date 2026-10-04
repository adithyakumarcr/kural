// Get started: how Kural runs its AI, checked and set up in one page (an editor tab). Two ways, either is enough:
//
//   Claude          Claude Code with your Claude plan: the most capable models, needs internet.
//     1. Claude Code installed  → "Install for me" runs Anthropic's official installer in a terminal
//     2. Logged in              → "Log in" runs `claude auth login` (opens the browser)
//     3. A test request works   → one tiny request (Haiku), sent the way Kural sends them
//   Your own model  a model on your computer through Ollama, run by Kural's own engine (lib/engine.js):
//                   no account, free, private, works offline.
//     1. Ollama running         → "Get Ollama"
//     2. A chat model           → pick one you have, or download one that fits this computer's memory
//     3. A test request works   → one request to that model through Kural's engine
//
// Kural is "set up" when one of them passed (remembered on this computer). Until then the chat shows "Set up Kural
// first". Claude processes only start once the Claude way passed (claude.js setSetupGate): no background errors for
// people who don't use Claude. Optional extras: Git, and a Tab Completion model.
// On later starts a quick check of Claude (no request) runs in the background if Claude was set up; if something
// broke (Claude Code removed, logged out), the Claude models wait for it and the page says why.

const vscode = require("vscode");
const os = require("os");
const { findClaude, cleanEnv, setSetupGate, log } = require("./ai/claude");
const checks = require("./ai/claude-checks");
const { installOllama, LOCAL_MODELS } = require("./tab/local");
const { Ollama, memoryGB, totalMemoryGB } = require("./ai/ollama");
const { LocalAgent } = require("./ai/engine");
const brain = require("./ai");
const ws = require("./workspace");

const KEY = "kural.setup.v2";   // { claude: { bin, version, at, authSaid } | null, local: { model, at } | null }
const OLD_KEY = "kural.setup.v1";
const DOCS = "https://code.claude.com/docs/en/setup";
const cfg = () => vscode.workspace.getConfiguration("kural");
const tilde = (p) => p && p.startsWith(os.homedir()) ? "~" + p.slice(os.homedir().length) : p;

// Good open models for coding with tools, biggest first; the page offers the ones that fit this computer.
const RECOMMENDED = [
  { name: "qwen3-coder:30b", what: "Alibaba's coding model, made for agents" },
  { name: "gpt-oss:20b", what: "OpenAI's open model, strong reasoning" },
  { name: "qwen3:14b", what: "good all-rounder" },
  { name: "qwen3:8b", what: "good all-rounder, lighter" },
  { name: "qwen3:4b", what: "small and quick; for 8 GB computers" },
];

class GetStarted {
  constructor(context) {
    this.context = context;
    const old = context.globalState.get(OLD_KEY);
    this.rec = context.globalState.get(KEY) || { claude: old || null, local: null };
    this.problem = null;      // what broke with Claude since its test passed
    this.panel = null;
    this.waiting = null;      // "install" | "login" | "ollama": polling until it's done
    this.listeners = [];
    this.pulls = new Map();   // downloads started here: name -> percent
    this.s = { path: this.rec.local && !this.rec.claude ? "local" : this.rec.claude ? "claude" : null,
      claude: { state: "checking" }, login: { state: "checking" }, test: { state: "idle" },
      local: { ollama: null, models: [], chosen: this.rec.local ? this.rec.local.model : null, test: { state: "idle" } }, optional: {} };
    this.autoTested = null;   // the claude path the test already ran for automatically
    this.ollama = new Ollama(brain.ollamaUrl);
    setSetupGate(() => this.claudeReady);
  }

  get passed() { return this.rec.claude; }
  // Claude may be used: its test passed once on this computer, and nothing is known to be broken since.
  get claudeReady() { return !!this.rec.claude && !this.problem; }
  // Kural can be used: Claude, or a model on this computer.
  get ready() { return this.claudeReady || !!this.rec.local; }
  get localModel() { return this.rec.local ? `ollama:${this.rec.local.model}` : null; }

  onChange(f) { this.listeners.push(f); }
  changed() { for (const f of this.listeners) { try { f(this.ready); } catch (e) { log(`get started: ${e.stack}`); } } this.post(); }
  async save() { await this.context.globalState.update(KEY, this.rec); }

  register() {
    this.context.subscriptions.push(
      vscode.commands.registerCommand("kural.getStarted", (p) => this.open(p === "claude" || p === "local" ? p : undefined)),
      { dispose: () => clearInterval(this.poll) },
    );
  }

  // At startup: never set up → open the page. Claude set up → check it quietly (a moment later, not to slow the start).
  start() {
    const shell = findClaude.lookInShell();   // in the background: where your terminal finds claude
    if (!this.ready) { shell.then(() => this.open()); return; }
    if (this.rec.claude) setTimeout(() => this.quickCheck(), 2500);
  }

  // What's broken with Claude now, if anything: "missing" | "broken" | "login" | null. No request to Claude.
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
    return a.loggedIn === false && this.rec.claude && this.rec.claude.authSaid !== "no" ? "login" : null;
  }

  async quickCheck() {
    const problem = await this.findProblem();
    log(`get started: quick check of Claude: ${problem || "ok"}`);
    if (problem) this.lock(problem);
  }

  // A feature found Claude Code missing or logged out (from its error message, which can be wrong): check for real,
  // and only then lock the Claude models.
  async broke(kind) {
    if (!this.rec.claude || this.problem || this.confirming) return;
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
    // (Working with a model on this computer? Then Claude being broken doesn't need the page right now.)
    if (!brain.isLocal(brain.currentModel())) this.open("claude");
  }

  // You logged out (Account menu): the Claude models wait until you log in again; the page shows the Log in step.
  loggedOut() {
    this.problem = null;   // (lock() again even if it was locked for something else)
    this.lock("login");
  }

  // Log in to Claude now (Account menu: Log in, Switch account): the page at the Claude steps, and the login
  // terminal open. When the login is done, the test runs by itself and Claude is unlocked.
  async signIn() {
    this.open("claude");
    while (this.refreshing) await new Promise((r) => setTimeout(r, 100));   // (open() started a check)
    await this.refresh();
    if (this.s.login.state !== "ok") await this.onMessage({ type: "login" });
  }

  open(path) {
    if (path) this.s.path = path;
    if (this.panel) { this.panel.reveal(); this.refresh(); return; }
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const p = vscode.window.createWebviewPanel("kural.getStarted", "Get started", vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media] });
    p.iconPath = vscode.Uri.joinPath(media, "chat-icon.svg");
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const uri = (f) => p.webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    p.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${p.webview.cspSource}; font-src ${p.webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${uri("codicons/codicon.css")}"><link rel="stylesheet" href="${uri("getstarted.css")}"></head>
<body><div id="app"></div><script nonce="${nonce}" src="${uri("getstarted.js")}"></script></body></html>`;
    p.webview.onDidReceiveMessage((m) => this.onMessage(m).catch((e) => log(`get started: ${e.stack}`)));
    p.onDidDispose(() => { this.panel = null; this.wait(null); });
    this.panel = p;
    this.refresh();
  }

  post() {
    if (!this.panel) return;
    const install = checks.installFor(process.platform);
    this.s.local.pulls = Object.fromEntries(this.pulls);
    this.panel.webview.postMessage({ type: "state", ...this.s, ready: this.ready, claudeReady: this.claudeReady, localSet: this.rec.local ? this.rec.local.model : null,
      waiting: this.waiting, install, platform: process.platform, memory: totalMemoryGB(),
      tabModel: (LOCAL_MODELS.find((m) => m.id === (cfg().get("tabCompletion.localModel") || LOCAL_MODELS[1].id)) || LOCAL_MODELS[1]) });
  }

  // Check again (the page shows each step as it's found). shell: also ask your shell where claude is
  // (not on every poll: an interactive shell start is slow, and the installer puts claude where Kural looks anyway).
  async refresh(shell = true) {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      if (this.s.path === "claude" || this.rec.claude) await this.checkClaude(shell);
      if (this.s.path === "local" || this.rec.local) await this.checkLocal();
      this.post();
      this.refreshOptional();
    } finally { this.refreshing = false; }
    // You chose your own model and it's there: test it once by itself (like the Claude test).
    const L = this.s.local;
    if (this.s.path === "local" && L.chosen && L.models.some((m) => m.name === L.chosen) && L.test.state === "idle" && this.autoLocal !== L.chosen) {
      this.autoLocal = L.chosen;
      this.testLocal();
    }
  }

  // ---------- Claude ----------
  async checkClaude(shell) {
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
    if (this.waiting === "install" && this.s.claude.state === "ok") this.wait(this.s.login.state === "no" ? "login" : null);
    if (this.waiting === "login" && this.s.login.state === "ok") this.wait(null);
    // Installed and logged in (or can't tell), and you chose Claude: run the test once by itself.
    if (this.s.path === "claude" && this.s.test.state === "idle" && this.autoTested !== bin && this.s.claude.state === "ok") { this.autoTested = bin; setImmediate(() => this.test()); }
  }

  async test() {
    const bin = findClaude();
    if (!bin) return this.refresh();
    if (this.s.test.state === "running") return;
    this.s.test = { state: "running" };
    this.post();
    const r = await checks.claudeTest(bin, cleanEnv({}), { cwd: this.cwd() });
    log(`get started: Claude test ${r.ok ? `passed in ${r.ms} ms` : `failed: ${r.error}`}`);
    if (r.ok) {
      this.s.test = { state: "ok", ms: r.ms };
      this.rec.claude = { bin, version: this.s.claude.version || "", at: Date.now(), authSaid: this.s.login.state };
      this.problem = null;
      await this.save();
    } else {
      this.s.test = { state: "fail", error: r.error, hint: checks.explain(r.error) };
      if (r.login) this.s.login = { state: "no" };
    }
    this.changed();
  }

  // ---------- your own model (Ollama) ----------
  async checkLocal() {
    const L = this.s.local;
    const st = await this.ollama.status();
    L.ollama = { running: st.running, version: st.version, ok: st.ok };
    L.models = [];
    if (st.running) { try { L.models = (await this.ollama.models()).filter((m) => m.chat).map((m) => ({ name: m.name, params: m.params, size: m.size, caps: m.capabilities })); } catch { /* stopped */ } }
    if (L.chosen && !L.models.some((m) => m.name === L.chosen) && !this.pulls.has(L.chosen)) L.chosen = null;
    if (!L.chosen && L.models.length) L.chosen = L.models[0].name;
    const mem = totalMemoryGB();
    L.recommended = RECOMMENDED.map((r) => ({ ...r, memory: memoryGB(r.name.split(":")[1]) }))
      .filter((r) => !mem || r.memory <= Math.max(4, mem * 0.75)).slice(0, 3);
    if (this.waiting === "ollama" && L.ollama.running) this.wait(null);
    if (L.test.state === "ok" && this.rec.local && this.rec.local.model !== L.chosen) L.test = { state: "idle" };
  }

  async pull(name) {
    if (this.pulls.has(name)) return;
    this.pulls.set(name, 0);
    this.s.local.chosen = name;
    this.post();
    let last = 0;
    try {
      await this.ollama.pull(name, (p) => { this.pulls.set(name, p.percent || 0); if (Date.now() - last > 500) { last = Date.now(); this.post(); } });
      log(`get started: downloaded ${name}`);
    } catch (e) {
      vscode.window.showWarningMessage(`Kural: couldn't download ${name}: ${e.message}`);
    } finally { this.pulls.delete(name); }
    await this.refresh();
  }

  // One request to the chosen model through Kural's engine: the same way the chat will use it.
  async testLocal() {
    const L = this.s.local;
    if (!L.chosen || L.test.state === "running") return;
    L.test = { state: "running", model: L.chosen };
    this.post();
    const m = L.models.find((x) => x.name === L.chosen) || {};
    const t0 = Date.now();
    // (The first answer also loads the model into memory: up to a few minutes for a big one.)
    const r = await new Promise((resolve) => {
      let timer = null;
      const done = (msg) => { clearTimeout(timer); a.kill(); resolve(msg); };
      const a = new LocalAgent({ model: L.chosen, baseUrl: brain.ollamaUrl(), contextLength: brain.contextLength(), capabilities: m.caps, effort: "low",
        cwd: this.cwd(), tools: [] }, { onMessage: (msg) => { if (msg.type === "result") done(msg); } });
      timer = setTimeout(() => done({ is_error: true, result: "No answer after 3 minutes. The model may be too big for this computer; try a smaller one." }), 180000);
      a.start(); a.send("This is Kural checking that you work. Reply with exactly: OK");
    });
    const ok = !r.is_error && String(r.result || "").trim().length > 0;
    log(`get started: ${L.chosen} test ${ok ? `passed in ${Date.now() - t0} ms` : `failed: ${r.result}`}`);
    if (ok) {
      L.test = { state: "ok", ms: Date.now() - t0, model: L.chosen };
      this.rec.local = { model: L.chosen, at: Date.now() };
      await this.save();
    } else L.test = { state: "fail", error: r.result || "No answer.", model: L.chosen };
    this.changed();
  }

  // ---------- extras ----------
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

  // (No folder open: Kural's own empty folder, never your home folder — see workspace.js workDir.)
  cwd() { return ws.root() || ws.workDir(); }

  // Poll while you install or log in, so the page turns green by itself.
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
      case "path": this.s.path = m.path === "local" ? "local" : "claude"; this.post(); await this.refresh(); break;
      case "recheck":
        if (this.s.test.state === "fail") this.s.test = { state: "idle" };
        if (this.s.local.test.state === "fail") this.s.local.test = { state: "idle" };
        this.autoTested = null; await this.refresh(); break;
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
      case "pick": if (typeof m.name === "string") { this.s.local.chosen = m.name; this.s.local.test = { state: "idle" }; this.post(); await this.refresh(false); } break;
      case "pull": if (typeof m.name === "string" && /^[A-Za-z0-9._\/-]+(:[A-Za-z0-9._-]+)?$/.test(m.name)) this.pull(m.name); break;
      case "testLocal": await this.testLocal(); break;
      case "getOllama": installOllama(); this.wait("ollama"); break;
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

module.exports = { GetStarted, KEY, RECOMMENDED };
