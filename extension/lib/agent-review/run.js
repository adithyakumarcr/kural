// Runs the reviewer (no vscode): one short-lived, read-only agent that looks at the changes and answers with findings.
// Modelled on the side chat and Enhance prompt: the same adapters for every AI (brain.makeAgent), mode "ask" (it may read
// the project, never change it), every permission that isn't a read inside the repository refused.
const path = require("path");
const { within } = require("../paths");
const { REVIEW_PROMPT, buildMessage, parseFindings } = require("./core");

const TIMEOUT_MS = { quick: 3 * 60 * 1000, deep: 10 * 60 * 1000 };
const EFFORT = { quick: "medium", deep: "high" };
const READ_TOOLS = ["Read", "Grep", "Glob"];

const lastLine = (s) => String(s || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || "";
const short = (s, n = 60) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };

// What it's doing, in plain words, from a tool call.
function describe(name, input, root) {
  const i = input && typeof input === "object" ? input : {};
  // (Names are shown with "/" on every system, like the findings'.)
  const file = (p) => { const s = String(p || ""); return short(path.isAbsolute(s) && root ? path.relative(root, s).split(path.sep).join("/") || "." : s, 70); };
  if (name === "Read") return `Reading ${file(i.file_path)}`;
  if (name === "Grep") return i.pattern ? `Searching the code for "${short(i.pattern, 40)}"` : "Searching the code";
  if (name === "Glob") return i.pattern ? `Looking for files like ${short(i.pattern, 40)}` : "Looking through the project";
  return "Looking through the project";
}

// A read (Read, Grep, Glob) of something inside the repository is allowed; everything else is refused. A call with no path
// looks in the working folder, which is the repository.
function allowed(req, root) {
  const tool = req && req.tool_name, i = (req && req.input) || {};
  if (!READ_TOOLS.includes(tool)) return { allow: false, message: "A review only reads the project." };
  const p = tool === "Read" ? i.file_path : i.path;
  if (p == null || p === "") return tool === "Read" ? { allow: false, message: "Read needs a file." } : { allow: true };
  const abs = path.resolve(root, String(p));
  return within(abs, [root]) ? { allow: true } : { allow: false, message: "A review reads only files inside the repository." };
}

function failure(text) {
  const t = String(text || "");
  if (/rate.?limit|usage limit|limit (?:reached|exceeded)|too many requests|\b429\b|quota|overloaded|\b529\b/i.test(t)) return { kind: "rate", message: `That AI's usage limit was reached for now: ${t.slice(0, 160)}` };
  if (/log ?in|logged out|not logged|authenticat|unauthori[sz]ed|\b401\b/i.test(t)) return { kind: "login", message: "Not logged in to that AI. Open Kural: Get Started." };
  return { kind: "failed", message: t ? t.slice(0, 300) : "Something went wrong." };
}

class Reviewer {
  // deps: makeAgent(model, opts, local, handlers) · isClaude(model) · mode(model) → the program's read-only mode (default "ask") ·
  //   localOpts(model) · log(line) · timeoutMs? ({ quick, deep })
  constructor(deps) { this.d = deps; }

  // { depth: "quick" | "deep", model, files, skipped, root, onStatus(words) } →
  //   { stop(), done: Promise<{ ok, summary, findings, dropped, ms } | { error, kind }> }.
  run({ depth, model, files, skipped = [], root, onStatus = () => {} }) {
    const t0 = Date.now(), d = this.d, deep = depth === "deep";
    let finish, proc = null, timer = null, ended = false, calls = 0, streamed = "", lastStatus = "";
    const done = new Promise((r) => { finish = r; });
    const say = (s) => { if (s && s !== lastStatus) { lastStatus = s; try { onStatus(s); } catch { /* the caller's problem */ } } };
    const end = (r) => {
      if (ended) return;
      ended = true; clearTimeout(timer);
      try { proc && proc.kill(); } catch { /* gone */ }
      try { proc && proc.forget && proc.forget(); } catch { /* nothing kept */ }   // (agy's map entry)
      if (d.log) d.log(`agent review (${depth}): ${r.ok ? `${r.findings.length} findings${r.dropped ? `, ${r.dropped} dropped` : ""}` : `${r.kind}: ${r.error}`} (${calls} tool calls, ${Date.now() - t0} ms)`);
      finish({ ...r, ms: Date.now() - t0 });
    };
    const handle = { stop: () => end({ error: "Stopped.", kind: "stopped" }), done };
    const claude = d.isClaude(model);
    const opts = { name: "agent-review", mode: d.mode ? d.mode(model) : "ask", effort: EFFORT[deep ? "deep" : "quick"], cwd: root, safeMode: true,
      // (Claude: the reviewer's prompt replaces Claude Code's own; the others add it to theirs. Claude reads inside its working
      // folder by itself and asks Kural for the rest: onPermission.)
      tools: READ_TOOLS, allowedTools: [], hostPermissions: true, persist: false,
      ...(claude ? { systemPrompt: REVIEW_PROMPT(depth) } : { appendSystemPrompt: REVIEW_PROMPT(depth) }) };
    const message = `${buildMessage({ name: path.basename(root), files, skipped })}\n\nThe repository is at ${root}.`;
    const limit = (d.timeoutMs && d.timeoutMs[deep ? "deep" : "quick"]) || TIMEOUT_MS[deep ? "deep" : "quick"];
    try {
      proc = d.makeAgent(model, opts, d.localOpts ? d.localOpts(model) : null, {
        onMessage: (m) => {
          if (ended) return;
          if (m.type === "assistant" && m.message && Array.isArray(m.message.content)) {
            for (const b of m.message.content) if (b && b.type === "tool_use") { calls++; say(describe(b.name, b.input, root)); }
          } else if (m.type === "stream_event" && m.event && m.event.type === "content_block_delta" && m.event.delta) {
            if (m.event.delta.type === "text_delta" && m.event.delta.text) { streamed += m.event.delta.text; say("Writing up what it found"); }
            else if (m.event.delta.type === "thinking_delta") say("Thinking about the changes");
          } else if (m.type === "result") {
            if (m.is_error) { const f = failure(m.result || (m.errors || []).join(" ")); end({ error: f.message, kind: f.kind }); return; }
            const raw = String(m.result || "").trim() || streamed;
            const review = parseFindings(raw, files);
            if (!review) { end({ error: "It didn't answer in a form Kural could read. Try again.", kind: "failed" }); return; }
            end({ ok: true, ...review });
          }
        },
        onPermission: async (req) => {
          const a = allowed(req, root);
          if (!a.allow && d.log) d.log(`agent review: refused ${req && req.tool_name}: ${a.message}`);
          return a;
        },
        onExit: (info) => {
          if (info && info.login) { end({ error: "Not logged in to that AI. Open Kural: Get Started.", kind: "login" }); return; }
          const f = failure(lastLine(info && info.stderr) || "The AI stopped before it finished the review.");
          end({ error: f.message, kind: f.kind });
        },
      });
      if (!proc.start()) { end({ error: "Couldn't start the AI. See Kural's log (Kural: Show Log).", kind: "failed" }); return handle; }
    } catch (e) { end({ error: e.message, kind: "failed" }); return handle; }
    timer = setTimeout(() => end({ error: `The review took longer than ${Math.round(limit / 60000)} minutes and was stopped.`, kind: "timeout" }), limit);
    say("Starting the review");
    proc.send(message);
    return handle;
  }
}

module.exports = { Reviewer, allowed, describe, failure, TIMEOUT_MS, EFFORT };
