// Agent Review: Source Control's "Review Changes". A short-lived, read-only AI looks through your uncommitted changes
// (staged, unstaged and new text files, against HEAD) for real bugs, security problems, broken edge cases and missed
// requirements, and every finding appears as a comment on its line in the editor: "Fix with Kural" puts it into the chat,
// the cross removes it. Quick uses the fastest model you have; Deep the chat's model, thinking harder.
//   kural.review.quick / kural.review.deep (Source Control's title bar; get the SourceControl) · kural.review.clear ·
//   kural.review.fix / kural.review.dismiss (a comment's title bar; get the comment thread)
// core.js reads the changes and checks the answer, run.js runs the reviewer (neither uses vscode).
const vscode = require("vscode");
const path = require("path");
const { isHomeOrAbove } = require("../paths");
const { findGit } = require("../git");
const { collectDiff, findingText, locationText } = require("./core");
const { Reviewer } = require("./run");

const CONTROLLER = "kural-review";

// The repository folder the command is for: the Source Control the button was pressed in, else the first folder's.
function rootFor(arg) {
  const uri = arg && (arg.rootUri || (arg.sourceControl && arg.sourceControl.rootUri) || (arg.fsPath ? arg : null));
  if (uri && uri.fsPath) return uri.fsPath;
  const first = (vscode.workspace.workspaceFolders || [])[0];
  return first ? first.uri.fsPath : null;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function registerAgentReview(context, { brain, chat, log }) {
  const controller = vscode.comments.createCommentController(CONTROLLER, "Kural Review");
  context.subscriptions.push(controller);
  const threads = new Map();   // CommentThread → its finding
  let busy = false;

  const reviewer = new Reviewer({
    makeAgent: (model, opts, local, handlers) => brain.makeAgent(model, opts, local, handlers),
    isClaude: (model) => brain.engineOf(model) === "claude",
    mode: (model) => brain.engineOf(model) === "agy" ? "plan" : "ask",   // (agy: its read-only mode)
    localOpts: (model) => brain.isLocal(model) ? { tools: ["Read", "Glob", "Grep"], allowedTools: [], capabilities: [], store: brain.localStore(context) } : null,
    log,
  });

  const clear = () => {
    for (const t of [...threads.keys()]) { try { t.dispose(); } catch { /* already gone */ } }
    threads.clear();
  };

  // One comment thread per finding, on its lines.
  function show(top, findings) {
    for (const f of findings) {
      const uri = vscode.Uri.file(path.join(top, f.file));
      const range = new vscode.Range(f.line - 1, 0, f.endLine - 1, 0);
      const body = new vscode.MarkdownString(findingText(f));
      const thread = controller.createCommentThread(uri, range, [{ body, mode: vscode.CommentMode.Preview, author: { name: "Kural Review" } }]);
      thread.canReply = false;
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
      thread.contextValue = "kural-review";
      thread.label = `${f.severity[0].toUpperCase()}${f.severity.slice(1)}`;
      threads.set(thread, { ...f, uri, range });
    }
  }

  async function review(depth, arg) {
    if (busy) { vscode.window.showInformationMessage("Kural is already reviewing changes."); return; }
    const root = rootFor(arg);
    if (!root) { vscode.window.showInformationMessage("Open a folder first: Kural reviews its changes."); return; }
    // (A repository at your home folder or above: git would look through all of it; macOS asks about each folder.)
    if (isHomeOrAbove(root)) { vscode.window.showInformationMessage("Kural doesn't review repositories at your home folder or above."); return; }
    const deep = depth === "deep";
    const model = deep ? brain.currentModel() : brain.fastestModel();
    const can = model ? brain.usable(model) : { why: "No AI is set up. Open Kural: Get Started." };
    if (!can.ok) { vscode.window.showInformationMessage(`Kural: ${can.why}`); vscode.commands.executeCommand("kural.getStarted"); return; }
    const git = await findGit();
    if (!git) { vscode.window.showWarningMessage("Kural: Git isn't installed, so there is nothing to compare the changes with."); return; }
    busy = true;
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.SourceControl, title: "Kural is reviewing changes" }, () =>
        vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Kural is reviewing your changes${deep ? " (deep)" : ""}`, cancellable: true }, async (progress, token) => {
          const t0 = Date.now();
          let found;
          try { found = await collectDiff(root, git); }
          catch (e) { log(`agent review: ${e.message}`); vscode.window.showInformationMessage(`Kural: ${e.message}`); return; }
          if (!found.files.length) { vscode.window.showInformationMessage("Kural: there are no changes to review."); return; }
          log(`agent review (${depth}): ${found.files.length} files, ${found.skipped.length} skipped, read in ${Date.now() - t0} ms, ${brain.engineOf(model)} ${model}`);
          const job = reviewer.run({ depth, model, files: found.files, skipped: found.skipped, root: found.top, onStatus: (s) => progress.report({ message: s }) });
          const stop = token.onCancellationRequested(() => job.stop());
          const r = await job.done;
          stop.dispose();
          if (!r.ok) {
            if (r.kind !== "stopped") vscode.window.showWarningMessage(`Kural couldn't finish the review: ${r.error}`);
            return;
          }
          clear();
          show(found.top, r.findings);
          const head = r.findings.length ? `Kural found ${plural(r.findings.length, "thing", "things")} to look at` : "Kural found nothing to fix";
          const note = r.summary ? `${head}. ${r.summary.length > 300 ? `${r.summary.slice(0, 300)}…` : r.summary}` : head;
          // (Not awaited: an ignored notification must not hold the review "busy".)
          vscode.window.showInformationMessage(note, ...(r.findings.length ? ["Show"] : [])).then((pick) => {
            if (pick !== "Show") return;
            const first = [...threads.values()][0];
            if (first) vscode.window.showTextDocument(first.uri, { selection: first.range, preview: false });
          });
        }));
    } catch (e) { log(`agent review: ${e.stack || e.message}`); vscode.window.showWarningMessage(`Kural couldn't review the changes: ${e.message}`); }
    finally { busy = false; }
  }

  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg("kural.review.quick", (arg) => review("quick", arg));
  reg("kural.review.deep", (arg) => review("deep", arg));
  reg("kural.review.clear", clear);
  reg("kural.review.dismiss", (thread) => {
    const f = threads.get(thread);
    if (!f) return;
    threads.delete(thread);
    thread.dispose();
  });
  // The finding goes into the chat as a pill, with "Fix this." as the message to send.
  reg("kural.review.fix", async (thread) => {
    const f = threads.get(thread);
    if (!f) return;
    try {
      await vscode.commands.executeCommand("kural.chat.addContext", { label: f.title.length > 60 ? `${f.title.slice(0, 60)}…` : f.title,
        text: `${findingText(f)}\n\nLocation: ${locationText(f)}`, source: "review", prompt: "Fix this." });
    } catch (e) { log(`agent review: ${e.message}`); vscode.window.showWarningMessage(`Kural couldn't send that to the chat: ${e.message}`); return; }
    threads.delete(thread);
    thread.dispose();
  });
  context.subscriptions.push({ dispose: clear });
}

module.exports = { registerAgentReview };
