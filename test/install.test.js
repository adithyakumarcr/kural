// Installing and logging in to Codex / Gemini without a terminal (extension/lib/ai/install.js, codexLogin,
// geminiLogin): questions become pop-ups, the login page opens in the browser.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { promptIn, runInstall, failure, _test } = require("../extension/lib/ai/install");
const { codexLogin } = require("../extension/lib/ai/codex");
const { geminiLogin } = require("../extension/lib/ai/gemini");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-install-test-"));

(async () => {
  await check("questions an installer asks are recognised", async () => {
    assert.strictEqual(promptIn("==> Downloading\nDo you want to continue? [Y/n] ").kind, "yesno");
    assert.strictEqual(promptIn("Need to install the following packages:\n  foo@1\nOk to proceed? (y) ").kind, "yesno");
    assert.strictEqual(promptIn("Overwrite? (y/N)").kind, "yesno");
    assert.strictEqual(promptIn("Press RETURN/ENTER to continue or any other key to abort:").kind, "enter");
    assert.strictEqual(promptIn("Password:").kind, "secret");
    assert.strictEqual(promptIn("\x1b[1mProceed?\x1b[0m [y/n]").kind, "yesno");
  });
  await check("ordinary output isn't a question", async () => {
    for (const t of ["added 112 packages in 9s", "==> Pouring gemini-cli--0.62.0.arm64_sequoia.bottle.tar.gz\n", "npm warn deprecated foo@1.0: use bar", "Why? Because.\n", "Proceed? (y)\n", "==> Password: \n"])
      assert.strictEqual(promptIn(t), null, t);
  });

  // A stand-in installer: asks twice, prints what it got, fails if you said no.
  const inst = path.join(tmp, "installer.js");
  fs.writeFileSync(inst, `
    const rl = require("readline").createInterface({ input: process.stdin });
    const lines = rl[Symbol.asyncIterator]();
    (async () => {
      process.stdout.write("Downloading...\\nInstall the helper too? [y/N] ");
      const a = (await lines.next()).value;
      process.stdout.write("Press RETURN to continue");
      await lines.next();
      console.log("\\nanswer=" + a);
      process.exit(a === "y" ? 0 : 1);
    })();`);
  const plan = { file: process.execPath, args: [inst], env: process.env };
  await check("each question becomes a pop-up and the answer goes back to the installer", async () => {
    const asked = [];
    const r = await runInstall(plan, { ask: async (q) => { asked.push(q.kind); return q.kind === "yesno" ? "y" : ""; } });
    assert.deepStrictEqual(asked, ["yesno", "enter"]);
    assert.strictEqual(r.ok, true); assert.match(r.output, /answer=y/);
  });
  await check("a question Kural doesn't know: asked as text after a quiet spell; Esc leaves it unanswered", async () => {
    const odd = path.join(tmp, "odd.js");
    fs.writeFileSync(odd, `process.stdout.write("Which shell profile should be changed ");
      process.stdin.once("data", (d) => { console.log("\\ngot=" + String(d).trim()); process.exit(0); });`);
    const plan2 = { file: process.execPath, args: [odd], env: process.env };
    const r = await runInstall(plan2, { quietMs: 300, ask: async (q) => (q.kind === "text" && /shell profile/.test(q.question) ? "zsh" : null) });
    assert.strictEqual(r.ok, true); assert.match(r.output, /got=zsh/);
    // Esc: nothing is typed and nothing is stopped (it may not have been a question); Cancel still stops it.
    const ac = new AbortController();
    const r2 = await runInstall(plan2, { quietMs: 300, signal: ac.signal, ask: async () => { setTimeout(() => ac.abort(), 300); return undefined; } });
    assert.strictEqual(r2.cancelled, true); assert.doesNotMatch(r2.output, /got=/);
  });
  await check("closing the pop-up stops the install", async () => {
    const r = await runInstall(plan, { ask: async () => null });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.cancelled, true);
  });
  await check("a failed install says why in a few lines; no permission → the retry into ~/.npm-global", async () => {
    assert.match(failure("npm ERR! code EACCES\nnpm ERR! path /usr/local/lib/node_modules\nnpm ERR! errno -13"), /EACCES/);
    assert.ok(_test.noPermission("npm ERR! Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/@google'"));
    const again = _test.userPrefixPlan({ file: "npm", args: ["install", "-g", "@google/gemini-cli"], text: "npm install -g @google/gemini-cli" });
    assert.deepStrictEqual(again.args.slice(-2), ["--prefix", path.join(os.homedir(), ".npm-global")]);
  });

  // Logins, against the stand-in programs.
  const opened = [];
  await check("Codex: the login page opens in the browser, and the login finishes", async () => {
    process.env.FAKE_CODEX_FILE = path.join(tmp, "codex-state");
    fs.writeFileSync(process.env.FAKE_CODEX_FILE, "loggedout");
    const r = await codexLogin(path.join(__dirname, "fake-codex.js"), { openUrl: (u) => opened.push(u) });
    assert.deepStrictEqual(r, { ok: true });
    assert.match(opened.pop(), /^https:\/\/auth\.example\//);
    assert.strictEqual(fs.readFileSync(process.env.FAKE_CODEX_FILE, "utf8"), "ok");
  });
  await check("Codex: Cancel stops the login", async () => {
    fs.writeFileSync(process.env.FAKE_CODEX_FILE, "loggedout");
    const ac = new AbortController();
    const r = await codexLogin(path.join(__dirname, "fake-codex.js"), { openUrl: () => ac.abort(), signal: ac.signal });
    assert.deepStrictEqual(r, { cancelled: true });
  });
  if (process.platform !== "win32") {
    await check("Gemini: Kural gets the login page's address (its own open / xdg-open) and opens it", async () => {
      process.env.FAKE_GEMINI_FILE = path.join(tmp, "gemini-state");
      fs.writeFileSync(process.env.FAKE_GEMINI_FILE, "loggedout");
      // Gemini CLI won't open a browser in CI or over SSH: Kural clears those for the login.
      const saved = process.env.CI; process.env.CI = "1";
      const r = await geminiLogin(path.join(__dirname, "fake-gemini.js"), { dir: tmp, openUrl: (u) => opened.push(u) });
      if (saved === undefined) delete process.env.CI; else process.env.CI = saved;
      assert.deepStrictEqual(r, { ok: true });
      await new Promise((res) => setTimeout(res, 400));
      assert.match(opened.pop() || "", /^https:\/\/accounts\.example\//);
      assert.strictEqual(fs.readFileSync(process.env.FAKE_GEMINI_FILE, "utf8"), "ok");
    });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `install: ${fail} FAILED` : "install: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
