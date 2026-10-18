// The Plugins tab: the plugins of the AI your chat uses, beside VS Code's Extensions, like Search & Ask beside each other.
// Each AI's own plugin manager does the work (core.js); this file is the view, the details tab and the questions.
// Where it shows:
//   - in VS Code's Extensions side bar, as its second tab: "Extensions | Plugins" (scripts/rebrand.py add_plugins_tab
//     adds the switch and lets Kural's view "kural.plugins" into that side bar; its command _kural.extensionsTabs tells
//     Kural it's there and switches the tab).
//   - without that patch (another VSCodium's code): in a side bar of its own, view "kural.pluginsAlone".
// The page (media/plugins.js) follows the chat's model: Claude's plugins for a Claude model, Codex's for ChatGPT,
// Antigravity's for Gemini; a model on this computer has none. You can look at another AI's without changing the chat.
// Installing asks first (where it comes from; a plugin runs code as you). The AI's chats then pick it up: Claude's
// reload by themselves (lib/ai/claude-setup.js watches Claude Code's plugin files), Codex's and Gemini's at their next
// message (chat.pluginsChanged).
const vscode = require("vscode");
const os = require("os");
const crypto = require("crypto");
const core = require("./core");
const brain = require("../ai");
const { withProfileEnv } = require("../profiles/env");
const { fontScale, watchFontScale } = require("../ui");
const { log } = require("../ai/claude");

const NAMES = { claude: "Claude", codex: "ChatGPT (Codex)", agy: "Google Gemini" };
const SHORT = { claude: "Claude", codex: "ChatGPT", agy: "Gemini" };
const FRESH_MS = 60000;   // a list read less than a minute ago is shown as it is (Refresh reads it again)
const DOING = { install: "Installing…", uninstall: "Removing…", enable: "Turning on…", disable: "Turning off…", update: "Updating…" };
const RISK = (ai) => `A plugin runs code on your computer as you: its hooks and MCP servers start with ${SHORT[ai]}, and Kural's ` +
  "approval cards don't ask about them. Install only plugins you trust.";
// "15 skills, 1 hook" (from agy's validate: { skills, agents, hooks, mcpServers, rules })
function adds(c) {
  const words = [["skills", "skill"], ["agents", "agent"], ["hooks", "hook"], ["mcpServers", "MCP server"], ["rules", "rule"]];
  const out = words.filter(([k]) => Number(c && c[k]) > 0).map(([k, one]) => `${c[k]} ${c[k] === 1 ? one : one + "s"}`);
  return out.join(", ") || "nothing Kural can name";
}

class Plugins {
  constructor(context, { getStarted, chat }) {
    this.context = context;
    this.gs = getStarted;
    this.chat = chat;
    this.views = new Map();   // view id → WebviewView (sent: ai → the version of the list it has)
    this.cache = {};          // ai → { at, data, loading, error, version }
    this.busy = {};           // ai → { plugin id | "market:<name>" | "add": what it's doing, in words }
    this.picked = null;       // an AI you picked on the page (null: the chat's)
    this.followed = this.chatAI();
    this.details = null;      // the details tab: { panel, ai, id, seq }
    this.patched = false;     // the Extensions side bar has the Plugins tab (rebrand.py)
  }

  register() {
    const c = this.context;
    for (const id of ["kural.plugins", "kural.pluginsAlone"])
      c.subscriptions.push(vscode.window.registerWebviewViewProvider(id, { resolveWebviewView: (v) => this.resolve(id, v) }, { webviewOptions: { retainContextWhenHidden: true } }));
    c.subscriptions.push(
      vscode.commands.registerCommand("kural.plugins.show", (ai) => this.show(ai)),
      // (The title bar's Refresh: the Extensions side bar's own button while Plugins shows (rebrand.py), else the view's.)
      vscode.commands.registerCommand("kural.plugins.refresh", () => this.load(this.current(), true)),
      vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration("kural.chat.fullClaudeCodeSetup")) this.push(); }),
      { dispose: () => { if (this.details) this.details.panel.dispose(); } },
    );
    watchFontScale(c, (m) => { for (const v of this.views.values()) v.webview.postMessage(m); if (this.details) this.details.panel.webview.postMessage(m); });
    this.detect();
  }

  // Is the Extensions side bar's Plugins tab there? Without it, Plugins gets a side bar of its own.
  async detect() {
    try { this.patched = (await vscode.commands.getCommands(false)).includes("_kural.extensionsTabs"); } catch { this.patched = false; }
    vscode.commands.executeCommand("setContext", "kural.pluginsAlone", !this.patched);
  }

  // "Kural: Show Plugins" (ai: whose, optional).
  async show(ai) {
    if (core.AIS.includes(ai)) this.pick(ai);
    if (this.patched) {
      await vscode.commands.executeCommand("workbench.view.extensions");
      await vscode.commands.executeCommand("_kural.extensionsTabs", "plugins");
    } else await vscode.commands.executeCommand("kural.pluginsAlone.focus");
  }

  // Each AI's program and the environment to run it in (the profile's own Claude / Codex folders).
  program(ai) {
    if (ai === "claude") { const c = require("../ai/claude"); return { bin: c.findClaude(), env: c.cleanEnv(), cwd: this.projectDir() }; }
    const cli = brain.cli && brain.cli[ai];
    return { bin: cli && cli.bin ? cli.bin : null, env: withProfileEnv(), cwd: os.tmpdir() };
  }
  // The project folder, when you trust it: Claude then lists the plugins that project set up too.
  projectDir() {
    const f = vscode.workspace.workspaceFolders;
    return vscode.workspace.isTrusted && f && f.length && f[0].uri.scheme === "file" ? f[0].uri.fsPath : os.tmpdir();
  }
  // The chat's AI: claude | codex | agy | local.
  chatAI() { try { const e = brain.engineOf(brain.currentModel()); return core.AIS.includes(e) ? e : "local"; } catch { return "claude"; } }
  current() { return this.picked || (core.AIS.includes(this.chatAI()) ? this.chatAI() : null); }
  pick(ai) {
    this.picked = core.AIS.includes(ai) && ai !== this.chatAI() ? ai : null;
    this.push();
    this.load(this.current());
  }
  // The chat's model changed (chat.onChoice): another AI → its plugins show.
  chatChanged() {
    const now = this.chatAI();
    if (now === this.followed) return;
    this.followed = now; this.picked = null;
    this.push();
    if (this.views.size) this.load(this.current());
  }

  // Read an AI's plugins (again after a minute, or when asked).
  load(ai, force) {
    if (!ai) return Promise.resolve();
    const c = this.cache[ai] || (this.cache[ai] = { version: 0 });
    if (c.loading) return c.loading;
    if (!force && c.at && Date.now() - c.at < FRESH_MS) return Promise.resolve();
    c.loading = (async () => {
      this.push();
      const p = this.program(ai), t = Date.now();
      const r = p.bin ? await core.list(ai, p) : { error: "not installed" };
      log(`plugins: ${ai} listed in ${Date.now() - t} ms${r.error ? ` (${r.error})` : `: ${r.installed.length} installed, ${r.available.length} to add`}`);
      c.at = Date.now(); c.error = r.error || "";
      if (!r.error) { c.data = r; c.version++; }
    })().catch((e) => { c.error = e.message; }).finally(() => { c.loading = null; this.push(); this.refreshDetails(); });
    return c.loading;
  }

  state() {
    const ai = this.current(), c = (ai && this.cache[ai]) || {};
    const fullSetup = vscode.workspace.getConfiguration("kural").get("chat.fullClaudeCodeSetup") !== false;
    return { type: "state", ai, chatAI: this.chatAI(), ais: core.AIS.map((id) => ({ id, name: NAMES[id] })), names: NAMES,
      loading: !!c.loading, error: c.error && c.error !== "not installed" ? c.error : "", notSetUp: !!ai && !this.program(ai).bin,
      can: ai ? core.CAN[ai] : null, fullSetupOff: ai === "claude" && !fullSetup,
      installed: c.data ? c.data.installed : [], marketplaces: c.data ? c.data.marketplaces : [], availableCount: c.data ? c.data.available.length : 0,
      version: c.version || 0, busy: (ai && this.busy[ai]) || {} };
  }
  // To every view: the state, and the list of plugins to add when it changed (3,500 for Claude: sent once per version).
  push() {
    const st = this.state(), c = st.ai && this.cache[st.ai];
    for (const v of this.views.values()) {
      v.webview.postMessage(st);
      if (c && c.data && v.sent[st.ai] !== c.version) { v.sent[st.ai] = c.version; v.webview.postMessage({ type: "available", ai: st.ai, version: c.version, items: c.data.available }); }
    }
  }
  setBusy(ai, key, words) {
    const b = this.busy[ai] || (this.busy[ai] = {});
    if (words) b[key] = words; else delete b[key];
    this.push(); this.postDetails();
  }

  resolve(id, view) {
    view.sent = {};
    this.views.set(id, view);
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, "plugins.js");
    view.webview.onDidReceiveMessage((m) => this.onMessage(m).catch((e) => log(`plugins: ${e.stack}`)));
    view.onDidChangeVisibility(() => { if (view.visible) this.load(this.current()); });
    view.onDidDispose(() => { if (this.views.get(id) === view) this.views.delete(id); });
  }
  html(webview, script) {
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const nonce = crypto.randomBytes(16).toString("base64"), uri = (f) => webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    return `<!doctype html><html data-fs="${fontScale()}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${uri("codicons/codicon.css")}"><link rel="stylesheet" href="${uri("plugins.css")}"></head>
<body data-vscode-context='{"preventDefaultContextMenuItems": true}'><div id="app"></div><script nonce="${nonce}" src="${uri(script)}"></script></body></html>`;
  }

  find(ai, id) {
    const d = this.cache[ai] && this.cache[ai].data;
    return d ? d.installed.find((x) => x.id === id) || d.available.find((x) => x.id === id) || null : null;
  }

  async onMessage(m) {
    const ai = this.current();
    switch (m.type) {
      case "ready": for (const v of this.views.values()) v.sent = {}; this.push(); this.load(ai); break;
      case "pick": this.pick(m.ai); break;
      case "install": case "uninstall": case "enable": case "disable": case "update": if (ai) await this.act(ai, m.type, m.id); break;
      case "details": if (ai) await this.openDetails(ai, m.id); break;
      case "addMarket": if (ai) await this.addMarket(ai); break;
      case "removeMarket": if (ai) await this.removeMarket(ai, m.name); break;
      case "addFolder": await this.addFolder(); break;
      case "addGit": await this.addGit(); break;
      case "setUp": vscode.commands.executeCommand("kural.getStarted", ai || undefined); break;
      case "fullSetup":
        await vscode.workspace.getConfiguration("kural").update("chat.fullClaudeCodeSetup", true, vscode.ConfigurationTarget.Global);
        if (this.chat) this.chat.setupChanged("switched to your full setup");
        this.push();
        break;
      case "openLink": this.openLink(m.url); break;
      case "log": log(`plugins page: ${m.message}`); break;
    }
  }
  openLink(url) { if (/^https?:\/\//i.test(String(url || ""))) vscode.commands.executeCommand("kural.browser.open", String(url)); }

  // A plugin's chats pick up the change (Claude's reload by themselves).
  changed(ai) { if (this.chat && this.chat.pluginsChanged) this.chat.pluginsChanged(ai); }

  async confirm(message, detail, button) {
    const r = await vscode.window.showWarningMessage(message, { modal: true, detail }, button);
    return r === button;
  }
  // It didn't work: what the program said, and its own command in a terminal (where it can ask you things).
  async failed(ai, what, args, error) {
    const run = args ? "Run It in a Terminal" : null;
    const r = await vscode.window.showErrorMessage(`Kural: ${SHORT[ai]} couldn't ${what}: ${error}`, ...(run ? [run] : []));
    if (r === run) {
      const p = this.program(ai);
      if (!p.bin) return;
      const t = vscode.window.createTerminal({ name: `${SHORT[ai]} plugins`, shellPath: p.bin, shellArgs: args, cwd: p.cwd, env: withProfileEnv({}) });
      t.show();
    }
  }

  // Install, remove, turn on or off, or update one plugin. accept: (Claude) the sha256 of a command you were shown.
  async act(ai, what, id, accept) {
    const pl = this.find(ai, id);
    if (!pl || (this.busy[ai] || {})[id]) return;
    if (what === "install" && !accept) {
      const from = [pl.source, this.marketLabel(ai, pl.marketplace)].filter(Boolean).join(" · ");
      if (!(await this.confirm(`Install ${pl.name} for ${SHORT[ai]}?`, `${from ? `From: ${from}\n\n` : ""}${RISK(ai)}`, "Install"))) return;
    }
    if (what === "uninstall" && !(await this.confirm(`Remove ${pl.name} from ${SHORT[ai]}?`, `${SHORT[ai]}'s chats won't use it any more.`, "Remove"))) return;
    this.setBusy(ai, id, DOING[what]);
    let r;
    try { r = await core.act(ai, this.program(ai), what, { id, accept }); }
    catch (e) { r = { error: e.message }; }
    finally { this.setBusy(ai, id, null); }
    if (r.confirm) {
      // (Claude: its marketplace runs this command to install it; Claude Code wants a person to see it first.)
      if (await this.confirm(`${pl.name} is installed by running a command`, `Its marketplace runs this command on your computer:\n\n${r.confirm.command}\n\nRun it only if you trust where it comes from.`, "Run and Install"))
        return this.act(ai, what, id, r.confirm.sha256);
      return;
    }
    if (r.error) {
      const plain = { install: ai === "codex" ? ["plugin", "add", id] : ["plugin", "install", id], uninstall: ai === "codex" ? ["plugin", "remove", id] : ["plugin", "uninstall", id] }[what];
      this.failed(ai, { install: `install ${pl.name}`, uninstall: `remove ${pl.name}`, enable: `turn ${pl.name} on`, disable: `turn ${pl.name} off`, update: `update ${pl.name}` }[what], ai === "agy" ? null : plain || ["plugin", what, id], r.error);
    } else {
      if (what === "update" && r.message) vscode.window.setStatusBarMessage(`Kural: ${r.message}`, 6000);
      this.changed(ai);
    }
    await this.load(ai, true);
  }
  marketLabel(ai, name) {
    const d = this.cache[ai] && this.cache[ai].data, m = d && d.marketplaces.find((x) => x.name === name);
    return m ? m.label : name || "";
  }

  async addMarket(ai) {
    const v = await vscode.window.showInputBox({ title: `Add a plugin marketplace to ${SHORT[ai]}`, ignoreFocusOut: true,
      prompt: "owner/repo (a GitHub repository), an https:// Git address, or the full path of a folder", placeHolder: "obra/superpowers-marketplace",
      validateInput: (s) => s.trim() ? core.marketSource(s).error || null : null });
    if (!v || !v.trim()) return;
    this.setBusy(ai, "market:+", "Adding…");
    let r;
    try { r = await core.market(ai, this.program(ai), "add", { source: v.trim() }); } catch (e) { r = { error: e.message }; }
    finally { this.setBusy(ai, "market:+", null); }
    if (r.error) this.failed(ai, "add that marketplace", ["plugin", "marketplace", "add", "--", v.trim()], r.error);
    await this.load(ai, true);
  }
  async removeMarket(ai, name) {
    const d = this.cache[ai] && this.cache[ai].data, m = d && d.marketplaces.find((x) => x.name === name);
    if (!m || !m.removable) return;
    const from = d.installed.filter((x) => x.marketplace === name).map((x) => x.name);
    if (!(await this.confirm(`Remove the marketplace ${name} from ${SHORT[ai]}?`, from.length ? `Plugins installed from it: ${from.join(", ")}. ${SHORT[ai]} may remove them too.` : "Its plugins won't be listed any more.", "Remove"))) return;
    this.setBusy(ai, `market:${name}`, "Removing…");
    let r;
    try { r = await core.market(ai, this.program(ai), "remove", { name }); } catch (e) { r = { error: e.message }; }
    finally { this.setBusy(ai, `market:${name}`, null); }
    if (r.error) this.failed(ai, `remove ${name}`, ["plugin", "marketplace", "remove", "--", name], r.error);
    else if (from.length) this.changed(ai);
    await this.load(ai, true);
  }

  // ---------- Gemini: from a folder or a Git address ----------
  async addFolder() {
    const f = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: "Add to Gemini", title: "The plugin's folder" });
    if (f && f[0]) await this.addAgy(f[0].fsPath, f[0].fsPath);
  }
  async addGit() {
    const url = await vscode.window.showInputBox({ title: "Add a plugin to Gemini from a Git repository", ignoreFocusOut: true,
      prompt: "The https:// address of the plugin's repository (Kural downloads it, and Antigravity checks it first)", placeHolder: "https://github.com/obra/superpowers",
      validateInput: (s) => !s.trim() || core.gitUrl(s) ? null : "Give an https:// address." });
    if (!url || !url.trim()) return;
    this.setBusy("agy", "add", "Downloading…");
    let c;
    try { c = await core.cloneForAgy(this.program("agy"), url.trim(), require("../paths").privateTmp("plugins")); }
    catch (e) { c = { error: e.message }; }
    finally { this.setBusy("agy", "add", null); }
    if (c.error) return this.failed("agy", "download that plugin", null, c.error);
    try { await this.addAgy(c.dir, url.trim(), c); } finally { c.done(); }
  }
  async addAgy(dir, from, checked) {
    const p = this.program("agy");
    if (!p.bin) return vscode.commands.executeCommand("kural.getStarted", "agy");
    const c = checked || await core.checkFolder(p, dir);
    if (c.error || c.errors.length) return this.failed("agy", "use that folder", null, c.error || c.errors[0]);
    const notes = c.warnings.length ? `\n\nAntigravity's notes: ${c.warnings.slice(0, 3).join("; ")}${c.warnings.length > 3 ? "; …" : ""}` : "";
    if (!(await this.confirm(`Add ${c.name || "this plugin"} to Gemini?`, `From: ${from}\nIt adds: ${adds(c.components)}.${notes}\n\n${RISK("agy")}`, "Add"))) return;
    this.setBusy("agy", "add", "Adding…");
    let r;
    try { r = await core.installFolder(p, dir); } catch (e) { r = { error: e.message }; }
    finally { this.setBusy("agy", "add", null); }
    if (r.error) this.failed("agy", `add ${c.name || "the plugin"}`, null, r.error);
    else this.changed("agy");
    await this.load("agy", true);
  }

  // ---------- the details tab (like an extension's page) ----------
  async openDetails(ai, id) {
    const pl = this.find(ai, id);
    if (!pl) return;
    if (!this.details) {
      const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
      const panel = vscode.window.createWebviewPanel("kural.pluginDetails", pl.name, vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [media] });
      panel.iconPath = vscode.Uri.joinPath(media, "plugins-icon.svg");
      panel.webview.html = this.html(panel.webview, "plugin-details.js");
      this.details = { panel, ai, id, seq: 0, info: null };
      panel.webview.onDidReceiveMessage((m) => this.onDetailsMessage(m).catch((e) => log(`plugin details: ${e.stack}`)));
      panel.onDidDispose(() => { this.details = null; });
    }
    Object.assign(this.details, { ai, id, info: null, infoKey: null });
    this.details.panel.title = pl.name;
    this.details.panel.reveal();
    this.refreshDetails();
  }
  postDetails() {
    const d = this.details;
    if (!d) return;
    const pl = this.find(d.ai, d.id);
    d.panel.webview.postMessage({ type: "details", ai: d.ai, aiName: NAMES[d.ai], plugin: pl, can: core.CAN[d.ai], info: d.info,
      busy: (this.busy[d.ai] || {})[d.id] || "", market: pl ? this.marketLabel(d.ai, pl.marketplace) : "", risk: RISK(d.ai) });
  }
  // The plugin as listed now, and what it adds (asked again when it was just installed).
  async refreshDetails() {
    const d = this.details;
    if (!d) return;
    const pl = this.find(d.ai, d.id), seq = ++d.seq, key = pl ? `${pl.id}|${pl.installed}|${pl.fullVersion}` : "";
    if (d.infoKey !== key) d.info = null;
    this.postDetails();
    if (!pl || !pl.installed || d.infoKey === key) return;
    const info = await core.details(d.ai, this.program(d.ai), pl).catch(() => ({}));
    if (this.details !== d || d.seq !== seq) return;
    d.info = info; d.infoKey = key;
    this.postDetails();
  }
  async onDetailsMessage(m) {
    const d = this.details;
    if (!d) return;
    switch (m.type) {
      case "ready": this.postDetails(); break;
      case "install": case "uninstall": case "enable": case "disable": case "update": await this.act(d.ai, m.type, d.id); break;
      case "openLink": this.openLink(m.url); break;
    }
  }
}

module.exports = { Plugins, NAMES };
