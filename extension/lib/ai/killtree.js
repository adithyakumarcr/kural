// Ends a child process and everything it started. No vscode here (tests run without it).
//  Mac, Linux: the child leads its own process group (spawned `detached`), so the signal goes to the whole group. SIGTERM
//    first (let it clean up); a program that ignores it (`trap '' TERM`) is ended with SIGKILL after `grace` ms.
//  Windows: there are no groups; `taskkill /T /F` ends the process and its children at once.
const { execFile } = require("child_process");

function killTree(p, { grace = 2000, win = process.platform === "win32", taskkill = execFile } = {}) {
  if (!p) return;
  const pid = p.pid;
  if (win) {
    if (pid) { try { taskkill("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {}); return; } catch { /* fall back */ } }
    try { p.kill(); } catch { /* gone */ }
    return;
  }
  const signal = (sig) => {
    try { if (pid) process.kill(-pid, sig); else p.kill(sig); }
    catch { try { p.kill(sig); } catch { /* gone */ } }   // (not a group leader: just the process)
  };
  signal("SIGTERM");
  // Unconditional: the leader may have gone while something in its group ignored SIGTERM. Nothing left = ESRCH, harmless.
  setTimeout(() => signal("SIGKILL"), grace).unref();
}

module.exports = { killTree };
