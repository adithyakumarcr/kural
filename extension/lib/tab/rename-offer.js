// Tab Completion's "also change it elsewhere": when you change a name in your code (lib/tab/rename.js notices it), Kural
// looks for the old name in the project (whole word, case-sensitive: ripgrep, like Search & Ask) and offers:
//   "count" became "total" here. Also change it in 3 other files (7 places)?   [Review] [Change all] [Not now]
// Review = Search & Ask, filled in (find the old name with Match Case + Whole Word, replace with the new one), so you see
// every place and use Replace / Replace All. Change all = one edit for every place (Ctrl+Z undoes it), files that had no
// unsaved changes are saved, like Replace All. Setting kural.tabCompletion.renameAcrossFiles (on), with Tab Completion on.
// Only edits you type in the editor you're in count (not Kural's or VS Code's own edits, not undo/redo, not several
// cursors at once: that's already a rename of several places).

const vscode = require("vscode");
const T = require("../search/text");
const { RenameWatch } = require("./rename");
const ws = require("../workspace");
const { log } = require("../log");

const SKIP_LANGS = new Set(["plaintext", "markdown", "log", "scminput", "git-commit", "git-rebase", "search-result"]);
const MAX_TEXT = 2000000;   // (bigger files aren't followed: their whole text would be copied at every key)
// Not counted: other people's code and built files, and prose (a README's "the count of items" isn't the variable).
const EXCLUDE = "node_modules, dist, build, .git, *.min.js, *.map, *.lock, package-lock.json, *.md, *.mdx, *.txt, *.rst, *.log";

class RenameOffers {
  // search: the Search & Ask view (lib/search: show("text", { query })).
  constructor(context, search) {
    this.context = context; this.search = search;
    this.watch = new RenameWatch();
    this.texts = new Map();    // uri -> the document's text after its last change (only the editor you're in)
    this.applying = false;     // Kural's own "Change all" running
    this.asked = new Set();    // "from->to" already offered in this window
    this.timer = null;
  }

  on() {
    const c = vscode.workspace.getConfiguration("kural");
    return !!c.get("tabCompletion.enabled") && c.get("tabCompletion.renameAcrossFiles") !== false;
  }

  register() {
    const track = (ed) => {
      if (!ed) return;
      const d = ed.document;
      if (d.uri.scheme === "file" && !SKIP_LANGS.has(d.languageId) && d.getText().length < MAX_TEXT) this.texts.set(d.uri.toString(), d.getText());
    };
    track(vscode.window.activeTextEditor);
    this.context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((ed) => {
        // Moved to another file: the word you were changing is done.
        for (const [uri, text] of this.texts) { this.done(this.watch.cursor(uri, text, -1)); this.watch.drop(uri); }
        this.texts.clear();
        track(ed);
      }),
      vscode.workspace.onDidCloseTextDocument((d) => { this.texts.delete(d.uri.toString()); this.watch.drop(d.uri.toString()); }),
      vscode.workspace.onDidChangeTextDocument((e) => this.changed(e)),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        const key = e.textEditor.document.uri.toString();
        if (!this.texts.has(key) || e.selections.length !== 1) return;
        this.done(this.watch.cursor(key, this.texts.get(key), e.textEditor.document.offsetAt(e.selections[0].active)));
      }),
      { dispose: () => clearTimeout(this.timer) },
    );
  }

  changed(e) {
    const doc = e.document, key = doc.uri.toString();
    const before = this.texts.get(key);
    if (before === undefined) return;   // (not the editor you're in)
    const after = doc.getText();
    this.texts.set(key, after);
    const ed = vscode.window.activeTextEditor;
    // Yours: one change, in the editor you're in, where your cursor is (not undo/redo, not Kural's own Change all).
    if (!this.on() || this.applying || e.reason !== undefined || e.contentChanges.length !== 1 || !ed || ed.document !== doc) return;
    const ch = e.contentChanges[0];
    const line = ed.selection.active.line;
    if (ed.selections.length !== 1 || line < ch.range.start.line || line > ch.range.start.line + ch.text.split("\n").length - 1) return;
    this.done(this.watch.edit(key, before, after, { offset: ch.rangeOffset, length: ch.rangeLength, text: ch.text }));
    // (A pause ends the word too.)
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { const t = this.texts.get(key); if (t !== undefined) this.done(this.watch.tick(key, t)); }, this.watch.settleMs + 50);
  }

  done(r) { if (r) this.offer(r).catch((err) => log(`rename: ${err.message}`)); }

  // Where the old name is still used: { files: Map(path -> count), total, here (count in the file you changed) }.
  async uses(name, doc) {
    const q = { pattern: name, isRegex: false, matchCase: true, wholeWord: true, include: "", exclude: EXCLUDE, useIgnore: true };
    const files = new Map();
    // Open files with unsaved changes (and the one you're in): what's in the editor, not on disk.
    const memory = new Map(vscode.workspace.textDocuments.filter((d) => d.uri.scheme === "file" && (d.isDirty || d === doc)).map((d) => [d.uri.fsPath, d]));
    const rg = T.rgPath(vscode.env.appRoot);
    await Promise.all(ws.folders().map((f) => {
      const s = vscode.workspace.getConfiguration("search", vscode.Uri.file(f.path)), fl = vscode.workspace.getConfiguration("files", vscode.Uri.file(f.path));
      const args = T.rgArgs({ ...q, excludeGlobs: T.settingGlobs(fl.get("exclude"), s.get("exclude")), followSymlinks: s.get("followSymlinks") });
      args.splice(args.indexOf("--regexp"), 0, "--max-filesize", "1M");   // (huge files: generated, not yours to rename in)
      return T.runRg(rg, f.path, args, (abs, m) => { if (!memory.has(abs)) files.set(abs, m.length); }, { max: 5000 }).job;
    }));
    for (const [abs, d] of memory) {
      if (d !== doc && ws.label(abs) === abs) continue;   // (outside the project)
      const n = T.searchText(d.getText(), q).length;
      if (n) files.set(abs, n);
    }
    return { files, total: [...files.values()].reduce((a, b) => a + b, 0), here: files.get(doc.uri.fsPath) || 0 };
  }

  async offer({ uri, from, to }) {
    const pair = `${from}->${to}`;
    if (this.asked.has(pair)) return;
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
    if (!doc) return;
    const u = await this.uses(from, doc);
    if (!u.total) return;
    this.asked.add(pair);
    const others = u.files.size - (u.here ? 1 : 0), elsewhere = u.total - u.here;
    const places = (n) => `${n} ${n === 1 ? "place" : "places"}`;
    const where = !others ? `this file (${places(u.here)})`
      : `${u.here ? `this file (${places(u.here)}) and ` : ""}${others} other ${others === 1 ? "file" : "files"}${elsewhere > others ? ` (${places(elsewhere)})` : ""}`;
    log(`rename: "${from}" became "${to}"; still used in ${u.total} places in ${u.files.size} files`);
    const pick = await vscode.window.showInformationMessage(`"${from}" became "${to}" here. Also change it in ${where}?`, "Review", "Change all", "Not now");
    if (pick === "Review") await this.search.show("text", { query: { pattern: from, isRegex: false, matchCase: true, wholeWord: true, replace: to, exclude: EXCLUDE } });
    if (pick === "Change all") await this.changeAll(from, to, [...u.files.keys()]);
  }

  // Every place, in one edit (Ctrl+Z undoes it); each place checked again first (a file may have changed meanwhile).
  async changeAll(from, to, paths) {
    const q = { pattern: from, isRegex: false, matchCase: true, wholeWord: true };
    const edit = new vscode.WorkspaceEdit(), wasClean = [];
    let n = 0, files = 0;
    for (const p of paths) {
      let doc;
      try { doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p)); } catch (err) { log(`rename: ${p}: ${err.message}`); continue; }
      const text = doc.getText();
      const r = T.replaceEdits(text, T.searchText(text, q).map((m) => ({ offset: doc.offsetAt(new vscode.Position(m.line - 1, m.col)), match: m.match })), q, to);
      if (!r.edits.length) continue;
      if (!doc.isDirty) wasClean.push(doc);
      files++;
      for (const e of r.edits) { edit.replace(doc.uri, new vscode.Range(doc.positionAt(e.offset), doc.positionAt(e.offset + e.length)), e.text); n++; }
    }
    if (!n) return;
    this.applying = true;
    let ok = false;
    try { ok = await vscode.workspace.applyEdit(edit); } finally { this.applying = false; }
    if (!ok) { vscode.window.showErrorMessage(`Kural couldn't change "${from}" (a file can't be changed).`); return; }
    await Promise.all(wasClean.map((d) => d.save().catch(() => {})));
    log(`rename: "${from}" → "${to}" in ${n} places, ${files} files`);
    vscode.window.setStatusBarMessage(`Kural: "${from}" → "${to}" in ${n} ${n === 1 ? "place" : "places"} (Ctrl+Z undoes it)`, 6000);
  }
}

module.exports = { RenameOffers };
