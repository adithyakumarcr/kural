// Two small helpers:
//   ws.find (lib/workspace.js): a file named in the chat ("devices.test.js", a link) opens the project's file, also when
//     the AI wrote just its name or a path from another folder (it used to say "Kural can't find devices.test.js").
//   brain.fastestModel (lib/ai/index.js): Search & Ask uses the fastest model you have (Haiku, a "mini"/"flash" one).
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");

const proj = fs.mkdtempSync(path.join(os.tmpdir(), "kural-links-"));
const put = (rel, text = "x") => { const f = path.join(proj, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
put("test/devices.test.js"); put("extension/lib/chat/index.js"); put("README.md");
put("node_modules/pkg/devices.test.js"); put("dist/lib/chat/index.js"); put("lib/chat/index.js.map");
put("a/util.js"); put("b/deeper/util.js");
put("web/pages/[id].tsx"); put("web/pages/xidx.tsx");   // (a name with glob characters, and one its pattern also matches)

// A stand-in for VS Code: one folder open; findFiles walks it (the include is "**/<path>", the exclude a {a,b} list).
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const vscode = {
  workspace: { workspaceFolders: [{ name: "proj", uri: { scheme: "file", fsPath: proj } }],
    findFiles: async (pattern, exclude) => {
      // ("**/" + a path in which ? is any one character)
      const tail = new RegExp(`(^|/)${pattern.pattern.replace(/^\*\*\//, "").replace(/[.+^$()|\\/]/g, "\\$&").replace(/\?/g, "[^/]")}$`);
      const skip = /\{([^}]+)\}/.exec(exclude || "");
      return walk(pattern.base).filter((f) => {
        const rel = path.relative(pattern.base, f).split(path.sep).join("/");
        if (skip && rel.split("/").some((p) => skip[1].split(",").includes(p))) return false;
        return tail.test(rel);
      }).map((f) => ({ fsPath: f }));
    } },
  RelativePattern: class { constructor(base, pattern) { this.base = base.fsPath; this.pattern = pattern; } },
  Uri: { file: (f) => ({ scheme: "file", fsPath: f }) },
};
const load = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const ws = require("../extension/lib/workspace");
const brain = require("../extension/lib/ai");
const claude = require("../extension/lib/ai/claude");

let passed = 0, failed = 0;
const check = async (name, fn) => { try { await fn(); passed++; console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const labels = async (p) => (await ws.find(p)).map((f) => f.label);

(async () => {
  await check("a path as written opens that file", async () => {
    assert.deepStrictEqual(await labels("test/devices.test.js"), ["test/devices.test.js"]);
    assert.deepStrictEqual(await labels(path.join(proj, "README.md")), ["README.md"]);
    assert.deepStrictEqual(await labels("./README.md"), ["README.md"]);
  });
  await check("just the file's name: the project's file with that name (not one in node_modules)", async () => {
    assert.deepStrictEqual(await labels("devices.test.js"), ["test/devices.test.js"]);
  });
  await check("a path from inside another folder: the file it ends with; build output (dist) last", async () => {
    assert.deepStrictEqual(await labels("lib/chat/index.js"), ["extension/lib/chat/index.js", "dist/lib/chat/index.js"]);
  });
  await check("a leading / that isn't on this computer counts as the project's", async () => {
    assert.deepStrictEqual(await labels("/test/devices.test.js"), ["test/devices.test.js"]);
  });
  await check("several with the same name: all of them, the shortest path first (you pick one)", async () => {
    assert.deepStrictEqual(await labels("util.js"), ["a/util.js", "b/deeper/util.js"]);
  });
  await check("a name with glob characters (Next.js's [id].tsx): that file only", async () => {
    assert.deepStrictEqual(await labels("pages/[id].tsx"), ["web/pages/[id].tsx"]);
  });
  await check("nothing there, or a path going up: none (Kural says it can't find it)", async () => {
    assert.deepStrictEqual(await labels("missing.js"), []);
    assert.deepStrictEqual(await labels("../secret.txt"), []);
    assert.deepStrictEqual(await labels(""), []);
  });

  await check("fastest model: the chat's AI first (Claude → Haiku), else the lightest model of another AI", () => {
    claude.setSetupGate(() => true);
    brain.setCli("codex", { ready: true, bin: "/bin/codex", models: [
      { id: "gpt-6", label: "GPT-6", description: "Frontier model for complex work", isDefault: true },
      { id: "gpt-6-mini", label: "GPT-6 mini", description: "Fast and affordable model for easier tasks" },
      { id: "gpt-5-mini", label: "GPT-5 mini", description: "Older fast model (legacy)" }] });
    brain.setCli("agy", { ready: true, bin: "/bin/agy", models: [{ id: "gemini-3.8-pro", label: "Gemini 3.8 Pro" }, { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" }] });
    assert.strictEqual(brain.fastestModel("opus"), "haiku");
    assert.strictEqual(brain.fastestModel("codex:gpt-6"), "codex:gpt-6-mini");   // (not the legacy mini)
    assert.strictEqual(brain.fastestModel("agy:gemini-3.8-pro"), "agy:gemini-3.8-flash");
    // A model on this computer in the chat: a cloud AI is still faster.
    assert.strictEqual(brain.fastestModel("ollama:qwen3:8b"), "haiku");
  });
  await check("fastest model: Claude not set up → Gemini's or Codex's lightest (Kural's order); nothing in the cloud → your own model", () => {
    claude.setSetupGate(() => false);
    assert.strictEqual(brain.fastestModel("sonnet"), "agy:gemini-3.8-flash");
    brain.setCli("agy", { ready: false });
    assert.strictEqual(brain.fastestModel("sonnet"), "codex:gpt-6-mini");
    brain.setCli("codex", { ready: false });
    assert.strictEqual(brain.fastestModel("ollama:qwen3:8b"), "ollama:qwen3:8b");
  });

  console.log(`links-fastest: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
