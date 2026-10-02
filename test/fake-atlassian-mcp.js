// A stand-in for the Atlassian connector, for testing "+ → Link ticket" without a Jira account.
// It's an MCP server with two Jira tools and a few made-up tickets. Register it for a test run:
//   claude mcp add -s user atlassian -- node test/fake-atlassian-mcp.js     (remove: claude mcp remove -s user atlassian)
const ISSUES = [
  { key: "SHOP-12", type: "Epic", status: "In Progress", summary: "Inventory alerts for shop owners" },
  { key: "SHOP-31", type: "Story", status: "To Do", summary: "Show items below their reorder level", description: "As a shop owner I want a list of items at or below their reorder level.\nAcceptance criteria:\n- low_stock() returns those items\n- covered by a unit test" },
  { key: "SHOP-32", type: "Task", status: "To Do", summary: "Restock an item from a supplier order" },
  { key: "SHOP-40", type: "Bug", status: "Open", summary: "remove() accepts negative quantities" },
].map((i) => ({ ...i, url: `https://example.atlassian.net/browse/${i.key}` }));

const TOOLS = [
  { name: "searchJiraIssuesUsingJql", description: "Search Jira issues with JQL. Returns matching issues.",
    inputSchema: { type: "object", properties: { jql: { type: "string" }, maxResults: { type: "number" } }, required: ["jql"] } },
  { name: "getJiraIssue", description: "Get one Jira issue by key, with its description.",
    inputSchema: { type: "object", properties: { issueIdOrKey: { type: "string" } }, required: ["issueIdOrKey"] } },
];

function call(name, args) {
  if (name === "getJiraIssue") {
    const i = ISSUES.find((x) => x.key.toLowerCase() === String(args.issueIdOrKey || "").toLowerCase());
    return i ? JSON.stringify(i) : `Issue ${args.issueIdOrKey} does not exist.`;
  }
  const jql = String(args.jql || "");
  const text = /text\s*~\s*"([^"]*)"/i.exec(jql);
  const words = text ? text[1].toLowerCase().split(/\s+/).filter(Boolean) : [];
  const found = words.length ? ISSUES.filter((i) => words.some((w) => `${i.summary} ${i.description || ""}`.toLowerCase().includes(w))) : ISSUES;
  return JSON.stringify({ total: found.length, issues: found.map(({ description, ...i }) => i) });
}

const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d; let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id === undefined) continue;
    if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: (m.params && m.params.protocolVersion) || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "atlassian", version: "1.0.0" } } });
    else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: TOOLS } });
    else if (m.method === "tools/call") send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: call(m.params.name, m.params.arguments || {}) }] } });
    else send({ jsonrpc: "2.0", id: m.id, result: {} });
  }
});
process.stdin.on("end", () => process.exit(0));
