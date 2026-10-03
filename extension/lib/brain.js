// Which engine answers: the model picked in the chat decides for the chat, Ask, Ctrl+K and Apply.
//   a Claude model ("opus", "sonnet", "haiku")  → Claude Code (lib/claude.js), with your Claude login
//   a model on your computer ("ollama:<name>")  → Kural's own engine (lib/engine.js), through Ollama, offline
// (Tab Complete has its own setting: a small fill-in-the-middle model is much faster for that.)

const vscode = require("vscode");
const os = require("os");
const path = require("path");
const { ClaudeProcess, ClaudeSession, isSetUp, log } = require("./claude");
const { LocalAgent, systemPrompt, post, errorText, friendly } = require("./engine");

const isLocal = (model) => /^ollama:./.test(model || "");
const localName = (model) => String(model).slice("ollama:".length);
const cfg = () => vscode.workspace.getConfiguration("kural");
const ollamaUrl = () => String(cfg().get("tabCompletion.ollamaUrl") || "http://127.0.0.1:11434").replace(/\/$/, "");
const contextLength = () => cfg().get("localModels.contextLength") || 32768;

let modelSource = () => "sonnet";
let localFallback = () => null;   // the model on this computer that passed Get started's test, if any
// The chat's model. A Claude model while only your own model is set up (an older chat, say): your own model.
const currentModel = () => {
  let m; try { m = modelSource() || "sonnet"; } catch { m = "sonnet"; }
  if (!isLocal(m) && !isSetUp()) { const l = localFallback(); if (l) return l; }
  return m;
};
const setModelSource = (f, fallback) => { modelSource = f; if (fallback) localFallback = fallback; };

// Can this model be used right now? { ok } or { why } (for a Claude model before Claude is set up).
function usable(model = currentModel()) {
  if (isLocal(model) || isSetUp()) return { ok: true };
  return { why: "Claude isn't set up. Set it up in Get started, or pick a model on your computer in the chat's model menu." };
}

// A conversation process for `model`: Claude Code, or Kural's engine. Both take the same handlers and send the
// same events. claudeOpts: ClaudeProcess options; local: LocalAgent options (tools, allowedTools, jsonSchema…).
function makeAgent(model, claudeOpts, local, handlers) {
  if (!isLocal(model)) return new ClaudeProcess({ ...claudeOpts, model }, handlers);
  return new LocalAgent({ name: claudeOpts.name, cwd: claudeOpts.cwd, addDirs: claudeOpts.addDirs, appendSystemPrompt: claudeOpts.appendSystemPrompt,
    effort: claudeOpts.effort, jsonSchema: claudeOpts.jsonSchema, sessionId: claudeOpts.sessionId, resume: claudeOpts.resume, ...local, model: localName(model), baseUrl: ollamaUrl(), contextLength: contextLength() }, handlers);
}

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
    this.claude = new ClaudeSession({ ...opts, model: () => { const m = currentModel(); return isLocal(m) ? opts.fallbackModel() : m; } }, onState);
  }
  start() { if (!isLocal(currentModel())) return this.claude.start(); return true; }
  stop() { this.claude.stop(); }
  ask(prompt, token) {
    const m = currentModel();
    if (isLocal(m)) return askLocal(m, this.opts.systemPrompt, prompt, token, !!this.opts.quiet);
    if (this.started && this.started !== m) this.claude.stop();   // you picked another Claude model: start fresh with it
    this.started = m;
    return this.claude.ask(prompt, token);
  }
}

const localStore = (context) => path.join(context.globalStorageUri.fsPath, "local-chats");

module.exports = { isLocal, localName, currentModel, setModelSource, usable, makeAgent, Session, askLocal, ollamaUrl, contextLength, localStore, systemPrompt };
