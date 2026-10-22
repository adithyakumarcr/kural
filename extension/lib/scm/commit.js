// A commit message, suggested in the Source Control panel: the sparkle button in the commit message box (and in the
// panel's title bar) reads the staged changes (or, with nothing staged, all changes), your recent commit messages for
// the style, and writes a message into the box, from the chat's model (lib/ai Session). You edit it and commit as usual.
// Uses VS Code's git extension (its API), never a git login.
const vscode = require("vscode");
const { log } = require("../log");
const { isHomeOrAbove } = require("../paths");

const DIFF_CHARS = 14000;   // enough to see what changed; long diffs are cut (the file list stays complete)

// Short on purpose (Adithya, issue #104): about 200 characters in all. Longer replies are cut by `concise`.
const MAX_CHARS = 200;

const SYSTEM_PROMPT = `You write short git commit messages in the Conventional Commits style. You get the changes (a diff, maybe cut),
the list of every changed file and the author's recent commit messages. Reply with ONLY the commit message inside
<msg>...</msg>, at most ${MAX_CHARS} characters in total:
- Subject: "<type>(<optional scope>): <summary>", at most 72 characters, imperative mood, lower case after the colon, no
  final period. Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert. Use "!" after the type for a
  breaking change.
- Only when the subject can't say it all: a blank line, then one or two short lines saying what changed and why. Sum up;
  don't list every file.
If their recent messages clearly use another style (other prefixes, language), keep their style but still follow these
rules for length. No quotes around it, no explanations, nothing outside the tags.`;

// A reply longer than MAX_CHARS: the subject and as many whole lines after it as fit (a subject alone that's too long is
// cut at a word).
function concise(msg, max = MAX_CHARS) {
  const lines = String(msg || "").trim().split("\n").map((l) => l.trimEnd());
  if (!lines[0]) return "";
  let out = lines[0];
  if (out.length > max) return out.slice(0, max).replace(/\s+\S*$/, "").trim() || out.slice(0, max);
  for (const line of lines.slice(1)) {
    if (!line.trim()) { if (!out.endsWith("\n")) out += "\n"; continue; }   // (a blank line: kept once)
    const next = `${out}\n${line}`;
    if (next.length > max) break;
    out = next;
  }
  return out.replace(/\n+$/, "");
}

function gitApi() {
  const ext = vscode.extensions.getExtension("vscode.git");
  if (!ext) return null;
  const exports = ext.isActive ? ext.exports : null;
  return exports && exports.enabled !== false ? exports.getAPI(1) : null;
}

// The repository the button was pressed for. The panel passes its SourceControl (or a repository, or a Uri), with
// several folders open that is the only reliable answer; else the repository of the active file, else the only one,
// else you pick (never a silent guess: the other folder's changes would end up in the wrong message).
async function repositoryFor(git, arg) {
  const uri = arg && (arg.rootUri || (arg.sourceControl && arg.sourceControl.rootUri) || (arg.fsPath ? arg : null));
  const root = uri && uri.fsPath;
  if (root) {
    const same = (x) => x.rootUri.fsPath === root;
    const r = git.repositories.find(same) || git.getRepository(vscode.Uri.file(root));
    if (r) return r;
  }
  if (git.repositories.length === 1) return git.repositories[0];
  if (!git.repositories.length) return null;
  const doc = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri;
  const active = doc && doc.scheme === "file" ? git.getRepository(doc) : null;
  const items = git.repositories.map((r) => ({ label: require("path").basename(r.rootUri.fsPath), description: r.rootUri.fsPath, repo: r }))
    .sort((x, y) => (y.repo === active) - (x.repo === active));
  const pick = await vscode.window.showQuickPick(items, { placeHolder: "Write the commit message for which repository?" });
  return pick ? pick.repo : undefined;
}

const STATUS = { 0: "modified", 1: "added", 2: "deleted", 3: "renamed", 4: "copied", 5: "modified", 6: "deleted", 7: "new file", 8: "new file", 9: "modified", 10: "both added", 11: "both deleted", 12: "added by us", 13: "added by them", 14: "deleted by us", 15: "deleted by them", 16: "both modified" };

// What the model reads: which changes (staged, or everything), the diff, every changed file, the recent subjects.
// The git extension's own state can be a moment behind (a file the AI just wrote), so it is refreshed first.
async function changesText(repo) {
  try { await repo.status(); } catch { /* the diff below still works */ }
  const st = repo.state;
  const rel = (c) => vscode.workspace.asRelativePath(c.uri, false);
  const rootRel = (c) => require("path").relative(repo.rootUri.fsPath, c.uri.fsPath);
  const staged = (st.indexChanges || []);
  const loose = [...(st.workingTreeChanges || []), ...(st.untrackedChanges || [])];
  let diff = "", which = "staged";
  if (staged.length) diff = await repo.diff(true);
  else { which = "all changes (nothing is staged)"; try { diff = await repo.diffWithHEAD(); } catch { diff = await repo.diff(false); } }
  const files = (staged.length ? staged : loose).map((c) => `${STATUS[c.status] || "changed"}: ${rootRel(c) || rel(c)}`);
  const seen = new Set(), list = files.filter((f) => !seen.has(f) && seen.add(f));
  // New files have no diff: show the start of small text ones.
  let fresh = "";
  if (!staged.length) {
    for (const c of loose.filter((x) => x.status === 7 || x.status === 8).slice(0, 8)) {
      try {
        const buf = Buffer.from(await vscode.workspace.fs.readFile(c.uri));
        if (buf.length < 20000 && !buf.includes(0)) fresh += `\n--- new file ${rootRel(c)} ---\n${buf.toString("utf8").slice(0, 1500)}`;
      } catch { /* unreadable or gone */ }
    }
  }
  if (!diff.trim() && !list.length) return null;
  let recent = [];
  try { recent = (await repo.log({ maxEntries: 8 })).map((c) => c.message.split("\n")[0]); } catch { /* a new repository */ }
  return `Repository: ${require("path").basename(repo.rootUri.fsPath)}\nChanged files (${which}):\n${list.slice(0, 80).join("\n")}` +
    `\n\nDiff:\n${diff.slice(0, DIFF_CHARS)}${diff.length > DIFF_CHARS ? "\n… (the rest of the diff is cut; the file list above is complete)" : ""}` + fresh +
    (recent.length ? `\n\nTheir recent commit messages (match this style):\n${recent.join("\n")}` : "");
}

const tidy = (raw) => {
  const m = /<msg>([\s\S]*?)(?:<\/msg>|$)/.exec(String(raw || ""));
  return (m ? m[1] : String(raw || "")).replace(/^\s*["'`]+|["'`]+\s*$/g, "").trim();
};

function registerCommitMessages(context, session) {
  let busy = false;
  context.subscriptions.push(vscode.commands.registerCommand("kural.scm.commitMessage", async (arg) => {
    if (busy) return;
    const git = gitApi();
    if (!git) { vscode.window.showWarningMessage("Kural: Git isn't available here (the built-in Git extension is off)."); return; }
    const repo = await repositoryFor(git, arg);
    if (repo === undefined) return;   // you closed the picker
    if (!repo) { vscode.window.showInformationMessage("Kural: no Git repository is open."); return; }
    // (A repository at your home folder or above: git would look through all of it; macOS asks about each folder.)
    if (isHomeOrAbove(repo.rootUri.fsPath)) { vscode.window.showInformationMessage("Kural doesn't read repositories at your home folder or above."); return; }
    busy = true;
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.SourceControl, title: "Kural is writing a commit message" }, async () => {
        const text = await changesText(repo);
        if (!text) { vscode.window.showInformationMessage("Kural: there are no changes to describe."); return; }
        const t0 = Date.now();
        const msg = concise(tidy(await session.ask(`${text}\n\nWrite a short commit message (at most ${MAX_CHARS} characters) for these changes.`)));
        log(`commit message: ${msg ? `${msg.split("\n")[0].length} char subject` : "none"} in ${Date.now() - t0} ms`);
        if (!msg) { vscode.window.showWarningMessage("Kural couldn't write a commit message (see Kural: Show Log)."); return; }
        repo.inputBox.value = msg;
      });
    } catch (e) { log(`commit message: ${e.message}`); vscode.window.showWarningMessage(`Kural: ${e.message}`); }
    finally { busy = false; }
  }));
}

module.exports = { registerCommitMessages, SYSTEM_PROMPT, tidy, concise, MAX_CHARS };
