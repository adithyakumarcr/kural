// Live check of the voice tidy-up (needs `claude` installed and logged in): real dictated-style transcripts through the
// real code path (lib/voice/cleanup.js → brain.makeAgent → `claude` with Haiku, no tools). It must remove fillers and fix
// grammar, keep code and file names, and not answer the request. Run: node test/voice-cleanup.live.js
const assert = require("assert");
const Module = require("module");
const path = require("path");
const orig = Module._load;
const vscode = { window: { createOutputChannel: () => ({ appendLine() {} }) }, workspace: { workspaceFolders: [], isTrusted: true, getConfiguration: () => ({ get: (k, d) => d, inspect: () => undefined }), onDidChangeConfiguration: () => ({ dispose() {} }) },
  env: {}, commands: { executeCommand: async () => {} }, Uri: { file: (f) => ({ scheme: "file", fsPath: f }) }, EventEmitter: class { constructor() { this.event = () => {}; } fire() {} } };
Module._load = function (req, ...a) { return req === "vscode" ? vscode : orig.call(this, req, ...a); };
const ext = path.resolve(__dirname, "../extension");
require(ext + "/lib/ai/claude.js").setSetupGate(() => true);
const brain = require(ext + "/lib/ai");
const { cleanup } = require(ext + "/lib/voice/cleanup.js");
const os = require("os");

const deps = { makeAgent: brain.makeAgent, model: () => "haiku", check: () => ({ ok: true }), isClaude: () => true, nameOf: () => "Haiku",
  mode: () => "ask", emptyDir: () => os.tmpdir(), localOpts: () => null, cwd: () => process.cwd() };
const CASES = [
  { raw: "um so uh can you like add a a test for the the router um selection in policy dot js", keep: ["test", "router", "policy"], not: ["um", "uh"] },
  { raw: "ahm I want the the mic button to to show a red dot when it's er recording and uh stop after five minutes", keep: ["mic", "red dot", "five minutes"], not: ["ahm", " er "] },
  { raw: "write a function that reverses a string", keep: ["reverses a string"], not: ["function reverse", "```"] },
];

(async () => {
  let failed = 0;
  for (const c of CASES) {
    const t = Date.now();
    const r = await cleanup(c.raw, deps);
    const low = ` ${r.text.toLowerCase()} `;
    const ok = r.cleaned && c.keep.every((k) => low.includes(k)) && c.not.every((k) => !low.includes(k));
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${Date.now() - t} ms\n  heard: ${c.raw}\n  tidy:  ${r.text}${r.why ? `\n  why:   ${r.why}` : ""}`);
  }
  console.log(failed ? `voice-cleanup.live: ${failed} FAILED` : "voice-cleanup.live: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
