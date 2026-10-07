// What went wrong last time, from what's already on the computer (no vscode here: tests run without it):
//  - markers: each Kural window writes sessions/<pid>.json while it runs and marks it clean when it closes normally. A
//    marker that isn't clean, of a process that's gone, means that window ended unexpectedly (a crash, a forced quit, the
//    computer turned off).
//  - macOS keeps a crash report for every crash (~/Library/Logs/DiagnosticReports/Kural*.ips, the helpers' too): which
//    process, what kind of crash, the crashed thread and its top frames.
//  - VS Code's own logs (<user data>/logs/<session>/): the lines that say a window, the extension host or the GPU process
//    went away, and the last errors before the end of each log (on 6 Oct 2026 they showed Kural's files disappearing
//    while it ran: the app was replaced under it).
const fs = require("fs");
const os = require("os");
const path = require("path");

const CRASH_LINE = /terminated unexpectedly|renderer process gone|process gone|has crashed|crashed\b|exited unexpectedly|GPU process (?:exited|crashed|isn't usable)|out of memory|oom\b|SIGSEGV|SIGABRT|SIGTRAP|SIGKILL|SIGBUS|Trace\/BPT trap|EXC_BAD_ACCESS|EXC_BREAKPOINT|Failed to fetch dynamically imported module|ENOENT[^\n]*\/Kural\.app\//i;
const ERROR_LINE = /\[(error|critical)\]/i;

// ---------- markers ----------
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
function writeMarker(dir, info) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${info.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(info));
  return file;
}
// Markers of windows that ended without closing normally (not this one, not one still running). Read once: they're
// removed (the report keeps what they said). Clean ones are removed too.
function endedUnexpectedly(dir, selfPid) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith(".json")); } catch { return out; }
  for (const n of names) {
    const file = path.join(dir, n);
    let m; try { m = JSON.parse(fs.readFileSync(file, "utf8")); } catch { m = null; }
    if (!m || m.pid === selfPid) continue;
    if (!m.clean && alive(m.pid)) continue;   // another window, still running
    if (!m.clean) out.push(m);
    try { fs.unlinkSync(file); } catch { /* another window took it */ }
  }
  return out.sort((a, b) => (a.seen || a.started) - (b.seen || b.started));
}

// ---------- macOS crash reports ----------
const DIAG = path.join(os.homedir(), "Library", "Logs", "DiagnosticReports");
// A .ips file: a JSON header line, then the JSON report. -> { process, version, time, exception, signal, thread, frames,
// launched, path } (null when it isn't one).
function parseIps(text) {
  const nl = String(text || "").indexOf("\n");
  if (nl < 0) return null;
  let head, body;
  try { head = JSON.parse(text.slice(0, nl)); body = JSON.parse(text.slice(nl + 1)); } catch { return null; }
  const threads = body.threads || [], images = body.usedImages || [], ft = body.faultingThread;
  const t = Number.isInteger(ft) ? threads[ft] : null;
  const frames = t ? (t.frames || []).slice(0, 8).map((f) => {
    const im = Number.isInteger(f.imageIndex) ? images[f.imageIndex] || {} : {};
    return `${im.name || "?"}${f.symbol ? `  ${f.symbol}` : ""}`;
  }) : [];
  const ex = body.exception || {};
  return { process: head.app_name || body.procName || "", version: head.app_version || "", time: head.timestamp || body.captureTime || "",
    exception: ex.type || "", signal: ex.signal || "", thread: t ? t.name || t.queue || `thread ${ft}` : "", frames,
    launched: body.procLaunch || "", path: body.procPath || "", termination: body.termination && body.termination.indicator || "" };
}
// Kural's crash reports newer than `since` (ms): [{ file, at, info }].
function crashReports(since, dir = DIAG) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => /^Kural(?: Helper[^-]*)?-.*\.ips$/.test(n)); } catch { return []; }
  const out = [];
  for (const n of names) {
    const file = path.join(dir, n);
    let st; try { st = fs.statSync(file); } catch { continue; }
    if (st.mtimeMs <= since) continue;
    let info = null; try { info = parseIps(fs.readFileSync(file, "utf8")); } catch { /* not readable */ }
    if (info) out.push({ file, at: st.mtimeMs, info });
  }
  return out.sort((a, b) => a.at - b.at);
}

// ---------- VS Code's logs ----------
// Session folders are named by start time (20261006T064923). Those that started after `since` and before this one.
function sessionsSince(logsDir, since, now = Date.now()) {
  let names = [];
  try { names = fs.readdirSync(logsDir).filter((n) => /^\d{8}T\d{6}$/.test(n)); } catch { return []; }
  const at = (n) => new Date(`${n.slice(0, 4)}-${n.slice(4, 6)}-${n.slice(6, 8)}T${n.slice(9, 11)}:${n.slice(11, 13)}:${n.slice(13, 15)}`).getTime();
  return names.map((n) => ({ name: n, at: at(n), dir: path.join(logsDir, n) })).filter((s) => s.at > since - 6 * 3600000 && s.at < now).sort((a, b) => a.at - b.at);
}
function logFiles(dir) {
  const out = [];
  const walk = (d, depth) => {
    let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (e.isFile() && /^(main|renderer|exthost|sharedprocess|ptyhost)\.log$/.test(e.name)) out.push(p);
    }
  };
  walk(dir, 0);
  return out;
}
// The crash lines of a session's logs, and the last errors of each log: { crashes: [line], lastErrors: { file: [line] } }.
function scanSession(dir, maxBytes = 2 * 1024 * 1024) {
  const crashes = [], lastErrors = {};
  for (const file of logFiles(dir)) {
    let text = "";
    try {
      const st = fs.statSync(file), fd = fs.openSync(file, "r"), len = Math.min(st.size, maxBytes), buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd); text = buf.toString("utf8");
    } catch { continue; }
    const lines = text.split("\n");
    const rel = path.relative(dir, file);
    for (const l of lines) if (CRASH_LINE.test(l)) crashes.push(`${rel}: ${l.slice(0, 400)}`);
    const errs = lines.filter((l) => ERROR_LINE.test(l)).slice(-6).map((l) => l.slice(0, 400));
    if (errs.length) lastErrors[rel] = errs;
  }
  return { crashes: [...new Set(crashes)].slice(-40), lastErrors };
}

// ---------- the report ----------
function report({ markers = [], ips = [], sessions = [], version = "", platform = process.platform }) {
  const when = (t) => t ? new Date(t).toLocaleString() : "unknown";
  const parts = [`# Kural crash report`, "", `Kural ${version} on ${platform} ${os.release()} (${process.arch}), written ${new Date().toLocaleString()}.`, ""];
  if (markers.length) {
    parts.push("## Windows that ended unexpectedly", "");
    for (const m of markers) parts.push(`- Kural ${m.version || "?"} window started ${when(m.started)}, last seen running ${when(m.seen)}${m.folder ? ` (${m.folder})` : ""}`);
    parts.push("");
  }
  if (ips.length) {
    parts.push("## Crash reports from macOS", "");
    for (const r of ips) {
      const i = r.info;
      parts.push(`### ${i.process} ${i.version} — ${i.time}`, "", `- ${i.exception}${i.signal ? ` (${i.signal})` : ""}${i.termination ? `, ${i.termination}` : ""}`,
        `- crashed thread: ${i.thread || "?"}; process started ${i.launched || "?"}`, `- file: ${r.file}`, "", "```", ...i.frames, "```", "");
    }
  }
  for (const s of sessions) {
    if (!s.scan.crashes.length && !Object.keys(s.scan.lastErrors).length) continue;
    parts.push(`## VS Code's logs of the session started ${when(s.at)}`, "", `(${s.dir})`, "");
    if (s.scan.crashes.length) parts.push("What went wrong:", "", "```", ...s.scan.crashes, "```", "");
    const errs = Object.entries(s.scan.lastErrors);
    if (errs.length) { parts.push("The last errors in each log:", ""); for (const [f, ls] of errs) parts.push(`${f}:`, "```", ...ls, "```", ""); }
  }
  if (ips.some((r) => r.info.exception === "EXC_BREAKPOINT") && sessions.some((s) => s.scan.crashes.some((l) => /ENOENT[^\n]*Kural\.app|Failed to fetch dynamically imported module/.test(l))))
    parts.push("## Likely cause", "", "Kural's own files went missing while it was running (the app was replaced or deleted under it, e.g. by an install while Kural was still open), and then it crashed.", "");
  return parts.join("\n");
}

module.exports = { writeMarker, endedUnexpectedly, parseIps, crashReports, sessionsSince, scanSession, report, CRASH_LINE, DIAG, alive };
