// Kural's log: View → Output → Kural. Every request, its timing, and what went wrong.
const vscode = require("vscode");

let output = null;
function initLog() { output = vscode.window.createOutputChannel("Kural"); return output; }
function log(msg) { if (output) output.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`); }

module.exports = { initLog, log };
