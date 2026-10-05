#!/usr/bin/env node
// A stand-in for the `claude` program, for testing Get started (lib/checks.js, lib/getstarted.js) without
// uninstalling or logging out of the real one. Its state comes from $FAKE_CLAUDE_STATE, or else from the file
// $FAKE_CLAUDE_FILE (default: <tmp>/kural-fake-claude-state), so a test can change it while Kural runs:
//   ok         installed, logged in, answers "OK"
//   loggedout  `auth status` says not logged in; requests fail with "Not logged in · Please run /login"
//   nocredit   logged in, but requests fail (no Claude Code access on the account)
//   old        an old Claude Code without `auth status` (prints text, not JSON)
// `auth logout` switches the state file to "loggedout". `auth login` waits 3 s, then switches the state file to "ok" (like finishing the login in the browser).
// Use it in Kural: setting "kural.claudePath": "/path/to/test/fake-claude.js".
const fs = require("fs"), os = require("os"), path = require("path");
const file = process.env.FAKE_CLAUDE_FILE || path.join(os.tmpdir(), "kural-fake-claude-state");
const read = () => { try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; } };
const state = process.env.FAKE_CLAUDE_STATE || read() || "ok";
const args = process.argv.slice(2);

if (args[0] === "--version") { console.log(state === "old" ? "1.0.30 (Claude Code)" : "2.1.300 (Claude Code)"); process.exit(0); }
if (args[0] === "auth" && args[1] === "status") {
  if (state === "old") { console.log("auth status is not a command I know."); process.exit(0); }
  const who = state === "loggedout" ? {} : { email: process.env.FAKE_CLAUDE_EMAIL || "tester@example.com", orgName: "Tester's Organization", subscriptionType: "pro" };
  console.log(JSON.stringify({ loggedIn: state !== "loggedout", authMethod: state === "loggedout" ? "none" : "claude.ai", apiProvider: "firstParty", ...who }, null, 2));
  process.exit(state === "loggedout" ? 1 : 0);
}
if (args[0] === "auth" && args[1] === "logout") { fs.writeFileSync(file, "loggedout"); console.log("Successfully logged out."); process.exit(0); }
if (args[0] === "auth" && args[1] === "login") {
  console.log("Opening your browser to log in…  (fake: logged in after 3 s)");
  setTimeout(() => { fs.writeFileSync(file, "ok"); console.log("Login successful."); process.exit(0); }, 3000);
  return;
}
if (args.includes("-p")) {
  let buf = "";
  process.stdin.on("data", (d) => {
    buf += d;
    if (!buf.includes("\n")) return;
    const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
    out({ type: "system", subtype: "init", model: "claude-haiku-4-5" });
    const fail = (text) => out({ type: "result", subtype: "success", is_error: true, result: text });
    setTimeout(() => {
      if (state === "loggedout") fail("Not logged in · Please run /login");
      else if (state === "nocredit") fail("Credit balance is too low");
      else {
        // Like Claude Code: the plan's limits after an answer (5-hour 50 %, resets in 42 min; weekly 25 %, in 3 days).
        const t = Date.now() / 1000;
        out({ type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: {
          five_hour: { utilization: 0.5, resetsAt: Math.round(t + 42 * 60) }, seven_day: { utilization: 0.25, resetsAt: Math.round(t + 3 * 86400 + 4 * 3600) } } } });
        out({ type: "result", subtype: "success", is_error: false, result: "OK", duration_ms: 900 });
      }
      process.exit(0);
    }, Number(process.env.FAKE_CLAUDE_MS || 900));
  });
  return;
}
console.log("fake claude: nothing to do for", args.join(" "));
