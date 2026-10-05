// ./install.sh --from-scratch-install (scripts/from-scratch.sh): with a pretend home folder and the fake programs, every
// login is gone, Kural's data is gone, the programs go only when asked, and "no" changes nothing. Linux steps only.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };

const homes = [];
function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "scratchtest-home-")); homes.push(home);
  const tmp = path.join(home, "tmp"); fs.mkdirSync(tmp);
  // The programs, installed like Claude Code's own installer does it (~/.local/share/claude + a link in ~/.local/bin).
  const share = path.join(home, ".local/share/claude/versions/2.1.300"); fs.mkdirSync(share, { recursive: true });
  const bin = path.join(home, ".local/bin"); fs.mkdirSync(bin, { recursive: true });
  const wrap = (file, fake) => { fs.writeFileSync(file, `#!/bin/sh\nexec node ${path.join(ROOT, "test", fake)} "$@"\n`, { mode: 0o755 }); };
  wrap(path.join(share, "claude"), "fake-claude.js"); fs.symlinkSync(path.join(share, "claude"), path.join(bin, "claude"));
  wrap(path.join(bin, "codex"), "fake-codex.js"); wrap(path.join(bin, "agy"), "fake-agy.js");
  for (const f of ["kural-fake-claude-state", "kural-fake-codex-state", "kural-fake-agy-state"]) fs.writeFileSync(path.join(tmp, f), "ok");
  // Kural's data, a login file, a temp folder of Kural's, and someone else's thing that must stay.
  fs.mkdirSync(path.join(home, ".config/Kural/User/globalStorage/kural.kural/chats"), { recursive: true });
  fs.writeFileSync(path.join(home, ".config/Kural/User/globalStorage/kural.kural/chats/a.json"), "{}");
  fs.mkdirSync(path.join(home, ".kural/extensions"), { recursive: true });
  fs.mkdirSync(path.join(home, ".claude/projects"), { recursive: true }); fs.writeFileSync(path.join(home, ".claude/.credentials.json"), "{}");
  fs.mkdirSync(path.join(home, ".codex")); fs.writeFileSync(path.join(home, ".codex/auth.json"), "{}");
  fs.mkdirSync(path.join(tmp, "kural-abc123/attachments"), { recursive: true });
  fs.mkdirSync(path.join(home, ".ollama/models"), { recursive: true });
  return { home, tmp, bin };
}
function run(s, answers) {
  const script = `. scripts/from-scratch.sh; die() { echo "DIE: $*"; exit 3; }; dpkg() { return 1; }
scratch_confirm <<'IN'\n${answers}\nIN\nscratch_wipe`;
  return spawnSync("bash", ["-c", script], { cwd: ROOT, encoding: "utf8", timeout: 120000,
    env: { HOME: s.home, TMPDIR: s.tmp, PATH: `${s.bin}:/usr/bin:/bin:${path.dirname(process.execPath)}`, XDG_CONFIG_HOME: "" } });
}
const exists = (s, p) => fs.existsSync(path.join(s.home, p));

check("\"no\" at the question changes nothing", () => {
  const s = setup();
  const r = run(s, "no\n");
  assert.strictEqual(r.status, 3, r.stdout + r.stderr); assert.match(r.stdout, /nothing was changed/);
  assert.ok(exists(s, ".config/Kural") && exists(s, ".codex/auth.json"));
  assert.strictEqual(fs.readFileSync(path.join(s.tmp, "kural-fake-claude-state"), "utf8"), "ok");
});
check("yes, keep the programs: logged out everywhere, Kural's data gone, the rest stays", () => {
  const s = setup();
  const r = run(s, "yes\nn");
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  for (const line of ["Claude Code: logged out", "Codex: logged out", "Antigravity (Google Gemini): logged out"]) assert.ok(r.stdout.includes(line), `${line}\n${r.stdout}`);
  for (const f of ["kural-fake-claude-state", "kural-fake-codex-state", "kural-fake-agy-state"]) assert.strictEqual(fs.readFileSync(path.join(s.tmp, f), "utf8"), "loggedout", f);
  for (const p of [".config/Kural", ".kural", ".claude/.credentials.json", ".codex/auth.json", "tmp/kural-abc123"]) assert.ok(!exists(s, p), p);
  for (const p of [".claude/projects", ".ollama/models", ".local/bin/claude", ".local/bin/codex", ".local/bin/agy"]) assert.ok(exists(s, p), p);
});
check("yes, remove the programs too: Claude Code's install and the others are gone", () => {
  const s = setup();
  const r = run(s, "yes\ny");
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  for (const p of [".local/bin/claude", ".local/share/claude", ".local/bin/codex", ".local/bin/agy"]) assert.ok(!exists(s, p), `${p}\n${r.stdout}`);
  assert.ok(exists(s, ".ollama/models"));
});
for (const h of homes) fs.rmSync(h, { recursive: true, force: true });
console.log(fail ? `from-scratch: ${fail} FAILED` : "from-scratch: ALL PASS");
process.exit(fail ? 1 : 0);
