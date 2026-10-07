// A commit message, suggested in the Source Control panel: the sparkle button in the commit message box (and in the
// panel's title bar) reads the staged changes (or, with nothing staged, all changes), your recent commit messages for
// the style, and writes a message into the box, from the chat's model (lib/ai Session). You edit it and commit as usual.
// Uses VS Code's git extension (its API), never a git login.
const vscode = require("vscode");
const { log } = require("../log");
const { isHomeOrAbove } = require("../paths");

const DIFF_CHARS = 14000;   // enough to see what changed; long diffs are cut (the file list stays complete)

const SYSTEM_PROMPT = `You write git commit messages. You get the changes (a diff, maybe cut) and the author's recent commit
messages. Reply with ONLY the commit message inside <msg>...</msg>: a subject line of at most 72 characters in the
imperative mood ("Add", "Fix", "Rename"), specific about what changed; for a bigger change, a blank line and a short body
(a few lines or "- " bullets) saying what and why. Match the style of their recent messages (prefixes like "feat:", case,
language). No quotes around it, no explanations, nothing outside the tags.`;

function gitApi() {
  const ext = vscode.extensions.getExtension("vscode.git");
  if (!ext) return null;
  const exports = ext.isActive ? ext.exports : null;
  return exports && exports.enabled !== false ? exports.getAPI(1) : null;
}

// The repository the button was pressed for (the panel passes its SourceControl), else the one of the active file, else
// the only one.
function repositoryFor(git, arg) {
  const root = arg && arg.rootUri ? arg.rootUri.fsPath : null;
  if (root) { const r = git.repositories.find((x) => x.rootUri.fsPath === root); if (r) return r; }
  const doc = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri;
  if (doc && doc.scheme === "file") { const r = git.getRepository(doc); if (r) return r; }
  return git.repositories.length === 1 ? git.repositories[0] : null;
}

// What the model reads: which changes (staged, or everything), the diff, the recent subjects.
async function changesText(repo) {
  let staged = await repo.diff(true), which = "staged";
  if (!staged.trim()) { staged = await repo.diff(false); which = "not staged (nothing is staged)"; }
  const untracked = (repo.state.untrackedChanges || repo.state.workingTreeChanges.filter((c) => c.status === 7) || [])
    .map((c) => vscode.workspace.asRelativePath(c.uri));
  if (!staged.trim() && !untracked.length) return null;
  let recent = [];
  try { recent = (await repo.log({ maxEntries: 8 })).map((c) => c.message.split("\n")[0]); } catch { /* a new repository */ }
  return `Changes (${which}):\n${staged.slice(0, DIFF_CHARS)}${staged.length > DIFF_CHARS ? "\n… (the rest of the diff is cut)" : ""}` +
    (untracked.length && which !== "staged" ? `\n\nNew files not in git yet: ${untracked.slice(0, 40).join(", ")}` : "") +
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
    const repo = repositoryFor(git, arg);
    if (!repo) { vscode.window.showInformationMessage("Kural: open a file of the repository first (there are several)."); return; }
    // (A repository at your home folder or above: git would look through all of it; macOS asks about each folder.)
    if (isHomeOrAbove(repo.rootUri.fsPath)) { vscode.window.showInformationMessage("Kural doesn't read repositories at your home folder or above."); return; }
    busy = true;
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.SourceControl, title: "Kural is writing a commit message" }, async () => {
        const text = await changesText(repo);
        if (!text) { vscode.window.showInformationMessage("Kural: there are no changes to describe."); return; }
        const t0 = Date.now();
        const msg = tidy(await session.ask(`${text}\n\nWrite the commit message for these changes.`));
        log(`commit message: ${msg ? `${msg.split("\n")[0].length} char subject` : "none"} in ${Date.now() - t0} ms`);
        if (!msg) { vscode.window.showWarningMessage("Kural couldn't write a commit message (see Kural: Show Log)."); return; }
        repo.inputBox.value = msg;
      });
    } catch (e) { log(`commit message: ${e.message}`); vscode.window.showWarningMessage(`Kural: ${e.message}`); }
    finally { busy = false; }
  }));
}

module.exports = { registerCommitMessages, SYSTEM_PROMPT, tidy };
