// Review AI edits in a read-only virtual document. The real buffer stays unchanged until Accept,
// so Auto Save, focus changes, shutdown and crashes cannot save unreviewed or mixed old/new code.
const vscode = require("vscode");
const { diffLines } = require("./diff");
const { log } = require("../ai/claude");
const SCHEME = "kural-review";

class ReviewManager {
  constructor() {
    this.pending = null;
    this.selfEdit = false;
    this.lensEmitter = new vscode.EventEmitter();
  }

  register(context) {
    context.subscriptions.push(
      this.lensEmitter,
      vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
        provideTextDocumentContent: (uri) => this.pending && uri.toString() === this.pending.preview.toString() ? this.pending.text : "(review closed)",
      }),
      vscode.languages.registerCodeLensProvider({ pattern: "**" }, {
        onDidChangeCodeLenses: this.lensEmitter.event,
        provideCodeLenses: (doc) => {
          const p = this.pending;
          if (!p || ![p.uri, p.preview.toString()].includes(doc.uri.toString())) return [];
          const range = new vscode.Range(p.start, 0, p.start, 0);
          const mod = process.platform === "darwin" ? "Cmd" : "Ctrl";
          return [new vscode.CodeLens(range, { title: `$(check) Accept  (${mod}+Enter)`, command: "kural.review.accept" }),
            new vscode.CodeLens(range, { title: `$(close) Reject  (${mod}+Shift+Backspace)`, command: "kural.review.reject" })];
        },
      }),
      vscode.commands.registerCommand("kural.review.accept", () => this.finish(true)),
      vscode.commands.registerCommand("kural.review.reject", () => this.finish(false)),
      vscode.workspace.onDidChangeTextDocument((e) => this.onChange(e)),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (this.pending && doc.uri.toString() === this.pending.uri) this.clear();
      }),
    );
  }

  busy() { return !!this.pending; }

  async propose(doc, startLine, endLine, newText, meta = null) {
    if (this.pending) return false;
    const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const oldLines = [];
    for (let l = startLine; l < endLine; l++) oldLines.push(doc.lineAt(l).text);
    const newLines = newText.replace(/\r?\n$/, "").split(/\r?\n/);
    const ops = diffLines(oldLines, newLines);
    if (!ops.some((o) => o.op !== "same")) { vscode.window.showInformationMessage("Kural: no changes suggested."); return false; }
    const original = doc.getText(), replacement = newLines.join(eol);
    let from, to, inserted = replacement;
    if (endLine > startLine) {
      from = doc.offsetAt(new vscode.Position(startLine, 0));
      to = doc.offsetAt(new vscode.Position(endLine - 1, doc.lineAt(endLine - 1).text.length));
    } else if (startLine < doc.lineCount) {
      from = to = doc.offsetAt(new vscode.Position(startLine, 0)); inserted += eol;
    } else {
      from = to = original.length; inserted = eol + replacement;
    }
    const preview = vscode.Uri.from({ scheme: SCHEME, path: doc.uri.path, query: `review=${Date.now()}` });
    this.pending = { uri: doc.uri.toString(), doc, version: doc.version, original,
      text: original.slice(0, from) + inserted + original.slice(to), preview, start: startLine, meta };
    vscode.commands.executeCommand("setContext", "kural.reviewPending", true);
    this.lensEmitter.fire();
    try { await vscode.commands.executeCommand("vscode.diff", doc.uri, preview, "Kural: review change — Accept or Reject", { preview: true }); }
    catch (e) { this.clear(); throw e; }
    log("review: showing a read-only proposed change; the file is unchanged");
    return true;
  }

  onChange(e) {
    if (this.selfEdit || !this.pending || e.document.uri.toString() !== this.pending.uri) return;
    this.done(false);
    this.clear();
    vscode.window.showWarningMessage("Kural: the file changed during review. The proposal was discarded to preserve your edits; request it again.");
  }

  async finish(accept) {
    const p = this.pending;
    if (!p) return;
    if (accept) {
      const doc = p.doc;
      if (doc.isClosed || doc.version !== p.version || doc.getText() !== p.original) {
        vscode.window.showWarningMessage("Kural: the file changed during review. No changes were applied.");
        this.done(false); this.clear(); return false;
      }
      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, new vscode.Range(new vscode.Position(0, 0), doc.lineAt(doc.lineCount - 1).range.end), p.text);
      this.selfEdit = true;
      let ok;
      try { ok = await vscode.workspace.applyEdit(edit); } finally { this.selfEdit = false; }
      if (!ok) return false;   // Keep the proposal so the user can retry or reject.
    }
    log(`review: ${accept ? "accepted" : "rejected"}`);
    this.done(accept); this.clear(); return true;
  }

  done(accept) {
    const p = this.pending;
    if (p && p.meta && this.onDone) { try { this.onDone(p.meta, accept, p.uri); } catch (e) { log(`review: ${e.message}`); } }
  }

  clear() {
    this.pending = null;
    vscode.commands.executeCommand("setContext", "kural.reviewPending", false);
    this.lensEmitter.fire();
  }
}
module.exports = { ReviewManager };
