// Tab completion: grey "ghost text" suggestions; Tab accepts.
// Suggestions come while you type, and also when you put the cursor somewhere
// (end of a line, an empty line, or before closing brackets), like Cursor.

const vscode = require("vscode");
const { log } = require("../ai/claude");
const { tidyLocal } = require("./local");

const COMPLETION_SYSTEM_PROMPT = `You are the autocomplete engine of a code editor.
You get a file with the cursor marked <CURSOR>. Reply with exactly one <insert>...</insert> block containing ONLY the
text to insert at <CURSOR>, exactly as it should appear (keep leading newlines/spaces). Nothing outside the block.

Rules:
- Complete only what belongs at the cursor. Never finish or fix other unfinished lines elsewhere in the file.
- Never repeat text that already comes right after the cursor.
- Text after the cursor on the same line (often just ")" or "]" the editor added): insert what belongs
  between the cursor and that text.
- If the cursor's line is already complete, insert a newline plus the most likely next line, or nothing.
- On an empty line, suggest the most useful line(s) for that spot — be helpful, like a teammate who knows the file.
- If the line(s) just above the cursor are a comment describing what to do (e.g. "# convert mm/s to m/min",
  "// TODO: validate input"), write the code that does it, right below the comment.
- If nothing sensible fits: <insert></insert>
- You may get notes about the user's recent work (their current task, recent edits, suggestions they accepted).
  Use them to guess what they want here and to match their style; never write the notes into the file.

Examples:
Cursor: line 2, at the end of the line. Text before the cursor on this line: "    total = sum("
def f(xs):
    total = sum(<CURSOR>
<insert>xs)</insert>

Cursor: line 1, at the end of the line. Text before the cursor on this line: "x = compute()"
x = compute()<CURSOR>
y = broken(
<insert></insert>

Cursor: line 2, in the middle of the line. Text before the cursor on this line: "    print(", after it: ")"
name = "Ada"
    print(<CURSOR>)
<insert>f"Hello, {name}"</insert>

Cursor: line 1, in the middle of the line. Text before the cursor on this line: "def area(w: float, ", after it: ")"
def area(w: float, <CURSOR>)
    return w * h
<insert>h: float</insert>

Cursor: line 1, in the middle of the line. Text before the cursor on this line: "def area(w: float, ", after it: "h: float) -> float:"
def area(w: float, <CURSOR>h: float) -> float:
<insert></insert>

Cursor: line 3, on an empty line. Text before the cursor on this line: ""
def speed_m_min(speed_mm_s: float) -> float:
    # convert mm/s to m/min and round to 2 decimals
<CURSOR>
<insert>    return round(speed_mm_s * 60 / 1000, 2)</insert>

Cursor: line 3, on an empty line. Text before the cursor on this line: ""
def area(w, h):
    return w * h
<CURSOR>
<insert>

def perimeter(w, h):
    return 2 * (w + h)</insert>`;

// Pulls the suggestion out of <insert>...</insert>; ignores anything else Claude said.
function extractInsert(reply) {
  const m = reply.match(/<insert>([\s\S]*?)(?:<\/insert>|$)/);
  let s = m ? m[1] : reply;
  if (!m && /^\s*(wait|i |let me|the cursor)/i.test(s)) return "";   // an explanation, not code
  s = s.replace(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/, "$1");         // stray markdown fence
  return s;
}

// Drops the end of a suggestion that's already in the file right after the cursor.
function trimOverlap(insert, after) {
  for (let k = Math.min(insert.length, after.length); k > 0; k--) {
    if (insert.endsWith(after.slice(0, k))) return insert.slice(0, insert.length - k);
  }
  return insert;
}

// The request for one suggestion. The cursor line is spelled out separately, which
// keeps small, fast models from "completing" some other unfinished line in the file.
// note: what the user has been doing (activity.js), or "".
function completionPrompt(text, offset, languageId, file, note = "") {
  const prefix = text.slice(Math.max(0, offset - 3000), offset);
  const suffix = text.slice(offset, offset + 1000);
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineEndAt = text.indexOf("\n", offset);
  const lineEnd = lineEndAt < 0 ? text.length : lineEndAt;
  const before = text.slice(lineStart, offset), after = text.slice(offset, lineEnd);
  const lineNo = text.slice(0, offset).split("\n").length;
  const where = !before.trim() && !after.trim() ? "on an empty line"
    : !after.trim() ? "at the end of the line" : "in the middle of the line";
  return note + `File: ${file} (${languageId})\n` +
    `Cursor: line ${lineNo}, ${where}. Text before the cursor on this line: ${JSON.stringify(before)}` +
    (after.trim() ? `, after it: ${JSON.stringify(after)}` : "") + "\n\n" +
    `${prefix}<CURSOR>${suffix}`;
}

function sleep(ms, token) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(true), ms);
    token.onCancellationRequested(() => { clearTimeout(t); resolve(false); });
  });
}

// Remember recent answers, so going back to the same spot shows the suggestion instantly.
const cache = new Map();
function cacheKey(doc, offset) { return `${doc.uri.toString()}#${doc.version}#${offset}`; }

// The last suggestion shown. If you type the same characters it suggests, the rest of it
// stays up instantly, without asking Claude again.
let shown = null;   // { uri, start, before, insert }
function typeThrough(doc, offset, all) {
  if (!shown || shown.uri !== doc.uri.toString() || offset <= shown.start) return null;
  if (all.slice(Math.max(0, shown.start - 300), shown.start) !== shown.before) return null;
  const typed = all.slice(shown.start, offset);
  if (!shown.insert.startsWith(typed)) return null;
  const rest = shown.insert.slice(typed.length);
  return rest.trim() ? rest : null;
}

// Delay presets for the speed slider (ms to wait after your last key).
const SPEEDS = [
  { ms: 0, label: "Instant" }, { ms: 75, label: "Fast" }, { ms: 150, label: "Normal" },
  { ms: 300, label: "Relaxed" }, { ms: 600, label: "Slow" },
];

// engine "auto": the local model when Ollama has it, else Claude. "local" / "claude": that one
// (local still falls back to Claude if Ollama isn't there, so Tab keeps working).
function completionProvider(session, review, onTiming = () => {}, local = null, activity = null) {
  return {
    async provideInlineCompletionItems(document, position, ctx, token) {
      const cfg = vscode.workspace.getConfiguration("kural");
      if (!cfg.get("tabCompletion.enabled") || review.busy()) return [];
      if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") return [];

      const offset = document.offsetAt(position);
      const key = cacheKey(document, offset);
      const rel = vscode.workspace.asRelativePath(document.uri);
      if (cache.has(key)) return [item(document, position, cache.get(key), rel)];
      const rest = typeThrough(document, offset, document.getText());
      if (rest) return [item(document, position, rest, rel)];

      // While typing, wait for a short pause. When you just placed the cursor, go right away.
      const typing = ctx.triggerKind === vscode.InlineCompletionTriggerKind.Automatic;
      const wait = cfg.get("tabCompletion.debounceMs");
      if (typing && wait > 0 && !(await sleep(wait, token))) return [];

      const all = document.getText();
      if (!all.slice(0, offset).trim()) return [];

      const started = Date.now();
      const after = all.slice(offset, offset + 200);
      const lineEndAt = all.indexOf("\n", offset);
      const restOfLine = all.slice(offset, lineEndAt < 0 ? all.length : lineEndAt);
      const engineSetting = cfg.get("tabCompletion.engine");
      const useLocal = local && engineSetting !== "claude" && await local.ready();
      const viaClaude = async (tok = token) => {
        const note = activity ? activity.tabNote(rel, document.languageId) : "";
        const text = await session.ask(completionPrompt(all, offset, document.languageId, rel, note), tok);
        return text ? trimOverlap(extractInsert(text), after) : "";
      };
      const viaLocal = async () => {
        const raw = await local.complete(all.slice(Math.max(0, offset - 1500), offset), all.slice(offset, offset + 400), token, !!restOfLine.trim());
        return raw == null ? "" : trimOverlap(tidyLocal(raw, restOfLine), after);
      };
      let insert = "", engine = "claude";
      if (!useLocal) insert = await viaClaude();
      else if (engineSetting === "local") { insert = await viaLocal(); engine = "local"; }
      else [insert, engine] = await race(viaLocal, viaClaude, token);
      if (token.isCancellationRequested || !insert || !insert.trim()) return [];
      cache.set(key, insert);
      shown = { uri: document.uri.toString(), start: offset, before: all.slice(Math.max(0, offset - 300), offset), insert };
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      log(`tab: suggestion shown after ${Date.now() - started} ms (${engine})`);
      onTiming(Date.now() - started, engine);
      return [item(document, position, insert, rel)];
    },
  };
}

// Auto: the local model gets a head start; if it hasn't answered (or answered nothing) by then,
// Claude is asked too, and the first real suggestion wins. So Auto is never slower than Claude alone.
const LOCAL_HEAD_START = 350;
function race(viaLocal, viaClaude, token) {
  return new Promise((resolve) => {
    let done = false, claudeStarted = false, pending = 0;
    const finish = (text, engine) => {
      if (done) return;
      if (text && text.trim()) { done = true; clearTimeout(timer); if (engine === "local") cancelClaude(); resolve([text, engine]); }
      else if (--pending === 0 && (claudeStarted || token.isCancellationRequested)) { done = true; resolve(["", engine]); }
      else if (!claudeStarted) startClaude();
    };
    // Claude gets its own cancel switch, so it's stopped when the local model wins.
    const fns = [];
    const claudeTok = { isCancellationRequested: false, onCancellationRequested(f) { fns.push(f); return { dispose() {} }; } };
    const cancelClaude = () => { if (!claudeTok.isCancellationRequested) { claudeTok.isCancellationRequested = true; fns.forEach((f) => f()); } };
    token.onCancellationRequested(cancelClaude);
    const startClaude = () => {
      if (claudeStarted || done || token.isCancellationRequested) return;
      claudeStarted = true; pending++;
      viaClaude(claudeTok).then((t) => finish(t, "claude"), () => finish("", "claude"));
    };
    pending++;
    viaLocal().then((t) => finish(t, "local"), () => finish("", "local"));
    const timer = setTimeout(startClaude, LOCAL_HEAD_START);
  });
}

// The editor only shows grey text in the middle of a line (e.g. inside print(|)) when the
// suggestion covers the rest of the line. So: replace "cursor → end of line" with
// "suggestion + the rest of the line"; on screen only the suggestion appears in grey.
// Accepting it (Tab) runs kural.tab.accepted, which remembers it (activity.js: your style).
function item(document, position, insert, rel) {
  const lineEnd = document.lineAt(position.line).range.end;
  const rest = document.getText(new vscode.Range(position, lineEnd));
  const it = rest ? new vscode.InlineCompletionItem(insert + rest, new vscode.Range(position, lineEnd))
    : new vscode.InlineCompletionItem(insert, new vscode.Range(position, position));
  const before = document.lineAt(position.line).text.slice(0, position.character);
  it.command = { command: "kural.tab.accepted", title: "", arguments: [{ file: rel, lang: document.languageId, before, text: insert }] };
  return it;
}

// Ask for a suggestion when you click or move to the end of a line, an empty line,
// or just before closing brackets/quotes (like the ")" in print(|)).
function triggerOnCursor(context) {
  let timer = null;
  const lastEdit = new Map(); // uri -> time of last change (typing moves the cursor too; skip those)
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => lastEdit.set(e.document.uri.toString(), Date.now())));
  context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((e) => {
    clearTimeout(timer);
    const cfg = vscode.workspace.getConfiguration("kural");
    if (!cfg.get("tabCompletion.enabled") || !cfg.get("tabCompletion.onCursorMove")) return;
    if (e.kind === vscode.TextEditorSelectionChangeKind.Command || e.kind === undefined) return; // code-driven moves
    if (Date.now() - (lastEdit.get(e.textEditor.document.uri.toString()) || 0) < 150) return;   // that was typing
    const sel = e.selections[0];
    if (!sel || !sel.isEmpty || e.selections.length > 1) return;
    const line = e.textEditor.document.lineAt(sel.active.line);
    const rest = line.text.slice(sel.active.character);
    if (!/^[\s)\]}"'`;:,]*$/.test(rest)) return;
    // A little longer than the typing delay, so moving through the file with the arrow keys doesn't
    // fire a request on every line.
    timer = setTimeout(() => {
      if (vscode.window.activeTextEditor === e.textEditor) vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    }, Math.max(60, (cfg.get("tabCompletion.debounceMs") || 0) + 80));
  }));
}

module.exports = { SPEEDS, COMPLETION_SYSTEM_PROMPT, completionPrompt, extractInsert, trimOverlap, completionProvider, triggerOnCursor };
