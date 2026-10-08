// Teams for providers without Claude Code's Task tool. Kural runs separate sessions, forwards their
// reports between phases, and translates their activity into the chat's existing agent cards.
// No vscode, CLI flags or API keys here: every member uses the ordinary provider adapter.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { teamMembers, ROLES } = require("./team");
const { textOf, handoff } = require("../router/journal");
const { real, within } = require("../paths");
const handoffStore = require("./handoff-store");

const uid = () => crypto.randomUUID();
const STOPPED = () => Object.assign(new Error("Stopped."), { stopped: true });
const EDITS = new Set(["Edit", "Write", "NotebookEdit"]);
const fileKey = (f) => process.platform === "win32" ? real(f).toLowerCase() : real(f);

// Only explicit, disjoint file assignments can build concurrently. A vague or overlapping plan
// falls back to one developer, who receives the whole plan.
function assignments(text, members, cwd) {
  let plan;
  try { plan = JSON.parse(String(text).replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "").trim()); } catch { plan = null; }
  const summary = plan && typeof plan.summary === "string" ? plan.summary : String(text);
  const byName = new Map(members.map((m) => [m.name, m]));
  const items = [], files = new Set(), names = new Set();
  let valid = !!(plan && Array.isArray(plan.assignments));
  for (const a of valid ? plan.assignments : []) {
    if (!a || !byName.has(a.name) || names.has(a.name) || typeof a.task !== "string" || !a.task.trim() ||
      !Array.isArray(a.files) || !a.files.length || a.files.some((f) => typeof f !== "string" || !f.trim())) { valid = false; break; }
    const own = a.files.map((f) => path.resolve(cwd, f));
    for (const f of own) {
      const k = fileKey(f);
      if (k === fileKey(cwd) || !within(f, [cwd]) ||
        [...files].some((p) => p === k || p.startsWith(k + path.sep) || k.startsWith(p + path.sep))) valid = false;
      files.add(k);
    }
    if (!valid) break;
    names.add(a.name); items.push({ member: byName.get(a.name), task: a.task, files: own });
  }
  return { summary, tasks: valid ? items : members.length ? [{ member: members[0], task: summary, files: null }] : [] };
}

class TeamAgent {
  constructor(opts, handlers, make) {
    this.opts = opts;
    this.h = handlers || {};
    this.make = make;
    this.model = opts.model;
    this.mode = opts.mode || "agent";
    this.sessionId = opts.resume || opts.sessionId || uid();
    this.exited = false; this.busy = false; this.queue = []; this.active = new Map();
    this.history = [];
    this.directory = opts.store ? handoffStore.directory(path.join(opts.store, "teams"), this.sessionId) : null;
    this.file = this.directory ? path.join(this.directory, "session.json") : null;
    if (opts.resume && this.file) try {
      const saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (!Array.isArray(saved.history) || saved.history.some((m) => !m || !["user", "assistant"].includes(m.role) ||
        typeof m.text !== "string" || (m.media && !Array.isArray(m.media)))) throw new Error("Invalid history");
      this.history = saved.history;
    }
    catch { this.resumeMissing = true; }
  }

  get echoes() { return true; }
  emit(m) { if (!this.exited && this.h.onMessage) this.h.onMessage({ ...m, session_id: this.sessionId }); }
  start() {
    if (!this.opts.bin || !fs.existsSync(this.opts.bin)) return false;
    setImmediate(() => {
      if (this.resumeMissing) { if (this.h.onExit) this.h.onExit({ stderr: "Team session not found." }); }
      else this.emit({ type: "system", subtype: "init", model: this.model, tools: [], mcp_servers: [] });
    });
    return true;
  }
  send(content) { if (!this.exited && !this.resumeMissing) { this.queue.push(content); this.next(); } }
  async next() {
    if (this.busy || this.exited || !this.queue.length) return;
    this.busy = true; this.stopped = false; this.finishing = false;
    this.disabledMembers = new Set();
    const content = this.queue.shift(), t0 = Date.now();
    this.content = content; this.board = [];
    this.emit({ type: "user", isReplay: true, message: { role: "user", content } });
    let result, error;
    try { result = await this.run(); } catch (e) {
      error = e; result = e.message;
      this.stopped = true;
      for (const t of [...this.active.values()]) { t.agent.kill(); t.finish({ is_error: true, subtype: "error_during_execution", result: "Stopped after a teammate failed." }); }
    }
    this.history.push({ role: "user", text: textOf(content), media: Array.isArray(content) ? content.filter((b) => b.type === "image") : [] },
      { role: "assistant", text: result, reports: this.board });
    this.persist();
    this.busy = false;
    this.emit({ type: "result", subtype: error && error.stopped ? "error_during_execution" : error ? "error" : "success",
      is_error: !!error, result, duration_ms: Date.now() - t0, kural_team_complete: true });
    setImmediate(() => this.next());
  }

  say(text) {
    this.emit({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "text" } } });
    this.emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
    this.emit({ type: "stream_event", event: { type: "content_block_stop" } });
  }

  post(member, text) {
    this.board.push({ from: member ? member.name : "lead", text });
    const id = uid();
    this.emit({ type: "assistant", parent_tool_use_id: member && member.callId, message: { role: "assistant", model: this.model,
      content: [{ type: "tool_use", id, name: "mcp__team__post", input: { from: member ? member.name : "lead", to: "all", message: text } }] } });
    this.emit({ type: "user", parent_tool_use_id: member && member.callId, message: { role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: "Shared with the team." }] } });
  }

  persist() {
    if (!this.file) return false;
    const tmp = path.join(this.directory, `${uid()}.tmp`);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(tmp, JSON.stringify({ history: this.history }), { mode: 0o600, flag: "wx" });
      fs.renameSync(tmp, this.file);
      return true;
    } catch { return false; } finally { try { fs.unlinkSync(tmp); } catch { /* renamed or not created */ } }
  }

  contextRecord() {
    const messages = this.history.map((m) => m.role === "user" ? { role: "user", segments: [{ t: "text", v: m.text }] }
      : { role: "assistant", blocks: [{ k: "text", text: m.text + "\nTeam reports:\n" + JSON.stringify(m.reports || []) }] });
    if (this.board.length) messages.push({ role: "assistant", blocks: [{ k: "text", text: "Team reports so far:\n" + JSON.stringify(this.board) }] });
    if (!messages.length) return "";
    let archive = null;
    if (this.directory) try { archive = handoffStore.save(messages, path.join(this.directory, "handoff")); } catch { /* retain everything inline */ }
    return "\nRecorded requests and team reports:\n" + handoff(messages, archive ? this.opts.handoffChars || 120000 : Infinity, archive) + "\n";
  }

  // A member's CLI is short lived. It receives the full request and prior reports, and is stopped
  // after its report. Each member's tool ids and approvals are kept separate from its teammates'.
  one(member, prompt, mode, { display = false, files = null, readOnly = false } = {}) {
    if (this.stopped || this.exited) return Promise.reject(STOPPED());
    if (member && this.disabledMembers.has(member.name)) return Promise.resolve(`${member.name} was stopped by the user.`);
    const id = uid(), callId = member ? `team-${id}` : null, taskId = `task-${id}`;
    const activity = prompt.replace(/^KURAL_TEAM_\w+\n/, "").split("\n")[0].slice(0, 150);
    if (member) {
      member = { ...member, callId };
      this.emit({ type: "assistant", message: { role: "assistant", model: this.model,
        content: [{ type: "tool_use", id: callId, name: "Task", input: { description: activity,
          prompt: `You are ${member.name}${member.role ? `, the ${member.role}` : ""}. ${prompt}` } }] } });
      this.emit({ type: "system", subtype: "task_started", tool_use_id: callId, task_id: taskId });
    }
    const record = this.contextRecord();
    const role = member && ROLES.find((r) => r.id === member.id);
    const instructions = `\nKural manages this team. ${member ? `You are ${member.name}${member.role ? `, the ${member.role}` : ""}.` : "You are the Project Manager."} ` +
      `${role ? role.duty : ""}\nUse your own tools for your assigned work. Do not spawn more agents. ` +
      `Kural shares your final report with the team automatically. Do not wait on or call a team board tool. ` +
      `${readOnly ? "Do not change files." : ""}\n${prompt}${record}`;
    const base = { ...this.opts, teamConfig: null, resume: null, sessionId: uid(), mode, model: this.model,
      addDirs: [...(this.opts.addDirs || []), ...(this.directory ? [this.directory] : [])],
      name: `${this.opts.name} ${member ? member.name : "PM"}`, appendSystemPrompt: this.opts.appendSystemPrompt + instructions };
    return new Promise((resolve, reject) => {
      let agent, ended = false, streamed = "", blockType, blockText = "";
      const cardText = () => {
        if (member && blockText.trim()) this.emit({ type: "assistant", parent_tool_use_id: callId,
          message: { role: "assistant", model: this.model, content: [{ type: blockType,
            ...(blockType === "thinking" ? { thinking: blockText } : { text: blockText }) }] } });
        blockText = "";
      };
      const finish = (m) => {
        if (ended) return; ended = true;
        this.active.delete(taskId);
        if (agent) agent.kill();
        cardText();
        const text = m.subtype === "error_during_execution" && streamed ? `${m.result || "Stopped."}\nPartial report:\n${streamed}`
          : String(m.result || streamed || "No report.");
        if (member) {
          this.post(member, text);
          this.emit({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: callId, content: text, is_error: !!m.is_error }] } });
          this.emit({ type: "system", subtype: "task_notification", tool_use_id: callId, task_id: taskId,
            status: m.subtype === "error_during_execution" ? "stopped" : m.is_error ? "failed" : "completed" });
        }
        if (this.stopped || this.exited) reject(STOPPED());
        else if (m.is_error && !this.finishing && !m.kural_stopped_member) reject(new Error(text));
        else resolve(text);
      };
      const onMessage = (m) => {
        if (ended || this.exited) return;
        if (m.type === "result") { finish(m); return; }
        if (m.type === "user" && m.isReplay || m.type === "system" && m.subtype === "init") return;
        if (m.type === "kural_usage") { this.emit({ ...m, context: member ? null : m.context }); return; }
        const delta = m.type === "stream_event" && m.event && m.event.delta;
        if (delta && delta.type === "text_delta") streamed += delta.text;
        if (member && m.type === "stream_event") {
          if (m.event.type === "content_block_start") { blockType = m.event.content_block && m.event.content_block.type; blockText = ""; }
          else if (delta && delta.type === "text_delta") { blockType = "text"; blockText += delta.text; }
          else if (delta && delta.type === "thinking_delta") { blockType = "thinking"; blockText += delta.thinking || ""; }
          else if (m.event.type === "content_block_stop") cardText();
        }
        if (!member && !display && (delta && delta.type === "text_delta" || m.type === "stream_event" && m.event.content_block && m.event.content_block.type === "text")) return;
        if (m.type === "assistant" || m.type === "user") {
          const blocks = Array.isArray(m.message && m.message.content) ? m.message.content : [];
          const content = blocks.filter((b) => member || display || b.type !== "text").map((b) => ({ ...b,
            ...(b.id ? { id: `${id}-${b.id}` } : {}), ...(b.tool_use_id ? { tool_use_id: `${id}-${b.tool_use_id}` } : {}) }));
          if (content.length) this.emit({ ...m, parent_tool_use_id: callId, message: { ...m.message, content } });
        } else this.emit({ ...m, parent_tool_use_id: callId });
        if (member) this.emit({ type: "system", subtype: "task_progress", tool_use_id: callId, task_id: taskId, description: activity });
      };
      const handlers = { onMessage, onExit: (info) => finish({ is_error: true, result: info.stderr || "The agent stopped." }),
        onPermission: async (req) => {
          if (this.stopped || this.exited) return { allow: false, message: "Stopped." };
          const file = req.input && (req.input.file_path || req.input.notebook_path);
          if (EDITS.has(req.tool_name) && (readOnly || files && (!file || !files.some((f) => fileKey(f) === fileKey(path.resolve(this.opts.cwd, file))))))
            return { allow: false, message: "This file is outside your assigned part. Report the required change to the PM." };
          return this.h.onPermission ? this.h.onPermission({ ...req, agent_id: member ? taskId : undefined,
            ...(req.tool_use_id ? { tool_use_id: `${id}-${req.tool_use_id}` } : {}) }) : { allow: false };
        } };
      try {
        agent = this.make(base, handlers);
        this.active.set(taskId, { agent, finish, member });
        if (!agent.start()) { finish({ is_error: true, result: "The agent's program could not start. Check Get started." }); return; }
        const previousMedia = this.history.flatMap((m) => m.media || []);
        const media = [...new Map([...previousMedia, ...(Array.isArray(this.content) ? this.content.filter((b) => b.type === "image") : [])].map((b) => [JSON.stringify(b), b])).values()];
        agent.send(previousMedia.length ? [{ type: "text", text: textOf(this.content) }, ...media] : this.content);
      } catch (e) { finish({ is_error: true, result: e.message }); }
    });
  }

  async approve(summary, tasks) {
    const question = `Build this plan?\n${summary}\n${tasks.map((t) => `${t.member.name}: ${t.task}${t.files ? ` (${t.files.map((f) => path.relative(this.opts.cwd, f)).join(", ")})` : ""}`).join("\n")}`;
    const questions = [{ header: "Plan", question, multiSelect: false, options: [
      { label: "Go ahead", description: "Build the plan." }, { label: "Change the plan", description: "Revise it before building." },
      { label: "Stop", description: "Keep the plan without making changes." }] }];
    const answer = this.h.onPermission ? await this.h.onPermission({ tool_name: "AskUserQuestion", input: { questions }, tool_use_id: uid() }) : { allow: false };
    if (this.stopped || this.exited) throw STOPPED();
    const picked = answer.allow && answer.updatedInput && answer.updatedInput.answers && answer.updatedInput.answers[question];
    return Array.isArray(picked) ? picked[0] : picked;
  }

  async run() {
    const T = this.opts.teamConfig, members = teamMembers(T.size, T.roles || [], T.style);
    if (T.style === "discuss") {
      await Promise.all(members.map((m) => this.one(m, "Form your own position from evidence before seeing the others. Give your claim, sources and what would change your mind.", "ask", { readOnly: true })));
      if (!this.finishing) await Promise.all(members.map((m) => this.one(m, "Answer the other positions point by point. State earned agreement and any disagreement with evidence. Give your final position.", "ask", { readOnly: true })));
    } else {
      const planners = members.filter((m) => m.id === "researcher" || m.id === "architect");
      if (planners.length) await Promise.all(planners.map((m) => this.one(m, "Study the request and code, then propose the approach, files, risks and sources. This phase only plans.", "plan", { readOnly: true })));
      const devs = (T.roles || []).length ? members.filter((m) => m.id === "developer") : members;
      if (!devs.length || this.finishing) {
        const tester = members.find((m) => m.id === "tester");
        if (tester && !this.finishing) await this.one(tester, "Review the request and the proposed plan against the existing code. Report edge cases, quality concerns and what would need verification. Do not change files.", "plan", { readOnly: true });
        return this.summary();
      }
      const raw = await this.one(null, `KURAL_TEAM_PLAN\nPlan the requested work using the team reports. Divide it into independent parts; never assign the same file to two developers. Use 1 developer when parts overlap. Available developers: ${devs.map((m) => m.name).join(", ")}. ` +
        `Check the current files and completed work; plan only what remains. If no code changes are needed, return an empty assignments array. ` +
        `Return only JSON: {"summary":"approach and risks", "assignments":[{"name":"developer name","files":["relative/file.js"],"task":"complete description of that part"}]}.`, "plan", { readOnly: true });
      const plan = assignments(raw, devs, this.opts.cwd);
      this.post(null, plan.summary);
      if (this.finishing || !plan.tasks.length || ["plan", "ask"].includes(this.mode)) return this.summary();
      const answer = await this.approve(plan.summary, plan.tasks);
      if (answer !== "Go ahead") {
        const text = answer === "Change the plan" ? "Tell me what to change in the plan, and the team will revise it." : "The team stopped with the plan; no changes were made.";
        this.say(text); return text;
      }
      if (!this.finishing) await Promise.all(plan.tasks.map((t) => this.one(t.member,
        `Build your assigned part of the approved plan.\nPlan: ${plan.summary}\nYour part: ${t.task}\n` +
        (t.files ? `Only change these files: ${t.files.join(", ")}. Report dependencies on other files to the PM.` : "You are the only developer; carry out the complete plan."), this.mode, { files: t.files })));
      const tester = members.find((m) => m.id === "tester");
      if (tester && !this.finishing) {
        const review = await this.one(tester, 'KURAL_TEAM_REVIEW\nRead the real changes and test them. Report concrete findings, or begin the report with "OK" and say what you checked. Do not change files.', this.mode, { readOnly: true });
        if (!/^\s*OK\b/i.test(review) && !this.finishing) {
          await Promise.all(plan.tasks.map((t) => this.one(t.member, `Address the Tester's findings for your part only.\n${t.task}\n${review}`, this.mode, { files: t.files })));
          await this.one(tester, 'KURAL_TEAM_REVIEW\nReview the fixes, run the relevant checks, and report what is resolved and what remains. Do not change files.', this.mode, { readOnly: true });
        }
      }
    }
    return this.summary();
  }

  async summary() {
    return this.one(null, "Give the user the final answer from the team's reports. Include what each agent did, the decision, checks, unresolved work and any disagreement. Do not smooth over disagreement or claim an unrun check passed. Do not start more work.", "ask", { display: true, readOnly: true });
  }

  setModel(model) { this.model = model; }
  request(req) {
    if (req && req.subtype === "stop_task") {
      const t = this.active.get(req.task_id);
      if (t) {
        if (t.member) this.disabledMembers.add(t.member.name);
        t.agent.kill(); t.finish({ is_error: true, subtype: "error_during_execution", kural_stopped_member: true, result: "Stopped by the user." });
      }
    }
    return Promise.resolve({});
  }
  finishTeam() {
    this.finishing = true;
    for (const t of [...this.active.values()]) { t.agent.kill(); t.finish({ is_error: true, subtype: "error_during_execution", result: "Stopped by the user; conclude with the reports so far." }); }
  }
  interrupt() {
    this.stopped = true;
    for (const t of [...this.active.values()]) { t.agent.kill(); t.finish({ is_error: true, subtype: "error_during_execution", result: "Stopped." }); }
  }
  kill() { this.interrupt(); this.exited = true; this.queue = []; }
}

module.exports = { TeamAgent, assignments };
