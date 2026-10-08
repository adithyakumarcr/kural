// The Welcome page comes back when you close the last editor tab (setting kural.welcomeWhenEmpty), like a home
// screen: an empty editor area has nothing to click. Not when the tab you closed was Welcome itself (closing it
// means "go away"), and only after a short wait, because moving a tab between groups closes it before opening it.

// groups: [{ tabs: [...] }]; closed: the tabs just closed. Open Welcome?
function shouldOpen(groups, closed) {
  if (!closed || !closed.length) return false;
  if (groups.some((g) => g.tabs.length)) return false;
  return !closed.some(isWelcome);
}

// VS Code gives extensions no input for its Welcome page (an unknown kind), only the label.
function isWelcome(tab) {
  return !tab.input && /^(Welcome|Walkthrough)\b/.test(tab.label || "");
}

function register(context, log = () => {}) {
  const vscode = require("vscode");
  let timer = null;
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs((e) => {
      if (!vscode.workspace.getConfiguration("kural").get("welcomeWhenEmpty", true)) return;
      if (!shouldOpen(vscode.window.tabGroups.all, e.closed)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (vscode.window.tabGroups.all.some((g) => g.tabs.length)) return;   // a tab came back meanwhile
        log("welcome: the last editor tab closed; opening Welcome");
        vscode.commands.executeCommand("kural.welcome");
      }, 300);
    }),
    { dispose: () => clearTimeout(timer) },
  );
}

module.exports = { shouldOpen, isWelcome, register };
