// What Kural needs on this computer, checked for the Get started page (lib/getstarted.js).
//   - Claude Code installed (the `claude` program): its version.
//   - Logged in: `claude auth status` (no request to Claude; older Claude Code doesn't have it: then "unknown",
//     and the test decides).
//   - The test: one tiny real request, sent the way Kural sends them (stream-json, Haiku). It catches everything
//     the other two can't: no subscription, no network, a region where Claude isn't offered, a broken install.
//   - Optional: Git.
// No vscode here (tests run without it). The caller passes the claude path and a clean environment.

const os = require("os");
const { spawn, execFile } = require("child_process");
const usage = require("./usage");

// Run a program without blocking Kural (spawnSync would freeze every extension while it runs).
// Resolves { status, stdout, stderr, error }.
function run(bin, args, env, timeout) {
  return new Promise((resolve) => {
    let p;
    try {
      p = execFile(bin, args, { cwd: os.tmpdir(), env, timeout, encoding: "utf8", windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout, stderr) =>
        resolve({ status: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: stdout || "", stderr: stderr || "",
          error: error && (error.killed ? Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) : typeof error.code === "string" ? error : null) }));
    } catch (e) { resolve({ status: null, stdout: "", stderr: "", error: e }); return; }
    if (p.stdin) { p.stdin.on("error", () => {}); p.stdin.end(); }
  });
}

const TEST_PROMPT = "This is Kural checking that Claude Code works. Reply with exactly: OK";

// "2.1.288 (Claude Code)" -> "2.1.288". { version } or { error, timeout }.
// (The first start after an update can be slow, e.g. macOS checking the new program: 30 s.)
async function claudeVersion(bin, env) {
  const r = await run(bin, ["--version"], env, 30000);
  if (r.error) return r.error.code === "ETIMEDOUT" ? { error: "it didn't answer within 30 s", timeout: true } : { error: r.error.message };
  const out = `${r.stdout || ""}`.trim();
  const v = /(\d+\.\d+\.\d+[\w.-]*)/.exec(out);
  if (r.status !== 0 || !v) return { error: (`${r.stderr || ""}`.trim() || out || `exit code ${r.status}`).split("\n")[0].slice(0, 200) };
  return { version: v[1] };
}

// { loggedIn: true/false, method, email, org, plan, provider, apiKey } (email/org/plan: claude.ai logins) or { loggedIn: null } when this Claude Code can't tell.
// (Old versions don't know `auth` and would take "auth status" as a question: only JSON counts.)
async function claudeAuth(bin, env) {
  const r = await run(bin, ["auth", "status", "--json"], env, 15000);
  try {
    const j = JSON.parse(`${r.stdout || ""}`.trim());
    if (typeof j.loggedIn !== "boolean") return { loggedIn: null };
    return { loggedIn: j.loggedIn, method: describeMethod(j), email: j.email || "", org: j.orgName || "", plan: planName(j.subscriptionType),
      provider: j.apiProvider || "firstParty", apiKey: /api_?key/i.test(j.authMethod || "") };
  } catch { return { loggedIn: null }; }
}

// Log out of Claude Code (all of Claude Code on this computer, also in the terminal). { ok } or { error }.
async function claudeLogout(bin, env) {
  const r = await run(bin, ["auth", "logout"], env, 20000);
  if (r.error || r.status !== 0) return { error: (`${r.stderr}`.trim() || `${r.stdout}`.trim() || (r.error && r.error.message) || `exit code ${r.status}`).split("\n")[0].slice(0, 200) };
  return { ok: true };
}

// "pro" → "Pro", "max" → "Max", "team" → "Team"…
const planName = (t) => t ? `${String(t)[0].toUpperCase()}${String(t).slice(1)}` : "";

function describeMethod(j) {
  if (j.apiProvider && j.apiProvider !== "firstParty") return { bedrock: "Amazon Bedrock", vertex: "Google Cloud", foundry: "Microsoft Foundry" }[j.apiProvider] || j.apiProvider;
  if (/api_?key/i.test(j.authMethod || "")) return "API key";
  if (j.subscriptionType) return `Claude ${planName(j.subscriptionType)}`;
  return j.authMethod ? "Claude account" : "";
}

// One real request. Resolves { ok, ms, answer } or { ok: false, error, login }.
function claudeTest(bin, env, { cwd, timeoutMs = 90000, model = "haiku" } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let out = "", err = "", done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); try { p.kill(); } catch { /* gone */ } resolve({ ms: Date.now() - t0, ...r }); };
    let p;
    try {
      p = spawn(bin, ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--model", model,
        "--safe-mode", "--max-turns", "1"], { cwd: cwd || os.tmpdir(), env, windowsHide: true });
    } catch (e) { resolve({ ok: false, ms: 0, error: e.message }); return; }
    const timer = setTimeout(() => finish({ ok: false, error: `No answer after ${Math.round(timeoutMs / 1000)} s. Check your internet connection.` }), timeoutMs);
    p.on("error", (e) => finish({ ok: false, error: e.message }));
    p.stderr.on("data", (d) => { err += d; });
    p.stdout.on("data", (d) => {
      out += d;
      let i;
      while ((i = out.indexOf("\n")) >= 0) {
        const line = out.slice(0, i); out = out.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.type === "rate_limit_event") { const u = usage.fromClaude(m); if (u) usage.report("claude", u); continue; }   // (the usage meter)
        if (m.type !== "result") continue;
        const text = String(m.result || "").trim();
        if (m.is_error || m.subtype !== "success") finish({ ok: false, error: text || m.subtype || "Claude answered with an error.", login: LOGIN.test(text) });
        else finish({ ok: true, answer: text.slice(0, 200) });
      }
    });
    p.on("close", (code) => {   // ("close": after all its output was read)
      const msg = (err.trim() || out.trim() || `Claude Code stopped (exit code ${code}).`).split("\n").slice(-3).join(" ").slice(0, 400);
      finish({ ok: false, error: msg, login: LOGIN.test(msg) });
    });
    p.stdin.on("error", () => {});   // it stopped before reading (EPIPE): "close" reports that
    p.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: TEST_PROMPT } }) + "\n");
  });
}

const LOGIN = /not logged in|log ?in|invalid api key|oauth|credential|401/i;

// What a failed test means, in plain words (shown under the error).
function explain(error) {
  const e = String(error || "");
  if (LOGIN.test(e)) return "Claude Code isn't logged in (or the login expired). Log in again in step 2.";
  if (/credit balance|billing|payment|quota/i.test(e)) return "Your account has no Claude Code access or credit left. Claude Code needs a Pro, Max, Team or Enterprise plan, or a Console account with credit.";
  if (/rate.?limit|usage limit|429/i.test(e)) return "You've reached your plan's usage limit. Wait until it resets, then run the test again.";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|fetch failed|internet|connection/i.test(e)) return "Claude Code couldn't reach Anthropic. Check your internet connection (and proxy, if you use one).";
  if (/country|region|not available/i.test(e)) return "Claude may not be available where you are.";
  if (/unknown option|unknown command/i.test(e)) return "Your Claude Code is too old for Kural. Update it: run `claude update` in a terminal.";
  return "";
}

// "git version 2.43.0" -> "2.43.0", or null.
async function gitVersion(env) {
  const r = await run("git", ["--version"], env, 5000);
  const v = /(\d+\.\d+[\w.]*)/.exec(r.stdout || "");
  return r.status === 0 && v ? v[1] : null;
}

// The official installers (Anthropic's docs: code.claude.com/docs/en/setup).
const INSTALL = {
  win32: { shell: "PowerShell", command: "irm https://claude.ai/install.ps1 | iex" },
  other: { shell: "Terminal", command: "curl -fsSL https://claude.ai/install.sh | bash" },
};
const installFor = (platform) => INSTALL[platform === "win32" ? "win32" : "other"];

module.exports = { claudeVersion, claudeAuth, claudeLogout, claudeTest, explain, gitVersion, installFor, describeMethod, TEST_PROMPT };
