// Tab in the terminal: one suggested command line, in the terminal's own suggestion list (Tab accepts it).
//
// The same engine and model as Tab in the editor (kural.tabCompletion.*): the local model (Ollama), Claude,
// or Auto (both race). One line only, never runs anything: you still press Enter yourself.
//
// What the model sees: the shell and folder, your last commands in this terminal, git status, and for
// `git commit -m "…` the actual staged changes (or the unstaged ones), so it can name the commit.
//
// Speed: the terminal waits for every suggestion source before showing its list, so Kural never makes it
// wait: it answers from its cache, and opens the list again when a new answer arrives (see the provider).

const vscode = require("vscode");
const { execFile } = require("child_process");
const { log } = require("./claude");

const DIFF_CHARS = 3500;

const TERMINAL_SYSTEM_PROMPT = `You are the autocomplete of a terminal. You get what the user has typed so far
in the shell, plus context (folder, recent commands, git state). Reply with exactly one <cmd>...</cmd> block holding
the COMPLETE command line the user most likely wants: it must start with exactly what they typed. One line only;
never several commands on separate lines, never explanations.
For git commit messages (e.g. git commit -m "): write a short, specific message in the imperative mood
(max ~65 characters) that names what the changes actually do, based on the staged diff (or, if nothing is
staged, the unstaged diff). Close the quote.
If nothing sensible fits, reply <cmd></cmd>.`;

const cfg = () => vscode.workspace.getConfiguration("kural");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, cwd, timeout = 1500) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, out) => resolve(err ? "" : String(out)));
  });
}

// What the model needs to know besides the line itself. Git is asked at most every few seconds per folder.
const gitCache = new Map();   // cwd + kind -> { at, text }
async function gitContext(cwd, wantDiff) {
  const key = `${cwd}|${wantDiff}`;
  const hit = gitCache.get(key);
  if (hit && Date.now() - hit.at < 4000) return hit.text;
  let text = "";
  const status = await run("git", ["status", "--short", "--branch"], cwd);
  if (status) {
    text = `git status:\n${status.split("\n").slice(0, 25).join("\n")}`;
    if (wantDiff) {
      let diff = await run("git", ["diff", "--cached", "--stat"], cwd), which = "staged";
      let body = diff ? await run("git", ["diff", "--cached", "-U1"], cwd) : "";
      if (!diff) { which = "not staged yet"; diff = await run("git", ["diff", "--stat"], cwd); body = await run("git", ["diff", "-U1"], cwd); }
      if (diff) text += `\n\nChanges (${which}):\n${diff}\n${body.slice(0, DIFF_CHARS)}${body.length > DIFF_CHARS ? "\n… (more changes)" : ""}`;
    }
  }
  gitCache.set(key, { at: Date.now(), text });
  return text;
}

// The last commands run in each terminal (needs shell integration, which VS Code sets up for bash/zsh/fish/pwsh).
const recent = new Map();   // terminal -> [command lines]
function trackCommands(context) {
  if (!vscode.window.onDidEndTerminalShellExecution) return;
  context.subscriptions.push(vscode.window.onDidEndTerminalShellExecution((e) => {
    const line = e.execution && e.execution.commandLine && e.execution.commandLine.value;
    if (!line || !line.trim()) return;
    const list = recent.get(e.terminal) || [];
    list.push(line.trim());
    recent.set(e.terminal, list.slice(-8));
  }), vscode.window.onDidCloseTerminal((t) => recent.delete(t)));
}

// The model's answer → the full command line, or "" if it doesn't continue what was typed.
function tidy(answer, typed) {
  let s = String(answer || "").replace(/<\|[a-z_]+\|>/g, "");   // the local model's markers, e.g. <|endoftext|>
  const m = /<cmd>([\s\S]*?)(<\/cmd>|$)/.exec(s);
  if (m) s = m[1];
  s = s.replace(/^\s*\$\s/, "").split(/\r?\n/)[0].replace(/\s+$/, "");
  // (The local model writes only what comes after the cursor; viaLocal puts the typed part in front.)
  return s.startsWith(typed) && s.length > typed.length ? s : "";
}

// The first [text, engine] with text in it, or ["", ""] when none has any.
function firstAnswer(promises) {
  return new Promise((resolve) => {
    let left = promises.length;
    for (const p of promises) p.then((r) => { if (r && r[0]) resolve(r); else if (--left === 0) resolve(["", ""]); });
  });
}

function terminalTab(context, session, local) {
  trackCommands(context);
  const cache = new Map();   // typed line -> suggested line

  async function suggest(terminal, typed, token) {
    const cwd = (terminal.shellIntegration && terminal.shellIntegration.cwd && terminal.shellIntegration.cwd.fsPath)
      || (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0].uri.fsPath) || process.cwd();
    const shell = (terminal.state && terminal.state.shell) || (process.platform === "win32" ? "pwsh" : "bash");
    const commit = /^\s*git\s+commit\b/.test(typed);
    const git = await gitContext(cwd, commit);
    const history = (recent.get(terminal) || []).map((c) => `$ ${c}`).join("\n");
    const engineSetting = cfg().get("tabCompletion.engine");
    const useLocal = local && engineSetting !== "claude" && await local.ready();

    const viaClaude = async (tok = token) => {
      const prompt = `Shell: ${shell}\nFolder: ${cwd}\n${history ? `Recent commands:\n${history}\n` : ""}${git ? `\n${git}\n` : ""}\nTyped so far:\n${typed}`;
      return tidy(await session.ask(prompt, tok), typed);
    };
    const viaLocal = async () => {
      // A fill-in-the-middle prompt for the code model: the context as shell comments, then the line.
      const comment = (t) => t.split("\n").map((l) => `# ${l}`).join("\n");
      const prefix = `# ${shell} terminal in ${cwd}\n${git ? `${comment(git.slice(0, 1500))}\n` : ""}${history ? `${history}\n` : ""}$ ${typed}`;
      const raw = await local.complete(prefix, "\n", token, true);
      return raw == null ? "" : tidy(typed + raw, typed);
    };
    if (!useLocal) return [await viaClaude(), "claude"];
    if (engineSetting === "local") return [await viaLocal(), "local"];
    // Auto, like Tab in the editor: the local model gets a head start; then Claude too; the first real answer wins.
    const fromLocal = viaLocal().catch(() => "");
    const early = await Promise.race([fromLocal, sleep(350).then(() => undefined)]);
    if (early) return [early, "local"];
    const fromClaude = viaClaude().catch(() => "");
    return firstAnswer([fromLocal.then((x) => [x, "local"]), fromClaude.then((x) => [x, "claude"])]);
  }

  const KIND = vscode.TerminalCompletionItemKind || {};
  const kind = KIND.InlineSuggestion ?? KIND.InlineSuggestionAlwaysOnTop ?? KIND.Argument ?? KIND.Method;
  const item = (line, typed, engine) => ({
    label: line, replacementRange: [0, typed.length], kind,
    detail: `Kural · ${engine === "local" ? "local model" : "Claude"}`,
    documentation: "Suggested by Kural Tab. Tab inserts it; you still press Enter to run it.",
  });

  // The terminal waits for every suggestion source before it shows its list. So Kural never makes it wait:
  // it answers at once from its cache, or with nothing. Meanwhile, after a short pause in your typing (the
  // Tab speed slider), it asks the model; when the answer comes, it opens the list again, and this time the
  // answer is in the cache. A request for a line you've typed past is cancelled.
  let latest = "";           // what you typed last
  let job = null;            // { typed, cts }
  const provider = {
    async provideTerminalCompletions(terminal, ctx) {
      if (!cfg().get("tabCompletion.enabled") || !cfg().get("tabCompletion.terminal")) return [];
      const typed = String(ctx.commandLine || "").slice(0, ctx.cursorIndex);
      latest = typed;
      if (typed.trim().length < 2 || /\n/.test(typed)) return [];
      if (cache.has(typed)) return cache.get(typed) ? [item(cache.get(typed), typed, "cache")] : [];
      // A suggestion for a shorter line that still fits what you've typed since ("type-through").
      for (const [k, v] of cache) if (v && typed.startsWith(k) && v.startsWith(typed) && v.length > typed.length) return [item(v, typed, "cache")];
      if (job && job.typed === typed) return [];      // already asking
      schedule(terminal, typed);
      return [];
    },
  };

  function schedule(terminal, typed) {
    if (job) job.cts.cancel();                         // you typed on: the older question is stale
    const mine = { typed, cts: new vscode.CancellationTokenSource() };
    job = mine;
    const pause = Math.max(cfg().get("tabCompletion.debounceMs") || 0, 120);
    setTimeout(async () => {
      if (job !== mine || latest !== typed) return;
      const t0 = Date.now();
      let line = "", engine = "";
      try { [line, engine] = await suggest(terminal, typed, mine.cts.token); } catch (e) { log(`terminal tab: ${e.message}`); }
      if (mine.cts.token.isCancellationRequested) return;
      cache.set(typed, line || "");
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      if (job === mine) job = null;
      if (!line) return;
      log(`terminal tab: "${line}" after ${Date.now() - t0} ms (${engine})`);
      // Still on that line, in that terminal: show it.
      if (latest === typed && vscode.window.activeTerminal === terminal) vscode.commands.executeCommand("workbench.action.terminal.triggerSuggest");
    }, pause);
  }

  if (!vscode.window.registerTerminalCompletionProvider) {
    log("terminal tab: this VS Code has no terminal suggestion API; Tab in the terminal is off");
    return;
  }
  context.subscriptions.push(vscode.window.registerTerminalCompletionProvider(provider, " ", "\"", "-", "/"));
  log("terminal tab: ready");
}

module.exports = { terminalTab, tidy, TERMINAL_SYSTEM_PROMPT };
