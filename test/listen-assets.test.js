// Listen: the voice's download (extension/lib/listen/assets.js, on voice input's Assets): every file pinned by size and
// SHA-256 for each platform Kural ships on; a stand-in server for the download itself; a wrong hash is deleted with
// Listen's own words.
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { ENGINES, filesFor, assetsFor, totalBytes, supported } = require("../extension/lib/listen/assets");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "kural-listen-"));
const PLATFORMS = [["linux", "x64"], ["darwin", "arm64"], ["win32", "x64"]];

(async () => {
  await check("Supertonic is the engine, with its rate, voice and tags", () => {
    const e = ENGINES.supertonic;
    assert.strictEqual(e.rate, 44100);
    assert.strictEqual(e.voice, "F1");
    assert.deepStrictEqual(e.tags, ["laugh", "breath", "sigh"]);
  });
  await check("every pinned file has an https address, a size and a SHA-256, on every platform", () => {
    for (const [p, a] of PLATFORMS) {
      const files = filesFor("supertonic", p, a);
      assert.ok(files.length >= 11, `${p}-${a}: ${files.length}`);
      for (const f of files) {
        assert.ok(/^https:\/\//.test(f.url), f.url);
        assert.ok(Number.isInteger(f.size) && f.size > 0, f.file);
        assert.ok(/^[0-9a-f]{64}$/.test(f.sha256), f.file);
        assert.ok(!/[\\/]/.test(f.file), `flat file names: ${f.file}`);
      }
      assert.strictEqual(new Set(files.map((f) => f.name)).size, files.length, "names are unique");
    }
  });
  await check("the native files are the platform's own; the model is the same everywhere", () => {
    const lib = (p, a) => filesFor("supertonic", p, a).find((f) => f.name === "lib");
    assert.strictEqual(lib("linux", "x64").file, "libonnxruntime.so.1");
    assert.strictEqual(lib("darwin", "arm64").file, "libonnxruntime.1.23.2.dylib");
    assert.strictEqual(lib("win32", "x64").file, "onnxruntime.dll");
    assert.ok(/\/tts-runtime-1\.23\.2\/linux-x64-libonnxruntime\.so\.1$/.test(lib("linux", "x64").url));
    assert.ok(filesFor("supertonic", "linux", "x64").some((f) => f.name === "ve" && f.size === 256534781));
  });
  await check("a platform Kural doesn't ship on has no voice", () => {
    assert.strictEqual(supported("supertonic", "linux", "arm64"), false);
    assert.strictEqual(filesFor("supertonic", "linux", "arm64"), null);
    assert.strictEqual(supported("supertonic", "linux", "x64"), true);
  });
  await check("totalBytes adds up the platform's files (about 430 MB)", () => {
    const n = totalBytes("supertonic", "linux", "x64");
    assert.strictEqual(n, filesFor("supertonic", "linux", "x64").reduce((s, f) => s + f.size, 0));
    assert.ok(n > 400e6 && n < 460e6, String(n));
  });

  // The download itself, with stand-in files.
  const A = Buffer.alloc(20000, 3), B = Buffer.from("voice ".repeat(3000));
  const server = http.createServer((req, res) => {
    const body = req.url === "/a" ? A : req.url === "/b" ? B : null;
    if (!body) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-length": body.length }); res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const stand = (over = {}) => [
    { name: "dp", file: "a.onnx", url: `${base}/a`, size: A.length, sha256: sha(A) },
    { name: "voice", file: "b.json", url: `${base}/b`, size: B.length, sha256: over.badB ? "0".repeat(64) : sha(B) },
  ];
  await check("a good download lands in the folder and ready() is true", async () => {
    const dir = tmp(), a = assetsFor(dir, "supertonic", { files: stand() });
    assert.strictEqual(await a.ready(), false);
    await a.download();
    assert.strictEqual(await a.ready(), true);
    assert.ok(fs.readFileSync(path.join(dir, "b.json")).equals(B));
    assert.strictEqual(a.paths().dp, path.join(dir, "a.onnx"));
  });
  await check("a wrong hash deletes the file, in Listen's words", async () => {
    const dir = tmp(), a = assetsFor(dir, "supertonic", { files: stand({ badB: true }) });
    await assert.rejects(a.download(), /The voice's download didn't match what Kural expects/);
    assert.ok(!fs.existsSync(path.join(dir, "b.json")) && !fs.existsSync(path.join(dir, "b.json.part")));
  });
  server.close();
  process.exit(failed ? 1 : 0);
})();
