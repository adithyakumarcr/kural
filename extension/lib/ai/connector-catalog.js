// The connector catalog for Kural Settings' "Add connector": a short built-in list of popular connectors (works offline)
// plus a search in the official MCP registry, and the program arguments that add one. No vscode here.
//
// Why: adding a connector used to mean writing a command. People should pick one from a list and, if it needs a key or a
// folder, fill that in. Every item (built-in or from the registry) has the same shape:
//   { id, name, description, kind: "remote" | "npm" | "pypi", url?, transport?: "http" | "sse", package?, args?,
//     inputs?: [{ key, label, secret?, env? | header? (+ prefix?) | arg?, folder?, placeholder?, link?: { label, url } }],
//     signIn?: true (you sign in with your account in a browser after adding it), from?: "registry" }
const { NAME_RE } = require("./connectors");

// Checked against the npm registry on 10 Oct 2026: @playwright/mcp 0.0.83, @modelcontextprotocol/server-filesystem
// 2026.8.31 (`npm view <package>`). The web addresses are the vendors' own documented ones; this build machine's proxy
// blocks them, so they were not opened from here. (GitHub's npm server @modelcontextprotocol/server-github is marked
// deprecated on npm, so GitHub is its own hosted server, with a token.)
const BUILT_IN = [
  { id: "notion", name: "Notion", description: "Read and write your Notion pages and databases.", kind: "remote", url: "https://mcp.notion.com/mcp", signIn: true },
  { id: "linear", name: "Linear", description: "Find and update issues and projects.", kind: "remote", url: "https://mcp.linear.app/mcp", signIn: true },
  { id: "sentry", name: "Sentry", description: "Look into errors and issues in your Sentry projects.", kind: "remote", url: "https://mcp.sentry.dev/mcp", signIn: true },
  { id: "atlassian", name: "Atlassian", description: "Jira and Confluence.", kind: "remote", url: "https://mcp.atlassian.com/v1/sse", transport: "sse", signIn: true },
  { id: "asana", name: "Asana", description: "Tasks and projects in Asana.", kind: "remote", url: "https://mcp.asana.com/sse", transport: "sse", signIn: true },
  { id: "stripe", name: "Stripe", description: "Look up payments, customers and docs in Stripe.", kind: "remote", url: "https://mcp.stripe.com", signIn: true },
  { id: "vercel", name: "Vercel", description: "Projects and deployments on Vercel.", kind: "remote", url: "https://mcp.vercel.com", signIn: true },
  { id: "supabase", name: "Supabase", description: "Your Supabase projects and databases.", kind: "remote", url: "https://mcp.supabase.com/mcp", signIn: true },
  { id: "huggingface", name: "Hugging Face", description: "Search models, datasets and papers on Hugging Face.", kind: "remote", url: "https://huggingface.co/mcp", signIn: true },
  { id: "github", name: "GitHub", description: "Repositories, issues and pull requests.", kind: "remote", url: "https://api.githubcopilot.com/mcp/",
    inputs: [{ key: "token", label: "GitHub token", secret: true, header: "Authorization", prefix: "Bearer ", placeholder: "ghp_…",
      link: { label: "Get a token", url: "https://github.com/settings/tokens" } }] },
  { id: "context7", name: "Context7", description: "Up-to-date documentation for libraries.", kind: "remote", url: "https://mcp.context7.com/mcp" },
  { id: "cloudflare-docs", name: "Cloudflare docs", description: "Search Cloudflare's documentation.", kind: "remote", url: "https://docs.mcp.cloudflare.com/mcp" },
  { id: "playwright", name: "Playwright", description: "Let the AI use a web browser to test pages.", kind: "npm", package: "@playwright/mcp", args: ["@playwright/mcp@latest"] },
  { id: "filesystem", name: "Filesystem", description: "Let the AI read and change files in a folder.", kind: "npm", package: "@modelcontextprotocol/server-filesystem",
    inputs: [{ key: "folder", label: "Folder", arg: true, folder: true }] },
];

const REGISTRY = "https://registry.modelcontextprotocol.io/v0/servers";
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

// ---------- the registry's answer → our items ----------
// Written defensively: the registry's format has changed between versions (camelCase or snake_case, a bare server or
// { server, _meta }), so every field is read in both spellings and a server that can't be used is skipped.
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };
const yes = (v) => v === true || v === "true";

// What may end up in the program's arguments. The directory is public: anyone can list a server there.
const NPM_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(@[\w.-]+)?$/i;   // (no "user/repo": npx would fetch it from GitHub)
const PYPI_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[\w,-]+\])?$/;
const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*$/, HEADER_RE = /^[A-Za-z0-9-]{1,64}$/;
const BAD_ENV = /^(LD_|DYLD_|PYTHON|NPM_CONFIG_|NODE_OPTIONS$|NODE_PATH$|PATH$|HOME$|SHELL$|IFS$)/i;
const envOk = (n) => typeof n === "string" && ENV_RE.test(n) && !BAD_ENV.test(n);
const headerOk = (n) => typeof n === "string" && HEADER_RE.test(n) && !/^-/.test(n);
// https, or http to this computer (a key sent in a header must not travel in the clear)
const safeUrl = (u) => /^https:\/\/[^\s/]/i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(u);
const needsKey = (item) => item.kind === "remote" && (item.inputs || []).some((i) => i.header || i.secret);

function fromRegistryServer(raw) {
  const s = raw && raw.server && typeof raw.server === "object" ? raw.server : raw;
  if (!s || typeof s.name !== "string" || !s.name) return null;
  const last = s.name.split("/").pop();
  const base = { id: "reg:" + s.name, name: String(s.title || last).slice(0, 60), description: String(s.description || "").replace(/\s+/g, " ").trim().slice(0, 140), from: "registry" };
  // 1. a hosted server, streamable http first, then sse
  const remotes = (Array.isArray(s.remotes) ? s.remotes : []).filter((r) => r && /^https?:\/\//i.test(r.url || "") && !/\{[^}]+\}/.test(r.url));
  const rank = (r) => /^streamable/i.test(r.type || "") ? 0 : /^sse$/i.test(r.type || "") ? 1 : 9;
  const remote = remotes.filter((r) => rank(r) < 9).sort((a, b) => rank(a) - rank(b))[0];
  if (remote) {
    const req = (Array.isArray(remote.headers) ? remote.headers : []).filter((h) => h && h.name && yes(pick(h, "isRequired", "is_required")));
    const inputs = req.filter((h) => headerOk(h.name))
      .map((h) => ({ key: "h:" + h.name, label: String(h.description || h.name).slice(0, 60), secret: yes(pick(h, "isSecret", "is_secret")) || /auth|key|token/i.test(h.name), header: h.name }));
    // (A required header we can't pass safely, or a key over plain http: this server is skipped.)
    if (inputs.length === req.length && (!inputs.length || safeUrl(remote.url)))
      return { ...base, kind: "remote", url: remote.url, transport: rank(remote) === 1 ? "sse" : "http", ...(inputs.length ? { inputs } : {}),
        ...(inputs.length ? {} : { signIn: true }) };
  }
  // 2. a package that runs on this computer: npm (npx), then pypi (uvx)
  const pkgs = Array.isArray(s.packages) ? s.packages : [];
  const typeOf = (p) => String(pick(p, "registryType", "registry_type", "registry_name") || "").toLowerCase();
  const idOf = (p) => String(pick(p, "identifier", "name") || "");
  const idRe = { npm: NPM_RE, pypi: PYPI_RE };
  for (const t of ["npm", "pypi"]) {
    for (const chosen of pkgs.filter((p) => typeOf(p) === t && idRe[t].test(idOf(p)))) {
      const envs = pick(chosen, "environmentVariables", "environment_variables");
      const req = (Array.isArray(envs) ? envs : []).filter((v) => v && v.name && yes(pick(v, "isRequired", "is_required")));
      if (req.some((v) => !envOk(v.name))) continue;   // a required variable we won't pass: not this one
      const inputs = req.map((v) => ({ key: "e:" + v.name, label: String(v.description || v.name).slice(0, 60), secret: yes(pick(v, "isSecret", "is_secret")), env: v.name }));
      return { ...base, kind: t, package: idOf(chosen), ...(inputs.length ? { inputs } : {}) };
    }
  }
  return null;   // only docker/oci or nothing usable
}

// The registry's list → items, without the ones already in the built-in list.
function parseRegistry(json) {
  const list = Array.isArray(json) ? json : json && Array.isArray(json.servers) ? json.servers : [];
  const seen = new Set(), out = [];
  for (const raw of list) {
    const it = fromRegistryServer(raw);
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    const dup = BUILT_IN.some((b) => (b.url && b.url === it.url) || (b.package && b.package === it.package));
    if (!dup) out.push(it);
  }
  return out;
}

function matchBuiltIn(query) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return BUILT_IN.slice();
  return BUILT_IN.filter((b) => words.every((w) => (b.name + " " + b.description + " " + b.id).toLowerCase().includes(w)));
}

// { items, note }: the built-in matches first, then the registry's. Never throws; no network → the built-in ones and a note.
// fetchJson(url, ms) → parsed JSON (injectable for tests).
async function search(query, fetchJson = defaultFetch) {
  const q = String(query || "").trim(), builtIn = matchBuiltIn(q);
  if (!q) return { items: builtIn, note: "" };
  try {
    const json = await fetchJson(`${REGISTRY}?search=${encodeURIComponent(q)}&version=latest&limit=20`, 6000);
    return { items: [...builtIn, ...parseRegistry(json)], note: "" };
  } catch { return { items: builtIn, note: "Couldn't reach the connector directory." }; }
}

const MAX_BYTES = 1 << 20;   // 1 MB is far more than 20 servers need
async function defaultFetch(url, ms) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    if (Number(r.headers.get("content-length")) > MAX_BYTES) throw new Error("too big");
    // (read in pieces: a server that lies about, or leaves out, the length can't make us hold more than the limit)
    const chunks = []; let size = 0;
    if (r.body && r.body.getReader) {
      const rd = r.body.getReader();
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) { rd.cancel().catch(() => {}); throw new Error("too big"); }
        chunks.push(Buffer.from(value));
      }
    } else { const b = Buffer.from(await r.arrayBuffer()); if (b.length > MAX_BYTES) throw new Error("too big"); chunks.push(b); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { clearTimeout(t); }
}

// ---------- adding ----------
// Why a connector can't be added to this AI, in words, or "".
function unsupported(ai, item) {
  if (ai !== "claude" && ai !== "codex") return "Kural can't add connectors to this AI yet.";
  if (ai === "codex" && item.kind === "remote") {
    if (item.transport === "sse") return "ChatGPT (Codex) can't use this kind of web connector (SSE).";
    if ((item.inputs || []).some((i) => i.header)) return "ChatGPT (Codex) can't send a key to a web connector from here.";
  }
  return "";
}

// The name it's saved under: a short slug of its name, different from the AI's existing ones.
function connectorName(item, existing = []) {
  const base = slug(item.name) || slug(item.id) || "connector", taken = new Set(existing.map((n) => String(n).toLowerCase()));
  let name = /^[a-z0-9]/.test(base) ? base : "c-" + base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  return NAME_RE.test(name) ? name : "connector";
}

// → { name, args } for `claude` / `codex`, or { error } in words. values: { [input key]: text }.
function addArgs(ai, item, values = {}, existing = []) {
  const why = unsupported(ai, item);
  if (why) return { error: why };
  const inputs = item.inputs || [], vals = {};
  for (const i of inputs) {
    if (i.env && !envOk(i.env)) return { error: "This connector asks for a setting Kural won't pass on." };
    if (i.header && !headerOk(i.header)) return { error: "This connector asks for a header Kural won't pass on." };
  }
  if (needsKey(item) && !safeUrl(item.url || "")) return { error: "Kural won't send a key to an address that isn't https://." };
  if (item.from === "registry" && item.kind !== "remote" && !(item.kind === "pypi" ? PYPI_RE : NPM_RE).test(item.package || "")) return { error: "This package name isn't one Kural will run." };
  for (const i of inputs) {
    const v = String(values[i.key] == null ? "" : values[i.key]).trim();
    if (!v) return { error: `Fill in ${i.label.replace(/\.$/, "")}.` };
    if (/[\r\n\0]/.test(v)) return { error: `${i.label} should be on one line.` };
    vals[i.key] = v;
  }
  const name = connectorName(item, existing), claude = ai === "claude";
  if (item.kind === "remote") {
    if (!/^https?:\/\/\S+$/i.test(item.url || "")) return { error: "This connector has no usable address." };
    if (claude) {
      // (Headers last: Claude Code's -H takes every word after it.)
      const args = ["mcp", "add", "-s", "user", "--transport", item.transport === "sse" ? "sse" : "http", name, item.url];
      const headers = inputs.filter((i) => i.header).map((i) => `${i.header}: ${(i.prefix || "") + vals[i.key]}`);
      if (headers.length) args.push("-H", ...headers);
      return { name, args };
    }
    return { name, args: ["mcp", "add", name, "--url", item.url] };
  }
  // On this computer: npx (npm) or uvx (pypi), with the package's own required variables and arguments.
  const runner = item.kind === "pypi" ? ["uvx", item.package] : ["npx", "-y", ...(item.args || [item.package])];
  const cmd = [...runner, ...inputs.filter((i) => i.arg).map((i) => vals[i.key])];
  const env = inputs.filter((i) => i.env).map((i) => `${i.env}=${vals[i.key]}`);
  if (claude) return { name, args: ["mcp", "add", "-s", "user", name, ...env.flatMap((e) => ["-e", e]), "--", ...cmd] };
  return { name, args: ["mcp", "add", name, ...env.flatMap((e) => ["--env", e]), "--", ...cmd] };
}

// The same item with `unsupported` filled in for this AI (what the page needs).
// "shows": exactly what will run or be contacted (the page shows it before a connector from the directory is added).
const shown = (item) => item.kind === "remote" ? item.url : (item.kind === "pypi" ? ["uvx", item.package] : ["npx", "-y", ...(item.args || [item.package])]).join(" ");
const forAi = (ai, item) => ({ ...item, unsupported: unsupported(ai, item), shows: shown(item) });

module.exports = { BUILT_IN, REGISTRY, search, matchBuiltIn, parseRegistry, fromRegistryServer, addArgs, connectorName, unsupported, forAi, slug };
