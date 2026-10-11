// Connectors (MCP servers) of each AI, for Kural Settings: list, add, remove. No vscode here.
// Claude: `claude mcp list|add|remove` (the same list Claude Code uses in the terminal; claude.ai's connectors show too,
// but they're managed on claude.ai). ChatGPT (Codex): `codex mcp list --json|add|remove`. Google Gemini (Antigravity) and
// your own model: none in Kural yet (agy has no command for it that we know of; Kural's own engine has no MCP).
const os = require("os");
const { execFile } = require("child_process");

const SUPPORTED = { claude: true, codex: true };
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

function run(bin, args, env, timeout = 30000, cwd = os.tmpdir()) {
  // (A .js program, like the tests' fakes, runs with Kural's own Node.)
  const js = /\.js$/i.test(bin);
  const file = js ? process.execPath : bin, all = js ? [bin, ...args] : args;
  return new Promise((resolve) => {
    try {
      const p = execFile(file, all, { cwd, env: { ...(env || process.env), ...(js ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
        timeout, encoding: "utf8", windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout, stderr) =>
        resolve({ ok: !error, stdout: stdout || "", stderr: stderr || "", timeout: !!(error && error.killed) }));
      if (p.stdin) { p.stdin.on("error", () => {}); p.stdin.end(); }
    } catch (e) { resolve({ ok: false, stdout: "", stderr: e.message, timeout: false }); }
  });
}

// `claude mcp list` prints one line per server after "Checking MCP server health…":
//   "github: npx -y @modelcontextprotocol/server-github - ✓ Connected"
//   "claude.ai Atlassian: https://mcp.atlassian.com/v1/sse - ! Needs authentication"
function parseClaudeList(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    // (The mark before the status varies between versions: ✓ ✗ × ! ⚠. Details after " — " go in the hover.)
    const m = /^(.+?): (.+) - (?:[^\w\s]\s*)?(.+)$/u.exec(line.trim());
    if (!m || /^checking\b/i.test(line)) continue;
    const name = m[1].trim(), [status, ...why] = m[3].trim().split(/\s+[—–]\s+/);
    out.push({ name, target: m[2].trim(), status, why: why.join(" — "), ok: /^connected$/i.test(status), needsAuth: /authenticat|sign.?in|log.?in/i.test(status), managed: /^claude\.ai /i.test(name) ? "claude.ai" : "" });
  }
  return out;
}

// `codex mcp list --json`: [{ name, enabled, transport: { type: "stdio", command, args } | { type: "streamable_http", url } }]
function parseCodexList(text) {
  let list;
  try { list = JSON.parse(String(text || "").trim() || "[]"); } catch { return null; }
  if (!Array.isArray(list)) return null;
  return list.filter((s) => s && typeof s.name === "string").map((s) => {
    const t = s.transport || {};
    const target = t.url || [t.command, ...(Array.isArray(t.args) ? t.args : [])].filter(Boolean).join(" ");
    // (auth_status: "not_logged_in" for a web connector that needs you to sign in; "unknown" when it can't tell.)
    const needsAuth = s.enabled !== false && /^not.?logged.?in$/i.test(String(s.auth_status || ""));
    return { name: s.name, target, status: s.enabled === false ? "Turned off" : needsAuth ? "Needs sign-in" : "Added", ok: s.enabled !== false && !needsAuth, needsAuth, auth: String(s.auth_status || ""), managed: "" };
  });
}

// "npx -y \"my server\" --flag" → ["npx", "-y", "my server", "--flag"] (quotes group words; no shell runs it).
function splitArgs(s) {
  const out = []; let cur = "", q = null, any = false;
  for (const ch of String(s || "")) {
    if (q) { if (ch === q) q = null; else cur += ch; }
    else if (ch === '"' || ch === "'") { q = ch; any = true; }
    else if (/\s/.test(ch)) { if (cur || any) out.push(cur); cur = ""; any = false; }
    else cur += ch;
  }
  if (cur || any) out.push(cur);
  return out;
}

// { name, kind: "command" | "url", value } → the program's arguments, or { error } in words.
function addArgs(ai, c) {
  const name = String((c && c.name) || "").trim(), value = String((c && c.value) || "").trim();
  if (!SUPPORTED[ai]) return { error: "Kural can't add connectors to this AI yet." };
  if (!NAME_RE.test(name)) return { error: "Give it a short name: letters, numbers, - _ or . (no spaces)." };
  if (c.kind === "url") {
    if (!/^https?:\/\/\S+$/i.test(value)) return { error: "The address should start with https:// (or http:// for one on this computer)." };
    return { args: ai === "claude" ? ["mcp", "add", "-s", "user", "--transport", "http", name, value] : ["mcp", "add", name, "--url", value] };
  }
  const cmd = splitArgs(value);
  if (!cmd.length) return { error: "Write the command that starts the connector, e.g. npx -y @modelcontextprotocol/server-github" };
  return { args: ai === "claude" ? ["mcp", "add", "-s", "user", name, "--", ...cmd] : ["mcp", "add", name, "--", ...cmd] };
}

const firstLine = (r) => (String(r.stderr || "").trim() || String(r.stdout || "").trim()).split(/\r?\n/).filter(Boolean).slice(-1)[0] || "";

// cwd: the project folder (trusted only), so Claude lists its project connectors (.mcp.json) too: the ones its chats use.
async function list(ai, bin, env, cwd) {
  if (!SUPPORTED[ai]) return { supported: false, servers: [] };
  if (!bin) return { supported: true, servers: [], error: "not installed" };
  // (Claude checks each server's health: slow with many. Codex only reads its settings.)
  const r = ai === "claude" ? await run(bin, ["mcp", "list"], env, 60000, cwd || os.tmpdir()) : await run(bin, ["mcp", "list", "--json"], env, 20000);
  if (!r.ok) return { supported: true, servers: [], error: r.timeout ? "it took too long to answer" : firstLine(r) || "it couldn't list them" };
  const servers = ai === "claude" ? parseClaudeList(r.stdout) : parseCodexList(r.stdout);
  return servers ? { supported: true, servers } : { supported: true, servers: [], error: "its answer couldn't be read" };
}

async function add(ai, bin, env, c) {
  const a = addArgs(ai, c);
  if (a.error) return { error: a.error };
  if (!bin) return { error: "Set it up first (Get started)." };
  const r = await run(bin, a.args, env);
  return r.ok ? { ok: true } : { error: firstLine(r) || "It couldn't add the connector." };
}

// A connector from the catalog (lib/ai/connector-catalog.js) with the values you filled in. existing: the names already there.
async function addItem(ai, bin, env, item, values, existing) {
  const a = require("./connector-catalog").addArgs(ai, item || {}, values || {}, existing || []);
  if (a.error) return { error: a.error };
  if (!bin) return { error: "Set it up first (Get started)." };
  const r = await run(bin, a.args, env);
  return r.ok ? { ok: true, name: a.name } : { error: firstLine(r) || "It couldn't add the connector." };
}

// What signing in to a connector runs, in a terminal: Codex has a command for it; Claude Code only has /mcp inside its screen.
function signInArgs(ai, name) {
  if (!NAME_RE.test(String(name || ""))) return null;
  return ai === "codex" ? ["mcp", "login", name] : ai === "claude" ? [] : null;
}

async function remove(ai, bin, env, name, cwd) {
  if (!SUPPORTED[ai] || !bin || !NAME_RE.test(String(name || ""))) return { error: "Kural can't remove this one." };
  const r = await run(bin, ["mcp", "remove", name], env, 30000, cwd || os.tmpdir());
  return r.ok ? { ok: true } : { error: firstLine(r) || "It couldn't remove the connector." };
}

module.exports = { SUPPORTED, NAME_RE, run, addItem, signInArgs, list, add, remove, parseClaudeList, parseCodexList, splitArgs, addArgs };
