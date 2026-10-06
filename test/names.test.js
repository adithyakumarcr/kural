// The name on each AI account (extension/lib/ai/names.js): from the programs' own files, only when the email matches.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { accountName } = require("../extension/lib/ai/names");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const home = fs.mkdtempSync(path.join(os.tmpdir(), "kural-names-"));
const jwt = (o) => `x.${Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.sig`;
const opts = { home, env: {} };

fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "Me@Example.com", displayName: "Peasant Adithya", fullName: "Adithya C" } }));
fs.mkdirSync(path.join(home, ".gemini"));
fs.writeFileSync(path.join(home, ".gemini", "oauth_creds.json"), JSON.stringify({ id_token: jwt({ email: "me@gmail.com", name: "Adithya Chinnakkonda" }) }));
fs.mkdirSync(path.join(home, ".codex"));
fs.writeFileSync(path.join(home, ".codex", "auth.json"), JSON.stringify({ tokens: { id_token: jwt({ email: "me@openai.example", name: "A. C." }) } }));

check("Claude: the profile's display name, for the same email (any case)", () => assert.strictEqual(accountName("claude", "me@example.com", opts), "Peasant Adithya"));
check("Claude: another account's file doesn't count", () => assert.strictEqual(accountName("claude", "other@example.com", opts), ""));
check("Gemini: the Google token's name for the same account", () => assert.strictEqual(accountName("agy", "me@gmail.com", opts), "Adithya Chinnakkonda"));
check("Gemini: no email from Antigravity: no name (can't tell it's the same account)", () => assert.strictEqual(accountName("agy", "", opts), ""));
check("Codex: the token's name", () => assert.strictEqual(accountName("codex", "me@openai.example", opts), "A. C."));
check("missing or broken files: no name, no error", () => {
  fs.writeFileSync(path.join(home, ".codex", "auth.json"), "{not json");
  assert.strictEqual(accountName("codex", "x", opts), "");
  assert.strictEqual(accountName("claude", "x", { home: path.join(home, "none"), env: {} }), "");
});

fs.rmSync(home, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
