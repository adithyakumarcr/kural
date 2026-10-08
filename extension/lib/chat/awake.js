// Keeps the computer from falling asleep while a chat works (no vscode inside). On a Mac: macOS's own `caffeinate`
// program, which holds a "don't idle-sleep" request for as long as it runs. -i: no idle sleep (the screen may still
// turn off, the lid still sleeps the Mac). -w <pid>: caffeinate ends by itself when Kural's process does, so a crash
// can't leave the Mac awake forever. Other systems: nothing yet.
const { spawn } = require("child_process");

class StayAwake {
  constructor({ platform = process.platform, run = spawn, pid = process.pid, bin = "/usr/bin/caffeinate", log = () => {} } = {}) {
    Object.assign(this, { platform, run, pid, bin, log });
    this.proc = null;
  }

  // on: something is working right now. Called often (each time the chat's tabs change): it only acts on a change.
  set(on) {
    if (on) this.start(); else this.stop();
  }

  start() {
    if (this.proc || this.platform !== "darwin") return;
    let p;
    try { p = this.run(this.bin, ["-i", "-w", String(this.pid)], { stdio: "ignore" }); } catch (e) { this.log(`stay awake: ${e.message}`); return; }
    this.proc = p;
    // Ended on its own (killed by hand, Kural's pid gone): the next set(true) starts a new one.
    p.on("exit", () => { if (this.proc === p) this.proc = null; });
    p.on("error", (e) => { this.log(`stay awake: ${e.message}`); if (this.proc === p) this.proc = null; });
    this.log("stay awake: on (a chat is working)");
  }

  stop() {
    if (!this.proc) return;
    const p = this.proc;
    this.proc = null;
    try { p.kill(); } catch { /* already gone */ }
    this.log("stay awake: off");
  }

  dispose() { this.stop(); }
}

module.exports = { StayAwake };
