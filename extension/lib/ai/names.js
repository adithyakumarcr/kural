// The name on each AI account ("Peasant Adithya", "Adithya Chinnakkonda"), shown in the status bar and Kural Settings
// instead of only the plan. The programs' own "who's logged in" answers give an email but no name, so the name comes
// from what each program saved in a plain file in your home folder, and only when that file's email is the
// account's email (a file left over from another login doesn't count). Never from the keychain: reading it makes the
// Mac ask for your password (see CLAUDE.md). No vscode inside (test/names.test.js).
//   Claude:  ~/.claude.json → oauthAccount.displayName (or fullName), saved by Claude Code at login.
//   Gemini:  Antigravity keeps its login in the keychain; Google's older Gemini CLI saved ~/.gemini/oauth_creds.json,
//            whose id_token (a signed note from Google) carries the name. Same Google account → same name.
//   Codex:   ~/.codex/auth.json (or $CODEX_HOME), its id_token's name, when Codex saves its login in a file.

const fs = require("fs"), os = require("os"), path = require("path");
const { withProfileEnv } = require("../profiles/env");   // (a profile's own Claude / Codex folders)

const same = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
// What a JWT says (its middle part); the signature isn't checked: this is only for showing a name.
function claims(token) {
  try { const p = String(token).split(".")[1]; return JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); }
  catch { return null; }
}

function claudeName(email, home = os.homedir(), env = withProfileEnv()) {
  const dir = env.CLAUDE_CONFIG_DIR || home;
  for (const f of [path.join(dir, ".claude.json"), path.join(home, ".claude.json")]) {
    const a = (read(f) || {}).oauthAccount;
    if (a && (!email || same(a.emailAddress, email))) return (a.displayName || a.fullName || "").trim();
  }
  return "";
}

function googleName(email, home = os.homedir()) {
  const c = claims((read(path.join(home, ".gemini", "oauth_creds.json")) || {}).id_token);
  return c && c.name && same(c.email, email) ? String(c.name).trim() : "";
}

function codexName(email, home = os.homedir(), env = withProfileEnv()) {
  const t = (read(path.join(env.CODEX_HOME || path.join(home, ".codex"), "auth.json")) || {}).tokens;
  const c = t && claims(t.id_token);
  return c && c.name && (!email || same(c.email, email)) ? String(c.name).trim() : "";
}

// id: "claude" | "agy" | "codex"
function accountName(id, email, opts = {}) {
  try {
    if (id === "claude") return claudeName(email, opts.home, opts.env);
    if (id === "agy") return email ? googleName(email, opts.home) : "";
    if (id === "codex") return codexName(email, opts.home, opts.env);
  } catch { /* no name: the email or plan shows instead */ }
  return "";
}

module.exports = { accountName, claims };
