// The chat panel (Ctrl+L): tabs, history, modes (Agent / Auto / Plan / Ask),
// model + intensity, and agent teams. The panel itself is a small web page
// (media/chat.js); this file runs Claude for each tab and keeps the conversations.
// Each tab = one `claude` process = one conversation.

const vscode = require("vscode");
const { fontScale, watchFontScale } = require("./ui");
const path = require("path");
const { ClaudeProcess, log, newSessionId, LOGIN_RE, findClaude } = require("./claude");
const { projectInstructions } = require("./project");
const { ChangeTracker } = require("./changes");
const ws = require("./workspace");
const { Attachments } = require("./attachments");
const { watchSetup } = require("./setup");

const MODELS = [
  { id: "opus", label: "Opus", hint: "most capable" },
  { id: "sonnet", label: "Sonnet", hint: "fast and smart" },
  { id: "haiku", label: "Haiku", hint: "fastest" },
];
const EFFORTS = [
  { id: "low", label: "Low" }, { id: "medium", label: "Medium" }, { id: "high", label: "High" }, { id: "max", label: "Max" },
];
const MODES = [
  { id: "agent", label: "Agent", hint: "edits; asks before commands" },
  { id: "auto", label: "Auto", hint: "edits and runs commands freely" },
  { id: "plan", label: "Plan", hint: "a plan first, no changes" },
  { id: "ask", label: "Ask", hint: "answers only" },
];
const TEAM_SIZES = [2, 3, 4, 5];

const READ_TOOLS = ["Read", "Grep", "Glob"];
const AGENT_TOOLS = ["Read", "Grep", "Glob", "Edit", "Write", "NotebookEdit", "Bash", "WebSearch", "WebFetch"];
const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);   // Claude Code's tool for starting a helper agent

const FORMAT =
  " When a decision is really the user's (several reasonable approaches, unclear requirements), ask with " +
  "AskUserQuestion: short options, recommended one first. Don't ask about things you can find out yourself." +
  " Format answers in Markdown. Use a Markdown table (with a header row and a |---| separator row, each row on " +
  "its own line) whenever you compare things or list values with properties, e.g. parameters and their defaults.";

const PROMPTS = {
  ask:
    "You are the chat assistant inside the Kural code editor, in Ask mode: you can read files in the user's " +
    "project (Read, Grep, Glob) but not edit them. When you suggest a code change, put it in a fenced code block " +
    "whose info string is the language followed by path=<file path relative to the project>, e.g. ```python path=src/app.py " +
    "— the user can click Apply to merge it into that file and review it. For long files show only the changed parts, " +
    "marking skipped code with a comment like '... existing code ...'. Be concise; explain the why before the code." + FORMAT,
  plan:
    "You are the planner inside the Kural code editor, in Plan mode: you can read the project (Read, Grep, Glob) " +
    "but must not change anything. Investigate what's needed, then reply with a short plan: a one-sentence goal, " +
    "then numbered steps, each naming the file(s) it touches and what changes there, then risks or open questions. " +
    "Don't write the full code. The user will click 'Build it' to have an agent carry out your plan." + FORMAT,
  agent:
    "You are the agent inside the Kural code editor: make the changes the user asks for directly with your tools " +
    "(Edit, Write, Bash, ...). The user sees every file you change and can review, keep or undo each one. Don't paste " +
    "whole files into the chat; change them. When you're done, summarize briefly what you changed and why. Be concise." + FORMAT,
};
PROMPTS.auto = PROMPTS.agent;

// Agent team: one lead splits the work and runs N helpers at the same time.
// Agent team: the model you picked leads; it splits the work and runs N agents of the same
// model at once. The agents are named after the Friends cast and can message each other
// through a small shared board (lib/team-mcp.js).
const FRIENDS = ["Rachel", "Ross", "Monica", "Chandler", "Joey", "Phoebe"];
const TEAM_TOOLS = ["mcp__team__post", "mcp__team__read"];
// Moods: how the chat (or the team's lead) works with you.
const MOODS = [
  { id: "default", label: "Default", hint: "balanced" },
  { id: "explorer", label: "Explorer", hint: "looks around, compares options" },
  { id: "critic", label: "Critic", hint: "questions it, finds flaws" },
  { id: "teacher", label: "Teacher", hint: "explains the why" },
];
const MOOD_PROMPTS = {
  explorer: "\n\nMood: Explorer. Be curious. Look beyond the obvious spot in the code, consider two or three approaches " +
    "and their trade-offs before choosing, and briefly mention anything interesting you notice on the way.",
  critic: "\n\nMood: Critic. Be a demanding reviewer. Question assumptions (including the user's), look for bugs, risks " +
    "and edge cases, and push back plainly when something is a bad idea. Prefer the simpler, safer option and say why.",
  teacher: "\n\nMood: Teacher. The user is learning. Explain the why before the how, in plain words, and after a change " +
    "say what each part does. Keep it short and point out mistakes kindly but clearly.",
};

// Roles you can give the agents in a team (pick several).
const ROLES = [
  { id: "developer", label: "Developer", desc: "builds it",
    duty: "You build. Propose concrete solutions and implement them. Defend your design with reasons, but change it when a " +
      "teammate shows a real problem. Answer every point a teammate raises: fix it, or explain with evidence why not." },
  { id: "tester", label: "Tester", desc: "tries to break it",
    duty: "You try to break things. Think of edge cases and failure modes first. Write and RUN tests and report results with " +
      "exact inputs, expected and actual output. Never accept 'it works' without a test result. Every time you reply, add at " +
      "least one case or risk the others missed." },
  { id: "researcher", label: "Researcher", desc: "brings the facts",
    duty: "You bring facts. Check the code, docs and other sources before anyone assumes; quote file:line or the source. " +
      "Correct any claim that doesn't match the evidence, even the lead's. You don't change code." },
  { id: "debugger", label: "Debugger", desc: "finds root causes",
    duty: "You find root causes. Reproduce the problem, trace it to the exact line, and prove it (output, logs, a minimal " +
      "reproduction). Challenge fixes that hide the symptom instead of fixing the cause." },
  { id: "critic", label: "Critic", desc: "finds what's wrong",
    duty: "You are the devil's advocate: find what's wrong — bugs, risks, hidden costs, a simpler alternative. Attack the " +
      "strongest proposal, not a weak one. Raise at least two concrete objections (with evidence) before you may agree, and " +
      "agree only when they are really answered. Agreeing easily means failing your role." },
  { id: "explorer", label: "Explorer", desc: "widens the options",
    duty: "You widen the options. Before the team settles, bring at least one approach nobody proposed and compare it " +
      "honestly (pros, cons, cost). Look in other parts of the codebase for patterns to reuse." },
];
const TEAM_STYLES = [
  { id: "split", label: "Split the work", hint: "work in parallel" },
  { id: "discuss", label: "Discuss & decide", hint: "talk it through, agree" },
];

// The team: who's who ("Rachel, the Developer (writes …)").
function teamMembers(n, roles) {
  return FRIENDS.slice(0, n).map((name, i) => {
    const r = ROLES.find((x) => x.id === roles[i]);
    return { name, role: r ? r.label : null, desc: r ? r.desc : null };
  });
}
const who = (m) => m.role ? `${m.name}, the ${m.role} (${m.desc})` : m.name;
const opening = (m, team) => `"You are ${m.name}${m.role ? `, the ${m.role}` : ""}, on a team with ` +
  `${team.filter((x) => x !== m).map((x) => x.role ? `${x.name} (${x.role})` : x.name).join(", ")} and the lead."`;
const BOARD = `The team can talk: tell each agent it has two tools, mcp__team__post (send a message to a teammate by name, to ` +
  `"lead", or to "all") and mcp__team__read (read its messages; wait_seconds waits for a reply).`;

function teamPrompt(n, roles = [], style = "split") {
  const team = teamMembers(n, roles);
  const brief = (m) => `${opening(m, team).slice(0, -1)}${m.role ? ` Your role — ${m.role}: ${ROLES.find((r) => r.label === m.role).duty}` : ""}"`;
  const starts = `Start all of them at once — put the Task tool calls in ONE message, subagent_type "general-purpose", in this ` +
    `order. Begin each agent's Task prompt with its brief, word for word:\n${team.map((m) => `- ${m.name}: ${brief(m)}`).join("\n")}\n` +
    `Then add `;
  if (style === "discuss") {
    const first = team[0].name;
    return `\n\nYou moderate a discussion between ${n} agents: ${team.map(who).join("; ")}. The user wants a real debate ` +
      `where each agent argues from its own role, and then a decision. Copies of the same model tend to agree too fast; ` +
      `your rules exist to prevent that. ${starts}the full question and context, and these rules, word for word:\n` +
      `"1. First investigate on your own, from your role (read the code, run things if useful). Form your own position ` +
      `BEFORE reading your teammates' messages.\n` +
      `2. Round 1: post your own position to "all" with mcp__team__post: your claim, your evidence (file:line, output), and ` +
      `what would change your mind. Then read the others' positions with mcp__team__read (wait_seconds 90) until you ` +
      `have one from every teammate.\n` +
      `3. Next rounds: answer the others point by point from your role. Say what you disagree with and why, with ` +
      `evidence. Agreement must be earned: name the exact concern that was answered. Don't repeat yourself: add ` +
      `something new or concede a point explicitly. Wait for replies with mcp__team__read (wait_seconds 90).\n` +
      `4. At least two rounds before any decision; at most four. ${first} then posts to "all": "DECISION: … / Agreed by: … / ` +
      `Still disagrees: … (why)". If you couldn't agree, ${first} makes the best call and records the dissent honestly.\n` +
      `5. After the DECISION, don't wait for more messages: finish right away by reporting your final position, ` +
      `whether you agree with the decision, and why.\n` +
      `6. Don't change files during the discussion` + (roles.includes("developer") ? ` (only if the user asked the team to ` +
        `also carry out the decision: the Developer does it after the DECISION)` : ``) + `."\n` +
      `${BOARD} Refer to the agents by name. Don't take part and don't post progress updates. When all have reported, give ` +
      `the user: the decision; each agent's final position in one line (name, role, agree or not, the main reason); the ` +
      `main point of disagreement and how it was settled; and any remaining dissent. Don't smooth over disagreement.`;
  }
  const flow = roles.length ? `\nThey work as a team, by role, with hand-offs:\n` +
    `- At the start each agent posts to "all" what it will do (one line).\n` +
    `- Whoever produces something (code, a finding, a fix) tells the teammates who check it, by name, when it's ready.\n` +
    `- Checkers (Tester, Critic, Debugger, Researcher) wait for that with mcp__team__read (wait_seconds 120), then check ` +
    `the actual result — run the tests, read the real diff, verify the claim — and send concrete findings back to the ` +
    `author. They don't just approve: each sends at least one finding or test result.\n` +
    `- Authors answer every finding (fix it, or explain why not) and tell the checker when it's done. At most two review ` +
    `rounds. Nobody finishes until the checker has replied "OK" or two rounds have passed.\n` +
    `- Each agent's final report: what it did, what its teammates found in its work, and what's still open.` : "";
  return `\n\nYou lead a team of ${n} agents: ${team.map(who).join("; ")}. Your goal is to finish the user's task ` +
    (roles.length ? `well and fast, with every agent doing its own role. ` : `as FAST as possible by working in parallel. `) +
    `Split it into parts${roles.length ? ` that fit each agent's role` : ` (by file or feature)`}, so two agents never edit ` +
    `the same file. ${starts}a complete, self-contained description of its part (files, goal, constraints)` +
    (roles.length ? ` and the team rules below, word for word.` : `.`) + flow + `\n` +
    `${BOARD} Agents should use them whenever their work depends on each other — agree on shared names and interfaces, ask ` +
    `a question and wait for the answer, tell others when something they need is ready. You can use them too, as "lead".\n` +
    `Refer to the agents by name. Don't do their parts yourself. While they work, don't post progress updates; reply ` +
    `once, when all have reported back: check the results, fix gaps, and give the user a short summary` +
    (roles.length ? ` — what each agent did and what they found in each other's work. The user picked these roles on ` +
      `purpose: always use every agent in its role, even for a small task.` : `. Only for a tiny task (one quick edit or a ` +
      `question) work alone.`);
}

const MAX_INLINE = 60000;       // files bigger than this are read by Claude instead of pasted in
const STORE_KEY = "kural.chat.v4";
const LAST_KEY = "kural.chat.last";   // your last model / intensity / mode / team, for new tabs
const MAX_HISTORY = 100;

const cfg = () => vscode.workspace.getConfiguration("kural");
const shortId = () => Math.random().toString(36).slice(2, 9);
const valid = (list, v) => list.some((x) => x.id === v);

class ChatView {
  constructor(context, apply) {
    this.context = context;
    this.apply = apply;          // (code, uri) => Promise   (Apply button on code blocks)
    this.version = context.extension.packageJSON.version;
    this.view = null;
    this.ready = false;
    this.queue = [];
    this.tabs = [];              // open tabs; see newTab() for the shape
    this.history = [];           // closed tabs (newest first)
    this.activeId = null;
    this.runtime = new Map();    // tabId -> { proc, turn, perms, procKey, agents }
    this.changes = new ChangeTracker();
    this.attachments = new Attachments();   // files added to the message you're writing
    this.setupVersion = 0;                  // goes up when your Claude Code setup changes
    this.lastEditor = vscode.window.activeTextEditor;
    this.lastSelection = null;   // for turning pasted code into a "main.py (L3-9)" reference
    this.files = null;
    this.load();
  }

  register() {
    const c = this.context;
    this.changes.register(c);
    watchFontScale(c, (m) => this.view && this.view.webview.postMessage(m));
    watchSetup(c, () => ws.folders().map((f) => f.path), () => { if (cfg().get("chat.fullClaudeCodeSetup")) this.setupChanged("changed"); });
    let lastFocusReload = Date.now();
    c.subscriptions.push(vscode.window.onDidChangeWindowState((st) => {
      if (!st.focused || !cfg().get("chat.fullClaudeCodeSetup") || Date.now() - lastFocusReload < 60000) return;
      lastFocusReload = Date.now();
      this.setupChanged("may have changed while you were away");
    }));
    const refreshFiles = debounce(() => { this.files = null; if (this.ready) this.sendFiles(); }, 1500);
    const watcher = vscode.workspace.createFileSystemWatcher("**/*", false, true, false);
    watcher.onDidCreate(refreshFiles); watcher.onDidDelete(refreshFiles);
    c.subscriptions.push(
      watcher,
      vscode.window.registerWebviewViewProvider("kural.chat", this, { webviewOptions: { retainContextWhenHidden: true } }),
      vscode.window.onDidChangeActiveTextEditor((ed) => { if (ed) { this.lastEditor = ed; this.postActive(); } }),
      // A folder added to (or removed from) the workspace: Claude gets access on its next start,
      // and @ mentions list its files.
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.files = null;
        if (this.ready) this.sendFiles();
        for (const t of this.tabs) { const r = this.runtime.get(t.id); if (r && r.proc && t.status === "idle") this.warm(t); }
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        const s = e.selections[0];
        if (s && !s.isEmpty && e.textEditor.document.uri.scheme === "file") this.lastSelection = { doc: e.textEditor.document, range: new vscode.Range(s.start, s.end) };
      }),
      vscode.commands.registerCommand("kural.chat.open", () => this.open()),
      vscode.commands.registerCommand("kural.chat.newTab", () => { this.reveal(); this.newTab(true); }),
      vscode.commands.registerCommand("kural.chat.nextTab", () => this.cycle(1)),
      vscode.commands.registerCommand("kural.chat.prevTab", () => this.cycle(-1)),
      vscode.commands.registerCommand("kural.chat.closeTab", () => this.closeTab(this.activeId)),
      vscode.commands.registerCommand("kural.reloadSetup", () => this.setupChanged("reload asked for")),
      vscode.commands.registerCommand("kural.chat.attach", async () => { this.reveal(); await this.onMessage({ type: "attachPick" }); }),
      // Keyboard shortcuts while the chat has focus (Ctrl+S model, Ctrl+M/H/O intensity, Ctrl+P plan).
      vscode.commands.registerCommand("kural.chat.nextModel", () => this.shortcut((t) => {
        const i = MODELS.findIndex((x) => x.id === t.model);
        const next = MODELS[(i + 1) % MODELS.length];
        return [{ type: "setModel", model: next.id }, next.label];
      })),
      ...["medium", "high", "max"].map((e) => vscode.commands.registerCommand(`kural.chat.effort${e[0].toUpperCase()}${e.slice(1)}`,
        () => this.shortcut(() => [{ type: "setEffort", effort: e }, `Intensity: ${EFFORTS.find((x) => x.id === e).label}`]))),
      vscode.commands.registerCommand("kural.chat.togglePlan", () => this.shortcut((t) => {
        if (t.mode === "plan") return [{ type: "setMode", mode: t.prevMode && t.prevMode !== "plan" ? t.prevMode : "agent" }, null];
        t.prevMode = t.mode;
        return [{ type: "setMode", mode: "plan" }, null];
      })),
      vscode.commands.registerCommand("kural.chat.history", async () => { await this.reveal(); this.post({ type: "showHistory" }); }),
      { dispose: () => { for (const r of this.runtime.values()) if (r.proc) r.proc.kill(); } },
    );
  }

  // ---------- your last choices, for new tabs ----------
  lastChoices() {
    const last = this.context.globalState.get(LAST_KEY) || {};
    return {
      model: valid(MODELS, last.model) ? last.model : (valid(MODELS, cfg().get("chat.model")) ? cfg().get("chat.model") : "sonnet"),
      effort: valid(EFFORTS, last.effort) ? last.effort : (valid(EFFORTS, cfg().get("chat.intensity")) ? cfg().get("chat.intensity") : "medium"),
      mode: valid(MODES, last.mode) ? last.mode : (valid(MODES, cfg().get("chat.mode")) ? cfg().get("chat.mode") : "agent"),
      team: TEAM_SIZES.includes(last.team) ? last.team : 0,
      mood: valid(MOODS, last.mood) ? last.mood : "default",
      roles: Array.isArray(last.roles) ? last.roles.filter((r) => valid(ROLES, r)) : [],
      teamStyle: valid(TEAM_STYLES, last.teamStyle) ? last.teamStyle : "split",
    };
  }

  remember(tab) {
    const prev = this.context.globalState.get(LAST_KEY) || {};
    this.context.globalState.update(LAST_KEY, { ...prev, model: tab.model, effort: tab.effort, mode: tab.mode, team: tab.team || 0,
      mood: tab.mood, roles: tab.roles, teamStyle: tab.teamStyle });
  }

  // Old saved tabs may lack a field or hold one that no longer exists ("undefined" in the menu).
  fix(tab) {
    const d = this.lastChoices();
    if (!valid(MODELS, tab.model)) tab.model = d.model;
    if (!valid(EFFORTS, tab.effort)) tab.effort = d.effort;
    if (!valid(MODES, tab.mode)) tab.mode = d.mode;
    if (!TEAM_SIZES.includes(tab.team)) tab.team = 0;
    if (!valid(MOODS, tab.mood)) tab.mood = d.mood;
    if (!Array.isArray(tab.roles)) tab.roles = d.roles;
    tab.roles = tab.roles.filter((r) => valid(ROLES, r));
    if (!valid(TEAM_STYLES, tab.teamStyle)) tab.teamStyle = d.teamStyle;
    tab.createdAt = tab.createdAt || Date.now();
    tab.updatedAt = tab.updatedAt || tab.createdAt;
    return tab;
  }

  // ---------- tabs ----------
  newTab(activate) {
    // An empty chat is already there: use it instead of piling up empty tabs.
    const blank = activate && this.tabs.find((t) => !t.messages.length && t.status === "idle");
    if (blank) { Object.assign(blank, this.lastChoices()); this.activate(blank.id); return blank; }
    const d = this.lastChoices();
    const tab = {
      id: shortId(), title: "New chat", renamed: false,
      model: d.model, effort: d.effort, mode: d.mode, team: d.team, mood: d.mood, roles: d.roles, teamStyle: d.teamStyle,
      sessionId: newSessionId(), started: false,
      messages: [], status: "idle", unread: false, allowAll: false, modelName: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    this.tabs.push(tab);
    if (activate) this.activate(tab.id); else this.postTabs();
    this.save();
    return tab;
  }

  tab(id) { return this.tabs.find((t) => t.id === id); }
  active() { return this.tab(this.activeId); }

  activate(id) {
    const tab = this.tab(id);
    if (!tab) return;
    this.activeId = id;
    tab.unread = false;
    this.post({ type: "full", tab: this.viewTab(tab) });
    this.postTabs();
    if (tab.setup) this.post({ type: "setup", tabId: tab.id, setup: tab.setup });
    this.warm(tab);
    this.save();
  }

  cycle(dir) {
    if (!this.tabs.length) return;
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    this.activate(this.tabs[(i + dir + this.tabs.length) % this.tabs.length].id);
  }

  // Closing a tab keeps it in History (clock button), unless it was never used.
  closeTab(id) {
    const tab = this.tab(id);
    if (!tab) return;
    const r = this.runtime.get(id);
    if (r && r.proc) { r.stale = true; r.proc.kill(); }
    this.runtime.delete(id);
    const i = this.tabs.indexOf(tab);
    this.tabs.splice(i, 1);
    if (tab.messages.length) {
      this.history.unshift({ ...tab, status: "idle", closedAt: Date.now() });
      this.history = this.history.slice(0, MAX_HISTORY);
    }
    if (!this.tabs.length) this.newTab(true);
    else if (this.activeId === id) this.activate(this.tabs[Math.max(0, i - 1)].id);
    else this.postTabs();
    this.postHistory();
    this.save();
  }

  // Reopen a chat from History; Claude continues the same conversation.
  reopen(id) {
    const open = this.tab(id);
    if (open) { this.activate(id); return; }
    const i = this.history.findIndex((h) => h.id === id);
    if (i < 0) return;
    const [tab] = this.history.splice(i, 1);
    delete tab.closedAt;
    this.fix(tab);
    // A fresh, unused tab gets replaced instead of piling up.
    const blank = this.tabs.find((t) => !t.messages.length && t.status === "idle");
    if (blank) this.tabs.splice(this.tabs.indexOf(blank), 1, tab); else this.tabs.push(tab);
    this.activate(tab.id);
    this.postHistory();
    this.save();
  }

  rename(id, title) {
    const t = this.tab(id) || this.history.find((h) => h.id === id);
    if (!t) return;
    const clean = String(title || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!clean) return;
    t.title = clean; t.renamed = true;
    this.postTabs(); this.postHistory(); this.save();
  }

  summary(t) { return { id: t.id, title: t.title, status: t.status, unread: t.unread, model: t.model, effort: t.effort, mode: t.mode, team: t.team || 0,
    mood: t.mood, roles: t.roles || [], teamStyle: t.teamStyle, teamSize: this.teamSize(t) }; }
  viewTab(t) { return { ...this.summary(t), messages: t.messages, modelName: t.modelName, allowAll: t.allowAll }; }
  postTabs() { this.post({ type: "tabs", tabs: this.tabs.map((t) => this.summary(t)), activeId: this.activeId }); }

  postHistory() {
    const item = (t, open) => {
      const firstUser = t.messages.find((m) => m.role === "user");
      const preview = firstUser ? ChatView.titleOf(firstUser.segments || []).slice(0, 90) : "";
      return { id: t.id, title: t.title, open, model: t.model, mode: t.mode, when: t.updatedAt || t.createdAt,
        count: t.messages.filter((m) => m.role === "user").length, preview };
    };
    this.post({ type: "history", items: [...this.tabs.filter((t) => t.messages.length).map((t) => item(t, true)), ...this.history.map((t) => item(t, false))]
      .sort((a, b) => b.when - a.when) });
  }

  // ---------- saving across restarts ----------
  load() {
    const saved = this.context.workspaceState.get(STORE_KEY) || this.context.workspaceState.get("kural.chat.v3");
    const clean = (t) => {
      this.fix(t);
      t.status = "idle"; t.pendingModel = false; delete t.worktree;
      for (const m of t.messages) if (m.role === "assistant") {
        if (m.running) { m.running = false; m.error = m.error || "stopped"; }
        for (const b of m.blocks || []) {
          if (b.k === "perm" && b.state === "pending") b.state = "denied";
          if (b.k === "question" && b.state === "pending") b.state = "skipped";
        }
      }
      return t;
    };
    this.history = saved && Array.isArray(saved.history) ? saved.history.map(clean) : [];
    if (saved && Array.isArray(saved.tabs) && saved.tabs.length) {
      this.tabs = saved.tabs.map(clean);
      this.activeId = this.tab(saved.activeId) ? saved.activeId : this.tabs[0].id;
    } else {
      this.tabs = [];
      const t = this.newTab(false);
      this.activeId = t.id;
    }
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      // Keep the last ~150 KB of each conversation (60 KB for closed ones) so this stays quick.
      const trim = (t, max) => {
        let msgs = t.messages, size = JSON.stringify(msgs).length;
        while (size > max && msgs.length > 2) { msgs = msgs.slice(2); size = JSON.stringify(msgs).length; }
        return { ...t, messages: msgs, status: "idle" };
      };
      this.context.workspaceState.update(STORE_KEY, {
        tabs: this.tabs.map((t) => trim(t, 150000)), history: this.history.map((t) => trim(t, 60000)), activeId: this.activeId,
      });
    }, 800);
  }

  // ---------- the panel ----------
  resolveWebviewView(view) {
    this.view = view;
    this.ready = false;
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = shortId() + shortId();
    const uri = (f) => view.webview.asWebviewUri(vscode.Uri.joinPath(media, f));
    view.webview.html = `<!doctype html><html data-fs="${fontScale()}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${view.webview.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${uri("chat.css")}"></head>
<body><div id="app"><div class="booting">Starting Kural chat…</div></div><script nonce="${nonce}" src="${uri("chat.js")}"></script></body></html>`;
    view.webview.onDidReceiveMessage((m) => this.onMessage(m).catch((e) => log(`chat: ${e.stack}`)));
    view.onDidDispose(() => { this.view = null; this.ready = false; });
  }

  reveal() { return vscode.commands.executeCommand("kural.chat.focus"); }

  post(msg) { if (this.view && this.ready) this.view.webview.postMessage(msg); else this.queue.push(msg); }

  postActive() {
    const ed = this.lastEditor;
    if (!ed || ed.document.uri.scheme !== "file") return this.post({ type: "activeFile", file: null });
    this.post({ type: "activeFile", file: { path: vscode.workspace.asRelativePath(ed.document.uri), name: path.basename(ed.document.uri.fsPath) } });
  }

  async sendFiles() {
    if (!this.files) {
      const uris = await vscode.workspace.findFiles("**/*", "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/__pycache__/**,**/.venv/**,**/venv/**,**/.mypy_cache/**,**/.pytest_cache/**}", 20000);
      this.files = uris.map((u) => vscode.workspace.asRelativePath(u)).sort();
    }
    this.post({ type: "files", files: this.files });
  }

  selectionCtx(doc, range) {
    const endLine = range.end.character === 0 && range.end.line > range.start.line ? range.end.line - 1 : range.end.line;
    const code = doc.getText(new vscode.Range(range.start.line, 0, endLine, doc.lineAt(endLine).text.length));
    return { kind: "selection", path: vscode.workspace.asRelativePath(doc.uri), lang: doc.languageId, startLine: range.start.line + 1, endLine: endLine + 1, code };
  }

  // Ctrl+L: open the chat; with code selected, put "file (L10-20)" into your message.
  async open() {
    const ed = vscode.window.activeTextEditor || this.lastEditor;
    const sel = ed && !ed.selection.isEmpty ? this.selectionCtx(ed.document, ed.selection) : null;
    await this.reveal();
    if (sel) this.post({ type: "insertPill", ctx: sel });
    this.post({ type: "focus" });
  }

  // ---------- Claude process per tab ----------
  // How many agents this tab's team has (0 = no team). Splitting work needs a mode that can edit;
  // a discussion works in every mode. With roles picked, one agent per role.
  teamSize(tab) {
    if (!(tab.team > 1)) return 0;
    const editing = tab.mode === "agent" || tab.mode === "auto";
    if (tab.teamStyle !== "discuss" && !editing) return 0;
    const roles = tab.roles || [];
    return roles.length ? Math.min(FRIENDS.length, Math.max(2, roles.length)) : tab.team;
  }
  // When this changes, the tab's Claude restarts (same conversation) before your next message.
  procKey(tab) { return `${tab.mode}|${tab.effort}|${this.teamSize(tab)}|${tab.mood}|${(tab.roles || []).join(",")}|${tab.teamStyle}|${cfg().get("chat.fullClaudeCodeSetup")}|${ws.key()}|${this.setupVersion}`; }

  // Your Claude Code setup changed (a connector or MCP server added, a plugin, a skill…), or you
  // came back to Kural (connectors added on claude.ai don't leave a file to watch): reload
  // Claude for the open chat now, in the same conversation; other chats reload when you use them.
  setupChanged(why) {
    this.setupVersion++;
    log(`chat: Claude Code setup ${why}; Claude reloads in the same conversation when it's not busy`);
    const t = this.active();
    const r = t && this.runtime.get(t.id);
    if (t && r && r.proc && t.status === "idle") this.warm(t);
  }

  root() { return ws.root(); }

  // Start the tab's Claude process ahead of time, so your first message is answered quickly.
  warm(tab) {
    if (!findClaude()) return;
    const r = this.runtime.get(tab.id);
    if (r && r.proc && !r.proc.exited && r.procKey === this.procKey(tab)) return;
    if (r && r.turn && r.turn.reply.running) return;   // never restart in the middle of an answer
    if (r && [...r.agents.values()].some((a) => a.state === "running")) return;   // … or while agents still work
    this.startProc(tab);
  }

  startProc(tab, fresh = false) {
    const old = this.runtime.get(tab.id);
    if (old && old.proc) { old.stale = true; old.proc.kill(); }
    const full = cfg().get("chat.fullClaudeCodeSetup");
    const instr = full ? { text: "", files: [] } : projectInstructions(this.root());
    const editing = tab.mode === "agent" || tab.mode === "auto";
    const team = this.teamSize(tab);
    const r = { proc: null, turn: null, perms: new Map(), procKey: this.procKey(tab), gotOutput: false, started: Date.now(), agents: new Map(), tasks: new Map() };
    if (fresh) { tab.sessionId = newSessionId(); tab.started = false; }
    // Every mode can ask you a multiple-choice question (AskUserQuestion), shown as a card.
    // With your full setup, Claude can also use your skills.
    const tools = [...(editing ? AGENT_TOOLS : READ_TOOLS), ...(team ? ["Task"] : []), "AskUserQuestion", ...(full ? ["Skill"] : [])];
    const proc = new ClaudeProcess({
      name: `chat ${tab.id}`, model: tab.model, effort: tab.effort, partial: true, showThinking: true,
      safeMode: !full, appendSystemPrompt: PROMPTS[tab.mode] + (MOOD_PROMPTS[tab.mood] || "") +
        (team ? teamPrompt(team, tab.roles || [], tab.teamStyle) : "") + ws.promptNote() + instr.text,
      addDirs: ws.extraDirs(),
      tools, allowedTools: [...(editing ? ["Read", "Grep", "Glob", "WebSearch"] : READ_TOOLS), ...(team ? ["Task", "Agent", ...TEAM_TOOLS] : []), ...(full ? ["Skill"] : [])],
      mcpServers: team ? { team: teamServer() } : null,
      strictMcp: !full,     // full setup: your MCP servers and claude.ai connectors too
      hostPermissions: true, cwd: this.root(), persist: true,
      resume: tab.started ? tab.sessionId : null, sessionId: tab.started ? null : tab.sessionId,
    }, {
      onMessage: (m) => { if (r.stale) return; r.gotOutput = true; this.onClaude(tab, r, m); },
      onPermission: (req) => r.stale ? { allow: false, message: "Stopped." } : this.onPermission(tab, r, req),
      onExit: (info) => this.onExit(tab, r, info),
    });
    r.proc = proc;
    this.runtime.set(tab.id, r);
    if (!proc.start()) { r.proc = null; return null; }
    // Ask which connectors / MCP servers it has (they connect in the background, so twice).
    if (full) for (const ms of [1500, 7000]) setTimeout(() => { if (!r.stale && r.proc) this.checkServers(tab, r); }, ms);
    if (instr.files.length) log(`chat ${tab.id}: using instructions from ${instr.files.join(", ")}`);
    return r;
  }

  onExit(tab, r, info) {
    if (r.stale || this.runtime.get(tab.id) !== r) return;
    const last = tab.messages[tab.messages.length - 1];
    // A saved conversation that can't be reopened: start a new one and carry on.
    if (tab.started && !r.gotOutput && Date.now() - r.started < 15000 && /no conversation|not found|session/i.test(info.stderr)) {
      log(`chat ${tab.id}: couldn't reopen the saved conversation; starting a fresh one`);
      tab.started = false;
      const pending = r.pendingSend;
      const nr = this.startProc(tab, true);
      if (nr && pending) { nr.pendingSend = pending; nr.turn = r.turn; nr.proc.send(pending); }
      return;
    }
    r.proc = null;
    if (last && last.role === "assistant" && last.running) {
      last.running = false;
      last.error = info.login ? "login" : "Claude stopped unexpectedly. See View → Output → Kural.";
      tab.status = "idle";
      this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(last) });
      this.postTabs(); this.save();
    }
  }

  // ---------- sending ----------
  async buildPrompt(text, contexts) {
    const parts = [];
    const seen = new Set();
    for (const c of contexts) {
      const key = JSON.stringify([c.kind, c.path, c.startLine, c.endLine]);
      if (seen.has(key)) continue; seen.add(key);
      if (c.kind === "selection") {
        parts.push(`${c.path} (lines ${c.startLine}-${c.endLine}):\n\`\`\`${c.lang || ""}\n${c.code}\n\`\`\``);
      } else if (c.kind === "file" || c.kind === "current") {
        const uri = this.resolvePath(c.path);
        let body = null;
        try { body = await this.readText(uri); } catch { /* unreadable: let Claude try */ }
        const label = c.kind === "current" ? `The file I have open: ${c.path}` : `${c.path}:`;
        parts.push(body != null && body.length <= MAX_INLINE
          ? `${label}\n\`\`\`${path.extname(c.path).slice(1)} path=${c.path}\n${body}\n\`\`\``
          : `${label} (large — read it with your tools if you need it)`);
      }
    }
    return parts.length ? `<context>\n${parts.join("\n\n")}\n</context>\n\n${text}` : text;
  }

  // What you typed, with pills written as @main.py or @main.py (L3-9).
  static textOf(segments) {
    return segments.map((s) => s.t === "text" ? s.v : `@${s.ctx.path}${s.ctx.kind === "selection" ? ` (L${s.ctx.startLine}-${s.ctx.endLine})` : ""}`).join("");
  }

  // A tab title from your first message; pills read as "main.py (L3-9)".
  static titleOf(segments) {
    return segments.map((s) => s.t === "text" ? s.v : `${path.basename(s.ctx.path)}${s.ctx.kind === "selection" ? ` (L${s.ctx.startLine}-${s.ctx.endLine})` : ""}`)
      .join("").replace(/\s+/g, " ").trim().slice(0, 40);
  }

  async send(tab, segments, contexts, attachIds = []) {
    let text = ChatView.textOf(segments).trim();
    if (!text && !attachIds.length) return;
    if (tab.status !== "idle") return;
    if (!text) { text = "Have a look at what I attached."; segments = [{ t: "text", v: text }]; }
    if (tab.title === "New chat" && !tab.renamed) tab.title = ChatView.titleOf(segments);
    const user = { role: "user", segments, mode: tab.mode, contexts: contexts.filter((c) => c.kind === "current").map((c) => ({ kind: c.kind, path: c.path, name: c.name })) };
    const reply = { role: "assistant", blocks: [], running: true, t0: Date.now(), mode: tab.mode, team: this.teamSize(tab), teamStyle: tab.teamStyle };
    tab.messages.push(user, reply);
    tab.status = "running";
    tab.updatedAt = Date.now();
    this.post({ type: "append", tabId: tab.id, msgs: [user, reply] });
    this.postTabs();

    let r = this.runtime.get(tab.id);
    if (!r || !r.proc || r.proc.exited || r.procKey !== this.procKey(tab)) r = this.startProc(tab);
    if (!r) { reply.running = false; reply.error = "missing"; tab.status = "idle"; this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) }); this.postTabs(); vscode.commands.executeCommand("kural.install"); return; }
    if (tab.pendingModel) { r.proc.setModel(tab.model); tab.pendingModel = false; }
    r.turn = { snaps: {}, reply };
    r.agents = new Map();   // Task call id -> agent card
    r.turnStartAt = Date.now(); r.lastNotifyAt = 0; r.betweenTurns = false; r.concluded = false;
    r.tasks = new Map();    // Claude's task id -> Task call id (team members' permission requests carry the task id)
    const { content: prompt, meta } = this.attachments.content(await this.buildPrompt(text, contexts), attachIds);
    if (meta.length) { user.attachments = meta; this.post({ type: "userAttachments", tabId: tab.id, attachments: meta }); }
    r.pendingSend = prompt;
    r.proc.send(prompt);
    log(`chat ${tab.id}: sent (${JSON.stringify(prompt).length} chars, ${contexts.length} context items, ${meta.length} attachments, ${tab.model}/${tab.effort}, ${tab.mode}${reply.team ? `, team of ${reply.team}` : ""})`);
    this.save();
  }

  // "Build it" under a plan: switch to Agent (or Auto, if you last used it) and carry the plan out.
  async buildPlan(tab) {
    if (tab.status !== "idle") return;
    const last = this.context.globalState.get(LAST_KEY) || {};
    tab.mode = last.buildMode === "auto" ? "auto" : "agent";
    this.postTabs();
    await this.send(tab, [{ t: "text", v: "Go ahead and implement the plan above." }], []);
  }

  // ---------- Claude's output ----------
  onClaude(tab, r, m) {
    const turn = r.turn;
    const reply = turn && turn.reply;
    if (m.type === "system" && m.subtype === "init" && m.model) {
      tab.modelName = prettyModel(m.model);
      if (tab.id === this.activeId) this.post({ type: "modelName", tabId: tab.id, name: tab.modelName });
      this.noteSetup(tab, r, m);
      return;
    }
    if (!reply) return;
    // Team members: Claude reports each one's start and end as system events, keyed by the Task call.
    // With Opus they often run in the background: the lead's turn ends ("result") while they keep
    // working, and Claude starts a new lead turn as each one reports back. So the answer stays open
    // until every agent is finished.
    if (m.type === "system" && /^task_/.test(m.subtype || "")) {
      const a = m.tool_use_id && r.agents.get(m.tool_use_id);
      if (m.subtype === "task_started" && m.task_id && m.tool_use_id) r.tasks.set(m.task_id, m.tool_use_id);
      const end = m.subtype === "task_notification" ? m.status : m.subtype === "task_updated" && m.patch ? m.patch.status : null;
      if (m.subtype === "task_notification") r.lastNotifyAt = Date.now();
      const owner = a || (m.task_id && r.agents.get(r.tasks.get(m.task_id)));
      // What the agent is doing right now ("Running the tests"), shown on its card.
      if (m.subtype === "task_progress" && owner && owner.state === "running" && m.description) {
        owner.activity = String(m.description).replace(/^Running /, "");
        this.post({ type: "agentActivity", tabId: tab.id, agentId: owner.id, activity: owner.activity });
      }
      const END = { completed: "done", failed: "failed", error: "failed", killed: "stopped", stopped: "stopped", cancelled: "stopped", canceled: "stopped" };
      if (end && !END[end] && end !== "running" && end !== "pending") log(`chat ${tab.id}: agent status "${end}" (still counted as working)`);
      if (owner && owner.state === "running" && END[end]) {
        owner.state = END[end];
        if (reply && (reply.waitingFor || []).length) {
          reply.waitingFor = reply.waitingFor.filter((n) => n !== (owner.name || `Agent ${owner.n}`));
          this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) });
        }
        this.post({ type: "agentState", tabId: tab.id, agentId: owner.id, state: owner.state });
      }
      return;
    }
    // Messages from a team member carry the id of the Task call that started it.
    const parent = m.parent_tool_use_id || null;
    if (!parent && (m.type === "stream_event" || m.type === "assistant") && r.betweenTurns) {
      r.betweenTurns = false;               // the lead started another turn
      r.turnStartAt = Date.now();
      clearTimeout(r.idleTimer);
      if ((reply.waitingFor || []).length) { reply.waitingFor = []; this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) }); }
    }
    // The lead speaks again after the answer was closed (an agent reported back just as it finished):
    // reopen the same answer instead of gluing text onto a finished one.
    if (!parent && (m.type === "stream_event" || m.type === "assistant") && !reply.running && tab.status === "idle" && !r.stale) {
      reply.running = true;
      delete reply.error;
      tab.status = "running";
      r.turnStartAt = Date.now();
      const last = reply.blocks[reply.blocks.length - 1];
      if (last && last.k === "text" && !/\n\n$/.test(last.text)) last.text += "\n\n";
      this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) });
      this.postTabs();
    }
    if (m.type === "stream_event") {
      if (parent) return;   // helpers' own text stays inside their card; only the lead talks in the chat
      const e = m.event;
      // Claude's thinking, as short summaries (only when Claude Code supports --thinking-display).
      if (e.type === "content_block_start") r.blockType = e.content_block && e.content_block.type;
      if (e.type === "content_block_delta" && e.delta.type === "thinking_delta" && e.delta.thinking) {
        let last = reply.blocks[reply.blocks.length - 1];
        if (!last || last.k !== "think" || last.done) {
          last = { k: "think", text: "", t0: Date.now() };
          reply.blocks.push(last);
          this.post({ type: "block", tabId: tab.id, block: last });
        }
        last.text += e.delta.thinking;
        this.post({ type: "thinkDelta", tabId: tab.id, text: e.delta.thinking });
      }
      if (e.type === "content_block_stop" && r.blockType === "thinking") {
        const last = reply.blocks[reply.blocks.length - 1];
        if (last && last.k === "think" && !last.done) {
          last.done = true; last.ms = Date.now() - last.t0;
          this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) });
        }
      }
      if (m.event.type === "content_block_delta" && m.event.delta.type === "text_delta") {
        let last = reply.blocks[reply.blocks.length - 1];
        if (!last || last.k !== "text") { last = { k: "text", text: "" }; reply.blocks.push(last); }
        last.text += m.event.delta.text;
        this.post({ type: "delta", tabId: tab.id, text: m.event.delta.text });
      }
    } else if (m.type === "assistant") {
      // Show the model that's actually answering (it changes when you switch mid-answer).
      if (!parent && m.message.model) {
        const name = prettyModel(m.message.model);
        if (name !== tab.modelName) { tab.modelName = name; if (tab.id === this.activeId) this.post({ type: "modelName", tabId: tab.id, name }); }
      }
      const from = parent && r.agents.get(parent);
      for (const b of m.message.content || []) {
        // What an agent writes and thinks (needs --forward-subagent-text): into its card.
        if (from && (b.type === "text" || b.type === "thinking")) {
          const said = (b.type === "text" ? b.text : b.thinking || "").trim();
          if (!said) continue;
          const step = { k: b.type === "text" ? "say" : "think", text: said };
          from.steps.push(step);
          this.post({ type: "agentStep", tabId: tab.id, agentId: from.id, step });
          continue;
        }
        if (b.type !== "tool_use") continue;
        if (SUBAGENT_TOOLS.has(b.name)) {
          const n = r.agents.size + 1;
          const said = /\bYou are (\w+)(?:, the (\w+))?/.exec((b.input && b.input.prompt) || "");
          const name = said && FRIENDS.includes(said[1]) ? said[1] : FRIENDS[(n - 1) % FRIENDS.length];
          const role = said && said[2] && ROLES.some((x) => x.label === said[2]) ? said[2] : null;
          const block = { k: "agent", id: b.id, n, name, role, title: (b.input && b.input.description) || name, steps: [], state: "running" };
          r.agents.set(b.id, block);
          reply.blocks.push(block);
          this.post({ type: "block", tabId: tab.id, block });
          continue;
        }
        if (b.name === "AskUserQuestion") continue;   // shown as a question card instead
        const step = { k: "tool", name: b.name, detail: toolDetail(b.name, b.input, this.root()), id: b.id };
        const owner = parent && r.agents.get(parent);
        if (owner && b.name === "mcp__team__post") {
          // The agents' discussion: shown in the answer itself, in order, where you're reading
          // (inside the cards it ended up above the lead's text, out of sight).
          step.agent = owner.name; step.role = owner.role;
          reply.blocks.push(step);
          this.post({ type: "block", tabId: tab.id, block: step });
        } else if (owner) {
          owner.steps.push(step);
          this.post({ type: "agentStep", tabId: tab.id, agentId: owner.id, step });
        } else {
          reply.blocks.push(step);
          this.post({ type: "block", tabId: tab.id, block: step });
        }
      }
    } else if (m.type === "user" && !parent) {
      // A Task call that failed to start. (A finished agent is reported by task_notification;
      // a background agent's Task call returns at once with "Async agent launched".)
      for (const c of (m.message && Array.isArray(m.message.content) ? m.message.content : [])) {
        const a = c.type === "tool_result" && c.is_error && r.agents.get(c.tool_use_id);
        if (a && a.state === "running") { a.state = "failed"; this.post({ type: "agentState", tabId: tab.id, agentId: a.id, state: a.state }); }
      }
    } else if (m.type === "result") {
      r.pendingSend = null;
      const working = [...r.agents.values()].filter((a) => a.state === "running");
      // An agent that reported back during this turn wakes the lead once more.
      const wakeUp = r.lastNotifyAt > r.turnStartAt;
      if (working.length || (wakeUp && !m.is_error)) {
        // The lead paused while its team keeps working. Hold the answer open — only Stop ends it now —
        // and Claude wakes the lead as each agent reports back.
        r.betweenTurns = true;
        const last = reply.blocks[reply.blocks.length - 1];
        if (last && last.k === "text" && !/\n\n$/.test(last.text)) { last.text += "\n\n"; this.post({ type: "delta", tabId: tab.id, text: "\n\n" }); }
        reply.waitingFor = working.map((a) => a.name || `Agent ${a.n}`);
        this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) });
        log(`chat ${tab.id}: lead paused${m.is_error ? " (with an error)" : ""}; ${working.length ? `waiting for ${reply.waitingFor.join(", ")}` : "an agent just reported"}`);
        clearTimeout(r.idleTimer);
        if (!working.length) r.idleTimer = setTimeout(() => this.conclude(tab, r, reply, m), 5000);
        return;
      }
      if (r.agents.size && !r.concluded && m.is_error) {
        // The team finished but the lead's last turn failed: ask it for the conclusion.
        r.idleTimer = setTimeout(() => this.conclude(tab, r, reply, m), 500);
        return;
      }
      this.finishReply(tab, r, m);
    }
  }

  // Every agent has reported. Claude normally wakes the lead by itself; if it hasn't within a few
  // seconds, ask the lead for the conclusion, so it always reaches you.
  conclude(tab, r, reply, m) {
    if (!r.betweenTurns && !(m && m.is_error) || !r.turn || r.turn.reply !== reply || !reply.running || r.stale) return;
    if (r.concluded || !r.proc || r.proc.exited) { this.finishReply(tab, r, m); return; }
    r.concluded = true;
    r.betweenTurns = false;
    r.turnStartAt = Date.now();
    reply.waitingFor = [];
    log(`chat ${tab.id}: all agents reported; asking the lead for the conclusion`);
    r.proc.send("All of your agents have now reported back. Give me the final answer now: the result or decision, " +
      "why, and any disagreement that remains.");
  }

  // What Claude loaded from your setup: connectors / MCP servers, plugins, skills. Shown in the
  // model menu; a newly added connector is announced once.
  noteSetup(tab, r, m) {
    const prev = tab.setup || {};
    this.showSetup(tab, {
      servers: (m.mcp_servers || []).filter((x) => x.name !== "team").map((x) => ({ name: prettyServer(x.name), status: x.status })),
      plugins: (m.plugins || []).filter((x) => x.path !== "builtin").map((x) => x.name),
      skills: (m.skills || []).length || prev.skills || 0,
    });
  }

  async checkServers(tab, r) {
    const res = await r.proc.request({ subtype: "mcp_status" });
    if (!res || !Array.isArray(res.mcpServers) || r.stale) return;
    const prev = tab.setup || {};
    this.showSetup(tab, {
      servers: res.mcpServers.filter((x) => x.name !== "team").map((x) => ({ name: prettyServer(x.name), status: x.status, tools: (x.tools || []).length })),
      plugins: prev.plugins || [], skills: prev.skills || 0,
    });
  }

  showSetup(tab, setup) {
    setup.full = !!cfg().get("chat.fullClaudeCodeSetup");
    // Announce a connector that wasn't there before (not on the very first report).
    const known = tab.knownServers ? new Set(tab.knownServers) : null;
    const added = known ? setup.servers.filter((x) => x.status === "connected" && !known.has(x.name)).map((x) => x.name) : [];
    tab.knownServers = [...new Set([...(tab.knownServers || []), ...setup.servers.filter((x) => x.status === "connected").map((x) => x.name)])];
    tab.setup = setup;
    if (tab.id !== this.activeId) return;
    this.post({ type: "setup", tabId: tab.id, setup });
    if (added.length) this.post({ type: "flash", text: `Now connected: ${added.join(", ")}` });
  }

  // The answer is complete (or stopped): close it and tidy up.
  finishReply(tab, r, m) {
    const reply = r.turn.reply;
    reply.waitingFor = [];
    clearTimeout(r.idleTimer);
    r.betweenTurns = false;
    reply.running = false;
    reply.ms = Date.now() - reply.t0;
    tab.started = true;
    tab.updatedAt = Date.now();
    r.pendingSend = null;
    if (m.subtype === "error_during_execution") reply.error = "stopped";
    else if (m.is_error) reply.error = LOGIN_RE.test(m.result || "") ? "login" : (m.result || "Something went wrong.");
    for (const b of reply.blocks) {
      if (b.k === "perm" && b.state === "pending") b.state = "denied";
      if (b.k === "question" && b.state === "pending") b.state = "skipped";
      if (b.k === "agent" && b.state === "running") b.state = reply.error ? "stopped" : "done";
    }
    if (reply.mode === "plan" && !reply.error) reply.planReady = true;
    tab.status = "idle";
    if (tab.id !== this.activeId) tab.unread = true;
    this.finishTurn(tab, r);
    this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(reply) });
    this.postTabs(); this.save();
    // If you changed mode/intensity while it was answering, get the new setup ready now.
    if (r.procKey !== this.procKey(tab)) this.warm(tab);
  }

  // Stop no matter what state Claude is in.
  forceStop(tab, r) {
    if (r) {
      r.stale = true;
      if (r.proc) r.proc.kill();
      r.proc = null;
      for (const res of r.perms.values()) res(false);
      r.perms.clear();
    }
    if (r && r.turn && r.turn.reply.running) {
      clearTimeout(r.idleTimer);
      this.finishReply(tab, r, { type: "result", subtype: "error_during_execution", is_error: true });   // agents → stopped
      return;
    }
    const last = tab.messages[tab.messages.length - 1];
    if (last && last.role === "assistant" && last.running) {
      last.running = false; last.error = "stopped";
      for (const b of last.blocks || []) if (b.k === "agent" && b.state === "running") b.state = "stopped";
      this.post({ type: "patch", tabId: tab.id, msg: this.patchOf(last) });
    }
    tab.status = "idle";
    this.postTabs(); this.save();
  }

  finishTurn(tab, r) {
    const reply = r.turn.reply;
    if (reply.mode !== "agent" && reply.mode !== "auto") return;
    try {
      const files = this.changes.summary(r.turn, this.root());
      if (files.length) reply.changes = files;
    } catch (e) { log(`chat: couldn't list changes: ${e.message}`); }
  }

  patchOf(msg) { return { waitingFor: msg.waitingFor, running: msg.running, error: msg.error, changes: msg.changes, ms: msg.ms, note: msg.note, blocks: msg.blocks, planReady: msg.planReady, planBuilt: msg.planBuilt }; }

  // Claude (or a team member) wants to edit a file or run a command.
  async onPermission(tab, r, req) {
    const turn = r.turn;
    const input = req.input || {};
    if (EDIT_TOOLS.has(req.tool_name)) {
      const file = input.file_path || input.notebook_path;
      if (file && turn) {
        // Save the file if it has unsaved edits, so Claude edits what you see.
        const same = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
        const open = vscode.workspace.textDocuments.find((d) => same(d.uri.fsPath, file));
        if (open && open.isDirty) await open.save();
        this.changes.snapshot(turn, file);
      }
      return { allow: true };
    }
    if (SUBAGENT_TOOLS.has(req.tool_name)) return { allow: true };
    if (req.tool_name === "AskUserQuestion") return this.askUser(tab, r, req);
    if (tab.mode === "auto" || tab.allowAll) return { allow: true };
    // Agent mode: running commands, fetching web pages ask you first.
    const pid = shortId();
    const owner = req.agent_id && r.agents.get(r.tasks.get(req.agent_id));   // a team member asking
    const block = { k: "perm", pid, tool: req.tool_name, detail: permDetail(req.tool_name, input), state: "pending", agent: owner ? owner.name || `Agent ${owner.n}` : undefined };
    if (turn) turn.reply.blocks.push(block);
    tab.status = "waiting";
    this.post({ type: "block", tabId: tab.id, block });
    this.postTabs();
    if (tab.id !== this.activeId) vscode.window.showInformationMessage(`Kural: "${tab.title}" is waiting for your OK to run a command.`, "Show").then((p) => p && (this.reveal(), this.activate(tab.id)));
    const allow = await new Promise((resolve) => r.perms.set(pid, resolve));
    block.state = allow ? "allowed" : "denied";
    // (After Stop the answer is already over: don't flip the tab back to "running".)
    if (turn && turn.reply.running) tab.status = "running";
    this.post({ type: "permState", tabId: tab.id, pid, state: block.state });
    this.postTabs(); this.save();
    return allow ? { allow: true } : { allow: false, message: "The user chose not to run this. Continue without it or ask them." };
  }

  // Claude asks you a question with options: show a card, wait for your pick.
  async askUser(tab, r, req) {
    const input = req.input || {};
    const questions = Array.isArray(input.questions) ? input.questions : [];
    if (!questions.length) return { allow: false, message: "No question given." };
    const owner = req.agent_id && r.agents.get(r.tasks.get(req.agent_id));
    const pid = shortId();
    const block = { k: "question", pid, questions, state: "pending", answers: null, agent: owner ? owner.name : undefined };
    if (r.turn) r.turn.reply.blocks.push(block);
    tab.status = "waiting";
    this.post({ type: "block", tabId: tab.id, block });
    this.postTabs();
    if (tab.id !== this.activeId) vscode.window.showInformationMessage(`Kural: "${tab.title}" has a question for you.`, "Show").then((p) => p && (this.reveal(), this.activate(tab.id)));
    const answers = await new Promise((resolve) => r.perms.set(pid, resolve));
    const ok = answers && typeof answers === "object";
    block.state = ok ? "answered" : "skipped";
    block.answers = ok ? answers : null;
    if (r.turn && r.turn.reply.running) tab.status = "running";
    this.post({ type: "questionState", tabId: tab.id, pid, state: block.state, answers: block.answers });
    this.postTabs(); this.save();
    return ok ? { allow: true, updatedInput: { ...input, answers } }
      : { allow: false, message: "The user skipped the question. Continue with your best judgment, and say what you assumed." };
  }

  afterTeamChange(tab) {
    this.remember(tab); this.postTabs(); this.save();
    if (tab.status === "idle") this.warm(tab);
    else this.post({ type: "flash", text: "Applies from your next message" });
  }

  async shortcut(make) {
    const tab = this.active();
    if (!tab) return;
    const [msg, flash] = make(tab);
    await this.onMessage({ ...msg, tabId: tab.id });
    const t = this.active();
    this.post({ type: "flash", text: flash || `${MODES.find((x) => x.id === t.mode).label} mode` });
  }

  // ---------- messages from the panel ----------
  async onMessage(m) {
    const tab = m.tabId ? this.tab(m.tabId) : this.active();
    switch (m.type) {
      case "ready":
        this.ready = true;
        this.view.webview.postMessage({ type: "config", models: MODELS, efforts: EFFORTS, modes: MODES, teamSizes: TEAM_SIZES,
          moods: MOODS, roles: ROLES, teamStyles: TEAM_STYLES, version: this.version });
        this.view.webview.postMessage({ type: "tabs", tabs: this.tabs.map((t) => this.summary(t)), activeId: this.activeId });
        this.view.webview.postMessage({ type: "full", tab: this.viewTab(this.active()) });
        if (this.active() && this.active().setup) this.view.webview.postMessage({ type: "setup", tabId: this.activeId, setup: this.active().setup });
        for (const q of this.queue.splice(0)) this.view.webview.postMessage(q);
        this.postActive();
        this.postHistory();
        this.sendFiles();
        this.warm(this.active());
        break;
      case "log": log(`chat panel: ${m.message}`); break;
      case "focusChanged": vscode.commands.executeCommand("setContext", "kural.chatFocused", !!m.focused); break;
      case "newTab": this.newTab(true); break;
      case "switchTab": this.activate(m.id); break;
      case "closeTab": this.closeTab(m.id); break;
      case "renameTab": this.rename(m.id, m.title); break;
      case "history": this.postHistory(); break;
      case "reopen": this.reopen(m.id); break;
      case "forget": this.history = this.history.filter((h) => h.id !== m.id); this.postHistory(); this.save(); break;
      case "send": if (tab) await this.send(tab, m.segments, m.contexts, m.attachments || []); break;
      case "attachPick": {
        const uris = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFiles: true, openLabel: "Attach", title: "Attach files to your message" });
        const items = (uris || []).map((u) => this.attachments.add(u.fsPath)).filter(Boolean);
        if (items.length) this.post({ type: "attached", items });
        break;
      }
      case "attachData": { const a = this.attachments.addData(m.name, m.data); if (a) this.post({ type: "attached", items: [a] }); break; }
      case "attachUris": {
        const items = (m.uris || []).map((u) => { try { return this.attachments.add(vscode.Uri.parse(u).fsPath); } catch { return null; } }).filter(Boolean);
        if (items.length) this.post({ type: "attached", items });
        break;
      }
      case "buildPlan": if (tab) {
        const msg = tab.messages[m.msgIndex];
        if (msg) { msg.planBuilt = true; this.post({ type: "patch", tabId: tab.id, index: m.msgIndex, msg: this.patchOf(msg) }); }
        await this.buildPlan(tab);
      } break;
      case "stop": {
        const r = this.runtime.get(tab.id);
        // Agents working in the background don't stop on an interrupt, and a paused lead has
        // nothing to interrupt: end the whole process. The conversation is saved, so the next
        // message picks it up again.
        if (!r || !r.proc || r.proc.exited || [...r.agents.values()].some((a) => a.state === "running")) { this.forceStop(tab, r); break; }
        for (const res of r.perms.values()) res(false);
        r.perms.clear();
        r.proc.interrupt();
        const turn = r.turn;   // if Claude doesn't confirm within 5 s, stop it the hard way
        setTimeout(() => { if (r.turn === turn && turn && turn.reply.running) this.forceStop(tab, r); }, 5000);
        break;
      }
      case "setModel": {
        if (!valid(MODELS, m.model)) return;
        tab.model = m.model;
        const r = this.runtime.get(tab.id);
        // Switch right away, keeping the conversation — even in the middle of an answer:
        // Claude's next step already uses the new model.
        if (r && r.proc && !r.proc.exited) r.proc.setModel(m.model);
        tab.modelName = null;
        this.post({ type: "modelName", tabId: tab.id, name: null });   // show the new choice right away
        this.remember(tab); this.postTabs(); this.save();
        break;
      }
      case "setEffort": if (valid(EFFORTS, m.effort)) {
        tab.effort = m.effort; this.remember(tab); this.postTabs(); this.save();
        if (tab.status === "idle") this.warm(tab);
        else this.post({ type: "flash", text: "Intensity applies from your next message" });   // set when Claude starts
      } break;
      case "setMode": if (valid(MODES, m.mode)) {
        tab.mode = m.mode; this.remember(tab);
        if (m.mode === "agent" || m.mode === "auto") this.context.globalState.update(LAST_KEY, { ...this.context.globalState.get(LAST_KEY), buildMode: m.mode });
        this.postTabs(); this.save(); if (tab.status === "idle") this.warm(tab);
      } break;
      case "setMood": if (valid(MOODS, m.mood)) { tab.mood = m.mood; this.afterTeamChange(tab); } break;
      case "toggleRole": if (valid(ROLES, m.role)) {
        const roles = tab.roles || [];
        tab.roles = roles.includes(m.role) ? roles.filter((r) => r !== m.role) : [...roles, m.role].slice(0, FRIENDS.length);
        if (tab.roles.length && !tab.team) tab.team = TEAM_SIZES[1];   // picking a role turns the team on
        this.afterTeamChange(tab);
      } break;
      case "setTeamStyle": if (valid(TEAM_STYLES, m.style)) { tab.teamStyle = m.style; if (!tab.team) tab.team = TEAM_SIZES[1]; this.afterTeamChange(tab); } break;
      case "reloadSetup": this.setupChanged("reload asked for"); break;
      case "useFullSetup":
        await cfg().update("chat.fullClaudeCodeSetup", !!m.on, vscode.ConfigurationTarget.Global);
        this.setupChanged(m.on ? "switched to your full setup" : "switched to the minimal setup");
        break;
      case "setTeam": tab.team = TEAM_SIZES.includes(m.team) ? m.team : 0; this.remember(tab); this.postTabs(); this.save(); if (tab.status === "idle") this.warm(tab); break;
      case "permission": {
        const r = this.runtime.get(tab.id);
        if (m.always) { tab.allowAll = true; this.post({ type: "allowAll", tabId: tab.id }); }
        const res = r && r.perms.get(m.pid);
        if (res) { r.perms.delete(m.pid); res(!!m.allow); }
        break;
      }
      case "answer": {
        const r = this.runtime.get(tab.id);
        const res = r && r.perms.get(m.pid);
        if (res) { r.perms.delete(m.pid); res(m.answers && typeof m.answers === "object" ? m.answers : false); }
        break;
      }
      case "change": await this.onChangeAction(tab, m); break;
      case "apply": {
        const uri = this.resolvePath(m.path);
        if (!uri) { vscode.window.showWarningMessage("Kural: open the file you want to apply this to, then click Apply again."); return; }
        await this.apply(m.code, uri);
        break;
      }
      case "insert": {
        const ed = this.lastEditor;
        if (!ed) { vscode.window.showWarningMessage("Kural: open a file first."); return; }
        await vscode.window.showTextDocument(ed.document, ed.viewColumn);
        await ed.edit((b) => b.replace(ed.selection, m.code));
        break;
      }
      case "copy": await vscode.env.clipboard.writeText(m.code); vscode.window.setStatusBarMessage("Copied", 1500); break;
      case "openFile": {
        const uri = this.resolvePath(m.path);
        if (!uri) return;
        const line = Math.max(0, (m.line || 1) - 1), end = Math.max(line, (m.endLine || m.line || 1) - 1);
        await vscode.window.showTextDocument(uri, { preview: false, selection: m.line ? new vscode.Range(line, 0, end, 0) : undefined });
        break;
      }
      case "files": await this.sendFiles(); break;
      case "paste": this.post({ type: "pasted", ctx: this.pasteToRef(m.text), text: m.text }); break;
      case "login": vscode.commands.executeCommand("kural.login"); break;
      case "showLog": vscode.commands.executeCommand("kural.showLog"); break;
    }
  }

  // Pasted code that came from the editor becomes a reference like "main.py (L3-9)".
  pasteToRef(text) {
    const norm = (s) => s.replace(/\r\n/g, "\n").replace(/\s+$/, "");
    const t = norm(text);
    if (!t.includes("\n") && t.length < 40) return null;
    const s = this.lastSelection;
    if (s && !s.doc.isClosed && norm(s.doc.getText(s.range)) === t) return this.selectionCtx(s.doc, s.range);
    const ed = this.lastEditor;
    if (ed) {
      const all = ed.document.getText().replace(/\r\n/g, "\n");
      const at = all.indexOf(t);
      if (at >= 0) {
        const start = ed.document.positionAt(at), end = ed.document.positionAt(at + t.length);
        return this.selectionCtx(ed.document, new vscode.Range(start, end));
      }
    }
    return null;
  }

  async onChangeAction(tab, m) {
    const msg = tab.messages[m.msgIndex];
    if (!msg || !msg.changes) return;
    const targets = m.id === "*" ? msg.changes.filter((c) => c.state === "pending") : msg.changes.filter((c) => c.id === m.id);
    for (const c of targets) {
      if (m.action === "review") { await this.changes.review(c.id); continue; }
      if (m.action === "undo") { if (await this.changes.undo(c.id)) c.state = "undone"; }
      if (m.action === "keep") { this.changes.keep(c.id); c.state = "kept"; }
    }
    this.post({ type: "patch", tabId: tab.id, index: m.msgIndex, msg: this.patchOf(msg) });
    this.save();
  }

  resolvePath(p) {
    if (!p) return this.lastEditor ? this.lastEditor.document.uri : null;
    return ws.resolve(p);
  }

  async readText(uri) {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (open) return open.getText();                      // includes unsaved edits
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
  }
}

// "claude_ai_Notion" / "claude.ai Notion" -> "Notion"
function prettyServer(name) { return String(name).replace(/^claude[._ ]ai[_ ]/i, "").replace(/_/g, " "); }

function prettyModel(id) {
  const m = id.match(/claude-(opus|sonnet|haiku)-(\d+)-(\d+)/i);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id;
}

function toolDetail(name, input, root) {
  const rel = (p) => ws.label(p);   // "src/app.py", or "<folder>/src/app.py" in a multi-folder workspace
  switch (name) {
    case "Read": return rel(input.file_path);
    case "Grep": return `"${input.pattern}"${input.path ? " in " + rel(input.path) : ""}`;
    case "Glob": return input.pattern || "";
    case "Edit": return `${rel(input.file_path)}  (+${lines(input.new_string)} −${lines(input.old_string)})`;
    case "Write": return rel(input.file_path);
    case "NotebookEdit": return rel(input.notebook_path);
    case "Bash": return input.command || "";
    case "WebSearch": return input.query || "";
    case "WebFetch": return input.url || "";
    case "mcp__team__post": return `${cap(input.from)} → ${input.to === "all" ? "everyone" : cap(input.to)}: ${input.message || ""}`;
    case "mcp__team__read": return `${cap(input.name)} checks messages${input.wait_seconds ? " and waits for a reply" : ""}`;
    default: return "";
  }
}
const lines = (s) => (s ? String(s).split("\n").length : 0);
const cap = (s) => { s = String(s || "").trim(); return s ? s[0].toUpperCase() + s.slice(1) : "?"; };

// The team's message board, run by Kural's own executable as plain Node.
function teamServer() {
  return { command: process.execPath, args: [path.join(__dirname, "team-mcp.js")], env: { ELECTRON_RUN_AS_NODE: "1" } };
}

function permDetail(tool, input) {
  if (tool === "Bash") return input.command || "";
  if (tool === "WebFetch") return input.url || "";
  return JSON.stringify(input).slice(0, 300);
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

module.exports = { ChatView, MODELS, EFFORTS, MODES, _test: { PROMPTS, teamPrompt, FRIENDS, ROLES, MOOD_PROMPTS, toolDetail } };
