// What a plugin holds, for its page (extension/lib/plugins/contents.js + extension/media/plugin-details.js):
//   - where a marketplace's source is on GitHub (url, git-subdir, github), and what isn't GitHub or is odd
//   - front matter (plain, quoted, | and > blocks)
//   - a folder: skills, commands (nested → a:b), agents, hooks with what they run, MCP servers with their command,
//     the manifest's own places, the README; a link out of the folder isn't followed
//   - GitHub (a stand-in fetch): one API request for the file list (the plugin's own folder), raw files for the rest,
//     read once per commit; GitHub's limit and a missing repository in words, and a failure isn't kept
//   - core: a listed plugin carries its origin (its own folder's address for git-subdir); an installed one's details
//     add each part with its description
//   - the page draws it all as text: the README's HTML and javascript: links come out as text, pictures as links
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), vm = require("vm");
const c = require("../extension/lib/plugins/contents");
const core = require("../extension/lib/plugins/core");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.stack); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-contents-"));
const write = (root, files) => { for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); } };

const PLUGIN = {
  ".claude-plugin/plugin.json": JSON.stringify({ name: "demo", description: "A demo plugin", author: { name: "Ada" }, license: "MIT", commands: ["./cmds"] }),
  "skills/brainstorming/SKILL.md": "---\nname: brainstorming\ndescription: Use before creative work\n---\nbody",
  "skills/tdd/SKILL.md": "---\nname: \"test-driven-development\"\ndescription: |\n  Write the test first,\n  then the code.\n---\n",
  "skills/tdd/extra.md": "not a skill",
  "cmds/plan.md": "---\ndescription: Write a plan\n---\n",
  "cmds/git/commit.md": "---\ndescription: >-\n  Commit the work\n---\n",
  "commands/ignored.md": "---\ndescription: not a place the manifest names\n---\n",
  "agents/reviewer.md": "---\nname: code-reviewer\ndescription: 'Reviews code'\n---\n",
  "agents/README.md": "# agents",
  "hooks/hooks.json": JSON.stringify({ hooks: { SessionStart: [{ matcher: "startup|clear", hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/hooks/start" }] }],
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "check.sh" }] }] } }),
  ".mcp.json": JSON.stringify({ mcpServers: { db: { command: "npx", args: ["-y", "db-server"], env: { DB_TOKEN: "" } }, docs: { type: "http", url: "https://docs.example.com/mcp" } } }),
  "README.md": "# Demo\n\nHello <b>there</b>.",
};

(async () => {
  await check("GitHub origins: url, git-subdir, github; others aren't GitHub", () => {
    assert.deepStrictEqual(c.githubOrigin({ source: "url", url: "https://github.com/obra/superpowers.git", sha: "abc123" }), { owner: "obra", repo: "superpowers", ref: "abc123", dir: "" });
    assert.deepStrictEqual(c.githubOrigin({ source: "git-subdir", url: "https://github.com/anthropics/claude-plugins-official", path: "plugins/frontend-design", sha: "a0b0" }),
      { owner: "anthropics", repo: "claude-plugins-official", ref: "a0b0", dir: "plugins/frontend-design" });
    assert.deepStrictEqual(c.githubOrigin({ source: "github", repo: "o/r" }), { owner: "o", repo: "r", ref: "HEAD", dir: "" });
    assert.deepStrictEqual(c.githubOrigin({ source: "url", url: "git@github.com:o/r.git" }), { owner: "o", repo: "r", ref: "HEAD", dir: "" });
    for (const bad of [{ source: "url", url: "https://gitlab.com/o/r.git" }, { source: "url", url: "https://github.com/o/r/../x" }, { source: "git-subdir", url: "https://github.com/o/r", path: "../../etc" },
      { source: "path", path: "./x" }, "https://github.com/o/r", null]) assert.strictEqual(c.githubOrigin(bad), null, JSON.stringify(bad));
    assert.strictEqual(c.githubOrigin({ source: "url", url: "https://github.com/o/r", sha: "../x" }).ref, "HEAD");
    assert.strictEqual(c.treeUrl({ owner: "o", repo: "r", ref: "HEAD", dir: "" }), "https://github.com/o/r");
    assert.strictEqual(c.treeUrl({ owner: "o", repo: "r", ref: "abc", dir: "plugins/x" }), "https://github.com/o/r/tree/abc/plugins/x");
  });

  await check("front matter: plain, quoted, | and > blocks; none", () => {
    assert.deepStrictEqual(c.frontMatter("---\nname: a\ndescription: \"b: c\"\n---\n"), { name: "a", description: "b: c" });
    assert.strictEqual(c.frontMatter("---\ndescription: |\n  one\n  two\nname: x\n---\n").description, "one two");
    assert.strictEqual(c.frontMatter("---\ndescription: >-\n  folded\n---").description, "folded");
    assert.deepStrictEqual(c.frontMatter("# no front matter"), {});
  });

  const dir = path.join(tmp, "demo");
  write(dir, PLUGIN);
  fs.mkdirSync(path.join(tmp, "outside", "skills", "secret"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "outside", "skills", "secret", "SKILL.md"), "---\nname: secret\n---\n");
  try { fs.symlinkSync(path.join(tmp, "outside", "skills", "secret"), path.join(dir, "skills", "linked")); } catch { /* no links here */ }

  await check("a folder: each part with its description, the manifest's places, hooks and servers with what they run, the README", async () => {
    const d = await c.fromFolder(dir);
    const g = Object.fromEntries(d.groups.map((x) => [x.kind, x.items]));
    assert.deepStrictEqual(d.groups.map((x) => x.kind), ["Skills", "Commands", "Agents", "Hooks", "MCP servers"]);
    assert.deepStrictEqual(g.Skills.map((s) => [s.name, s.about]), [["brainstorming", "Use before creative work"], ["test-driven-development", "Write the test first, then the code."]]);
    assert.deepStrictEqual(g.Commands.map((s) => [s.name, s.about]), [["/git:commit", "Commit the work"], ["/plan", "Write a plan"]]);
    assert.deepStrictEqual(g.Agents.map((s) => s.name), ["code-reviewer"]);
    assert.deepStrictEqual(g.Hooks.map((h) => [h.name, h.about, h.detail]), [["SessionStart", "When: startup|clear", "${CLAUDE_PLUGIN_ROOT}/hooks/start"], ["PreToolUse", "When: Bash", "check.sh"]]);
    assert.deepStrictEqual(g["MCP servers"].map((s) => [s.name, s.detail]), [["db", "npx -y db-server\nSettings it reads: DB_TOKEN"], ["docs", "https://docs.example.com/mcp"]]);
    assert.match(g["MCP servers"][0].about, /Starts a program/);
    assert.strictEqual(d.readme.text, PLUGIN["README.md"]);
    assert.deepStrictEqual([d.manifest.author, d.manifest.license], ["Ada", "MIT"]);
  });

  // ---------- GitHub, with a stand-in fetch ----------
  const o = { owner: "ada", repo: "market", ref: "abc123", dir: "plugins/demo" };
  const asked = [];
  const fake = (files, { status = 200, headers = {} } = {}) => async (url, opts) => {
    asked.push(url);
    if (url.startsWith("https://api.github.com/")) {
      if (status !== 200) return new Response("{}", { status, headers });
      return new Response(JSON.stringify({ tree: [...Object.keys(files).map((p) => ({ path: p, type: "blob" })), { path: "skills", type: "tree" }, { path: "../evil", type: "blob" }], truncated: false }));
    }
    const pre = `https://raw.githubusercontent.com/${o.owner}/${o.repo}/${o.ref}/${o.dir}/`;
    assert.ok(url.startsWith(pre), url); assert.ok(!(opts.headers || {}).Authorization);
    const f = decodeURIComponent(url.slice(pre.length));
    return f in files ? new Response(files[f]) : new Response("", { status: 404 });
  };
  await check("GitHub: one API request for the plugin's own folder, raw files for the rest; links to each file", async () => {
    asked.length = 0;
    const d = await c.fromGitHub(o, { fetchImpl: fake(PLUGIN) });
    assert.ok(!d.error, d.error);
    assert.strictEqual(asked.filter((u) => new URL(u).host === "api.github.com").length, 1);
    assert.match(asked[0], /\/repos\/ada\/market\/git\/trees\/abc123:plugins\/demo\?recursive=1$/);
    assert.deepStrictEqual(d.groups.map((x) => [x.kind, x.items.length]), [["Skills", 2], ["Commands", 2], ["Agents", 1], ["Hooks", 2], ["MCP servers", 2]]);
    assert.strictEqual(d.groups[0].items[0].web, "https://github.com/ada/market/blob/abc123/plugins/demo/skills/brainstorming/SKILL.md");
    assert.strictEqual(d.readme.base, "https://github.com/ada/market/blob/abc123/plugins/demo/");
    assert.strictEqual(d.web, "https://github.com/ada/market/tree/abc123/plugins/demo");
  });
  await check("GitHub: read once per commit (the cache), a failure not kept", async () => {
    const cache = new Map();
    asked.length = 0;
    await c.fromGitHub(o, { cache, fetchImpl: fake(PLUGIN) });
    const n = asked.length;
    await c.fromGitHub(o, { cache, fetchImpl: fake(PLUGIN) });
    assert.strictEqual(asked.length, n);
    const o2 = { ...o, ref: "def456" };
    const r = await c.fromGitHub(o2, { cache, fetchImpl: fake(PLUGIN, { status: 403, headers: { "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 600) } }) });
    assert.match(r.error, /GitHub is limiting how often Kural may ask: try again in 1[01] minutes\./);
    await new Promise((res) => setImmediate(res));
    assert.ok(!cache.has(c.originKey(o2)));
  });
  await check("GitHub: a missing repository, and no connection, in words", async () => {
    assert.match((await c.fromGitHub({ ...o, ref: "x1" }, { fetchImpl: fake(PLUGIN, { status: 404 }) })).error, /doesn't have this plugin's files/);
    assert.match((await c.fromGitHub({ ...o, ref: "x2" }, { fetchImpl: async () => { throw new TypeError("fetch failed"); } })).error, /couldn't be reached/);
  });

  // ---------- core ----------
  await check("core: a listed plugin carries where its files are; git-subdir opens its own folder", async () => {
    const env = { ...process.env, FAKE_CLAUDE_FILE: path.join(tmp, "claude-state") };
    const l = await core.list("claude", { bin: path.join(__dirname, "fake-claude.js"), env, cwd: tmp });
    const sp = l.available.find((p) => p.name === "superpowers");
    assert.deepStrictEqual(sp.origin, { owner: "obra", repo: "superpowers", ref: "8ca22dba9a94a7e1f4c0de6b37c8e7b1f2a3d4e5", dir: "" });
    const ne = l.available.find((p) => p.name === "needs-command");
    assert.strictEqual(ne.origin, null);
  });
  await check("core: an installed plugin's details add each part with its description and the README", async () => {
    const d = await core.details("codex", { bin: null }, { installed: true, id: "demo@m", path: dir });
    assert.deepStrictEqual(d.components[0], { kind: "Skills", count: 2, items: "brainstorming, tdd" });
    assert.deepStrictEqual(d.groups[0].items.map((x) => x.name), ["brainstorming", "test-driven-development"]);
    assert.match(d.readme.text, /^# Demo/);
  });

  // ---------- the page ----------
  class El {
    constructor(tag) { Object.assign(this, { tag, nodeType: tag === "#text" ? 3 : 1, kids: [], attrs: {}, on: {}, style: {}, scrollTop: 0, text: undefined }); this._cls = new Set(); }
    get className() { return [...this._cls].join(" "); } set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get classList() { const s = this._cls; return { add: (x) => s.add(x), remove: (x) => s.delete(x), contains: (x) => s.has(x) }; }
    get firstChild() { return this.kids[0]; }
    setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k]; }
    addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }
    fire(t) { for (const f of this.on[t] || []) f({ preventDefault() {}, stopPropagation() {} }); }
    append(...ks) { for (const k of ks) this.kids.push(k); }
    replaceChildren(...ks) { this.kids = []; this.append(...ks); }
    get textContent() { return this.text !== undefined ? this.text : this.kids.map((k) => k.textContent).join(""); }
  }
  const all = (n, pred, out = []) => { for (const k of n.kids || []) if (k instanceof El) { if (pred(k)) out.push(k); all(k, pred, out); } return out; };
  function page() {
    const posted = [], app = new El("div"), listeners = {};
    const document = { getElementById: () => app, createElement: (t) => new El(t), createTextNode: (s) => { const t = new El("#text"); t.text = String(s); return t; },
      documentElement: { dataset: {}, style: { setProperty() {} } }, body: new El("body") };
    const ctx = { document, console, URL, window: { addEventListener: (t, f) => { listeners[t] = f; } }, acquireVsCodeApi: () => ({ postMessage: (m) => posted.push(m) }) };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension/media/plugin-details.js"), "utf8"), ctx);
    return { app, posted, send: (m) => listeners.message({ data: m }) };
  }
  const P = { id: "demo@m", key: "demo@m", name: "demo", installed: false, installable: true, source: "https://github.com/ada/market/tree/abc123/plugins/demo", description: "A demo" };
  const msg = (info) => ({ type: "details", ai: "claude", aiName: "Claude", plugin: P, can: {}, info, busy: "", market: "m", risk: "Runs code as you." });

  await check("the page: reading, then each part (Show all past 12), the README as text, pictures and relative links to GitHub", async () => {
    const p = page();
    p.send(msg(null));
    assert.match(p.app.textContent, /Reading its files on GitHub/);
    const skills = Array.from({ length: 15 }, (_, i) => ({ name: `skill-${String(i).padStart(2, "0")}`, about: `Does ${i}` }));
    const readme = [
      "# Title <script>alert(1)</script>", "", "Some **bold** and `code` and [docs](docs/x.md) and [bad](javascript:alert(1)).", "",
      "<p align=\"center\"><img src=\"logo.png\" alt=\"Logo\"></p>", "", "- one", "- two", "  - nested", "", "| a | b |", "|---|---|", "| 1 | 2 |", "",
      "```sh", "npm i <x>", "```", "> quoted",
    ].join("\n");
    p.send(msg({ from: "github", web: P.source, groups: [{ kind: "Skills", items: skills }, { kind: "Hooks", items: [{ name: "SessionStart", about: "", detail: "run.sh" }] }],
      readme: { text: readme, base: "https://github.com/ada/market/blob/abc123/plugins/demo/" }, manifest: { author: "Ada" } }));
    const text = p.app.textContent;
    assert.match(text, /15 skills · 1 hook/);
    assert.match(text, /by Ada/);
    assert.strictEqual(all(p.app, (k) => k._cls.has("item")).length, 13);
    all(p.app, (k) => k._cls.has("more"))[0].fire("click");
    assert.strictEqual(all(p.app, (k) => k._cls.has("item")).length, 16);
    assert.strictEqual(all(p.app, (k) => k.tag === "script").length, 0);
    assert.ok(all(p.app, (k) => k.tag === "h3" && /^Title alert\(1\)$/.test(k.textContent)).length);
    const links = all(p.app, (k) => k.tag === "a").map((a) => a.attrs.title);
    assert.ok(links.includes("https://github.com/ada/market/blob/abc123/plugins/demo/docs/x.md"));
    assert.ok(links.includes("https://github.com/ada/market/blob/abc123/plugins/demo/logo.png"));
    assert.ok(!links.some((u) => /javascript/i.test(u || "")));
    assert.ok(all(p.app, (k) => k.tag === "table").length && all(p.app, (k) => k.tag === "pre" && /npm i <x>/.test(k.textContent)).length);
    assert.ok(all(p.app, (k) => k.tag === "ul").length >= 2 && all(p.app, (k) => k.tag === "blockquote").length);
    all(p.app, (k) => k.tag === "a" && /docs\/x\.md$/.test(k.attrs.title))[0].fire("click");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(p.posted.slice(-1)[0])), { type: "openLink", url: "https://github.com/ada/market/blob/abc123/plugins/demo/docs/x.md" });
  });
  await check("the page: GitHub's error in words with a link; a plugin not on GitHub says so", async () => {
    const p = page();
    p.send(msg({ error: "GitHub is limiting how often Kural may ask; try again later.", from: "github", web: P.source }));
    assert.match(p.app.textContent, /GitHub is limiting.*See it on GitHub/);
    p.send(msg({}));
    assert.match(p.app.textContent, /only look inside plugins kept on GitHub/);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `plugin-contents: ${fail} FAILED` : "plugin-contents: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
