// Voice input's helper process (started by transcriber.js with ELECTRON_RUN_AS_NODE; no vscode). Loads Whisper's
// WebAssembly build and the model once, then answers requests on stdin: a JSON line {"id", "n"} followed by n Float32
// samples (16 kHz mono) → one JSON line {"id", "text", "ms"} or {"id", "error"} on stdout.
//   argv: <loader kural-whisper.js> <model .bin> <threads>
// transcriber.js starts it with --no-liftoff: V8 first runs WebAssembly with its quick baseline compiler, with which the
// first request took 15-18 s instead of ~3 s. (Not v8.setFlagsFromString here: in Electron that crashed with SIGTRAP as
// soon as Whisper's threads started; on the command line it works in both Node and Electron.)
const fs = require("fs");

const [loader, model, threadsArg] = process.argv.slice(2);
const threads = Math.max(1, Number(threadsArg) || 1);
const answer = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

const ready = (async () => {
  const createWhisper = require(loader);
  const w = await createWhisper({ print: () => {}, printErr: () => {} });
  if (!w.init(new Uint8Array(fs.readFileSync(model)))) throw new Error("Whisper couldn't load its model");
  return w;
})();
ready.catch(() => {});   // (each request reports it)

let buf = Buffer.alloc(0), head = null, queue = Promise.resolve();
process.stdin.on("data", (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    if (!head) {
      const nl = buf.indexOf(10);
      if (nl < 0) return;
      try { head = JSON.parse(buf.subarray(0, nl).toString("utf8")); } catch { head = { id: 0, n: 0 }; }
      buf = buf.subarray(nl + 1);
    }
    const bytes = head.n * 4;
    if (buf.length < bytes) return;
    const samples = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytes));
    buf = buf.subarray(bytes);
    const id = head.id;
    head = null;
    queue = queue.then(async () => {
      try {
        const w = await ready;
        const t = Date.now();
        const text = w.transcribe(samples, threads);
        answer({ id, text, ms: Date.now() - t });
      } catch (e) { answer({ id, error: e && e.message ? e.message : String(e) }); }
    });
  }
});
process.stdin.on("end", () => process.exit(0));
