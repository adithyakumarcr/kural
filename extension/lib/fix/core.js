// Fix with Kural, the text part (no vscode): what a problem in the editor or a failed terminal command becomes in
// the chat. The AI gets it as a quote pill (lib/chat/index.js addProblem); nothing is sent until the user presses Send.

const MAX_OUTPUT = 8000;       // the last characters of a command's output
const CONTEXT_LINES = 3;       // lines of code around a problem, above and below
const DEFAULT_PROMPT = "Fix this.";

// Colors, cursor moves, window titles (OSC) and shell-integration marks (OSC 633/133) out of terminal text.
const ANSI = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]|\u001b[@-Z\\-_]|\u009b[0-?]*[ -/]*[@-~]/g;

function stripAnsi(s) {
  return String(s == null ? "" : s).replace(ANSI, "").replace(/\r\n/g, "\n").replace(/\r(?!\n)/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

// The last `max` characters, and a first line saying that the rest was cut.
function tail(s, max = MAX_OUTPUT) {
  const t = String(s == null ? "" : s);
  if (t.length <= max) return t;
  return `[…first ${t.length - max} characters left out]\n${t.slice(t.length - max)}`;
}

// The diagnostic's lines ±3 with line numbers; `line` is 1-based. The problem's own line is marked with ">".
function snippetOf(lines, line, around = CONTEXT_LINES) {
  const all = Array.isArray(lines) ? lines : String(lines || "").split(/\r?\n/);
  if (!all.length || !(line >= 1)) return "";
  const from = Math.max(1, line - around), to = Math.min(all.length, line + around);
  const width = String(to).length;
  const out = [];
  for (let n = from; n <= to; n++) out.push(`${n === line ? ">" : " "} ${String(n).padStart(width)} | ${all[n - 1]}`);
  return out.join("\n");
}

// One problem: {file, line, severity, message, source, code, snippet}.
function problemText({ file, line, severity, message, source, code, snippet }) {
  const head = `${severity || "Problem"} in ${file || "a file"}${line ? `, line ${line}` : ""}`;
  const by = [source, code].filter((x) => x !== undefined && x !== null && String(x) !== "").join(" ");
  const out = [`${head}${by ? ` (${by})` : ""}: ${String(message || "").trim()}`];
  if (snippet) out.push("```\n" + String(snippet).replace(/\s+$/, "") + "\n```");
  return out.join("\n");
}

// A command that failed: {command, exitCode, output, cwd}.
function terminalText({ command, exitCode, output, cwd }) {
  const out = tail(stripAnsi(output)).replace(/^\n+|\s+$/g, "");
  const lines = [`$ ${String(command || "").trim()}`];
  if (cwd) lines.push(`(in ${cwd})`);
  lines.push(`Exit code: ${exitCode}`);
  lines.push(out ? "Output:\n```\n" + out + "\n```" : "(no output)");
  return lines.join("\n");
}

const MAX_PROBLEMS = 25;

// Several problems of one file for "Fix all problems in this file": `lines` = the file's text as lines, `problems` =
// [{line (1-based), severity, message, source, code}]; in line order, at most 25 (then "and N more").
function problemsText({ file, lines, problems, max = MAX_PROBLEMS }) {
  const sorted = [...problems].sort((a, b) => (a.line || 0) - (b.line || 0));
  const parts = sorted.slice(0, max).map((p) => problemText({ ...p, file, snippet: snippetOf(lines, p.line) }));
  if (sorted.length > max) parts.push(`…and ${sorted.length - max} more problems in ${file}.`);
  return parts.join("\n\n");
}

// A short label for the pill.
function shorten(s, n = 40) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t;
}

module.exports = { MAX_OUTPUT, CONTEXT_LINES, DEFAULT_PROMPT, stripAnsi, tail, snippetOf, problemText, problemsText, terminalText, shorten };
