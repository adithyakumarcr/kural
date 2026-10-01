// Shows a proposed change right inside the file, like a diff:
//   red lines   = what Claude wants to remove
//   green lines = what Claude wants to add
// Accept keeps the green lines, Reject keeps the red ones.
//
// Both versions are really in the file while you review (that's how we can show
// them inline). So: saving accepts the change, and accept/reject simply delete
// the lines you don't want.

const vscode = require("vscode");
const { diffLines } = require("./diff");
const { log } = require("./claude");

class ReviewManager {
  constructor() {
    this.pending = null; // { uri, start, ops: [{op, text}] }
    this.selfEdit = false;
    this.addedDeco = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: "rgba(95, 170, 105, 0.16)",
      borderColor: "rgba(95, 170, 105, 0.7)", borderStyle: "solid", borderWidth: "0 0 0 3px",
      overviewRulerColor: "rgba(95, 170, 105, 0.9)", overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    this.removedDeco = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: "rgba(215, 85, 75, 0.16)",
      borderColor: "rgba(215, 85, 75, 0.7)", borderStyle: "solid", borderWidth: "0 0 0 3px",
      textDecoration: "line-through; opacity: 0.55",
      overviewRulerColor: "rgba(215, 85, 75, 0.9)", overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    this.lensEmitter = new vscode.EventEmitter();
  }

  register(context) {
    context.subscriptions.push(
      this.addedDeco, this.removedDeco,
      vscode.languages.registerCodeLensProvider({ pattern: "**" }, {
        onDidChangeCodeLenses: this.lensEmitter.event,
        provideCodeLenses: (doc) => {
          if (!this.pending || doc.uri.toString() !== this.pending.uri) return [];
          const range = new vscode.Range(this.pending.start, 0, this.pending.start, 0);
          const n = this.pending.ops.filter((o) => o.op !== "same").length;
          return [
            new vscode.CodeLens(range, { title: "✓ Accept  (Ctrl+Enter)", command: "kural.review.accept" }),
            new vscode.CodeLens(range, { title: "✕ Reject  (Ctrl+Shift+Backspace)", command: "kural.review.reject" }),
            new vscode.CodeLens(range, { title: `${n} line${n === 1 ? "" : "s"} changed`, command: "" }),
          ];
        },
      }),
      vscode.commands.registerCommand("kural.review.accept", () => this.finish(true)),
      vscode.commands.registerCommand("kural.review.reject", () => this.finish(false)),
      vscode.workspace.onDidChangeTextDocument((e) => this.onChange(e)),
      vscode.workspace.onWillSaveTextDocument((e) => {
        if (!this.pending || e.document.uri.toString() !== this.pending.uri) return;
        log("review: file saved, accepting the change");
        const edits = this.deletions(e.document, "del").map((r) => vscode.TextEdit.delete(r));
        this.clear();
        e.waitUntil(Promise.resolve(edits));
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => this.paint()),
      vscode.workspace.onDidCloseTextDocument((d) => { if (this.pending && d.uri.toString() === this.pending.uri) this.clear(); }),
    );
  }

  busy() { return !!this.pending; }

  // Replace lines [startLine, endLine) of `doc` with `newText`, shown as a reviewable diff.
  async propose(doc, startLine, endLine, newText) {
    const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const oldLines = [];
    for (let l = startLine; l < endLine; l++) oldLines.push(doc.lineAt(l).text);
    const newLines = newText.replace(/\r?\n$/, "").split(/\r?\n/);
    const ops = diffLines(oldLines, newLines);
    if (!ops.some((o) => o.op !== "same")) { vscode.window.showInformationMessage("Kural: no changes suggested."); return false; }

    const combined = ops.map((o) => o.text).join(eol);
    const edit = new vscode.WorkspaceEdit();
    let blockStart = startLine;
    if (endLine > startLine) {
      edit.replace(doc.uri, new vscode.Range(startLine, 0, endLine - 1, doc.lineAt(endLine - 1).text.length), combined);
    } else if (startLine < doc.lineCount) {
      edit.insert(doc.uri, new vscode.Position(startLine, 0), combined + eol);
    } else {
      edit.insert(doc.uri, doc.lineAt(doc.lineCount - 1).range.end, eol + combined);
      blockStart = doc.lineCount;
    }
    this.selfEdit = true;
    const ok = await vscode.workspace.applyEdit(edit);
    this.selfEdit = false;
    if (!ok) return false;

    this.pending = { uri: doc.uri.toString(), start: blockStart, ops };
    vscode.commands.executeCommand("setContext", "kural.reviewPending", true);
    this.paint();
    this.lensEmitter.fire();
    const ed = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === this.pending.uri);
    const first = ops.findIndex((o) => o.op !== "same");
    if (ed) ed.revealRange(new vscode.Range(blockStart + first, 0, blockStart + first, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    log(`review: showing ${ops.filter((o) => o.op === "add").length} added / ${ops.filter((o) => o.op === "del").length} removed lines`);
    return true;
  }

  ranges(kind) {
    const out = [];
    this.pending.ops.forEach((o, i) => { if (o.op === kind) out.push(new vscode.Range(this.pending.start + i, 0, this.pending.start + i, 0)); });
    return out;
  }

  // Ranges (including line breaks) covering every line of one kind.
  // Neighbouring lines are deleted as one run, so the ranges never overlap.
  deletions(doc, kind) {
    const lines = [];
    this.pending.ops.forEach((o, i) => { if (o.op === kind) lines.push(this.pending.start + i); });
    const runs = [];
    for (const l of lines) {
      const last = runs[runs.length - 1];
      if (last && last[1] === l - 1) last[1] = l; else runs.push([l, l]);
    }
    const lastLine = doc.lineCount - 1;
    return runs.map(([a, b]) =>
      b < lastLine ? new vscode.Range(a, 0, b + 1, 0)                                          // take the line break after
      : a > 0 ? new vscode.Range(a - 1, doc.lineAt(a - 1).text.length, b, doc.lineAt(b).text.length) // end of file: take the one before
      : new vscode.Range(0, 0, b, doc.lineAt(b).text.length));                                  // the whole file
  }

  paint() {
    for (const ed of vscode.window.visibleTextEditors) {
      const mine = this.pending && ed.document.uri.toString() === this.pending.uri;
      ed.setDecorations(this.addedDeco, mine ? this.ranges("add") : []);
      ed.setDecorations(this.removedDeco, mine ? this.ranges("del") : []);
    }
  }

  // Keep our line numbers right while you type during a review.
  onChange(e) {
    if (this.selfEdit || !this.pending || e.document.uri.toString() !== this.pending.uri) return;
    for (const c of e.contentChanges) {
      const added = (c.text.match(/\n/g) || []).length;
      const removed = c.range.end.line - c.range.start.line;
      const delta = added - removed;
      const end = this.pending.start + this.pending.ops.length - 1;
      if (c.range.end.line < this.pending.start) { this.pending.start += delta; continue; }
      if (c.range.start.line > end) continue;
      // Inside the block: lines you add count as kept; lines you delete leave the block.
      const k = Math.max(0, c.range.start.line - this.pending.start);
      if (delta > 0) this.pending.ops.splice(k + 1, 0, ...Array.from({ length: delta }, () => ({ op: "same", text: "" })));
      if (delta < 0) this.pending.ops.splice(k + 1, -delta);
    }
    if (!this.pending.ops.some((o) => o.op !== "same")) this.clear();
    else { this.paint(); this.lensEmitter.fire(); }
  }

  async finish(accept) {
    if (!this.pending) return;
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === this.pending.uri);
    if (!doc) { this.clear(); return; }
    const edit = new vscode.WorkspaceEdit();
    for (const r of this.deletions(doc, accept ? "del" : "add")) edit.delete(doc.uri, r);
    this.selfEdit = true;
    await vscode.workspace.applyEdit(edit);
    this.selfEdit = false;
    log(`review: ${accept ? "accepted" : "rejected"}`);
    this.clear();
  }

  clear() {
    this.pending = null;
    vscode.commands.executeCommand("setContext", "kural.reviewPending", false);
    this.paint();
    this.lensEmitter.fire();
  }
}

module.exports = { ReviewManager };
