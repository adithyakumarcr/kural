// Commands that Auto mode (and "Allow all") must still ask about. No vscode here (test/danger.test.js).
//
// This is a seat belt, not a sandbox: it reads the command as text and knows a list of things that are hard or
// impossible to undo. A determined model (or a prompt-injected page) can get around it (a script file that does the same
// thing, `python3 -c "shutil.rmtree(…)"`, a variable holding "sudo"…). What it does catch is the ordinary, careless version
// of those, and the usual disguises: `curl … | python3`, `cd / && rm -rf usr`, `$(echo sudo)`, `eval 'su''do …'`, an
// encoded PowerShell command.
// Text inside quotes is not a command: `echo "rm -rf /"` is fine, but `bash -c "rm -rf /"` and `git commit -m "sudo"`
// are looked at (the first because it runs; the second is a false alarm we accept: asking is cheap).

const path = require("path");
const os = require("os");

// Split on ; && || | & and newlines that are not inside quotes. Each part keeps the separator before it.
function split(cmd) {
  const parts = [];
  let cur = "", quote = null, sep = "";
  const push = (nextSep) => { if (cur.trim()) parts.push({ text: cur.trim(), sep }); cur = ""; sep = nextSep; };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) { cur += c; if (c === quote && cmd[i - 1] !== "\\") quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    if (c === "\\") { cur += c + (cmd[i + 1] || ""); i++; continue; }
    if (c === "|" && cmd[i + 1] === "|") { push("||"); i++; }
    else if (c === "&" && cmd[i + 1] === "&") { push("&&"); i++; }
    else if (c === "|") push("|");
    else if (c === ";" || c === "\n" || c === "&") push(c);
    else cur += c;
  }
  push("");
  return parts;
}

// Words of one command, quotes removed. escapes: a backslash escapes the next character (sh); off for Windows commands,
// where it separates folders (C:\Users).
function words(text, escapes = true) {
  const out = [];
  let cur = "", quote = null, has = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = null; else cur += c; continue; }
    if (c === "'" || c === '"') { quote = c; has = true; continue; }
    if (escapes && c === "\\" && i + 1 < text.length) { cur += text[++i]; has = true; continue; }
    if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ""; has = false; continue; }
    cur += c; has = true;
  }
  if (cur || has) out.push(cur);
  return out;
}

const WRAPPERS = new Set(["env", "command", "time", "nice", "nohup", "exec", "builtin", "stdbuf"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const HOME = /^(~|\$home|\$\{home\})(\/|$)/i;
const PROTECTED = [/^(~|\$home|\$\{home\})\/\.ssh(\/|$)/i, /^\/etc(\/|$)/, /^\/usr(\/|$)/, /^\/system(\/|$)/i, /^[a-z]:\\windows(\\|$)/i,
  // Gemini's (Antigravity's) hooks and settings and Kural's gate launcher: changing them can switch off Kural's approval gate.
  /(^|[\\/])\.gemini([\\/]|$)/i, /(^|[\\/])\.kural[\\/]agy-gate([\\/]|$)/i, /(^|[\\/])\.agents[\\/]hooks\.json$/i,
  // Shell start-up files: whatever is written there runs in every new terminal.
  /(^|[\\/])\.(bashrc|bash_profile|bash_login|profile|zshrc|zshenv|zprofile|zlogin)$/i, /(^|[\\/])\.config[\\/]fish([\\/]|$)/i];
// Programs that run a script read from their input (`curl … | python3`), when no script file is named.
const INTERPRETERS = new Set(["python", "python2", "python3", "node", "nodejs", "perl", "ruby", "php", "deno", "bun"]);
const ADMIN = new Set(["sudo", "pkexec", "doas"]);
const WRITERS = new Set(["cp", "mv", "rm", "ln", "tee", "touch", "mkdir", "rmdir", "install", "chmod", "chown", "dd", "truncate", "rsync", "scp", "ssh-keygen", "ssh-keyscan", "sed", "perl", "python", "python3", "node", "curl", "wget"]);

// Where a path in a command really points (relative ones from `cwd`); null when it can't be known ($VAR, `cmd`).
function target(p, cwd) {
  if (/[$`]/.test(p) && !HOME.test(p)) return null;
  if (HOME.test(p)) p = path.join(os.homedir(), p.replace(HOME, ""));
  return path.resolve(cwd, p.replace(/[*?[].*$/, ""));
}

// Deleting `a` (a path in the command, relative to `dir`, the folder the command runs in after any `cd`): why it should
// ask (outside the project `cwd`, the whole project, or can't tell), else null. dir null: an earlier `cd` went somewhere
// Kural can't tell.
function deleteWhy(a, dir, cwd, what) {
  const t = dir === null && !path.isAbsolute(a) && !HOME.test(a) ? null : target(a, dir || cwd);
  if (t === null) return `${what} on "${a}" (can't tell which folder that is)`;
  const inside = t !== cwd && !path.relative(cwd, t).startsWith("..") && !path.isAbsolute(path.relative(cwd, t));
  if (!inside) return t === cwd ? "this deletes the whole project folder" : `this deletes ${t}, outside the project`;
  return null;
}

function rmWhy(args, dir, cwd) {
  const flags = args.filter((a) => /^-/.test(a));
  const recursive = flags.some((f) => /^--recursive$/.test(f) || (/^-[a-zA-Z]+$/.test(f) && /[rR]/.test(f)));
  if (!recursive) return null;
  for (const a of args.filter((x) => !/^-/.test(x))) { const why = deleteWhy(a, dir, cwd, "rm -r"); if (why) return why; }
  return null;
}

// find … -delete (or -exec rm): its start folders (before the first test like -name) must be inside the project.
function findWhy(args, dir, cwd) {
  const deletes = args.includes("-delete") || args.some((a, i) => (a === "-exec" || a === "-execdir") && /(^|\/)rm$/.test(args[i + 1] || ""));
  if (!deletes) return null;
  const starts = [];
  for (const a of args) { if (/^[-(!]/.test(a)) break; starts.push(a); }
  for (const a of starts.length ? starts : ["."]) {
    // (Matching files anywhere in the project is what find -delete is for: only outside it asks.)
    if (dir !== null && target(a, dir || cwd) === cwd) continue;
    const why = deleteWhy(a, dir, cwd, "find -delete");
    if (why) return why;
  }
  return null;
}

// A Windows path (C:\x, \\server, %VAR%, $env:X, .\x, x\y) outside the project? PowerShell and cmd's deletes.
// Trailing slashes off, without a regex: /\/+$/ takes quadratic time on a long run of "/" (CodeQL).
function trimSlashes(s) {
  let e = s.length;
  while (e > 0 && s[e - 1] === "/") e--;
  return s.slice(0, e);
}

function winOutside(a, dir, cwd) {
  if (/^[$%]/.test(a)) return `"${a}" (a variable: can't tell what it deletes)`;
  const norm = (p) => trimSlashes(String(p).replace(/\\/g, "/")).toLowerCase();
  const root = norm(cwd);
  let t;
  if (/^([a-z]:|[\\/]|~)/i.test(a)) t = norm(a.replace(/^~/, os.homedir()));
  else if (dir === null) return `"${a}" (can't tell which folder that is)`;
  else t = trimSlashes(path.posix.normalize(norm(dir || cwd) + "/" + norm(a)));
  return t.startsWith(root + "/") && !t.slice(root.length).split("/").includes("..") ? null
    : t === root ? "the whole project folder" : `${a}, outside the project`;
}

// PowerShell's and cmd's own ways to run hidden code, delete folder trees, or format a disk.
const WIN_RM = new Set(["remove-item", "ri", "rd", "rmdir", "del", "erase", "rm"]);
function windowsWhy(cmd, raw, dir, cwd, depth) {
  const c = cmd.replace(/\.exe$/, "");
  if (["powershell", "pwsh"].includes(c)) {
    // -EncodedCommand (PowerShell takes any prefix down to -e / -ec / -en): what runs can't be read here.
    if (raw.some((a) => /^[-/]e(c|n(c(o(d(e(d(c(o(m(m(a(nd?)?)?)?)?)?)?)?)?)?)?)?)?$/i.test(a))) return "it runs an encoded (hidden) PowerShell command";
    const i = raw.findIndex((a) => /^[-/]c(o(m(m(a(nd?)?)?)?)?)?$/i.test(a));
    if (i >= 0 && raw[i + 1] && depth < 3) return check(raw.slice(i + 1).join(" "), cwd, depth + 1, dir);
  }
  if (c === "cmd") {
    const i = raw.findIndex((a) => /^\/[ck]$/i.test(a));
    if (i >= 0 && raw[i + 1] && depth < 3) return check(raw.slice(i + 1).join(" "), cwd, depth + 1, dir);
  }
  if (WIN_RM.has(c) && raw.some((a) => /^-rec(u(r(se?)?)?)?$/i.test(a) || /^\/s$/i.test(a))) {
    const targets = raw.filter((a, i) => !/^-/.test(a) && !/^\/[a-z?]$/i.test(a) && !/^-(include|exclude|filter)$/i.test(raw[i - 1] || ""));
    for (const a of targets) { const why = winOutside(a, dir, cwd); if (why) return `it deletes ${why}`; }
  }
  if (/^(format-volume|format-disk|clear-disk|initialize-disk)$/.test(c) || (c === "format" && raw.some((a) => /^[a-z]:$/i.test(a)))) return "it formats a disk";
  if (c === "set-executionpolicy" && raw.some((a) => /^(unrestricted|bypass)$/i.test(a))) return "it turns off PowerShell's script protection";
  if (["iex", "invoke-expression"].includes(c) && /\b(iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring|downloadfile|curl|wget|net\.webclient)\b/i.test(raw.join(" ")))
    return "it runs a script straight from the internet";
  return null;
}

// Writing into system folders or ~/.ssh: a redirect to it, or a command that writes.
function protectedWrite(cmd, args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    // (`> file`, `>file`, `x>>file`, `2>file`.)
    const at = a.lastIndexOf(">");
    const redirected = at >= 0 ? a.slice(at + 1) || args[i + 1] || "" : (args[i - 1] === ">" || args[i - 1] === ">>") ? a : "";
    const arg = redirected || (WRITERS.has(cmd) ? a : "");
    if (arg && PROTECTED.some((re) => re.test(arg))) return `it changes ${arg}, a folder the system or your login depends on`;
  }
  return null;
}

// cwd: the project folder (what "outside" means). dir: the folder the command starts in (a `cd` earlier on the line moves
// it; null: Kural can't tell where it went).
function check(text, cwd, depth, dir = cwd) {
  const parts = split(text.replace(/\s+/g, " "));
  const firstWords = [];
  for (const p of parts) {
    // Command substitutions run first, wherever they are (even in `echo $(…)`): look inside them too.
    if (depth < 3) for (const m of p.text.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) {
      const inner = check(m[1] || m[2] || "", cwd, depth + 1, dir); if (inner) return inner;
    }
    let w = words(p.text);
    let skip = 0;
    while (skip < w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[skip]) || WRAPPERS.has(w[skip]))) skip++;
    w = w.slice(skip);
    const cmd = (w[0] || "").replace(/^.*\//, "").toLowerCase();
    const args = w.slice(1);
    firstWords.push({ cmd, args, sep: p.sep });
    if (cmd === "echo" || cmd === "printf") {   // its words are text, but `echo x > /etc/hosts` still writes
      const why = protectedWrite(cmd, args);
      if (why) return why;
      continue;
    }
    if (ADMIN.has(cmd) || w.some((x, i) => i > 0 && ADMIN.has(x))) return "it runs with administrator rights (sudo)";
    // sudo spelled so a plain look misses it: `$(echo sudo) id`, `eval 'su''do id'`.
    if (/\$\(|`/.test(p.text) && w.join(" ").split(/[\s$()`{}"';]+/).some((x) => ADMIN.has(x))) return "it runs with administrator rights (sudo)";
    if (cmd === "eval" && depth < 3) { const inner = check(args.join(" "), cwd, depth + 1, dir); if (inner) return inner; }
    if (SHELLS.has(cmd) && depth < 3) {
      const i = args.indexOf("-c");
      if (i >= 0 && args[i + 1]) { const inner = check(args[i + 1], cwd, depth + 1, dir); if (inner) return inner; }
    }
    if (cmd === "cd" || cmd === "pushd") {
      const to = args.find((a) => !/^-[LPe@]$/.test(a));
      dir = dir === null || to === "-" ? null : !to ? os.homedir() : target(to, dir);
      continue;
    }
    if (cmd === "rm") { const why = rmWhy(args, dir, cwd); if (why) return why; }
    if (cmd === "find") { const why = findWhy(args, dir, cwd); if (why) return why; }
    { const why = windowsWhy(cmd, words(p.text, false).slice(skip + 1), dir, cwd, depth); if (why) return why; }
    if (cmd === "chmod" && args.some((a) => /^-[a-zA-Z]*R/.test(a)) && args.includes("777")) return "chmod -R 777 makes every file open to everyone";
    if (cmd === "chown" && args.some((a) => /^-[a-zA-Z]*R/.test(a) || a === "--recursive")) return "chown -R changes the owner of a whole folder tree";
    if (cmd === "git") {
      let at = 0;   // (skip git's own options, some with a value: git -C dir reset --hard)
      while (at < args.length && args[at].startsWith("-")) at += ["-C", "-c", "--git-dir", "--work-tree"].includes(args[at]) ? 2 : 1;
      const sub = args[at];
      const rest = args.slice(at + 1);
      if (sub === "reset" && rest.includes("--hard")) return "git reset --hard throws away your uncommitted changes";
      if (sub === "clean" && rest.some((a) => /^-[a-zA-Z]*f/.test(a) || a === "--force")) return "git clean deletes files git doesn't track, for good";
      if (sub === "push") {
        const refs = rest.filter((a) => !a.startsWith("-"));
        if (rest.some((a) => a === "-f" || a === "--force" || a === "--force-with-lease" || /^-[a-zA-Z]*f/.test(a) && !a.startsWith("--") || /^\+/.test(a)) &&
          (refs.length < 2 || refs.some((a) => /(^|[:+/])(main|master)$/.test(a)))) return "a forced push can overwrite main for everyone";
        if (rest.includes("--mirror")) return "git push --mirror overwrites and deletes branches on the server";
        // `git push origin :main`, `git push origin --delete main`: deleting main (or master) on the server.
        const deleting = rest.some((a) => a === "--delete" || a === "-d");
        if (refs.some((a, i) => /^:(refs\/heads\/)?(main|master)$/.test(a) || (deleting && i > 0 && /^(refs\/heads\/)?(main|master)$/.test(a))))
          return "it deletes main on the server";
      }
    }
    if (cmd === "dd" && args.some((a) => /^if=/.test(a))) return "dd can overwrite a disk";
    if (/^mkfs(\.|$)/.test(cmd)) return "mkfs formats a disk";
    if (["shutdown", "reboot", "poweroff", "halt"].includes(cmd)) return "it shuts the computer down";
    const why = protectedWrite(cmd, args);
    if (why) return why;
  }
  // Something downloaded, piped into a shell, sudo, PowerShell, or a language that runs what it reads (python3, node…):
  // it runs whatever the server sends. (`| python3 -m json.tool` or `| node parse.js` names its own program: fine.)
  for (let i = 1; i < firstWords.length; i++) {
    const to = firstWords[i], from = firstWords[i - 1];
    if (to.sep !== "|" || !["curl", "wget", "iwr", "irm", "invoke-webrequest", "invoke-restmethod"].includes(from.cmd)) continue;
    const reads = INTERPRETERS.has(to.cmd) || INTERPRETERS.has(to.cmd.replace(/[\d.]+$/, ""));
    const script = to.args.find((a) => !/^-/.test(a) || a === "-");
    if (SHELLS.has(to.cmd) || ADMIN.has(to.cmd) || ["iex", "invoke-expression", "powershell", "pwsh"].includes(to.cmd) ||
      (reads && (script === undefined || script === "-") && !to.args.some((a) => /^-[mce]$/.test(a))))
      return "it runs a script straight from the internet";
  }
  if (/\b(sh|bash|zsh|dash)\s+(-[a-z]+\s+)*["']?\$\(\s*(curl|wget)\b/i.test(text) || /<\(\s*(curl|wget)\b/i.test(text)) return "it runs a script straight from the internet";
  if (/:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(text)) return "this is a fork bomb";
  return null;
}

// → { why } when the command should always ask, else null. `cwd`: the project folder (what "outside" means).
function dangerous(command, cwd = process.cwd()) {
  const why = check(String(command || ""), path.resolve(cwd), 0);
  return why ? { why: why.charAt(0).toUpperCase() + why.slice(1) + "." } : null;
}

module.exports = { dangerous };
