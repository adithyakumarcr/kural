#!/usr/bin/env node
// Kural engine benchmark: compare the engines of one run. Called by ../run.sh at the end.
//   node report.js <results/run-folder>   -> prints the comparison, writes <folder>/report.html
//
// Two scores, because Kural has two kinds of users:
//   Helpers: everyone. Even with Claude, ChatGPT or Gemini for the chat, Tab Completion and Model Router's helper run
//            locally. On a lightweight laptop that's all the local engine does.
//   Chat:    users who pick "your own model" for the chat.
// Overall = HELPERS_WEIGHT % helpers + the rest chat (run.json; config.sh). Change the weights here.
const HELPERS = [
  // key, label, unit, better, weight, why
  ["tabAlone", "Tab Completion (median)", "ms", "lower", 30, "Below ~300 ms feels instant; above ~800 ms it's mostly ignored."],
  ["tabP95", "Tab Completion (slowest 5 %)", "ms", "lower", 10, "The pauses people notice."],
  ["embed", "Model Router helper (one request)", "ms", "lower", 20, "Runs before every chat message; Kural gives up after 1.5 s."],
  ["embedBatch", "Router helper setup (270 examples)", "s", "lower", 5, "Once per helper, in the background."],
  ["helpersMem", "Memory while idle (RAM + GPU)", "GB", "lower", 15, "Lightweight laptops: room for the editor, browser and builds."],
  ["idleCpu", "CPU while idle", "% core", "lower", 10, "Battery and fan noise while you just type."],
  ["helpersReady", "Start (Tab + helper loaded)", "s", "lower", 5, "After a restart or a long pause."],
  ["install", "Engine size on disk", "MB", "lower", 5, "What Kural or the user has to download and update."],
];
const CHAT = [
  ["followup", "Each agent step (follow-up)", "s", "lower", 25, "An agent task is many steps; this wait repeats every step."],
  ["first", "New chat: first word", "s", "lower", 20, "The first impression of every new chat."],
  ["gen", "Writing speed", "tok/s", "higher", 15, "How fast answers and edits appear once they start."],
  ["tabDuring", "Tab while the chat works", "ms", "lower", 15, "Tab Completion must not freeze while an agent runs (give-ups count as 6 s)."],
  ["chatMem", "Memory with chat (RAM + GPU)", "GB", "lower", 10, "Chat model + Tab model together."],
  ["ready", "Chat model start", "s", "lower", 5, "Model load after a pause or a restart."],
];
const FLOOR = { idleCpu: 0.5, helpersMem: 0.05, install: 1 };   // keeps "0 % CPU" from dividing by zero

const fs = require("fs");
const path = require("path");

const dir = process.argv[2];
if (!dir) { console.error("usage: report.js <results/run-folder>"); process.exit(2); }
const meta = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8")); } catch { return {}; } })();
const HW = Math.max(0, Math.min(100, Number(meta.helpers_weight ?? 70)));
const all = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "run.json")
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
  .sort((a, b) => (a.order ?? 9) - (b.order ?? 9));
const ran = all.filter((e) => !e.skipped && (e.tab_alone || e.first_answer));
const skipped = all.filter((e) => !ran.includes(e));
const helpersRan = ran.filter((e) => e.tab_alone);
const chatRan = ran.filter((e) => e.first_answer);
const isCpu = (e) => e.variant === "cpu";

// Median Tab time with every give-up counted as 6,000 ms (Kural's limit).
function tabMedian(t) {
  if (!t) return null;
  const v = [...(t.samples_ms || []), ...Array(t.gave_up || 0).fill(6000)].sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
}
const sum = (a, b) => (a == null && b == null ? null : (a || 0) + (b || 0));
const metric = (e, key) => ({
  tabAlone: tabMedian(e.tab_alone),
  tabP95: e.tab_alone && (e.tab_alone.gave_up ? 6000 : e.tab_alone.p95_ms),
  embed: e.embed && !e.embed.error ? e.embed.p50_ms : null,
  embedBatch: e.embed && !e.embed.error ? e.embed.batch_s : null,
  helpersMem: sum(e.helpers_ram_gb, e.helpers_vram_gb),
  idleCpu: e.idle_cpu_pct,
  helpersReady: e.helpers_ready_s,
  install: e.install_mb,
  followup: e.follow_up && e.follow_up.ttft_s,
  first: e.first_answer && e.first_answer.ttft_s,
  gen: e.first_answer && e.first_answer.gen_tok_s,
  tabDuring: tabMedian(e.tab_during_chat),
  chatMem: sum(e.memory_gb, e.vram_gb),
  ready: e.ready_s,
  agent: e.agent_task_5_steps_s,
}[key] ?? null);

// Each measure gives the best engine 100 and the others their share of it; a measure nobody has is left out; an
// engine missing a measure others have gets 0 for it (it can't do that part of Kural's job, or it failed).
function score(list, table) {
  const out = new Map();
  for (const e of list) {
    let total = 0, wsum = 0;
    for (const [key, , , better, w] of table) {
      const vals = list.map((x) => metric(x, key)).filter((v) => v != null && isFinite(v));
      if (!vals.length) continue;
      wsum += w;
      const v = metric(e, key), fl = FLOOR[key] || 0.001;
      if (v == null || !isFinite(v)) continue;
      total += w * (better === "lower" ? (Math.min(...vals) + fl) / (v + fl) : v / Math.max(...vals));
    }
    out.set(e, wsum ? Math.round((total / wsum) * 100) : null);
  }
  return out;
}
const hScore = score(helpersRan, HELPERS);
const cScore = score(chatRan, CHAT);
const overall = new Map(ran.filter((e) => hScore.get(e) != null && cScore.get(e) != null)
  .map((e) => [e, Math.round((HW * hScore.get(e) + (100 - HW) * cScore.get(e)) / 100)]));
const bestOf = (list, m) => list.filter((e) => m.get(e) != null).sort((a, b) => m.get(b) - m.get(a))[0];

// What shipping each engine with Kural means (facts about the engines, not measured here).
const FAMILY = {
  ollama: { family: "Ollama", platforms: "Mac, Linux, Windows", ship: "User installs Ollama (today)", gpu: "Metal, CUDA, ROCm; CPU fallback", note: "Least work: Kural already uses it." },
  "ollama-cpu": { family: "Ollama", platforms: "Mac, Linux, Windows", ship: "User installs Ollama (today)", gpu: "CPU only here (lightweight laptop)", note: "Same engine, GPU left out." },
  "ollama-mlx": { family: "Ollama", platforms: "Mac only", ship: "User installs Ollama (today)", gpu: "MLX (Apple)", note: "Fewer models." },
  llamacpp: { family: "llama.cpp", platforms: "Mac, Linux, Windows", ship: "Bundle llama-server (~15 MB, Metal)", gpu: "Metal", note: "Same API on every platform." },
  "llamacpp-cuda": { family: "llama.cpp", platforms: "Linux, Windows (NVIDIA)", ship: "Bundle ~0.2 GB + CUDA runtime ~0.4-0.6 GB", gpu: "CUDA", note: "Fastest on NVIDIA, biggest download." },
  "llamacpp-vulkan": { family: "llama.cpp", platforms: "Linux, Windows (NVIDIA, AMD, Intel)", ship: "Bundle ~30 MB", gpu: "Vulkan: any GPU with a driver", note: "One small build for every GPU vendor." },
  "llamacpp-cpu": { family: "llama.cpp", platforms: "Mac, Linux, Windows", ship: "Bundle ~20 MB", gpu: "CPU only here (lightweight laptop)", note: "The fallback when there's no usable GPU." },
  mlx: { family: "MLX", platforms: "Mac only", ship: "Python + mlx-lm, or mlx-swift", gpu: "Metal (Apple)", note: "No embeddings endpoint in mlx_lm.server." },
  vllm: { family: "vLLM", platforms: "Linux (NVIDIA), no Mac", ship: "Python + PyTorch + CUDA (GBs)", gpu: "CUDA; reserves GPU memory per model", note: "Built for many users on servers." },
};

const fmt = (v, unit) => v == null || !isFinite(v) ? "-" : unit === "ms" || unit === "MB" || (unit === "tok/s" && v >= 100) ? `${Math.round(v)}` : `${Math.round(v * 10) / 10}`;

// ---------------------------------------------------------------- recommendation (plain words)
function advice() {
  if (!ran.length) return ["No engine finished. See run.log in this folder."];
  const out = [];
  const bestOverall = bestOf([...overall.keys()], overall);
  const gpuHelpers = bestOf(helpersRan.filter((e) => !isCpu(e)), hScore);
  const cpuHelpers = bestOf(helpersRan.filter(isCpu), hScore);
  const bestChat = bestOf(chatRan, cScore);
  if (bestOverall) out.push(`Best overall on this computer: ${bestOverall.engine} (${overall.get(bestOverall)}/100: ${HW} % helpers, ${100 - HW} % chat).`);
  if (gpuHelpers) out.push(`For most users (Claude/ChatGPT/Gemini chat, local Tab + Router helper): ${gpuHelpers.engine}, Tab ${fmt(metric(gpuHelpers, "tabAlone"), "ms")} ms, helper ${fmt(metric(gpuHelpers, "embed"), "ms")} ms, ${fmt(metric(gpuHelpers, "helpersMem"), "GB")} GB idle.`);
  if (cpuHelpers) {
    const t = metric(cpuHelpers, "tabAlone");
    out.push(`On a lightweight laptop (CPU only, ${meta.light_threads || "?"} threads): ${cpuHelpers.engine}, Tab ${fmt(t, "ms")} ms` +
      (t != null ? (t < 300 ? " (feels instant)." : t < 800 ? " (usable)." : " (too slow for Tab: Kural should use the cloud for Tab there).") : "."));
  }
  if (bestChat) out.push(`For "your own model" as the chat: ${bestChat.engine} (5-step agent task ${fmt(metric(bestChat, "agent"), "s")} s).`);
  const fams = [...new Set([gpuHelpers, cpuHelpers, bestChat, bestOverall].filter(Boolean).map((e) => (FAMILY[e.id] || {}).family))];
  if (fams.length === 1 && fams[0]) out.push(`All the winners are ${fams[0]}: one engine family covers every case here (pick its GPU or CPU build per computer).`);
  const noCache = chatRan.filter((e) => e.follow_up && e.follow_up.cache === "not reused").map((e) => e.engine);
  if (noCache.length) out.push(`Cache not reused by: ${noCache.join(", ")}. Every agent step re-reads the whole conversation there.`);
  const starved = chatRan.filter((e) => e.tab_during_chat && e.tab_during_chat.gave_up > e.tab_during_chat.n / 2).map((e) => e.engine);
  if (starved.length) out.push(`Tab Completion mostly gave up while a local chat answered with: ${starved.join(", ")}.`);
  const noEmbed = helpersRan.filter((e) => metric(e, "embed") == null).map((e) => e.engine);
  if (noEmbed.length) out.push(`Router helper not measured for: ${noEmbed.join(", ")} (scored 0 for it; see the table).`);
  return out;
}
const words = advice();

// ---------------------------------------------------------------- terminal
const B = process.stdout.isTTY ? "\x1b[1m" : "", N = process.stdout.isTTY ? "\x1b[0m" : "";
const col = 34, w = 19;
function table(title, list, defs, scores) {
  if (!list.length) return;
  console.log(`\n   ${B}${title}${N}`);
  console.log("   " + "".padEnd(col) + list.map((e) => e.engine.slice(0, w - 1).padStart(w)).join(""));
  for (const [key, label, unit, better] of defs) {
    const vals = list.map((e) => metric(e, key));
    const good = vals.filter((v) => v != null && isFinite(v));
    const top = good.length ? (better === "lower" ? Math.min(...good) : Math.max(...good)) : null;
    console.log("   " + `${label} (${unit})`.slice(0, col - 1).padEnd(col) + vals.map((v) => ((v === top && list.length > 1 ? "* " : "") + fmt(v, unit)).padStart(w)).join(""));
  }
  console.log(B + "   " + "Score (of 100)".padEnd(col) + list.map((e) => String(scores.get(e) ?? "-").padStart(w)).join("") + N);
}
console.log(`\n${B}== Engine comparison for Kural${N}  (${meta.chip || "?"}, ${meta.memory_gb || "?"} GB, ${meta.gpu || "no GPU"}, ${meta.os || ""})`);
table("Helpers: every user (Tab Completion + Model Router)", helpersRan, HELPERS, hScore);
table("Chat: your own model", chatRan, CHAT, cScore);
if (chatRan.length) console.log("   " + "Cache reused".padEnd(col) + chatRan.map((e) => String(e.follow_up && e.follow_up.cache).padStart(w)).join(""));
if (overall.size) console.log(B + "\n   " + `Overall (${HW} % helpers)`.padEnd(col) + [...overall].map(([e, s]) => `${e.engine.slice(0, 10)} ${s}`.padStart(w)).join("") + N);
for (const s of skipped) console.log(`   skipped ${s.engine}: ${s.skipped || "no results"}`);
console.log("   (* = best)\n");
for (const a of words) console.log(`   ${a}`);

// ---------------------------------------------------------------- HTML
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colorOf = (e) => `var(--s${(Math.max(0, all.indexOf(e)) % 8) + 1})`;   // fixed per engine on every chart

function barChart(list, key, label, unit, better, why) {
  const rows = list.map((e) => ({ e, v: metric(e, key) })).filter((r) => r.v != null && isFinite(r.v));
  if (!rows.length) return "";
  const max = Math.max(...rows.map((r) => r.v)) || 1;
  const top = better === "lower" ? Math.min(...rows.map((r) => r.v)) : Math.max(...rows.map((r) => r.v));
  const H = 28, gap = 10, lw = 132, W = 560, bw = W - lw - 100;
  const bars = rows.map((r, i) => {
    const y = i * (H + gap), len = Math.max(4, (r.v / max) * bw);
    return `<g><title>${esc(r.e.engine)}: ${fmt(r.v, unit)} ${unit}</title>
      <text x="${lw - 10}" y="${y + H / 2 + 5}" text-anchor="end" class="lab">${esc(r.e.engine)}</text>
      <path d="M${lw},${y + 4} h${len - 4} a4,4 0 0 1 4,4 v${H - 16} a4,4 0 0 1 -4,4 h-${len - 4} z" fill="${colorOf(r.e)}"/>
      <text x="${lw + len + 8}" y="${y + H / 2 + 5}" class="val">${fmt(r.v, unit)} ${unit}${r.v === top && rows.length > 1 ? "  · best" : ""}</text></g>`;
  }).join("");
  return `<figure class="chart"><figcaption><b>${esc(label)}</b> <span>${better === "lower" ? "lower is better" : "higher is better"}</span><small>${esc(why)}</small></figcaption>
    <svg viewBox="0 0 ${W} ${rows.length * (H + gap)}" role="img" aria-label="${esc(label)}">${bars}</svg></figure>`;
}
const tr = (cells, th) => `<tr>${cells.map((c, i) => (th || i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join("")}</tr>`;
function numbers(list, defs, extra, scores) {
  if (!list.length) return "";
  const rows = [...extra, ...defs.map(([key, label, unit]) => [`${label} (${unit})`, ...list.map((e) => fmt(metric(e, key), unit))]),
    ["Score (of 100)", ...list.map((e) => `<b>${scores.get(e) ?? "-"}</b>`)]];
  return `<div class="tw"><table><thead>${tr(["", ...list.map((e) => esc(e.engine))], true)}</thead><tbody>${rows.map((r) => tr(r)).join("")}</tbody></table></div>`;
}
const helpersExtra = [
  ["Engine version", ...helpersRan.map((e) => esc(e.version || "?"))],
  ["Tab model / Router helper", ...helpersRan.map((e) => `${esc(e.tab_model || "-")}<br>${esc(e.embed_model || "-")}`)],
  ["Tab gave up (of runs)", ...helpersRan.map((e) => (e.tab_alone ? `${e.tab_alone.gave_up} of ${e.tab_alone.n}` : "-"))],
  ["Helper over 1.5 s deadline", ...helpersRan.map((e) => (e.embed && !e.embed.error ? `${e.embed.over_deadline} of ${e.embed.n}` : esc(e.embed && e.embed.error ? "failed" : "not measured")))],
  ["RAM / GPU memory idle (GB)", ...helpersRan.map((e) => `${fmt(e.helpers_ram_gb, "GB")} / ${fmt(e.helpers_vram_gb, "GB")}`)],
];
const chatExtra = [
  ["Chat model", ...chatRan.map((e) => esc(e.chat_model))],
  ["Prompt (tokens)", ...chatRan.map((e) => fmt(e.first_answer.prompt_tokens, "ms"))],
  ["Reading speed (tok/s)", ...chatRan.map((e) => fmt(e.first_answer.prefill_tok_s, "ms"))],
  ["Cache on follow-up", ...chatRan.map((e) => esc(e.follow_up.cache))],
  ["5-step agent task (s)", ...chatRan.map((e) => fmt(e.agent_task_5_steps_s, "s"))],
  ["RAM / GPU memory (GB)", ...chatRan.map((e) => `${fmt(e.memory_gb, "GB")} / ${fmt(e.vram_gb, "GB")}`)],
  ["Swap before / after", ...chatRan.map((e) => `${esc(e.swap_before ?? "?")} / ${esc(e.swap_after ?? "?")}`)],
];
const fam = ["family", "platforms", "ship", "gpu", "note"], famLabel = { family: "Family", platforms: "Runs on", ship: "Kural would ship", gpu: "Hardware", note: "" };

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kural Engine Benchmark</title>
<style>
:root{color-scheme:light;--bg:#fcfcfb;--card:#ffffff;--ink:#0b0b0b;--ink2:#52514e;--line:#e6e5e0;--accent:#2a78d6;
--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--s5:#e87ba4;--s6:#008300;--s7:#4a3aa7;--s8:#e34948}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#1a1a19;--card:#222221;--ink:#ffffff;--ink2:#c3c2b7;--line:#3a3a38;--accent:#3987e5;
--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--s6:#008300;--s7:#9085e9;--s8:#e66767}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#1a1a19;--card:#222221;--ink:#ffffff;--ink2:#c3c2b7;--line:#3a3a38;--accent:#3987e5;
--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--s6:#008300;--s7:#9085e9;--s8:#e66767}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,Ubuntu,sans-serif}
main{max-width:1080px;margin:0 auto;padding:32px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:40px 0 4px}h3{font-size:16px;margin:24px 0 12px}
.sub{color:var(--ink2);margin:0 0 24px}.lead{color:var(--ink2);margin:0 0 16px}
.verdict{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:8px;padding:16px 20px}
.verdict p{margin:6px 0}.verdict p:first-child{font-size:18px;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,480px),1fr));gap:16px}
.chart{margin:0;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px}
.chart figcaption{margin-bottom:12px}.chart figcaption span{color:var(--ink2);font-size:13px;margin-left:6px}.chart small{display:block;color:var(--ink2);font-size:13px}
svg{width:100%;height:auto;overflow:visible}.lab{fill:var(--ink);font-size:14px}.val{fill:var(--ink2);font-size:13px}
.tw{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:8px;margin-top:16px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:8px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
thead th{color:var(--ink2);font-weight:600}td{font-variant-numeric:tabular-nums}
.note{color:var(--ink2);font-size:13px}ul.skips{color:var(--ink2)}
</style></head><body><main>
<h1>Which engine should Kural use?</h1>
<p class="sub">${esc(meta.chip || "")} (${esc(meta.cores || "?")} threads) · ${esc(meta.memory_gb || "?")} GB · ${esc(meta.gpu || "no GPU")} · ${esc(meta.os || "")} · ${esc(meta.date || "")}</p>
<section class="verdict">${words.map((a) => `<p>${esc(a)}</p>`).join("")}</section>
${helpersRan.length ? `<h2>Helpers: what every Kural user runs locally</h2>
<p class="lead">Tab Completion and Model Router's helper, even when the chat is Claude, ChatGPT or Gemini. "(CPU)" engines leave the GPU out and use ${esc(meta.light_threads || "?")} threads, like a lightweight laptop.</p>
<div class="grid">${HELPERS.map(([k, l, u, b, , why]) => barChart(helpersRan, k, l, u, b, why)).join("")}</div>
${numbers(helpersRan, HELPERS, helpersExtra, hScore)}` : ""}
${chatRan.length ? `<h2>Chat: your own model</h2>
<p class="lead">A new chat (Kural's system prompt, its 6 tools and ~${esc(meta.prompt_tokens || "")} tokens of this repo), a follow-up, and Tab Completion while the chat answers. Context ${esc(meta.ctx || "")}, thinking ${String(meta.think) === "true" ? "on" : "off"}.</p>
<div class="grid">${CHAT.map(([k, l, u, b, , why]) => barChart(chatRan, k, l, u, b, why)).join("")}${barChart(chatRan, "agent", "A 5-step agent task, start to end", "s", "lower", "Read, read, edit, run tests, answer: first word + 4 follow-ups + 5 × 150 written tokens.")}</div>
${numbers(chatRan, CHAT, chatExtra, cScore)}` : ""}
<h2>What Kural would need to ship it</h2>
<div class="tw"><table><thead>${tr(["", ...ran.map((e) => esc(e.engine))], true)}</thead><tbody>
${fam.map((k) => tr([famLabel[k], ...ran.map((e) => esc((FAMILY[e.id] || {})[k] || "-"))])).join("")}
${tr(["Measured size", ...ran.map((e) => (e.install_mb != null ? `${fmt(e.install_mb, "MB")} MB` : "-"))])}</tbody></table></div>
${skipped.length ? `<h2>Skipped</h2><ul class="skips">${skipped.map((s) => `<li>${esc(s.engine)}: ${esc(s.skipped || "no results")}</li>`).join("")}</ul>` : ""}
<h2>How the scores work</h2>
<p class="note">Each measure gives the best engine 100 and the others their share of it, then the weights below. An engine missing a measure that others have gets 0 for it.
Helpers: ${HELPERS.map(([, l, , , w]) => `${esc(l)} ${w}`).join(" · ")}.<br>Chat: ${CHAT.map(([, l, , , w]) => `${esc(l)} ${w}`).join(" · ")}.<br>
Overall = ${HW} % helpers + ${100 - HW} % chat (HELPERS_WEIGHT in config.sh). Change the weights in lib/report.js.</p>
<p class="note">Each engine uses its own format of the same models (Ollama's Q4_K_M, GGUF, MLX 4-bit, AWQ for vLLM), so output quality can differ slightly. One run on one computer;
numbers within ~10 % of each other are a tie. Raw data: the .json files next to this page.</p>
</main></body></html>`;
fs.writeFileSync(path.join(dir, "report.html"), html);
console.log(`\n   Report: ${path.join(dir, "report.html")}`);
