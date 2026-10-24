// Project rules (Cursor-style; no vscode here): Markdown files in a project's .kural/rules/ (and .cursor/rules/, so a Cursor
// project works as it is), any depth, *.md and *.mdc. A file may start with frontmatter (description, globs, alwaysApply).
// Four kinds, decided like Cursor does:
//   always     alwaysApply: true                      -> in the AI's instructions every time
//   attached   has globs                              -> added to a message that has a matching file (@-mentioned, attached, open)
//   requested  a description, no globs, not always    -> listed with its path; the AI reads it when it's relevant
//   manual     none of the above                      -> added only when you @-mention the rule file itself
// A plain .kural/rules/*.md without frontmatter counts as always (the simple case).

const fs = require("fs");
const path = require("path");
const { within, real } = require("../paths");

const DIRS = [".kural/rules", ".cursor/rules"];
const LIMITS = { rule: 20000, all: 60000, files: 200, depth: 8, read: 200000 };

// ---------- the files ----------

// A tiny frontmatter reader: `key: value` lines between two --- lines, values as a string, [a, b] or "- a" lines.
function parseFrontmatter(text) {
  const m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { meta: null, body: text };
  const meta = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && key) { meta[key] = [].concat(meta[key] || [], unquote(item[1])); continue; }
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    key = kv[1];
    const v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) meta[key] = splitList(v.slice(1, -1));
    else meta[key] = v === "" ? "" : unquote(v);
  }
  return { meta, body: text.slice(m[0].length) };
}
const unquote = (v) => { const s = String(v).trim(); return /^(["']).*\1$/.test(s) && s.length > 1 ? s.slice(1, -1) : s; };
// "a, b" -> ["a", "b"] (commas inside {braces} stay: "*.{ts,js}" is one glob)
function splitList(s) {
  const out = []; let depth = 0, cur = "";
  for (const c of String(s)) {
    if (c === "{") depth++; else if (c === "}") depth = Math.max(0, depth - 1);
    if (c === "," && !depth) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out.map(unquote).filter(Boolean);
}
const globsOf = (v) => (Array.isArray(v) ? v.map(unquote) : splitList(v || "")).filter(Boolean);

function kindOf(meta, ext, underKural) {
  if (!meta) return underKural && ext === ".md" ? "always" : "manual";
  if (/^true$/i.test(String(meta.alwaysApply).trim())) return "always";
  if (globsOf(meta.globs).length) return "attached";
  if (String(meta.description || "").trim()) return "requested";
  return "manual";
}

// The start of a file (a huge file is never read whole).
function readHead(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(LIMITS.read);
    return buf.toString("utf8", 0, fs.readSync(fd, buf, 0, buf.length, 0));
  } finally { fs.closeSync(fd); }
}

// Every rule file under one folder. A link is followed only for a file that stays inside the project.
function walk(dir, root, depth, out) {
  if (depth > LIMITS.depth || out.length >= LIMITS.files) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (out.length >= LIMITS.files) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, root, depth + 1, out);
    else if ((e.isFile() || e.isSymbolicLink()) && /\.mdc?$/i.test(e.name)) {
      if (e.isSymbolicLink()) {
        let st = null;
        try { st = fs.statSync(full); } catch { /* dangling */ }
        if (!st || !st.isFile() || !within(full, [root])) continue;
      }
      out.push(full);
    }
  }
}

const cutNote = (n) => `\n[Kural cut this rule: it is longer than ${n} characters.]`;

// loadRules(roots) -> [{ path, rel, root, kind, description, globs, body }], the project folders' rules in a steady order.
function loadRules(roots) {
  const rules = [], seen = new Set();
  for (const root of [...new Set((roots || []).filter(Boolean))]) {
    for (const dir of DIRS) {
      const base = path.join(root, ...dir.split("/"));
      // (a .kural or rules folder that is a link out of the project isn't read)
      if (!fs.existsSync(base) || !within(base, [root])) continue;
      const files = [];
      walk(base, root, 0, files);
      for (const file of files) {
        const id = real(file);
        if (seen.has(id)) continue;
        seen.add(id);
        let text;
        try { text = readHead(file); } catch { continue; }
        const { meta, body } = parseFrontmatter(text);
        const rel = path.relative(root, file).split(path.sep).join("/");
        const description = meta ? String(Array.isArray(meta.description) ? meta.description.join(", ") : meta.description || "").trim() : "";
        const trimmed = body.trim();
        rules.push({
          path: file, rel, root, kind: kindOf(meta, path.extname(file).toLowerCase(), dir === ".kural/rules"),
          description, globs: meta ? globsOf(meta.globs) : [],
          body: trimmed.length > LIMITS.rule ? trimmed.slice(0, LIMITS.rule) + cutNote(LIMITS.rule) : trimmed,
        });
      }
    }
  }
  return rules;
}

// ---------- globs ----------

// A glob as a regular expression: ** (any folders), * (not /), ? (one character), {a,b}.
function globRegExp(glob) {
  const g = String(glob).trim().replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/$/, "/**");
  const braces = [...g].filter((c) => c === "{").length === [...g].filter((c) => c === "}").length;
  let re = "", depth = 0;
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") {
      if (g[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{" && braces) { re += "(?:"; depth++; }
    else if (c === "}" && braces && depth) { re += ")"; depth--; }
    else if (c === "," && braces && depth) re += "|";
    else re += c.replace(/[.+^$()|[\]\\{}]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

// Does a project-relative path match a glob? A glob without "/" matches the file's name at any depth.
function matchGlob(glob, relPath) {
  const g = String(glob || "").trim().replace(/\\/g, "/");
  if (!g) return false;
  const rel = String(relPath || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (!rel) return false;
  return globRegExp(g).test(g.includes("/") ? rel : rel.slice(rel.lastIndexOf("/") + 1));
}

// ---------- picking ----------

// The paths of a message's files (absolute, or relative to the project) as each rule's folder sees them: a path inside
// the rule's folder, relative; a relative one as written; one elsewhere not at all.
function relativeTo(root, file) {
  const f = String(file || "");
  if (!f) return null;
  if (!path.isAbsolute(f)) return f.replace(/\\/g, "/").replace(/^\.\//, "");
  const r = path.relative(root, f);
  return r && !r.startsWith("..") && !path.isAbsolute(r) ? r.split(path.sep).join("/") : null;
}
const sameFile = (rule, file) => {
  const f = String(file || "");
  if (!f) return false;
  return path.resolve(rule.root, f) === path.resolve(rule.path) || relativeTo(rule.root, f) === rule.rel;
};

// pickRules(rules, { files }) -> { always, attached, requested, manual }: attached = its globs match a file of the message,
// manual = the message mentions the rule file itself.
function pickRules(rules, { files = [] } = {}) {
  const out = { always: [], attached: [], requested: [], manual: [] };
  for (const r of rules || []) {
    if (r.kind === "always") out.always.push(r);
    else if (r.kind === "requested") out.requested.push(r);
    else if (r.kind === "attached") {
      if (files.some((f) => { const rel = relativeTo(r.root, f); return rel && r.globs.some((g) => matchGlob(g, rel)); })) out.attached.push(r);
    } else if (files.some((f) => sameFile(r, f))) out.manual.push(r);
  }
  return out;
}

// ---------- the AI's text ----------

// A rule's own text can't close Kural's tag early.
const safe = (t) => String(t).replace(/<(\s*\/?\s*)(kural_rules(?:_attached)?)/gi, "<\\$1$2");

// Rule texts one after the other until the total is used up; what doesn't fit is said, not silently dropped.
function section(list, budget) {
  let out = "", left = budget, cut = 0;
  for (const r of list) {
    if (left <= 0) { cut++; continue; }
    const text = safe(r.body);
    out += `### ${r.rel}\n${text.length > left ? text.slice(0, left) + "\n[Kural cut the rest of this rule.]" : text}\n\n`;
    left -= text.length;
  }
  return { out, cut };
}
const omitted = (n) => n ? `[Kural left out ${n} rule${n === 1 ? "" : "s"}: all rule text together is limited to ${LIMITS.all} characters.]\n` : "";

// What the AI is always told: the always rules, and a list of the others it may read.
function systemText(rules) {
  const { always, requested } = pickRules(rules);
  if (!always.length && !requested.length) return "";
  const s = section(always, LIMITS.all);
  let text = "These are this project's rules (written by its owner). Follow them.\n\n" + s.out;
  text += omitted(s.cut);
  if (requested.length) {
    text += "Rules to read when they are relevant to what you are doing (use your Read tool on the path):\n" +
      requested.map((r) => `- ${r.description.replace(/\s+/g, " ").slice(0, 300)} (${r.path})`).join("\n") + "\n";
  }
  return `<kural_rules>\n${text.trimEnd()}\n</kural_rules>`;
}

// The rules a message brings along that the AI wasn't told yet: attached ones (a file of the message matches) and manual
// ones (the message mentions the file). `alreadySent`: the rel paths given earlier in this session.
function unsent(rules, files, alreadySent = []) {
  const had = new Set(alreadySent || []);
  const p = pickRules(rules, { files });
  return [...p.attached, ...p.manual].filter((r) => !had.has(r.rel));
}

function messageText(rules, files, alreadySent = []) {
  const list = unsent(rules, files, alreadySent);
  if (!list.length) return "";
  const s = section(list, LIMITS.all);
  return `<kural_rules_attached>\nThese project rules apply to the files in this message. Follow them.\n\n${s.out}${omitted(s.cut)}`.trimEnd() +
    "\n</kural_rules_attached>\n\n";
}

module.exports = { loadRules, matchGlob, pickRules, systemText, messageText, unsent, parseFrontmatter, LIMITS, DIRS };
