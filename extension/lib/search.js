// "Ask" in the left sidebar: a question in plain words ("where is the operator box pause variable?")
// → the chat's model searches the project and lists the exact places (file + line). Click one to open it there.
// (Plain text search is VS Code's own search, Ctrl+Shift+F.)

const vscode = require("vscode");
const { fontScale, watchFontScale } = require("./ui");
const fs = require("fs");
const path = require("path");
const { log, LOGIN_RE } = require("./ai/claude");
const brain = require("./ai");

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
const ws = require("./workspace");
const cleanRel = (p) => p.replace(/^\.[\\/]/, "").replace(/\\/g, "/");

class SearchView {
  constructor(context) {
    this.context = context;
    this.view = null;
    this.spare = null;      // a Claude process started ahead of time, so asking starts instantly
    this.current = null;    // { proc, id }
  }

  register() {
    watchFontScale(this.context, (m) => this.view && this.view.webview.postMessage(m));
    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider("kural.search", this, { webviewOptions: { retainContextWhenHidden: true } }),
      vscode.commands.registerCommand("kural.askSearch", async () => {
        await vscode.commands.executeCommand("kural.search.focus");
        const ed = vscode.window.activeTextEditor;
        const text = ed && !ed.selection.isEmpty ? ed.document.getText(ed.selection) : "";
        if (this.view) this.view.webview.postMessage({ type: "focus", text: text.length < 200 ? text : "" });
      }),
      { dispose: () => { if (this.spare) this.spare.proc.kill(); if (this.current) this.current.proc.kill(); } },
      // Folders added or removed: the ready-made Claude has the old list, so start a new one.
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        if (this.spare) { const s = this.spare; this.spare = null; s.proc.kill(); }
        if (this.view) this.prepare();
      }),
    );
  }

  root() { return ws.root(); }

  resolveWebviewView(view) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const uri = (f) => view.webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    view.webview.html = `<!doctype html><html data-fs="${fontScale()}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; font-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${uri("codicons/codicon.css")}"><link rel="stylesheet" href="${uri("search.css")}"></head>
<body><div id="app"></div><script nonce="${nonce}" src="${uri("search.js")}"></script></body></html>`;
    view.webview.onDidReceiveMessage((m) => this.onMessage(m).catch((e) => log(`search: ${e.stack}`)));
    view.onDidDispose(() => { this.view = null; });
  }

  post(m) { if (this.view) this.view.webview.postMessage(m); }

  async onMessage(m) {
    switch (m.type) {
      case "ready": this.post({ type: "config", model: brain.currentModel() }); this.prepare(); break;
      case "ask": this.ask(m.q, m.id); break;
      case "cancel": this.cancel(); break;
      case "open": {
        const uri = ws.resolve(m.file);
        if (!uri) return;
        const l = Math.max(0, (m.line || 1) - 1);
        const doc = await vscode.workspace.openTextDocument(uri);
        const text = l < doc.lineCount ? doc.lineAt(l).text : "";
        // A text search selects the match; an Ask result selects the whole line so you spot it.
        const sel = m.len ? new vscode.Range(l, m.col || 0, l, (m.col || 0) + m.len)
          : new vscode.Range(l, text.length - text.trimStart().length, l, text.trimEnd().length);
        const ed = await vscode.window.showTextDocument(doc, { preview: !!m.preview, selection: sel });
        ed.revealRange(sel, vscode.TextEditorRevealType.InCenter);
        break;
      }
      case "log": log(`search panel: ${m.message}`); break;
    }
  }

  // ---------- Ask ----------
  // Ask uses the model picked in the chat: a Claude model through Claude Code, a model on your computer through
  // Kural's own engine (same tools, read-only, and the answer as JSON).
  makeProc(model, handlers) {
    return brain.makeAgent(model, {
      name: "ask", effort: "low", noThinking: true, safeMode: true,
      appendSystemPrompt: ASK_PROMPT + ws.promptNote(), tools: ["Read", "Grep", "Glob"], allowedTools: ["Read", "Grep", "Glob"],
      cwd: this.root(), jsonSchema: SCHEMA, addDirs: ws.extraDirs(),
    }, { tools: ["Read", "Grep", "Glob"], allowedTools: ["Read", "Grep", "Glob"], effort: "low" }, handlers);
  }

  // Start the next one now, so the next question doesn't wait for it to start (for the chat's current model).
  prepare() {
    const model = brain.currentModel();
    if (this.spare && this.spare.model !== model) { const s = this.spare; this.spare = null; s.proc.kill(); }
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

  ask(q, id) {
    this.cancel();
    const root = this.root();
    if (!root) { this.post({ type: "error", id, message: "Open a folder first." }); return; }
    const can = brain.usable();
    if (!can.ok) { this.post({ type: "error", id, message: can.why }); vscode.commands.executeCommand("kural.getStarted"); return; }
    this.prepare();
    const slot = this.spare;
    this.spare = null;
    if (!slot) { this.post({ type: "error", id, message: "Couldn't start the model. See View → Output → Kural." }); return; }
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
            this.post({ type: "error", id, message: !brain.isLocal(slot.model) && LOGIN_RE.test(msg.result || "") ? "Claude isn't logged in. Open Kural: Get Started." : (msg.result || "Something went wrong.") });
            return;
          }
          const out = msg.structured_output || safeJson(msg.result) || { answer: msg.result || "", results: [] };
          const results = verify(out.results || []);
          log(`ask: "${q}" → ${results.length} places in ${Date.now() - t0} ms`);
          this.post({ type: "askResult", id, answer: out.answer || "", results, ms: Date.now() - t0, model: brain.isLocal(slot.model) ? brain.localName(slot.model) : slot.model[0].toUpperCase() + slot.model.slice(1) });
        }
      },
      onExit: (info) => {
        if (this.current && this.current.id === id) {
          this.current = null;
          this.post({ type: "error", id, message: info.login ? "Claude isn't logged in. Open Kural: Get Started." : "The model stopped unexpectedly. See View → Output → Kural." });
        }
      },
    };
    slot.proc.send(q);
    setTimeout(() => this.prepare(), 500); // get the next one ready
  }

}


function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

// Check Claude's places against the real files: add the actual line text, drop places that don't exist.
function verify(results) {
  const out = [];
  for (const r of results) {
    if (!r || !r.file) continue;
    const uri = ws.resolve(cleanRel(r.file));
    if (!uri) continue;
    const rel = ws.label(uri.fsPath);
    let lines;
    try { lines = fs.readFileSync(uri.fsPath, "utf8").split("\n"); } catch { continue; }
    const line = Math.min(Math.max(1, r.line || 1), lines.length);
    out.push({ file: rel, line, why: r.why || "", text: (lines[line - 1] || "").replace(/\r$/, "") });
  }
  return out;
}

module.exports = { SearchView };
