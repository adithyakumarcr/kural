// Link a Jira ticket (epic, story, task, bug…) to a chat, so the whole chat knows what you're working on.
//
// Kural has no Jira login of its own. It asks Claude, which reaches Jira through your Atlassian connector
// (a claude.ai connector or an MCP server you added). So: nothing to set up in Kural, and nothing works
// without that connector — the + menu then shows a warning instead.

const { ClaudeProcess, findClaude, log } = require("./claude");

// Is a connector / MCP server Atlassian's? ("claude.ai Atlassian Rovo", "atlassian", "jira", …)
const IS_ATLASSIAN = /atlassian|jira/i;
// A read-only Atlassian tool: mcp__<atlassian…>__getJiraIssue, …__searchJiraIssuesUsingJql, …__lookupJiraAccountId
function isAtlassianRead(tool) {
  const m = /^mcp__(.+)__(.+)$/.exec(tool || "");
  return !!m && IS_ATLASSIAN.test(m[1]) && /^(get|search|lookup|fetch|list|read)/i.test(m[2]);
}

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

class Tickets {
  constructor(root) { this.root = root; this.current = null; }

  // Search Jira. Resolves { issues: [...], note } or { error }.
  search(query) {
    this.cancel();
    if (!findClaude()) return Promise.resolve({ error: "Claude Code isn't installed." });
    const t0 = Date.now();
    return new Promise((resolve) => {
      let done = false;
      const finish = (out) => { if (done) return; done = true; clearTimeout(timer); if (this.current === proc) this.current = null; proc.kill(); resolve(out); };
      const proc = new ClaudeProcess({
        name: "jira", model: "haiku", effort: "low", noThinking: true,
        safeMode: false, strictMcp: false,                 // your connectors and MCP servers, so Atlassian is there
        tools: [], hostPermissions: true, jsonSchema: SCHEMA, appendSystemPrompt: PROMPT, cwd: this.root(),
      }, {
        // Only Atlassian's tools may run; everything else is refused.
        onPermission: async (r) => IS_ATLASSIAN.test(r.tool_name || "") ? { allow: true } : { allow: false, message: "Only the Atlassian tools are allowed here." },
        onMessage: (m) => {
          if (m.type !== "result") return;
          if (m.is_error) return finish({ error: String(m.result || "Jira search failed.").slice(0, 300) });
          let out = m.structured_output;
          if (!out) { try { out = JSON.parse(m.result); } catch { out = null; } }
          const issues = ((out && out.issues) || []).filter((i) => i && i.key).slice(0, 10);
          log(`jira: "${query}" → ${issues.length} issues in ${Date.now() - t0} ms${out && out.note ? ` (${out.note})` : ""}`);
          finish({ issues, note: (out && out.note) || "" });
        },
        onExit: (info) => finish({ error: info.login ? "You're not logged in to Claude." : "Claude stopped unexpectedly. See View → Output → Kural." }),
      });
      const timer = setTimeout(() => finish({ error: "Jira didn't answer within 60 seconds." }), 60000);
      this.current = proc;
      if (!proc.start()) return finish({ error: "Couldn't start Claude." });
      proc.send(query.trim() ? `Search: ${query.trim()}` : "Search: (empty — my recent issues)");
    });
  }

  cancel() { if (this.current) { const p = this.current; this.current = null; p.kill(); } }
}

module.exports = { Tickets, atlassianState, ticketNote, isAtlassianRead, IS_ATLASSIAN };
