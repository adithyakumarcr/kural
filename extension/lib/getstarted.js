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
//   Google Gemini, ChatGPT (Codex)   Google's Antigravity CLI / OpenAI's Codex CLI with their own login (lib/ai/clis.js):
//     1. Installed              → "Install for me": Homebrew or npm, whichever this computer has, in the background;
//                                 any question the installer asks becomes a pop-up (lib/ai/install.js)
//     2. Logged in              → "Log in": the program's own login without a terminal; Kural opens the login page
//                                 in your browser (Codex: codexLogin; Gemini: agy's own screen in a terminal that
//                                 Kural closes by itself). A terminal login stays as a fallback.
//     3. A test request works   → one tiny request, sent the way Kural sends them
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
const { CLIS, IDS: CLI_IDS } = require("./ai/clis");
const ws = require("./workspace");
const installer = require("./ai/install");

const KEY = "kural.setup.v2";   // { claude: { bin, version, at, authSaid } | null, local: { model, at } | null,
                                //   codex / agy: { bin, version, at, models } | null }
const OLD_KEY = "kural.setup.v1";
const DOCS = "https://code.claude.com/docs/en/setup";
const cfg = () => vscode.workspace.getConfiguration("kural");
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
    this.s = { path: this.rec.local && !this.rec.claude ? "local" : this.rec.claude ? "claude" : CLI_IDS.find((id) => this.rec[id]) || null,
      clis: Object.fromEntries(CLI_IDS.map((id) => [id, { install: { state: "checking" }, login: { state: "checking" }, test: { state: "idle" } }])),
      claude: { state: "checking" }, login: { state: "checking" }, test: { state: "idle" },
      local: { ollama: null, models: [], chosen: this.rec.local ? this.rec.local.model : null, test: { state: "idle" } }, optional: {} };
    this.autoTested = null;   // the claude path the test already ran for automatically
    this.ollama = new Ollama(brain.ollamaUrl);
    setSetupGate(() => this.claudeReady);
    // Codex / Gemini set up before: usable at once (the program's path is checked again in the background).
    for (const id of CLI_IDS) if (this.rec[id]) brain.setCli(id, { bin: this.rec[id].bin, ready: true, models: this.rec[id].models || [] });
  }

  get passed() { return this.rec.claude; }
  // Claude may be used: its test passed once on this computer, and nothing is known to be broken since.
  get claudeReady() { return !!this.rec.claude && !this.problem; }
  // Kural can be used: Claude, a model on this computer, Codex or Gemini.
  get ready() { return this.claudeReady || !!this.rec.local || CLI_IDS.some((id) => !!this.rec[id]); }
  cliReady(id) { return !!this.rec[id]; }
  get localModel() { return this.rec.local ? `ollama:${this.rec.local.model}` : null; }

  onChange(f) { this.listeners.push(f); }
  changed() { for (const f of this.listeners) { try { f(this.ready); } catch (e) { log(`get started: ${e.stack}`); } } this.post(); }
  async save() { await this.context.globalState.update(KEY, this.rec); }

  register() {
    this.context.subscriptions.push(
      vscode.commands.registerCommand("kural.getStarted", (p) => this.open(p === "claude" || p === "local" || CLI_IDS.includes(p) ? p : undefined)),
      { dispose: () => clearInterval(this.poll) },
    );
  }

  // At startup: never set up → open the page. Claude set up → check it quietly (a moment later, not to slow the start).
  start() {
    // Only when claude isn't where Kural looks anyway: your shell's startup files run each time it's asked, and anything
    // they touch (a folder in Documents, say) macOS would put down to Kural.
    const shell = findClaude() ? Promise.resolve(null) : findClaude.lookInShell();   // in the background: where your terminal finds claude
    if (!this.ready) { shell.then(() => this.open()); return; }
    if (this.rec.claude) setTimeout(() => this.quickCheck(), 2500);
    // Codex / Gemini: is the program still where it was (or where the setting now says)? Updates the saved path.
    setTimeout(async () => {
      for (const id of CLI_IDS) if (this.rec[id]) { try { await this.checkCli(id); } catch (e) { log(`get started: ${id}: ${e.message}`); } }
    }, 3500);
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
    if (brain.engineOf(brain.currentModel()) === "claude") this.open("claude");
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
    const cliInfo = Object.fromEntries(CLI_IDS.map((id) => [id, { label: CLIS[id].label, short: CLIS[id].short, program: CLIS[id].program, what: CLIS[id].what,
      facts: CLIS[id].facts, install: CLIS[id].install, installAlt: CLIS[id].installAlt, loginTerminal: !!CLIS[id].loginTerminal, set: !!this.rec[id] }]));
    this.panel.webview.postMessage({ type: "state", ...this.s, cliInfo, ready: this.ready, claudeReady: this.claudeReady, localSet: this.rec.local ? this.rec.local.model : null,
      // (While Kural itself is installing or logging in, the page always shows it, whatever the polling is doing.)
      waiting: this.installing ? `install-${this.installing}` : this.loggingIn ? `login-${this.loggingIn}` : this.waiting, install,
      // What the install is doing right now: its last lines, how long it runs, when it last printed something.
      run: this.run ? { id: this.run.id, text: this.run.text, lines: this.run.lines.slice(-8), started: this.run.started, last: this.run.last, now: Date.now() } : null, platform: process.platform, memory: totalMemoryGB(),
      tabModel: (LOCAL_MODELS.find((m) => m.id === (cfg().get("tabCompletion.localModel") || LOCAL_MODELS[1].id)) || LOCAL_MODELS[1]) });
  }

  // Check again (the page shows each step as it's found). shell: also ask your shell where claude is
  // (not on every poll: an interactive shell start is slow, and the installer puts claude where Kural looks anyway).
  // (Asked while a check is running: wait for it, then check once more. Returning at once used to let the caller read
  // the old state: right after an install, "not installed".)
  // Each ask is numbered; it's answered by the first check that STARTED after it (so a slow check followed by polls
  // doesn't make anyone wait forever, and nobody gets a check that began before their ask).
  async refresh(shell = true) {
    const want = this.refreshAsked = (this.refreshAsked || 0) + 1;
    for (;;) {
      if ((this.refreshDone || 0) >= want) return;
      if (!this.refreshing) break;
      await this.refreshing.catch(() => {});
    }
    const covers = this.refreshAsked;
    this.refreshing = (async () => {
      if (this.s.path === "claude" || this.rec.claude) await this.checkClaude(shell);
      if (this.s.path === "local" || this.rec.local) await this.checkLocal();
      for (const id of CLI_IDS) if (this.s.path === id || this.rec[id]) await this.checkCli(id);
      this.post();
      this.refreshOptional();
    })();
    try { await this.refreshing; } finally { this.refreshing = null; this.refreshDone = Math.max(this.refreshDone || 0, covers); }
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

  // ---------- Codex, Gemini ----------
  async checkCli(id) {
    const c = CLIS[id], S = this.s.clis[id];
    const chosen = (cfg().get(`${id}Path`) || "").trim();
    const bin = await c.find(chosen || undefined).catch(() => null);
    if (!bin) { S.install = { state: "missing", chosen: !!chosen, chosenPath: chosen }; S.login = { state: "blocked" }; S.test = { state: "blocked" }; return; }
    const version = await c.version(bin).catch(() => null);
    S.install = version ? { state: "ok", path: tilde(bin), version, chosen: !!chosen } : { state: "broken", path: tilde(bin), error: "It doesn't start (no version).", chosen: !!chosen };
    S.bin = bin;
    if (!version) { S.login = { state: "blocked" }; S.test = { state: "blocked" }; return; }
    if (this.rec[id] && this.rec[id].bin !== bin) { this.rec[id].bin = bin; brain.setCli(id, { bin }); await this.save(); }
    const a = await c.auth(bin).catch(() => ({ loggedIn: null }));
    S.login = a.loggedIn === true ? { state: "ok", method: a.method, email: a.email, plan: a.plan } : a.loggedIn === false ? { state: "no" } : { state: "unknown" };
    brain.setCli(id, { account: a.email || a.method || "" });
    if (S.login.state === "no") S.test = { state: "blocked" };
    else if (S.test.state === "blocked") S.test = { state: "idle" };
    // Installed: the page shows the Log in button next (logging in starts when you click it, not by itself).
    if (this.waiting === `install-${id}` && S.install.state === "ok") this.wait(null);
    if (this.waiting === `login-${id}` && S.login.state === "ok") this.wait(null);
    // Installed and logged in, and you chose it: test it once by itself.
    if (this.s.path === id && S.test.state === "idle" && S.login.state !== "no" && this[`autoTested_${id}`] !== bin) { this[`autoTested_${id}`] = bin; setImmediate(() => this.testCli(id)); }
  }

  async testCli(id) {
    const c = CLIS[id], S = this.s.clis[id];
    if (!S.bin || S.test.state === "running") return;
    S.test = { state: "running" };
    this.post();
    const r = await c.test(S.bin, { cwd: this.cwd() }).catch((e) => ({ ok: false, error: e.message }));
    log(`get started: ${c.short} test ${r.ok ? `passed in ${r.ms} ms` : `failed: ${r.error}`}`);
    if (r.ok) {
      S.test = { state: "ok", ms: r.ms };
      const models = await c.models(S.bin, { cwd: this.cwd() }).catch(() => []);
      this.rec[id] = { bin: S.bin, version: S.install.version || "", at: Date.now(), models: Array.isArray(models) ? models.slice(0, 12) : [] };
      brain.setCli(id, { bin: S.bin, ready: true, models: this.rec[id].models });
      await this.save();
    } else {
      S.test = { state: "fail", error: r.error || "No answer." };
      if (r.login) S.login = { state: "no" };
    }
    this.changed();
  }

  // Log out of Codex / Gemini (Account menu): Kural stops using it until it's set up again.
  async forgetCli(id) {
    this.rec[id] = null;
    this.s.clis[id].test = { state: "idle" };
    this[`autoTested_${id}`] = null;
    brain.setCli(id, { ready: false });
    await this.save();
    this.changed();
  }

  // Log in to Codex / Gemini now (Account menu, the chat's "Log in"): the page at its steps, the login terminal open.
  async signInCli(id) {
    this.open(id);
    while (this.refreshing) await new Promise((r) => setTimeout(r, 100));
    await this.refresh();
    const S = this.s.clis[id];
    if (S.bin && S.login.state !== "ok") await this.onMessage({ type: "loginCli", id });
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

  // ---------- Codex / Gemini: install and log in without a terminal ----------

  // Install in the background (lib/ai/install.js). Questions the installer asks become pop-ups. No Homebrew and no
  // Node.js: say so, and offer Node.js's download page (its installer is a normal Mac/Windows app).
  async installCli(id) {
    const c = CLIS[id];
    if (this.installing) return;
    this.installing = id;
    // The run, shown live on the page (its output, how long, when it last printed) so you can see it isn't stuck.
    const run = this.run = { id, text: "", lines: [], started: Date.now(), last: Date.now(), ac: new AbortController(), warned: false };
    this.wait(`install-${id}`);
    let ticker = null;
    try {
      const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Installing ${c.program}`, cancellable: true }, (progress, token) => {
        token.onCancellationRequested(() => run.ac.abort());
        let lastLine = "";
        const show = () => {
          const secs = Math.round((Date.now() - run.started) / 1000), quiet = Math.round((Date.now() - run.last) / 1000);
          progress.report({ message: `${lastLine.slice(0, 70) || run.text} (${mmss(secs)}${quiet >= 30 ? `, nothing new for ${mmss(quiet)}` : ""})` });
          this.post();
          // Nothing new for 3 minutes: say so once, with what you can do (it may just be a slow download).
          if (quiet >= 180 && !run.warned) {
            run.warned = true;
            vscode.window.showWarningMessage(`Kural: installing ${c.program} has printed nothing for 3 minutes. It may still be downloading, or it may be stuck.`,
              "Keep waiting", "Show output", "Stop").then((pick) => {
              if (pick === "Show output") vscode.commands.executeCommand("kural.showLog");
              if (pick === "Stop") run.ac.abort();
              if (pick === "Keep waiting") { run.last = Date.now(); run.warned = false; }
            });
          }
        };
        ticker = setInterval(show, 1000);
        return installer.install(id, {
          signal: run.ac.signal,
          onPlan: (plan) => { log(`get started: installing ${c.program}: ${plan.text}`); run.text = plan.text; run.lines.push(`$ ${plan.text}`); show(); },
          onOutput: (text) => {
            run.last = Date.now();
            for (const l of text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split(/\r?\n|\r/)) {
              if (!l.trim()) continue;
              log(`  ${l.slice(0, 300)}`);
              run.lines.push(l.slice(0, 200)); lastLine = l.trim();
            }
            if (run.lines.length > 200) run.lines.splice(0, run.lines.length - 200);
          },
          ask: (q) => this.askInstaller(c, q),
        });
      });
      if (r.plan && r.plan.missing === "curl") {
        this.wait(null);
        vscode.window.showWarningMessage(`Kural: ${c.program}'s installer needs curl and bash, and this computer doesn't have them. On Ubuntu: sudo apt install curl`);
        return;
      }
      if (r.plan && r.plan.missing) {
        this.wait(null);
        const why = r.plan.old ? `${c.program} needs Node.js ${r.plan.need} or newer; this computer has Node.js ${r.plan.old}.`
          : `${c.program} installs with npm, which comes with Node.js${process.platform === "darwin" ? " (or with Homebrew)" : ""}, and neither is on this computer.`;
        const pick = await vscode.window.showWarningMessage(`Kural: ${why}`, { modal: true,
          detail: "Install Node.js (a normal installer from nodejs.org), then click Install for me again." }, "Get Node.js");
        if (pick === "Get Node.js") vscode.env.openExternal(vscode.Uri.parse("https://nodejs.org/en/download"));
        return;
      }
      if (r.cancelled) { log(`get started: ${c.program} install cancelled`); this.wait(null); return; }
      if (!r.ok) {
        log(`get started: ${c.program} install failed (exit ${r.code})`);
        this.wait(null);
        // (Not awaited: an ignored notification must not keep "installing" set.)
        vscode.window.showErrorMessage(`Kural couldn't install ${c.program}: ${installer.failure(r.output)}`, "Show details", "Try in a terminal").then((pick) => {
          if (pick === "Show details") vscode.commands.executeCommand("kural.showLog");
          if (pick === "Try in a terminal") this.installInTerminal(id);
        });
        return;
      }
      log(`get started: ${c.program} installed${r.binDir ? ` (into ${r.binDir})` : ""}`);
      await this.refresh();
      // Installed into a folder Kural doesn't look in by itself (npm's own folder, not on Kural's PATH): use that file.
      if (this.s.clis[id].install.state !== "ok" && r.binDir) {
        const f = [id, `${id}.cmd`, `${id}.exe`].map((n) => require("path").join(r.binDir, n)).find((p) => require("fs").existsSync(p));
        if (f) { await cfg().update(`${id}Path`, f, vscode.ConfigurationTarget.Global); await this.refresh(); }
      }
      // Installed somewhere Kural doesn't look by itself (an unusual npm folder): say so, and let you point to it.
      if (this.s.clis[id].install.state !== "ok") {
        this.wait(null);
        vscode.window.showWarningMessage(`Kural: ${c.program} was installed, but Kural can't find the ${id} program. Choose the file it was installed to.`, `Choose the ${id} file…`, "Show details").then((pick) => {
          if (pick === "Show details") vscode.commands.executeCommand("kural.showLog");
          else if (pick) this.onMessage({ type: "chooseCli", id });
        });
      } else if (this.s.clis[id].login.state !== "ok") {
        vscode.window.showInformationMessage(`Kural: ${c.program} is installed. Next: log in.`, "Log in").then((pick) => { if (pick === "Log in") this.loginCli(id); });
      }
    } finally { clearInterval(ticker); this.installing = null; this.run = null; this.post(); }
  }

  // A question from the installer, as a pop-up. The answer is what gets typed (null = stop the install).
  async askInstaller(c, q) {
    const detail = `${c.program}'s install asks:\n\n${q.question}`;
    if (q.kind === "secret" || q.kind === "text") {
      // ("text": a question Kural doesn't recognise; the installer has been waiting for 20 s.)
      const v = await vscode.window.showInputBox({ title: `Installing ${c.program}: the install is waiting for an answer`, prompt: q.question,
        password: q.kind === "secret", ignoreFocusOut: true, placeHolder: q.kind === "text" ? "Your answer (Esc: don't answer; Cancel in the progress message stops the install)" : undefined });
      // A guessed question left unanswered (it may not be one) changes nothing; an unanswered password stops it.
      if (v === undefined) return q.kind === "text" ? undefined : null;
      return v;
    }
    if (q.kind === "enter") {
      const pick = await vscode.window.showInformationMessage(`Installing ${c.program}`, { modal: true, detail }, "Continue");
      return pick ? "" : null;
    }
    const pick = await vscode.window.showInformationMessage(`Installing ${c.program}`, { modal: true, detail }, "Yes", "No");
    return pick === "Yes" ? "y" : pick === "No" ? "n" : null;
  }

  installInTerminal(id) {
    const c = CLIS[id];
    this.terminal(`Install ${c.program}`, process.platform === "win32" ? `${c.install}; Write-Host 'Done. Back to Kural.'` : `${c.install} && echo 'Done. Back to Kural.'`);
    this.wait(`install-${id}`);
  }

  // Log in: the program's own login, without a terminal. Kural opens the login page in your browser and waits.
  async loginCli(id) {
    const c = CLIS[id], S = this.s.clis[id];
    if (this.loggingIn) return;
    this.loggingIn = id;
    S.test = { state: "idle" }; this[`autoTested_${id}`] = null;
    this.wait(`login-${id}`);
    try {
      let opened = false;
      const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Log in to ${c.short} in your browser`, cancellable: true }, (progress, token) => {
        const ac = new AbortController();
        token.onCancellationRequested(() => ac.abort());
        if (c.loginTerminal) { opened = true; return this.loginWithScreen(id, progress, ac.signal); }
        progress.report({ message: "opening the login page…" });
        return c.login(S.bin, { signal: ac.signal, openUrl: (url) => {
          opened = true;
          log(`get started: opening ${c.short}'s login page`);
          vscode.env.openExternal(vscode.Uri.parse(url));
          progress.report({ message: "waiting for you to finish in the browser (Cancel to stop)" });
        } });
      });
      log(`get started: ${c.short} login: ${r.ok ? "done" : r.cancelled ? "cancelled" : r.error}`);
      await this.refresh();
      if (r.ok || S.login.state === "ok") { this.wait(null); return; }
      this.wait(null);
      if (r.cancelled) return;
      vscode.window.showErrorMessage(`Kural: the ${c.short} login didn't finish${opened ? "" : " (the login page didn't open)"}: ${r.error}`, "Try again", "Log in in a terminal").then((pick) => {
        if (pick === "Try again") this.loginCli(id);
        if (pick === "Log in in a terminal") this.loginInTerminal(id);
      });
    } finally { this.loggingIn = null; this.post(); }
  }

  // A program that only logs in on its own screen (Antigravity: no login command): Kural runs that screen, opens the
  // login page and passes on the code (below), checks every few seconds whether you're logged in, and closes the
  // screen by itself when you are. { ok } / { cancelled } / { error }.
  loginWithScreen(id, progress, signal) {
    const c = CLIS[id], S = this.s.clis[id];
    progress.report({ message: "Kural opens the Google login page in your browser; log in there. Kural closes the login screen when you're done." });
    // Mac, Linux: the screen in a pseudo-terminal Kural reads (agy.loginPty). Kural opens the login page itself and, if
    // the screen asks for the code Google shows after you log in, asks you for it in a pop-up and types it in. The
    // terminal shows the same screen (you can type there too). Windows: agy in a plain terminal.
    let pty = null, opened = false, askingCode = false;
    const shown = new vscode.EventEmitter(), gone = new vscode.EventEmitter();
    const askCode = async () => {
      if (askingCode || !pty) return;
      askingCode = true;
      const code = await vscode.window.showInputBox({ title: `Log in to ${c.short}`, ignoreFocusOut: true, placeHolder: "e.g. 4/0Ab…",
        prompt: `${opened ? "Log in in the browser page Kural opened" : "Log in with Google in your browser"}; Google then shows a code. Paste it here.` });
      askingCode = false;
      if (code && code.trim() && pty) { log(`get started: ${c.short} login: code given`); pty.answerCode(code); }
    };
    const pseudo = c.loginPty ? {
      onDidWrite: shown.event, onDidClose: gone.event,
      open: (dims) => {
        pty = c.loginPty(S.bin, { cols: (dims && dims.columns) || 100, rows: (dims && dims.rows) || 30,
          onData: (d) => shown.fire(d),
          onUrl: (url) => { if (opened) return; opened = true; log(`get started: opening ${c.short}'s login page`); vscode.env.openExternal(vscode.Uri.parse(url)); },
          onCode: () => askCode(),
          onExit: () => gone.fire() });
        if (!pty) { shown.fire("Kural can't read this screen here. Run agy in a terminal to log in.\r\n"); gone.fire(); }
      },
      close: () => { if (pty) pty.kill(); },
      handleInput: (d) => { if (pty) pty.write(d); },
    } : null;
    const term = vscode.window.createTerminal(pseudo
      ? { name: `Log in to ${c.short}`, pty: pseudo, isTransient: true, iconPath: new vscode.ThemeIcon("account"), location: vscode.TerminalLocation.Panel }
      : { name: `Log in to ${c.short}`, shellPath: S.bin, cwd: ws.workDir(), isTransient: true, iconPath: new vscode.ThemeIcon("account"), location: vscode.TerminalLocation.Panel });
    term.show();
    return new Promise((resolve) => {
      let done = false, checking = false;
      const t0 = Date.now();
      const end = (r) => { if (done) return; done = true; clearInterval(poll); closed.dispose(); if (pty) pty.kill(); try { term.dispose(); } catch { /* closed */ } resolve(r); };
      const check = async () => {
        if (checking || done) return;
        checking = true;
        const a = await c.auth(S.bin).catch(() => null);
        checking = false;
        if (a && a.loggedIn) end({ ok: true });
        else if (Date.now() - t0 > 10 * 60 * 1000) end({ error: "The login wasn't finished in 10 minutes." });
      };
      const poll = setInterval(check, 4000);
      // You closed the terminal: one last check (you may have logged in just before).
      const closed = vscode.window.onDidCloseTerminal(async (t) => {
        if (t !== term || done) return;
        const a = await c.auth(S.bin).catch(() => null);
        end(a && a.loggedIn ? { ok: true } : { cancelled: true });
      });
      if (signal) signal.addEventListener("abort", () => end({ cancelled: true }), { once: true });
    });
  }

  loginInTerminal(id) {
    this.terminal(`Log in to ${CLIS[id].short}`, CLIS[id].loginCommand(this.s.clis[id].bin));
    this.s.clis[id].test = { state: "idle" }; this[`autoTested_${id}`] = null;
    this.wait(`login-${id}`);
  }

  async onMessage(m) {
    switch (m.type) {
      case "ready": this.post(); break;
      case "path": this.s.path = m.path === "local" || CLI_IDS.includes(m.path) ? m.path : "claude"; this.post(); await this.refresh(); break;
      case "installCli": if (CLIS[m.id]) await this.installCli(m.id); break;
      case "stopInstall": if (this.run) this.run.ac.abort(); break;
      case "showLog": vscode.commands.executeCommand("kural.showLog"); break;
      case "installCliTerminal": if (CLIS[m.id]) this.installInTerminal(m.id); break;
      case "loginCli": if (CLIS[m.id] && this.s.clis[m.id].bin) await this.loginCli(m.id); break;
      case "loginCliTerminal": if (CLIS[m.id] && this.s.clis[m.id].bin) this.loginInTerminal(m.id); break;
      case "testCli": if (CLIS[m.id]) await this.testCli(m.id); break;
      case "cliDocs": if (CLIS[m.id]) vscode.env.openExternal(vscode.Uri.parse(CLIS[m.id].docs)); break;
      case "chooseCli": if (CLIS[m.id]) {
        const pick = await vscode.window.showOpenDialog({ title: `Where is the ${m.id} program?`, canSelectMany: false, openLabel: `Use this ${m.id}`, defaultUri: vscode.Uri.file(os.homedir()) });
        if (!pick || !pick[0]) break;
        await cfg().update(`${m.id}Path`, pick[0].fsPath, vscode.ConfigurationTarget.Global);
        await this.refresh();
      } break;
      case "forgetCliPath": if (CLIS[m.id]) { await cfg().update(`${m.id}Path`, undefined, vscode.ConfigurationTarget.Global); await this.refresh(); } break;
      case "recheck":
        if (this.s.test.state === "fail") this.s.test = { state: "idle" };
        if (this.s.local.test.state === "fail") this.s.local.test = { state: "idle" };
        for (const id of CLI_IDS) if (this.s.clis[id].test.state === "fail") { this.s.clis[id].test = { state: "idle" }; this[`autoTested_${id}`] = null; }
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
