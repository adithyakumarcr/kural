// The Account item in the status bar (person icon): who Kural's Claude is logged in as, and a menu to see usage,
// switch account, log out or log in, plus your own model, Get started and updates.
//
// It asks `claude auth status --json` (Claude Code's own answer), so Kural never reads Claude's login itself. (The
// Claudemeter extension Kural used to include read it from the macOS Keychain, which asked for permission again after
// every update and then failed.)

const vscode = require("vscode");
const { findClaude, cleanEnv, log } = require("./ai/claude");
const checks = require("./ai/claude-checks");
const { WIKI, ISSUES } = require("./chat/guide");

const USAGE = { claude: "https://claude.ai/settings/usage", apiKey: "https://console.anthropic.com/settings/usage" };

class Account {
  // getStarted: lib/getstarted.js; onSwitched(): Claude's running processes start again with the new login.
  constructor(context, getStarted, onSwitched = () => {}) {
    this.context = context;
    this.gs = getStarted;
    this.onSwitched = onSwitched;
    this.auth = null;   // the last `auth status` answer (lib/ai/claude-checks.js claudeAuth)
    this.item = vscode.window.createStatusBarItem("kural.account", vscode.StatusBarAlignment.Right, 101);
    this.item.name = "Kural Account";
    this.item.command = "kural.account";
  }

  register() {
    this.context.subscriptions.push(this.item, vscode.commands.registerCommand("kural.account", () => this.menu()));
    this.gs.onChange(() => this.update());
    this.draw();
    this.item.show();
    setTimeout(() => this.update(), 3000);   // (not during startup: it starts a program)
  }

  // Ask Claude Code who's logged in (only when Claude is set up: before that there's nothing to ask).
  async update() {
    const bin = this.gs.passed ? findClaude() : null;
    this.auth = bin ? await checks.claudeAuth(bin, cleanEnv({})) : null;
    this.draw();
    return this.auth;
  }

  draw() {
    const a = this.auth;
    const local = this.gs.localModel;
    let text = "$(account)", tip;
    if (a && a.loggedIn) {
      if (a.plan) text = `$(account) ${a.plan}`;
      tip = `Claude: ${a.email || a.method || "logged in"}${a.plan ? ` (Claude ${a.plan})` : ""}${a.org ? `\n${a.org}` : ""}`;
    } else if (a && a.loggedIn === false) tip = "Claude: not logged in";
    else if (this.gs.passed) tip = "Claude: set up";
    else tip = "Claude: not set up";
    if (local) tip += `\nYour own model: ${local.slice("ollama:".length)}`;
    this.item.text = text;
    this.item.tooltip = `${tip}\n\nClick for your account: usage, switch account, log out, updates`;
  }

  async menu() {
    const qp = vscode.window.createQuickPick();
    qp.title = "Kural account";
    qp.placeholder = "Checking who's logged in…";
    qp.busy = true;
    qp.items = this.items();
    qp.show();
    qp.onDidHide(() => qp.dispose());
    qp.onDidAccept(() => { const it = qp.selectedItems[0]; qp.hide(); if (it && it.run) it.run(); });
    await this.update().catch((e) => log(`account: ${e.message}`));
    qp.busy = false;
    qp.placeholder = "";
    qp.items = this.items();
  }

  items() {
    const a = this.auth;
    const sep = (label) => ({ label, kind: vscode.QuickPickItemKind.Separator });
    const out = [sep("Claude")];
    if (!this.gs.passed) {
      out.push({ label: "$(rocket) Set up Claude", detail: "Use Kural with your Claude plan", run: () => this.gs.open("claude") });
    } else if (a && a.loggedIn) {
      out.push({ label: `$(account) ${a.email || a.method || "Logged in"}`, description: [a.plan && `Claude ${a.plan}`, a.org].filter(Boolean).join(" · "),
        detail: a.provider !== "firstParty" || a.apiKey ? `Logged in with ${a.method}` : undefined });
      if (a.provider === "firstParty") out.push({ label: "$(graph) See your usage", description: "opens in your browser", run: () => open(a.apiKey ? USAGE.apiKey : USAGE.claude) });
      out.push({ label: "$(arrow-swap) Switch account", detail: "Log out, then log in with another account", run: () => this.switchAccount() });
      out.push({ label: "$(sign-out) Log out", run: () => this.logOut() });
    } else if (a && a.loggedIn === false) {
      out.push({ label: "$(sign-in) Log in", detail: "Claude isn't logged in; your Claude models wait for it", run: () => this.gs.signIn() });
    } else {
      out.push({ label: "$(account) Claude is set up", description: "this Claude Code can't say who's logged in", run: () => this.gs.open("claude") });
    }
    out.push(sep("Your own model"));
    const local = this.gs.localModel;
    out.push(local
      ? { label: `$(server-environment) ${local.slice("ollama:".length)}`, description: "on this computer, with Ollama", run: () => this.gs.open("local") }
      : { label: "$(server-environment) Set up a model on this computer", detail: "Works offline, no account", run: () => this.gs.open("local") });
    out.push(sep("Kural"));
    out.push({ label: "$(rocket) Get started", run: () => this.gs.open() });
    out.push({ label: "$(sync) Check for updates", description: `you have ${this.context.extension.packageJSON.version}`, run: () => vscode.commands.executeCommand("kural.checkForUpdates") });
    out.push({ label: "$(book) Kural guide", description: "what every feature does", run: () => open(WIKI) });
    out.push({ label: "$(lightbulb) Ask for a feature", run: () => open(ISSUES) });
    return out;
  }

  async logOut(quietly = false) {
    if (!quietly) {
      const ok = await vscode.window.showWarningMessage("Log out of Claude?", {
        modal: true, detail: "This logs out Claude Code on this computer (also in the terminal). Kural's Claude models wait until you log in again; your own model keeps working." }, "Log out");
      if (ok !== "Log out") return false;
    }
    const bin = findClaude();
    if (!bin) { vscode.window.showWarningMessage("Kural can't find Claude Code."); return false; }
    const r = await checks.claudeLogout(bin, cleanEnv({}));
    log(`account: log out: ${r.ok ? "done" : r.error}`);
    if (!r.ok) { vscode.window.showErrorMessage(`Kural couldn't log out: ${r.error}`); return false; }
    this.auth = { loggedIn: false };
    this.draw();
    this.onSwitched();
    this.gs.loggedOut();
    return true;
  }

  async switchAccount() {
    const was = this.auth && this.auth.email;
    const ok = await vscode.window.showInformationMessage("Switch to another Claude account?", {
      modal: true, detail: `Kural logs ${was || "this account"} out, then opens the login in your browser. Log in there with the other account.` }, "Switch account");
    if (ok !== "Switch account") return;
    if (!(await this.logOut(true))) return;
    await this.gs.signIn();
  }
}

const open = (url) => vscode.env.openExternal(vscode.Uri.parse(url));

module.exports = { Account, USAGE };
