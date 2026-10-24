// Fix with Kural (like Cursor's "Fix in Chat"): the light bulb on an error or warning, and the status bar button after
// a failed terminal command, put the problem into your message as a pill. You press Send; nothing goes by itself.
// The text is made in core.js (no vscode). `kural.chat.addContext` is the shared way in for other features (Agent
// Review's "Fix in Chat"): { label, text, source, prompt } → chat.addProblem.
const vscode = require("vscode");
const core = require("./core");

const SHOW_MS = 15000;          // how long "Fix with Kural" stays in the status bar after a failed command
const BUFFER = 64 * 1024;       // a running command's output kept while it streams (the last 8,000 characters are used)
const MAX_FAILED = 8;           // terminals remembered with a failed command

const SEVERITY = { [vscode.DiagnosticSeverity.Error]: "Error", [vscode.DiagnosticSeverity.Warning]: "Warning" };
const codeOf = (d) => d.code && typeof d.code === "object" ? d.code.value : d.code;
const fixable = (d) => d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning;

function registerFix(context, { chat, log }) {
  const say = (m) => { try { log && log(`fix: ${m}`); } catch { /* the log is for us */ } };

  // ---------- the editor ----------
  const plain = (d) => ({ line: d.range.start.line + 1, severity: SEVERITY[d.severity], message: d.message, source: d.source, code: codeOf(d) });

  const provider = {
    provideCodeActions(document, range, ctx) {
      const here = ctx.diagnostics.filter(fixable);
      if (!here.length) return [];
      const actions = here.map((d) => {
        const a = new vscode.CodeAction(here.length > 1 ? `Fix with Kural: ${core.shorten(d.message, 50)}` : "Fix with Kural", vscode.CodeActionKind.QuickFix);
        a.diagnostics = [d];
        a.command = { command: "kural.fix.problem", title: "Fix with Kural", arguments: [{ uri: document.uri, diagnostics: [d] }] };
        return a;
      });
      const all = vscode.languages.getDiagnostics(document.uri).filter(fixable);
      if (all.length >= 2) {
        const a = new vscode.CodeAction("Fix all problems in this file with Kural", vscode.CodeActionKind.QuickFix);
        a.command = { command: "kural.fix.problem", title: "Fix all problems in this file with Kural", arguments: [{ uri: document.uri, diagnostics: all }] };
        actions.push(a);
      }
      return actions;
    },
  };

  const fixProblem = async (arg) => {
    const uri = arg && arg.uri ? (typeof arg.uri === "string" ? vscode.Uri.parse(arg.uri) : arg.uri) : vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri;
    if (!uri) { vscode.window.showInformationMessage("Kural: open a file with a problem first."); return; }
    const found = (arg && Array.isArray(arg.diagnostics) && arg.diagnostics.length ? arg.diagnostics : vscode.languages.getDiagnostics(uri)).filter(fixable);
    if (!found.length) { vscode.window.showInformationMessage("Kural: no errors or warnings in this file."); return; }
    let lines = [];
    try { lines = (await vscode.workspace.openTextDocument(uri)).getText().split(/\r?\n/); } catch { /* no snippet then */ }
    const file = vscode.workspace.asRelativePath(uri);
    const name = file.split(/[\\/]/).pop();
    const text = core.problemsText({ file, lines, problems: found.map(plain) });
    const label = found.length === 1 ? `Fix: ${core.shorten(found[0].message, 32)}` : `${found.length} problems in ${name}`;
    await chat.addProblem({ label, text, source: "problem", prompt: core.DEFAULT_PROMPT });
  };

  // ---------- the terminal ----------
  const failed = new Map();             // terminal → { command, exitCode, output, cwd }
  const running = new Map();            // execution → output so far
  let item = null, hideTimer = null;
  const hide = () => { clearTimeout(hideTimer); hideTimer = null; if (item) item.hide(); };
  const offer = () => {
    if (!item) {
      item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
      item.text = "$(wand) Fix with Kural";
      item.tooltip = "The last command in the terminal failed: add it to the chat";
      item.command = "kural.fix.terminal";
      context.subscriptions.push(item);
    }
    item.show();
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, SHOW_MS);
  };

  const collect = async (execution) => {
    let out = "";
    running.set(execution, "");
    try {
      for await (const chunk of execution.read()) {
        out += chunk;
        if (out.length > BUFFER) out = out.slice(out.length - BUFFER);
        running.set(execution, out);
      }
    } catch (e) { say(`reading a command's output stopped: ${e && e.message}`); }
  };

  const terminalHooks = [];
  if (typeof vscode.window.onDidStartTerminalShellExecution === "function" && typeof vscode.window.onDidEndTerminalShellExecution === "function") {
    terminalHooks.push(
      vscode.window.onDidStartTerminalShellExecution((e) => { hide(); collect(e.execution); }),
      vscode.window.onDidEndTerminalShellExecution(async (e) => {
        const output = running.get(e.execution) || "";
        running.delete(e.execution);
        if (!e.exitCode) return;        // 0 (or no answer from the shell): nothing failed
        const cmd = e.execution.commandLine && e.execution.commandLine.value;
        if (!cmd || !String(cmd).trim()) return;
        const cwd = e.execution.cwd ? e.execution.cwd.fsPath : undefined;
        failed.delete(e.terminal);
        failed.set(e.terminal, { command: cmd, exitCode: e.exitCode, output, cwd });
        while (failed.size > MAX_FAILED) failed.delete(failed.keys().next().value);
        say(`a command failed (exit ${e.exitCode}): ${core.shorten(cmd, 60)}`);
        offer();
      }),
      vscode.window.onDidCloseTerminal((t) => failed.delete(t)),
    );
  }

  const fixTerminal = async () => {
    const t = vscode.window.activeTerminal;
    const rec = t && failed.get(t);
    if (!rec) {
      vscode.window.showInformationMessage(t ? "Kural: no failed command in this terminal yet. (It needs the terminal's shell integration.)" : "Kural: no terminal is open.");
      return;
    }
    hide();
    await chat.addProblem({ label: `Failed: ${core.shorten(rec.command, 32)}`, text: core.terminalText(rec), source: "terminal", prompt: core.DEFAULT_PROMPT });
  };

  // The shared way in: Agent Review's "Fix in Chat" and anything else that has text for the chat.
  const addContext = async (arg) => {
    if (!arg || typeof arg.text !== "string" || !arg.text.trim()) { say("addContext without text"); return; }
    await chat.addProblem({ label: arg.label || core.shorten(arg.text, 32), text: arg.text, source: arg.source, prompt: arg.prompt });
  };

  const selector = [{ scheme: "file" }, { scheme: "untitled" }];
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(selector, provider, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    vscode.commands.registerCommand("kural.fix.problem", fixProblem),
    vscode.commands.registerCommand("kural.fix.terminal", fixTerminal),
    vscode.commands.registerCommand("kural.chat.addContext", addContext),
    { dispose: () => { clearTimeout(hideTimer); failed.clear(); running.clear(); } },
    ...terminalHooks,
  );
  return { provider, fixProblem, fixTerminal, addContext };
}

module.exports = { registerFix };
