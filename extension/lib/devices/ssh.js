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
const crypto = require("crypto");
const { spawn } = require("child_process");

const IS_WIN = process.platform === "win32";
const MAX_OUT = 200 * 1024;      // what a command may print before Kural cuts it (the model reads it all)

// 'it''s' quoting for the device's shell (devices run Linux: POSIX sh).
const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
// A path for the device's shell: quoted, but a leading ~/ still means the home folder (models often write ~/x).
const qp = (p) => { p = String(p); return p === "~" ? '"$HOME"' : p.startsWith("~/") ? `"$HOME"/${q(p.slice(2))}` : q(p); };

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
      // Timeout or Stop: answer at once. (Waiting for "close" isn't enough: with a reused connection the shared one keeps
      // ssh's output open until the device's command ends, which for `tail -f` is never.)
      const stop = (why) => { if (done) return; if (why === "timeout") timedOut = true; else err += "Stopped."; try { p.kill(); } catch { /* gone */ } finish(null); };
      const timer = setTimeout(() => stop("timeout"), timeout);
      if (signal) { if (signal.aborted) setImmediate(() => stop("abort")); else signal.addEventListener("abort", () => stop("abort"), { once: true }); }
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
  // (Lines may be hashed, "|1|salt|hash": Ubuntu's ssh_config has HashKnownHosts yes. Those are compared by hashing.)
  forgetKey(dev) {
    try {
      const host = Number(dev.port || 22) === 22 ? dev.host : `[${dev.host}]:${dev.port}`;
      const matches = (field) => field.split(",").some((h) => {
        const m = /^\|1\|([^|]+)\|(.+)$/.exec(h);
        if (!m) return h === host;
        return crypto.createHmac("sha1", Buffer.from(m[1], "base64")).update(host).digest("base64") === m[2];
      });
      const keep = fs.readFileSync(this.knownHosts, "utf8").split("\n").filter((l) => l && !matches(l.split(/\s/)[0]));
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
  readFile(dev, pw, file, opts = {}) { return this.run(dev, pw, `cat -- ${qp(file)}`, { timeout: 60000, ...opts }); }
  writeFile(dev, pw, file, content, opts = {}) {
    const dir = path.posix.dirname(String(file));
    return this.run(dev, pw, `mkdir -p -- ${qp(dir)} && cat > ${qp(file)}`, { input: content, timeout: 60000, ...opts });
  }
  listDir(dev, pw, dir, opts = {}) { return this.run(dev, pw, `ls -la -- ${qp(dir || ".")}`, { timeout: 30000, ...opts }); }

  // A command with a time limit on the device too: otherwise `tail -f` would keep running there after Kural gave up.
  // (`timeout` is in every Linux; if a device lacks it, the command just runs without the limit.)
  runLimited(dev, pw, command, secs, opts = {}) {
    // (In the device user's own shell, $SHELL, like a command typed there: bash's `source` works.)
    const c = q(command);
    return this.run(dev, pw, `if command -v timeout >/dev/null 2>&1; then exec timeout -k 5 ${secs} "\${SHELL:-/bin/sh}" -c ${c}; else exec "\${SHELL:-/bin/sh}" -c ${c}; fi`,
      { timeout: (secs + 3) * 1000, ...opts });
  }
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

module.exports = { Ssh, explain, q, qp };
