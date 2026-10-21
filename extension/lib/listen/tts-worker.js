// Listen's voice helper (started by speaker.js with ELECTRON_RUN_AS_NODE; no vscode). Loads the voice engine once, then
// answers requests on stdin, one at a time: a JSON line {"id", "text"} → a JSON line {"id", "n", "rate", "ms"} followed
// by n little-endian Int16 samples, or {"id", "error"}.
//   argv: <engine> <paths JSON> <threads>
const path = require("path");

const [engineName, pathsJson, threadsArg] = process.argv.slice(2);
const threads = Math.max(1, Number(threadsArg) || 1);
const answer = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

const ready = (async () => {
  if (!/^[a-z]+$/.test(String(engineName))) throw new Error(`Unknown voice engine: ${engineName}`);
  const engine = require(path.join(__dirname, "engines", `${engineName}.js`));
  return engine.load(JSON.parse(pathsJson), threads);
})();
ready.catch(() => {});   // (each request reports it)

let buf = "", queue = Promise.resolve();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  for (let nl; (nl = buf.indexOf("\n")) >= 0;) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    let req; try { req = JSON.parse(line); } catch { continue; }
    queue = queue.then(async () => {
      const t = Date.now();
      try {
        const voice = await ready;
        const pcm = await voice.speak(String(req.text || ""));
        answer({ id: req.id, n: pcm.length, rate: voice.rate, ms: Date.now() - t });
        if (pcm.length) process.stdout.write(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
      } catch (e) { answer({ id: req.id, error: String((e && e.message) || e) }); }
    });
  }
});
process.stdin.on("end", () => process.exit(0));
