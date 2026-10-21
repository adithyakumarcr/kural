// Listen: the walkthrough's script (no vscode inside). The page sends the answer's rendered blocks, numbered; a quick model
// (Side chat's way of running one: no tools, effort low, not part of the conversation) answers with
//   <piece for="n">what to say about block n</piece> …
// streamed, so the first piece can be spoken while the rest is still being written.
const fs = require("fs");
const path = require("path");

const LIMITS = { input: 12000, codeLines: 40, tableRows: 20, request: 1500, firstPieceMs: 15000, totalMs: 90000 };
const NO_MODEL = "Listen needs Claude, Gemini or a model on this computer to write the walkthrough.";
const FAILED = "Couldn't write the walkthrough. Try again.";
const PROMPT_FILE = path.join(__dirname, "script-prompt.md");

const cutLines = (text, n) => { const lines = String(text || "").split("\n"); return lines.length > n ? [...lines.slice(0, n), "…"].join("\n") : lines.join("\n"); };

// The blocks as the model reads them: "[n] (kind)\ntext", code and tables cut (they're explained, not read), the whole at
// most LIMITS.input characters.
function blocksText(blocks) {
  const out = [];
  let size = 0;
  for (const b of blocks || []) {
    const body = b.kind === "code" ? cutLines(b.text, LIMITS.codeLines) : b.kind === "table" ? cutLines(b.text, LIMITS.tableRows) : String(b.text || "");
    let part = `[${b.n}] (${b.kind})\n${body}`;
    const room = LIMITS.input - size - (out.length ? 2 : 0);
    if (room <= 40) break;
    if (part.length > room) part = `${part.slice(0, room - 2)} …`;
    out.push(part);
    size += part.length + (out.length > 1 ? 2 : 0);
  }
  return out.join("\n\n");
}

function buildPrompt({ blocks, request, tags }) {
  const tagLine = tags && tags.length
    ? `- Expression tags make the voice laugh, breathe or sigh: ${tags.map((t) => `<${t}>`).join(", ")}. Use one or two in the walkthrough where a person would (a short laugh after something fun, a breath before a big point); at most one per piece.`
    : "";
  const system = fs.readFileSync(PROMPT_FILE, "utf8").replace(/^\{\{TAGS\}\}\n?/m, tagLine ? `${tagLine}\n` : "").trim();
  const req = String(request || "").trim();
  const prompt = [
    req ? `What the person asked:\n${req.length > LIMITS.request ? `${req.slice(0, LIMITS.request)}…` : req}` : "",
    `The answer, in numbered blocks:\n\n${blocksText(blocks)}`,
  ].filter(Boolean).join("\n\n");
  return { system, prompt };
}

const PIECE = /<piece\s+for\s*=\s*"?(\d+)"?\s*>([\s\S]*?)<\/piece>/gi;

class PieceParser {
  constructor(blockCount) { this.max = Math.max(0, (blockCount || 1) - 1); this.buf = ""; this.any = false; }
  block(n) { return Math.min(this.max, Math.max(0, Number(n) || 0)); }

  push(chunk) {
    this.buf += String(chunk || "");
    const out = [];
    let end = 0, m;
    PIECE.lastIndex = 0;
    while ((m = PIECE.exec(this.buf))) {
      end = PIECE.lastIndex;
      const text = m[2].trim();
      if (text) { out.push({ block: this.block(m[1]), text }); this.any = true; }
    }
    if (end) this.buf = this.buf.slice(end);
    return out;
  }

  // The reply ended: a piece cut off counts; a reply that never used pieces is one piece about the first block.
  end() {
    const rest = this.buf; this.buf = "";
    const open = /<piece\s+for\s*=\s*"?(\d+)"?\s*>([\s\S]*)$/i.exec(rest);
    if (open && open[2].trim()) { this.any = true; return [{ block: this.block(open[1]), text: open[2].trim() }]; }
    const text = rest.replace(/<\/?piece[^>]*>/gi, " ").replace(/\s+/g, " ").trim();
    if (!this.any && text) { this.any = true; return [{ block: 0, text }]; }
    return [];
  }
}

// Which model writes it: a chat kept on this computer stays there; otherwise the quickest of the chat's own AI.
// (Codex is skipped, as in Side chat: it can't be made answer-only.)
function pickModel(chatModel, { isLocal, fastest }) {
  if (chatModel && isLocal(chatModel)) return { model: chatModel };
  const model = fastest(chatModel, ["codex"]);
  if (!model || /^codex:/.test(model)) return { why: NO_MODEL };
  return { model };
}

// deps: Side chat's (makeAgent, isClaude, emptyDir, cwd, localOpts, mode) + firstPieceMs/totalMs for tests.
function writeScript({ model, blocks, request, tags, deps, onPiece, signal }) {
  return new Promise((resolve, reject) => {
    const { system, prompt } = buildPrompt({ blocks, request, tags });
    const parser = new PieceParser((blocks || []).length);
    const pieces = [];
    let proc = null, done = false, deltas = false;
    const timers = [];
    const finish = (err) => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      if (signal) signal.removeEventListener("abort", onAbort);
      try { proc && proc.kill(); } catch { /* gone */ }
      try { proc && proc.forget && proc.forget(); } catch { /* nothing kept */ }
      if (err) reject(err); else resolve({ pieces, model });
    };
    const give = (list) => { for (const p of list) { pieces.push(p); if (done) return; onPiece(p); } };
    const onAbort = () => { const e = new Error("Stopped."); e.cancelled = true; finish(e); };
    if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener("abort", onAbort); }
    const claude = deps.isClaude(model);
    const opts = { name: "listen", effort: "low", noThinking: true, safeMode: true, partial: true, tools: [], allowedTools: [],
      mode: deps.mode ? deps.mode(model) : "ask",
      ...(claude ? { systemPrompt: system, cwd: deps.emptyDir ? deps.emptyDir() : undefined } : { cwd: deps.cwd(), appendSystemPrompt: system }) };
    try {
      proc = deps.makeAgent(model, opts, deps.localOpts ? deps.localOpts(model) : {}, {
        onMessage: (m) => {
          if (done) return;
          if (m.type === "stream_event" && m.event && m.event.type === "content_block_delta" && m.event.delta && m.event.delta.type === "text_delta" && m.event.delta.text) {
            deltas = true; give(parser.push(m.event.delta.text));
          } else if (m.type === "result") {
            if (m.is_error) return finish(new Error(String(m.result || FAILED)));
            if (!deltas && m.result) give(parser.push(String(m.result)));
            give(parser.end());
            finish(pieces.length ? null : new Error(FAILED));
          }
        },
        onPermission: async () => ({ allow: false, message: "Listen's walkthrough only answers." }),
        onExit: () => finish(new Error(FAILED)),
      });
      if (!proc.start()) return finish(new Error(FAILED));
    } catch (e) { return finish(e); }
    timers.push(setTimeout(() => { if (!pieces.length) finish(new Error(FAILED)); }, deps.firstPieceMs || LIMITS.firstPieceMs));
    timers.push(setTimeout(() => finish(pieces.length ? null : new Error(FAILED)), deps.totalMs || LIMITS.totalMs));
    for (const t of timers) if (t.unref) t.unref();
    proc.send(prompt);
  });
}

module.exports = { LIMITS, NO_MODEL, FAILED, blocksText, buildPrompt, PieceParser, pickModel, writeScript };
