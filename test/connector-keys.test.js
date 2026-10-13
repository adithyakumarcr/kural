// APP-9: a connector's key never goes on a command line (on Mac/Linux any user can see a running program's arguments).
// It goes into a private file that the connector reads when it starts. This runs the same `sh` wrapper and `cat`
// helper that Claude Code / Codex run (checked by hand with Claude Code 2.1.296 and Codex 0.160).
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const { execFileSync } = require("child_process");
const K = require("../extension/lib/ai/connector-catalog"), C = require("../extension/lib/ai/connectors");
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const unix = process.platform !== "win32";
const SECRET = "s3cr'et $HOME `x` \"q\"";

(async () => {
  const keyDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kural-keys-")), "dir with space", "connector-keys");
  const github = K.BUILT_IN.find((b) => b.id === "github");
  const local = { id: "x", kind: "npm", package: "some-server", inputs: [{ key: "k", label: "Key", secret: true, env: "SOME_API_KEY" }] };

  await check("a web connector's key: add-json with a headersHelper; the key only in a 0600 file", () => {
    const a = K.addArgs("claude", github, { token: SECRET }, [], { keyDir, platform: "linux" });
    assert.ok(!a.args.join("\n").includes("s3cr"), "key on the command line");
    assert.deepStrictEqual(a.args.slice(0, 5), ["mcp", "add-json", "-s", "user", "github"]);
    const json = JSON.parse(a.args[5]);
    assert.strictEqual(json.type, "http"); assert.match(json.headersHelper, /^cat '/);
    assert.deepStrictEqual(JSON.parse(a.files[0].data), { Authorization: "Bearer " + SECRET });
    if (unix) {   // what Claude Code runs (through a shell) prints exactly the headers
      require("../extension/lib/private-file").writePrivate(a.files[0].path, a.files[0].data);
      assert.strictEqual(fs.statSync(a.files[0].path).mode & 0o777, 0o600);
      assert.deepStrictEqual(JSON.parse(execFileSync("sh", ["-c", json.headersHelper], { encoding: "utf8" })), { Authorization: "Bearer " + SECRET });
    }
  });

  await check("a local connector's key: sh reads the file, then runs the command with the variable set", () => {
    for (const ai of ["claude", "codex"]) {
      const a = K.addArgs(ai, local, { k: SECRET }, [], { keyDir, platform: "linux" });
      assert.ok(!a.args.join("\n").includes("s3cr"), `${ai}: key on the command line`);
      const run = a.args.slice(a.args.indexOf("--") + 1);
      assert.deepStrictEqual(run.slice(0, 3), ["sh", "-c", K.ENV_RUN]);
      assert.deepStrictEqual(run.slice(4), ["npx", "-y", "some-server"]);
      if (unix) {
        require("../extension/lib/private-file").writePrivate(a.files[0].path, a.files[0].data);
        const out = execFileSync(run[0], [...run.slice(1, 4), process.execPath, "-e", "process.stdout.write(process.env.SOME_API_KEY)"],
          { encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
        assert.strictEqual(out, SECRET, `${ai}: the variable arrives unchanged`);
      }
    }
  });

  await check("the page shows the connector's own command, not Kural's wrapper", () => {
    const file = K.keyFile(keyDir, "claude", "x", "env");
    assert.strictEqual(K.unwrapTarget(`sh -c . "$0"; exec "$@" ${file} npx -y some-server`), "npx -y some-server");
    assert.strictEqual(C.parseClaudeList(`x: sh -c . "$0"; exec "$@" ${file} npx -y some-server - √ Connected`)[0].target, "npx -y some-server");
    assert.strictEqual(C.parseCodexList(JSON.stringify([{ name: "x", enabled: true, transport: { type: "stdio", command: "sh", args: ["-c", K.ENV_RUN, file, "npx", "srv"] } }]))[0].target, "npx srv");
    assert.strictEqual(K.unwrapTarget("npx -y other"), "npx -y other");
  });

  await check("Windows (no sh, and others can't read command lines there) and no key folder: the old arguments", () => {
    assert.ok(!K.addArgs("claude", local, { k: "v" }, [], { keyDir, platform: "win32" }).files);
    assert.deepStrictEqual(K.addArgs("claude", local, { k: "v" }, []).args, ["mcp", "add", "-s", "user", "x", "-e", "SOME_API_KEY=v", "--", "npx", "-y", "some-server"]);
  });

  await check("adding writes the file before the program runs; a failure or a removal deletes it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kural-keys-fake-")), log = path.join(dir, "log"), fake = path.join(dir, "fake.js");
    fs.writeFileSync(fake, `const a = process.argv.slice(2), fs = require("fs");
      fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ a, files: fs.readdirSync(${JSON.stringify(keyDir)}) }) + "\\n");
      if (a.includes("bad")) process.exit(1);`);
    fs.rmSync(keyDir, { recursive: true, force: true });
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
    const r = await C.addItem("codex", fake, env, { ...local, id: "bad" }, { k: SECRET }, [], keyDir);
    assert.ok(r.error);
    if (unix) assert.deepStrictEqual(fs.readdirSync(keyDir), [], "a failed add leaves no key behind");
    assert.deepStrictEqual(await C.addItem("codex", fake, env, local, { k: SECRET }, [], keyDir), { ok: true, name: "x" });
    const calls = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    if (unix) {
      assert.deepStrictEqual(calls[1].files, ["codex-x.env"], "the key file is there when the program runs");
      assert.deepStrictEqual(await C.remove("codex", fake, env, "x", null, keyDir), { ok: true });
      assert.deepStrictEqual(fs.readdirSync(keyDir), []);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  fs.rmSync(path.dirname(path.dirname(keyDir)), { recursive: true, force: true });
  console.log(failed ? `connector-keys: ${failed} FAILED` : "connector-keys: ALL PASS");
  process.exitCode = failed ? 1 : 0;
})();
