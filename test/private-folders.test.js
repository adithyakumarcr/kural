// The AI's looks into your private folders (Desktop, Documents, Downloads, Music, Pictures…) ask you first, in every mode:
// on a Mac each makes macOS ask about Kural (an AI's `ls -d ~/*/ ~/*/*/` once set off Desktop, Downloads, Apple Music and
// Photos at once). lib/paths.js privateUse/privateFolder, lib/chat/permission-policy.js decide({ privateFolders }).
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "kural-home-"));
process.env.HOME = home; process.env.USERPROFILE = home;
const { decide } = require("../extension/lib/chat/permission-policy");
const { privateUse, privateFolder } = require("../extension/lib/paths");
const { PROMPTS } = require("../extension/lib/chat/prompts");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const project = path.join(home, "Projects", "app");
fs.mkdirSync(project, { recursive: true });
const run = (tool, input, mode = "auto", extra = {}) => decide({ tool, input, mode, privateFolders: true, cwd: project,
  writeRoots: [project], readRoots: [project], ...extra });
const asks = (v) => v.ask === true && v.private === true && /macOS/.test(v.risky.why);

check("the command that set off every question asks first, in Auto too", () => {
  const v = run("Bash", { command: "ls -d ~/*/ ~/*/*/ 2>/dev/null | head -60" });
  assert.ok(asks(v), JSON.stringify(v)); assert.ok(/home folder/.test(v.risky.why));
});
for (const [cmd, word] of [["ls ~/Downloads", "Downloads"], ['cat "$HOME/Desktop/notes.txt"', "Desktop"], ["open ${HOME}/Pictures", "Pictures"],
  [`du -sh ${home}/Music`, "Music"], ["ls ~/Movies/", "Movies"], ["ls ~/Library/Mobile\\ Documents", "iCloud Drive"], ["cd ~/Documents && ls", "Documents"]])
  check(`"${cmd}" asks and names ${word}`, () => { const v = run("Bash", { command: cmd }); assert.ok(asks(v), JSON.stringify(v)); assert.ok(v.risky.why.includes(word), v.risky.why); });
for (const cmd of ["find ~ -name '*.pdf'", "rg TODO ~", "grep -r secret $HOME", "ls -R ~", "rg foo /", "tree /", "cp -r ~ /tmp/x"])
  check(`"${cmd}" walks your whole home folder: asks`, () => assert.ok(asks(run("Bash", { command: cmd }))));
check("a walk in a folder that is your home (its cwd) asks", () => assert.ok(asks(run("Bash", { command: "find . -name x", cwd: home }))));
for (const cmd of ["npm test", "ls", "find . -name '*.js'", "rg TODO src", "ls ~/.claude ~/.zshrc", "ls ~/.*rc", "du -sh ~/Projects",
  "mdfind kMDItemDisplayName=report", "ls ~", "git status", "cat ~/Downloadsx"])
  check(`"${cmd}" doesn't look in them: runs in Auto`, () => assert.deepStrictEqual(run("Bash", { command: cmd }), { allow: true }));
check("a file you attached there doesn't ask", () => {
  const f = path.join(home, "Downloads", "report.pdf");
  assert.deepStrictEqual(run("Bash", { command: `pdftotext ${f} -` }, "auto", { granted: [f] }), { allow: true });
  assert.deepStrictEqual(run("Read", { file_path: f }, "auto", { granted: [f] }), { allow: true });
  assert.ok(asks(run("Bash", { command: `ls ~/Downloads` }, "auto", { granted: [f] })), "the rest of the folder still asks");
});
check("a project inside Documents works without asking (you opened it)", () => {
  const p = path.join(home, "Documents", "site");
  const roots = { cwd: p, writeRoots: [p], readRoots: [p] };
  assert.deepStrictEqual(run("Read", { file_path: path.join(p, "index.html") }, "auto", roots), { allow: true });
  assert.deepStrictEqual(run("Bash", { command: `ls ${p}/src` }, "auto", roots), { allow: true });
  assert.deepStrictEqual(run("Edit", { file_path: path.join(p, "a.css") }, "agent", roots), { allow: true });
});
check("Read, Glob and Grep there ask; a Glob or Grep over your whole home folder asks", () => {
  assert.ok(asks(run("Read", { file_path: path.join(home, "Pictures", "a.png") })));
  assert.ok(asks(run("Glob", { pattern: "~/Downloads/*.zip" })));
  assert.ok(asks(run("Glob", { pattern: "**/*.js", path: home })));
  assert.ok(asks(run("Grep", { pattern: "x", path: "/" })));
  assert.deepStrictEqual(run("Grep", { pattern: "x", path: project }), { allow: true });
});
check("Write there asks too, and an upload to a page from there", () => {
  assert.ok(asks(run("Write", { file_path: path.join(home, "Desktop", "out.txt") })));
  assert.ok(asks(run("BrowserUpload", { file_path: path.join(home, "Movies", "run.mp4"), site: "instagram.com" }, "agent")));
});
check('"Allow all" for commands doesn\'t cover it, in Agent', () => assert.ok(asks(run("Bash", { command: "ls ~/Music" }, "agent", { allowAll: ["command"] }))));
check("Ask and Plan still refuse commands first", () => assert.ok(run("Bash", { command: "ls ~/Downloads" }, "plan").deny));
check("a Gemini command with its own folder (cwd) counts there", () => assert.ok(asks(run("Bash", { command: "ls", cwd: path.join(home, "Desktop") }))));
check("a linked device's commands are someone else's computer: not checked", () =>
  assert.ok(!run("DeviceCommand", { command: "ls ~/Downloads", device: "pi" }, "auto").private));
check("off where macOS doesn't ask (privateFolders false): Auto runs it", () =>
  assert.deepStrictEqual(decide({ tool: "Bash", input: { command: "ls ~/Downloads" }, mode: "auto", privateFolders: false, cwd: project }), { allow: true }));
check("privateFolder knows the folder; privateUse gives the named path", () => {
  assert.strictEqual(privateFolder(path.join(home, "Downloads", "a", "b")), "Downloads");
  assert.strictEqual(privateFolder(path.join(home, "Projects")), null);
  assert.deepStrictEqual(privateUse("ls ~/Downloads/a.txt").map((f) => [f.folder, f.path]), [["Downloads", path.join(home, "Downloads", "a.txt")]]);
});
check("every mode's instructions tell the AI not to look there", () => {
  for (const m of ["ask", "plan", "agent", "auto"]) assert.ok(/Desktop, Documents, Downloads, Music, Pictures or Movies/.test(PROMPTS[m]) && /`~\/\*`/.test(PROMPTS[m]), m);
});

// The chat: such a card has no "Allow all", and switching to Auto mid-answer doesn't answer it.
const chatSrc = fs.readFileSync(path.join(__dirname, "..", "extension", "lib", "chat", "index.js"), "utf8");
check("the chat keeps these cards asking (no Allow all, not resolved by a switch to Auto)", () => {
  assert.ok(/private: verdict\.private \|\| undefined/.test(chatSrc));
  assert.ok(/input\.device \|\| req\.unclassified \|\| verdict\.private \? undefined/.test(chatSrc));
  assert.ok(/b\.state !== "pending" \|\| b\.private\) continue;/.test(chatSrc));
});

fs.rmSync(home, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
