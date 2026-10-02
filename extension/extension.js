// Kural: Claude built into the editor, using your Claude login (no API key).
//   Tab          grey suggestions as you type or place the cursor; Tab accepts
//   Ctrl+L       chat on the right: tabs, Agent/Ask, model + intensity, multiple agents
//   Ctrl+K       edit the selected code in place, review it red/green
//   Ctrl+Alt+A   Ask & Search on the left: find code by describing it, or by text
//   Ctrl+Esc     full Claude Code in a terminal beside your file
// Each feature lives in lib/; this file connects them.

const vscode = require("vscode");
const { initLog, log, findClaude, ClaudeSession } = require("./lib/claude");
const { SPEEDS, COMPLETION_SYSTEM_PROMPT, completionProvider, triggerOnCursor } = require("./lib/completion");
const { EDIT_SYSTEM_PROMPT, inlineEdit, applyCode } = require("./lib/edits");
const { Updater } = require("./lib/updates");
const { ReviewManager } = require("./lib/review");
const { ChatView } = require("./lib/chat");
const { SearchView } = require("./lib/search");
const { TabPanel } = require("./lib/tabpanel");
const { LocalEngine } = require("./lib/local");

const cfg = () => vscode.workspace.getConfiguration("kural");

function openClaudeCode() {
  const bin = findClaude();
  if (!bin) return offerInstall();
  // Start claude inside a normal shell, so if it stops (not logged in, no network) its
  // message stays on screen. Windows always gets PowerShell, so the command syntax is known.
  const win = process.platform === "win32";
  const t = vscode.window.createTerminal({
    name: "Claude Code",
    shellPath: win ? "powershell.exe" : undefined,
    cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    location: { viewColumn: vscode.ViewColumn.Beside },
  });
  t.show();
  t.sendText(win ? `& "${bin}"` : `"${bin}"`);
}

async function offerInstall() {
  const pick = await vscode.window.showInformationMessage(
    "Kural needs Claude Code (it provides your Claude login). Install it now with Anthropic's official installer?",
    "Install", "Cancel");
  if (pick !== "Install") return;
  // Anthropic's official installers: PowerShell on Windows, a shell script elsewhere.
  if (process.platform === "win32") {
    const t = vscode.window.createTerminal({ name: "Install Claude Code", shellPath: "powershell.exe" });
    t.show();
    t.sendText("irm https://claude.ai/install.ps1 | iex; & \"$env:USERPROFILE\\.local\\bin\\claude.exe\"; Write-Host 'Done. Reload Kural (Ctrl+Shift+P, Reload Window).'");
  } else {
    const t = vscode.window.createTerminal({ name: "Install Claude Code" });
    t.show();
    t.sendText("curl -fsSL https://claude.ai/install.sh | bash && ~/.local/bin/claude && echo 'Done. Reload Kural (Ctrl+Shift+P → Reload Window).'");
  }
}

function activate(context) {
  const output = initLog();
  context.subscriptions.push(output);
  const updater = new Updater(context);   // Help → Check for Updates…
  log(`Kural ${context.extension.packageJSON.version} starting; claude at ${findClaude() || "(not found)"}`);

  // ---------- status bar ----------
  const status = vscode.window.createStatusBarItem("kural.status", vscode.StatusBarAlignment.Right, 100);
  status.name = "Kural Tab";
  let state = findClaude() ? "ready" : "missing";
  const toggleKey = process.platform === "darwin" ? "⌃⌥Space" : "Ctrl+Alt+Space";
  // Hover on "Tab": what it does; click opens the Tab panel (switch, speed slider, model).
  const tabCard = (on) => {
    const sp = SPEEDS.reduce((a, b) => Math.abs(b.ms - cfg().get("tabCompletion.debounceMs")) < Math.abs(a.ms - cfg().get("tabCompletion.debounceMs")) ? b : a);
    const md = new vscode.MarkdownString(`**Kural Tab** · ${on ? "On" : "Off"} · speed: ${sp.label}\n\n` +
      `Click for the Tab panel (on/off, speed slider, model). \`${toggleKey}\` turns it ${on ? "off" : "on"}.`);
    md.supportThemeIcons = true;
    return md;
  };
  const refresh = () => {
    const on = cfg().get("tabCompletion.enabled");
    const look = {
      ready:    ["$(sparkle) Tab", tabCard(true), "kural.tabPanel.focus"],
      thinking: ["$(sparkle) Tab", tabCard(true), "kural.tabPanel.focus"],
      error:    ["$(warning) Tab", "Last suggestion failed; see View → Output → Kural", "kural.showLog"],
      login:    ["$(account) Kural: log in", "Click to log in to Claude", "kural.login"],
      missing:  ["$(cloud-download) Kural: install Claude Code", "Click to install Claude Code", "kural.install"],
    }[state];
    [status.text, status.tooltip, status.command] = on || state === "login" || state === "missing"
      ? look : ["$(circle-slash) Tab", tabCard(false), "kural.tabPanel.focus"];
  };
  const setState = (s) => { if (s !== state) { state = s; refresh(); } };
  refresh();
  status.show();

  // ---------- the Claude sessions ----------
  // Tab: fastest settings (thinking off). Edits: a bit of thinking for quality.
  const tabSession = new ClaudeSession({
    name: "tab", model: () => cfg().get("tabCompletion.model"), effort: "low", noThinking: true,
    systemPrompt: COMPLETION_SYSTEM_PROMPT, restartAfter: 40, timeoutMs: 10000, clearEach: true,
    pool: 2, earlyStop: "</insert>",   // two warm processes; answer as soon as the suggestion is written
  }, setState);
  const editSession = new ClaudeSession({
    name: "edit", model: () => cfg().get("editModel"), effort: "medium", systemPrompt: EDIT_SYSTEM_PROMPT,
    restartAfter: 10, timeoutMs: 180000, clearEach: true,
  }, (s) => { if (s === "login" || s === "missing") setState(s); });

  // Tab's local engine (Ollama): checked now and every 15 s, so it's used as soon as it's there.
  const local = new LocalEngine();
  local.status(true);
  const localTimer = setInterval(() => { if (cfg().get("tabCompletion.enabled") && cfg().get("tabCompletion.engine") !== "claude") local.status(); }, 15000);
  context.subscriptions.push({ dispose: () => clearInterval(localTimer) });
  const tabPanel = new TabPanel(context, SPEEDS, local);
  tabPanel.register();
  const review = new ReviewManager();
  review.register(context);
  const getState = () => state;
  const chat = new ChatView(context, (code, uri) => applyCode(editSession, review, getState, code, uri));
  chat.register();
  new SearchView(context).register();
  triggerOnCursor(context);

  context.subscriptions.push(
    status,
    { dispose: () => { tabSession.stop(); editSession.stop(); } },
    vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, completionProvider(tabSession, review, (ms, engine) => tabPanel.timing(ms, engine), local)),
    vscode.commands.registerCommand("kural.inlineEdit", () => inlineEdit(editSession, review, getState)),
    vscode.commands.registerCommand("kural.toggleTab", async () => {
      const on = !cfg().get("tabCompletion.enabled");
      await cfg().update("tabCompletion.enabled", on, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(`Kural Tab ${on ? "on" : "off"}`, 1500);
      if (on) tabSession.start();
    }),
    vscode.commands.registerCommand("kural.tabSpeedSet", async (ms) => {
      if (typeof ms !== "number") return;
      await cfg().update("tabCompletion.debounceMs", ms, vscode.ConfigurationTarget.Global);
      const sp = SPEEDS.find((x) => x.ms === ms);
      vscode.window.setStatusBarMessage(`Kural Tab speed: ${sp ? sp.label : ms + " ms"}`, 1500);
    }),
    vscode.commands.registerCommand("kural.tabSpeed", async () => {
      const ms = cfg().get("tabCompletion.debounceMs");
      const pick = await vscode.window.showQuickPick(SPEEDS.map((sp) => ({
        label: `${sp.ms === ms ? "$(check) " : ""}${sp.label}`, description: sp.ms ? `${sp.ms} ms after you stop typing` : "as you type", ms: sp.ms,
      })), { title: "How fast should Kural Tab suggest?" });
      if (pick) await vscode.commands.executeCommand("kural.tabSpeedSet", pick.ms);
    }),
    vscode.commands.registerCommand("kural.openClaudeCode", openClaudeCode),
    vscode.commands.registerCommand("kural.login", () => {
      vscode.window.showInformationMessage("In the Claude Code terminal, type /login and follow the steps. Then reload Kural.");
      openClaudeCode();
      tabSession.stop(); editSession.stop(); setState("ready");
    }),
    vscode.commands.registerCommand("kural.install", offerInstall),
    vscode.commands.registerCommand("kural.showLog", () => output.show(true)),
    vscode.commands.registerCommand("kural.checkForUpdates", () => updater.check()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("kural.tabCompletion.model")) tabSession.stop();
      if (e.affectsConfiguration("kural.tabCompletion.localModel") || e.affectsConfiguration("kural.tabCompletion.ollamaUrl")) local.status(true);
      // Turned on (shortcut or the Tab panel): start Claude now so the first suggestion is quick.
      if (e.affectsConfiguration("kural.tabCompletion") && cfg().get("tabCompletion.enabled")) tabSession.start();
      if (e.affectsConfiguration("kural.editModel")) editSession.stop();
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

  // Warm up in the background so the first suggestion is quick.
  if (state === "missing") offerInstall();
  else if (cfg().get("tabCompletion.enabled")) tabSession.start();
}

function deactivate() {}

module.exports = { activate, deactivate };
