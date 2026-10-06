// Your accounts, in the status bar:
//   - the usage meter: for the chat's AI in words, "Claude 5h 45% · resets 42m | Weekly 24% · resets 3d 4h"; the others
//     short, "Codex 12% · 3%",
//     "Gemini 13% · 1%" (Antigravity's weekly limits). Orange from 80 %, red from 95 %. It comes from lib/ai/usage.js, which the
//     programs themselves fill: Claude Code reports its limits after every answer, Codex's app server on request.
//     Clicking it opens the AI Usage panel at the bottom (lib/usage-panel.js).
//   - the Account item (person icon): opens the Kural Settings tab (lib/settings-page.js): per AI who's logged in,
//     plan, usage, usage page, switch account, log out, log in; your own model; updates, Get started, the guide.
//     (It was a long pop-up list; Adithya found it too cluttered.) Logging in and out is done here.
//
// Kural never reads a login itself: it asks the programs (`claude auth status`, Codex's `account/read`, agy's
// `/model`). (The Claudemeter extension Kural used to include read Claude's login from the macOS
// Keychain, which asked for permission again after every update and then failed.)

const vscode = require("vscode");
const { findClaude, cleanEnv, log } = require("./ai/claude");
const checks = require("./ai/claude-checks");
const usage = require("./ai/usage");
const brain = require("./ai");
const { CLIS, IDS: CLI_IDS } = require("./ai/clis");
const { accountName } = require("./ai/names");

const USAGE = { claude: "https://claude.ai/settings/usage", apiKey: "https://console.anthropic.com/settings/usage" };
const SAVED = "kural.usage.v1";
const NAMES = { claude: "Claude", agy: "Gemini", codex: "Codex" };

class Account {
  // getStarted: lib/getstarted.js; onSwitched(): Claude's running processes start again with the new login.
  constructor(context, getStarted, onSwitched = () => {}) {
    this.context = context;
    this.gs = getStarted;
    this.onSwitched = onSwitched;
    this.auth = null;                   // Claude: the last `auth status` answer (claude-checks.js claudeAuth)
    this.cliAuth = {};                  // codex / agy: their last answer
    this.item = vscode.window.createStatusBarItem("kural.account", vscode.StatusBarAlignment.Right, 101);
    this.item.name = "Kural Account";
    this.item.command = "kural.account";
    this.meters = {};                   // provider -> status bar item
    this.listeners = [];                // the Kural Settings page: redrawn when who's logged in changes
    this.page = null;                   // lib/settings-page.js (set in extension.js)
  }

  onChange(f) { this.listeners.push(f); }

  register() {
    this.context.subscriptions.push(this.item, vscode.commands.registerCommand("kural.account", () => this.page && this.page.open()),
      vscode.commands.registerCommand("kural.refreshUsage", () => this.refreshUsage(true)));
    this.gs.onChange(() => {
      // A new login passed its test: Claude's chat processes start again, with it. (Not at log out: a process started
      // then would still be the logged-out one after you log in.)
      if (this.relogin && this.gs.claudeReady) { this.relogin = false; this.onSwitched(); }
      this.update();
    });
    // The usage meter: last numbers right away (saved), new ones as the programs report them.
    usage.restore(this.context.globalState.get(SAVED));
    let saveTimer = null;
    this.context.subscriptions.push(usage.onChange(() => {
      this.drawMeters();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => this.context.globalState.update(SAVED, usage.snapshot()), 2000);
    }));
    const tick = setInterval(() => this.drawMeters(), 60 * 1000);   // ("resets in …" and windows that reset)
    const limits = setInterval(() => this.refreshUsage(false), 10 * 60 * 1000);
    this.context.subscriptions.push({ dispose: () => { clearInterval(tick); clearInterval(limits); } });
    this.draw();
    this.drawMeters();
    this.item.show();
    setTimeout(() => { this.update(); this.refreshUsage(false); }, 4000);   // (not during startup: they start programs)
  }

  // ---------- who's logged in ----------
  async update() {
    const bin = this.gs.passed ? findClaude() : null;
    this.auth = bin ? await checks.claudeAuth(bin, cleanEnv({})).catch(() => null) : null;
    if (this.auth && this.auth.loggedIn) this.auth.name = accountName("claude", this.auth.email);
    for (const id of CLI_IDS) {
      const c = brain.cli[id];
      this.cliAuth[id] = c.ready && c.bin ? await CLIS[id].auth(c.bin).catch(() => null) : null;
      if (this.cliAuth[id] && this.cliAuth[id].loggedIn) this.cliAuth[id].name = accountName(id, this.cliAuth[id].email);
    }
    this.draw();
    return this.auth;
  }

  // The status item shows whose account the chat's AI uses: the name on it ("Peasant Adithya"), else its email, else
  // the plan. (It showed the plan, "Team", which says little about whose account it is.) The tooltip lists them all.
  draw() {
    const a = this.auth;
    const lines = [];
    const shown = { claude: a && a.loggedIn ? a : null };
    if (a && a.loggedIn) {
      lines.push(`Claude: ${[a.name, a.email || a.method || "logged in"].filter(Boolean).join(" · ")}${a.plan ? ` (Claude ${a.plan})` : ""}`);
    } else if (a && a.loggedIn === false) lines.push("Claude: not logged in");
    else if (this.gs.passed) lines.push("Claude: set up");
    for (const id of CLI_IDS) {
      const c = this.cliAuth[id];
      if (c && c.loggedIn) { shown[id] = c; lines.push(`${CLIS[id].label}: ${[c.name, c.email, c.plan || c.method].filter(Boolean).join(" · ") || "logged in"}`); }
      else if (c && c.loggedIn === false) lines.push(`${CLIS[id].label}: not logged in`);
    }
    const mine = shown[engineOf()] || Object.values(shown).find(Boolean);
    const label = mine ? (mine.name || mine.email || mine.plan || "") : "";
    const text = label ? `$(account) ${label.length > 28 ? label.slice(0, 27) + "…" : label}` : "$(account)";
    if (this.gs.localModel) lines.push(`Your own model: ${this.gs.localModel.slice("ollama:".length)}`);
    if (!lines.length) lines.push("Nothing set up yet");
    this.item.text = text;
    this.item.tooltip = `${lines.join("\n")}\n\nClick for Kural Settings: accounts, usage, switch account, log out, updates`;
    for (const f of this.listeners) f();
  }

  // ---------- the usage meter ----------
  // Claude: its numbers come with every answer; "Refresh" asks with one tiny request. Codex: asked directly (free).
  async refreshUsage(byHand) {
    const jobs = [];
    for (const id of CLI_IDS) { const c = brain.cli[id]; if (c.ready && c.bin) jobs.push(CLIS[id].limits(c.bin).catch(() => null)); }
    if (byHand && this.gs.claudeReady) {
      const bin = findClaude();
      if (bin) jobs.push(checks.claudeTest(bin, cleanEnv({}), { cwd: require("./workspace").workDir() }).catch(() => null));
    }
    await Promise.all(jobs);
    this.drawMeters();
  }

  drawMeters() {
    for (const id of Object.keys(NAMES)) {
      const u = usage.current(id);
      const show = u && ((u.windows || []).length || (u.tokens && u.tokens.input + u.tokens.output));
      let item = this.meters[id];
      if (!show) { if (item) item.hide(); continue; }
      if (!item) {
        item = this.meters[id] = vscode.window.createStatusBarItem(`kural.usage.${id}`, vscode.StatusBarAlignment.Right, 102);
        item.name = `${NAMES[id]} usage`;
        item.command = "kural.showUsage";   // the AI Usage panel at the bottom: every limit in words
        this.context.subscriptions.push(item);
      }
      const windows = u.windows || [];
      const top = windows.length ? Math.max(...windows.map((w) => w.usedPercent)) : 0;
      // The chat's AI in words ("Claude 5-hour 50% · resets 42m | Weekly 25% · resets 3d 4h"); the others short
      // ("Codex 12% · 3%"), so the status bar doesn't fill up.
      const mine = engineOf() === id;
      item.text = !windows.length ? `$(dashboard) ${NAMES[id]} ${tokens(u.tokens.input + u.tokens.output)} tok`
        : mine ? `$(dashboard) ${NAMES[id]} ${windows.slice(0, 2).map((w) => `${shortName(w)} ${Math.round(w.usedPercent)}%${w.resetsAt ? ` · resets ${usage.until(w.resetsAt, Date.now(), true)}` : ""}`).join(" | ")}`
        : `$(dashboard) ${NAMES[id]} ${windows.slice(0, 2).map((w) => `${Math.round(w.usedPercent)}%`).join(" · ")}`;
      item.backgroundColor = top >= 95 ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : top >= 80 ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
      const md = new vscode.MarkdownString(`**${NAMES[id]} usage**\n\n` +
        (windows.length ? windows.map((w) => `${usage.limitName(w)}: **${Math.round(w.usedPercent)}%** used${w.resetsAt ? `, resets ${when(w.resetsAt)}` : ""}`).join("  \n")
          : `Today: ${tokens(u.tokens.input)} tokens in, ${tokens(u.tokens.output)} out`) +
        `\n\n_Updated ${ago(u.at)}. Click for the AI Usage panel._`);
      item.tooltip = md;
      item.show();
    }
  }

  // ---------- Claude: log out, switch ----------
  async logOut(quietly = false) {
    if (!quietly) {
      const ok = await vscode.window.showWarningMessage("Log out of Claude?", {
        modal: true, detail: "This logs out Claude Code on this computer (also in the terminal). Kural's Claude models wait until you log in again; your other models keep working." }, "Log out");
      if (ok !== "Log out") return false;
    }
    const bin = findClaude();
    if (!bin) { vscode.window.showWarningMessage("Kural can't find Claude Code."); return false; }
    const r = await checks.claudeLogout(bin, cleanEnv({}));
    log(`account: log out: ${r.ok ? "done" : r.error}`);
    if (!r.ok) { vscode.window.showErrorMessage(`Kural couldn't log out: ${r.error}`); return false; }
    this.auth = { loggedIn: false };
    this.draw();
    this.relogin = true;
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

  // ---------- Gemini, Codex: log out, switch ----------
  async logOutCli(id, quietly = false) {
    const C = CLIS[id];
    if (!quietly) {
      const ok = await vscode.window.showWarningMessage(`Log out of ${C.short}?`, {
        modal: true, detail: `This logs out ${C.program} on this computer (also in the terminal). Kural stops using ${C.short} until you log in again.` }, "Log out");
      if (ok !== "Log out") return false;
    }
    const r = await C.logout(brain.cli[id].bin).catch((e) => ({ error: e.message }));
    log(`account: ${id} log out: ${r && r.error ? r.error : "done"}`);
    if (r && r.error) { vscode.window.showErrorMessage(`Kural couldn't log out of ${C.short}: ${r.error}`); return false; }
    this.cliAuth[id] = { loggedIn: false };
    await this.gs.forgetCli(id);
    this.onSwitched();
    this.draw();
    return true;
  }

  async switchCli(id) {
    const C = CLIS[id], was = this.cliAuth[id] && this.cliAuth[id].email;
    const ok = await vscode.window.showInformationMessage(`Switch to another ${C.short} account?`, {
      modal: true, detail: `Kural logs ${was || "this account"} out, then starts ${C.program}'s login in a terminal. Log in there with the other account.` }, "Switch account");
    if (ok !== "Switch account") return;
    if (!(await this.logOutCli(id, true))) return;
    await this.gs.signInCli(id);
  }
}

// The chat's AI right now: "claude", "codex", "agy" (or "ollama").
function engineOf() { try { return brain.engineOf(brain.currentModel()); } catch { return "claude"; } }
// "5-hour" → "5h", "Week" → "Weekly", "Gemini" (a weekly limit) → "Gemini weekly".
function shortName(w) {
  const l = String(w.label || "");
  if (w.period === "week") return `${l} weekly`;
  const h = /^(\d+)-hour$/.exec(l); if (h) return `${h[1]}h`;
  return /^week/i.test(l) ? `Weekly${l.slice(4)}` : l;
}
const tokens = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n || 0);
function ago(t) {
  const s = Math.round((Date.now() - (t || Date.now())) / 1000);
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString();
}
// "in 2 h 10 min", or the day and time when it's further away.
function when(t) {
  const m = Math.round((t - Date.now()) / 60000);
  if (m <= 0) return "now";
  if (m < 60) return `in ${m} min`;
  if (m < 24 * 60) return `in ${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
  return new Date(t).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

module.exports = { Account, USAGE, _test: { tokens, when, ago, shortName } };
