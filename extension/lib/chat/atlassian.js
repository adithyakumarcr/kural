// Which tools are Atlassian's, and which of them only read. No vscode here (the permission policy uses it, tested alone).

// Is a connector / MCP server Atlassian's? ("claude.ai Atlassian Rovo", "atlassian", "jira", …)
const IS_ATLASSIAN = /atlassian|jira/i;
// A read-only Atlassian tool: mcp__<atlassian…>__getJiraIssue, …__searchJiraIssuesUsingJql, …__lookupJiraAccountId
function isAtlassianRead(tool) {
  const m = /^mcp__(.+)__(.+)$/.exec(tool || "");
  return !!m && IS_ATLASSIAN.test(m[1]) && /^(get|search|lookup|fetch|list|read|atlassianUserInfo)([A-Z_]|$)/.test(m[2]);
}

module.exports = { IS_ATLASSIAN, isAtlassianRead };
