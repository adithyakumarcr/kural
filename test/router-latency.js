// How long Auto takes to choose a model, the way the chat asks (ModelRouter.route), with Native and each installed helper,
// against a realistic list of models (Claude, Codex, Gemini). Needs Ollama for the helpers; nothing is downloaded.
//   node test/router-latency.js
const os = require("os"), fs = require("fs"), path = require("path");
const { ModelRouter, ASSISTANTS } = require("../extension/lib/router");
const { HELPERS } = require("../extension/lib/router/client");
const data = require("../extension/lib/router/examples.json").examples;
const claude = (id, d) => ({ id, label: id, description: d, provider: "Claude", providerId: "claude", ready: true, commands: true, images: true });
const models = [claude("haiku", "fastest"), claude("sonnet", "fast and smart"), claude("opus", "most capable"),
  { id: "codex:gpt-6-luna", label: "GPT-6-Luna", description: "Fast and affordable model for easier tasks.", provider: "ChatGPT (Codex)", providerId: "codex", ready: true, commands: true },
  { id: "codex:gpt-6-sol", label: "GPT-6-Sol", description: "Most capable model for complex work.", provider: "ChatGPT (Codex)", providerId: "codex", ready: true, commands: true },
  { id: "agy:gemini-3.8-flash", label: "Gemini 3.8 Flash", provider: "Google Gemini", providerId: "agy", ready: true },
  { id: "agy:gemini-3.8-pro", label: "Gemini 3.8 Pro", provider: "Google Gemini", providerId: "agy", ready: true }];
(async () => {
  let installed = [];
  try { installed = ((await (await fetch("http://127.0.0.1:11434/api/tags")).json()).models || []).map((m) => m.name.replace(/:latest$/, "")); } catch { /* no Ollama */ }
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "kural-router-latency-"));
  for (const assistant of ASSISTANTS) {
    if (assistant !== "native" && !installed.includes(HELPERS[assistant].model)) { console.log(`${assistant.padEnd(8)} not installed: skipped`); continue; }
    const r = new ModelRouter({ globalStorageUri: { fsPath: store } }, () => ({ get: (k, d) => k === "modelRouter.assistant" ? assistant : d }), () => models);
    const t0 = performance.now(); await r.prepare(); const prep = performance.now() - t0;
    const times = [], sources = {};
    for (let i = 0; i < 120; i++) {
      const d = await r.route({ prompt: data[(i * 7) % data.length][0], current: "sonnet" });
      times.push(d.ms); sources[d.source] = (sources[d.source] || 0) + 1;
    }
    times.sort((a, b) => a - b);
    console.log(`${assistant.padEnd(8)} getting ready ${Math.round(prep)} ms (once, saved)  ·  choosing a model: median ${times[60].toFixed(1)} ms, p95 ${times[114].toFixed(1)} ms, max ${times[119].toFixed(1)} ms  ·  decided by ${JSON.stringify(sources)}`);
  }
  fs.rmSync(store, { recursive: true, force: true });
})();
