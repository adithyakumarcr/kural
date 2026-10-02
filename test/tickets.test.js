// "+ → Link ticket": when Kural offers it, which Jira tools run without asking, and what each message carries.
const assert = require("assert");
const Module = require("module");
const load = Module._load;
Module._load = function (req, ...a) { return req === "vscode" ? {} : load.call(this, req, ...a); };   // no editor needed
const { isAtlassianRead, atlassianState, ticketNote } = require("../extension/lib/tickets");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };

check("reading Jira doesn't ask", () => {
  for (const t of ["mcp__claude_ai_Atlassian_Rovo__getJiraIssue", "mcp__atlassian__searchJiraIssuesUsingJql", "mcp__jira__lookupJiraAccountId"]) assert.ok(isAtlassianRead(t), t);
});
check("writing to Jira and other tools still ask", () => {
  for (const t of ["mcp__atlassian__addCommentToJiraIssue", "mcp__atlassian__transitionJiraIssue", "mcp__atlassian__createJiraIssue", "mcp__notion__search", "Bash", ""]) assert.ok(!isAtlassianRead(t), t);
});
check("connected Atlassian: Link ticket works", () => assert.ok(atlassianState({ full: true, servers: [{ id: "claude.ai Atlassian Rovo", status: "connected" }] }).ok));
check("no Atlassian: warning", () => { const s = atlassianState({ full: true, servers: [{ id: "notion", status: "connected" }] }); assert.ok(!s.ok && /isn't connected/.test(s.why)); });
check("Atlassian needs login: warning", () => { const s = atlassianState({ full: true, servers: [{ id: "claude.ai Atlassian Rovo", status: "needs-auth" }] }); assert.ok(!s.ok && /log in/.test(s.why)); });
check("minimal setup: warning", () => assert.ok(!atlassianState({ full: false, servers: [] }).ok));
check("setup not loaded yet: try anyway", () => assert.ok(atlassianState(null).ok));
check("messages carry the linked ticket", () => {
  const n = ticketNote({ key: "SHOP-31", type: "Story", summary: "Show low stock", status: "To Do", url: "https://x/browse/SHOP-31" });
  assert.ok(n.includes("SHOP-31") && n.includes("Story") && n.includes("Show low stock") && n.includes("https://x/browse/SHOP-31"));
  assert.strictEqual(ticketNote(null), "");
});
console.log(fail ? `tickets: ${fail} FAILED` : "tickets: ALL PASS");
process.exit(fail ? 1 : 0);
