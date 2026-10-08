// Kural: Claude built into the editor, using your Claude login (no API key).
//   Tab          grey suggestions as you type or place the cursor; Tab accepts
//   Ctrl+L       chat on the right: tabs, Agent/Ask, model + intensity, multiple agents
//   Ctrl+K       edit the selected code in place, review it red/green
//   Ctrl+Alt+A   Ask on the left: find code by describing it
//   Ctrl+Esc     full Claude Code in a terminal beside your file
// Each feature lives in lib/; this file connects them.

const vscode = require("vscode");
const { initLog, log, findClaude, ClaudeSession } = require("./lib/ai/claude");
const { showLog } = require("./lib/log");
const { SPEEDS, COMPLETION_SYSTEM_PROMPT, completionProvider, triggerOnCursor } = require("./lib/tab/completion");
const { EDIT_SYSTEM_PROMPT, inlineEdit, applyCode } = require("./lib/edit/inline");
const { Updater } = require("./lib/updates");
const { terminalTab, TERMINAL_SYSTEM_PROMPT, INTENT_SYSTEM_PROMPT } = require("./lib/tab/terminal");
const { ReviewManager } = require("./lib/edit/review");
const { ChatView } = require("./lib/chat");
const { SearchView } = require("./lib/search");
const { TabPanel } = require("./lib/tab/panel");
const { LocalEngine } = require("./lib/tab/local");
const { Activity } = require("./lib/tab/activity");
const { GetStarted } = require("./lib/getstarted");
const { Account } = require("./lib/account");
const { SettingsPage } = require("./lib/settings-page");
const { Browser } = require("./lib/browser");
const { UsagePanel } = require("./lib/usage-panel");
const { Devices } = require("./lib/devices");
const { ModelRouter } = require("./lib/router");
const { RouterPanel } = require("./lib/router/panel");
const { RouterMemory } = require("./lib/router/learn");
const scmCommit = require("./lib/scm/commit");
const settingsIO = require("./lib/settings-io");
const { CrashLog } = require("./lib/crash");
const usageHub = require("./lib/ai/usage");
const brain = require("./lib/ai");
const ws = require("./lib/workspace");

const cfg = () => vscode.workspace.getConfiguration("kural");

let getStarted = null;   // the Get started page (lib/getstarted.js)

function openClaudeCode() {
  const bin = findClaude();
  if (!bin) return getStarted.open();
  // Start claude inside a normal shell, so if it stops (not logged in, no network) its
  // message stays on screen. Windows always gets PowerShell, so the command syntax is known.
  const win = process.platform === "win32";
  const t = vscode.window.createTerminal({
    name: "Claude Code",
    shellPath: win ? "powershell.exe" : undefined,
    // No folder open: Kural's work folder, never your home folder (Claude Code looks through the folder it starts in).
    cwd: ws.root() || ws.workDir(),
    location: { viewColumn: vscode.ViewColumn.Beside },
  });
  t.show();
  t.sendText(win ? `& "${bin}"` : `"${bin}"`);
}

let crashLog = null;
function activate(context) {
  initLog(context);
  // Crash reports: what went wrong when Kural last closed unexpectedly (lib/crash), and errors in Kural's own code.
  crashLog = new CrashLog(context);
  crashLog.start();
  const updater = new Updater(context);   // Help → Check for Updates…, and once a day by itself
  updater.autoCheck();
  updater.lastUpdate();   // (how the last update went: said when it failed)
  log(`Kural ${require("./lib/version").versionLabel(context.extensionPath, context.extension.packageJSON.version)} starting; claude at ${findClaude() || "(not found)"}`);
  // Before anything uses Claude: is Claude Code installed, logged in, and does a test request work?
  // AI work without a project open happens in Kural's own folder, never in your home folder (see workspace.js).
  require("./lib/workspace").setWorkDir(require("path").join(context.globalStorageUri.fsPath, "work"));
  brain.setStore(require("path").join(context.globalStorageUri.fsPath, "cli-chats"));   // (Codex / Gemini conversation ids)
  require("./lib/ai/codex").setLog(log);
  require("./lib/ai/agy").setLog(log);
  getStarted = new GetStarted(context);
  getStarted.register();

  // ---------- status bar ----------
  const status = vscode.window.createStatusBarItem("kural.status", vscode.StatusBarAlignment.Right, 100);
  status.name = "Tab Completion";
  let state = "ready";
  const toggleKey = process.platform === "darwin" ? "⌃⌥Space" : "Ctrl+Alt+Space";
  // Hover on "Tab": what it does; click opens the Tab panel (switch, speed slider, model).
  const tabCard = (on) => {
    const sp = SPEEDS.reduce((a, b) => Math.abs(b.ms - cfg().get("tabCompletion.debounceMs")) < Math.abs(a.ms - cfg().get("tabCompletion.debounceMs")) ? b : a);
    const md = new vscode.MarkdownString(`**Tab Completion** · ${on ? "On" : "Off"} · speed: ${sp.label}\n\n` +
      `Click for the Tab Completion panel (on/off, speed slider, model). \`${toggleKey}\` turns it ${on ? "off" : "on"}.`);
    md.supportThemeIcons = true;
    return md;
  };
  const refresh = () => {
    const on = cfg().get("tabCompletion.enabled");
    const look = {
      ready:    ["$(sparkle) Tab Completion", tabCard(true), "kural.tabPanel.focus"],
      thinking: ["$(sparkle) Tab Completion", tabCard(true), "kural.tabPanel.focus"],
      error:    ["$(warning) Tab Completion", "Last suggestion failed; click for Kural's log", "kural.showLog"],
      login:    ["$(account) Kural: log in", "Click to log in to Claude", "kural.getStarted"],
      missing:  ["$(cloud-download) Kural: install Claude Code", "Click to install Claude Code", "kural.getStarted"],
    }[state];
    if (!getStarted.ready) { [status.text, status.tooltip, status.command] = ["$(rocket) Kural: finish setup", "Pick Kural's AI (Claude, ChatGPT, Gemini, or your own model with Ollama): open Get started", "kural.getStarted"]; return; }
    [status.text, status.tooltip, status.command] = on || state === "login" || state === "missing"
      ? look : ["$(circle-slash) Tab Completion", tabCard(false), "kural.tabPanel.focus"];
  };
  const setState = (s) => {
    if (s === "login" || s === "missing") { getStarted.broke(s); return; }   // back to Get started at that step
    if (s !== state) { state = s; refresh(); }
  };
  refresh();
  status.show();

  // ---------- the Claude sessions ----------
  // Tab: fastest settings (thinking off). Edits: a bit of thinking for quality.
  const tabSession = new ClaudeSession({
    name: "tab", model: () => cfg().get("tabCompletion.model"), effort: "low", noThinking: true,
    systemPrompt: COMPLETION_SYSTEM_PROMPT, restartAfter: 40, timeoutMs: 10000, clearEach: true,
    pool: 2, earlyStop: "</insert>",   // two warm processes; answer as soon as the suggestion is written
  }, setState);
  // Tab in the terminal: the same model as Tab, its own helper and instructions (one command line).
  const terminalSession = new ClaudeSession({
    name: "terminal", model: () => cfg().get("tabCompletion.model"), effort: "low", noThinking: true,
    systemPrompt: TERMINAL_SYSTEM_PROMPT, restartAfter: 40, timeoutMs: 10000, clearEach: true, pool: 2, earlyStop: "</cmd>",
  }, () => {});
  // Ctrl+K, Apply and commit messages: the chat's model (a Claude model, or one on your computer: lib/brain.js).
  const editSession = new brain.Session({
    name: "edit", fallbackModel: () => "sonnet", effort: "medium", systemPrompt: EDIT_SYSTEM_PROMPT,
    restartAfter: 10, timeoutMs: 180000, clearEach: true,
  }, (s) => { if (s === "login" || s === "missing") setState(s); });
  // The Source Control panel's commit message (sparkle button): the chat's model, one plain message (lib/scm/commit.js).
  const scmSession = new brain.Session({
    name: "scm-commit", quiet: true, fallbackModel: () => cfg().get("tabCompletion.model"), effort: "low", noThinking: true,
    systemPrompt: scmCommit.SYSTEM_PROMPT, restartAfter: 20, timeoutMs: 60000, clearEach: true, earlyStop: "</msg>",
  }, () => {});
  scmCommit.registerCommitMessages(context, scmSession);
  const commitSession = new brain.Session({
    name: "commit", quiet: true, fallbackModel: () => cfg().get("tabCompletion.model"), effort: "low", noThinking: true,
    systemPrompt: TERMINAL_SYSTEM_PROMPT, restartAfter: 40, timeoutMs: 20000, clearEach: true, earlyStop: "</cmd>",
  }, () => {});

  // What you've been doing in this workspace: makes Tab's suggestions fit you (lib/activity.js).
  const activity = new Activity(context.workspaceState, () => true);   // (always on; Kural: Forget… clears it)
  watchEdits(context, activity);

  // Tab's local engine (Ollama): checked now and every 15 s, so it's used as soon as it's there.
  const local = new LocalEngine();
  // Tab uses a model on this computer only once you chose one (lib/tab/local.js allowed): the Tab panel's "Use a model
  // on this computer" or Download, or your own model set up in Get started.
  local.allowed = () => !!context.globalState.get("kural.tabLocal.v1") || !!getStarted.localModel;
  local.choose = async () => { await context.globalState.update("kural.tabLocal.v1", true); await local.status(true); local.changed(); };
  local.status(true);
  const localTimer = setInterval(() => { if (cfg().get("tabCompletion.enabled") && cfg().get("tabCompletion.engine") !== "claude") local.status(); }, 15000);
  context.subscriptions.push({ dispose: () => clearInterval(localTimer) });
  // Plain words in the terminal ("push this to main") → a command, by the chat's model.
  const wordsSession = new brain.Session({
    name: "words", quiet: true, fallbackModel: () => "haiku", effort: "low", noThinking: true,
    systemPrompt: INTENT_SYSTEM_PROMPT, restartAfter: 40, timeoutMs: 20000, clearEach: true, earlyStop: "</cmd>",
  }, () => {});
  context.subscriptions.push({ dispose: () => wordsSession.stop() });
  terminalTab(context, terminalSession, local, activity, commitSession, wordsSession);   // Tab in the terminal (Tab Completion; commits: the chat's model)
  const tabPanel = new TabPanel(context, SPEEDS, local);
  tabPanel.register();
  const review = new ReviewManager();
  review.register(context);
  // A Ctrl+K or Apply change you accepted: Tab learns what you asked for and where.
  review.onDone = (meta, accepted, uri) => {
    if (accepted) activity.addWork(meta.source, meta.ask, [vscode.workspace.asRelativePath(vscode.Uri.parse(uri))]);
  };
  const getState = () => state;
  const chat = new ChatView(context, (code, uri, ask) => applyCode(editSession, review, getState, code, uri, ask));
  chat.activity = activity;
  chat.readyCheck = () => getStarted.ready;           // Claude or your own model set up
  chat.localDefault = () => getStarted.localModel;    // new chats use it when Claude isn't set up
  const router = new ModelRouter(context,cfg,() => chat.routerModels(),() => vscode.workspace.isTrusted);
  // Auto steers away from an AI close to its usage limit (lib/ai/usage.js) and learns from what you do after its
  // answers, per workspace (lib/router/learn.js).
  router.usageOf = (provider) => usageHub.current(provider);
  router.memory = new RouterMemory(() => context.workspaceState.get("kural.router.memory.v1"), (v) => context.workspaceState.update("kural.router.memory.v1", v));
  chat.router = router;
  new RouterPanel(context, router).register();
  chat.postLocal().catch(() => {});
  brain.setModelSource(() => { const t = chat.active(); return t ? t.model : chat.lastChoices().model; }, () => getStarted.localModel);
  // Devices over SSH (+ → Link device in the chat, Kural: Devices): passwords encrypted in SecretStorage.
  const devices = new Devices(context);
  devices.register();
  chat.devices = devices;
  devices.onChange(() => chat.postTabs());
  chat.register();
  // Account (status bar, person icon): who's logged in, usage, switch account, log out. A new login: Claude's
  // chat processes start again with it.
  const account = new Account(context, getStarted, () => chat.setupChanged("login changed"));
  account.register();
  // Kural Settings (an editor tab): what the Account menu had. The person icon and "Kural: Settings" open it.
  account.page = new SettingsPage(context, account, getStarted);
  account.page.register();
  // The AI Usage panel (bottom); the status bar shows the chat's AI in words, so it redraws when the chat's model changes.
  new UsagePanel(context, account, getStarted).register();
  chat.onChoice = () => setTimeout(() => { account.drawMeters(); account.draw(); }, 0);   // (and whose account it is)
  new SearchView(context,router,() => chat.active()).register();
  // Kural Browser: your app on localhost beside the code; "Select element" adds what you click to the chat.
  const browser = new Browser(context, (info) => chat.addElement(info));
  browser.onItems = (items) => chat.addBrowserItems(items);
  browser.register();
  triggerOnCursor(context);

  context.subscriptions.push(
    status,
    { dispose: () => { tabSession.stop(); editSession.stop(); commitSession.stop(); scmSession.stop(); } },
    vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, completionProvider(tabSession, review, (ms, engine) => tabPanel.timing(ms, engine), local, activity,router)),
    vscode.commands.registerCommand("kural.tab.accepted", (a) => { if (a) activity.tabAccepted(a.file, a.lang, a.before, a.text); }),
    vscode.commands.registerCommand("kural.showCrashReports", () => crashLog.show()),
    // Your preferences to a file and back (Kural Settings → Export / Import settings).
    vscode.commands.registerCommand("kural.settings.export", () => settingsIO.exportSettings(context).catch((e) => vscode.window.showErrorMessage(`Kural: ${e.message}`))),
    vscode.commands.registerCommand("kural.settings.import", () => settingsIO.importSettings(context, devices).catch((e) => vscode.window.showErrorMessage(`Kural: ${e.message}`))),
    vscode.commands.registerCommand("kural.router.forget", () => {
      router.memory.forget();
      vscode.window.showInformationMessage("Model Router forgot what it learned in this workspace.");
    }),
    vscode.commands.registerCommand("kural.tab.forget", () => {
      activity.forget();
      tabPanel.push();
      vscode.window.showInformationMessage("Tab Completion forgot what it learned in this workspace.");
    }),
    vscode.commands.registerCommand("kural.inlineEdit", () => brain.usable().ok ? inlineEdit(editSession, review, getState) : getStarted.open()),
    vscode.commands.registerCommand("kural.toggleTab", async () => {
      const on = !cfg().get("tabCompletion.enabled");
      await cfg().update("tabCompletion.enabled", on, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(`Tab Completion ${on ? "on" : "off"}`, 1500);
      if (on) tabSession.start();
    }),
    vscode.commands.registerCommand("kural.tabSpeedSet", async (ms) => {
      if (typeof ms !== "number") return;
      await cfg().update("tabCompletion.debounceMs", ms, vscode.ConfigurationTarget.Global);
      const sp = SPEEDS.find((x) => x.ms === ms);
      vscode.window.setStatusBarMessage(`Tab Completion speed: ${sp ? sp.label : ms + " ms"}`, 1500);
    }),
    vscode.commands.registerCommand("kural.tabSpeed", async () => {
      const ms = cfg().get("tabCompletion.debounceMs");
      const pick = await vscode.window.showQuickPick(SPEEDS.map((sp) => ({
        label: `${sp.ms === ms ? "$(check) " : ""}${sp.label}`, description: sp.ms ? `${sp.ms} ms after you stop typing` : "as you type", ms: sp.ms,
      })), { title: "How fast should Tab Completion suggest?" });
      if (pick) await vscode.commands.executeCommand("kural.tabSpeedSet", pick.ms);
    }),
    vscode.commands.registerCommand("kural.openClaudeCode", openClaudeCode),
    vscode.commands.registerCommand("kural.login", () => getStarted.open()),
    vscode.commands.registerCommand("kural.install", () => getStarted.open()),
    vscode.commands.registerCommand("kural.showLog", () => showLog()),
    vscode.commands.registerCommand("kural.checkForUpdates", () => updater.check()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("kural.tabCompletion.model")) { tabSession.stop(); terminalSession.stop(); }
      if (e.affectsConfiguration("kural.tabCompletion.localModel") || e.affectsConfiguration("kural.tabCompletion.ollamaUrl")) local.status(true);
      // Turned on (shortcut or the Tab panel): start Claude now so the first suggestion is quick.
      if (e.affectsConfiguration("kural.tabCompletion") && cfg().get("tabCompletion.enabled")) tabSession.start();
      if (e.affectsConfiguration("kural")) refresh();
    }),
  );

  // Make sure the chat panel draws at startup (the editor can show it empty until
  // it's clicked), then give the keyboard back to your file.
  setTimeout(async () => {
    try {
      await vscode.commands.executeCommand("kural.chat.focus");
      await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    } catch (e) { log(`chat panel: ${e.message}`); }
  }, 300);

  // VS Code's left side bar (Explorer, Search, Git, …). Kural 2 moved the icons to the
  // top like Cursor; if that setting is still saved, put them back, and on the first start
  // of a new version make sure the side bar is showing.
  const wb = vscode.workspace.getConfiguration("workbench");
  if (wb.inspect("activityBar.location")?.globalValue === "top") wb.update("activityBar.location", "default", vscode.ConfigurationTarget.Global);
  const version = context.extension.packageJSON.version;
  if (context.globalState.get("kural.shownSidebarFor") !== version) {
    context.globalState.update("kural.shownSidebarFor", version);
    setTimeout(async () => {
      try {
        await vscode.commands.executeCommand("workbench.view.explorer");
        await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
      } catch (e) { log(`side bar: ${e.message}`); }
    }, 900);
  }

  // Set up (or once it is): warm up in the background so the first suggestion is quick.
  // (Claude's sessions only run once Claude is set up; with only your own model, Tab Completion uses Ollama.)
  getStarted.onChange((ready) => {
    state = "ready"; refresh();
    if (getStarted.claudeReady && cfg().get("tabCompletion.enabled")) tabSession.start();
    if (!getStarted.claudeReady) { tabSession.stop(); terminalSession.stop(); editSession.stop(); commitSession.stop(); scmSession.stop(); wordsSession.stop(); }
    chat.readyChanged(ready);
  });
  getStarted.start();
  chat.readyChanged(getStarted.ready);   // (saved empty chats get a model that's set up)
  if (getStarted.claudeReady && cfg().get("tabCompletion.enabled")) tabSession.start();
}

// Which files you edit, and the lines around your last edit in each (for Tab in other files).
function watchEdits(context, activity) {
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => {
    const doc = e.document;
    if (doc.uri.scheme !== "file" || !e.contentChanges.length) return;
    const line = e.contentChanges[0].range.start.line;
    const lines = [];
    for (let l = Math.max(0, line - 3); l <= Math.min(doc.lineCount - 1, line + 3); l++) lines.push(doc.lineAt(l).text);
    activity.edited(vscode.workspace.asRelativePath(doc.uri), doc.languageId, line, lines.join("\n"));
  }));
}

function deactivate() { if (crashLog) crashLog.stop(); }   // (a normal close: this window's marker says so)

module.exports = { activate, deactivate };
