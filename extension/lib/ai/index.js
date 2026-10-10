// Kural's AI: which provider answers. The model picked in the chat decides for the chat, Ask, Ctrl+K, Apply and commit
// messages (Tab Completion has its own engine: a small fill-in-the-middle model is much faster for that).
//
//   PROVIDERS (below), one entry each:
//     claude  "opus" / "sonnet" / "haiku"   → Claude Code (./claude.js) with your Claude login
//     codex   "codex:<model>"               → Codex CLI (./codex.js) with your ChatGPT login
//     agy     "agy:<model>"                 → Google Gemini: Antigravity CLI (./agy.js) with your Google account
//     ollama  "ollama:<name>"               → Kural's own engine (./engine.js + ./tools.js), through Ollama, offline
//   To add a provider (LM Studio, an OpenAI-compatible server…): an entry with the same shape — owns(model),
//   ready(), agent(…) (a conversation process with ClaudeProcess's methods and events), ask(…) (one answer) —
//   plus its models in the chat's model menu and a way in Get started.

const vscode = require("vscode");
const os = require("os");
const path = require("path");
const { ClaudeProcess, ClaudeSession, isSetUp, log } = require("./claude");
const ws = require("../workspace");
const { LocalAgent, systemPrompt, post, errorText, friendly } = require("./engine");
const { CLIS, IDS: CLI_IDS, cliOf, cliModel } = require("./clis");

// Codex and Gemini (agy): where their program is and whether Get started's test passed (set by lib/getstarted.js), and the
// models each offers (for the chat's model menu). Folder for their conversation ids (set by extension.js).
const cli = Object.fromEntries(CLI_IDS.map((id) => [id, { bin: null, ready: false, models: [] }]));
// (Gemini's models one per thinking level, as an older Kural saved them: grouped, the intensity picks the level.)
const setCli = (id, info) => {
  if (!cli[id]) return;
  Object.assign(cli[id], info);
  if (id === "agy" && Array.isArray(cli[id].models)) cli[id].models = require("./agy").groupModels(cli[id].models);
};
let cliStore = null;
const cliStores = {};
// dir: where the Codex / Gemini conversation ids are kept; byCli: another folder for one of them. A profile with its
// own Codex account needs its own ids (a Codex conversation lives in that account's folder); Gemini's are the same everywhere.
const setStore = (dir, byCli) => { cliStore = dir; Object.assign(cliStores, byCli || {}); };

const isLocal = (model) => /^ollama:./.test(model || "");
const localName = (model) => String(model).slice("ollama:".length);
const cfg = () => vscode.workspace.getConfiguration("kural");
const ollamaUrl = () => String(cfg().get("tabCompletion.ollamaUrl") || "http://127.0.0.1:11434").replace(/\/$/, "");
const contextLength = () => cfg().get("localModels.contextLength") || 32768;

let modelSource = () => "sonnet";
let localFallback = () => null;   // the model on this computer that passed Get started's test, if any
// The chat's model. One whose program isn't set up (an older chat, say): one that is.
const currentModel = () => {
  let m; try { m = modelSource() || "sonnet"; } catch { m = "sonnet"; }
  if (!providerOf(m).ready()) { const other = fallbackModel(); if (other) return other; }
  return m;
};
// A model that can be used now: your own model, then Gemini, then Codex (Claude's is the default anyway).
function fallbackModel() {
  const l = localFallback(); if (l) return l;
  for (const id of CLI_IDS) if (cli[id].ready && cli[id].bin) return `${id}:${(cli[id].models.find((x) => x.isDefault) || {}).id || "default"}`;
  return isSetUp() ? "sonnet" : null;
}
const setModelSource = (f, fallback) => { modelSource = f; if (fallback) localFallback = fallback; };

// The fastest model you can use right now (Search & Ask: finding places in the code needs speed, not the most capable
// model). The cloud AIs first, the chat's own first among them (the account you're using): Claude's Haiku, or the
// lightest Codex / Gemini model by the Model Router's tiers ("mini", "flash", "fast and affordable"…: router/policy.js).
// None set up: your model on this computer.
function fastestModel(prefer = currentModel()) {
  const { traits } = require("../router/policy");
  const lightest = (id) => {
    const list = (cli[id].models || []).map((m, i) => ({ m, i, t: traits(m) }));
    list.sort((a, b) => a.t.quality - b.t.quality || a.t.legacy - b.t.legacy || !!b.m.isDefault - !!a.m.isDefault || a.i - b.i);
    return list.length ? list[0].m.id : "default";
  };
  const first = prefer ? engineOf(prefer) : null;
  for (const id of [...new Set([first, "claude", ...CLI_IDS])]) {
    if (id === "claude" && isSetUp()) return "haiku";
    if (cli[id] && cli[id].ready && cli[id].bin) return `${id}:${lightest(id)}`;
  }
  return isLocal(prefer) ? prefer : localFallback() || prefer || null;
}

// Can this model be used right now? { ok } or { why } (for a model whose program isn't set up yet).
function usable(model = currentModel()) {
  const p = providerOf(model);
  if (p.ready()) return { ok: true };
  return { why: `${p.label} isn't set up. Set it up in Get started, or pick another model in the chat's model menu.` };
}

// Codex / Gemini (agy): Kural's opts (ClaudeProcess style) → theirs. They have no JSON-answer option, so Ask's JSON is asked for
// in words (search.js reads it from the answer).
function cliAgent(id, model, opts, handlers) {
  const c = cli[id];
  const json = opts.jsonSchema ? `\n\nAnswer with only one JSON object (no other text, no code fence) that matches this JSON schema: ${JSON.stringify(opts.jsonSchema)}` : "";
  const options = { name: opts.name, bin: c.bin, model: cliModel(model), models: c.models, effort: opts.effort, mode: opts.mode || (opts.jsonSchema ? "ask" : "agent"),
    cwd: opts.cwd || ws.workDir(), addDirs: opts.addDirs, appendSystemPrompt: (opts.appendSystemPrompt || "") + json,
    mcpServers: opts.mcpServers, handoffChars: opts.handoffChars, sessionId: opts.sessionId, resume: opts.resume, store: cliStores[id] || cliStore || path.join(os.tmpdir(), "kural-cli-chats") };
  if (opts.teamConfig) return new (require("../chat/team-agent").TeamAgent)({ ...options, teamConfig: opts.teamConfig }, handlers,
    (o, h) => new CLIS[id].Agent(o, h));
  return new CLIS[id].Agent(options, handlers);
}
async function askCli(id, model, system, prompt, token) {
  const ctl = new AbortController();
  if (token) token.onCancellationRequested(() => ctl.abort());
  const t0 = Date.now();
  try {
    const text = await CLIS[id].ask(cli[id].bin, { model: cliModel(model), models: cli[id].models, system, prompt, cwd: ws.root() || ws.workDir(), signal: ctl.signal });
    log(`${CLIS[id].short}: answer in ${Date.now() - t0} ms`);
    return text == null ? null : String(text);
  } catch (e) { log(`${CLIS[id].short}: ${e.message}`); return null; }
}

const PROVIDERS = [
  { id: "ollama", label: "Your own model", owns: isLocal, ready: () => true,   // (Ollama itself is checked before use)
    // opts: ClaudeProcess-style options; local: the engine's own (tools, allowedTools, capabilities, store).
    agent: (model, opts, local, handlers) => new LocalAgent({ name: opts.name, cwd: opts.cwd || ws.workDir(), addDirs: opts.addDirs,
      appendSystemPrompt: opts.appendSystemPrompt, effort: opts.effort, jsonSchema: opts.jsonSchema, sessionId: opts.sessionId,
      resume: opts.resume, ...local, model: localName(model), baseUrl: ollamaUrl(), contextLength: contextLength() }, handlers),
    ask: (model, system, prompt, token, quiet) => askLocal(model, system, prompt, token, quiet) },
  ...CLI_IDS.map((id) => ({ id, label: CLIS[id].label, owns: (m) => cliOf(m) === id, ready: () => cli[id].ready && !!cli[id].bin,
    agent: (model, opts, _local, handlers) => cliAgent(id, model, opts, handlers),
    ask: (model, system, prompt, token) => askCli(id, model, system, prompt, token) })),
  { id: "claude", label: "Claude", owns: () => true, ready: () => isSetUp(),
    agent: (model, opts, _local, handlers) => new ClaudeProcess({ ...opts, model }, handlers),
    ask: null },   // (one answers come from a warm ClaudeSession: see Session)
];
const providerOf = (model) => PROVIDERS.find((p) => p.owns(model));

// A conversation process for `model`, from its provider. All take the same handlers and send the same events.
function makeAgent(model, opts, local, handlers) { return providerOf(model).agent(model, opts, local || {}, handlers); }

// One question, one answer, no tools (Ctrl+K, Apply, commit messages): a local model gets one /api/chat request.
// quiet: no popup when it fails (commit suggestions in the terminal come often; the log has it).
async function askLocal(model, system, prompt, token, quiet = false) {
  const ctl = new AbortController();
  if (token) token.onCancellationRequested(() => ctl.abort());
  const t0 = Date.now();
  const once = async (think) => {
    const res = await post(`${ollamaUrl()}/api/chat`, { model: localName(model), stream: false, ...(think === false ? { think: false } : {}),
      options: { num_ctx: contextLength() }, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }, ctl.signal);
    if (!res.ok) throw new Error(await errorText(res));
    return JSON.parse(await res.text()).message.content || "";
  };
  try {
    // Thinking off (faster); a model without thinking may refuse "think": then ask without it.
    let text;
    try { text = await once(false); } catch (e) { if (/think/i.test(e.message)) text = await once(undefined); else throw e; }
    log(`${localName(model)}: answer in ${Date.now() - t0} ms`);
    return text;
  } catch (e) {
    if (e.name !== "AbortError") {
      log(`${localName(model)}: ${e.message}`);
      if (!quiet) vscode.window.showWarningMessage(`Kural: ${localName(model)} didn't answer: ${friendly(e, localName(model))}`);
    }
    return null;
  }
}

// Like ClaudeSession (ask / start / stop), but answered by the chat's model: Claude, or a local model.
// claudeModel(): the Claude model to use when the chat's model is local or not a Claude one (e.g. the edit model).
class Session {
  constructor(opts, onState = () => {}) {
    this.opts = opts;
    this.claude = new ClaudeSession({ ...opts, model: () => { const m = currentModel(); return engineOf(m) === "claude" ? m : opts.fallbackModel(); } }, onState);
  }
  start() { if (engineOf(currentModel()) === "claude") return this.claude.start(); return true; }
  stop() { this.claude.stop(); }
  ask(prompt, token) {
    const m = currentModel();
    const p = providerOf(m);
    if (p.ask) return p.ask(m, this.opts.systemPrompt, prompt, token, !!this.opts.quiet);
    if (this.started && this.started !== m) this.claude.stop();   // you picked another Claude model: start fresh with it
    this.started = m;
    return this.claude.ask(prompt, token);
  }
}

const localStore = () => require("../profiles/scope").dir("local-chats", "data");

// "claude" | "ollama" | "codex" | "agy": which program has a chat's conversation.
const engineOf = (model) => providerOf(model).id;

module.exports = { PROVIDERS, providerOf, engineOf, isLocal, localName, currentModel, fallbackModel, fastestModel, setModelSource, usable, makeAgent, Session, askLocal,
  ollamaUrl, contextLength, localStore, systemPrompt, setCli, cli, setStore, cliOf };
