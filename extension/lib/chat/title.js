// A short title for a new chat, written by the quickest model from the first message (no vscode inside).
//
// The tab shows the first words of the message at once; when this answer comes (a few seconds) the chat replaces them, unless
// you renamed the chat meanwhile. It is NOT the conversation: no turn, no tab.status, no notification, no tools. Any failure or
// a late answer keeps the first words.
const MAX_REQUEST = 1500;
const TIMEOUT_MS = 8000;
const MAX_WORDS = 6, MAX_CHARS = 60;

const SYSTEM = "You write titles for chats. Reply with ONE short title (at most 6 words) that says what the user's message is about, " +
  "in the user's language. No quotes, no trailing punctuation, no markdown, nothing else.";

// What the model said → a one-line title of at most 6 words, or "".
function cleanTitle(raw) {
  let s = String(raw == null ? "" : raw).split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "";
  s = s.replace(/^(title|chat title)\s*:\s*/i, "").replace(/^[#>*\-\s]+/, "").replace(/[*_`]/g, "")
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, "").replace(/[.!?:;,\s]+$/, "").replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter(Boolean).slice(0, MAX_WORDS);
  s = words.join(" ");
  if (s.length > MAX_CHARS) s = s.slice(0, MAX_CHARS).replace(/\s+\S*$/, "");
  return s;
}

class Titler {
  // deps: makeAgent(model, opts, local, handlers) · model() · check(model) → { ok } · mode(model) · isClaude(model) ·
  //   emptyDir() · cwd() · localOpts(model) · timeoutMs
  constructor(deps) { this.d = deps; this.running = new Set(); }

  // Resolves to the title, or null (no AI, an error, a timeout, no usable answer). Never throws.
  ask(chatId, request) {
    const text = String(request || "").trim().slice(0, MAX_REQUEST);
    if (!text) return Promise.resolve(null);
    let model;
    try { model = this.d.model(); const can = model && this.d.check(model); if (!model || !can || !can.ok) return Promise.resolve(null); } catch { return Promise.resolve(null); }
    return new Promise((resolve) => {
      let proc = null, timer = null, done = false, got = "";
      const end = (title) => {
        if (done) return;
        done = true; clearTimeout(timer); this.running.delete(proc);
        try { proc && proc.kill(); } catch { /* already gone */ }
        try { proc && proc.forget && proc.forget(); } catch { /* nothing kept */ }
        resolve(title || null);
      };
      try {
        const claude = this.d.isClaude(model);
        const opts = { name: `title ${chatId}`, effort: "low", noThinking: true, safeMode: true, partial: true, tools: [], allowedTools: [],
          mode: this.d.mode ? this.d.mode(model) : "ask",
          ...(claude ? { systemPrompt: SYSTEM, cwd: this.d.emptyDir ? this.d.emptyDir() : undefined } : { cwd: this.d.cwd(), appendSystemPrompt: SYSTEM }) };
        proc = this.d.makeAgent(model, opts, this.d.localOpts ? this.d.localOpts(model) : null, {
          onMessage: (m) => {
            if (done) return;
            if (m.type === "stream_event" && m.event && m.event.type === "content_block_delta" && m.event.delta && m.event.delta.type === "text_delta") got += m.event.delta.text || "";
            else if (m.type === "result") end(m.is_error ? "" : cleanTitle(m.result || got));
          },
          onPermission: async () => ({ allow: false, message: "Titles only answer." }),
          onExit: () => end(""),
        });
        this.running.add(proc);
        if (!proc.start()) { end(""); return; }
        timer = setTimeout(() => end(""), this.d.timeoutMs || TIMEOUT_MS);
        if (timer.unref) timer.unref();
        proc.send(`The user's first message:\n${text}\n\nWrite the chat's title.`);
      } catch { end(""); }
    });
  }

  stopAll() { for (const p of [...this.running]) { try { p.kill(); } catch { /* gone */ } } this.running.clear(); }
}

module.exports = { Titler, cleanTitle, SYSTEM, MAX_WORDS };
