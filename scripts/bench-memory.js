#!/usr/bin/env node
// How much memory and CPU Kural uses, per part: every process of a running Kural (the app and everything it started),
// grouped (the window, the extension host, each Claude Code process by what it's for, language servers, terminals...),
// plus Ollama and the models it has loaded. Read-only: it only looks (ps, top, Ollama's /api/ps), changes nothing.
//
//   node scripts/bench-memory.js                    every Kural running on this computer
//   node scripts/bench-memory.js --app /tmp/kt      only the Kural whose program path contains this
//   options: --interval 3 (seconds the CPU use is measured over), --json, --list (every process), --no-ollama
//
// Memory: on a Mac, what Activity Monitor shows ("footprint", from top); elsewhere the resident size (RSS). CPU: % of one
// core over the interval (100 = one core busy). macOS and Linux; Windows through PowerShell (not tried yet).
// No dependencies. docs/benchmarks/memory-2026-10-08.md has measurements and what they mean.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : d; };
const has = (name) => args.includes(`--${name}`);
const INTERVAL = Math.max(1, Number(opt("interval", 3)));
const APP = opt("app", "");
const run = (cmd, a, timeout = 30000) => execFileSync(cmd, a, { encoding: "utf8", maxBuffer: 64 << 20, timeout });
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

// ---------- the processes: [{ pid, ppid, mem (bytes), cpu (%), cmd }] ----------
const secs = (t) => { // ps TIME: [[dd-]hh:]mm:ss(.cc)
  const [d, rest] = t.includes("-") ? t.split("-") : [0, t];
  return Number(d) * 86400 + rest.split(":").reduce((s, x) => s * 60 + Number(x), 0);
};
function psList() {
  const out = run("ps", ["-axww", "-o", "pid=,ppid=,rss=,time=,command="]);
  return out.split("\n").filter((l) => l.trim()).map((l) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l);
    return m && { pid: +m[1], ppid: +m[2], rss: +m[3] * 1024, time: secs(m[4]), cmd: m[5] };
  }).filter(Boolean);
}
// macOS: top's MEM (the footprint, as Activity Monitor shows it) and CPU over the interval.
function topMac() {
  const out = run("top", ["-l", "2", "-s", String(INTERVAL), "-stats", "pid,mem,cpu"], (INTERVAL + 30) * 1000);
  const second = out.split(/^PID\s+MEM\s+%CPU\s*$/m).pop();
  const unit = { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 };
  const map = new Map();
  for (const l of second.split("\n")) {
    const m = /^\s*(\d+)\s+([\d.]+)([BKMG])[+-]?\s+([\d.]+)/.exec(l);
    if (m) map.set(+m[1], { mem: Number(m[2]) * unit[m[3]], cpu: Number(m[4]) });
  }
  return map;
}
async function processes() {
  if (process.platform === "win32") {
    const ps = () => JSON.parse(run("powershell.exe", ["-NoProfile", "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,KernelModeTime,UserModeTime,CommandLine | ConvertTo-Json -Compress"]));
    const a = ps(); await sleep(INTERVAL); const b = ps();
    const before = new Map(a.map((p) => [p.ProcessId, (p.KernelModeTime + p.UserModeTime) / 1e7]));
    return b.map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, mem: p.WorkingSetSize, cmd: p.CommandLine || "",
      cpu: before.has(p.ProcessId) ? Math.max(0, 100 * ((p.KernelModeTime + p.UserModeTime) / 1e7 - before.get(p.ProcessId)) / INTERVAL) : 0 }));
  }
  if (process.platform === "darwin") {
    const top = topMac(), list = psList();
    return list.map((p) => ({ ...p, mem: top.has(p.pid) ? top.get(p.pid).mem : p.rss, cpu: top.has(p.pid) ? top.get(p.pid).cpu : 0 }));
  }
  const a = psList(); await sleep(INTERVAL); const b = psList();
  const before = new Map(a.map((p) => [p.pid, p.time]));
  return b.map((p) => ({ ...p, mem: p.rss, cpu: before.has(p.pid) ? Math.max(0, 100 * (p.time - before.get(p.pid)) / INTERVAL) : 0 }));
}

// ---------- what each one is ----------
// The program itself (its path can have spaces: "…/Kural Helper (Renderer).app/Contents/MacOS/Kural Helper (Renderer)";
// a Mac app's program has the app's name).
function argv0(cmd) {
  const app = /^(.*?\/([^/]+)\.app\/Contents\/MacOS\/\2)(?=\s|$)/.exec(cmd);
  if (app) return app[1];
  const exe = /^(.*?\.exe)(?=\s|"|$)/i.exec(cmd.replace(/^"/, ""));
  return exe ? exe[1] : cmd.split(/\s+/)[0];
}
const isMain = (p) => !/--type=/.test(p.cmd) && /(Kural\.app\/Contents\/MacOS\/Kural|[\\/]kural|[\\/]Kural\.exe)$/i.test(argv0(p.cmd));
const isClaude = (cmd) => /(^|[\\/])claude(\.exe)?(\s|$)|[\\/]claude[\\/]versions[\\/]/i.test(cmd.split(/\s-/)[0]) || /claude-wrap\.js/.test(cmd);
// The system prompt a Claude Code process was started with tells what it's for (the files are in the temp folder).
const ROLES = [
  [/You are the autocomplete engine of a code editor/, "Claude: Tab Completion (editor)"],
  [/You are the autocomplete of a terminal/, "Claude: terminal Tab, commit lines"],
  [/You turn what the user wrote in plain words/, "Claude: terminal plain words"],
  [/You are the code-editing engine inside the Kural/, "Claude: Ctrl+K, Apply"],
  [/You write git commit messages/, "Claude: Source Control commit message"],
  [/You locate code for the user inside the Kural/, "Claude: Search & Ask"],
  [/You look up Jira issues/, "Claude: Jira tickets"],
];
function claudeRole(cmd) {
  const f = /--(?:append-)?system-prompt-file (.+?\.md)(?=\s|$)/.exec(cmd);
  if (f) {
    let head = "";
    try { const fd = fs.openSync(f[1], "r"), b = Buffer.alloc(200); fs.readSync(fd, b, 0, 200, 0); fs.closeSync(fd); head = b.toString(); } catch { /* gone */ }
    for (const [re, role] of ROLES) if (re.test(head)) return role;
  }
  // (The chat's processes show thinking and take messages while answering; Ask and Jira ask permission too, so that's no sign.)
  if (/--replay-user-messages|--thinking-display|--forward-subagent-text/.test(cmd)) return "Claude: chats";
  return "Claude: other helpers";
}
function groupOf(p, byPid) {
  const c = p.cmd, exe = argv0(c);
  if (isClaude(c)) return claudeRole(c);
  if (/\bcodex\b.*\bapp-server\b/.test(c)) return "Codex (ChatGPT)";
  if (/(^|[\\/])agy(\.exe)?(\s|$)/.test(c.split(/\s-/)[0])) return "Google Gemini (agy)";
  for (let a = byPid.get(p.ppid), n = 0; a && n < 50; a = byPid.get(a.ppid), n++) {
    if (isClaude(a.cmd)) return "started by Claude Code (MCP servers, commands)";
    if (/Helper$/.test(argv0(a.cmd)) && /node\.mojom\.NodeService/.test(a.cmd)) return "terminals (shells, what runs in them)";
  }
  if (isMain(p)) return "Electron main";
  if (/--type=gpu-process/.test(c)) return "GPU";
  if (/--type=renderer/.test(c)) return "renderers (window, webviews)";
  if (/network\.mojom\.NetworkService/.test(c)) return "network service";
  if (/Helper \(Plugin\)|--type=utility/.test(exe + " " + (c.match(/--type=\S+/) || [""])[0])) {
    if (/--type=utility/.test(c) && /Plugin/.test(exe)) return "extension host";
    if (/node\.mojom\.NodeService/.test(c)) return "shared process, terminal host, file watcher";
  }
  if (/[\\/]extensions[\\/]kural[\\/]/.test(c)) return "Kural helpers (agent board, devices)";
  if (/tsserver|typingsInstaller|ServerMain|languageserver|language-server|eslintServer|serverWorkerMain/i.test(c)) return "language servers";
  const parent = byPid.get(p.ppid);
  if (parent && /--type=utility/.test(parent.cmd) && /Plugin/.test(argv0(parent.cmd))) return "extension host's other children (git, ripgrep...)";
  return "other";
}
const ORDER = ["Electron main", "renderers (window, webviews)", "GPU", "network service", "extension host",
  "shared process, terminal host, file watcher", "language servers", "Kural helpers (agent board, devices)", "Claude: chats",
  "started by Claude Code (MCP servers, commands)", "Claude: Tab Completion (editor)", "Claude: terminal Tab, commit lines",
  "Claude: terminal plain words", "Claude: Ctrl+K, Apply", "Claude: Source Control commit message", "Claude: Search & Ask",
  "Claude: Jira tickets", "Claude: other helpers", "Codex (ChatGPT)", "Google Gemini (agy)", "terminals (shells, what runs in them)",
  "extension host's other children (git, ripgrep...)", "other"];

// ---------- Ollama (its own app, not started by Kural; shared by every Kural window) ----------
async function ollama(all) {
  const out = { processes: [], models: [] };
  for (const p of all) {
    const exe = p.cmd.split(/\s-/)[0];
    if (/(^|[\\/])ollama(\.exe)?\s+serve\b|Ollama\.app\/Contents\/Resources\/ollama serve/.test(p.cmd)) out.processes.push({ ...p, group: "Ollama server" });
    else if (/llama-server|ollama(\.exe)?\s+runner/.test(exe + " " + p.cmd.slice(exe.length, exe.length + 20))) out.processes.push({ ...p, group: "Ollama model runners" });
  }
  try {
    const url = (process.env.OLLAMA_HOST ? `http://${process.env.OLLAMA_HOST.replace(/^https?:\/\//, "")}` : "http://127.0.0.1:11434") + "/api/ps";
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    out.models = ((await r.json()).models || []).map((m) => ({ name: m.name, size: m.size, vram: m.size_vram, context: m.context_length, until: m.expires_at }));
  } catch { out.models = null; }
  return out;
}

// ---------- report ----------
const MB = (b) => Math.round(b / 1048576);
const fmt = (n) => n.toLocaleString("en-US");
function table(rows) {
  const lines = ["| Group | Count | Memory (MB) | CPU % |", "|---|---:|---:|---:|"];
  for (const r of rows) lines.push(`| ${r.group} | ${r.count} | ${fmt(MB(r.mem))} | ${r.cpu.toFixed(1)} |`);
  return lines.join("\n");
}
function sum(list, group) {
  const by = new Map();
  for (const p of list) { const g = by.get(p.group) || { group: p.group, count: 0, mem: 0, cpu: 0 }; g.count++; g.mem += p.mem; g.cpu += p.cpu; by.set(p.group, g); }
  return [...by.values()].sort((a, b) => (ORDER.indexOf(a.group) + 1 || 99) - (ORDER.indexOf(b.group) + 1 || 99) || b.mem - a.mem);
}

async function main() {
  const all = await processes();
  const byPid = new Map(all.map((p) => [p.pid, p]));
  const kids = new Map();
  for (const p of all) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  const mains = all.filter((p) => isMain(p) && (!APP || p.cmd.includes(APP)));
  const report = { at: new Date().toISOString(), platform: `${process.platform} ${os.release()}`, memory: process.platform === "darwin" ? "footprint" : "rss",
    interval: INTERVAL, totalMemory: os.totalmem(), kurals: [], ollama: null };
  for (const main of mains) {
    const tree = [];
    const walk = (p, depth) => { tree.push({ ...p, depth }); for (const k of kids.get(p.pid) || []) walk(k, depth + 1); };
    walk(main, 0);
    for (const p of tree) p.group = groupOf(p, byPid);
    const groups = sum(tree);
    const total = { group: "**Total**", count: tree.length, mem: tree.reduce((s, p) => s + p.mem, 0), cpu: tree.reduce((s, p) => s + p.cpu, 0) };
    const dataDir = (/--user-data-dir[= ](\S+)/.exec(main.cmd) || [])[1] || "(default profile)";
    report.kurals.push({ pid: main.pid, program: argv0(main.cmd), dataDir, groups, total, processes: tree.map(({ pid, ppid, mem, cpu, group, cmd, depth }) => ({ pid, ppid, mem, cpu, group, depth, cmd: cmd.slice(0, 300) })) });
  }
  if (!has("no-ollama")) report.ollama = await ollama(all);
  if (has("json")) { console.log(JSON.stringify(report, null, 1)); return; }

  console.log(`${new Date().toLocaleString()} · ${report.platform} · ${fmt(MB(report.totalMemory))} MB of memory · CPU over ${INTERVAL} s · memory = ${report.memory}`);
  if (!report.kurals.length) console.log(`\nNo Kural running${APP ? ` matching "${APP}"` : ""}.`);
  for (const k of report.kurals) {
    console.log(`\nKural pid ${k.pid} · ${k.program} · ${k.dataDir}\n`);
    console.log(table([...k.groups, k.total]));
    if (has("list")) {
      console.log("");
      for (const p of k.processes) console.log(`${"  ".repeat(p.depth)}${p.pid} ${fmt(MB(p.mem))} MB ${p.cpu.toFixed(1)}% [${p.group}] ${p.cmd.slice(0, 140)}`);
    }
  }
  if (report.ollama) {
    const o = report.ollama;
    console.log("\nOllama (its own app; shared by every Kural window and other apps)\n");
    if (o.processes.length) console.log(table(sum(o.processes)));
    else console.log("(no Ollama processes)");
    if (o.models === null) console.log("\nOllama isn't answering (not running?).");
    else if (!o.models.length) console.log("\nNo models loaded.");
    else {
      console.log("\n| Loaded model | Memory (MB) | On the GPU (MB) | Context | Unloads at |\n|---|---:|---:|---:|---|");
      for (const m of o.models) console.log(`| ${m.name} | ${fmt(MB(m.size))} | ${fmt(MB(m.vram))} | ${m.context || ""} | ${(m.until || "").slice(11, 19)} |`);
    }
  }
}

if (require.main === module) main().catch((e) => { console.error(`bench-memory: ${e.message}`); process.exit(1); });
module.exports = { groupOf, claudeRole, isMain, argv0 };   // (test/bench-memory.test.js)
