// Talking to a device (a Raspberry Pi, a robot's computer…) over SSH, with the computer's own `ssh` program. No vscode
// here, no npm packages.
//
// The password: `ssh` never takes one on its command line (anyone could read it there). It asks a small "askpass"
// program instead (SSH_ASKPASS, SSH_ASKPASS_REQUIRE=force). Kural's askpass prints KURAL_SSH_PW, an environment value
// that only this one `ssh` process (and its askpass) gets. The password itself is stored encrypted by lib/devices/index.js.
//
// The device's key: the first connection trusts it and remembers it in Kural's own known_hosts file (like answering
// "yes" the first time in a terminal); a later different key is refused (someone may be in between).
// Speed (Mac, Linux): the first command opens a connection that later ones reuse for 10 minutes (ControlMaster), so a
// command takes a few milliseconds instead of a new login each time. Windows' ssh can't do that.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const IS_WIN = process.platform === "win32";
const MAX_OUT = 200 * 1024;      // what a command may print before Kural cuts it (the model reads it all)

// 'it''s' quoting for the device's shell (devices run Linux: POSIX sh).
const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

class Ssh {
  // dir: Kural's folder for askpass and known_hosts. bin: the ssh program (tests use a stand-in).
  constructor({ dir, bin } = {}) {
    this.dir = dir || path.join(os.tmpdir(), "kural-ssh");
    this.bin = bin || process.env.KURAL_SSH_BIN || (IS_WIN ? "ssh.exe" : "ssh");
    fs.mkdirSync(this.dir, { recursive: true });
    this.knownHosts = path.join(this.dir, "known_hosts");
    this.askpass = this.writeAskpass();
    // A short folder for reused connections: macOS allows at most 104 characters for their socket path.
    this.controlDir = IS_WIN ? null : path.join("/tmp", `kural-ssh-${process.getuid ? process.getuid() : "u"}`);
    if (this.controlDir) { try { fs.mkdirSync(this.controlDir, { recursive: true, mode: 0o700 }); fs.chmodSync(this.controlDir, 0o700); } catch { this.controlDir = null; } }
  }

  writeAskpass() {
    const file = path.join(this.dir, IS_WIN ? "askpass.cmd" : "askpass.sh");
    const text = IS_WIN
      ? "@powershell -NoProfile -NonInteractive -Command \"[Console]::Out.WriteLine($env:KURAL_SSH_PW)\"\r\n"
      : "#!/bin/sh\nprintf '%s\\n' \"$KURAL_SSH_PW\"\n";
    fs.writeFileSync(file, text, { mode: 0o700 });
    return file;
  }

  // The options every connection uses. dev: { host, port, user }.
  args(dev, { tty = false, reuse = true } = {}) {
    const a = ["-p", String(dev.port || 22), "-o", "StrictHostKeyChecking=accept-new", "-o", `UserKnownHostsFile=${this.knownHosts}`,
      "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", "-o", "NumberOfPasswordPrompts=1", "-o", "LogLevel=ERROR",
      "-o", "PreferredAuthentications=password,keyboard-interactive", "-o", "PubkeyAuthentication=no"];
    if (reuse && this.controlDir) a.push("-o", "ControlMaster=auto", "-o", `ControlPath=${path.join(this.controlDir, "%C")}`, "-o", "ControlPersist=600");
    if (tty) a.push("-t"); else a.push("-T");
    a.push(`${dev.user}@${dev.host}`);
    return a;
  }

  // The environment for `ssh` (and only it): where askpass is, and the password it prints.
  env(password) {
    return { ...process.env, SSH_ASKPASS: this.askpass, SSH_ASKPASS_REQUIRE: "force", DISPLAY: process.env.DISPLAY || ":0", KURAL_SSH_PW: password || "" };
  }

  // Run one command on the device. Resolves { code, stdout, stderr, timedOut, cut }.
  // reuse: false for a login check (a reused connection would hide a wrong password).
  run(dev, password, command, { timeout = 120000, input = null, signal, reuse = true } = {}) {
    return new Promise((resolve) => {
      let out = "", err = "", cut = false, done = false, timedOut = false;
      const p = spawn(this.bin, [...this.args(dev, { reuse }), command], { env: this.env(password), windowsHide: true });
      const finish = (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, stdout: out, stderr: err.trim(), timedOut, cut }); };
      const timer = setTimeout(() => { timedOut = true; try { p.kill(); } catch { /* gone */ } }, timeout);
      if (signal) signal.addEventListener("abort", () => { try { p.kill(); } catch { /* gone */ } }, { once: true });
      p.stdout.on("data", (d) => { if (out.length < MAX_OUT) out += d; else cut = true; });
      p.stderr.on("data", (d) => { if (err.length < 20000) err += d; });
      p.on("error", (e) => { err += e.code === "ENOENT" ? "There's no ssh program on this computer." : e.message; finish(-1); });
      p.on("close", (code) => finish(code));
      p.stdin.on("error", () => {});
      if (input != null) p.stdin.end(input); else p.stdin.end();
    });
  }

  // The device answers, and what it is: { ok, system } or { ok: false, error }.
  async test(dev, password) {
    const r = await this.run(dev, password, "echo kural-ok; uname -srm 2>/dev/null || ver", { timeout: 25000, reuse: false });
    if (r.code === 0 && /kural-ok/.test(r.stdout)) return { ok: true, system: r.stdout.replace("kural-ok", "").trim().split("\n")[0] || "" };
    return { ok: false, error: explain(r) };
  }

  // A device whose key changed (reinstalled, a new SD card): forget the old key, so the next connection trusts the new one.
  forgetKey(dev) {
    try {
      const host = (dev.port || 22) === 22 ? dev.host : `[${dev.host}]:${dev.port}`;
      const keep = fs.readFileSync(this.knownHosts, "utf8").split("\n").filter((l) => l && l.split(/\s/)[0].split(",").indexOf(host) < 0);
      fs.writeFileSync(this.knownHosts, keep.join("\n") + (keep.length ? "\n" : ""));
    } catch { /* nothing remembered */ }
    this.close(dev);
  }

  // Close a reused connection (after a password change, removing the device).
  close(dev) {
    if (!this.controlDir) return;
    try { spawn(this.bin, [...this.args(dev), "-O", "exit"], { stdio: "ignore", env: this.env("") }).on("error", () => {}); } catch { /* no master */ }
  }

  // The command line for a terminal on the device (the terminal gets env() for the password).
  terminalArgs(dev) { return this.args(dev, { tty: true }); }

  // Files on the device, through plain shell commands (every Linux has them).
  readFile(dev, pw, file) { return this.run(dev, pw, `cat -- ${q(file)}`, { timeout: 60000 }); }
  writeFile(dev, pw, file, content) {
    const dir = path.posix.dirname(file);
    return this.run(dev, pw, `mkdir -p -- ${q(dir)} && cat > ${q(file)}`, { input: content, timeout: 60000 });
  }
  listDir(dev, pw, dir) { return this.run(dev, pw, `ls -la -- ${q(dir || ".")}`, { timeout: 30000 }); }
}

// ssh's errors in plain words.
function explain(r) {
  const e = `${r.stderr || ""}`;
  if (r.timedOut || /timed out/i.test(e)) return "The device didn't answer in time. Is it on, and on the same network?";
  if (/Permission denied/i.test(e)) return "The username or password is wrong (the device said: permission denied).";
  if (/Could not resolve hostname/i.test(e)) return "No device with that name was found. Check the address (e.g. 192.168.1.20 or raspberrypi.local).";
  if (/Connection refused/i.test(e)) return "The device refused the connection. Is SSH turned on there (on a Raspberry Pi: raspi-config → Interface Options → SSH)?";
  if (/No route to host|Network is unreachable/i.test(e)) return "The device can't be reached from this computer (another network?).";
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(e)) return "The device's key changed since Kural last connected (reinstalled? a new SD card?). If you expected that, use Forget its key, then try again.";
  if (/no ssh program/i.test(e)) return e;
  return e.split("\n").filter(Boolean).slice(-2).join(" ") || `ssh stopped (exit code ${r.code}).`;
}

module.exports = { Ssh, explain, q };
