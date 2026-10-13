// The updater's network limits and messages (REL-7, UX-1), the Windows script's byte order mark (BUG-13) and the
// re-check right before pkexec (REL-3). A local HTTP server plays GitHub; nothing leaves this computer.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const Module = require("module");

// A tiny vscode stand-in that records what the updater shows.
const shown = [];
const vscodeStub = {
  ProgressLocation: { Notification: 15 },
  Uri: { parse: (u) => u },
  env: { openExternal() {} },
  workspace: { getConfiguration: () => ({ get: () => false }) },
  window: {
    withProgress: (_o, fn) => fn({ report() {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }),
    showWarningMessage: (m) => { shown.push(["warn", m]); return Promise.resolve(); },
    showErrorMessage: (m) => { shown.push(["error", m]); return Promise.resolve(); },
    showInformationMessage: (m) => { shown.push(["info", m]); return Promise.resolve(); },
  },
};
const load = Module._load;
Module._load = function (req, ...a) { return req === "vscode" ? vscodeStub : load.call(this, req, ...a); };

const net = require("../extension/lib/update-net");
const { verifiedCopy } = require("../extension/lib/release-verify");
const { Updater, winScript } = require("../extension/lib/updates");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-upd-net-"));
let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e && e.stack || e); } };

// Routes: /big (100 KB with a length), /bigchunked (100 KB, no length), /hang (never answers), /stall (10 bytes, then
// nothing), /file (64 bytes), /small (SHA256SUMS-sized).
const BODY = crypto.randomBytes(64);
const server = http.createServer((req, res) => {
  if (req.url === "/big") { res.writeHead(200, { "content-length": 100 * 1024 }); res.end(Buffer.alloc(100 * 1024, 97)); }
  else if (req.url === "/bigchunked") { res.writeHead(200); for (let i = 0; i < 100; i++) res.write(Buffer.alloc(1024, 97)); res.end(); }
  else if (req.url === "/hang") { /* never answers */ }
  else if (req.url === "/stall") { res.writeHead(200, { "content-length": 1000 }); res.write(Buffer.alloc(10)); }
  else if (req.url === "/file") { res.writeHead(200, { "content-length": BODY.length }); res.end(BODY); }
  else if (req.url === "/small") { res.writeHead(200); res.end("a".repeat(64) + "  x.zip\n"); }
  else { res.writeHead(404); res.end(); }
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const lim = { bytes: 64 * 1024, ms: 2000 };

  await check("REL-7: a checksum list over 64 KB is refused (with a length, and without one)", async () => {
    await assert.rejects(net.getText(`${base}/big`, lim), net.TooBig);
    await assert.rejects(net.getText(`${base}/bigchunked`, lim), net.TooBig);
    assert.match(await net.getText(`${base}/small`, lim), /x\.zip/);
  });
  await check("REL-7: a server that never answers times out (and counts as no connection)", async () => {
    const t = Date.now();
    const e = await net.getText(`${base}/hang`, { bytes: 1024, ms: 300 }).then(() => null, (x) => x);
    assert.ok(e, "should fail");
    assert.ok(Date.now() - t < 3000);
    assert.ok(net.isOffline(e), `${e.name}: ${e.message}`);
  });
  await check("REL-7: a download that stalls stops after the idle limit", async () => {
    const e = await net.downloadTo(`${base}/stall`, path.join(tmp, "stall"), { idleMs: 300 }).then(() => null, (x) => x);
    assert.ok(e && e.name === "TimeoutError", e && e.message);
  });
  await check("REL-7: a download bigger than GitHub's listed size (or the cap) is refused", async () => {
    await assert.rejects(net.downloadTo(`${base}/file`, path.join(tmp, "f1"), { expectedSize: 10 }), net.TooBig);
    await assert.rejects(net.downloadTo(`${base}/big`, path.join(tmp, "f2"), { max: 1024 }), net.TooBig);
    await assert.rejects(net.downloadTo(`${base}/bigchunked`, path.join(tmp, "f3"), { max: 1024 }), net.TooBig);
  });
  await check("a normal download still works; Cancel is an abort, not 'no connection'", async () => {
    await net.downloadTo(`${base}/file`, path.join(tmp, "ok"), { expectedSize: BODY.length });
    assert.deepStrictEqual(fs.readFileSync(path.join(tmp, "ok")), BODY);
    const ctl = new AbortController();
    const p = net.downloadTo(`${base}/stall`, path.join(tmp, "c"), { cancel: ctl.signal, idleMs: 5000 });
    setTimeout(() => ctl.abort(), 100);
    const e = await p.then(() => null, (x) => x);
    assert.ok(e && !net.isOffline(e), e && e.name);
  });
  await check("UX-1: no connection is recognised (refused port, unknown host); other errors aren't", async () => {
    const s2 = http.createServer();
    await new Promise((r) => s2.listen(0, "127.0.0.1", r));
    const port = s2.address().port;
    await new Promise((r) => s2.close(r));                          // nothing listens there now
    const refused = await fetch(`http://127.0.0.1:${port}/`).then(() => null, (x) => x);
    assert.ok(net.isOffline(refused), refused && refused.message);
    const dns = await fetch("http://kural-update-check.invalid/").then(() => null, (x) => x);
    assert.ok(net.isOffline(dns), dns && dns.message);
    assert.ok(!net.isOffline(new Error("the checksum list isn't signed")));
    assert.ok(!net.isOffline(new net.TooBig("x")));
  });
  await check("UX-1: Check for Updates offline says so in plain words", async () => {
    const realFetch = global.fetch;
    global.fetch = async () => { throw new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo ENOTFOUND api.github.com"), { code: "ENOTFOUND" }) }); };
    try {
      shown.length = 0;
      const u = new Updater({ extension: { packageJSON: { version: "1.0.0" } }, globalState: { get() {}, update() {} }, subscriptions: [] });
      await u.check();
      assert.deepStrictEqual(shown, [["warn", "Couldn't check for updates: no connection."]]);
      shown.length = 0;
      u.failed(Object.assign(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }), { duringDownload: true }));
      assert.match(shown[0][1], /^Couldn't download the update: no connection/);
      shown.length = 0;
      u.failed(new Error("the download is damaged"));
      assert.deepStrictEqual(shown, [["error", "Kural couldn't update: the download is damaged"]]);
    } finally { global.fetch = realFetch; }
  });
  await check("BUG-13: install.ps1 starts with a UTF-8 byte order mark and keeps non-ASCII paths", () => {
    const text = winScript({ pid: 42, inside: "C:\\Users\\Zoë\\மதுரை\\Kural\\", steps: "", logFile: "C:\\Users\\Zoë\\update.log" });
    const bytes = Buffer.from(text, "utf8");
    assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.ok(bytes.toString("utf8").includes("மதுரை"));
  });
  await check("REL-3: the file pkexec gets is a fresh private copy, hashed again; a swapped file is refused", () => {
    const f = path.join(tmp, "kural_9.9.9_amd64.deb");
    fs.writeFileSync(f, "the real package");
    const sha = crypto.createHash("sha256").update("the real package").digest("hex");
    const copy = verifiedCopy(f, sha);
    assert.notStrictEqual(path.dirname(copy), path.dirname(f));
    assert.strictEqual(fs.readFileSync(copy, "utf8"), "the real package");
    if (process.platform !== "win32") assert.strictEqual(fs.statSync(path.dirname(copy)).mode & 0o077, 0, "private folder");   // (no Unix modes on Windows; this is the Ubuntu updater)
    fs.writeFileSync(f, "a swapped package");                       // changed after the first check
    assert.throws(() => verifiedCopy(f, sha), /changed after it was checked/);
    assert.throws(() => verifiedCopy(f, undefined), /no signed checksum/);
    fs.rmSync(path.dirname(copy), { recursive: true, force: true });
  });

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `audit-update-net: ${fail} FAILED` : "audit-update-net: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
