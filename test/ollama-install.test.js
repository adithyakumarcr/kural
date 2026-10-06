// Installing Ollama from Kural (extension/lib/ai/ollama-install.js): download with a percent, install with a percent,
// start it, wait until it answers. A local web server stands in for ollama.com; programs that would really start
// Ollama (open, pkexec) are stand-ins too.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const { spawn, spawnSync } = require("child_process");
const { OllamaInstaller, readLinux } = require("../extension/lib/ai/ollama-install");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-ollama-install-test-"));
const has = (p) => fs.existsSync(p);

(async () => {
  await check("install.sh's output is read: downloads, percent, steps, errors", async () => {
    assert.deepStrictEqual(readLinux(">>> Downloading ollama-linux-amd64.tar.zst"), { phase: "download", note: "Downloading ollama-linux-amd64.tar.zst" });
    assert.deepStrictEqual(readLinux("######################                     45.3%"), { percent: 45 });
    assert.deepStrictEqual(readLinux("\x1b[1m>>> Creating ollama systemd service...\x1b[0m"), { phase: "install", note: "Creating ollama systemd service...", percent: 70 });
    assert.deepStrictEqual(readLinux(">>> Installing ollama to /usr/local"), { note: "Installing ollama to /usr/local" });
    assert.strictEqual(readLinux("ERROR: This version requires zstd for extraction.").error, "This version requires zstd for extraction.");
    assert.strictEqual(readLinux("something else"), null);
  });

  // ollama.com stand-in: /download/<file> from `files`, a Content-Length so there is a percent.
  const files = {};
  const server = http.createServer((req, res) => {
    const f = files[req.url];
    if (!f) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Length": f.length });
    // In pieces, so the percent moves.
    let i = 0; const step = Math.ceil(f.length / 10);
    const next = () => { if (i >= f.length) return res.end(); res.write(f.subarray(i, i += step)); setImmediate(next); };
    next();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/download`;

  const canZip = has("/usr/bin/unzip") && spawnSync("zip", ["-v"]).status === 0;
  await check("Mac: downloads Ollama.app, installs it with a percent, opens it, waits until it answers", async () => {
    if (!canZip) return console.log("     (skipped: no zip/unzip here)");
    const src = path.join(tmp, "src");
    fs.mkdirSync(path.join(src, "Ollama.app", "Contents", "Resources"), { recursive: true });
    for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(src, "Ollama.app", "Contents", "Resources", `f${i}`), "x".repeat(5000));
    spawnSync("zip", ["-qr", path.join(tmp, "o.zip"), "Ollama.app"], { cwd: src });
    files["/download/Ollama-darwin.zip"] = fs.readFileSync(path.join(tmp, "o.zip"));
    const apps = path.join(tmp, "Applications");
    let up = false; const opened = [];
    const run = (cmd, args, opts) => {
      if (cmd === "/usr/bin/open") { opened.push(args); setTimeout(() => { up = true; }, 50); return spawn("true", [], opts); }
      return spawn(cmd, args, opts);
    };
    const inst = new OllamaInstaller({ platform: "darwin", base, appsDirs: [apps], run, isUp: async () => up, waitMs: 5000 });
    const seen = [];
    inst.onProgress((s) => { if (s) seen.push({ ...s }); });
    await inst.install();
    assert.ok(has(path.join(apps, "Ollama.app", "Contents", "Resources", "f19")), "Ollama.app is installed");
    assert.deepStrictEqual(fs.readdirSync(apps), ["Ollama.app"], "no unpacking folder left behind");
    assert.deepStrictEqual(opened[0], ["-a", path.join(apps, "Ollama.app"), "--args", "hidden"]);
    const dl = seen.filter((s) => s.phase === "download").map((s) => s.percent);
    const ins = seen.filter((s) => s.phase === "install").map((s) => s.percent);
    assert.ok(dl.length > 3 && dl[dl.length - 1] === 100, `download percent: ${dl}`);
    assert.ok(ins.length > 2 && ins[ins.length - 1] === 100 && ins.some((p) => p > 0 && p < 100), `install percent: ${ins}`);
    assert.ok(seen.some((s) => s.phase === "start"));
    assert.strictEqual(inst.state, null, "done: no state left");

    // Installed already, just not running: started, nothing downloaded.
    up = false; delete files["/download/Ollama-darwin.zip"];
    await inst.install();
    assert.strictEqual(opened.length, 2);
  });

  await check("already running: does nothing", async () => {
    const inst = new OllamaInstaller({ platform: "darwin", base, appsDirs: [path.join(tmp, "none")], run: () => { throw new Error("ran something"); }, isUp: async () => true });
    await inst.install();
  });

  await check("Linux: install.sh through pkexec; its output becomes download and install percent", async () => {
    files["/install.sh"] = Buffer.from("echo fake\n");
    const fake = path.join(tmp, "fake-install.js");
    fs.writeFileSync(fake, `
      const w = (s) => process.stderr.write(s);
      w(">>> Installing ollama to /usr/local\\n>>> Downloading ollama-linux-amd64.tar.zst\\n");
      w("\\r####    10.0%\\r########   55.5%\\r############ 100.0%\\n");
      w(">>> Making ollama accessible in the PATH in /usr/local/bin\\n>>> Creating ollama systemd service...\\n>>> Enabling and starting ollama service...\\n");
      w(">>> The Ollama API is now available at 127.0.0.1:11434.\\n");`);
    let up = false; const ran = [];
    const run = (cmd, args, opts) => { ran.push([cmd, ...args]); up = true; return spawn(process.execPath, [fake], opts); };
    const inst = new OllamaInstaller({ platform: "linux", base, run, isUp: async () => up, waitMs: 3000 });
    const seen = [];
    inst.onProgress((s) => { if (s) seen.push({ ...s }); });
    await inst.install();
    if (!(process.getuid && process.getuid() === 0)) assert.strictEqual(ran[0][0], "pkexec");
    assert.ok(ran[0][ran[0].length - 1].endsWith("install.sh"));
    const dl = seen.filter((s) => s.phase === "download").map((s) => s.percent);
    assert.ok(dl.includes(56) && dl.includes(100), `download percent: ${dl}`);
    const ins = seen.filter((s) => s.phase === "install").map((s) => s.percent);
    assert.deepStrictEqual([...new Set(ins)], [20, 70, 85, 100]);
  });

  await check("Linux: closing the password window says so", async () => {
    const run = (cmd, args, opts) => spawn(process.execPath, ["-e", "process.exit(126)"], opts);
    const inst = new OllamaInstaller({ platform: "linux", base, run, isUp: async () => false, waitMs: 100 });
    await assert.rejects(inst.install(), /password window was closed/);
    assert.strictEqual(inst.job, null);
  });

  await check("a failed download says what went wrong", async () => {
    const inst = new OllamaInstaller({ platform: "win32", base: base + "/nothing", run: spawn, isUp: async () => false });
    inst.installed = () => null;
    await assert.rejects(inst.install(), /answered 404/);
  });

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
