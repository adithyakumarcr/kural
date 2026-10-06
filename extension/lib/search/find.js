// The Search tab's editor side: runs a text search over the project (lib/search/text.js), keeps the results up to date
// as files change, replaces (one match, a file, everything) and shows the Replace Preview. The page
// (media/search.js) sends the search and shows the results; lib/search/index.js passes messages between them.

const vscode = require("vscode");
const path = require("path");
const T = require("./text");
const { log } = require("../log");
const ws = require("../workspace");

const PREVIEW = "kural-replace";

class TextSearch {
  // post(message): to the page.
  constructor(context, post) {
    this.context = context;
    this.post = post;
    this.id = 0;              // the search shown now (the page's number for it)
    this.q = null;            // its query
    this.files = new Map();   // abs path -> matches (what's shown)
    this.jobs = [];
    this.previews = new Map();   // abs path -> { matches } for open Replace Previews
    this.previewChanged = new vscode.EventEmitter();
    this.redo = new Map();    // abs path -> timer (a changed file searched again)
  }

  register() {
    const subs = this.context.subscriptions;
    subs.push(this.previewChanged,
      vscode.workspace.registerTextDocumentContentProvider(PREVIEW, {
        onDidChange: this.previewChanged.event,
        provideTextDocumentContent: (uri) => this.previewText(uri),
      }),
      // Results follow your typing (unsaved text, like VS Code) and changes on disk.
      vscode.workspace.onDidChangeTextDocument((e) => { if (e.document.uri.scheme === "file" && e.contentChanges.length) this.later(e.document.uri.fsPath, e.document); }),
      vscode.workspace.onDidCloseTextDocument((d) => { if (d.uri.scheme === "file" && d.isDirty) this.later(d.uri.fsPath); }),
    );
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");
    subs.push(watcher, watcher.onDidChange((u) => this.later(u.fsPath)), watcher.onDidDelete((u) => this.later(u.fsPath)));
  }

  rg() { return this._rg || (this._rg = T.rgPath(vscode.env.appRoot)); }

  // The page's query + VS Code's search settings (per folder: they can differ).
  query(q, folderUri) {
    const s = vscode.workspace.getConfiguration("search", folderUri), f = vscode.workspace.getConfiguration("files", folderUri);
    return { ...q, smartCase: s.get("smartCase"), followSymlinks: s.get("followSymlinks"), globalIgnore: s.get("useGlobalIgnoreFiles"),
      parentIgnore: s.get("useParentIgnoreFiles"), excludeGlobs: T.settingGlobs(f.get("exclude"), s.get("exclude")) };
  }

  stop() { for (const j of this.jobs) j.stop(); this.jobs = []; }

  // Open editors with unsaved changes: searched in memory, not on disk.
  dirtyDocs() {
    return vscode.workspace.textDocuments.filter((d) => d.uri.scheme === "file" && d.isDirty && ws.label(d.uri.fsPath) !== d.uri.fsPath);
  }

  // Files in the editor's tabs (Search only in Open Editors).
  openFiles() {
    const out = new Set();
    for (const g of vscode.window.tabGroups.all) for (const t of g.tabs) {
      const u = t.input && (t.input.uri || t.input.modified);
      if (u && u.scheme === "file") out.add(u.fsPath);
    }
    return [...out];
  }

  // Run a search: results go to the page as they come ("textFiles"), then "textDone".
  async find(q, id) {
    this.stop();
    this.id = id; this.q = q; this.files.clear();
    if (!q.pattern) { this.post({ type: "textDone", id, total: 0, empty: true }); return; }
    const folders = ws.folders();
    if (!folders.length) { this.post({ type: "textDone", id, total: 0, error: "Open a folder to search in it." }); return; }
    const t0 = Date.now();
    const max = vscode.workspace.getConfiguration("search").get("maxResults") || Infinity;
    // Unsaved files are searched in memory, with JavaScript's regex (ripgrep's understands a few patterns JavaScript's
    // doesn't: then they're searched on disk like the rest).
    let memory = true;
    try { T.jsRegex(q); } catch { memory = false; }
    const dirty = new Map(memory ? this.dirtyDocs().map((d) => [d.uri.fsPath, d]) : []);
    const only = q.onlyOpen ? this.openFiles() : null;
    let total = 0, limited = false, error = null, batch = [], timer = null;
    const send = () => { clearTimeout(timer); timer = null; if (batch.length && this.id === id) this.post({ type: "textFiles", id, files: batch }); batch = []; };
    const add = (abs, matches) => {
      if (this.id !== id || !matches.length) return;
      if (total >= max) { limited = true; return; }
      if (total + matches.length > max) { matches = matches.slice(0, max - total); limited = true; }
      total += matches.length;
      this.files.set(abs, matches);
      batch.push(this.fileFor(abs, matches));
      if (!timer) timer = setTimeout(send, 80);
    };
    const runs = folders.map((f) => {
      const fq = this.query(q, vscode.Uri.file(f.path));
      let paths = null;
      if (only) {
        paths = only.filter((p) => ws.label(p) !== p && path.relative(f.path, p) && !path.relative(f.path, p).startsWith("..")).map((p) => path.relative(f.path, p));
        if (!paths.length) return Promise.resolve({});
      }
      const job = T.runRg(this.rg(), f.path, T.rgArgs(fq, paths), (abs, m) => { if (!dirty.has(abs)) add(abs, m); }, { max });
      this.jobs.push(job);
      return job.job;
    });
    const done = await Promise.all(runs);
    if (this.id !== id) return;
    for (const r of done) { if (r.limited) limited = true; if (r.error && !error) error = r.error; }
    // Unsaved files: what's in the editor (also when ripgrep didn't find the word on disk).
    for (const [abs, d] of dirty) {
      if (only && !only.includes(abs)) continue;
      try { add(abs, T.searchText(d.getText(), this.query(q, d.uri), max)); } catch (e) { log(`search: ${e.message}`); }
    }
    send();
    this.jobs = [];
    log(`search: "${q.pattern}" → ${total} results in ${this.files.size} files, ${Date.now() - t0} ms${error ? ` (${error})` : ""}`);
    this.post({ type: "textDone", id, total, files: this.files.size, limited, error: total ? null : error, ms: Date.now() - t0 });
  }

  fileFor(abs, matches) { return { path: abs, label: ws.label(abs), matches }; }

  // A file changed (typed in, saved, changed on disk): search it again, if it's in the results or open with changes.
  later(abs, doc) {
    if (!this.q || !this.q.pattern || !ws.folders().length) return;
    if (!this.files.has(abs) && !doc) return;   // (new files on disk: the next search finds them)
    if (ws.label(abs) === abs) return;          // (outside the project)
    clearTimeout(this.redo.get(abs));
    this.redo.set(abs, setTimeout(() => { this.redo.delete(abs); this.again(abs).catch((e) => log(`search: ${e.message}`)); }, 300));
  }

  async again(abs) {
    const id = this.id, q = this.q;
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.scheme === "file" && d.uri.fsPath === abs);
    let matches = [];
    if (doc) {
      if (q.onlyOpen && !this.openFiles().includes(abs)) return;
      try { matches = T.searchText(doc.getText(), this.query(q, doc.uri)); } catch { return; }
    } else {
      const folder = ws.folders().find((f) => !path.relative(f.path, abs).startsWith(".."));
      if (!folder) return;
      const job = T.runRg(this.rg(), folder.path, T.rgArgs(this.query(q, vscode.Uri.file(folder.path)), [path.relative(folder.path, abs)]), (_, m) => { matches = m; });
      await job.job;
    }
    if (this.id !== id) return;
    if (matches.length) this.files.set(abs, matches); else this.files.delete(abs);
    this.post({ type: "textFile", id, file: this.fileFor(abs, matches) });
    if (this.previews.has(abs)) this.previewChanged.fire(previewUri(abs));
  }

  // ---------- replacing ----------
  // items: [{ path, matches: [{ line, col, match }] }] (what's still shown: dismissed ones are left out).
  async replace(items, replaceText, { confirm = false } = {}) {
    const q = this.q;
    if (!q || !items.length) return;
    const count = items.reduce((n, f) => n + f.matches.length, 0);
    if (confirm) {
      const what = `${count} ${count === 1 ? "occurrence" : "occurrences"} across ${items.length} ${items.length === 1 ? "file" : "files"}`;
      const ok = await vscode.window.showWarningMessage(replaceText ? `Replace ${what} with "${replaceText}"?` : `Replace ${what} with nothing?`, { modal: true }, "Replace");
      if (ok !== "Replace") return;
    }
    const edit = new vscode.WorkspaceEdit();
    const wasClean = [];
    let done = 0, skipped = 0;
    for (const f of items) {
      const uri = vscode.Uri.file(f.path);
      let doc;
      try { doc = await vscode.workspace.openTextDocument(uri); } catch (e) { skipped += f.matches.length; log(`search: replace in ${f.path}: ${e.message}`); continue; }
      if (!doc.isDirty) wasClean.push(doc);
      const r = T.replaceEdits(doc.getText(), f.matches.map((m) => ({ offset: doc.offsetAt(new vscode.Position(m.line - 1, m.col)), match: m.match })), this.query(q, uri), replaceText);
      skipped += r.skipped;
      for (const e of r.edits) { edit.replace(uri, new vscode.Range(doc.positionAt(e.offset), doc.positionAt(e.offset + e.length)), e.text); done++; }
    }
    if (!done) { vscode.window.showWarningMessage("Nothing replaced: the files changed since the search. Search again."); return; }
    if (!(await vscode.workspace.applyEdit(edit))) { vscode.window.showErrorMessage("Kural couldn't replace (a file can't be changed)."); return; }
    // Files that had no unsaved changes are saved, like VS Code's Replace All; ones you were editing stay unsaved.
    await Promise.all(wasClean.map((d) => d.save().catch(() => {})));
    log(`search: replaced ${done}${skipped ? `, ${skipped} skipped (changed since the search)` : ""}`);
    if (skipped) vscode.window.showWarningMessage(`Replaced ${done}. ${skipped} skipped: those places changed since the search.`);
    vscode.window.setStatusBarMessage(`Replaced ${done} ${done === 1 ? "occurrence" : "occurrences"}`, 4000);
    this.post({ type: "replaced", id: this.id });
  }

  // ---------- Replace Preview: the file with your replacements, beside the file itself ----------
  async preview(file, match, replaceText) {
    this.previews.set(file.path, { matches: file.matches, replaceText });
    const uri = vscode.Uri.file(file.path), pv = previewUri(file.path);
    this.previewChanged.fire(pv);
    const base = path.basename(file.path);
    const line = Math.max(0, match.line - 1);
    await vscode.commands.executeCommand("vscode.diff", uri, pv, `${base} ↔ ${base} (Replace Preview)`, { preview: true, preserveFocus: true, selection: new vscode.Range(line, match.col, line, match.col) });
  }

  // The page's replace text changed: open previews show the new one.
  replaceChanged(replaceText) {
    for (const [abs, p] of this.previews) { p.replaceText = replaceText; this.previewChanged.fire(previewUri(abs)); }
  }

  async previewText(uri) {
    const abs = uri.query ? decodeURIComponent(uri.query) : uri.fsPath;
    const p = this.previews.get(abs);
    let doc;
    try { doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs)); } catch { return ""; }
    const text = doc.getText();
    if (!p || !this.q) return text;
    const matches = (this.files.get(abs) || p.matches).map((m) => ({ offset: doc.offsetAt(new vscode.Position(m.line - 1, m.col)), match: m.match }));
    return T.replaceIn(text, matches, this.query(this.q, doc.uri), p.replaceText).text;
  }

  clear() { this.stop(); this.id = -1; this.q = null; this.files.clear(); this.previews.clear(); }
}

// (The file's own name in the address, so the editor tab shows it and picks its language.)
const previewUri = (abs) => vscode.Uri.file(abs).with({ scheme: PREVIEW, query: encodeURIComponent(abs) });

module.exports = { TextSearch };
