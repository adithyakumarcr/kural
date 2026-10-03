// Tab in the terminal: one suggested command line, in the terminal's own suggestion list (Tab accepts it).
//
// The same engine and model as Tab in the editor (kural.tabCompletion.*): the local model (Ollama), Claude,
// or Auto (both race). One line only, never runs anything: you still press Enter yourself.
//
// What the model sees: the shell and folder, your last commands in this terminal, git status, and for
// `git commit -m "…` the actual staged changes (or the unstaged ones), so it can name the commit.
// Plus your own activity (activity.js): commands you often run here; for a commit, your recent commit
// messages (to match your style) and what you asked Kural to do since the last commit (the *why*).
//
// Plain words work too: "push this code to the fix/code-editor branch" → git push origin fix/code-editor. Those go to
// the chat's model (an instruct model that can follow a request; Tab Completion's small fill-in model can't), with the
// git branch and remotes, and the changes for a commit.
//
// Speed: the terminal waits for every suggestion source before showing its list, so Kural never makes it
// wait: it answers from its cache, and opens the list again when a new answer arrives (see the provider).

const vscode = require("vscode");
const { execFile } = require("child_process");
const { log } = require("../ai/claude");

const DIFF_CHARS = 3500;

// Plain words → one command line (the chat's model).
const INTENT_SYSTEM_PROMPT = `You turn what the user wrote in plain words in their terminal into the one shell command
line that does it. Reply with exactly one <cmd>...</cmd> block: one line, the complete command, no explanation.
Use the context: the shell, the folder, the git branch and remotes, recent commands. Examples:
"push this code to fix/code-editor branch" -> <cmd>git push origin fix/code-editor</cmd>
"commit with message fixed the login bug" -> <cmd>git commit -m "Fixed the login bug"</cmd>
"commit everything" -> <cmd>git commit -am "..."</cmd> with a short message that names what the changes do
"show files changed today" -> <cmd>find . -type f -newermt "$(date +%F)" -not -path "./.git/*"</cmd>
For a commit message they wrote, keep their words (fix the capital letter and obvious typos only) and close the quote;
if they didn't write one, write a short one from the changes. The command must fit on ONE line: never a heredoc, never
$(cat <<EOF …), never several -m, no trailers (no Co-Authored-By or similar): only the message itself. Never add destructive options (--force, -f, rm -rf,
reset --hard) unless they asked for them. If you can't tell what they want, reply <cmd></cmd>.`;

const TERMINAL_SYSTEM_PROMPT = `You are the autocomplete of a terminal. You get what the user has typed so far
in the shell, plus context (folder, recent commands, git state). Reply with exactly one <cmd>...</cmd> block holding
the COMPLETE command line the user most likely wants: it must start with exactly what they typed. One line only;
never several commands on separate lines, never explanations.
For git commit messages (e.g. git commit -m "): write a short, specific message in the imperative mood
(max ~65 characters) that names what the changes actually do, based on the staged diff (or, if nothing is
staged, the unstaged diff). Close the quote. Match the style of their recent commit messages (prefixes, case,
wording). If you're told what they asked the editor to do since the last commit and it gives a reason (a bug, a crash,
a request), name the reason briefly, e.g. "cart: reject empty orders (checkout crashed on submit)".
If nothing sensible fits, reply <cmd></cmd>.`;

const cfg = () => vscode.workspace.getConfiguration("kural");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, cwd, timeout = 1500) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, out) => resolve(err ? "" : String(out)));
  });
}

// What the model needs to know besides the line itself. Git is asked at most every few seconds per folder.
// For a commit also: when the last commit was and which files changed (to pick your activity since then).
const gitCache = new Map();   // cwd + kind -> { at, text, since, files }
async function gitContext(cwd, wantDiff) {
  const key = `${cwd}|${wantDiff}`;
  const hit = gitCache.get(key);
  if (hit && Date.now() - hit.at < 4000) return hit;
  let text = "", since = 0, files = [];
  const status = await run("git", ["status", "--short", "--branch"], cwd);
  if (status) {
    text = `git status:\n${status.split("\n").slice(0, 25).join("\n")}`;
    const remotes = (await run("git", ["remote"], cwd)).trim().split("\n").filter(Boolean);
    if (remotes.length) text += `\nRemotes: ${remotes.join(", ")}`;
    if (wantDiff) {
      let diff = await run("git", ["diff", "--cached", "--stat"], cwd), which = "staged", names = ["--cached"];
      let body = diff ? await run("git", ["diff", "--cached", "-U1"], cwd) : "";
      if (!diff) { which = "not staged yet"; names = []; diff = await run("git", ["diff", "--stat"], cwd); body = await run("git", ["diff", "-U1"], cwd); }
      if (diff) text += `\n\nChanges (${which}):\n${diff}\n${body.slice(0, DIFF_CHARS)}${body.length > DIFF_CHARS ? "\n… (more changes)" : ""}`;
      files = (await run("git", ["diff", "--name-only", ...names], cwd)).split("\n").filter(Boolean);
      const log = (await run("git", ["log", "-8", "--format=%s"], cwd)).trim();
      if (log) text += `\n\nTheir recent commit messages (match this style):\n${log}`;
      since = Number((await run("git", ["log", "-1", "--format=%ct"], cwd)).trim()) * 1000 || 0;
    }
  }
  const out = { at: Date.now(), text, since, files };
  gitCache.set(key, out);
  return out;
}

// The last commands run in each terminal (needs shell integration, which VS Code sets up for bash/zsh/fish/pwsh).
const recent = new Map();   // terminal -> [command lines]
function trackCommands(context, activity) {
  if (!vscode.window.onDidEndTerminalShellExecution) return;
  context.subscriptions.push(vscode.window.onDidEndTerminalShellExecution((e) => {
    const line = e.execution && e.execution.commandLine && e.execution.commandLine.value;
    if (!line || !line.trim()) return;
    const list = recent.get(e.terminal) || [];
    list.push(line.trim());
    recent.set(e.terminal, list.slice(-8));
    if (activity) activity.ranCommand(line);
  }), vscode.window.onDidCloseTerminal((t) => recent.delete(t)));
}

// Is this plain words ("push this to main") rather than a command ("git push origin main")? Cheap, no model:
// shell syntax (flags, pipes, quotes…) means a command; otherwise words that read like a sentence (filler words like
// "this", "to", "my") or a first word that isn't a program you have.
const FILLER = /^(this|that|these|the|to|my|a|an|all|with|and|from|into|for|of|me|please|which|what|how|it|its|them|new|current|every|everything|branch|message)$/i;
const BUILTINS = new Set(["cd", "export", "echo", "source", "alias", "set", "unset", "exit", "history", "type", "which", "eval", "exec", "pwd", "pushd", "popd", "ls", "dir"]);
const known = new Map();   // first word -> is it a program on PATH (or a builtin)?
function isProgram(word) {
  const w = String(word || "").toLowerCase();
  if (BUILTINS.has(w)) return true;
  if (known.has(w)) return known.get(w);
  const fs = require("fs"), path = require("path");
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat", ".ps1"] : [""];
  const yes = (process.env.PATH || "").split(path.delimiter).some((d) => d && exts.some((e) => { try { return fs.statSync(path.join(d, w + e)).isFile(); } catch { return false; } }));
  known.set(w, yes);
  return yes;
}
// Words only people write, not commands: after a program name ("git push this to the main branch") two are needed.
const PERSONAL = /^(this|that|these|the|my|a|an|please|me|it|its|them|which|what|how|into)$/i;
function plainWords(typed) {
  const t = String(typed || "").trim();
  const words = t.split(/\s+/);
  if (words.length < 3) return false;
  if (/[|><$`=;&\\]|(^|\s)--?[A-Za-z]|["']/.test(t)) return false;   // shell syntax: a command
  if (/[\/\\]|^[.~]/.test(words[0])) return false;                     // ./run.sh, /usr/bin/python3, ~/bin/x: a program
  // A wrong guess replaces your command line, so only clear sentences count.
  if (isProgram(words[0])) return words.filter((w) => PERSONAL.test(w)).length >= 2;
  return words.some((w) => FILLER.test(w));
}

// What the chat's model is asked for plain words.
function intentPrompt({ shell, cwd, history, git, typed }) {
  return `Shell: ${shell}\nFolder: ${cwd}\n${history ? `Recent commands:\n${history}\n` : ""}${git ? `\n${git}\n` : ""}\nThey wrote:\n${typed}`;
}
// The model's answer → one command line ("" when there's none).
function tidyIntent(answer) {
  const m = /<cmd>([\s\S]*?)(<\/cmd>|$)/.exec(String(answer || ""));
  const full = (m ? m[1] : "").trim();
  // A commit written as a heredoc (git commit -m "$(cat <<'EOF' … EOF)"): one line with its first line of message.
  const h = /^(git\s+commit\b[^\n]*?)(-[a-z]*m)\s+"\$\(cat\s+<<-?'?(\w+)'?\s*\n([\s\S]*?)\n\s*\3/.exec(full);
  if (h) { const msg = (h[4].split(/\r?\n/).find((l) => l.trim()) || "").trim().replace(/"/g, '\\"'); return msg ? `${h[1]}${h[2]} "${msg}"` : ""; }
  let s = full.replace(/^\s*\$\s/, "").split(/\r?\n/)[0].trim();
  if ((s.replace(/\\"/g, "").match(/"/g) || []).length % 2) s += '"';
  return s;
}

// What Claude is asked (the instructions are TERMINAL_SYSTEM_PROMPT).
function claudePrompt({ shell, cwd, history, git, note, typed }) {
  return `Shell: ${shell}\nFolder: ${cwd}\n${history ? `Recent commands:\n${history}\n` : ""}${git ? `\n${git}\n` : ""}${note ? `\n${note}` : ""}\nTyped so far:\n${typed}`;
}

// The model's answer → the full command line, or "" if it doesn't continue what was typed.
function tidy(answer, typed) {
  let s = String(answer || "").replace(/<\|[a-z_]+\|>/g, "");   // the local model's markers, e.g. <|endoftext|>
  const m = /<cmd>([\s\S]*?)(<\/cmd>|$)/.exec(s);
  if (m) s = m[1];
  s = s.replace(/^\s*\$\s/, "").split(/\r?\n/)[0].replace(/\s+$/, "");
  // (The local model writes only what comes after the cursor; viaLocal puts the typed part in front.)
  if (!s.startsWith(typed) || s.length <= typed.length) return "";
  // The model sometimes forgets the closing quote of a commit message: an odd number of " means one is open.
  if ((s.replace(/\\"/g, "").match(/"/g) || []).length % 2) s += '"';
  return s;
}

// The first [text, engine] with text in it, or ["", ""] when none has any.
function firstAnswer(promises) {
  return new Promise((resolve) => {
    let left = promises.length;
    for (const p of promises) p.then((r) => { if (r && r[0]) resolve(r); else if (--left === 0) resolve(["", ""]); });
  });
}

// A suggestion that continues what you typed replaces the line (the list keeps it while it matches your typing).
// One that doesn't start with it ("push this to main" → "git push origin main") would be hidden: the list only shows
// items that match the typed text. So it replaces nothing as far as the list knows (always shown), and `inputData`
// (what the terminal receives on Tab; VS Code's own items use it) first deletes what you typed, with the same
// delete key VS Code sends when it replaces text. (inputData isn't in the published API: check after VSCodium updates.)
function suggestionItem(line, typed, engine, kind) {
  const words = !line.startsWith(typed);
  return {
    label: line, kind,
    replacementRange: words ? [typed.length, typed.length] : [0, typed.length],
    ...(words ? { inputData: "\x7F".repeat([...typed].length) + line } : {}),
    detail: `Kural · ${words ? "from your words" : engine === "chat" ? "your chat model" : "Tab Completion"}`,
    documentation: words ? "Kural turned what you wrote into this command. Tab puts it in place of your words; you still press Enter to run it."
      : "Suggested by Kural's Tab Completion. Tab inserts it; you still press Enter to run it.",
  };
}

// commitSession: commit messages come from the chat's model (lib/ai Session); intentSession: plain words → a command,
// also the chat's model. Other lines: Tab Completion's engine.
function terminalTab(context, session, local, activity = null, commitSession = null, intentSession = null) {
  trackCommands(context, activity);
  const cache = new Map();   // typed line -> suggested line

  async function suggest(terminal, typed, token) {
    const cwd = (terminal.shellIntegration && terminal.shellIntegration.cwd && terminal.shellIntegration.cwd.fsPath)
      || (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0].uri.fsPath) || process.cwd();
    const shell = (terminal.state && terminal.state.shell) || (process.platform === "win32" ? "pwsh" : "bash");
    if (intentSession && plainWords(typed)) {
      const g = await gitContext(cwd, /\bcommit\b/i.test(typed));
      const history = (recent.get(terminal) || []).map((c) => `$ ${c}`).join("\n");
      return [tidyIntent(await intentSession.ask(intentPrompt({ shell, cwd, history, git: g.text, typed }), token)), "words"];
    }
    const commit = /^\s*git\s+commit\b/.test(typed);
    const g = await gitContext(cwd, commit);
    const git = g.text;
    const note = activity ? activity.terminalNote(typed, commit ? { since: g.since, files: g.files } : null) : "";
    const history = (recent.get(terminal) || []).map((c) => `$ ${c}`).join("\n");
    if (commit && commitSession) return [tidy(await commitSession.ask(claudePrompt({ shell, cwd, history, git, note, typed }), token), typed), "chat"];
    const engineSetting = cfg().get("tabCompletion.engine");
    const useLocal = local && engineSetting !== "claude" && await local.ready();

    const viaClaude = async (tok = token) => {
      return tidy(await session.ask(claudePrompt({ shell, cwd, history, git, note, typed }), tok), typed);
    };
    const viaLocal = async () => {
      // A fill-in-the-middle prompt for the code model: the context as shell comments, then the line.
      const comment = (t) => t.split("\n").map((l) => `# ${l}`).join("\n");
      const prefix = `# ${shell} terminal in ${cwd}\n${git ? `${comment(git.slice(0, 1500))}\n` : ""}${note ? `${comment(note.trim().slice(0, 600))}\n` : ""}${history ? `${history}\n` : ""}$ ${typed}`;
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
  const item = (line, typed, engine) => suggestionItem(line, typed, engine, kind);

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

module.exports = { terminalTab, tidy, TERMINAL_SYSTEM_PROMPT, INTENT_SYSTEM_PROMPT, _test: { suggestionItem, gitContext, claudePrompt, plainWords, tidyIntent, intentPrompt } };
