// The Plugins tab's work (extension/lib/plugins/core.js) with the stand-ins of the three AI programs (test/fake-claude.js,
// fake-codex.js, fake-agy.js; their plugin commands are test/fake-plugins.js, in the real programs' shapes):
//   Claude: list (Anthropic's directory built in), install, details, disable / enable, update, a command to accept,
//           a marketplace added and removed, uninstall, errors in words.
//   Codex:  nothing until a marketplace is added, descriptions from its catalog and the plugin's manifest, add / remove.
//   Gemini: a folder checked and added, turned off and on, removed; a folder that isn't a plugin.
//   And what Kural refuses before running anything (odd names, sources, Git addresses), and `claude plugin details`' text.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const core = require("../extension/lib/plugins/core");
const { writePlugin, ACCEPT } = require("./fake-plugins");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.stack); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-plugins-"));
const env = { ...process.env, FAKE_CLAUDE_FILE: path.join(tmp, "claude-state"), FAKE_CODEX_FILE: path.join(tmp, "codex-state"),
  FAKE_AGY_FILE: path.join(tmp, "agy-state"), CODEX_HOME: path.join(tmp, "codex-home") };
fs.mkdirSync(env.CODEX_HOME);
const prog = (name) => ({ bin: path.join(__dirname, `fake-${name}.js`), env, cwd: tmp });
const claude = prog("claude"), codex = prog("codex"), agy = prog("agy");

(async () => {
  // ---------- Claude ----------
  let l = await core.list("claude", claude);
  await check("Claude: Anthropic's directory is there from the start (built in, can't be removed)", () => {
    assert.ok(!l.error, l.error);
    assert.deepStrictEqual(l.installed, []);
    assert.deepStrictEqual(l.available.map((p) => p.id), ["code-review@anthropic-plugin-directory", "needs-command@anthropic-plugin-directory", "superpowers@anthropic-plugin-directory"]);
    assert.deepStrictEqual(l.marketplaces, [{ name: "anthropic-plugin-directory", label: "Anthropic's plugin directory", source: "built in", removable: false }]);
  });
  await check("Claude: a plugin's source becomes an address you can open", () => {
    const sp = l.available.find((p) => p.name === "superpowers"), cr = l.available.find((p) => p.name === "code-review");
    assert.strictEqual(sp.source, "https://github.com/obra/superpowers");
    assert.strictEqual(cr.source, "https://github.com/anthropics/claude-plugins-official");
    assert.match(sp.description, /^Core skills library/);
  });
  await check("Claude: install", async () => {
    const r = await core.act("claude", claude, "install", { id: "superpowers@anthropic-plugin-directory" });
    assert.ok(r.ok, JSON.stringify(r)); assert.match(r.message, /Successfully installed/);
  });
  l = await core.list("claude", claude);
  const sp = l.installed[0];
  await check("Claude: installed, with its manifest's description and author, the short version, not in available any more", () => {
    assert.strictEqual(l.installed.length, 1);
    assert.strictEqual(sp.id, "superpowers@anthropic-plugin-directory"); assert.strictEqual(sp.marketplace, "anthropic-plugin-directory");
    assert.strictEqual(sp.version, "6.4.2"); assert.strictEqual(sp.fullVersion, "6.4.2-8ca22dba9a94");
    assert.ok(sp.enabled && sp.installed && !sp.readOnly); assert.strictEqual(sp.author, "Jesse Vincent");
    assert.ok(!l.available.some((p) => p.id === sp.id));
  });
  await check("Claude: details (what it adds, and the tokens it adds to every chat)", async () => {
    const d = await core.details("claude", claude, sp);
    assert.deepStrictEqual(d.components.map((c) => [c.kind, c.count]), [["Skills", 3], ["Agents", 0], ["Hooks", 1], ["MCP servers", 0], ["LSP servers", 0]]);
    assert.match(d.components[0].items, /brainstorming/); assert.strictEqual(d.alwaysOn, "~703 tokens");
  });
  await check("Claude: details of a plugin that isn't installed: nothing (Claude only describes installed ones)", async () => {
    assert.deepStrictEqual(await core.details("claude", claude, l.available[0]), {});
  });
  await check("Claude: disable, then enable", async () => {
    assert.ok((await core.act("claude", claude, "disable", { id: sp.id })).ok);
    assert.strictEqual((await core.list("claude", claude)).installed[0].enabled, false);
    assert.ok((await core.act("claude", claude, "enable", { id: sp.id })).ok);
    assert.strictEqual((await core.list("claude", claude)).installed[0].enabled, true);
  });
  await check("Claude: update says what happened", async () => {
    const r = await core.act("claude", claude, "update", { id: sp.id });
    assert.ok(r.ok); assert.match(r.message, /already at the latest version/);
  });
  await check("Claude: a plugin its marketplace installs with a command: the command to confirm, then --accept-command", async () => {
    const r = await core.act("claude", claude, "install", { id: "needs-command@anthropic-plugin-directory" });
    assert.deepStrictEqual(r, { confirm: { command: "npx -y @example/fetch-needs-command", sha256: ACCEPT } });
    const r2 = await core.act("claude", claude, "install", { id: "needs-command@anthropic-plugin-directory", accept: ACCEPT });
    assert.ok(r2.ok, JSON.stringify(r2));
    assert.ok((await core.act("claude", claude, "uninstall", { id: "needs-command@anthropic-plugin-directory" })).ok);
  });
  await check("Claude: a marketplace added: its plugins show; removed again", async () => {
    const r = await core.market("claude", claude, "add", { source: "obra/superpowers-marketplace" });
    assert.ok(r.ok, JSON.stringify(r));
    const l2 = await core.list("claude", claude);
    assert.ok(l2.available.some((p) => p.id === "superpowers@superpowers-marketplace" && p.version === "7.0.0"));
    assert.deepStrictEqual(l2.marketplaces.map((m) => [m.name, m.removable]), [["anthropic-plugin-directory", false], ["superpowers-marketplace", true]]);
    assert.strictEqual(l2.marketplaces[1].source, "obra/superpowers-marketplace");
    assert.ok((await core.market("claude", claude, "remove", { name: "superpowers-marketplace" })).ok);
    assert.strictEqual((await core.list("claude", claude)).marketplaces.length, 1);
  });
  await check("Claude: errors are said in words (the program's own message)", async () => {
    const r = await core.act("claude", claude, "install", { id: "nope@anthropic-plugin-directory" });
    assert.match(r.error, /not found in any configured marketplace/);
    const m = await core.market("claude", claude, "add", { source: "someone/not-a-marketplace" });
    assert.match(m.error, /Failed to clone/);
  });
  await check("Claude: the built-in directory can't be removed (nothing is run)", async () => {
    assert.match((await core.market("claude", claude, "remove", { name: "anthropic-plugin-directory" })).error, /can't remove/);
  });
  await check("Claude: uninstall", async () => {
    assert.ok((await core.act("claude", claude, "uninstall", { id: sp.id })).ok);
    assert.deepStrictEqual((await core.list("claude", claude)).installed, []);
  });
  // Where it's installed: all your projects (user), this project shared (project), this project only you (local).
  const projA = fs.mkdtempSync(path.join(tmp, "proj-a-")), projB = fs.mkdtempSync(path.join(tmp, "proj-b-"));
  const inA = { ...claude, cwd: projA, project: true }, inB = { ...claude, cwd: projB, project: true };
  const id = "superpowers@anthropic-plugin-directory";
  await check("Claude: installed for one project (shared and only me) and for all: three rows in that project, one row elsewhere", async () => {
    for (const scope of ["project", "local", "user"]) assert.ok((await core.act("claude", inA, "install", { id, scope })).ok, scope);
    const a = await core.list("claude", inA);
    assert.deepStrictEqual(a.installed.map((p) => [p.scope, p.key, p.readOnly]).sort(), [["local", `${id}#local`, false], ["project", `${id}#project`, false], ["user", id, false]]);
    const b = await core.list("claude", inB);
    assert.deepStrictEqual(b.installed.map((p) => p.scope), ["user"]);
    // (No project open: only the plugins for all your projects.)
    assert.deepStrictEqual((await core.list("claude", claude)).installed.map((p) => p.scope), ["user"]);
  });
  await check("Claude: turn off and remove act on the scope given", async () => {
    assert.ok((await core.act("claude", inA, "disable", { id, scope: "local" })).ok);
    const a = await core.list("claude", inA);
    assert.deepStrictEqual(a.installed.map((p) => [p.scope, p.enabled]).sort(), [["local", false], ["project", true], ["user", true]]);
    assert.ok((await core.act("claude", inA, "uninstall", { id, scope: "project" })).ok);
    assert.ok((await core.act("claude", inA, "uninstall", { id, scope: "local" })).ok);
    assert.ok((await core.act("claude", inA, "uninstall", { id })).ok);
    assert.deepStrictEqual((await core.list("claude", inA)).installed, []);
  });
  await check("Claude: a project scope without an open project, or an unknown scope, is refused before running anything", async () => {
    assert.match((await core.act("claude", claude, "install", { id, scope: "project" })).error, /Open the project/);
    assert.match((await core.act("claude", inA, "install", { id, scope: "managed" })).error, /can't change/);
  });
  // ---------- Codex ----------
  await check("Codex: no plugins until you add a marketplace", async () => {
    const c = await core.list("codex", codex);
    assert.ok(!c.error, c.error); assert.deepStrictEqual([c.installed, c.available, c.marketplaces], [[], [], []]);
  });
  await check("Codex: a marketplace added: its plugins, with descriptions from its catalog (Codex's list has none)", async () => {
    assert.ok((await core.market("codex", codex, "add", { source: "obra/superpowers-marketplace" })).ok);
    const c = await core.list("codex", codex);
    assert.deepStrictEqual(c.available.map((p) => p.id), ["elements-of-style@superpowers-marketplace", "superpowers@superpowers-marketplace"]);
    assert.match(c.available[0].description, /Elements of Style/);
    assert.strictEqual(c.available[1].source, "https://github.com/obra/superpowers");
    assert.deepStrictEqual(c.marketplaces.map((m) => [m.name, m.removable]), [["superpowers-marketplace", true]]);
  });
  await check("Codex: add, with the manifest's description and its folder; can't be turned off; remove", async () => {
    assert.ok((await core.act("codex", codex, "install", { id: "superpowers@superpowers-marketplace" })).ok);
    const c = await core.list("codex", codex);
    assert.strictEqual(c.installed.length, 1);
    assert.strictEqual(c.installed[0].author, "Jesse Vincent"); assert.ok(c.installed[0].path.startsWith(env.CODEX_HOME));
    assert.deepStrictEqual((await core.details("codex", codex, c.installed[0])).components[0], { kind: "Skills", count: 3, items: "brainstorming, systematic-debugging, test-driven-development" });
    assert.match((await core.act("codex", codex, "disable", { id: c.installed[0].id })).error, /remove it instead/);
    assert.ok((await core.act("codex", codex, "uninstall", { id: c.installed[0].id })).ok);
    assert.deepStrictEqual((await core.list("codex", codex)).installed, []);
    assert.ok((await core.market("codex", codex, "remove", { name: "superpowers-marketplace" })).ok);
  });
  await check("Codex: an error in words", async () => {
    assert.match((await core.act("codex", codex, "install", { id: "nope@nowhere" })).error, /was not found in marketplace/);
  });

  // ---------- Gemini (agy) ----------
  const folder = path.join(tmp, "my-plugin");
  writePlugin(folder, ".antigravity-plugin", { name: "superpowers", version: "7.0.0", description: "Skills for Gemini" });
  await check("Gemini: a folder is checked first (its name and what it adds)", async () => {
    const c = await core.checkFolder(agy, folder);
    assert.strictEqual(c.name, "superpowers"); assert.strictEqual(c.components.skills, 3); assert.deepStrictEqual(c.errors, []);
  });
  await check("Gemini: a folder that isn't a plugin: what's wrong, and nothing is added", async () => {
    const empty = fs.mkdtempSync(path.join(tmp, "empty-"));
    assert.match((await core.checkFolder(agy, empty)).errors[0], /no plugin\.json found/);
    assert.match((await core.installFolder(agy, empty)).error, /no plugin\.json found/);
    assert.deepStrictEqual((await core.list("agy", agy)).installed, []);
  });
  await check("Gemini: added from the folder, with its skills and description", async () => {
    const r = await core.installFolder(agy, folder);
    assert.ok(r.ok, JSON.stringify(r));
    const g = await core.list("agy", agy);
    assert.strictEqual(g.installed.length, 1);
    assert.deepStrictEqual(g.installed[0].skills, ["brainstorming", "systematic-debugging", "test-driven-development"]);
    assert.strictEqual(g.installed[0].description, "Skills for Gemini"); assert.strictEqual(g.installed[0].id, "superpowers");
  });
  await check("Gemini: turned off and on (agy prints nothing: Kural reads the list again)", async () => {
    assert.ok((await core.act("agy", agy, "disable", { id: "superpowers" })).ok);
    assert.strictEqual((await core.list("agy", agy)).installed[0].enabled, false);
    assert.ok((await core.act("agy", agy, "enable", { id: "superpowers" })).ok);
  });
  await check("Gemini: removing one that's already gone counts as done (agy says nothing and exits 0 either way: the list decides)", async () => {
    assert.ok((await core.act("agy", agy, "uninstall", { id: "not-there" })).ok);
    assert.strictEqual((await core.list("agy", agy)).installed.length, 1);
  });
  await check("Gemini: removed", async () => {
    assert.ok((await core.act("agy", agy, "uninstall", { id: "superpowers" })).ok);
    assert.deepStrictEqual((await core.list("agy", agy)).installed, []);
  });
  await check("Gemini: a Git address must be https (ssh, file:// and ext:: run or reach other things)", async () => {
    for (const bad of ["git@github.com:obra/superpowers.git", "file:///etc", "ext::sh -c touch% /tmp/x", "http://example.com/x.git", "-u https://x/y"])
      assert.match((await core.cloneForAgy(agy, bad, tmp)).error, /https:\/\//, bad);
  });

  // ---------- refused before anything runs ----------
  await check("odd plugin names are refused without running the program", async () => {
    for (const id of ["--help", "a b", "x@y@z", "", "../up@mp", "-y@mp"]) assert.ok((await core.act("claude", claude, "install", { id })).error, id);
  });
  await check("marketplace sources: owner/repo, https, or an existing folder", () => {
    assert.strictEqual(core.marketSource("obra/superpowers-marketplace").source, "obra/superpowers-marketplace");
    assert.strictEqual(core.marketSource("https://github.com/obra/superpowers-marketplace.git").source, "https://github.com/obra/superpowers-marketplace.git");
    assert.strictEqual(core.marketSource(tmp).source, tmp);
    for (const bad of ["--evil", "obra/", "ssh://x/y", "git@github.com:a/b", "/no/such/folder/here", "a/b/c"]) assert.ok(core.marketSource(bad).error, bad);
  });
  await check("an AI without plugins, or not set up", async () => {
    assert.ok((await core.list("ollama", claude)).error); assert.strictEqual((await core.list("claude", { bin: null })).error, "not installed");
  });

  // ---------- the real `claude plugin details` text ----------
  await check("`claude plugin details`: what it adds, read from Claude Code 2.1.296's own text", () => {
    const text = `Superpowers (superpowers) 6.4.2
  Description: Core skills library for Claude Code: TDD, debugging, collaboration patterns, and proven techniques
  Source: superpowers@anthropic-plugin-directory

Component inventory
  Skills (15)  brainstorming, diagnosing-superpowers, dispatching-parallel-agents, executing-plans
  Agents (0)
  Hooks (1)  SessionStart  (harness-only — no model context cost)
  MCP servers (0)
  LSP servers (0)

Projected token cost
  Always-on:   ~703 tok   added to every session

Per-component (rounded)
  component                       always-on  on-invoke
  using-git-worktrees                   ~60      ~1.6k
`;
    const d = core.parseDetails(text);
    assert.deepStrictEqual(d.components.map((c) => [c.kind, c.count]), [["Skills", 15], ["Agents", 0], ["Hooks", 1], ["MCP servers", 0], ["LSP servers", 0]]);
    assert.strictEqual(d.components[2].items, "SessionStart (harness-only — no model context cost)");
    assert.strictEqual(d.alwaysOn, "~703 tokens");
  });
  await check("versions and sources", () => {
    assert.strictEqual(core.shortVersion("6.4.2-8ca22dba9a94"), "6.4.2"); assert.strictEqual(core.shortVersion("1.0.0-beta.1"), "1.0.0-beta.1");
    assert.strictEqual(core.sourceUrl({ source: "url", url: "git@github.com:obra/x.git" }), "https://github.com/obra/x");
    assert.strictEqual(core.sourceUrl({ source: "url", url: "javascript:alert(1)" }), "");
    assert.strictEqual(core.sourceUrl({ source: "path", path: "./plugins/x" }), "");
  });
  await check("Git on a Mac without Apple's tools isn't used (it would open Apple's install window)", async () => {
    // (PATH with no git, a "Mac" whose xcode-select fails: no git.)
    const g = await require("../extension/lib/git").findGit({ PATH: tmp }, "linux");
    assert.strictEqual(g, null);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `plugins: ${fail} FAILED` : "plugins: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
