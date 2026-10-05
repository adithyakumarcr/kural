// Text search for the Search tab of "Search & Ask" (lib/search/index.js): what VS Code's own Search view did, which
// Kural hides (scripts/rebrand.py). Find with Match Case / Whole Word / Regular Expression, files to include and to
// exclude, exclude settings and ignore files, open editors only; replace with $1, \n, \u\U\l\L and Preserve Case.
// The files on disk are searched with ripgrep, the program VS Code itself ships and uses (same flags as VS Code);
// files open with unsaved changes are searched in memory (searchText) so the results show what you see.
// No vscode inside (test/search-text.test.js). The regex and replace rules are in media/search-replace.js (the page uses them too).

const fs = require("fs"), path = require("path");
const { spawn } = require("child_process");
const { caseSensitive, jsRegex, replacement, expand, preserveCase } = require("../../media/search-replace");

// VS Code's own ripgrep (@vscode/ripgrep-universal has one per system; older VS Codes had @vscode/ripgrep).
function rgPath(appRoot, platform = process.platform, arch = process.arch) {
  const exe = platform === "win32" ? "rg.exe" : "rg";
  const cands = [
    path.join(appRoot, "node_modules.asar.unpacked", "@vscode", "ripgrep-universal", "bin", `${platform}-${arch}`, exe),
    path.join(appRoot, "node_modules.asar.unpacked", "@vscode", "ripgrep", "bin", exe),
    path.join(appRoot, "node_modules", "@vscode", "ripgrep", "bin", exe),
  ];
  return cands.find((c) => fs.existsSync(c)) || exe;
}

// "src, *.ts, ./docs" (the include/exclude boxes) → ripgrep globs, the way VS Code reads them: a pattern without "/"
// matches anywhere ("*.ts" → "**/*.ts"), one with "/" or starting with "./" is from the folder's top, and a plain name
// also means everything inside it ("src" → "**/src" and "**/src/**").
function toGlobs(text) {
  const out = [];
  for (let p of splitCommas(text)) {
    p = p.trim().replace(/\\/g, "/");
    if (!p) continue;
    let rooted = false;
    if (p.startsWith("./")) { p = p.slice(2); rooted = true; }
    else if (p.startsWith("/")) { p = p.slice(1); rooted = true; }
    p = p.replace(/\/+$/, "");
    if (!p) continue;
    if (!rooted && !p.includes("/")) p = `**/${p}`;
    out.push(p);
    if (!/[*?[\]{}]/.test(p.split("/").pop())) out.push(`${p}/**`);   // a folder's name: what's inside it too
  }
  return [...new Set(out)];
}
// (Commas inside {a,b} belong to the glob.)
function splitCommas(s) {
  const out = []; let depth = 0, cur = "";
  for (const c of String(s || "")) {
    if (c === "{") depth++; else if (c === "}") depth = Math.max(0, depth - 1);
    if (c === "," && !depth) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out;
}

// VS Code's "files.exclude" + "search.exclude" settings ({ "**/node_modules": true, … }) → globs. Entries with a
// "when" (sibling files) or false are left out.
function settingGlobs(...objects) {
  const out = [];
  for (const o of objects) for (const [g, v] of Object.entries(o || {})) if (v === true) out.push(g.replace(/\/+$/, ""));
  return [...new Set(out)];
}

// (A new line in the search, typed or as \n in a regex: ripgrep then searches across lines.)
const multiline = (q) => /\n/.test(q.pattern) || (!!q.isRegex && /\\n/.test(q.pattern));

// ripgrep's arguments for one folder. q: { pattern, isRegex, matchCase, wholeWord, smartCase, include, exclude,
// useIgnore, excludeGlobs (from the settings), followSymlinks, globalIgnore, parentIgnore }; paths: files to search
// instead of the whole folder (open editors only).
function rgArgs(q, paths) {
  const a = ["--json", "--hidden", "--no-config", "--crlf", "--engine", "auto"];
  a.push(caseSensitive(q) ? "--case-sensitive" : "--ignore-case");
  if (!q.isRegex) a.push("--fixed-strings");
  if (q.wholeWord) a.push("--word-regexp");
  if (multiline(q)) a.push("--multiline");
  if (q.followSymlinks !== false) a.push("--follow");
  if (q.useIgnore === false) a.push("--no-ignore");
  else {
    if (!q.globalIgnore) a.push("--no-ignore-global");
    if (!q.parentIgnore) a.push("--no-ignore-parent");
  }
  for (const g of toGlobs(q.include)) a.push("-g", g);
  const ex = [...toGlobs(q.exclude), ...(q.useIgnore === false ? [] : q.excludeGlobs || [])];
  for (const g of ex) a.push("-g", `!${g}`);
  a.push("-g", "!.git");
  a.push("--regexp", q.pattern, "--", ...(paths && paths.length ? paths : ["."]));
  return a;
}

// ripgrep reports byte offsets; JavaScript (and VS Code's positions) count UTF-16 characters.
const chars = (buf, end) => buf.subarray(0, end).toString("utf8").length;

// One of ripgrep's "match" lines → matches: { line (1-based), col, endLine, endCol (0-based), text (the first line),
// ranges ([start, end] in text, for highlighting), match (the matched text) }. One per occurrence, like VS Code.
function fromRg(data) {
  if (!data || !data.lines || typeof data.lines.text !== "string") return [];   // (not UTF-8 text: skipped)
  const all = data.lines.text, buf = Buffer.from(all, "utf8");
  const lines = all.replace(/\r?\n$/, "").split(/\r?\n/);
  const out = [];
  for (const s of data.submatches || []) {
    const before = all.slice(0, chars(buf, s.start));
    const match = s.match && typeof s.match.text === "string" ? s.match.text : all.slice(before.length, chars(buf, s.end));
    out.push(place(lines, data.line_number, before, match));
  }
  return out;
}

function place(lines, firstLine, before, match) {
  const bl = before.split("\n"), ml = match.split("\n");
  const lineIdx = bl.length - 1, col = bl[lineIdx].replace(/\r$/, "").length;
  const endLineIdx = lineIdx + ml.length - 1;
  const endCol = ml.length > 1 ? ml[ml.length - 1].replace(/\r$/, "").length : col + match.length;
  const text = (lines[lineIdx] || "").replace(/\r$/, "");
  return { line: firstLine + lineIdx, col, endLine: firstLine + endLineIdx, endCol, text,
    ranges: [[col, endLineIdx === lineIdx ? Math.min(endCol, text.length) : text.length]], match };
}

// Search a text in memory: the same matches as ripgrep would give. limit: at most this many.
function searchText(text, q, limit = 20000) {
  if (!q.pattern) return [];
  const re = jsRegex(q);
  const lines = text.split(/\r?\n/);
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const lineOf = (off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; } return lo; };
  const out = [];
  let m;
  while ((m = re.exec(text)) && out.length < limit) {
    if (!m[0]) { re.lastIndex++; continue; }   // (an empty match isn't a result)
    const li = lineOf(m.index);
    const before = text.slice(starts[li], m.index);
    out.push(place(lines.slice(li), li + 1, before, m[0]));
  }
  return out;
}

// ---------- replacing ----------
// What replacing these matches in a text (a whole file) changes: matches with { offset, match } (where they start).
// Each is checked again at its place (the file may have changed since the search: then it's skipped).
// Returns { edits: [{ offset, length, text }], skipped }.
function replaceEdits(text, matches, q, replaceText) {
  const re = jsRegex(q, true);
  const edits = [];
  let pos = 0, skipped = 0;
  for (const x of [...matches].sort((a, b) => a.offset - b.offset)) {
    if (x.offset < pos) { skipped++; continue; }
    re.lastIndex = x.offset;
    const m = re.exec(text);
    if (!m || m.index !== x.offset || (x.match !== undefined && m[0] !== x.match)) { skipped++; continue; }
    edits.push({ offset: x.offset, length: m[0].length, text: replacement(m, q, replaceText) });
    pos = x.offset + m[0].length;
  }
  return { edits, skipped };
}

// The same, as the new text (the Replace Preview).
function replaceIn(text, matches, q, replaceText) {
  const { edits, skipped } = replaceEdits(text, matches, q, replaceText);
  let out = "", pos = 0;
  for (const e of edits) { out += text.slice(pos, e.offset) + e.text; pos = e.offset + e.length; }
  return { text: out + text.slice(pos), done: edits.length, skipped };
}

// ---------- running ripgrep ----------
// Search one folder. onFile(absPath, matches) for each file with matches (as they come). Resolves with
// { limited, error }. stop() ends it early.
function runRg(bin, cwd, args, onFile, { max = 20000, spawnFn = spawn } = {}) {
  let child;
  const job = new Promise((resolve) => {
    child = spawnFn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "", err = "", total = 0, limited = false, file = null, list = [];
    const flush = () => { if (file && list.length) onFile(path.resolve(cwd, file), list); file = null; list = []; };
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (limited) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        if (j.type === "begin") { flush(); file = j.data.path.text; }
        else if (j.type === "match") {
          for (const m of fromRg(j.data)) { if (total >= max) { limited = true; break; } list.push(m); total++; }
          if (limited) { flush(); try { child.kill(); } catch {} }
        } else if (j.type === "end") flush();
      }
    });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => resolve({ limited, error: e.message }));
    child.on("close", (code) => {
      flush();
      // 1 = nothing found; 2 = an error (with results too, e.g. an unreadable file: only a broken search counts)
      resolve({ limited, total, error: code === 2 && !total && err ? err.trim().split("\n").pop().replace(/^rg: /, "") : null });
    });
  });
  return { job, stop: () => { try { child.kill(); } catch {} } };
}

module.exports = { rgPath, toGlobs, settingGlobs, rgArgs, fromRg, searchText, jsRegex, replacement, expand, preserveCase, replaceEdits, replaceIn, runRg, caseSensitive };
