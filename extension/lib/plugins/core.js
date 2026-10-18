// AI plugins: the skills, commands, agents, hooks and MCP servers an AI program loads, for the Plugins tab beside
// Extensions (lib/plugins/index.js). Each AI has its own plugin manager and Kural runs it, the way the connectors run
// `claude mcp`. No vscode here (the tests use test/fake-claude.js, fake-codex.js and fake-agy.js).
//   Claude:  `claude plugin list --json --available` → {installed, available} (Anthropic's plugin directory is built in,
//            plus the marketplaces you added); `install|uninstall|enable|disable|update <id> --json` → one JSON line,
//            outcome "ok" | "failed"; `details <id>` → text (what it adds, its token cost; installed plugins only);
//            `marketplace list --json`, `marketplace add <source> --json`, `marketplace remove <name> --json`.
//   Codex:   `codex plugin list --json --available`, `add|remove <id> --json`, `marketplace list|add|remove --json`.
//            No enable/disable command, and its list has no descriptions: they come from each marketplace's catalog
//            (.agents/plugins/marketplace.json or .claude-plugin/marketplace.json) and the plugin's own manifest.
//   Gemini:  `agy plugin list --json`, `install <folder>`, `uninstall|enable|disable <name>`, `validate <folder> --json`.
//            No catalog and no marketplaces: a plugin comes from a folder, or a Git address Kural clones first.
//            enable/disable print nothing and uninstall of an unknown name still exits 0: the list is read again.
// Checked on 18 Oct 2026 with Claude Code 2.1.296, codex-cli 0.160.0 and agy 1.4.2, in throwaway config folders.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const AIS = ["claude", "codex", "agy"];
// What each AI's plugin manager can do (the page shows only those buttons and sections).
const CAN = {
  claude: { available: true, toggle: true, update: true, marketplaces: true, folder: false, git: false },
  codex: { available: true, toggle: false, update: false, marketplaces: true, folder: false, git: false },
  agy: { available: false, toggle: true, update: false, marketplaces: false, folder: true, git: true },
};
// Marketplaces a program has without being told (not in its marketplace list, can't be removed).
const BUILT_IN = { "anthropic-plugin-directory": "Anthropic's plugin directory" };

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// "name" or "name@marketplace" (never starting with "-": it would be read as an option).
function validId(id) {
  const parts = String(id || "").split("@");
  return parts.length <= 2 && parts.every((x) => NAME.test(x));
}
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/;

function run(bin, args, env, { timeout = 120000, cwd = os.tmpdir() } = {}) {
  // (A .js program, like the tests' fakes, runs with Kural's own Node.)
  const js = /\.js$/i.test(bin);
  const file = js ? process.execPath : bin, all = js ? [bin, ...args] : args;
  return new Promise((resolve) => {
    try {
      // (Claude's directory lists 3,500 plugins: well over a megabyte of JSON.)
      const p = execFile(file, all, { cwd, env: { ...(env || process.env), ...(js ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
        timeout, encoding: "utf8", windowsHide: true, maxBuffer: 64 << 20 }, (error, stdout, stderr) =>
        resolve({ ok: !error, stdout: stdout || "", stderr: stderr || "", timeout: !!(error && error.killed) }));
      // (Nothing to type: a program that asks something gets "end of input" and stops, instead of waiting forever.)
      if (p.stdin) { p.stdin.on("error", () => {}); p.stdin.end(); }
    } catch (e) { resolve({ ok: false, stdout: "", stderr: e.message, timeout: false }); }
  });
}

const json = (text) => { try { return JSON.parse(String(text || "").trim()); } catch { return undefined; } };
// The last line that is a JSON object: Claude prints its result line after progress lines for some commands. Codex
// prints one JSON object over several lines (the whole text then).
function lastJson(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i][0] !== "{") continue;
    const v = json(lines[i]);
    if (v && typeof v === "object") return v;
  }
  const v = json(text);
  return v && typeof v === "object" ? v : null;
}
// (Colors and the marks programs put before a message: ✘ Failed…, [ok], ✔.)
const plain = (s) => String(s || "").replace(/\x1b\[[0-9;]*m/g, "").replace(/^\s*(?:[✘✔✓✗×!]|\[(?:ok|error)\])\s*/gim, "");
// What went wrong, in one line: the program's own "Error: …" line, else its last line.
function why(r, fallback) {
  if (r && r.timeout) return "It took too long to answer.";
  const lines = [r && r.stderr, r && r.stdout].map(plain).join("\n").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l[0] !== "{" && l[0] !== "}");
  const line = lines.find((l) => /^error\b/i.test(l)) || lines.slice(-1)[0] || fallback || "It didn't work.";
  return line.replace(/^error:\s*/i, "").slice(0, 400);
}

const str = (v, max = 300) => typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
const who = (a) => typeof a === "string" ? str(a, 120) : a && typeof a === "object" ? str(a.name, 120) : "";
// "6.4.2-8ca22dba9a94" (Claude adds the commit it installed) → "6.4.2"
const shortVersion = (v) => str(v, 64).replace(/-[0-9a-f]{7,40}$/i, "");
const webUrl = (u) => typeof u === "string" && /^https?:\/\/[^\s"<>]+$/i.test(u.trim()) ? u.trim().slice(0, 500) : "";
// A plugin's source as an address you can open: { source: "url" | "git", url } or { source: "github", repo }.
function sourceUrl(s) {
  if (typeof s === "string") return webUrl(s);
  if (!s || typeof s !== "object") return "";
  if (typeof s.repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(s.repo)) return `https://github.com/${s.repo}`;
  const u = typeof s.url === "string" ? s.url.trim() : "";
  const ssh = /^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(u);
  return ssh ? `https://github.com/${ssh[1]}` : webUrl(u.replace(/\.git$/i, ""));
}

function readJson(file, max = 1 << 20) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > max) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch { return null; }
}
// A plugin's own description of itself: the first manifest found, in the AI's order (one repository often carries one
// for several programs: .claude-plugin, .codex-plugin, .antigravity-plugin…).
const MANIFESTS = {
  claude: [".claude-plugin/plugin.json", "plugin.json"],
  codex: [".codex-plugin/plugin.json", ".claude-plugin/plugin.json", "plugin.json"],
  agy: [".antigravity-plugin/plugin.json", ".gemini-plugin/plugin.json", "plugin.json"],
};
function manifest(dir, ai) {
  if (!dir || typeof dir !== "string") return {};
  for (const f of MANIFESTS[ai] || MANIFESTS.claude) {
    const m = readJson(path.join(dir, f));
    if (!m || typeof m !== "object") continue;
    const repo = typeof m.repository === "string" ? m.repository : m.repository && m.repository.url;
    return { description: str(m.description, 2000), author: who(m.author), homepage: webUrl(m.homepage) || webUrl(repo), license: str(m.license, 60) };
  }
  return {};
}

// One plugin, the same shape for every AI.
function plugin(o) {
  return {
    id: o.id, name: str(o.name, 128) || String(o.id).split("@")[0], marketplace: str(o.marketplace, 128),
    version: shortVersion(o.version), fullVersion: str(o.version, 64), description: str(o.description, 2000),
    author: str(o.author, 120), homepage: webUrl(o.homepage), license: str(o.license, 60), source: webUrl(o.source),
    installed: !!o.installed, enabled: o.installed ? o.enabled !== false : false, scope: o.scope || (o.installed ? "user" : ""),
    // Kural adds and changes plugins for you (user scope); one a project set up is shown but left to that project.
    readOnly: !!(o.scope && o.scope !== "user"), installable: o.installable !== false,
    path: typeof o.path === "string" ? o.path : "", skills: Array.isArray(o.skills) ? o.skills : undefined,
  };
}
const byName = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

// The marketplaces list, built-in ones first (named by the plugins that come from them).
function withBuiltIns(listed, plugins) {
  const have = new Set(listed.map((m) => m.name)), built = [];
  for (const p of plugins) if (p.marketplace && !have.has(p.marketplace)) {
    have.add(p.marketplace);
    built.push({ name: p.marketplace, label: BUILT_IN[p.marketplace] || p.marketplace, source: "built in", removable: false });
  }
  return [...built, ...listed];
}

const fail = (r) => ({ error: why(r, "It couldn't list its plugins.") });
const unreadable = { error: "Its answer couldn't be read (a newer version than Kural knows?)." };

async function listClaude(p) {
  const [l, m] = await Promise.all([run(p.bin, ["plugin", "list", "--json", "--available"], p.env, { cwd: p.cwd, timeout: 120000 }),
    run(p.bin, ["plugin", "marketplace", "list", "--json"], p.env, { cwd: p.cwd, timeout: 60000 })]);
  if (!l.ok) return fail(l);
  const d = json(l.stdout);
  if (!d || !Array.isArray(d.installed)) return unreadable;
  const installed = d.installed.filter((x) => x && validId(x.id) && x.id.includes("@")).map((x) => {
    const [name, marketplace] = x.id.split("@");
    return plugin({ id: x.id, name, marketplace, version: x.version, installed: true, enabled: x.enabled, scope: str(x.scope, 20) || "user",
      path: x.installPath, ...manifest(x.installPath, "claude") });
  });
  const available = (Array.isArray(d.available) ? d.available : []).filter((x) => x && validId(x.pluginId) && x.pluginId.includes("@"))
    .map((x) => plugin({ id: x.pluginId, name: x.name, marketplace: x.marketplaceName || x.pluginId.split("@")[1], version: x.version,
      description: x.description, source: sourceUrl(x.source) }));
  const ml = json(m.stdout);
  const listed = (Array.isArray(ml) ? ml : []).filter((x) => x && NAME.test(x.name || ""))
    .map((x) => ({ name: x.name, label: x.name, source: str(x.repo || x.url || x.path || (typeof x.source === "string" ? x.source : ""), 300), removable: true }));
  return { installed: installed.sort(byName), available: available.sort(byName), marketplaces: withBuiltIns(listed, [...installed, ...available]) };
}

// Codex keeps an installed plugin in <CODEX_HOME>/plugins/cache/<marketplace>/<name>/<version>.
const codexHome = (env) => (env && env.CODEX_HOME) || path.join(os.homedir(), ".codex");
async function listCodex(p) {
  const [l, m] = await Promise.all([run(p.bin, ["plugin", "list", "--json", "--available"], p.env, { timeout: 120000 }),
    run(p.bin, ["plugin", "marketplace", "list", "--json"], p.env, { timeout: 60000 })]);
  if (!l.ok) return fail(l);
  const d = json(l.stdout);
  if (!d || !Array.isArray(d.installed)) return unreadable;
  const mk = json(m.stdout), markets = mk && Array.isArray(mk.marketplaces) ? mk.marketplaces.filter((x) => x && NAME.test(x.name || "")) : [];
  // Descriptions from each marketplace's catalog (Codex's own, or Claude's: Codex reads both).
  const about = new Map();
  for (const x of markets) {
    if (typeof x.root !== "string") continue;
    const cat = readJson(path.join(x.root, ".agents", "plugins", "marketplace.json"), 8 << 20) || readJson(path.join(x.root, ".claude-plugin", "marketplace.json"), 8 << 20);
    for (const e of cat && Array.isArray(cat.plugins) ? cat.plugins : []) {
      if (e && NAME.test(e.name || "")) about.set(`${e.name}@${x.name}`, { description: e.description, author: who(e.author) });
    }
  }
  const home = codexHome(p.env);
  const one = (x, installed) => {
    const [name, marketplace] = x.pluginId.split("@");
    const dir = installed && marketplace && VERSION.test(String(x.version || "")) && x.version !== ".." ? path.join(home, "plugins", "cache", marketplace, name, x.version) : "";
    const man = dir ? manifest(dir, "codex") : {}, a = about.get(x.pluginId) || {};
    return plugin({ id: x.pluginId, name: x.name || name, marketplace: x.marketplaceName || marketplace, version: x.version,
      description: man.description || a.description, author: man.author || a.author, homepage: man.homepage, license: man.license,
      source: sourceUrl(x.source), installed, enabled: x.enabled, installable: !x.installPolicy || x.installPolicy === "AVAILABLE",
      path: dir && fs.existsSync(dir) ? dir : "" });
  };
  const ok = (x) => x && validId(x.pluginId) && x.pluginId.includes("@");
  const installed = d.installed.filter(ok).map((x) => one(x, true));
  const have = new Set(installed.map((x) => x.id));
  const available = (Array.isArray(d.available) ? d.available : []).filter((x) => ok(x) && !have.has(x.pluginId) && !x.installed).map((x) => one(x, false));
  const listed = markets.map((x) => ({ name: x.name, label: x.name, source: str(x.marketplaceSource && x.marketplaceSource.source || "", 300), removable: true }));
  return { installed: installed.sort(byName), available: available.sort(byName), marketplaces: withBuiltIns(listed, [...installed, ...available]) };
}

async function listAgy(p) {
  const l = await run(p.bin, ["plugin", "list", "--json"], p.env, { timeout: 60000 });
  if (!l.ok) return fail(l);
  const d = json(l.stdout);
  if (!Array.isArray(d)) return unreadable;
  const installed = d.filter((x) => x && NAME.test(x.name || "")).map((x) => plugin({ id: x.name, name: x.name, version: x.version,
    installed: true, enabled: x.enabled, path: x.path, skills: Array.isArray(x.skills) ? x.skills.filter((s) => typeof s === "string").map((s) => str(s, 100)).slice(0, 300) : [],
    ...manifest(x.path, "agy") }));
  return { installed: installed.sort(byName), available: [], marketplaces: [] };
}

// An AI's plugins: { installed, available, marketplaces } or { error }. p: { bin, env, cwd } (cwd: the trusted project,
// so Claude lists the plugins that project set up too).
async function list(ai, p) {
  if (!CAN[ai]) return { error: "This AI doesn't use plugins." };
  if (!p || !p.bin) return { error: "not installed" };
  try { return ai === "claude" ? await listClaude(p) : ai === "codex" ? await listCodex(p) : await listAgy(p); }
  catch (e) { return { error: e.message }; }
}

// owner/repo (GitHub), an https Git address, or a folder on this computer: { source } or { error } in words.
function marketSource(s) {
  s = String(s || "").trim();
  if (/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(s) && !s.endsWith("/")) return { source: s };
  if (/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/[^\s"'<>]+$/.test(s)) return { source: s };
  if (path.isAbsolute(s)) {
    try { if (fs.statSync(s).isDirectory()) return { source: s }; } catch { /* no such folder */ }
    return { error: "That folder isn't there." };
  }
  return { error: "Write owner/repo (a GitHub repository), an https:// Git address, or the full path of a folder." };
}
// A Git address Kural may clone for Gemini: https only (no ssh://, file:// or ext::, which runs a command).
const gitUrl = (s) => /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/[^\s"'<>]+$/.test(String(s || "").trim());

// Claude's result line: ok, or what it said. A plugin whose marketplace declares a command to run (to install it or to
// fetch it) has to be shown to a person first: Claude reports the command and its sha256 instead (shownCommand), and
// the same run with --accept-command <sha256> goes ahead for exactly that command.
function claudeResult(r) {
  const res = lastJson(r.stdout);
  if (res && res.outcome === "ok") return { ok: true, message: str(res.message, 400) };
  const shown = res && res.shownCommand;
  if (shown && typeof shown === "object" && /^[0-9a-f]{64}$/i.test(String(shown.sha256 || ""))) {
    const text = [shown.command, shown.display, shown.text].find((x) => typeof x === "string" && x.trim())
      || JSON.stringify(Object.fromEntries(Object.entries(shown).filter(([k]) => k !== "sha256")));
    return { confirm: { command: String(text).slice(0, 2000), sha256: shown.sha256 } };
  }
  return { error: str(res && res.message, 400) || why(r) };
}
const codexResult = (r) => r.ok && lastJson(r.stdout) ? { ok: true } : { error: why(r) };

// Do something to one plugin: what = install | uninstall | enable | disable | update. arg: { id, accept? (Claude: the
// sha256 of a command you were shown) }. → { ok, message? } | { error } | { confirm: { command, sha256 } }
async function act(ai, p, what, arg = {}) {
  const id = arg.id;
  if (!CAN[ai] || !p || !p.bin) return { error: "Set it up first (Get started)." };
  if (!validId(id)) return { error: "Kural can't tell which plugin that is." };
  const can = CAN[ai];
  if ((what === "enable" || what === "disable") && !can.toggle) return { error: "This AI can't turn a plugin off: remove it instead." };
  if (what === "update" && !can.update) return { error: "This AI updates its plugins by itself." };
  if (ai === "claude") {
    if (!["install", "uninstall", "enable", "disable", "update"].includes(what)) return { error: "Unknown action." };
    const accept = /^[0-9a-f]{64}$/i.test(String(arg.accept || "")) ? ["--accept-command", arg.accept] : [];
    const r = await run(p.bin, ["plugin", what, id, "--json", ...(what === "install" || what === "update" ? accept : [])], p.env, { cwd: p.cwd, timeout: 300000 });
    return claudeResult(r);
  }
  if (ai === "codex") {
    if (what !== "install" && what !== "uninstall") return { error: "Unknown action." };
    if (!id.includes("@")) return { error: "Kural can't tell which marketplace that plugin is from." };
    return codexResult(await run(p.bin, ["plugin", what === "install" ? "add" : "remove", id, "--json"], p.env, { timeout: 300000 }));
  }
  // Gemini (install goes through installFolder / installGit: a plugin comes from a folder)
  if (!["uninstall", "enable", "disable"].includes(what)) return { error: "Unknown action." };
  if (!NAME.test(id)) return { error: "Kural can't tell which plugin that is." };
  const r = await run(p.bin, ["plugin", what, id], p.env, { timeout: 60000 });
  const after = await listAgy(p);
  if (after.error) return r.ok ? { error: after.error } : { error: why(r) };
  const now = after.installed.find((x) => x.name === id);
  const done = what === "uninstall" ? !now : !!now && now.enabled === (what === "enable");
  return done ? { ok: true, message: what === "uninstall" ? `Removed ${id}.` : "" } : { error: r.ok ? `Gemini didn't ${what} ${id}.` : why(r) };
}

// A marketplace (Claude, Codex): what = add (arg.source) | remove (arg.name).
async function market(ai, p, what, arg = {}) {
  if (!CAN[ai] || !CAN[ai].marketplaces) return { error: "This AI has no marketplaces." };
  if (!p || !p.bin) return { error: "Set it up first (Get started)." };
  let target;
  if (what === "add") { const s = marketSource(arg.source); if (s.error) return s; target = s.source; }
  else if (what === "remove") { if (!NAME.test(String(arg.name || "")) || BUILT_IN[arg.name]) return { error: "Kural can't remove this one." }; target = arg.name; }
  else return { error: "Unknown action." };
  // (--: a source is never read as an option; clones can take a while.)
  const r = await run(p.bin, ["plugin", "marketplace", what, "--json", "--", target], p.env, { cwd: p.cwd, timeout: 300000 });
  return ai === "claude" ? claudeResult(r) : codexResult(r);
}

// What a plugin folder holds, by its usual layout (skills/<name>/SKILL.md, agents/*.md, commands/*.md, hooks, .mcp.json).
function inventory(dir) {
  const entries = (sub) => { try { return fs.readdirSync(path.join(dir, sub), { withFileTypes: true }); } catch { return []; } };
  const skills = entries("skills").filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, "skills", e.name, "SKILL.md"))).map((e) => e.name).sort();
  const md = (sub) => entries(sub).filter((e) => e.isFile() && /\.md$/i.test(e.name)).map((e) => e.name.replace(/\.md$/i, "")).sort();
  const mcp = readJson(path.join(dir, ".mcp.json"));
  const servers = mcp && mcp.mcpServers && typeof mcp.mcpServers === "object" ? Object.keys(mcp.mcpServers) : [];
  const hooks = fs.existsSync(path.join(dir, "hooks", "hooks.json")) || fs.existsSync(path.join(dir, "hooks.json"));
  return [{ kind: "Skills", items: skills }, { kind: "Agents", items: md("agents") }, { kind: "Commands", items: md("commands") },
    { kind: "Hooks", items: hooks ? ["(runs commands at certain moments)"] : [] }, { kind: "MCP servers", items: servers }]
    .map((c) => ({ kind: c.kind, count: c.kind === "Hooks" ? (hooks ? 1 : 0) : c.items.length, items: c.items.slice(0, 100).join(", ") }));
}

// `claude plugin details <id>`:
//   Superpowers (superpowers) 6.4.2
//   Component inventory
//     Skills (15)  brainstorming, diagnosing-superpowers, …
//     Hooks (1)  SessionStart  (harness-only — no model context cost)
//   Projected token cost
//     Always-on:   ~703 tok   added to every session
function parseDetails(text) {
  const t = plain(text), components = [];
  let inside = false;
  for (const l of t.split(/\r?\n/)) {
    if (/^\s*Component inventory/i.test(l)) { inside = true; continue; }
    if (/^\S/.test(l)) inside = false;
    const m = inside && /^\s+([A-Za-z][A-Za-z ]*?) \((\d+)\)(?:\s+(.+))?$/.exec(l);
    if (m) components.push({ kind: m[1], count: Number(m[2]), items: str(m[3] || "", 3000) });
  }
  const always = /Always-on:\s*(~?[\d.,]+\s*k?\s*tok)/i.exec(t);
  return { components, alwaysOn: always ? always[1].replace(/\s+/g, " ").replace(/tok$/, "tokens") : "" };
}

// What a plugin adds (installed ones: Claude says, else its folder is looked at). → { components, alwaysOn? } | {}
async function details(ai, p, pl) {
  if (!pl || !pl.installed) return {};
  if (ai === "claude" && p && p.bin && validId(pl.id)) {
    const r = await run(p.bin, ["plugin", "details", pl.id], p.env, { cwd: p.cwd, timeout: 60000 });
    if (r.ok) { const d = parseDetails(r.stdout); if (d.components.length) return d; }
  }
  if (ai === "agy" && p && p.bin && pl.path) {
    const v = lastJson((await run(p.bin, ["plugin", "validate", pl.path, "--json"], p.env, { timeout: 60000 })).stdout);
    if (v && v.components && typeof v.components === "object") {
      const names = { skills: "Skills", agents: "Agents", hooks: "Hooks", mcpServers: "MCP servers", rules: "Rules" };
      return { components: Object.entries(names).map(([k, kind]) => ({ kind, count: Number(v.components[k]) || 0, items: k === "skills" && pl.skills ? pl.skills.join(", ") : "" })) };
    }
  }
  return pl.path ? { components: inventory(pl.path) } : {};
}

// ---------- Gemini: a plugin from a folder or a Git address ----------
// What agy says about a folder before it's added: { name, components, errors, warnings } or { error }.
async function checkFolder(p, dir) {
  if (!p || !p.bin) return { error: "Set it up first (Get started)." };
  if (typeof dir !== "string" || !path.isAbsolute(dir)) return { error: "Pick the plugin's folder." };
  const r = await run(p.bin, ["plugin", "validate", dir, "--json"], p.env, { timeout: 60000 });
  const v = lastJson(r.stdout);
  if (!v || typeof v !== "object") return { error: why(r, "Gemini couldn't read that folder as a plugin.") };
  const findings = Array.isArray(v.findings) ? v.findings.filter((f) => f && typeof f === "object") : [];
  const say = (f) => `${str(f.file, 120) ? str(f.file, 120) + ": " : ""}${str(f.message, 300)}`;
  return { name: NAME.test(v.name || "") ? v.name : "", components: v.components && typeof v.components === "object" ? v.components : {},
    errors: findings.filter((f) => f.severity === "error").map(say), warnings: findings.filter((f) => f.severity === "warning").map(say) };
}
async function installFolder(p, dir) {
  const c = await checkFolder(p, dir);
  if (c.error) return c;
  if (c.errors.length) return { error: c.errors[0] };
  const r = await run(p.bin, ["plugin", "install", dir], p.env, { timeout: 120000 });
  const after = await listAgy(p);
  return !after.error && after.installed.some((x) => x.name === c.name) ? { ok: true, name: c.name } : { error: why(r, "Gemini didn't add the plugin.") };
}

// Git: Homebrew's or another one on PATH first; on a Mac /usr/bin/git only when Apple's command line tools are there
// (without them it opens Apple's "install the tools?" window).
async function findGit(env, platform = process.platform) {
  const dirs = String((env && env.PATH) || process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const exe = platform === "win32" ? "git.exe" : "git";
  const list = [...(platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : []), ...dirs].map((d) => path.join(d, exe));
  for (const g of [...new Set(list)]) {
    if (platform === "darwin" && g === "/usr/bin/git") continue;
    try { fs.accessSync(g, fs.constants.X_OK); return g; } catch { /* not here */ }
  }
  if (platform === "darwin" && fs.existsSync("/usr/bin/git")) {
    const tools = await run("/usr/bin/xcode-select", ["-p"], env, { timeout: 5000 });
    if (tools.ok) return "/usr/bin/git";
  }
  return null;
}
// Clones url into a private folder and checks it: { dir, name, components, errors, warnings, done() } or { error }.
// (https only; no symbolic links checked out, so a link in the repository can't point Gemini's copy at your files.)
async function cloneForAgy(p, url, tmpRoot) {
  url = String(url || "").trim();
  if (!gitUrl(url)) return { error: "Give an https:// address of a Git repository." };
  const env = { ...((p && p.env) || process.env), GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
  const git = await findGit(env);
  if (!git) return { error: process.platform === "darwin" ? "Git isn't installed. Install Apple's command line tools (run xcode-select --install in a terminal) or Git, then try again." : "Git isn't installed. Install Git, then try again." };
  const base = fs.mkdtempSync(path.join(tmpRoot || os.tmpdir(), "plugin-")), dir = path.join(base, "repo");
  const done = () => { try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* gone */ } };
  const r = await run(git, ["-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "core.symlinks=false",
    "clone", "--depth", "1", "--quiet", "--", url, dir], env, { timeout: 180000 });
  if (!r.ok) { done(); return { error: why(r, "It couldn't be downloaded.") }; }
  const c = await checkFolder(p, dir);
  if (c.error) { done(); return c; }
  return { ...c, dir, done };
}

module.exports = { AIS, CAN, BUILT_IN, NAME, validId, run, list, act, market, details, parseDetails, inventory, manifest, sourceUrl,
  shortVersion, marketSource, gitUrl, checkFolder, installFolder, cloneForAgy, findGit, lastJson, why };
