// Parallel agents (no vscode): the chat's model leads, and several agents of the same AI work at once, each in its own
// git worktree, on a cheaper model you pick. To the chat it is one more agent: the same methods and stream-json events
// as ClaudeProcess (each agent is a "Task" card), so the chat needs nothing special for it.
//
//   1. Plan     the lead (the chat's model) reads the code and splits the request (plan.js), read only. One task: the
//               lead does it itself, in your project, like an ordinary answer.
//   2. Approve  the plan card (handlers.onPlan): a model per agent (your default from the model menu); Go ahead, change
//               the plan, or Stop. Auto mode doesn't ask.
//   3. Build    every agent at once, each in a worktree of your files as they are now (worktrees.js).
//   4. Merge    their commits, one after another, in a merge worktree; a conflict goes to the lead to resolve there.
//   5. Apply    the merged files into your project through the chat's own permission check (handlers.onPermission with
//               Write: your mode decides, and the chat takes its checkpoint, so Undo and Files changed work as always).
//               A file you changed meanwhile is merged with yours (git merge-file).
//   6. Check    the lead, in your project: runs the checks, fixes what doesn't fit, and gives the answer.
// Stop ends it all and leaves your files as they were; Finish now (finishAgents) stops the agents still working and goes
// on with the finished ones.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Worktrees } = require("./worktrees");
const { findGit } = require("../git");
const { MAX_AGENTS, PLAN, WORKER, RESOLVE, VERIFY, parsePlan, shownFiles } = require("./plan");
const { textOf } = require("../router/journal");
const { within } = require("../paths");

const uid = () => crypto.randomUUID();
const STOPPED = () => Object.assign(new Error("Stopped."), { stopped: true });
const EDITS = new Set(["Edit", "Write", "NotebookEdit"]);
const MAX_REPLANS = 3;
const same = (a, b) => a === b || (!!a && !!b && a.equals(b));
const read = (file) => { try { return fs.readFileSync(file); } catch { return null; } };

class SplitAgent {
  // opts: the chat's agent options (ClaudeProcess style: model, mode, cwd, name…) and split: { workers (your default
  //   model for the agents), models [{ id, label }] (this AI's), history() (the conversation so far, as text),
  //   instructions (what the agents are told instead of the chat's whole instructions: they build, they don't talk to
  //   you), dir (a private folder for the worktrees), env (whose PATH has git: lib/git.js) }.
  // make(model, opts, handlers): one agent of the chat's AI. handlers: the chat's, plus onPlan(plan) → { go, models } |
  //   { change: what to change } | { stop }.
  constructor(opts, handlers, make) {
    this.opts = opts; this.h = handlers || {}; this.make = make;
    this.model = opts.model; this.mode = opts.mode || "agent";
    this.sessionId = opts.resume || opts.sessionId || uid();
    this.exited = false; this.busy = false; this.queue = []; this.active = new Map();
  }

  get echoes() { return true; }
  emit(m) { if (!this.exited && this.h.onMessage) this.h.onMessage({ ...m, session_id: this.sessionId }); }
  start() {
    setImmediate(() => this.emit({ type: "system", subtype: "init", model: this.model, tools: [], mcp_servers: [] }));
    return true;
  }
  send(content) { if (!this.exited) { this.queue.push(content); this.next(); } }
  setModel(model) { this.model = model; }
  // Stopping one agent. Anything else (a model switch mid-answer, say) isn't taken: null.
  request(req) {
    if (!req || req.subtype !== "stop_task") return Promise.resolve(null);
    const t = this.active.get(req.task_id);
    if (t) t.stop("Stopped by the user.");
    return Promise.resolve({});
  }
  finishAgents() { for (const t of [...this.active.values()]) if (t.worker) t.stop("Stopped by the user; the others' work goes on."); }
  interrupt() { this.stopped = true; for (const t of [...this.active.values()]) t.stop("Stopped."); }
  kill() { this.interrupt(); this.exited = true; this.queue = []; }

  async next() {
    if (this.busy || this.exited || !this.queue.length) return;
    this.busy = true; this.stopped = false;
    const content = this.queue.shift(), t0 = Date.now();
    this.emit({ type: "user", isReplay: true, message: { role: "user", content } });
    let result, error;
    try { result = await this.run(content); } catch (e) { error = e; result = e.message; this.interrupt(); }
    this.busy = false;
    this.emit({ type: "result", subtype: error && error.stopped ? "error_during_execution" : error ? "error" : "success",
      is_error: !!error, result, duration_ms: Date.now() - t0, kural_split_complete: true });
    setImmediate(() => this.next());
  }

  async run(content) {
    const request = textOf(content);
    const history = this.opts.split.history ? this.opts.split.history() : "";
    const lead = (prompt, mode, extra) => this.step({ prompt: (history ? `${history}\n\n` : "") + prompt, mode, media: content, ...extra });
    let feedback = "";
    for (let round = 0; ; round++) {
      const plan = parsePlan(await lead(`${PLAN(MAX_AGENTS)}\n\nThe request:\n${request}${feedback}`, "plan", { quiet: true }), request);
      if (plan.tasks.length < 2) return lead(request, this.mode);
      const trees = await this.worktrees();
      if (!trees) { this.note("Parallel agents need a Git repository: one agent does it here"); return lead(request, this.mode); }
      try {
        const picked = this.mode === "auto" ? { go: true } : await this.approve(plan);
        if (picked.change && round < MAX_REPLANS) { feedback = `\n\nThe user wants the plan changed: ${picked.change}`; continue; }
        if (!picked.go) return "Stopped at the plan: nothing was changed.";
        plan.tasks.forEach((t, i) => { t.model = (picked.models && picked.models[i]) || this.opts.split.workers; });
        return await this.build(plan, trees, lead);
      } finally { await trees.close(); }
    }
  }

  async worktrees() {
    const s = this.opts.split;
    try { return await Worktrees.open(await findGit(s.env), this.opts.cwd, path.join(s.dir, uid().slice(0, 8))); } catch { return null; }
  }

  async approve(plan) {
    if (!this.h.onPlan) return { go: true };
    const answer = await this.h.onPlan({ summary: plan.summary, models: this.opts.split.models,
      tasks: plan.tasks.map((t) => ({ title: t.title, files: shownFiles(t.files, this.opts.cwd), model: this.opts.split.workers })) });
    if (this.stopped || this.exited) throw STOPPED();
    return answer || { stop: true };
  }

  label(model) { return (this.opts.split.models.find((x) => x.id === model) || { label: model }).label; }

  async build(plan, trees, lead) {
    const base = await trees.snapshot(), count = plan.tasks.length;
    // 3. Build: all at once. One that fails or is stopped doesn't stop the others. (Their worktrees are made one after
    // another first: git locks its worktree list while it adds one.)
    const copies = [];
    for (let i = 0; i < count; i++) copies.push(await trees.add(`agent-${i + 1}`, base, this.opts.cwd));
    const done = await Promise.all(plan.tasks.map(async (t, i) => {
      const n = i + 1, tree = copies[i];
      const card = { n, title: t.title, label: this.label(t.model) };
      const others = plan.tasks.filter((x) => x !== t).map((x) => x.title);
      const prompt = WORKER({ n, count, title: t.title, task: t.task, summary: plan.summary, others, cwd: tree.cwd });
      const out = { n, title: t.title, model: card.label };
      try { out.report = await this.step({ prompt, model: t.model, mode: this.mode, cwd: tree.cwd, root: tree.dir, card, worker: true }); }
      catch (e) { if (this.stopped) throw e; return { ...out, failed: e.message }; }
      return { ...out, sha: await trees.commit(tree.dir, `Agent ${n}: ${t.title}`) };
    }));
    // 4. Merge, one after another; a conflict goes to the lead.
    const merge = await trees.add("merge", base, this.opts.cwd), failed = [];
    for (const d of done) {
      if (d.failed) { failed.push(`agent ${d.n} (${d.title}): ${d.failed}`); continue; }
      if (!d.sha) continue;
      this.note(`Merging agent ${d.n}'s work`);
      const { conflicts } = await trees.merge(merge.dir, d.sha, `Merge agent ${d.n}: ${d.title}`);
      if (!conflicts.length) continue;
      await this.step({ prompt: RESOLVE(d.n, conflicts), mode: this.mode, cwd: merge.cwd, root: merge.dir,
        card: { n: "Lead", title: `Resolving conflicts with agent ${d.n}`, label: this.label(this.model) } }).catch((e) => { if (this.stopped) throw e; });
      if (!(await trees.finishMerge(merge.dir, conflicts))) failed.push(`agent ${d.n} (${d.title}): its changes conflicted with the others' and weren't resolved`);
    }
    if (this.stopped) throw STOPPED();
    // 5. Into your project. 6. The lead checks it and answers.
    const outcome = await this.apply(trees, base, await trees.head(merge.dir));
    const reports = done.filter((d) => !d.failed).map((d) => `Agent ${d.n} (${d.model}), "${d.title}":\n${d.report}`);
    return lead(VERIFY({ summary: plan.summary, reports, failed, ...outcome }), this.mode);
  }

  // The merged result into your project, file by file, through the chat's permission check (it saves the file if it
  // has unsaved edits and takes the checkpoint), so the file is read only after it.
  async apply(trees, base, final) {
    const out = { applied: [], conflicts: [], kept: [], skipped: [], declined: [] };
    for (const c of await trees.changes(base, final)) {
      if (this.stopped) throw STOPPED();
      if (c.skipped) { out.skipped.push(c.rel); continue; }
      if (same(read(c.file), c.final)) continue;
      const id = uid();
      this.emit({ type: "assistant", message: { role: "assistant", model: this.model, content: [{ type: "tool_use", id, name: "Write", input: { file_path: c.file } }] } });
      const ok = this.h.onPermission ? await this.h.onPermission({ tool_name: "Write", input: { file_path: c.file }, tool_use_id: id }) : { allow: true };
      if (this.stopped) throw STOPPED();
      const current = read(c.file);
      let next = c.final, list = out.applied;
      if (!ok || !ok.allow) list = out.declined;
      // You changed it while the agents worked: both changes merged (a collision gets git's markers). You deleted or
      // created it meanwhile, or they deleted it: yours stays.
      else if (!same(current, c.base)) {
        if (current === null || c.base === null || c.final === null) list = out.kept;
        else { const m = await trees.mergeFile(current, c.base, c.final); next = m.content; if (m.conflict) list = out.conflicts; }
      }
      if (list === out.applied || list === out.conflicts) {
        if (next === null) fs.rmSync(c.file, { force: true });
        else { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, next); if (c.executable) fs.chmodSync(c.file, 0o755); }
      }
      list.push(c.rel);
      this.emit({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: list === out.declined ? "Not applied." : "Applied." }] } });
    }
    return out;
  }

  // A short line in the answer's timeline ("Merging agent 2's work").
  note(text) {
    const id = uid();
    this.emit({ type: "assistant", message: { role: "assistant", model: this.model, content: [{ type: "tool_use", id, name: "Kural", input: { detail: text } }] } });
    this.emit({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "" }] } });
  }

  // One agent run, resolving with its final text. prompt, mode, model, cwd; root: its worktree (it changes files there
  // without asking, never in your project); card { n, title, label }: shown as an agent's card, its text in the card;
  // without one it's the lead: its steps go into the answer's timeline and its text is the answer (quiet: not even that,
  // for the plan); media: your message, for its pictures; worker: Finish now stops it.
  step({ prompt, mode, model = this.model, cwd = this.opts.cwd, root = null, card = null, quiet = false, media = null, worker = false }) {
    if (this.stopped || this.exited) return Promise.reject(STOPPED());
    const id = uid().slice(0, 8), callId = card ? `split-${id}` : null, taskId = `task-${id}`;
    if (card) {
      this.emit({ type: "assistant", message: { role: "assistant", model: this.model, content: [{ type: "tool_use", id: callId, name: "Task",
        input: { description: card.title, prompt, kural_agent: { n: card.n, label: card.label } } }] } });
      this.emit({ type: "system", subtype: "task_started", tool_use_id: callId, task_id: taskId });
    }
    const show = !card && !quiet;
    const opts = { ...this.opts, split: null, model, mode, cwd, resume: null, sessionId: uid(), persist: false,
      name: `${this.opts.name} ${card ? `agent ${card.n}` : "lead"}`,
      ...(card && this.opts.split.instructions !== undefined ? { appendSystemPrompt: this.opts.split.instructions } : {}),
      ...(root ? { addDirs: [], mcpServers: null } : {}) };
    return new Promise((resolve, reject) => {
      let agent, ended = false, streamed = "", blockType = null, blockText = "";
      // An agent's text and thinking, block by block, into its card.
      const flush = () => {
        if (card && blockText.trim()) this.emit({ type: "assistant", parent_tool_use_id: callId, message: { role: "assistant", model,
          content: [blockType === "thinking" ? { type: "thinking", thinking: blockText } : { type: "text", text: blockText }] } });
        blockText = "";
      };
      const finish = (m) => {
        if (ended) return; ended = true;
        this.active.delete(taskId);
        if (agent) { agent.kill(); if (agent.forget) agent.forget(); }   // (one-off: Gemini's conversation map entry goes)
        flush();
        const text = String(m.result || streamed || (m.is_error ? "The agent stopped." : "No report."));
        if (card) {
          this.emit({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: callId, content: text, is_error: !!m.is_error }] } });
          this.emit({ type: "system", subtype: "task_notification", tool_use_id: callId, task_id: taskId, status: m.stopped ? "stopped" : m.is_error ? "failed" : "completed" });
        }
        if (this.stopped || this.exited) reject(STOPPED());
        else if (m.is_error) reject(new Error(text));
        else resolve(text);
      };
      const onMessage = (m) => {
        if (ended || this.exited) return;
        if (m.type === "result") { finish(m); return; }
        if (m.type === "user" && m.isReplay || m.type === "system" && m.subtype === "init") return;
        if (m.type === "kural_usage") { this.emit({ ...m, context: show ? m.context : null }); return; }
        if (m.type === "stream_event") {
          const e = m.event || {}, delta = e.delta;
          if (e.type === "content_block_start") { flush(); blockType = e.content_block && e.content_block.type; }
          else if (delta && delta.type === "text_delta") { blockType = "text"; blockText += delta.text; streamed += delta.text; }
          else if (delta && delta.type === "thinking_delta") { blockType = "thinking"; blockText += delta.thinking || ""; }
          else if (e.type === "content_block_stop") flush();
          if (!card && (show || blockType !== "text")) this.emit(m);   // (the plan's thinking shows; its JSON doesn't)
          return;
        }
        if (m.type === "assistant" || m.type === "user") {
          // Tool ids made unique (several agents run at once); text and thinking came through the stream already.
          const blocks = Array.isArray(m.message && m.message.content) ? m.message.content : [];
          const content = blocks.filter((b) => b.type !== "text" && b.type !== "thinking").map((b) => ({ ...b,
            ...(b.id ? { id: `${id}-${b.id}` } : {}), ...(b.tool_use_id ? { tool_use_id: `${id}-${b.tool_use_id}` } : {}) }));
          if (content.length) this.emit({ ...m, parent_tool_use_id: callId, message: { ...m.message, content } });
        } else this.emit({ ...m, parent_tool_use_id: callId });
        if (card) this.emit({ type: "system", subtype: "task_progress", tool_use_id: callId, task_id: taskId, description: card.title });
      };
      const onPermission = async (req) => {
        if (this.stopped || this.exited) return { allow: false, message: "Stopped." };
        const file = req.input && (req.input.file_path || req.input.notebook_path);
        if (root && EDITS.has(req.tool_name) && file) {
          // Its own worktree is its to change (Kural brings the result over through the chat later); your project isn't.
          const abs = path.resolve(cwd, String(file));
          if (within(abs, [root])) return { allow: true };
          if (within(abs, [this.opts.cwd])) return { allow: false, message: `Change only your own copy of the project, in ${cwd}.` };
        }
        // (mode: this step's own, maybe stricter than the chat's: the plan is read only.)
        return this.h.onPermission ? this.h.onPermission({ ...req, mode, agent_id: card ? taskId : undefined,
          ...(req.tool_use_id ? { tool_use_id: `${id}-${req.tool_use_id}` } : {}) }) : { allow: false };
      };
      try {
        agent = this.make(model, opts, { onMessage, onPermission, onExit: (info) => finish({ is_error: true, result: (info && info.stderr) || "The agent stopped." }) });
        this.active.set(taskId, { worker, stop: (why) => finish({ is_error: true, stopped: true, result: why }) });
        if (!agent.start()) { finish({ is_error: true, result: "The agent's program could not start. Check Get started." }); return; }
        const pictures = Array.isArray(media) ? media.filter((b) => b && b.type === "image") : [];
        agent.send(pictures.length ? [{ type: "text", text: prompt }, ...pictures] : prompt);
      } catch (e) { finish({ is_error: true, result: e.message }); }
    });
  }
}

module.exports = { SplitAgent };
