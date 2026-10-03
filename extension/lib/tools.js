// The tools Kural's own engine (lib/engine.js) gives a model: read, write and edit files, find files, search
// their text, run a command, ask the user. Same names and inputs as Claude Code's tools, so the chat shows them
// the same way (and "Undo" works for edits). No vscode here (tests run without it).

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", ".mypy_cache", ".pytest_cache", "dist", "build",
  ".next", "target", ".gradle", ".idea", ".vscode-test", "coverage", ".tox"]);
const MAX_OUT = 30000;          // characters of tool output the model gets back
const clip = (s, n = MAX_OUT) => s.length > n ? `${s.slice(0, n)}\n… (cut: ${s.length - n} more characters)` : s;

// What the model sees: name, what it does, its inputs (JSON schema).
const DEFS = {
  Read: { description: "Read a text file. Returns lines with line numbers. For big files, read a part with offset/limit.",
    parameters: { type: "object", properties: { file_path: { type: "string", description: "Path (relative to the project, or absolute)" },
      offset: { type: "integer", description: "First line to read (1-based)" }, limit: { type: "integer", description: "How many lines" } }, required: ["file_path"] } },
  Write: { description: "Create a file, or replace a whole file, with this content. For small changes to an existing file use Edit.",
    parameters: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } }, required: ["file_path", "content"] } },
  Edit: { description: "Change a file: replace old_string (copied exactly from the file, with enough lines around it to be unique) with new_string.",
    parameters: { type: "object", properties: { file_path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" },
      replace_all: { type: "boolean", description: "Replace every match instead of exactly one" } }, required: ["file_path", "old_string", "new_string"] } },
  Glob: { description: "Find files by name pattern, e.g. \"**/*.py\" or \"src/**/test_*.js\".",
    parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string", description: "Folder to look in (default: the project)" } }, required: ["pattern"] } },
  Grep: { description: "Search the text of files with a regular expression. Returns file:line: text for each match.",
    parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string", description: "Folder or file (default: the project)" },
      glob: { type: "string", description: "Only files matching this, e.g. \"*.ts\"" }, case_insensitive: { type: "boolean" } }, required: ["pattern"] } },
  Bash: { description: "Run a shell command in the project folder (tests, builds, git…). Returns its output and exit code.",
    parameters: { type: "object", properties: { command: { type: "string" }, description: { type: "string", description: "What it does, in a few words" } }, required: ["command"] } },
  AskUserQuestion: { description: "Ask the user a multiple-choice question when a decision is really theirs. Short options, your recommendation first.",
    parameters: { type: "object", properties: { questions: { type: "array", items: { type: "object", properties: {
      question: { type: "string" }, header: { type: "string", description: "1-3 word label" },
      options: { type: "array", items: { type: "object", properties: { label: { type: "string" }, description: { type: "string" } }, required: ["label"] } },
      multiSelect: { type: "boolean" } }, required: ["question", "options"] } } }, required: ["questions"] } },
};
const SUPPORTED = Object.keys(DEFS);
const definitions = (names) => names.filter((n) => DEFS[n]).map((n) => ({ type: "function", function: { name: n, ...DEFS[n] } }));

// "src/**/*.{js,ts}" -> a regular expression for paths relative to the folder searched (with "/").
function globRegex(glob) {
  let re = "", i = 0;
  const g = String(glob).replace(/\\/g, "/").replace(/^\.\//, "");
  while (i < g.length) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") { re += g[i + 2] === "/" ? "(?:.*/)?" : ".*"; i += g[i + 2] === "/" ? 3 : 2; continue; }
    if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") { const end = g.indexOf("}", i); if (end > i) { re += `(?:${g.slice(i + 1, end).split(",").map((x) => x.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")).join("|")})`; i = end + 1; continue; } re += "\\{"; }
    else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
    i++;
  }
  return new RegExp(`^${re}$`);
}

// Every file under dir (skipping .git, node_modules…), as paths relative to dir with "/". At most `max`.
function walk(dir, max = 20000) {
  const out = [];
  const go = (d, rel) => {
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= max) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) go(path.join(d, e.name), r); }
      else if (e.isFile()) out.push(r);
    }
  };
  go(dir, "");
  return out;
}

const isBinary = (buf) => buf.subarray(0, 8000).includes(0);

class Tools {
  // cwd: the project folder; dirs: more folders the model may use.
  constructor(cwd, dirs = []) { this.cwd = cwd; this.dirs = dirs; this.running = null; }

  abs(p) { if (!p) throw new Error("no path given"); return path.isAbsolute(p) ? path.normalize(p) : path.join(this.cwd, p); }

  // Run a tool: { output, error } (output is what the model gets back).
  async run(name, input = {}) {
    try {
      if (!DEFS[name] || name === "AskUserQuestion") return { error: `Unknown tool ${name}.` };
      return { output: await this[name.toLowerCase()](input) };
    } catch (e) { return { error: e.message, output: `Error: ${e.message}` }; }
  }

  read({ file_path, offset = 1, limit = 2000 }) {
    const f = this.abs(file_path);
    if (!fs.existsSync(f)) throw new Error(`${file_path} doesn't exist`);
    if (fs.statSync(f).isDirectory()) throw new Error(`${file_path} is a folder; use Glob to list it`);
    const buf = fs.readFileSync(f);
    if (isBinary(buf)) return `(${file_path} is a binary file, ${buf.length} bytes)`;
    const lines = buf.toString("utf8").split("\n");
    const start = Math.max(1, Number(offset) || 1), end = Math.min(lines.length, start - 1 + (Number(limit) || 2000));
    const shown = lines.slice(start - 1, end).map((l, i) => `${String(start + i).padStart(6)}\t${l.length > 2000 ? l.slice(0, 2000) + "…" : l}`);
    return clip(shown.join("\n") + (end < lines.length ? `\n… (${lines.length - end} more lines; read on with offset ${end + 1})` : ""));
  }

  write({ file_path, content }) {
    const f = this.abs(file_path);
    const existed = fs.existsSync(f);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, String(content ?? ""), "utf8");
    return `${existed ? "Replaced" : "Created"} ${file_path} (${String(content ?? "").split("\n").length} lines).`;
  }

  edit({ file_path, old_string, new_string, replace_all = false }) {
    const f = this.abs(file_path);
    if (!fs.existsSync(f)) throw new Error(`${file_path} doesn't exist (use Write to create it)`);
    const text = fs.readFileSync(f, "utf8");
    if (!old_string) throw new Error("old_string is empty");
    // Windows files: the model usually writes "\n"; match the file's "\r\n".
    let o = String(old_string), n = String(new_string ?? "");
    if (!text.includes(o) && text.includes("\r\n") && text.includes(o.replace(/\r?\n/g, "\r\n"))) { o = o.replace(/\r?\n/g, "\r\n"); n = n.replace(/\r?\n/g, "\r\n"); }
    const count = text.split(o).length - 1;
    if (!count) throw new Error(`old_string isn't in ${file_path}. Read the file and copy the text exactly (spaces and indentation too).`);
    if (count > 1 && !replace_all) throw new Error(`old_string is in ${file_path} ${count} times. Add lines around it so it's unique, or set replace_all.`);
    fs.writeFileSync(f, replace_all ? text.split(o).join(n) : text.replace(o, () => n), "utf8");
    return `Edited ${file_path}${replace_all && count > 1 ? ` (${count} places)` : ""}.`;
  }

  glob({ pattern, path: dir }) {
    const base = dir ? this.abs(dir) : this.cwd;
    const pat = String(pattern || "").replace(/\\/g, "/");
    const re = globRegex(pat), byName = !pat.includes("/");
    const files = walk(base).filter((r) => re.test(r) || (byName && re.test(r.split("/").pop())));
    if (!files.length) return "No files found.";
    return clip(files.slice(0, 300).join("\n") + (files.length > 300 ? `\n… and ${files.length - 300} more` : ""));
  }

  grep({ pattern, path: where, glob, case_insensitive = false }) {
    let re;
    try { re = new RegExp(pattern, case_insensitive ? "i" : ""); } catch { re = new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), case_insensitive ? "i" : ""); }
    const target = where ? this.abs(where) : this.cwd;
    const single = fs.existsSync(target) && fs.statSync(target).isFile();
    const base = single ? path.dirname(target) : target;
    const only = glob ? globRegex(String(glob).replace(/\\/g, "/")) : null;
    const files = single ? [path.basename(target)] : walk(base).filter((r) => !only || only.test(r) || only.test(r.split("/").pop()));
    const out = [];
    for (const r of files) {
      const f = path.join(base, r);
      let buf; try { const st = fs.statSync(f); if (st.size > 2e6) continue; buf = fs.readFileSync(f); } catch { continue; }
      if (isBinary(buf)) continue;
      const lines = buf.toString("utf8").split("\n");
      for (let i = 0; i < lines.length && out.length < 200; i++) if (re.test(lines[i])) out.push(`${path.relative(this.cwd, f).replace(/\\/g, "/")}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
      if (out.length >= 200) { out.push("… (more matches; narrow the search)"); break; }
    }
    return out.length ? clip(out.join("\n")) : "No matches.";
  }

  bash({ command, timeout = 120000 }) {
    const win = process.platform === "win32";
    return new Promise((resolve) => {
      // Its own process group (Mac, Linux), so Stop or the time limit ends everything it started (a dev server,
      // say), not just the shell. Done when the shell exits: something it left running in the background can keep
      // the output open for ever, so don't wait for that.
      const p = spawn(win ? "powershell.exe" : (process.env.SHELL || "/bin/bash"), win ? ["-NoProfile", "-Command", command] : ["-lc", command],
        { cwd: this.cwd, env: process.env, windowsHide: true, detached: !win });
      const killAll = () => { try { if (!win && p.pid) process.kill(-p.pid, "SIGTERM"); else p.kill(); } catch { try { p.kill(); } catch { /* gone */ } } };
      this.running = { kill: killAll };
      let out = "", finished = false;
      const add = (d) => { out += d; if (out.length > 2 * MAX_OUT) out = out.slice(-2 * MAX_OUT); };
      p.stdout.on("data", add); p.stderr.on("data", add);
      const finish = (text) => { if (finished) return; finished = true; clearTimeout(timer); this.running = null; resolve(text); };
      const timer = setTimeout(() => { out += `\n(stopped after ${Math.round(timeout / 1000)} s)`; killAll(); }, Math.min(Number(timeout) || 120000, 600000));
      p.on("error", (e) => finish(`Couldn't run it: ${e.message}`));
      // (A moment after exit for the last output; "close" may never come while a background child holds the pipe.)
      p.on("exit", (code, sig) => setTimeout(() => finish(clip(`${out.trim() || "(no output)"}\n(exit code ${code === null ? sig : code})`)), 150));
      p.on("close", (code) => finish(clip(`${out.trim() || "(no output)"}\n(exit code ${code})`)));
      p.stdin.end();
    });
  }

  stop() { if (this.running) { try { this.running.kill(); } catch { /* gone */ } } }
}

module.exports = { Tools, definitions, globRegex, walk, SUPPORTED };
