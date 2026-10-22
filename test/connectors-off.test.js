// Connectors turned off in Kural Settings (issue #105: "everywhere in Kural"): the list, and what Claude and Codex are
// started with. lib/ai/connectors-off.js, lib/ai/claude.js (--disallowedTools), lib/ai/codex.js (lockdownArgs).
const assert = require("assert");
const Module = require("module");
const load = Module._load;
const config = {};   // (kural.claudePath for the Claude check below)
Module._load = function (req, ...a) { return req === "vscode" ? { workspace: { getConfiguration: () => ({ get: (k, d) => k in config ? config[k] : d }) } } : load.call(this, req, ...a); };
const off = require("../extension/lib/ai/connectors-off");
const codex = require("../extension/lib/ai/codex");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };

(async () => {
  let saved = {};
  off.init(() => saved, async (v) => { saved = JSON.parse(JSON.stringify(v)); });

  await check("turn off, list, turn on again", async () => {
    assert.deepStrictEqual(off.list("claude"), []);
    assert.ok(await off.set("claude", "claude.ai Figma", true));
    assert.ok(await off.set("claude", "claude.ai Figma", true));   // (twice: still once)
    assert.ok(await off.set("codex", "notion", true));
    assert.deepStrictEqual(off.list("claude"), ["claude.ai Figma"]);
    assert.ok(off.isOff("codex", "notion") && !off.isOff("claude", "notion"));
    assert.ok(await off.set("claude", "claude.ai Figma", false));
    assert.deepStrictEqual(saved, { claude: [], codex: ["notion"] });
  });
  await check("only Claude and ChatGPT, and real names", async () => {
    assert.ok(!(await off.set("agy", "x", true)));
    assert.ok(!(await off.set("claude", "", true)));
    assert.ok(!(await off.set("claude", "a\nb", true)));
    saved = { claude: ["ok", 5, "", "ok"] };
    assert.deepStrictEqual(off.list("claude"), ["ok"]);
  });
  await check("Claude Code's tool names: anything but letters, digits, _ and - becomes _", () => {
    assert.strictEqual(off.toolPrefix("claude.ai Atlassian MCP"), "mcp__claude_ai_Atlassian_MCP");
    assert.strictEqual(off.toolPrefix("plugin:github:github"), "mcp__plugin_github_github");
    assert.strictEqual(off.toolPrefix("my-server_2"), "mcp__my-server_2");
  });
  await check("Codex: an off connector is switched off in every mode; Plan and Ask still switch off all", () => {
    const { lockdownArgs } = codex._test;
    const servers = (args) => (args.find((a) => a.startsWith("mcp_servers=")) || "");
    for (const mode of ["agent", "auto"]) {
      const s = servers(lockdownArgs(mode, ["notion", { name: "figma", command: "npx" }], ["figma"]));
      assert.ok(s.includes("figma = { command = \"npx\", enabled = false }") && !s.includes("notion"), `${mode}: ${s}`);
    }
    assert.strictEqual(servers(lockdownArgs("agent", ["notion"], [])), "", "nothing off: no option");
    assert.strictEqual(servers(lockdownArgs("agent", ["notion"], ["gone"])), "", "a name Codex doesn't have: left out (Codex would refuse it)");
    const plan = servers(lockdownArgs("plan", ["notion", "figma"], []));
    assert.ok(plan.includes("notion = { enabled = false }") && plan.includes("figma = { enabled = false }"));
  });
  await check("Claude: the off connectors' tools are denied when your connectors are there, not in safe mode", async () => {
    if (process.platform === "win32") { console.log("     (skipped on Windows: the stand-in is a shell script)"); return; }
    saved = { claude: ["claude.ai Figma"] };
    // A stand-in claude that writes down how it was started, one argument per line.
    const fs = require("fs"), os = require("os"), path = require("path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kural-off-")), bin = path.join(dir, "claude"), out = path.join(dir, "args");
    fs.writeFileSync(bin, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done >> "${out}"; echo ---- >> "${out}"\n`, { mode: 0o755 });
    config.claudePath = bin;
    const claude = require("../extension/lib/ai/claude");
    claude.setSetupGate(() => true);
    const runs = [];
    for (const opts of [{ safeMode: false, strictMcp: false }, { safeMode: true }]) {
      const before = fs.existsSync(out) ? fs.readFileSync(out, "utf8").length : 0;
      await new Promise((resolve) => { const p = new claude.ClaudeProcess({ name: "t", model: "haiku", tools: [], ...opts }, { onExit: resolve }); assert.ok(p.start()); });
      runs.push(fs.readFileSync(out, "utf8").slice(before).split("\n"));
    }
    fs.rmSync(dir, { recursive: true, force: true });
    const deny = (args) => { const i = args.indexOf("--disallowedTools"); return i < 0 ? null : args[i + 1]; };
    assert.strictEqual(deny(runs[0]), "mcp__claude_ai_Figma");
    assert.strictEqual(deny(runs[1]), null);
  });
  console.log(fail ? `connectors-off: ${fail} FAILED` : "connectors-off: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
