// Side chat: a small question about a part of an answer, asked and answered right under it (no vscode inside).
//
// Select text in an answer → "Ask" → a box under the answer. The question goes to a quick model (brain.fastestModel: Haiku,
// or the lightest Codex / Gemini model, or your own model) with no tools, so it only answers. It is NOT part of the chat's
// conversation: the chat's AI never sees it (journal.js reads only blocks, so a message's `side` is ignored by handoffs,
// forks, Edit and Restore keep it with the answer it belongs to), it is not a turn, doesn't change the tab's status and
// doesn't notify. It is saved with the answer:
//   msg.side = [{ id, quote, items: [{ q, a, model, at, running?, error?, stopped? }] }]
const MAX_REQUEST = 1500;     // your original request, in the prompt
const WINDOW = 6000;          // the answer's text in the prompt, around the quote
const MAX_QUOTE = 2000;       // the selected text we keep
const MAX_QUESTION = 2000;
const MAX_EARLIER = 6;        // earlier Q&A of the thread in the prompt
const MAX_EARLIER_ANSWER = 1500;
const MAX_ITEMS = 30, MAX_THREADS = 20;
const TIMEOUT_MS = 90000;
const ID_RE = /^[\w-]{1,24}$/;

const SYSTEM = "Answer a quick side question about a part of an earlier answer. Be brief: a few sentences or a small code snippet. " +
  "Don't repeat the quoted text. You have no tools; answer from what you are given and what you know.";

const clip = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? `${s.slice(0, n)}…` : s; };
const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();

// The answer's text (its text blocks, in order).
const answerText = (msg) => ((msg && msg.blocks) || []).filter((b) => b.k === "text").map((b) => b.text).join("");

// About `max` characters of `text` around the quote: where it starts is found by its first words (the page shows the answer
// as formatted text, so the selection may differ a little from the source: then the beginning of the answer is used).
function around(text, quote, max = WINDOW) {
  text = String(text || "");
  if (text.length <= max) return text;
  const words = squash(quote).split(" ").slice(0, 8).join(" ");
  let at = words ? text.indexOf(words) : -1;
  if (at < 0 && words) { const flat = squash(text); const f = flat.indexOf(words); if (f >= 0) at = Math.min(text.length - 1, Math.round(f * text.length / flat.length)); }
  if (at < 0) return `${text.slice(0, max)}\n[…the rest of the answer left out…]`;
  const from = Math.max(0, Math.min(at - Math.floor(max / 2), text.length - max)), to = Math.min(text.length, from + max);
  return `${from > 0 ? "[…earlier part left out…]\n" : ""}${text.slice(from, to)}${to < text.length ? "\n[…later part left out…]" : ""}`;
}

// What the model is sent. `items`: the thread's earlier questions and answers; `question`: the new one.
function buildPrompt({ request, answer, quote, items, question }) {
  const earlier = (items || []).filter((i) => i && i.q && i.a && !i.error).slice(-MAX_EARLIER);
  return [
    request ? `<request>\nWhat the user originally asked:\n${clip(request, MAX_REQUEST)}\n</request>` : "",
    `<answer>\nThe answer that was given (the part around the selection):\n${around(answer, quote)}\n</answer>`,
    `<selection>\nThe part the user selected:\n${clip(quote, MAX_QUOTE)}\n</selection>`,
    earlier.length ? `<side_conversation>\n${earlier.map((i) => `Question: ${clip(i.q, MAX_QUESTION)}\nAnswer: ${clip(i.a, MAX_EARLIER_ANSWER)}`).join("\n\n")}\n</side_conversation>` : "",
    `Side question about the selection:\n${clip(question, MAX_QUESTION)}`,
  ].filter(Boolean).join("\n\n");
}

class SideChats {
  // deps: makeAgent(model, opts, local, handlers) · model() the quick model · mode(model) the program's mode (default "ask") ·
  //   emptyDir() one empty folder for Claude · check(model) → { ok } | { why } ·
  //   nameOf(model) short name · isClaude(model) · localOpts(model) · textOf(segments) · cwd() · post(msg) · save()
  constructor(deps) { this.d = deps; this.runs = new Map(); }

  key(tabId, thread) { return `${tabId}:${thread}`; }

  // What the page asked: { index, thread, quote, question }. Finds or makes the thread on the answer, adds the question, starts it.
  ask(tab, p) {
    const msg = tab.messages[p.index];
    if (!msg || msg.role !== "assistant" || tab.visiting) return false;
    const question = String(p.question || "").trim().slice(0, MAX_QUESTION);
    if (!question || !ID_RE.test(String(p.thread || ""))) return false;
    const key = this.key(tab.id, p.thread);
    if (this.runs.has(key)) return false;   // one at a time in a thread
    msg.side = Array.isArray(msg.side) ? msg.side : [];
    let th = msg.side.find((t) => t.id === p.thread);
    if (!th) {
      if (msg.side.length >= MAX_THREADS) return false;
      th = { id: p.thread, quote: clip(String(p.quote || "").trim(), MAX_QUOTE), items: [] };
      msg.side.push(th);
    }
    if (th.items.length >= MAX_ITEMS) return false;
    const earlier = th.items.slice();
    const model = this.d.model(), can = model ? this.d.check(model) : { why: "No AI is set up. Open Kural: Get Started." };
    const item = { q: question, a: "", model: model ? this.d.nameOf(model) : "", at: Date.now(), running: true };
    th.items.push(item);
    const run = { key, msg, th, item, proc: null, timer: null, ended: false };
    const reply = () => ({ type: "sideState", tabId: tab.id, index: tab.messages.indexOf(msg), thread: th.id, quote: th.quote, n: th.items.indexOf(item), item: this.view(th, item) });
    const end = (error, stopped) => {
      if (run.ended) return;
      run.ended = true; clearTimeout(run.timer);
      this.runs.delete(key);
      delete item.running;
      if (stopped) item.stopped = true;
      else if (error) item.error = clip(squash(error), 300);
      try { run.proc && run.proc.kill(); } catch { /* already gone */ }
      try { run.proc && run.proc.forget && run.proc.forget(); } catch { /* nothing kept */ }   // (agy's map entry)
      if (tab.messages.indexOf(msg) < 0) { this.d.save(); return; }   // (the answer is gone: Edit cut it)
      this.d.post(reply()); this.d.save();
    };
    run.stopNow = () => end(null, true);
    if (!can.ok) { this.runs.set(key, run); end(can.why || "This model isn't available."); return true; }
    const request = (() => { const prev = tab.messages[p.index - 1]; return prev && prev.role === "user" ? this.d.textOf(prev.segments || []) : ""; })();
    const prompt = buildPrompt({ request, answer: answerText(msg), quote: th.quote, items: earlier, question });
    const claude = this.d.isClaude(model);
    const opts = { name: `side ${tab.id}`, effort: "low", noThinking: true, safeMode: true, partial: true, tools: [], allowedTools: [],
      mode: this.d.mode ? this.d.mode(model) : "ask",
      // (Claude: one shared empty folder, so no project files are loaded, it starts faster and no folder is made per question;
      // the others run where the chat does.)
      ...(claude ? { systemPrompt: SYSTEM, cwd: this.d.emptyDir ? this.d.emptyDir() : undefined } : { cwd: this.d.cwd(), appendSystemPrompt: SYSTEM }) };
    this.runs.set(key, run);
    const push = (text) => { item.a += text; if (tab.messages.indexOf(msg) < 0) return; this.d.post({ type: "sideDelta", tabId: tab.id, index: tab.messages.indexOf(msg), thread: th.id, text }); };
    try {
      run.proc = this.d.makeAgent(model, opts, this.d.localOpts(model), {
        onMessage: (m) => {
          if (run.ended) return;
          if (m.type === "stream_event" && m.event && m.event.type === "content_block_delta" && m.event.delta && m.event.delta.type === "text_delta" && m.event.delta.text) push(m.event.delta.text);
          else if (m.type === "result") {
            if (m.is_error) end(m.result || "Something went wrong.");
            else {
              const final = String(m.result || "").trim();
              if (final && final !== item.a.trim()) { item.a = final; }   // (the whole answer wins over the pieces)
              end(item.a.trim() ? "" : "It gave no answer.");
            }
          }
        },
        onPermission: async () => ({ allow: false, message: "Side questions only answer." }),
        onExit: (info) => end(info && info.login ? "Not logged in. Open Kural: Get Started." : "The model stopped before it answered."),
      });
      if (!run.proc.start()) { end("Couldn't start the model. See Kural's log (Kural: Show Log)."); return true; }
    } catch (e) { end(e.message); return true; }
    run.timer = setTimeout(() => end("It took too long."), this.d.timeoutMs || TIMEOUT_MS);
    if (run.timer.unref) run.timer.unref();
    this.d.post(reply());
    run.proc.send(prompt);
    this.d.save();
    return true;
  }

  // The page's view of one question (no internals).
  view(th, item) { const { q, a, model, at, running, error, stopped } = item; return { q, a, model, at, ...(running ? { running } : {}), ...(error ? { error } : {}), ...(stopped ? { stopped } : {}) }; }

  stop(tabId, thread) {
    const run = this.runs.get(this.key(tabId, thread));
    if (!run) return false;
    run.stopNow();
    return true;
  }

  stopAll(tabId) { for (const [k, run] of [...this.runs]) if (!tabId || k.startsWith(`${tabId}:`)) run.stopNow(); }

  // A saved chat from an earlier window: a question that was running isn't any more.
  static clean(messages) {
    for (const m of messages || []) {
      if (!Array.isArray(m.side)) { delete m.side; continue; }
      m.side = m.side.filter((t) => t && ID_RE.test(String(t.id)) && Array.isArray(t.items));
      for (const t of m.side) for (const i of t.items) if (i.running) { delete i.running; i.stopped = true; }
      if (!m.side.length) delete m.side;
    }
  }
}

module.exports = { SideChats, buildPrompt, around, answerText, SYSTEM, MAX_QUOTE };
