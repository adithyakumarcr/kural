// Connectors in Kural Settings (lib/ai/connectors.js): reading `claude mcp list` / `codex mcp list --json`, the
// arguments for adding one, and a run against small fake programs.
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const C = require("../extension/lib/ai/connectors");
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

(async () => {
  await check("Claude's list: name, what it runs, status; claude.ai's own are marked", () => {
    const out = C.parseClaudeList("Checking MCP server health...\n\ngithub: npx -y @modelcontextprotocol/server-github - ✓ Connected\n" +
      "claude.ai Atlassian: https://mcp.atlassian.com/v1/sse - ! Needs authentication\nbroken: node x.js - ✗ Failed to connect\n");
    assert.deepStrictEqual(out.map((x) => [x.name, x.ok, x.managed, x.status]), [["github", true, "", "Connected"],
      ["claude.ai Atlassian", false, "claude.ai", "Needs authentication"], ["broken", false, "", "Failed to connect"]]);
    assert.strictEqual(out[0].target, "npx -y @modelcontextprotocol/server-github");
    assert.deepStrictEqual(C.parseClaudeList("No MCP servers configured. Use `claude mcp add` to add a server."), []);
  });
  await check("Codex's list (JSON)", () => {
    const out = C.parseCodexList(JSON.stringify([{ name: "docs", enabled: true, transport: { type: "streamable_http", url: "https://x.dev/mcp" } },
      { name: "fs", enabled: false, transport: { type: "stdio", command: "npx", args: ["-y", "fs-server"] } }]));
    assert.deepStrictEqual(out.map((x) => [x.name, x.target, x.ok]), [["docs", "https://x.dev/mcp", true], ["fs", "npx -y fs-server", false]]);
    assert.strictEqual(C.parseCodexList("not json"), null);
  });
  await check("adding: a command (quotes group words) or a web address; bad names and addresses are refused in words", () => {
    assert.deepStrictEqual(C.splitArgs(`npx -y "my server" --dir '/a b' ""`), ["npx", "-y", "my server", "--dir", "/a b", ""]);
    assert.deepStrictEqual(C.addArgs("claude", { name: "github", kind: "command", value: "npx -y srv" }).args, ["mcp", "add", "-s", "user", "github", "--", "npx", "-y", "srv"]);
    assert.deepStrictEqual(C.addArgs("claude", { name: "docs", kind: "url", value: "https://x.dev/mcp" }).args, ["mcp", "add", "-s", "user", "--transport", "http", "docs", "https://x.dev/mcp"]);
    assert.deepStrictEqual(C.addArgs("codex", { name: "docs", kind: "url", value: "https://x.dev/mcp" }).args, ["mcp", "add", "docs", "--url", "https://x.dev/mcp"]);
    assert.deepStrictEqual(C.addArgs("codex", { name: "fs", kind: "command", value: "npx fs" }).args, ["mcp", "add", "fs", "--", "npx", "fs"]);
    assert.match(C.addArgs("claude", { name: "two words", kind: "command", value: "x" }).error, /short name/);
    assert.match(C.addArgs("claude", { name: "-rf", kind: "command", value: "x" }).error, /short name/);   // (never an option)
    assert.match(C.addArgs("claude", { name: "a", kind: "url", value: "ftp://x" }).error, /https:\/\//);
    assert.match(C.addArgs("claude", { name: "a", kind: "command", value: "  " }).error, /command/);
    assert.match(C.addArgs("agy", { name: "a", kind: "command", value: "x" }).error, /can't/);
  });
  await check("against fake programs: list, add, remove, and an error in words", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kural-conn-")), log = path.join(dir, "log");
    const fake = path.join(dir, "fake-claude.js");
    fs.writeFileSync(fake, `const a = process.argv.slice(2); require("fs").appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + "\\n");
      if (a[1] === "list") console.log("Checking MCP server health...\\n\\ngithub: npx srv - ✓ Connected");
      else if (a[1] === "remove" && a[2] === "nope") { console.error("No MCP server found with name: nope"); process.exit(1); }`);
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
    assert.deepStrictEqual((await C.list("claude", fake, env)).servers.map((x) => x.name), ["github"]);
    assert.deepStrictEqual(await C.add("claude", fake, env, { name: "docs", kind: "url", value: "https://x.dev/mcp" }), { ok: true });
    assert.deepStrictEqual(await C.remove("claude", fake, env, "github"), { ok: true });
    assert.deepStrictEqual(await C.remove("claude", fake, env, "nope"), { error: "No MCP server found with name: nope" });
    assert.deepStrictEqual(await C.list("agy", fake, env), { supported: false, servers: [] });
    assert.match((await C.list("claude", null, env)).error, /not installed/);
    const calls = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepStrictEqual(calls[1], ["mcp", "add", "-s", "user", "--transport", "http", "docs", "https://x.dev/mcp"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  console.log(failed ? `connectors: ${failed} FAILED` : "connectors: ALL PASS");
  process.exitCode = failed ? 1 : 0;
})();
