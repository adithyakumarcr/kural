// Which tools are Atlassian's, and which of them only read. No vscode here (the permission policy uses it, tested alone).

// Is a connector / MCP server Atlassian's? ("claude.ai Atlassian Rovo", "atlassian", "jira", …) Only for finding the
// connector to wait for (tickets.js); what runs without asking is the narrower list below.
const IS_ATLASSIAN = /atlassian|jira/i;
// The Atlassian servers whose read tools run without asking: the claude.ai connector (Claude Code names its tools
// mcp__claude_ai_Atlassian__… or mcp__claude_ai_Atlassian_Rovo__…) and one you added yourself as "atlassian" or "jira"
// (`claude mcp add atlassian …`). Not just any server with "jira" in its name: a project's server called "evil-jira" could
// name a tool getAnything.
const SERVERS = /^(claude_ai_Atlassian(_Rovo)?|atlassian|jira)$/i;
// Atlassian's own read-only tools (its Rovo MCP server): looking things up, never creating, editing or moving anything.
const READS = new Set([
  "atlassianUserInfo", "getAccessibleAtlassianResources", "lookupJiraAccountId", "search", "fetch",
  "getJiraIssue", "searchJiraIssuesUsingJql", "getVisibleJiraProjects", "getJiraProjectIssueTypesMetadata",
  "getJiraIssueTypeMetaWithFields", "getJiraIssueRemoteIssueLinks", "getTransitionsForJiraIssue", "getIssueLinkTypes",
  "getConfluencePage", "getConfluenceSpaces", "getPagesInConfluenceSpace", "getConfluencePageDescendants",
  "getConfluencePageFooterComments", "getConfluencePageInlineComments", "searchConfluenceUsingCql",
]);
// A read-only Atlassian tool: mcp__<atlassian server>__getJiraIssue, …__searchJiraIssuesUsingJql, …__lookupJiraAccountId
function isAtlassianRead(tool) {
  const m = /^mcp__(.+)__(.+)$/.exec(tool || "");
  return !!m && SERVERS.test(m[1]) && READS.has(m[2]);
}

module.exports = { IS_ATLASSIAN, isAtlassianRead };
