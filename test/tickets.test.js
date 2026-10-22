// "+ → Link ticket": when Kural offers it, which Jira tools run without asking, and what each message carries.
const assert = require("assert");
const Module = require("module");
const load = Module._load;
Module._load = function (req, ...a) { return req === "vscode" ? {} : load.call(this, req, ...a); };   // no editor needed
const { isAtlassianRead, atlassianState, ticketNote, waitForAtlassian } = require("../extension/lib/chat/tickets");
const connectorsOff = require("../extension/lib/ai/connectors-off");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };

check("reading Jira doesn't ask", () => {
  for (const t of ["mcp__claude_ai_Atlassian_Rovo__getJiraIssue", "mcp__claude_ai_Atlassian_MCP__getJiraIssue", "mcp__claude_ai_Atlassian_MCP__searchJiraIssuesUsingJql", "mcp__claude_ai_Atlassian_MCP__getAccessibleAtlassianResources", "mcp__atlassian__searchJiraIssuesUsingJql", "mcp__jira__lookupJiraAccountId"]) assert.ok(isAtlassianRead(t), t);
});
check("writing to Jira and other tools still ask", () => {
  for (const t of ["mcp__atlassian__addCommentToJiraIssue", "mcp__atlassian__transitionJiraIssue", "mcp__atlassian__createJiraIssue", "mcp__notion__search", "Bash", ""]) assert.ok(!isAtlassianRead(t), t);
});
check("connected Atlassian: Link ticket works", () => assert.ok(atlassianState({ full: true, servers: [{ id: "claude.ai Atlassian Rovo", status: "connected" }] }).ok));
// (Issue #105: the chat's last report was often stale or from another AI, and the menu then offered no search. Whether
// Atlassian is there is now the search's own business: waitForAtlassian below.)
check("whatever the chat last reported, Link ticket offers the search", () => {
  for (const servers of [[], [{ id: "notion", status: "connected" }], [{ id: "claude.ai Atlassian MCP", status: "pending" }], [{ id: "claude.ai Atlassian MCP", status: "failed" }]])
    assert.ok(atlassianState({ full: true, servers }).ok, JSON.stringify(servers));
});
check("minimal setup: warning", () => assert.ok(!atlassianState({ full: false, servers: [] }).ok));
check("setup not loaded yet: try anyway", () => assert.ok(atlassianState(null).ok));
check("messages carry the linked ticket", () => {
  const n = ticketNote({ key: "SHOP-31", type: "Story", summary: "Show low stock", status: "To Do", url: "https://x/browse/SHOP-31" });
  assert.ok(n.includes("SHOP-31") && n.includes("Story") && n.includes("Show low stock") && n.includes("https://x/browse/SHOP-31"));
  assert.strictEqual(ticketNote(null), "");
});
// The search's helper: a stand-in Claude whose mcp_status answers come from a script.
function fakeProc(statuses) {
  const asked = [];
  let i = 0;
  return { asked, exited: false, request: async (req) => {
    asked.push(req.subtype === "mcp_reconnect" ? `reconnect ${req.serverName}` : req.subtype);
    if (req.subtype !== "mcp_status") return {};
    const s = statuses[Math.min(i++, statuses.length - 1)];
    return { mcpServers: s };
  } };
}
const ATL = (status) => [{ name: "claude.ai Figma", status: "connected" }, { name: "claude.ai Atlassian MCP", status }];
let offList = {};
connectorsOff.init(() => offList, async (v) => { offList = v; });
(async () => {
  const acheck = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
  await acheck("connecting, then connected: ready", async () => {
    const p = fakeProc([ATL("pending"), ATL("connected")]);
    assert.deepStrictEqual(await waitForAtlassian(p, 5000), {});
  });
  await acheck("failed: reconnected once, then ready", async () => {
    const p = fakeProc([ATL("failed"), ATL("connected")]);
    assert.deepStrictEqual(await waitForAtlassian(p, 5000), {});
    assert.deepStrictEqual(p.asked, ["mcp_status", "reconnect claude.ai Atlassian MCP", "mcp_status"]);
  });
  await acheck("failed again after the reconnect: says so", async () => {
    const p = fakeProc([ATL("failed")]);
    const w = await waitForAtlassian(p, 5000);
    assert.ok(/also after trying again/.test(w.error), w.error);
    assert.strictEqual(p.asked.filter((x) => x.startsWith("reconnect")).length, 1);
  });
  await acheck("needs a login: says so, no reconnect", async () => {
    const p = fakeProc([ATL("needs-auth")]);
    assert.ok(/log in/.test((await waitForAtlassian(p, 5000)).error));
    assert.ok(!p.asked.some((x) => x.startsWith("reconnect")));
  });
  await acheck("turned off in Kural: says where to turn it on", async () => {
    await connectorsOff.set("claude", "claude.ai Atlassian MCP", true);
    const w = await waitForAtlassian(fakeProc([ATL("connected")]), 5000);
    await connectorsOff.set("claude", "claude.ai Atlassian MCP", false);
    assert.ok(/turned off in Kural Settings/.test(w.error), w.error);
  });
  console.log(fail ? `tickets: ${fail} FAILED` : "tickets: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
