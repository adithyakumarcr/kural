// The Connectors tab: the connectors (MCP servers) of the AI your chat uses, in the side bar beside Extensions and
// Plugins ("Extensions | Plugins | Connectors"; Adithya, 22 Oct 2026: they were on each AI's page in Kural Settings).
// The work is lib/ai/connectors.js (list, add, remove: each AI's own `mcp` commands), connectors-off.js (on/off
// everywhere in Kural) and connector-catalog.js (Add connector: a list you search). This file is the view.
// Where it shows:
//   - in VS Code's Extensions side bar, as its third tab (scripts/rebrand.py add_plugins_tab; its command
//     _kural.extensionsTabs answers { tabs } with "connectors" in it when the patch has the tab).
//   - without that patch: view "kural.connectorsAlone", in the Plugins side bar of its own.
// The page (media/connectors.js) follows the chat's model: Claude's connectors for a Claude model, ChatGPT's for
// Codex. Gemini and a model on this computer have none Kural can manage: the page says so, and you can pick another.
const vscode = require("vscode");
const os = require("os");
const crypto = require("crypto");
const brain = require("../ai");
const connectors = require("../ai/connectors");
const connectorsOff = require("../ai/connectors-off");
const catalog = require("../ai/connector-catalog");
const { withProfileEnv, profileEnv } = require("../profiles/env");
const { fontScale, watchFontScale } = require("../ui");
const { log } = require("../log");

const AIS = ["claude", "codex"];
const NAMES = { claude: "Claude", codex: "ChatGPT (Codex)" };
const FRESH_MS = 60000;   // a list read less than a minute ago is shown as it is (Refresh reads it again)
// Connector keys: a private folder per profile (its accounts), never on a command line (APP-9).
const keyDir = () => require("../profiles/scope").dir("connector-keys", "account");

class Connectors {
  constructor(context, { chat }) {
    this.context = context;
    this.chat = chat;
    this.views = new Map();   // view id → WebviewView
    this.conn = {};           // ai → { loading, servers, error, at, busy, fresh }
    this.items = {};          // ai → { id: catalog item } of the last search (what "Add" refers to: the page sends only an id)
    this.picked = null;       // an AI you picked on the page (null: the chat's)
    this.followed = this.chatAI();
    this.patched = false;     // the Extensions side bar has the Connectors tab (rebrand.py)
  }

  register() {
    const c = this.context;
    for (const id of ["kural.connectors", "kural.connectorsAlone"])
      c.subscriptions.push(vscode.window.registerWebviewViewProvider(id, { resolveWebviewView: (v) => this.resolve(id, v) }, { webviewOptions: { retainContextWhenHidden: true } }));
    c.subscriptions.push(
      vscode.commands.registerCommand("kural.connectors.show", (ai) => this.show(ai)),
      vscode.commands.registerCommand("kural.connectors.refresh", () => this.load(this.current(), true)),
      vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration("kural.chat.fullClaudeCodeSetup")) this.push(); }),
    );
    watchFontScale(c, (m) => { for (const v of this.views.values()) v.webview.postMessage(m); });
    this.detect();
  }

  // Is the Extensions side bar's Connectors tab there? (An older patch has only Extensions | Plugins.)
  async detect() {
    try {
      const has = (await vscode.commands.getCommands(false)).includes("_kural.extensionsTabs");
      const r = has ? await vscode.commands.executeCommand("_kural.extensionsTabs") : null;
      this.patched = !!(r && Array.isArray(r.tabs) && r.tabs.includes("connectors"));
    } catch { this.patched = false; }
    vscode.commands.executeCommand("setContext", "kural.connectorsAlone", !this.patched);
  }

  // "Kural: Show Connectors" (ai: whose, optional): Kural Settings' AI pages link here.
  async show(ai) {
    if (AIS.includes(ai)) this.pick(ai);
    if (this.patched) {
      await vscode.commands.executeCommand("workbench.view.extensions");
      await vscode.commands.executeCommand("_kural.extensionsTabs", "connectors");
    } else await vscode.commands.executeCommand("kural.connectorsAlone.focus");
  }

  // Each AI's program and the environment to run it in (for its connectors).
  program(id) {
    if (id === "claude") { const c = require("../ai/claude"); return { bin: c.findClaude(), env: c.cleanEnv() }; }
    return { bin: brain.cli && brain.cli[id] ? brain.cli[id].bin : null, env: withProfileEnv() };   // (Codex: this profile's CODEX_HOME)
  }
  // The project folder, when you trust it (Claude then lists the project's own connectors too, and starts them to check).
  projectDir() {
    const f = vscode.workspace.workspaceFolders;
    return vscode.workspace.isTrusted && f && f.length && f[0].uri.scheme === "file" ? f[0].uri.fsPath : undefined;
  }
  // The chat's AI: claude | codex | agy | ollama.
  chatAI() { try { return brain.engineOf(brain.currentModel()); } catch { return "claude"; } }
  current() { return this.picked || (AIS.includes(this.chatAI()) ? this.chatAI() : null); }
  pick(ai) {
    this.picked = AIS.includes(ai) && ai !== this.chatAI() ? ai : null;
    this.push();
    this.load(this.current());
  }
  // The chat's model changed (chat.onChoice): another AI → its connectors show.
  chatChanged() {
    const now = this.chatAI();
    if (now === this.followed) return;
    this.followed = now; this.picked = null;
    this.push();
    if (this.views.size) this.load(this.current());
  }

  // List an AI's connectors (Claude checks each one, which takes a few seconds).
  async load(id, force) {
    if (!id || !connectors.SUPPORTED[id]) return;
    const c = this.conn[id] || (this.conn[id] = {});
    if (c.loading || (!force && c.at && Date.now() - c.at < FRESH_MS)) return;
    c.loading = true; this.push();
    try {
      const { bin, env } = this.program(id);
      if (!bin) { Object.assign(c, { servers: [], error: "", at: Date.now() }); return; }
      const r = await connectors.list(id, bin, env, this.projectDir());
      // A connector just added that you sign in to: say so until it's signed in (Codex can't always tell: "unknown").
      for (const x of r.servers || []) if ((c.fresh || {})[x.name] && !x.needsAuth && (id === "codex" ? !/o.?auth|bearer/i.test(x.auth || "") : !x.ok)) {
        x.needsAuth = true; if (id === "codex") { x.status = "Needs sign-in"; x.ok = false; }
      }
      Object.assign(c, r, { error: r.error || "", at: Date.now() });
    }
    catch (e) { Object.assign(c, { servers: [], error: e.message, at: Date.now() }); }
    finally { c.loading = false; this.push(); }
  }
  // After a connector was added or removed: Claude's chats start again with it (same conversations); Codex reads its
  // settings when it starts, so the next Codex chat has it.
  afterChange(id) {
    if (this.chat) { if (id === "claude") this.chat.setupChanged("connectors changed"); else this.chat.pluginsChanged(id); }
    this.load(id, true);
  }

  state() {
    const ai = this.current(), c = (ai && this.conn[ai]) || {};
    return { type: "state", ai, chatAI: this.chatAI(), ais: AIS.map((id) => ({ id, name: NAMES[id] })),
      notSetUp: !!ai && !this.program(ai).bin, loading: !!c.loading, busy: !!c.busy, error: c.error || "",
      servers: (c.servers || []).map((x) => ({ ...x, off: connectorsOff.isOff(ai, x.name) })), listed: !!c.at,
      fullSetup: vscode.workspace.getConfiguration("kural").get("chat.fullClaudeCodeSetup") !== false };
  }
  push() { const st = this.state(); for (const v of this.views.values()) v.webview.postMessage(st); }
  reply(m) { for (const v of this.views.values()) v.webview.postMessage(m); }

  resolve(id, view) {
    this.views.set(id, view);
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = crypto.randomBytes(16).toString("base64"), uri = (f) => view.webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    view.webview.html = `<!doctype html><html data-fs="${fontScale()}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; font-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${uri("codicons/codicon.css")}"><link rel="stylesheet" href="${uri("connectors.css")}"></head>
<body data-vscode-context='{"preventDefaultContextMenuItems": true}'><div id="app"></div><script nonce="${nonce}" src="${uri("connectors.js")}"></script></body></html>`;
    view.webview.onDidReceiveMessage((m) => this.onMessage(m).catch((e) => { log(`connectors: ${e.stack}`); vscode.window.showErrorMessage(`Kural: ${e.message}`); }));
    view.onDidChangeVisibility(() => { if (view.visible) this.load(this.current()); });
    view.onDidDispose(() => { if (this.views.get(id) === view) this.views.delete(id); });
  }

  async onMessage(m) {
    const ai = AIS.includes(m.id) ? m.id : this.current();
    const open = (url) => /^https:\/\//.test(url || "") && vscode.env.openExternal(vscode.Uri.parse(url));
    switch (m.type) {
      case "ready": this.push(); this.load(this.current()); break;
      case "pick": this.pick(m.ai); break;
      case "refresh": await this.load(this.current(), true); break;
      case "setUp": vscode.commands.executeCommand("kural.getStarted", ai || undefined); break;
      // On/off for a connector, everywhere in Kural (lib/ai/connectors-off.js). Chats start again with it (same conversations)
      // when they're not busy; the Jira helper starts again at its next search.
      case "connectorOff": {
        if (!ai || !(await connectorsOff.set(ai, String(m.name || ""), !!m.off))) break;
        log(`connectors: ${m.name} (${ai}) turned ${m.off ? "off" : "on"} in Kural`);
        if (this.chat) {
          if (ai === "claude") { this.chat.setupChanged(`connector ${m.off ? "turned off" : "turned on"}`); if (this.chat.tickets) this.chat.tickets.stop(); }
          else this.chat.pluginsChanged(ai);
        }
        this.push();
        break;
      }
      case "addConnector": case "removeConnector": {
        if (!ai) break;
        const c = this.conn[ai] || (this.conn[ai] = {});
        if (c.busy) break;
        c.busy = true; this.push();
        let r;
        try {
          const { bin, env } = this.program(ai);
          r = m.type === "addConnector" ? await connectors.add(ai, bin, env, m.connector || {}) : await connectors.remove(ai, bin, env, m.name, this.projectDir(), keyDir());
        } catch (e) { r = { error: e.message }; } finally { c.busy = false; }
        this.reply({ type: "connectorDone", id: ai, reqId: m.reqId, error: r.error || "" });
        if (r.ok) this.afterChange(ai); else this.push();
        break;
      }
      case "catalogSearch": {
        if (!ai) break;
        const r = await catalog.search(m.query);
        const map = this.items[ai] = this.items[ai] || {};
        for (const it of r.items) map[it.id] = it;
        this.reply({ type: "catalogResults", id: ai, reqId: m.reqId, note: r.note, items: r.items.map((it) => catalog.forAi(ai, it)) });
        break;
      }
      case "addCatalog": {
        if (!ai) break;
        const c = this.conn[ai] || (this.conn[ai] = {});
        const item = catalog.BUILT_IN.find((b) => b.id === m.item) || (this.items[ai] || {})[m.item];
        if (c.busy) break;
        let r;
        if (!item) r = { error: "Search again, then add it." };
        else {
          c.busy = true;
          try {
            const { bin, env } = this.program(ai);
            // (The names already there, fresh: a name taken since the page listed them would make the program refuse.)
            const have = (await connectors.list(ai, bin, env, this.projectDir())).servers.map((x) => x.name);
            r = await connectors.addItem(ai, bin, env, item, m.values || {}, have, keyDir());
          } catch (e) { r = { error: e.message }; } finally { c.busy = false; }
        }
        if (r.ok && item.signIn) (c.fresh = c.fresh || {})[r.name] = true;
        this.reply({ type: "catalogDone", id: ai, item: m.item, reqId: m.reqId, error: r.error || "", name: r.name || "" });
        if (r.ok) this.afterChange(ai);
        break;
      }
      case "pickFolder": {
        const f = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: "Choose folder",
          defaultUri: vscode.Uri.file(os.homedir()) });
        this.reply({ type: "folder", reqId: m.reqId, path: f && f[0] ? f[0].fsPath : "" });
        break;
      }
      case "openLink": open(m.url); break;
      case "signIn": {
        if (!ai) break;
        const args = connectors.signInArgs(ai, m.name), { bin } = this.program(ai);
        if (!args || !bin) break;
        const t = vscode.window.createTerminal({ name: `Sign in to ${m.name}`, shellPath: bin, shellArgs: args, cwd: os.tmpdir(), env: profileEnv() });
        t.show();
        break;
      }
      case "fullSetup":
        await vscode.workspace.getConfiguration("kural").update("chat.fullClaudeCodeSetup", !!m.on, vscode.ConfigurationTarget.Global);
        if (this.chat) this.chat.setupChanged(m.on ? "switched to your full setup" : "switched to the minimal setup");
        this.push();
        break;
      case "reloadSetup": if (this.chat) this.chat.setupChanged("reload asked for"); this.load("claude", true); break;
      case "log": log(`connectors page: ${m.message}`); break;
    }
  }
}

module.exports = { Connectors, NAMES, AIS };
