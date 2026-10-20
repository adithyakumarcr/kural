// A stand-in for extension/lib/voice/whisper-worker.js (same protocol, no Whisper): answers "samples:<n>:<first sample>".
// FAKE_WHISPER=crash makes it exit on the first request; FAKE_WHISPER=error answers with an error.
const mode = process.env.FAKE_WHISPER || "";
let buf = Buffer.alloc(0), want = null;
process.stdin.on("data", (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    if (!want) {
      const nl = buf.indexOf(10);
      if (nl < 0) return;
      want = JSON.parse(buf.subarray(0, nl).toString("utf8"));
      buf = buf.subarray(nl + 1);
    }
    if (buf.length < want.n * 4) return;
    const samples = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + want.n * 4));
    buf = buf.subarray(want.n * 4);
    const id = want.id; want = null;
    if (mode === "crash") process.exit(3);
    if (mode === "error") process.stdout.write(JSON.stringify({ id, error: "it broke" }) + "\n");
    else process.stdout.write(JSON.stringify({ id, text: ` samples:${samples.length}:${samples[0] || 0}`, ms: 5, pid: process.pid }) + "\n");
  }
});
