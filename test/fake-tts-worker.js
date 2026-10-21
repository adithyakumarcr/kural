// A stand-in for extension/lib/listen/tts-worker.js (same protocol, no voice): a JSON line {"id", "text"} in; a JSON line
// {"id", "n", "rate", "ms"} and n Int16 samples out, where n = text length × 10 ÷ speed and the first sample is the text length.
// FAKE_TTS=crash exits on the first request; error answers {"id", "error": "it broke"}; slow waits 500 ms per request.
const mode = process.env.FAKE_TTS || "";
let buf = "", queue = Promise.resolve();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  for (let nl; (nl = buf.indexOf("\n")) >= 0;) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    const { id, text, speed } = JSON.parse(line);
    queue = queue.then(async () => {
      if (mode === "crash") process.exit(3);
      if (mode === "slow") await new Promise((r) => setTimeout(r, 500));
      if (mode === "error") return process.stdout.write(`${JSON.stringify({ id, error: "it broke" })}\n`);
      const n = Math.round(String(text).length * 10 / (speed || 1)), pcm = new Int16Array(n);
      pcm[0] = String(text).length;
      process.stdout.write(`${JSON.stringify({ id, n, rate: 24000, ms: 3 })}\n`);
      process.stdout.write(Buffer.from(pcm.buffer));
    });
  }
});
