#!/usr/bin/env node
// Kural engine benchmark: one engine, Kural's real workloads. Called by ../run.sh once per engine.
//
// Every number is measured the same way for every engine, from the client side (what Kural would see):
//   time to first token = request sent -> first streamed token (text, thinking or tool call)
//   writing speed       = tokens after the first one / time between first and last token
// Engine-reported counters (prompt tokens read, cached tokens) are kept as extra evidence where the engine has them.
//
// Protocols:
//   ollama  — Ollama's own API (/api/chat, /api/generate), exactly what Kural's engine.js and tab/local.js send
//   openai  — OpenAI-compatible /v1/chat/completions (llama-server, mlx_lm.server, LM Studio, vLLM…)
// Tab Completion (fill-in-the-middle), same raw prompt for all:
//   ollama   /api/generate raw   ·   llamacpp /completion   ·   openai /v1/completions
//
// Commands:
//   node bench.js run  --label "llama.cpp" --protocol openai --chat-url URL --chat-model M
//                      --tab-protocol llamacpp --tab-url URL --tab-model M --out FILE [options]
//   node bench.js warm --protocol P --url URL --model M      -> prints seconds until a one-token answer
//   node bench.js set  FILE key=value ...                    -> adds facts (ready time, memory…) to a result
//
// No dependencies: Node 18+ (fetch). No vscode.

"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// ---------------------------------------------------------------- small helpers
function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { o._.push(a); continue; }
    const k = a.slice(2);
    if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) o[k] = argv[++i]; else o[k] = true;
  }
  return o;
}
const now = () => Number(process.hrtime.bigint()) / 1e9;   // seconds, monotonic
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (x, d = 2) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
function pct(values, p) {
  const v = values.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  if (p === 50) return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)];
}
const say = (s) => process.stdout.write(`   ${s}\n`);

// ---------------------------------------------------------------- the workload (same for every engine)
// Kural's tool definitions (shape of extension/lib/ai/tools.js): sent with every chat request.
const TOOLS = [
  ["Read", "Read a text file. Returns lines with line numbers. For big files, read a part with offset/limit.",
    { file_path: { type: "string", description: "Path (relative to the project, or absolute)" }, offset: { type: "integer", description: "First line to read (1-based)" }, limit: { type: "integer", description: "How many lines" } }, ["file_path"]],
  ["Write", "Create a file, or replace a whole file, with this content. For small changes to an existing file use Edit.",
    { file_path: { type: "string" }, content: { type: "string" } }, ["file_path", "content"]],
  ["Edit", "Change a file: replace old_string (copied exactly from the file, with enough lines around it to be unique) with new_string.",
    { file_path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean", description: "Replace every match instead of exactly one" } }, ["file_path", "old_string", "new_string"]],
  ["Glob", "Find files by name pattern, e.g. \"**/*.py\" or \"src/**/test_*.js\".",
    { pattern: { type: "string" }, path: { type: "string", description: "Folder to look in (default: the project)" } }, ["pattern"]],
  ["Grep", "Search the text of files with a regular expression. Returns file:line: text for each match.",
    { pattern: { type: "string" }, path: { type: "string", description: "Folder or file (default: the project)" }, glob: { type: "string", description: "Only files matching this, e.g. \"*.ts\"" }, case_insensitive: { type: "boolean" } }, ["pattern"]],
  ["Bash", "Run a shell command in the project folder (tests, builds, git…). Returns its output and exit code.",
    { command: { type: "string" }, description: { type: "string", description: "What it does, in a few words" } }, ["command"]],
].map(([name, description, properties, required]) => ({ type: "function", function: { name, description, parameters: { type: "object", properties, required } } }));

function systemPrompt(repo, nonce) {
  return `Session ${nonce}.\nYou are Kural, the AI assistant in the Kural code editor. You help the user with their software project.\n` +
    `Project folder: ${repo}. Today is ${new Date().toISOString().slice(0, 10)}.\n` +
    `Use your tools: look at files before you talk about them or change them; never guess what a file contains. ` +
    `Paths are relative to the project folder. To change a file, use Edit with old_string copied exactly from the file ` +
    `(Read it first), or Write for a new file. Run tests or commands with Bash when it helps. ` +
    `Keep answers short and clear; explain why before how.\n`;
}

// Source files "the agent already read": tracked files only (git ls-files), so build output and downloads are never
// used. ~3.5 characters per token for code.
function projectFiles(repo, tokens) {
  let list = [];
  try {
    list = execFileSync("git", ["-C", repo, "ls-files"], { encoding: "utf8", maxBuffer: 64 << 20 }).split("\n");
  } catch { /* not a git checkout: walk it */
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (/^(node_modules|\.git|build|dist|downloads|benchmark|bench-results)$/.test(e.name)) continue;
      const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else list.push(path.relative(repo, p));
    } };
    walk(repo);
  }
  list = list.filter((f) => /\.(js|ts|py|vue|sh)$/.test(f) && !/^(benchmark|node_modules)\//.test(f)).sort();
  // Kural's own engine code first: it's what a Kural chat most often reads.
  list.sort((a, b) => (b.startsWith("extension/lib/") - a.startsWith("extension/lib/")) || a.localeCompare(b));
  const budget = Math.round(tokens * 3.5);
  let out = ""; const used = [];
  for (const f of list) {
    if (out.length >= budget) break;
    let text; try { const st = fs.statSync(path.join(repo, f)); if (st.size > 200000) continue; text = fs.readFileSync(path.join(repo, f), "utf8"); } catch { continue; }
    out += `\n--- ${f} ---\n${text}`; used.push(f);
  }
  if (!out) throw new Error(`no source files found in ${repo}`);
  return { text: out.slice(0, budget), files: used };
}

function freshConversation(repo, files, nonce) {
  return [
    { role: "system", content: systemPrompt(repo, nonce) },
    { role: "user", content: `Here are the files you read so far:\n${files}\n\nQuestion: in a few sentences, what does this code do, ` +
      `and what is the riskiest part to change? Answer in plain text; do not call tools.` },
  ];
}
const FOLLOW_UP = { role: "user", content: "Thanks. Which single function would you add a unit test for first, and why? One paragraph, no tools." };

// The code around a cursor, for Tab Completion, cut exactly like extension/lib/tab/completion.js does: 1,500 characters
// before the cursor and 400 after, the cursor at the end of a line (so Kural asks for up to 64 tokens, several lines).
function fimContext(repo, files) {
  const sizes = files.map((f) => { try { return [f, fs.statSync(path.join(repo, f)).size]; } catch { return [f, 0]; } });
  const pick = (sizes.find(([, s]) => s > 4000 && s < 60000) || sizes[0])[0];
  const text = fs.readFileSync(path.join(repo, pick), "utf8");
  const at = text.indexOf("\n", Math.floor(text.length / 2)) + 1;   // start of a line in the middle of the file
  return { file: pick, prefix: text.slice(Math.max(0, at - 1500), at), suffix: text.slice(at, at + 400) };
}
const FIM_STOP = ["<|endoftext|>", "<|fim_pad|>", "<|file_sep|>", "<|fim_prefix|>", "<|fim_suffix|>", "<|fim_middle|>", "\n\n\n"];

// ---------------------------------------------------------------- streaming
async function* lines(res) {
  const dec = new TextDecoder(); let buf = "";
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) yield l; }
  }
  if (buf.trim()) yield buf.trim();
}

async function postJSON(url, body, timeoutMs, signal) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  if (signal) signal.addEventListener("abort", () => ctl.abort());
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    return { res, done: () => clearTimeout(t) };
  } catch (e) { clearTimeout(t); throw e; }
}

// One streamed chat turn. Returns timings, counts and the answer (for the follow-up turn).
async function chatTurn(cfg, messages) {
  const t0 = now(); let first = null, last = null, chunks = 0, content = "";
  let promptEvaluated = null, promptTotal = null, cached = null, completion = null;
  if (cfg.protocol === "ollama") {
    const body = { model: cfg.chatModel, stream: true, keep_alive: "30m", messages, tools: TOOLS,
      options: { num_ctx: cfg.ctx, num_predict: cfg.answerTokens, temperature: 0, seed: 42, ...cfg.ollamaOptions } };
    if (cfg.canThink) body.think = cfg.think;
    const { res, done } = await postJSON(`${cfg.chatUrl}/api/chat`, body, 900000);
    try {
      for await (const l of lines(res)) {
        let m; try { m = JSON.parse(l); } catch { continue; }
        if (m.error) throw new Error(m.error);
        const msg = m.message || {};
        if (msg.content || msg.thinking || (msg.tool_calls && msg.tool_calls.length)) { const t = now(); if (first == null) first = t; last = t; chunks++; }
        if (msg.content) content += msg.content;
        if (m.done) { promptEvaluated = m.prompt_eval_count ?? null; completion = m.eval_count ?? null; }
      }
    } finally { done(); }
  } else {
    const body = { model: cfg.chatModel, stream: true, stream_options: { include_usage: true }, messages, tools: TOOLS,
      max_tokens: cfg.answerTokens, temperature: 0, seed: 42, chat_template_kwargs: { enable_thinking: !!cfg.think } };
    const { res, done } = await postJSON(`${cfg.chatUrl}/v1/chat/completions`, body, 900000);
    try {
      for await (const l of lines(res)) {
        if (!l.startsWith("data:")) continue;
        const data = l.slice(5).trim(); if (data === "[DONE]") break;
        let m; try { m = JSON.parse(data); } catch { continue; }
        if (m.error) throw new Error(typeof m.error === "string" ? m.error : JSON.stringify(m.error));
        const d = (m.choices && m.choices[0] && m.choices[0].delta) || {};
        const piece = d.content || d.reasoning_content || d.reasoning;
        if (piece || (d.tool_calls && d.tool_calls.length)) { const t = now(); if (first == null) first = t; last = t; chunks++; }
        if (d.content) content += d.content;
        if (m.usage) { promptTotal = m.usage.prompt_tokens ?? promptTotal; completion = m.usage.completion_tokens ?? completion;
          const det = m.usage.prompt_tokens_details; if (det && det.cached_tokens != null) cached = det.cached_tokens; }
        if (m.timings) { promptEvaluated = m.timings.prompt_n ?? promptEvaluated; if (m.timings.cache_n != null) cached = m.timings.cache_n; completion = m.timings.predicted_n ?? completion; }
      }
    } finally { done(); }
  }
  const end = now();
  if (first == null) throw new Error("the engine answered without a single token");
  if (promptEvaluated == null && promptTotal != null) promptEvaluated = cached != null ? promptTotal - cached : null;
  if (promptTotal == null && promptEvaluated != null) promptTotal = promptEvaluated + (cached || 0);
  const tokens = completion || chunks;
  return {
    ttft_s: first - t0, total_s: end - t0, tokens,
    gen_tok_s: last > first && tokens > 1 ? (tokens - 1) / (last - first) : null,
    prompt_total: promptTotal, prompt_evaluated: promptEvaluated, cached,
    answer: content || "(The answer was a tool call.)",
  };
}

// One Tab Completion request; null if it took longer than Kural waits (6 s).
async function fim(cfg, prefix, suffix) {
  const prompt = `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
  let url, body;
  if (cfg.tabProtocol === "ollama") { url = `${cfg.tabUrl}/api/generate`; body = { model: cfg.tabModel, raw: true, stream: false, keep_alive: "30m", prompt, options: { temperature: 0, num_predict: 64, stop: FIM_STOP, ...cfg.ollamaOptions } }; }
  else if (cfg.tabProtocol === "llamacpp") { url = `${cfg.tabUrl}/completion`; body = { prompt, n_predict: 64, temperature: 0, stop: FIM_STOP, cache_prompt: true }; }
  else { url = `${cfg.tabUrl}/v1/completions`; body = { model: cfg.tabModel, prompt, max_tokens: 64, temperature: 0, stop: FIM_STOP.slice(0, 4) }; }
  const t0 = now();
  try { const { res, done } = await postJSON(url, body, 6000); await res.text(); done(); return now() - t0; }
  catch (e) { if (e.name === "AbortError" || /abort/i.test(String(e.message))) return null; throw e; }
}

async function tabSeries(cfg, ctx, n) {
  const typed = "  const result = await this.";   // one more character per suggestion, like typing
  const out = [];
  for (let k = 1; k <= n; k++) out.push(await fim(cfg, ctx.prefix + typed.slice(0, Math.min(k, typed.length)) + "x".repeat(Math.max(0, k - typed.length)), ctx.suffix));
  const ms = out.filter((x) => x != null).map((x) => x * 1000);
  return { p50_ms: round(pct(ms, 50), 0), p95_ms: round(pct(ms, 95), 0), gave_up: out.filter((x) => x == null).length, n, samples_ms: ms.map((x) => round(x, 0)) };
}

// Model Router's helper: one embedding per chat request (deadline 1.5 s), and once per helper a batch of all the
// labelled examples (extension/lib/router/examples.json) to build its averages. Same texts Kural embeds.
function routerTexts(repo) {
  try {
    const ex = JSON.parse(fs.readFileSync(path.join(repo, "extension/lib/router/examples.json"), "utf8"));
    const list = (ex.examples || []).map((e) => (Array.isArray(e) ? e[0] : e)).filter((t) => typeof t === "string" && t.trim());   // [request, size, kind]
    if (list.length >= 20) return list;
  } catch { /* fall through */ }
  return Array.from({ length: 270 }, (_, i) => `Request ${i}: rename the helper in utils.js and update the tests that call it`);
}
async function embed(cfg, texts, timeoutMs = 120000) {
  const t0 = now();
  if (cfg.embedProtocol === "ollama") {
    const { res, done } = await postJSON(`${cfg.embedUrl}/api/embed`, { model: cfg.embedModel, input: texts, keep_alive: "30m", ...(Object.keys(cfg.ollamaOptions).length ? { options: cfg.ollamaOptions } : {}) }, timeoutMs);
    const out = await res.json(); done();
    if (!out.embeddings || out.embeddings.length !== texts.length) throw new Error("embedding count mismatch");
  } else {
    const { res, done } = await postJSON(`${cfg.embedUrl}/v1/embeddings`, { model: cfg.embedModel, input: texts }, timeoutMs);
    const out = await res.json(); done();
    if (!out.data || out.data.length !== texts.length) throw new Error("embedding count mismatch");
  }
  return now() - t0;
}

// ---------------------------------------------------------------- commands
async function warm(o) {
  const t0 = now();
  const opts = o["ollama-options"] ? JSON.parse(o["ollama-options"]) : {};
  if (o.protocol === "ollama" && o.embed) {
    const { res, done } = await postJSON(`${o.url}/api/embed`, { model: o.model, input: ["hi"], keep_alive: "30m", ...(Object.keys(opts).length ? { options: opts } : {}) }, 900000); await res.text(); done();
  } else if (o.protocol === "ollama") {
    const { res, done } = await postJSON(`${o.url}/api/generate`, { model: o.model, prompt: "hi", stream: false, keep_alive: "30m", options: { num_predict: 1, ...(o.ctx ? { num_ctx: Number(o.ctx) } : {}), ...opts } }, 900000);
    await res.text(); done();
  } else if (o.embed) {
    const { res, done } = await postJSON(`${o.url}/v1/embeddings`, { model: o.model, input: ["hi"] }, 900000); await res.text(); done();
  } else if (o.protocol === "llamacpp") {
    const { res, done } = await postJSON(`${o.url}/completion`, { prompt: "hi", n_predict: 1 }, 900000); await res.text(); done();
  } else {
    const { res, done } = await postJSON(`${o.url}/v1/completions`, { model: o.model, prompt: "hi", max_tokens: 1 }, 900000); await res.text(); done();
  }
  process.stdout.write(`${round(now() - t0, 2)}\n`);
}

// Profiles (--profile):
//   helpers  what EVERY Kural user runs locally, even with Claude/ChatGPT/Gemini for the chat: Tab Completion and the
//            Model Router's embedding helper
//   chat     "your own model": a new chat, a follow-up, Tab Completion while the chat answers
// Results are merged into --out, so run.sh can call this once per profile.
async function run(o) {
  const cfg = {
    label: o.label || o.protocol, protocol: o.protocol || "openai", profile: o.profile || "chat",
    chatUrl: o["chat-url"] ? String(o["chat-url"]).replace(/\/$/, "") : null, chatModel: o["chat-model"],
    tabProtocol: o["tab-protocol"], tabUrl: o["tab-url"] ? String(o["tab-url"]).replace(/\/$/, "") : null, tabModel: o["tab-model"],
    embedProtocol: o["embed-protocol"], embedUrl: o["embed-url"] ? String(o["embed-url"]).replace(/\/$/, "") : null, embedModel: o["embed-model"],
    ollamaOptions: o["ollama-options"] ? JSON.parse(o["ollama-options"]) : {},
    ctx: Number(o.ctx || 32768), promptTokens: Number(o["prompt-tokens"] || 9600), runs: Number(o.runs || 2),
    tabRuns: Number(o["tab-runs"] || 10), answerTokens: Number(o["answer-tokens"] || 256), think: !!o.think,
    repo: path.resolve(o.repo || "."), canThink: false,
  };
  const result = fs.existsSync(o.out) ? JSON.parse(fs.readFileSync(o.out, "utf8")) : {};
  Object.assign(result, { engine: cfg.label, protocol: cfg.protocol });
  const { text: files, files: used } = projectFiles(cfg.repo, cfg.promptTokens);
  const ctx = fimContext(cfg.repo, used);

  if (cfg.profile === "helpers") {
    result.tab_model = cfg.tabModel || null; result.embed_model = cfg.embedModel || null;
    if (cfg.tabUrl && cfg.tabModel) {
      console.log(`\n   A1. Tab Completion (${cfg.tabRuns} suggestions in ${ctx.file})`);
      await fim(cfg, ctx.prefix, ctx.suffix);   // warm, like Kural does
      result.tab_alone = await tabSeries(cfg, ctx, cfg.tabRuns);
      say(`median ${result.tab_alone.p50_ms ?? "-"} ms · 95th percentile ${result.tab_alone.p95_ms ?? "-"} ms · gave up ${result.tab_alone.gave_up}`);
    }
    if (cfg.embedUrl && cfg.embedModel) {
      const texts = routerTexts(cfg.repo);
      console.log(`\n   A2. Model Router helper: one embedding per request (${Math.min(30, texts.length)} requests), then all ${texts.length} examples at once`);
      try {
        await embed(cfg, [texts[0]]);   // warm
        const one = [];
        for (let i = 0; i < Math.min(30, texts.length); i++) one.push((await embed(cfg, [texts[i]], 1500).catch(() => null)));
        const ms = one.filter((x) => x != null).map((x) => x * 1000);
        const batch = await embed(cfg, texts);
        result.embed = { p50_ms: round(pct(ms, 50), 1), p95_ms: round(pct(ms, 95), 1), over_deadline: one.filter((x) => x == null).length, n: one.length, batch_n: texts.length, batch_s: round(batch, 2) };
        say(`median ${result.embed.p50_ms} ms · 95th percentile ${result.embed.p95_ms} ms · over the 1.5 s deadline ${result.embed.over_deadline} · all ${texts.length} examples ${result.embed.batch_s} s`);
      } catch (e) { result.embed = { error: String(e.message || e) }; say(`embeddings failed: ${result.embed.error}`); }
    }
  } else {
    if (cfg.protocol === "ollama") {   // Kural sends think only to models that can think (engine.js)
      try { const r = await (await fetch(`${cfg.chatUrl}/api/show`, { method: "POST", body: JSON.stringify({ model: cfg.chatModel }) })).json();
        cfg.canThink = (r.capabilities || []).includes("thinking"); } catch { /* keep defaults */ }
    }
    Object.assign(result, { chat_model: cfg.chatModel, tab_model: cfg.tabModel || result.tab_model || null,
      settings: { ctx: cfg.ctx, prompt_tokens_target: cfg.promptTokens, answer_tokens: cfg.answerTokens, think: cfg.think, runs: cfg.runs, tab_runs: cfg.tabRuns },
      prompt_files: used.length });

    console.log(`\n   B1. Chat, first answer (a new chat: system prompt + 6 tools + ~${cfg.promptTokens} tokens of project files)`);
    const firsts = [];
    for (let i = 1; i <= cfg.runs; i++) {
      const msgs = freshConversation(cfg.repo, files, `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`);
      const r = await chatTurn(cfg, msgs); r.messages = msgs; firsts.push(r);
      say(`run ${i}: first word after ${r.ttft_s.toFixed(1)} s · prompt ${r.prompt_total ?? "?"} tokens · wrote ${r.tokens} at ${r.gen_tok_s ? r.gen_tok_s.toFixed(1) : "?"} tok/s`);
    }
    const ttft1 = pct(firsts.map((r) => r.ttft_s), 50);
    const promptTokens = pct(firsts.map((r) => r.prompt_total), 50);
    result.first_answer = {
      ttft_s: round(ttft1), gen_tok_s: round(pct(firsts.map((r) => r.gen_tok_s), 50), 1),
      prompt_tokens: promptTokens, prefill_tok_s: promptTokens ? round(promptTokens / ttft1, 0) : null,
      runs: firsts.map(({ messages, answer, ...r }) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? round(v, 3) : v]))),
    };

    console.log("\n   B2. Chat, follow-up in the same conversation (each agent step after the first)");
    const lastRun = firsts[firsts.length - 1];
    const r2 = await chatTurn(cfg, [...lastRun.messages, { role: "assistant", content: lastRun.answer }, FOLLOW_UP]);
    const ratio = r2.ttft_s / ttft1;
    const evaluatedShare = r2.prompt_evaluated != null && r2.prompt_total ? r2.prompt_evaluated / r2.prompt_total : null;
    // The verdict trusts time first (what the user feels), the engine's token count second.
    const cache = ratio < 0.25 || (evaluatedShare != null && evaluatedShare < 0.2) ? "reused" : ratio < 0.7 ? "partly" : "not reused";
    result.follow_up = { ttft_s: round(r2.ttft_s), ttft_vs_first: round(ratio, 2), prompt_total: r2.prompt_total, prompt_evaluated: r2.prompt_evaluated, cached: r2.cached, cache };
    say(`first word after ${r2.ttft_s.toFixed(1)} s (${Math.round(ratio * 100)} % of a new chat)` +
      (r2.prompt_evaluated != null ? ` · read ${r2.prompt_evaluated} of ${r2.prompt_total ?? "?"} tokens` : "") + ` -> cache ${cache}`);

    // A 5-step agent task (read, read, edit, run tests, answer), ~150 tokens written per step: what a user waits.
    const gen = result.first_answer.gen_tok_s;
    result.agent_task_5_steps_s = gen ? round(ttft1 + 4 * r2.ttft_s + 5 * (150 / gen), 1) : null;

    if (cfg.tabUrl && cfg.tabModel) {
      if (!result.tab_alone) {
        console.log(`\n   B3. Tab Completion alone (${cfg.tabRuns} suggestions in ${ctx.file})`);
        await fim(cfg, ctx.prefix, ctx.suffix);
        result.tab_alone = await tabSeries(cfg, ctx, cfg.tabRuns);
        say(`median ${result.tab_alone.p50_ms ?? "-"} ms · 95th percentile ${result.tab_alone.p95_ms ?? "-"} ms · gave up ${result.tab_alone.gave_up}`);
      }
      console.log("\n   B4. Tab Completion while a chat answers (both models on one GPU)");
      const bg = chatTurn(cfg, freshConversation(cfg.repo, files, `bg-${Date.now()}`)).catch((e) => ({ error: String(e.message || e) }));
      await sleep(1000);
      result.tab_during_chat = await tabSeries(cfg, ctx, cfg.tabRuns);
      const bgr = await bg;
      result.tab_during_chat.chat_ttft_s = bgr.error ? null : round(bgr.ttft_s);
      say(`median ${result.tab_during_chat.p50_ms ?? "-"} ms · 95th percentile ${result.tab_during_chat.p95_ms ?? "-"} ms · gave up ${result.tab_during_chat.gave_up} of ${cfg.tabRuns}` +
        (bgr.error ? ` · the chat failed: ${bgr.error}` : ` · the chat's first word after ${bgr.ttft_s.toFixed(1)} s`));
    }
  }
  result.finished = new Date().toISOString();
  fs.writeFileSync(o.out, JSON.stringify(result, null, 2));
}

function set(file, pairs) {
  const r = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  for (const p of pairs) {
    const i = p.indexOf("="); const k = p.slice(0, i), v = p.slice(i + 1);
    r[k] = v === "" ? null : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === "true" ? true : v === "false" ? false : v;
  }
  fs.writeFileSync(file, JSON.stringify(r, null, 2));
}

(async () => {
  const o = args(process.argv.slice(2));
  const cmd = o._[0];
  try {
    if (cmd === "run") await run(o);
    else if (cmd === "warm") await warm(o);
    else if (cmd === "set") set(o._[1], o._.slice(2));
    else { console.error("usage: bench.js run|warm|set …  (see the top of this file)"); process.exit(2); }
  } catch (e) {
    console.error(`   bench.js: ${e.message || e}`);
    process.exit(1);
  }
})();
