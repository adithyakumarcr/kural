// For testing the local Tab engine without Ollama: node test/fake-ollama.js [with-model]
// Stand-in for Ollama (same API shape) to test Kural's local Tab engine without the real thing.
const http = require("http");
const models = new Set(process.argv[2] === "with-model" ? ["qwen2.5-coder:1.5b-base"] : []);
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => body += d);
  req.on("end", () => {
    const j = body ? JSON.parse(body) : {};
    if (req.url === "/api/tags") { res.end(JSON.stringify({ models: [...models].map((name) => ({ name })) })); return; }
    if (req.url === "/api/pull") {
      log("pull", j.model);
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      let done = 0; const total = 986000000;
      const t = setInterval(() => {
        done += total / 8;
        if (done >= total) { res.write(JSON.stringify({ status: "success" }) + "\n"); models.add(j.model); clearInterval(t); res.end(); return; }
        res.write(JSON.stringify({ status: "pulling abc", total, completed: Math.round(done) }) + "\n");
      }, 400);
      return;
    }
    if (req.url === "/api/generate") {
      if (!j.prompt) { log("warm", j.model, "keep_alive", j.keep_alive); res.end(JSON.stringify({ response: "" })); return; }
      const m = /^<\|fim_prefix\|>([\s\S]*)<\|fim_suffix\|>([\s\S]*)<\|fim_middle\|>$/.exec(j.prompt);
      const pre = m ? m[1] : "", suf = m ? m[2] : "";
      const line = pre.slice(pre.lastIndexOf("\n") + 1);
      let out = "pass";
      if (/heat_input\($/.test(line)) out = "voltage, current, travel_speed_mm_s";
      else if (/#\s*convert/.test(pre.split("\n").slice(-2, -1)[0] || "")) out = "    return round(speed_mm_s * 60 / 1000, 2)\n\n\ndef next_thing():";
      log("generate", JSON.stringify({ raw: j.raw, fim: !!m, line, sufStart: suf.slice(0, 5), stop: (j.options || {}).stop && j.options.stop.length }));
      let aborted = false; res.on("close", () => { if (!res.writableFinished) { aborted = true; log("  cancelled by client"); } });
      // Mode from /tmp/rec/fake-mode: {"delay": ms, "empty": true} — to imitate a slow computer or an empty answer.
      let mode = {}; try { mode = JSON.parse(require("fs").readFileSync("/tmp/rec/fake-mode", "utf8")); } catch {}
      if (/def area/.test(pre)) out = "return w * h";
      if (/^\$ git commit -m "$/.test(line)) out = 'Add restock() to Inventory"';   // Tab in the terminal
      log("  num_predict", (j.options || {}).num_predict, "stop has \\n:", ((j.options || {}).stop || []).includes("\n"), "mode", JSON.stringify(mode));
      setTimeout(() => { if (!aborted) res.end(JSON.stringify({ response: mode.empty ? "" : out + "<|endoftext|>" })); }, mode.delay || 120);
      return;
    }
    res.statusCode = 404; res.end("{}");
  });
}).listen(11434, "127.0.0.1", () => log("fake ollama on 11434", [...models]));
