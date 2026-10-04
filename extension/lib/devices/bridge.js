// Where the device tools' calls (device-mcp.js, started by Claude Code / Codex / Gemini) come into Kural. No vscode here.
//
// Kural listens on a private local socket (a Unix socket only you can open; a named pipe on Windows). Each chat linked to
// a device gets a random token; a call must carry it, so one chat can't use another chat's device. For each call Kural
// asks the chat whether it may run (approve: your mode, the permission card), then runs it over SSH with Kural's key.

const net = require("net");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { explain } = require("./ssh");

const IS_WIN = process.platform === "win32";
const MCP = path.join(__dirname, "device-mcp.js");

class Bridge {
  // ssh: an Ssh (./ssh.js). lookup(deviceId) -> Promise<{ dev, password: null } | { error } | null>.
  constructor(ssh, lookup) {
    this.ssh = ssh;
    this.lookup = lookup;
    this.sessions = new Map();   // token -> { deviceId, name, approve }
    this.server = null;
    this.where = null;
  }

  start() {
    if (this.server) return this.where;
    const id = crypto.randomBytes(8).toString("hex");
    this.where = IS_WIN ? `\\\\.\\pipe\\kural-device-${id}` : path.join(os.tmpdir(), `kural-device-${id}.sock`);
    this.server = net.createServer((c) => this.connection(c));
    this.server.on("error", () => {});
    const old = process.umask(0o077);   // the socket: only you can open it
    try { this.server.listen(this.where); } finally { process.umask(old); }
    return this.where;
  }

  stop() {
    for (const s of this.sessions.values()) s.ctl.abort();
    if (this.server) { try { this.server.close(); } catch { /* closed */ } this.server = null; }
    if (!IS_WIN && this.where) { try { fs.unlinkSync(this.where); } catch { /* gone */ } }
    this.sessions.clear();
  }

  // A chat linked to a device: its token, and the MCP server to give its AI.
  // approve(tool, args) -> Promise<{ allow, message? }>.
  session({ deviceId, name, approve, prefix }) {
    this.start();
    const token = crypto.randomBytes(24).toString("hex");
    this.sessions.set(token, { deviceId, name, approve, ctl: new AbortController() });
    return { token, server: { command: process.execPath, args: [MCP],
      env: { ELECTRON_RUN_AS_NODE: "1", KURAL_DEVICE_SOCKET: this.where, KURAL_DEVICE_TOKEN: token, KURAL_DEVICE_NAME: name || "the device", ...(prefix ? { KURAL_DEVICE_PREFIX: prefix } : {}) } } };
  }
  // The chat stopped, unlinked or closed: what's still running for it on the device stops too.
  end(token) { const s = this.sessions.get(token); if (s) { s.ctl.abort(); this.sessions.delete(token); } }

  connection(c) {
    let buf = "";
    c.setEncoding("utf8");
    c.on("error", () => {});
    c.on("data", (d) => {
      buf += d;
      const i = buf.indexOf("\n");
      if (i < 0) { if (buf.length > 10 * 1024 * 1024) c.destroy(); return; }
      let req; try { req = JSON.parse(buf.slice(0, i)); } catch { req = null; }
      buf = "";
      this.call(req).then((r) => { try { c.end(JSON.stringify(r) + "\n"); } catch { /* closed */ } },
        (e) => { try { c.end(JSON.stringify({ text: e.message, isError: true }) + "\n"); } catch { /* closed */ } });
    });
  }

  async call(req) {
    const s = req && this.sessions.get(String(req.token || ""));
    if (!s) return { text: "This chat isn't linked to a device (any more).", isError: true };
    const args = req.args && typeof req.args === "object" ? req.args : {};
    const tool = String(req.tool || "");
    if (!["run_command", "read_file", "write_file", "list_dir"].includes(tool)) return { text: `Unknown tool ${tool}.`, isError: true };
    // First whether the device can be reached at all (removed, or needs setting up again), then whether it may run.
    const found = await this.lookup(s.deviceId);
    if (!found) return { text: "The linked device was removed from Kural.", isError: true };
    if (found.error) return { text: found.error, isError: true };
    const { dev, password } = found;   // (password: null = Kural's SSH key)
    // Commands and writes change the device: your chat's mode decides (Agent asks you, Auto doesn't, Plan/Ask don't run them).
    if (tool === "run_command" || tool === "write_file") {
      const ok = await s.approve(tool, args);
      if (!ok || !ok.allow) return { text: (ok && ok.message) || "The user chose not to run this.", isError: true };
    }
    const signal = s.ctl.signal;
    if (signal.aborted) return { text: "This chat isn't linked to a device (any more).", isError: true };
    if (tool === "run_command") {
      if (!args.command) return { text: "No command given.", isError: true };
      const secs = Math.min(Math.max(Number(args.timeout_seconds) || 120, 1), 1800);
      const r = await this.ssh.runLimited(dev, password, String(args.command), secs, { signal });
      if (signal.aborted) return { text: "Stopped (the chat stopped or the device was unlinked).", isError: true };
      if (r.code === 124) r.timedOut = true;   // the device's `timeout` stopped it
      if (r.code === 255 && !r.stdout) return { text: `Couldn't reach the device: ${explain(r)}`, isError: true };   // (ssh's own failure)
      return { text: commandText(r, secs), isError: r.code !== 0 };
    }
    if (tool === "read_file") {
      const r = await this.ssh.readFile(dev, password, String(args.path || ""), { signal });
      return r.code === 0 ? { text: r.stdout + (r.cut ? "\n(cut: the file is longer)" : "") } : { text: r.stderr || "Couldn't read it.", isError: true };
    }
    if (tool === "write_file") {
      const r = await this.ssh.writeFile(dev, password, String(args.path || ""), String(args.content == null ? "" : args.content), { signal });
      return r.code === 0 ? { text: `Wrote ${args.path} (${Buffer.byteLength(String(args.content || ""))} bytes).` } : { text: r.stderr || "Couldn't write it.", isError: true };
    }
    const r = await this.ssh.listDir(dev, password, String(args.path || "."), { signal });
    return r.code === 0 ? { text: r.stdout } : { text: r.stderr || "Couldn't list it.", isError: true };
  }
}

function commandText(r, secs) {
  const parts = [r.timedOut ? `Stopped after ${secs} s (timeout).` : `Exit code ${r.code}.`];
  if (r.stdout) parts.push(`Output:\n${r.stdout}${r.cut ? "\n(cut: there was more)" : ""}`);
  if (r.stderr) parts.push(`Errors:\n${r.stderr}`);
  if (!r.stdout && !r.stderr) parts.push("(no output)");
  return parts.join("\n");
}

module.exports = { Bridge, MCP, commandText };
