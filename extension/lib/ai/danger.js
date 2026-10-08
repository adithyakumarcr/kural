// Commands that Auto mode (and "Allow all") must still ask about. No vscode here (test/danger.test.js).
//
// This is a seat belt, not a sandbox: it reads the command as text and knows a list of things that are hard or
// impossible to undo. A determined model (or a prompt-injected page) can get around it (a script that does the same
// thing, an encoded command, `find -delete`…). What it does catch is the ordinary, careless version of those.
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

// Words of one command, quotes removed.
function words(text) {
  const out = [];
  let cur = "", quote = null, has = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = null; else cur += c; continue; }
    if (c === "'" || c === '"') { quote = c; has = true; continue; }
    if (c === "\\" && i + 1 < text.length) { cur += text[++i]; has = true; continue; }
    if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ""; has = false; continue; }
    cur += c; has = true;
  }
  if (cur || has) out.push(cur);
  return out;
}

const WRAPPERS = new Set(["env", "command", "time", "nice", "nohup", "exec", "builtin", "stdbuf"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const HOME = /^(~|\$home|\$\{home\})(\/|$)/i;
const PROTECTED = [/^(~|\$home|\$\{home\})\/\.ssh(\/|$)/i, /^\/etc(\/|$)/, /^\/usr(\/|$)/, /^\/system(\/|$)/i, /^[a-z]:\\windows(\\|$)/i];
const WRITERS = new Set(["cp", "mv", "rm", "ln", "tee", "touch", "mkdir", "rmdir", "install", "chmod", "chown", "dd", "truncate", "rsync", "scp", "ssh-keygen", "ssh-keyscan", "sed", "perl", "python", "python3", "node", "curl", "wget"]);

// Where a path in a command really points (relative ones from `cwd`); null when it can't be known ($VAR, `cmd`).
function target(p, cwd) {
  if (/[$`]/.test(p) && !HOME.test(p)) return null;
  if (HOME.test(p)) p = path.join(os.homedir(), p.replace(HOME, ""));
  return path.resolve(cwd, p.replace(/[*?[].*$/, ""));
}

function rmWhy(args, cwd) {
  const flags = args.filter((a) => /^-/.test(a));
  const recursive = flags.some((f) => /^--recursive$/.test(f) || (/^-[a-zA-Z]+$/.test(f) && /[rR]/.test(f)));
  if (!recursive) return null;
  for (const a of args.filter((x) => !/^-/.test(x))) {
    const t = target(a, cwd);
    if (t === null) return `rm -r on "${a}" (a variable: can't tell what it deletes)`;
    const inside = t !== cwd && !path.relative(cwd, t).startsWith("..") && !path.isAbsolute(path.relative(cwd, t));
    if (!inside) return t === cwd ? "this deletes the whole project folder" : `this deletes ${t}, outside the project`;
  }
  return null;
}

// Writing into system folders or ~/.ssh: a redirect to it, or a command that writes.
function protectedWrite(cmd, args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const redirected = /^>>?/.test(a) ? a.replace(/^>>?/, "") || args[i + 1] || "" : (args[i - 1] === ">" || args[i - 1] === ">>") ? a : "";
    const arg = redirected || (WRITERS.has(cmd) ? a : "");
    if (arg && PROTECTED.some((re) => re.test(arg))) return `it changes ${arg}, a folder the system or your login depends on`;
  }
  return null;
}

function check(text, cwd, depth) {
  const parts = split(text.replace(/\s+/g, " "));
  const firstWords = [];
  for (const p of parts) {
    let w = words(p.text);
    while (w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || WRAPPERS.has(w[0]))) w = w.slice(1);
    const cmd = (w[0] || "").replace(/^.*\//, "").toLowerCase();
    const args = w.slice(1);
    firstWords.push({ cmd, args, sep: p.sep });
    if (cmd === "echo" || cmd === "printf") {   // its words are text, but `echo x > /etc/hosts` still writes
      const why = protectedWrite(cmd, args);
      if (why) return why;
      continue;
    }
    if (["sudo", "pkexec", "doas"].includes(cmd) || w.some((x, i) => i > 0 && ["sudo", "pkexec", "doas"].includes(x))) return "it runs with administrator rights (sudo)";
    if (SHELLS.has(cmd) && depth < 3) {
      const i = args.indexOf("-c");
      if (i >= 0 && args[i + 1]) { const inner = check(args[i + 1], cwd, depth + 1); if (inner) return inner; }
    }
    if (cmd === "rm") { const why = rmWhy(args, cwd); if (why) return why; }
    if (cmd === "chmod" && args.some((a) => /^-[a-zA-Z]*R/.test(a)) && args.includes("777")) return "chmod -R 777 makes every file open to everyone";
    if (cmd === "chown" && args.some((a) => /^-[a-zA-Z]*R/.test(a) || a === "--recursive")) return "chown -R changes the owner of a whole folder tree";
    if (cmd === "git") {
      let at = 0;   // (skip git's own options, some with a value: git -C dir reset --hard)
      while (at < args.length && args[at].startsWith("-")) at += ["-C", "-c", "--git-dir", "--work-tree"].includes(args[at]) ? 2 : 1;
      const sub = args[at];
      const rest = args.slice(at + 1);
      if (sub === "reset" && rest.includes("--hard")) return "git reset --hard throws away your uncommitted changes";
      if (sub === "clean" && rest.some((a) => /^-[a-zA-Z]*f/.test(a) || a === "--force")) return "git clean deletes files git doesn't track, for good";
      if (sub === "push" && rest.some((a) => a === "-f" || a === "--force" || a === "--force-with-lease" || /^-[a-zA-Z]*f/.test(a) && !a.startsWith("--") || /^\+/.test(a))) {
        const refs = rest.filter((a) => !a.startsWith("-"));
        if (refs.length < 2 || refs.some((a) => /(^|[:+/])(main|master)$/.test(a))) return "a forced push can overwrite main for everyone";
      }
    }
    if (cmd === "dd" && args.some((a) => /^if=/.test(a))) return "dd can overwrite a disk";
    if (/^mkfs(\.|$)/.test(cmd)) return "mkfs formats a disk";
    if (["shutdown", "reboot", "poweroff", "halt"].includes(cmd)) return "it shuts the computer down";
    const why = protectedWrite(cmd, args);
    if (why) return why;
  }
  // curl/wget piped into a shell (or sudo): runs whatever the server sends.
  for (let i = 1; i < firstWords.length; i++) {
    const to = firstWords[i], from = firstWords[i - 1];
    if (to.sep === "|" && ["curl", "wget"].includes(from.cmd) && (SHELLS.has(to.cmd) || to.cmd === "sudo")) return "it runs a script straight from the internet";
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
