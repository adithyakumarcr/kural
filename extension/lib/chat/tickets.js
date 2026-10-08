// Link a Jira ticket (epic, story, task, bug…) to a chat, so the whole chat knows what you're working on.
//
// Kural has no Jira login of its own. It asks Claude, which reaches Jira through your Atlassian connector
// (a claude.ai connector or an MCP server you added). So: nothing to set up in Kural, and nothing works
// without that connector — the + menu then shows a warning instead.

const { ClaudeProcess, findClaude, log } = require("../ai/claude");

const { IS_ATLASSIAN, isAtlassianRead } = require("./atlassian");

// What the + menu shows for "Link ticket": ok, or a warning and why.
function atlassianState(setup) {
  if (!setup) return { ok: true, unknown: true };            // not loaded yet: just try
  if (!setup.full) return { ok: false, why: "Kural is using the fast minimal setup, which has no connectors. Turn on your full Claude Code setup in the model menu." };
  const s = (setup.servers || []).find((x) => IS_ATLASSIAN.test(x.id || x.name));
  if (!s) return { ok: false, why: "Atlassian isn't connected. Add the Atlassian connector on claude.ai (Settings → Connectors), or run `claude mcp add` for an Atlassian MCP server, then click ↻ Reload in the model menu." };
  if (s.status !== "connected") {
    const what = { "needs-auth": "needs you to log in", pending: "is still connecting", failed: "couldn't connect" }[s.status] || `isn't ready (${s.status})`;
    return { ok: false, why: `Atlassian ${what}. Check it on claude.ai (Settings → Connectors), then click ↻ Reload in the model menu.` };
  }
  return { ok: true };
}

const SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" }, summary: { type: "string" }, type: { type: "string" },
          status: { type: "string" }, url: { type: "string" },
        },
        required: ["key", "summary"],
      },
    },
    note: { type: "string", description: "Only if something went wrong: what, in one short sentence." },
  },
  required: ["issues"],
};

const PROMPT =
  "You look up Jira issues for the user of a code editor, using the Atlassian tools you have (Jira search, " +
  "get issue). Never use any other tools. If the search is an issue key like ABC-123, get that issue. If it's " +
  "words, search Jira by text (e.g. JQL: text ~ \"words\" ORDER BY updated DESC). If it's empty, list the user's " +
  "most recently updated issues (assignee = currentUser() OR reporter = currentUser() ORDER BY updated DESC). " +
  "Return at most 10 issues: key, summary, type (Epic, Story, Task, Bug, …), status, and the browse URL. " +
  "If the Atlassian tools are missing or need a login, return no issues and say so in note.";

// The text added to every message of a chat that has a ticket linked.
function ticketNote(t) {
  if (!t || !t.key) return "";
  return `<ticket>\nThis chat is about Jira ${t.type || "issue"} ${t.key}: "${t.summary || ""}"` +
    `${t.status ? ` (status: ${t.status})` : ""}${t.url ? `, ${t.url}` : ""}.\n` +
    "When its details matter (description, acceptance criteria, comments, linked issues), read it with the Atlassian tools.\n</ticket>\n\n";
}

// Ask Claude Code how its connectors are doing until Atlassian is connected (or clearly won't be).
async function waitForAtlassian(proc, maxMs = 30000) {
  const t0 = Date.now();
  let seen = null;
  while (Date.now() - t0 < maxMs && !proc.exited) {
    const res = await proc.request({ subtype: "mcp_status" }, 4000);
    const servers = (res && res.mcpServers) || [];
    const s = servers.find((x) => IS_ATLASSIAN.test(x.name || ""));
    if (s) seen = s.status;
    if (s && s.status === "connected") return {};
    if (s && s.status === "needs-auth") return { error: "Atlassian needs you to log in. Check it on claude.ai (Settings → Connectors), then try again." };
    if (s && s.status === "failed") return { error: "Atlassian couldn't connect. Check it on claude.ai (Settings → Connectors), then try again." };
    // Not in the list at all, and nothing else is still connecting: it isn't set up.
    if (res && !s && Date.now() - t0 > 8000 && !servers.some((x) => x.status === "pending"))
      return { error: "Atlassian isn't connected. Add the Atlassian connector on claude.ai (Settings → Connectors), or run `claude mcp add` for an Atlassian MCP server." };
    await new Promise((r) => setTimeout(r, 500));
  }
  if (proc.exited) return { error: "Claude stopped unexpectedly. See Kural's log (Kural: Show Log)." };
  return { error: `Atlassian didn't finish connecting within ${Math.round(maxMs / 1000)} seconds${seen ? ` (it's ${seen})` : ""}. Try again in a moment.` };
}

// One Claude helper for searching, kept running while you search: Claude Code connects the Atlassian
// connector once (that's the slow part), and later searches reuse it. It stops after 5 idle minutes.
class Tickets {
  constructor(root) { this.root = root; this.proc = null; this.ready = null; this.pending = null; this.idleTimer = null; this.turns = 0; }

  // Start the helper and wait for Atlassian. Resolves {} or { error }.
  warm() {
    if (this.proc && !this.proc.exited && this.ready) return this.ready;
    if (!findClaude()) return Promise.resolve({ error: "Claude Code isn't installed." });
    const proc = new ClaudeProcess({
      name: "jira", model: "haiku", effort: "low", noThinking: true,
      safeMode: false, strictMcp: false,                 // your connectors and MCP servers, so Atlassian is there
      tools: [], hostPermissions: true, jsonSchema: SCHEMA, appendSystemPrompt: PROMPT, cwd: this.root(),
    }, {
      // Only Atlassian's tools may run; everything else is refused.
      onPermission: async (r) => isAtlassianRead(r.tool_name) ? { allow: true } : { allow: false, message: "Only reading from Jira is allowed here." },
      onMessage: (m) => { if (this.proc === proc && this.pending) this.pending.onMessage(m); },
      onExit: (info) => {
        if (this.proc !== proc) return;
        this.proc = null; this.ready = null;
        if (this.pending) this.pending.finish({ error: info.login ? "You're not logged in to Claude." : "Claude stopped unexpectedly. See Kural's log (Kural: Show Log)." });
      },
    });
    if (!proc.start()) return Promise.resolve({ error: "Couldn't start Claude." });
    this.proc = proc; this.turns = 0;
    const t0 = Date.now();
    // Claude Code connects claude.ai connectors in the background after it starts. Asking right away
    // found no Atlassian tools ("Atlassian tools not available"), so wait until Atlassian is connected.
    this.ready = waitForAtlassian(proc).then((w) => {
      if (w.error) { log(`jira: ${w.error}`); this.stop(); } else log(`jira: Atlassian connected after ${Date.now() - t0} ms`);
      return w;
    });
    return this.ready;
  }

  // Search Jira. onStatus(text) reports "Connecting to Jira…". Resolves { issues, note } or { error }.
  async search(query, onStatus) {
    clearTimeout(this.idleTimer);
    // A search still running (you searched again): stop it, so its answer can't be mixed up with this one.
    if (this.pending) { this.pending.finish({ cancelled: true }); this.stop(); }
    if (this.turns >= 10) this.stop();                       // start fresh now and then
    const connected = this.proc && !this.proc.exited && this.ready;
    if (!connected && onStatus) onStatus("Connecting to Jira…");
    const w = await this.warm();
    if (w.error) return { error: w.error };
    const proc = this.proc;
    if (!proc) return { error: "Claude stopped unexpectedly. See Kural's log (Kural: Show Log)." };
    if (onStatus) onStatus(query.trim() ? `Searching Jira for “${query.trim()}”…` : "Getting your recent tickets…");
    const t0 = Date.now();
    return new Promise((resolve) => {
      let done = false;
      const finish = (out) => {
        if (done) return; done = true; clearTimeout(timer);
        if (this.pending === job) this.pending = null;
        this.idleTimer = setTimeout(() => this.stop(), 5 * 60 * 1000);
        resolve(out);
      };
      const job = {
        finish,
        onMessage: (m) => {
          if (m.type !== "result") return;
          if (m.is_error) return finish({ error: String(m.result || "Jira search failed.").slice(0, 300) });
          let out = m.structured_output;
          if (!out) { try { out = JSON.parse(m.result); } catch { out = null; } }
          const issues = ((out && out.issues) || []).filter((i) => i && i.key).slice(0, 10);
          log(`jira: "${query}" → ${issues.length} issues in ${Date.now() - t0} ms${out && out.note ? ` (${out.note})` : ""}`);
          finish({ issues, note: (out && out.note) || "" });
        },
      };
      const timer = setTimeout(() => { finish({ error: "Jira didn't answer within 60 seconds." }); this.stop(); }, 60000);
      this.pending = job; this.turns++;
      proc.send(query.trim() ? `Search: ${query.trim()}` : "Search: (empty — my recent issues)");
    });
  }

  stop() { const p = this.proc; this.proc = null; this.ready = null; if (p) p.kill(); }
}

module.exports = { Tickets, atlassianState, ticketNote, isAtlassianRead, IS_ATLASSIAN };
