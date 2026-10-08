// "Search & Ask" in the left side bar, two tabs (media/search.js is the page):
//   Search: find and replace in the project's files: what VS Code's own Search view did (Kural hides that one, see
//           scripts/rebrand.py). Ctrl+Shift+F / Ctrl+Shift+H. The work is in find.js and text.js.
//   Ask:    a question in plain words ("where are the user's settings saved?") → the fastest model you have (Haiku
//           for Claude, the lightest Codex / Gemini model: brain.fastestModel) searches the project and lists the exact
//           places (file + line). Click one to open it there.

const vscode = require("vscode");
const { fontScale, watchFontScale } = require("../ui");
const fs = require("fs");
const path = require("path");
const { log, LOGIN_RE } = require("../ai/claude");
const brain = require("../ai");
const { TextSearch } = require("./find");
const { retrieve } = require("../router/retrieve");

const SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", description: "One or two sentences answering the question." },
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string", description: "Path relative to the project" },
          line: { type: "integer", description: "1-based line number" },
          why: { type: "string", description: "Short reason this place matters" },
        },
        required: ["file", "line", "why"],
      },
    },
  },
  required: ["answer", "results"],
};

const ASK_PROMPT =
  "You locate code for the user inside the Kural editor. Search the project with Grep/Glob/Read, then return the most " +
  "relevant places: file path relative to the project root and the exact 1-based line, with a short reason each. " +
  "Most relevant first, at most 10. Include definitions and important uses (and config files) when relevant. " +
  "Be quick: don't read whole large files when a search is enough.";

const cfg = () => vscode.workspace.getConfiguration("kural");

// "./src/a.py" or ".\\src\\a.py" (Windows) → "src/a.py"
const ws = require("../workspace");
const HISTORY = "kural.searchHistory.v1";
const cleanRel = (p) => p.replace(/^\.[\\/]/, "").replace(/\\/g, "/");

class SearchView {
  constructor(context, router = null, activeChat = () => null) {
    this.context = context;
    this.router = router; this.activeChat = activeChat;
    this.view = null;
    this.spare = null;      // a Claude process started ahead of time, so asking starts instantly
    this.current = null;    // { proc, id }
    this.text = new TextSearch(context, (m) => this.post(m));
  }

  register() {
    watchFontScale(this.context, (m) => this.view && this.view.webview.postMessage(m));
    this.text.register();
    const cmd = (id, f) => vscode.commands.registerCommand(id, f);
    const toPage = (m) => () => this.post(m);
    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider("kural.search", this, { webviewOptions: { retainContextWhenHidden: true } }),
      cmd("kural.askSearch", () => this.show("ask")),
      // Ctrl+Shift+F / Ctrl+Shift+H (VS Code's own keys for its Search), and Explorer → Find in Folder…
      cmd("kural.search.find", () => this.show("text")),
      cmd("kural.search.replace", () => this.show("text", { replace: true })),
      cmd("kural.search.inFolder", (uri) => this.show("text", { include: uri && uri.fsPath ? `./${ws.label(uri.fsPath)}` : "" })),
      // The view's title bar (like VS Code's Search): refresh, clear, collapse/expand, tree/list, search editor.
      cmd("kural.search.refresh", toPage({ type: "cmd", what: "refresh" })),
      cmd("kural.search.clear", toPage({ type: "cmd", what: "clear" })),
      cmd("kural.search.collapseAll", toPage({ type: "cmd", what: "collapseAll" })),
      cmd("kural.search.expandAll", toPage({ type: "cmd", what: "expandAll" })),
      cmd("kural.search.viewAsTree", toPage({ type: "cmd", what: "tree" })),
      cmd("kural.search.viewAsList", toPage({ type: "cmd", what: "list" })),
      cmd("kural.search.openEditor", toPage({ type: "cmd", what: "openEditor" })),
      // F4 / Shift+F4: the next / previous result, from anywhere.
      cmd("kural.search.next", toPage({ type: "cmd", what: "next" })),
      cmd("kural.search.prev", toPage({ type: "cmd", what: "prev" })),
      // Right-click on a result (package.json "webview/context"): the row's data-vscode-context comes as the argument.
      cmd("kural.search.copy", (c) => c && vscode.env.clipboard.writeText(c.row === "match" ? c.text : c.label)),
      cmd("kural.search.copyPath", (c) => c && vscode.env.clipboard.writeText(c.path)),
      cmd("kural.search.copyAll", toPage({ type: "cmd", what: "copyAll" })),
      cmd("kural.search.reveal", (c) => c && vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(c.path))),
      cmd("kural.search.dismiss", (c) => c && this.post({ type: "cmd", what: "dismiss", row: c })),
      { dispose: () => { clearTimeout(this.spareTimer); if (this.spare) this.spare.proc.kill(); if (this.current) this.current.proc.kill(); this.text.stop(); } },
      // Folders added or removed: the ready-made Claude has the old list, so start a new one.
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        if (this.spare) { const s = this.spare; this.spare = null; s.proc.kill(); this.prepare(); }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration("search")) this.post(this.config()); }),
    );
  }

  // Open the view on a tab; the editor's selection (one line) becomes the search.
  async show(tab, extra = {}) {
    await vscode.commands.executeCommand("kural.search.focus");
    const ed = vscode.window.activeTextEditor;
    const sel = ed && !ed.selection.isEmpty ? ed.document.getText(ed.selection) : "";
    const text = sel.length < 200 && (tab === "ask" || !sel.includes("\n")) ? sel : "";
    const m = { type: "focus", tab, text, ...extra };
    if (this.view && this.ready) this.post(m); else this.pending = m;
  }

  config() {
    const s = vscode.workspace.getConfiguration("search");
    return { type: "config", model: brain.fastestModel(), history: this.context.workspaceState.get(HISTORY) || {},
      onType: s.get("searchOnType") !== false, debounce: s.get("searchOnTypeDebouncePeriod") || 300,
      collapse: s.get("collapseResults") || "auto", viewMode: s.get("defaultViewMode") || "list", lineNumbers: !!s.get("showLineNumbers"),
      folders: ws.folders().length };
  }

  root() { return ws.root(); }

  resolveWebviewView(view) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    this.ready = false;
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const uri = (f) => view.webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    view.webview.html = `<!doctype html><html data-fs="${fontScale()}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; font-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${uri("codicons/codicon.css")}"><link rel="stylesheet" href="${uri("search.css")}"></head>
<body data-vscode-context='{"preventDefaultContextMenuItems": true}'><div id="app"></div><script nonce="${nonce}" src="${uri("search-replace.js")}"></script><script nonce="${nonce}" src="${uri("search.js")}"></script></body></html>`;
    view.webview.onDidReceiveMessage((m) => this.onMessage(m).catch((e) => log(`search: ${e.stack}`)));
    view.onDidDispose(() => { this.view = null; this.ready = false; });
  }

  post(m) { if (this.view) this.view.webview.postMessage(m); }

  async onMessage(m) {
    switch (m.type) {
      case "ready":
        this.ready = true;
        this.post(this.config());
        if (this.pending) { this.post(this.pending); this.pending = null; }
        break;
      // ---- Search ----
      case "find": this.text.find(m.q, m.id).catch((e) => { log(`search: ${e.stack}`); this.post({ type: "textDone", id: m.id, total: 0, error: e.message }); }); break;
      case "stopFind": this.text.stop(); break;
      case "clearFind": this.text.clear(); this.badge(0); break;
      case "replace": await this.text.replace(m.items, m.replace, { confirm: !!m.confirm }); break;
      case "preview": await this.text.preview(m.file, m.match, m.replace); break;
      case "replaceText": this.text.replaceChanged(m.replace); break;
      case "history": await this.context.workspaceState.update(HISTORY, m.history); break;
      case "copy": await vscode.env.clipboard.writeText(m.text); break;
      case "searchEditor":
        vscode.commands.executeCommand("search.action.openNewEditor", { query: m.q.pattern, isRegexp: !!m.q.isRegex, isCaseSensitive: !!m.q.matchCase,
          matchWholeWord: !!m.q.wholeWord, filesToInclude: m.q.include || "", filesToExclude: m.q.exclude || "", onlyOpenEditors: !!m.q.onlyOpen,
          useExcludeSettingsAndIgnoreFiles: m.q.useIgnore !== false, showIncludesExcludes: !!(m.q.include || m.q.exclude), triggerSearch: true, focusResults: true });
        break;
      case "settings": vscode.commands.executeCommand("workbench.action.openSettings", m.query || "search.exclude"); break;
      // What the title bar shows (package.json "view/title" when-clauses) and the number on the side bar icon.
      case "ui":
        vscode.commands.executeCommand("setContext", "kural.searchTab", m.tab);
        // Ask's model starts when you're on the Ask tab, not for text search (~100 MB: docs/benchmarks).
        if (m.tab === "ask") this.prepare();
        vscode.commands.executeCommand("setContext", "kural.searchHasResults", !!m.results);
        vscode.commands.executeCommand("setContext", "kural.searchTree", !!m.tree);
        vscode.commands.executeCommand("setContext", "kural.searchCollapsed", !!m.collapsed);
        this.badge(m.tab === "text" ? m.results : 0);
        break;
      case "ask": this.ask(m.q, m.id); break;
      case "cancel": this.cancel(); break;
      case "open": {
        const uri = m.path ? vscode.Uri.file(m.path) : ws.resolve(m.file);
        if (!uri) return;
        const l = Math.max(0, (m.line || 1) - 1);
        const doc = await vscode.workspace.openTextDocument(uri);
        const text = l < doc.lineCount ? doc.lineAt(l).text : "";
        // A text search selects the match (it can go over lines); an Ask result selects the whole line so you spot it.
        const sel = m.endLine ? new vscode.Range(l, m.col || 0, m.endLine - 1, m.endCol || 0)
          : m.len ? new vscode.Range(l, m.col || 0, l, (m.col || 0) + m.len)
          : new vscode.Range(l, text.length - text.trimStart().length, l, text.trimEnd().length);
        const ed = await vscode.window.showTextDocument(doc, { preview: !!m.preview, preserveFocus: !!m.keepFocus, selection: sel });
        ed.revealRange(sel, vscode.TextEditorRevealType.InCenter);
        break;
      }
      case "log": log(`search panel: ${m.message}`); break;
    }
  }

  badge(n) { if (this.view) this.view.badge = n ? { value: n, tooltip: `${n} search ${n === 1 ? "result" : "results"}` } : undefined; }

  // ---------- Ask ----------
  // Ask uses the fastest model you have (Adithya: finding places should be quick): Haiku through Claude Code, the
  // lightest Codex / Gemini model, or a model on your computer through Kural's own engine (same tools, read-only, and
  // the answer as JSON). The chat's AI comes first when it's a cloud one, so Ask uses the account you're using.
  // It reads only inside your project: anything else is refused (nobody is there to ask, and on a Mac reading your
  // Documents or Desktop would make macOS ask about Kural).
  makeProc(model, handlers) {
    const onPermission = (req) => {
      const where = req.input && (req.input.file_path || req.input.path);
      return !where || ws.mayUse(where) ? { allow: true } : { allow: false, message: "Ask only looks inside the project." };
    };
    return brain.makeAgent(model, {
      name: "ask", effort: "low", noThinking: true, safeMode: true, hostPermissions: true,
      appendSystemPrompt: ASK_PROMPT + ws.promptNote(), tools: ["Read", "Grep", "Glob"],
      cwd: this.root(), jsonSchema: SCHEMA, addDirs: ws.extraDirs(),
    }, { tools: ["Read", "Grep", "Glob"], allowedTools: ["Read", "Grep", "Glob"], effort: "low" }, { ...handlers, onPermission });
  }

  // Start the next one now, so the next question doesn't wait for it to start (with the fastest model). Unused for 10
  // minutes: stopped (the next question starts one again, 1-2 s).
  prepare(model = brain.fastestModel()) {
    if (this.spare && this.spare.model !== model) { const s = this.spare; this.spare = null; s.proc.kill(); }
    clearTimeout(this.spareTimer);
    this.spareTimer = setTimeout(() => { if (this.spare) { const s = this.spare; this.spare = null; s.proc.kill(); log("ask: its model stopped after 10 min without questions"); } },
      Number(process.env.KURAL_IDLE_MS) > 0 ? Number(process.env.KURAL_IDLE_MS) : 10 * 60 * 1000);
    if (this.spareTimer.unref) this.spareTimer.unref();
    if (this.spare || !this.root() || !brain.usable(model).ok) return;
    const slot = { proc: null, handlers: null, model };
    slot.proc = this.makeProc(model, {
      onMessage: (msg) => slot.handlers && slot.handlers.onMessage(msg),
      onExit: (info) => { if (this.spare === slot) this.spare = null; if (slot.handlers) slot.handlers.onExit(info); },
    });
    if (slot.proc.start()) this.spare = slot;
  }

  cancel() {
    if (this.current) { const c = this.current; this.current = null; c.proc.kill(); this.post({ type: "done", id: c.id, cancelled: true }); }
  }

  async ask(q, id) {
    if (!this.router || !vscode.workspace.isTrusted) return this.askBaseline(q,id);
    this.cancel();
    const ctl = new AbortController(), job = { id,proc: { kill: () => ctl.abort() } };
    this.current = job;
    const model = brain.fastestModel();
    try {
      if (this.router.options().search) {
        const t0 = Date.now();
        this.post({ type: "progress",id,text: "Finding candidate code locally…" });
        const candidates = await retrieve(q,ctl.signal);
        if (ctl.signal.aborted) return;
        this.post({ type: "progress",id,text: "Ranking relevant code…" });
        const ranked = await this.router.rank(q,candidates,ctl.signal);
        if (ctl.signal.aborted) return;
        const relevant = ranked.candidates.filter((c) => c.relevance >= (ranked.source !== "native" ? .35 : .6)).slice(0,10);
        if (relevant.length) {
          const results = verify(relevant.map((c) => ({ ...c,why: "Matched locally to your question; inspect this location to confirm" })));
          if (results.length) { this.current = null; this.post({ type: "askResult",id,answer: "Candidate code locations, ranked locally.",results,ms: Date.now()-t0,model: `Kural Router (${ranked.source})` }); return; }
        }
      }
      // (No Auto routing here: Ask always takes the fastest model, also when the chat is on Auto.)
    } catch { /* Router or retrieval errors: use the existing model search. */ }
    if (ctl.signal.aborted || this.current !== job) return;
    this.current = null;
    return this.askBaseline(q,id,model);
  }

  askBaseline(q, id, model = brain.fastestModel()) {
    this.cancel();
    const root = this.root();
    if (!root) { this.post({ type: "error", id, message: "Open a folder first." }); return; }
    const can = brain.usable(model);
    if (!can.ok) { this.post({ type: "error", id, message: can.why }); vscode.commands.executeCommand("kural.getStarted"); return; }
    this.prepare(model);
    const slot = this.spare;
    this.spare = null;
    if (!slot) { this.post({ type: "error", id, message: "Couldn't start the model. See Kural's log (Kural: Show Log)." }); return; }
    const t0 = Date.now();
    this.current = { proc: slot.proc, id };
    slot.handlers = {
      onMessage: (msg) => {
        if (!this.current || this.current.id !== id) return;
        if (msg.type === "assistant") {
          for (const b of msg.message.content || []) {
            if (b.type !== "tool_use") continue;
            const i = b.input || {};
            const what = b.name === "Grep" ? `Searching for "${i.pattern}"` : b.name === "Glob" ? `Looking for ${i.pattern}` : b.name === "Read" ? `Reading ${path.relative(root, i.file_path || "")}` : b.name;
            this.post({ type: "progress", id, text: what });
          }
        } else if (msg.type === "result") {
          this.current = null;
          slot.proc.kill();
          if (msg.is_error) {
            this.post({ type: "error", id, message: !brain.isLocal(slot.model) && LOGIN_RE.test(msg.result || "") ? `${brain.providerOf(slot.model).label} isn't logged in. Open Kural: Get Started.` : (msg.result || "Something went wrong.") });
            return;
          }
          const out = msg.structured_output || safeJson(msg.result) || { answer: msg.result || "", results: [] };
          const results = verify(out.results || []);
          log(`ask: "${q}" → ${results.length} places in ${Date.now() - t0} ms`);
          this.post({ type: "askResult", id, answer: out.answer || "", results, ms: Date.now() - t0, model: brain.engineOf(slot.model) === "claude" ? slot.model[0].toUpperCase() + slot.model.slice(1) : slot.model.replace(/^[a-z]+:/, "") });
        }
      },
      onExit: (info) => {
        if (this.current && this.current.id === id) {
          this.current = null;
          this.post({ type: "error", id, message: info.login ? `${brain.providerOf(slot.model).label} isn't logged in. Open Kural: Get Started.` : "The model stopped unexpectedly. See Kural's log (Kural: Show Log)." });
        }
      },
    };
    slot.proc.send(q);
    setTimeout(() => this.prepare(), 500); // get the next one ready
  }

}


// The answer as JSON. Models without a JSON-answer option (Codex, Gemini) may wrap it in a code fence or a sentence:
// take the outermost {…}.
function safeJson(s) {
  try { return JSON.parse(s); } catch { /* not plain JSON */ }
  const m = /\{[\s\S]*\}/.exec(String(s || ""));
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

// Check Claude's places against the real files: add the actual line text, drop places that don't exist.
function verify(results) {
  const out = [];
  for (const r of results) {
    if (!r || !r.file) continue;
    const uri = ws.resolve(cleanRel(r.file));
    if (!uri) continue;
    const rel = ws.label(uri.fsPath);
    let lines;
    try {
      const doc = (vscode.workspace.textDocuments || []).find((d) => d.uri.scheme === "file" && d.uri.fsPath === uri.fsPath);
      lines = (doc ? doc.getText() : fs.readFileSync(uri.fsPath, "utf8")).split("\n");
    } catch { continue; }
    const line = Math.min(Math.max(1, r.line || 1), lines.length);
    out.push({ file: rel, line, why: r.why || "", text: (lines[line - 1] || "").replace(/\r$/, "") });
  }
  return out;
}

module.exports = { SearchView };
