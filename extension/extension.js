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
const { WhatsNew } = require("./lib/whats-new");
const { terminalTab, TERMINAL_SYSTEM_PROMPT, INTENT_SYSTEM_PROMPT } = require("./lib/tab/terminal");
const { ReviewManager } = require("./lib/edit/review");
const { ChatView } = require("./lib/chat");
const { SearchView } = require("./lib/search");
const { TabPanel } = require("./lib/tab/panel");
const { LocalEngine } = require("./lib/tab/local");
const { Activity } = require("./lib/tab/activity");
const { RenameOffers } = require("./lib/tab/rename-offer");
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
const { StayAwake } = require("./lib/chat/awake");
const welcome = require("./lib/welcome");
const { Profiles, applyActive } = require("./lib/profiles");
const scope = require("./lib/profiles/scope");
const { profileEnv } = require("./lib/profiles/env");
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
    env: profileEnv(),   // (this profile's Claude login: lib/profiles/env.js)
    location: { viewColumn: vscode.ViewColumn.Beside },
  });
  t.show();
  t.sendText(win ? `& "${bin}"` : `"${bin}"`);
}

let crashLog = null;
function activate(context) {
  initLog(context);
  // Which profile this window runs as (lib/profiles): first, before anything starts Claude or Codex or reads chats, because
  // the profile decides which logins those programs use and where chats are kept.
  const profileStore = applyActive(context);
  // Crash reports: what went wrong when Kural last closed unexpectedly (lib/crash), and errors in Kural's own code.
  crashLog = new CrashLog(context);
  crashLog.start();
  const updater = new Updater(context);   // Help → Check for Updates…, and once a day by itself
  updater.autoCheck();
  const whatsNew = new WhatsNew(context);   // the release notes, once after an update; "Kural: What's New"
  whatsNew.start(updater.lastUpdate());   // (how the last update went: said when it failed)
  context.subscriptions.push(vscode.commands.registerCommand("kural.whatsNew", () => whatsNew.open()));
  log(`Kural ${require("./lib/version").versionLabel(context.extensionPath, context.extension.packageJSON.version)} starting; claude at ${findClaude() || "(not found)"}`);
  // Before anything uses Claude: is Claude Code installed, logged in, and does a test request work?
  // AI work without a project open happens in Kural's own folder, never in your home folder (see workspace.js).
  require("./lib/workspace").setWorkDir(require("path").join(context.globalStorageUri.fsPath, "work"));
  // (Codex / Gemini conversation ids. Codex's belong to the profile's Codex account; Gemini's are the same in every profile.)
  brain.setStore(require("path").join(context.globalStorageUri.fsPath, "cli-chats"), { codex: scope.dir("cli-chats", "account") });
  require("./lib/ai/codex").setLog(log);
  require("./lib/ai/agy").setLog(log);
  getStarted = new GetStarted(context);
  getStarted.register();
  welcome.register(context, log);   // closing the last editor tab opens Welcome (kural.welcomeWhenEmpty)
  // Which of Claude Code's newer options this claude knows (thinking summaries, agents' text, messages while answering):
  // asked once per Claude Code version, in the background now, so the chat's first answer never waits for it.
  require("./lib/ai/claude").setFlagsStore(context.globalStorageUri.fsPath);
  if (getStarted.claudeReady) require("./lib/ai/claude").prefetchFlags(findClaude()).catch(() => {});
  require("./lib/workspace-color").register(context);

  // ---------- status bar ----------
  const status = vscode.window.createStatusBarItem("kural.status", vscode.StatusBarAlignment.Right, 100);
  status.name = "Tab Completion";
  let state = "ready";
  const toggleKey = process.platform === "darwin" ? "⌃⌥Space" : "Ctrl+Alt+Space";
  // A click toggles Tab Completion; the hover and Kural Settings open its full panel.
  const tabCard = (on) => {
    const sp = SPEEDS.reduce((a, b) => Math.abs(b.ms - cfg().get("tabCompletion.debounceMs")) < Math.abs(a.ms - cfg().get("tabCompletion.debounceMs")) ? b : a);
    const md = new vscode.MarkdownString(`**Tab Completion** · ${on ? "On" : "Off"} · speed: ${sp.label}\n\n` +
      `Click to turn it ${on ? "off" : "on"}. \`${toggleKey}\` does the same.\n\n` +
      `[Tab Completion settings](command:kural.tabPanel.focus)`);
    md.supportThemeIcons = true;
    md.isTrusted = { enabledCommands: ["kural.tabPanel.focus"] };
    return md;
  };
  // Just an icon (Adithya: a simple, decluttered status bar): the sparkle, crossed out while Tab Completion is off
  // ($(kural-tab-off): package.json "icons", media/codicons/kural-icons.ttf, made by scripts/make-status-icons.js). The
  // hover says what it is and what a click does. Errors and setup hints also stay in the hover.
  const refresh = () => {
    const on = cfg().get("tabCompletion.enabled");
    const tooltip = tabCard(on);
    if (!getStarted.ready) tooltip.appendMarkdown("\n\nSet up an AI in Kural Settings → Get started for suggestions.");
    else if (state === "error") tooltip.appendMarkdown("\n\nThe last suggestion failed. See Kural's log for details.");
    Object.assign(status, { text: on ? "$(sparkle)" : "$(kural-tab-off)", tooltip, command: "kural.toggleTab",
      accessibilityInformation: { label: `Tab Completion: ${on ? "on; click to disable" : "off; click to enable"}`, role: "button" } });
  };
  const setState = (s) => {
    if (s === "login" || s === "missing") { getStarted.broke(s); return; }   // back to Get started at that step
    if (s !== state) { state = s; refresh(); }
  };
  refresh();
  status.show();

  // ---------- the Claude sessions ----------
  // Each `claude` process takes ~100 MB (docs/benchmarks/memory-2026-10-08.md): they start when first needed and stop
  // after some minutes without questions (idleStopMs; the next question starts them again, 1-2 s once).
  // Tab: fastest settings (thinking off). Edits: a bit of thinking for quality.
  const MIN = 60 * 1000;
  const tabSession = new ClaudeSession({
    name: "tab", model: () => cfg().get("tabCompletion.model"), effort: "low", noThinking: true,
    systemPrompt: COMPLETION_SYSTEM_PROMPT, restartAfter: 40, timeoutMs: 10000, clearEach: true, idleStopMs: 15 * MIN,
    pool: 2, earlyStop: "</insert>",   // two warm processes; answer as soon as the suggestion is written
  }, setState);
  // Tab in the terminal: the same model as Tab, its own helper and instructions (one command line). One process: it asks
  // after a pause in your typing, so a second one waiting was rarely used.
  const terminalSession = new ClaudeSession({
    name: "terminal", model: () => cfg().get("tabCompletion.model"), effort: "low", noThinking: true, idleStopMs: 10 * MIN,
    systemPrompt: TERMINAL_SYSTEM_PROMPT, restartAfter: 40, timeoutMs: 10000, clearEach: true, pool: 1, earlyStop: "</cmd>",
  }, () => {});
  // Ctrl+K, Apply and commit messages: the chat's model (a Claude model, or one on your computer: lib/brain.js).
  const editSession = new brain.Session({
    name: "edit", fallbackModel: () => "sonnet", effort: "medium", systemPrompt: EDIT_SYSTEM_PROMPT,
    restartAfter: 10, timeoutMs: 180000, clearEach: true, idleStopMs: 10 * MIN,
  }, (s) => { if (s === "login" || s === "missing") setState(s); });
  // The Source Control panel's commit message (sparkle button): the chat's model, one plain message (lib/scm/commit.js).
  const scmSession = new brain.Session({
    name: "scm-commit", quiet: true, fallbackModel: () => cfg().get("tabCompletion.model"), effort: "low", noThinking: true,
    systemPrompt: scmCommit.SYSTEM_PROMPT, restartAfter: 20, timeoutMs: 60000, clearEach: true, earlyStop: "</msg>", idleStopMs: 5 * MIN,
  }, () => {});
  scmCommit.registerCommitMessages(context, scmSession);
  const commitSession = new brain.Session({
    name: "commit", quiet: true, fallbackModel: () => cfg().get("tabCompletion.model"), effort: "low", noThinking: true,
    systemPrompt: TERMINAL_SYSTEM_PROMPT, restartAfter: 40, timeoutMs: 20000, clearEach: true, earlyStop: "</cmd>", idleStopMs: 5 * MIN,
  }, () => {});

  // What you've been doing in this workspace: makes Tab's suggestions fit you (lib/activity.js).
  // Off unless you turn it on (kural.tabCompletion.learnFromActivity): typed lines can hold secrets a filter misses.
  const activity = new Activity(context.workspaceState, () => !!vscode.workspace.getConfiguration("kural").get("tabCompletion.learnFromActivity"));
  watchEdits(context, activity);
  // Data learned while it was always on (older versions): ask once whether to delete it.
  if (!activity.enabled() && activity.hasData() && !context.workspaceState.get("kural.activity.askedOptIn")) {
    context.workspaceState.update("kural.activity.askedOptIn", true);
    vscode.window.showInformationMessage("Kural stopped learning from your typing until you turn it on in Settings (Tab Completion: Learn From Activity). Delete the old data?", "Delete", "Keep")
      .then((p) => { if (p === "Delete") activity.forget(); });
  }

  // Tab's local engine (Ollama): checked now and every 15 s, so it's used as soon as it's there.
  const local = new LocalEngine();
  // Tab uses a model on this computer only once you chose one (lib/tab/local.js allowed): the Tab panel's "Use a model
  // on this computer" or Download, or your own model set up in Get started.
  local.allowed = () => !!context.globalState.get("kural.tabLocal.v1") || !!getStarted.localModel;
  local.choose = async () => { await context.globalState.update("kural.tabLocal.v1", true); await local.status(true); local.changed(); };
  // Claude's Tab processes only when Tab may need them now: the engine is Claude, or no model on this computer is ready.
  // (With a local model, Auto and "Local model" start them at Claude's first turn: a race or Ollama busy.)
  const warmTab = async () => {
    if (!getStarted.claudeReady || !cfg().get("tabCompletion.enabled")) return;
    if (cfg().get("tabCompletion.engine") === "claude" || !(await local.ready())) tabSession.start();
  };
  local.status(true).then(() => warmTab());
  // (Every 15 s while this window is in front: Ollama started or stopped, a model downloaded.)
  const localTimer = setInterval(() => {
    if (vscode.window.state.focused && cfg().get("tabCompletion.enabled") && cfg().get("tabCompletion.engine") !== "claude") local.status();
  }, 15000);
  context.subscriptions.push({ dispose: () => clearInterval(localTimer) });
  // Plain words in the terminal ("push this to main") → a command, by the chat's model.
  const wordsSession = new brain.Session({
    name: "words", quiet: true, fallbackModel: () => "haiku", effort: "low", noThinking: true,
    systemPrompt: INTENT_SYSTEM_PROMPT, restartAfter: 40, timeoutMs: 20000, clearEach: true, earlyStop: "</cmd>", idleStopMs: 5 * MIN,
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
  // A chat answering with a model on this computer keeps Ollama busy: Tab Completion lets Claude help meanwhile
  // (lib/tab/local.js busy, lib/tab/completion.js).
  local.chatBusy = () => chat.tabs.some((t) => t.status === "running" && brain.isLocal(t.model));
  // While any chat works, the Mac doesn't idle-sleep (lib/chat/awake.js; setting kural.chat.keepAwake). The chat calls
  // onTabs whenever its tabs change; the timer catches a change that didn't redraw them.
  const awake = new StayAwake({ log });
  const keepAwake = () => awake.set(cfg().get("chat.keepAwake", true) && chat.tabs.some((t) => t.status === "running"));
  chat.onTabs = keepAwake;
  const awakeTimer = setInterval(keepAwake, 30000);
  context.subscriptions.push(awake, { dispose: () => clearInterval(awakeTimer) });
  const router = new ModelRouter(context,cfg,() => chat.routerModels(),() => vscode.workspace.isTrusted);
  // Auto steers away from an AI close to its usage limit (lib/ai/usage.js) and learns from what you do after its
  // answers, per workspace (lib/router/learn.js).
  router.usageOf = (provider) => usageHub.current(provider);
  router.memory = new RouterMemory(() => context.workspaceState.get(scope.key("kural.router.memory.v1", "data")), (v) => context.workspaceState.update(scope.key("kural.router.memory.v1", "data"), v));
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
  account.page.chat = chat;
  account.page.register();
  // Profiles (status bar, left of the usage meters): a personal and a work Kural with their own Claude / ChatGPT accounts.
  // A switch reloads the window (lib/profiles/index.js).
  const profiles = new Profiles(context, profileStore, {
    // A chat is busy while it answers, has agents / background commands running, or has a message waiting.
    busy: () => chat.tabs.some((t) => { const r = chat.runtime.get(t.id); return t.status === "running" || !!(r && ((r.bg && r.bg.size) || (r.steers && r.steers.length))); }),
    flush: () => Promise.all([chat.saveNow(), account.flush(), activity.flush()]),
    changed: (p) => { account.profileName = p.name; account.draw(); },
    // The installed Claude Code's version, "none" when there isn't one (a Mac needs 2.1.296+ for per-folder keychain logins).
    claudeVersion: async () => { const bin = findClaude(); if (!bin) return "none"; const v = await require("./lib/ai/claude-checks").claudeVersion(bin, require("./lib/ai/claude").cleanEnv({})); return v.version || null; },
    // Deleting a profile: log its accounts out first (a Mac keeps Claude's login in the keychain, named for the folder).
    // The environment names the profile's folders, so only that profile's logins are touched.
    logout: async (dir, { claude }) => {
      const path = require("path");
      const bin = findClaude();
      if (claude && bin) await require("./lib/ai/claude-checks").claudeLogout(bin, require("./lib/ai/claude").cleanEnv({ CLAUDE_CONFIG_DIR: path.join(dir, "claude") }));
      const cx = brain.cli.codex;
      if (cx && cx.bin) await require("./lib/ai/clis").CLIS.codex.logout(cx.bin, { CODEX_HOME: path.join(dir, "codex") });
    },
  });
  profiles.register();
  profiles.openSetupIfNew(getStarted);

  // The AI Usage panel (bottom); the status bar shows the chat's AI in words, so it redraws when the chat's model changes.
  new UsagePanel(context, account, getStarted).register();
  chat.onChoice = () => setTimeout(() => { account.drawMeters(); account.draw(); }, 0);   // (and whose account it is)
  const searchView = new SearchView(context,router,() => chat.active());
  searchView.register();
  // You changed a name (typed over it, or a Tab suggestion changed it): offer to change it where else it's used
  // (lib/tab/rename.js notices, rename-offer.js offers: Review in Search & Ask, or Change all).
  new RenameOffers(context, searchView).register();
  // Kural Browser: your app on localhost beside the code; "Select element" adds what you click to the chat.
  const browser = new Browser(context, (info) => chat.addElement(info));
  browser.onItems = (items) => chat.addBrowserItems(items);
  browser.register();
  triggerOnCursor(context);

  context.subscriptions.push(
    status,
    { dispose: () => { tabSession.stop(); terminalSession.stop(); editSession.stop(); commitSession.stop(); scmSession.stop(); } },
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
      if (on) warmTab();
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
    vscode.commands.registerCommand("kural.verifyInstall", () => updater.verifyInstall()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("kural.tabCompletion.model")) { tabSession.stop(); terminalSession.stop(); }
      if (e.affectsConfiguration("kural.tabCompletion.localModel") || e.affectsConfiguration("kural.tabCompletion.ollamaUrl")) local.status(true);
      // Turned on, or another engine (shortcut or the Tab panel): start Claude now if it's needed, so the first suggestion is quick.
      if (e.affectsConfiguration("kural.tabCompletion.enabled") || e.affectsConfiguration("kural.tabCompletion.engine")) warmTab();
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
    warmTab();
    if (!getStarted.claudeReady) { tabSession.stop(); terminalSession.stop(); editSession.stop(); commitSession.stop(); scmSession.stop(); wordsSession.stop(); }
    chat.readyChanged(ready);
  });
  getStarted.start();
  chat.readyChanged(getStarted.ready);   // (saved empty chats get a model that's set up)
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
