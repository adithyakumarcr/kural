// Voice input: downloading Whisper (extension/lib/voice/assets.js). A stand-in server; progress; a wrong hash or size is
// refused and deleted; Stop leaves nothing; files already there aren't downloaded again; ready() checks hashes once.
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { Assets } = require("../extension/lib/voice/assets");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

const A = Buffer.alloc(300000, 7), B = Buffer.from("model bytes ".repeat(5000));
let slow = false;
const server = http.createServer((req, res) => {
  const body = req.url === "/a" ? A : req.url === "/b" ? B : null;
  if (!body) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-length": body.length });
  if (!slow) return res.end(body);
  res.write(body.subarray(0, 1000));   // (then waits: Stop happens meanwhile)
});
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "kural-voice-"));

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const files = (over = {}) => [
    { name: "loader", file: "a.js", url: `${base}/a`, size: A.length, sha256: sha(A), ...(over.a || {}) },
    { name: "model", file: "b.bin", url: `${base}/b`, size: B.length, sha256: sha(B), ...(over.b || {}) },
  ];

  await check("download fetches every file, reports progress up to total, and ready() is true after", async () => {
    const dir = tmp(), a = new Assets(dir, { files: files() }), seen = [];
    assert.strictEqual(await a.ready(), false);
    await a.download({ onProgress: (got, total) => seen.push([got, total]) });
    assert.ok(fs.readFileSync(path.join(dir, "a.js")).equals(A) && fs.readFileSync(path.join(dir, "b.bin")).equals(B));
    assert.deepStrictEqual(seen[seen.length - 1], [A.length + B.length, A.length + B.length]);
    assert.ok(seen.every(([g], i) => i === 0 || g >= seen[i - 1][0]), "progress only goes up");
    assert.strictEqual(await a.ready(), true);
    assert.deepStrictEqual(a.paths(), { loader: path.join(dir, "a.js"), model: path.join(dir, "b.bin") });
    if (process.platform !== "win32") assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700);   // (Windows has no Unix modes)
  });

  await check("a wrong sha256 deletes the file and rejects with \"Whisper's download didn't match\"", async () => {
    const dir = tmp(), a = new Assets(dir, { files: files({ b: { sha256: "0".repeat(64) } }) });
    await assert.rejects(a.download({}), /Whisper's download didn't match/);
    assert.ok(!fs.existsSync(path.join(dir, "b.bin")) && !fs.existsSync(path.join(dir, "b.bin.part")));
    assert.strictEqual(await a.ready(), false);
  });

  await check("a wrong size is refused the same way", async () => {
    const dir = tmp(), a = new Assets(dir, { files: files({ a: { size: A.length + 5 } }) });
    await assert.rejects(a.download({}), /Whisper's download didn't match/);
    assert.ok(!fs.existsSync(path.join(dir, "a.js")));
  });

  await check("Stop (signal.abort) leaves no files and ready() is false", async () => {
    const dir = tmp(), a = new Assets(dir, { files: files() }), ctl = new AbortController();
    slow = true;
    const p = a.download({ signal: ctl.signal, onProgress: () => ctl.abort() });
    await assert.rejects(p);
    slow = false;
    assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => !f.startsWith(".")), []);
    assert.strictEqual(await a.ready(), false);
  });

  await check("a file already there with the right hash isn't downloaded again", async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "a.js"), A);
    const a = new Assets(dir, { files: files({ a: { url: `${base}/missing` } }) });
    await a.download({});
    assert.strictEqual(await a.ready(), true);
  });

  await check("ready() checks hashes once, then trusts size and mtime", async () => {
    const dir = tmp(), a = new Assets(dir, { files: files() });
    await a.download({});
    // (Whole seconds: a date restored from a Date can come back a millisecond off.)
    const f = path.join(dir, "b.bin"), when = 1700000000, bad = Buffer.from(B); bad[0] ^= 1;
    fs.utimesSync(f, when, when);
    assert.strictEqual(await a.ready(), true);
    fs.writeFileSync(f, bad); fs.utimesSync(f, when, when);
    assert.strictEqual(await a.ready(), true, "same size and date: trusted");
    fs.appendFileSync(f, "x");
    assert.strictEqual(await a.ready(), false, "size changed: checked again");
    const b = new Assets(dir, { files: files() });
    fs.writeFileSync(f, bad);
    assert.strictEqual(await b.ready(), false, "a new start checks the hash");
  });

  await check("remove() deletes the folder's files", async () => {
    const dir = tmp(), a = new Assets(dir, { files: files() });
    await a.download({});
    await a.remove();
    assert.strictEqual(await a.ready(), false);
    assert.ok(!fs.existsSync(path.join(dir, "b.bin")));
  });

  server.close();
  console.log(failed ? `voice-assets: ${failed} FAILED` : "voice-assets: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
