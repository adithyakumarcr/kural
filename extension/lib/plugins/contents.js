// What a plugin holds, for its page (media/plugin-details.js): its skills, agents and commands with their own one-line
// descriptions, the hooks it runs (and what they run), its MCP servers (and the command or address of each), and its
// README. Read from the installed folder, or, for one that isn't installed, from its GitHub repository: one request to
// GitHub's API (the file list at the commit the marketplace pins) and the files themselves from raw.githubusercontent.com,
// which doesn't count toward the API's limit (60 an hour without a login). No vscode here.
// Everything read is the plugin author's text: the page shows it as text (never HTML), and links only as http(s).
// Layout (Claude Code's, which Codex and Antigravity plugins mostly follow): skills/<name>/SKILL.md, agents/*.md,
// commands/**/*.md, hooks/hooks.json, .mcp.json, or other places named in .claude-plugin/plugin.json.
const fs = require("fs");
const path = require("path");
const { fetchLimited, readCapped } = require("../update-net");

const MAX_FILES = 4000;            // a folder or repository with more is read only that far
const MAX_READS = 80;              // SKILL.md, agents and commands read for their descriptions
const README_BYTES = 256 * 1024;
const FILE_BYTES = 128 * 1024;
const TREE_BYTES = 8 * 1024 * 1024;
const MS = 15000;
const HEADERS = { "User-Agent": "Kural", Accept: "application/vnd.github+json" };

const str = (v, max = 300) => typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };

// ---------- where a plugin's GitHub copy is ----------
const SEG = /^[\w.-]+$/;
const okPath = (p) => !p || p.split("/").every((s) => SEG.test(s) && s !== "." && s !== "..");
// A marketplace's source → { owner, repo, ref, dir } (GitHub only), or null.
//   { source: "url", url: "https://github.com/o/r.git", sha }, { source: "git-subdir", url, path, sha },
//   { source: "github", repo: "o/r", ref? , sha? }
function githubOrigin(s) {
  if (!s || typeof s !== "object") return null;
  let owner, repo;
  if (typeof s.repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(s.repo)) [owner, repo] = s.repo.split("/");
  else if (typeof s.url === "string") {
    const m = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(s.url.trim());
    if (!m) return null;
    [, owner, repo] = m;
  } else return null;
  const ref = [s.sha, s.ref, s.commit].find((r) => typeof r === "string" && /^[\w./-]{1,100}$/.test(r) && !r.includes("..")) || "HEAD";
  const dir = typeof s.path === "string" ? s.path.replace(/^\.?\/+|\/+$/g, "") : "";
  if (!okPath(dir) || [owner, repo].some((x) => !SEG.test(x) || x === "." || x === "..")) return null;
  return { owner, repo, ref, dir };
}
const originKey = (o) => `${o.owner}/${o.repo}@${o.ref}:${o.dir}`;
const webBase = (o) => `https://github.com/${o.owner}/${o.repo}/blob/${o.ref}/${o.dir ? o.dir + "/" : ""}`;
const treeUrl = (o) => `https://github.com/${o.owner}/${o.repo}${o.ref === "HEAD" && !o.dir ? "" : `/tree/${o.ref}${o.dir ? "/" + o.dir : ""}`}`;

// ---------- readers: { files: [relative paths], read(rel, max) → text | null, web(rel) → address | "" } ----------
function folderReader(root) {
  const files = [];
  const walk = (dir, rel, depth) => {
    if (files.length >= MAX_FILES || depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.length >= MAX_FILES) return;
      if (e.name === ".git" || e.name === "node_modules") continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r, depth + 1);      // (links aren't followed: isDirectory of a Dirent is the link itself)
      else if (e.isFile()) files.push(r);
    }
  };
  walk(root, "", 0);
  return {
    files,
    async read(rel, max = FILE_BYTES) {
      try {
        const f = path.join(root, rel), st = fs.lstatSync(f);
        if (!st.isFile() || st.size > max) return null;
        return fs.readFileSync(f, "utf8");
      } catch { return null; }
    },
    web: () => "",
  };
}

class GitHubError extends Error {}
async function githubReader(o, { fetchImpl } = {}) {
  const get = async (url, max, headers) => {
    const res = fetchImpl ? await fetchImpl(url, { headers }) : await fetchLimited(url, { ms: MS, headers });
    return { status: res.status, ok: res.ok, headers: res.headers, text: res.ok ? (await readCapped(res, max)).toString("utf8") : "" };
  };
  // (ref:dir names the plugin's own folder, so a marketplace that holds hundreds of plugins isn't listed whole.)
  const at = encodeURIComponent(o.dir ? `${o.ref}:${o.dir}` : o.ref).replace(/%2F/g, "/").replace(/%3A/g, ":");
  let r;
  try { r = await get(`https://api.github.com/repos/${o.owner}/${o.repo}/git/trees/${at}?recursive=1`, TREE_BYTES, HEADERS); }
  catch (e) { throw new GitHubError(e && e.name === "TimeoutError" ? "GitHub took too long to answer." : "GitHub couldn't be reached."); }
  if (r.status === 403 || r.status === 429) {
    const reset = Number(r.headers && r.headers.get && r.headers.get("x-ratelimit-reset")) || 0;
    const mins = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : 0;
    throw new GitHubError(`GitHub is limiting how often Kural may ask${mins ? `: try again in ${mins} minute${mins === 1 ? "" : "s"}` : "; try again later"}.`);
  }
  if (r.status === 404 || r.status === 422) throw new GitHubError("GitHub doesn't have this plugin's files (a private or removed repository?).");
  if (!r.ok) throw new GitHubError(`GitHub answered ${r.status}.`);
  const d = parse(r.text);
  if (!d || !Array.isArray(d.tree)) throw new GitHubError("GitHub's answer couldn't be read.");
  const files = d.tree.filter((t) => t && t.type === "blob" && typeof t.path === "string" && okPath(t.path)).slice(0, MAX_FILES).map((t) => t.path);
  const raw = (rel) => `https://raw.githubusercontent.com/${o.owner}/${o.repo}/${o.ref}/${o.dir ? o.dir + "/" : ""}${rel.split("/").map(encodeURIComponent).join("/")}`;
  return {
    files, truncated: !!d.truncated,
    async read(rel, max = FILE_BYTES) {
      try { const x = await get(raw(rel), max, { "User-Agent": "Kural" }); return x.ok ? x.text : null; } catch { return null; }
    },
    web: (rel) => webBase(o) + rel,
  };
}

// ---------- reading the parts ----------
// The YAML front matter of a Markdown file: plain `key: value` lines, quoted values and | / > blocks (descriptions are
// often several lines). Enough for name and description; anything else is skipped.
function frontMatter(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(String(text || ""));
  if (!m) return {};
  const out = {}, lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^[|>][+-]?$/.test(v)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) block.push(lines[++i].trim());
      v = block.join(" ");
    } else if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1).replace(/\\"/g, '"').replace(/''/g, "'");
    else if (!v) continue;
    out[kv[1]] = v;
  }
  return out;
}

// "./custom/agents" or ["./a.md", "./b/"] from the manifest → relative folders/files inside the plugin.
function places(v, fallback) {
  const list = (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).filter((x) => typeof x === "string")
    .map((x) => x.replace(/^\.?\/+/, "").replace(/\/+$/, "")).filter((x) => x && okPath(x));
  return list.length ? list : [fallback];
}
const under = (files, place, ok) => files.filter((f) => (f === place || f.startsWith(place + "/")) && ok(f));

// Hooks as rows: one per moment (SessionStart, PreToolUse…), with what it runs.
function hookRows(h) {
  const map = h && typeof h === "object" ? (h.hooks && typeof h.hooks === "object" && !Array.isArray(h.hooks) ? h.hooks : h) : null;
  if (!map) return [];
  const rows = [];
  for (const [event, groups] of Object.entries(map)) {
    if (!/^[A-Za-z][\w-]{0,60}$/.test(event) || !Array.isArray(groups)) continue;
    const runs = [], when = [];
    for (const g of groups) {
      if (!g || typeof g !== "object") continue;
      if (str(g.matcher, 80) && g.matcher !== "*") when.push(str(g.matcher, 80));
      for (const x of Array.isArray(g.hooks) ? g.hooks : []) {
        if (x && x.type === "command" && str(x.command)) runs.push(str(x.command, 200));
        else if (x && x.type === "prompt") runs.push("a prompt to the model");
        else if (x && str(x.type, 30)) runs.push(str(x.type, 30));
      }
    }
    rows.push({ name: event, about: when.length ? `When: ${[...new Set(when)].join(", ")}` : "", detail: [...new Set(runs)].slice(0, 6).join("\n") });
  }
  return rows;
}
// MCP servers as rows: name, and the command it starts or the address it talks to.
function serverRows(m) {
  const map = m && typeof m === "object" ? (m.mcpServers && typeof m.mcpServers === "object" ? m.mcpServers : m) : null;
  if (!map) return [];
  return Object.entries(map).filter(([n, s]) => /^[\w.@-]{1,80}$/.test(n) && s && typeof s === "object" && (s.command || s.url)).map(([name, s]) => {
    const how = s.url ? str(s.url, 300) : [s.command, ...(Array.isArray(s.args) ? s.args : [])].filter((x) => typeof x === "string").join(" ");
    const kind = s.url ? (str(s.type, 20) || "web") : "runs";
    const keys = s.env && typeof s.env === "object" ? Object.keys(s.env).filter((k) => /^\w{1,60}$/.test(k)) : [];
    return { name, about: s.url ? `Connects to a server (${kind})` : "Starts a program on your computer", detail: str(how, 400) + (keys.length ? `\nSettings it reads: ${keys.join(", ")}` : "") };
  });
}

// Runs fn over items, `n` at a time.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// What the plugin holds: { groups: [{ kind, items: [{ name, about, detail? }] }], readme: { text, base } | null,
// manifest: { name, description, author, license, homepage, version }, truncated }
async function describe(reader) {
  const files = reader.files, has = new Set(files);
  const manifestFile = [".claude-plugin/plugin.json", ".codex-plugin/plugin.json", ".antigravity-plugin/plugin.json", "plugin.json"].find((f) => has.has(f));
  const man = manifestFile ? parse(await reader.read(manifestFile)) || {} : {};
  const md = (f) => /\.md$/i.test(f);
  // Skills: a folder with SKILL.md. Agents: *.md. Commands: *.md, nested folders become name:sub.
  const skillFiles = places(man.skills, "skills").flatMap((p) => under(files, p, (f) => /(^|\/)SKILL\.md$/i.test(f)));
  const agentFiles = places(man.agents, "agents").flatMap((p) => under(files, p, (f) => md(f) && !/(^|\/)README\.md$/i.test(f)));
  const commandFiles = places(man.commands, "commands").flatMap((p) => under(files, p, (f) => md(f) && !/(^|\/)README\.md$/i.test(f)));
  const want = [...new Set([...skillFiles, ...agentFiles, ...commandFiles])].slice(0, MAX_READS);
  const texts = new Map((await pool(want, 8, async (f) => [f, await reader.read(f, FILE_BYTES)])));
  const row = (f, name) => {
    const fm = frontMatter(texts.get(f));
    return { name: str(fm.name, 100) || name, about: str(fm.description, 400), web: reader.web(f) };
  };
  const base = (f) => f.split("/").pop().replace(/\.md$/i, "");
  const sortRows = (a, b) => a.name.localeCompare(b.name);
  const skills = skillFiles.map((f) => row(f, f.split("/").slice(-2, -1)[0] || base(f))).sort(sortRows);
  const agents = agentFiles.map((f) => row(f, base(f))).sort(sortRows);
  const commands = commandFiles.map((f) => {
    const place = places(man.commands, "commands").find((p) => f.startsWith(p + "/")) || "";
    const name = (place ? f.slice(place.length + 1) : base(f)).replace(/\.md$/i, "").split("/").join(":");
    const r = row(f, name);
    return { ...r, name: "/" + name };       // (a command's file name is how you call it, whatever its front matter says)
  }).sort(sortRows);

  // Hooks: the manifest's own object, a file it names, or hooks/hooks.json.
  let hooks = [];
  if (man.hooks && typeof man.hooks === "object" && !Array.isArray(man.hooks)) hooks = hookRows(man.hooks);
  else {
    const f = places(man.hooks, "hooks/hooks.json").find((x) => has.has(x)) || (has.has("hooks.json") ? "hooks.json" : "");
    if (f) hooks = hookRows(parse(await reader.read(f)));
  }
  let servers = [];
  if (man.mcpServers && typeof man.mcpServers === "object" && !Array.isArray(man.mcpServers)) servers = serverRows(man.mcpServers);
  else {
    const f = places(man.mcpServers, ".mcp.json").find((x) => has.has(x));
    if (f) servers = serverRows(parse(await reader.read(f)));
  }

  const readmeFile = files.find((f) => /^readme(\.md|\.markdown)?$/i.test(f));
  const readmeText = readmeFile ? await reader.read(readmeFile, README_BYTES) : null;
  const groups = [
    { kind: "Skills", items: skills }, { kind: "Commands", items: commands }, { kind: "Agents", items: agents },
    { kind: "Hooks", items: hooks }, { kind: "MCP servers", items: servers },
  ].filter((g) => g.items.length);
  return {
    groups,
    readme: readmeText ? { text: readmeText, base: readmeFile ? reader.web(readmeFile).replace(/[^/]*$/, "") : "" } : null,
    manifest: { name: str(man.name, 128), description: str(man.description, 2000), version: str(man.version, 64), license: str(man.license, 60),
      author: typeof man.author === "string" ? str(man.author, 120) : man.author && typeof man.author === "object" ? str(man.author.name, 120) : "" },
    truncated: !!reader.truncated || files.length >= MAX_FILES || want.length >= MAX_READS,
  };
}

// For a plugin that isn't installed: its GitHub repository, read once per commit (the cache is the caller's Map).
async function fromGitHub(o, { cache, fetchImpl } = {}) {
  const key = originKey(o);
  if (cache && cache.has(key)) return cache.get(key);
  const job = (async () => {
    try { return { ...(await describe(await githubReader(o, { fetchImpl }))), from: "github", web: treeUrl(o) }; }
    catch (e) { return { error: e instanceof GitHubError ? e.message : "Kural couldn't read this plugin's files on GitHub.", from: "github", web: treeUrl(o) }; }
  })();
  if (cache) {
    cache.set(key, job);
    // (A failure isn't kept: GitHub's limit resets, a connection comes back.)
    job.then((r) => { if (r.error) cache.delete(key); });
    if (cache.size > 60) cache.delete(cache.keys().next().value);
  }
  return job;
}
const fromFolder = async (dir) => ({ ...(await describe(folderReader(dir))), from: "folder" });

module.exports = { githubOrigin, originKey, treeUrl, frontMatter, hookRows, serverRows, describe, folderReader, githubReader, fromGitHub, fromFolder };
