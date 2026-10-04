// Devices: the computers you work on over SSH (a Raspberry Pi, a robot's board computer…), saved in Kural by name.
//
//   Saved:     name, address, port, username       → globalState "kural.devices.v1" (no secrets in it)
//              the password                        → VS Code's SecretStorage: encrypted with the computer's own
//                                                    keychain (macOS Keychain, Windows Credential Manager / DPAPI,
//                                                    Linux Secret Service); never in a file, a setting or a chat
//   Used by:   a chat linked to a device (+ → Link device): its AI gets the device's tools (device-mcp.js through
//              bridge.js), each command asked about per your mode; a terminal on the device; Kural: Devices.
//
// SSH itself: ./ssh.js (the computer's own `ssh` program).

const vscode = require("vscode");
const path = require("path");
const crypto = require("crypto");
const { Ssh } = require("./ssh");
const { Bridge } = require("./bridge");
const { log } = require("../log");

const KEY = "kural.devices.v1";
const secretKey = (id) => `kural.device.${id}`;

class Devices {
  constructor(context) {
    this.context = context;
    this.ssh = new Ssh({ dir: path.join(context.globalStorageUri.fsPath, "ssh") });
    this.bridge = new Bridge(this.ssh, (id) => this.withPassword(id));
    this.listeners = [];
    context.subscriptions.push({ dispose: () => this.bridge.stop() });
  }

  register() {
    this.context.subscriptions.push(
      vscode.commands.registerCommand("kural.devices", () => this.menu()),
      vscode.commands.registerCommand("kural.devices.add", () => this.addFlow()),
      vscode.commands.registerCommand("kural.devices.terminal", (id) => id ? this.openTerminal(id) : this.pick("Open a terminal on…").then((d) => d && this.openTerminal(d.id))),
    );
  }

  onChange(f) { this.listeners.push(f); }
  changed() { for (const f of this.listeners) { try { f(); } catch { /* a listener's own problem */ } } }

  list() { return (this.context.globalState.get(KEY) || []).filter((d) => d && d.id); }
  get(id) { return this.list().find((d) => d.id === id) || null; }
  async save(list) { await this.context.globalState.update(KEY, list); this.changed(); }

  async withPassword(id) {
    const dev = this.get(id);
    if (!dev) return null;
    return { dev, password: (await this.context.secrets.get(secretKey(id))) || "" };
  }

  // Check the login, then save. { ok, device } or { ok: false, error }.
  async add({ name, host, port, user, password }) {
    const dev = { name: String(name || "").trim(), host: String(host || "").trim(), port: Number(port) || 22, user: String(user || "").trim() };
    // "pi@raspberrypi.local" or "192.168.1.20:2222" typed into the address box: take them apart.
    const at = /^([\w.-]+)@(.+)$/.exec(dev.host); if (at) { if (!dev.user) dev.user = at[1]; dev.host = at[2]; }
    const hp = /^([^:]+):(\d+)$/.exec(dev.host); if (hp) { dev.host = hp[1]; dev.port = Number(hp[2]); }
    if (!dev.name || !dev.host || !dev.user) return { ok: false, error: "Give the device a name, its address and the username." };
    if (!/^[\w.:%-]+$/.test(dev.host) || !/^[\w.-]+$/.test(dev.user)) return { ok: false, error: "The address or username has characters SSH can't use." };
    if (this.list().some((d) => d.name.toLowerCase() === dev.name.toLowerCase())) return { ok: false, error: `There's already a device called ${dev.name}.` };
    const t = await this.ssh.test(dev, password || "");
    log(`devices: test ${dev.user}@${dev.host}:${dev.port}: ${t.ok ? `ok (${t.system})` : t.error}`);
    if (!t.ok) return { ok: false, error: t.error };
    const saved = { id: crypto.randomBytes(6).toString("hex"), ...dev, system: t.system, added: Date.now() };
    await this.context.secrets.store(secretKey(saved.id), password || "");
    await this.save([...this.list(), saved]);
    return { ok: true, device: saved };
  }

  async remove(id) {
    const dev = this.get(id);
    if (!dev) return;
    this.ssh.close(dev);
    await this.context.secrets.delete(secretKey(id));
    await this.save(this.list().filter((d) => d.id !== id));
  }

  async changePassword(id) {
    const dev = this.get(id);
    if (!dev) return;
    const password = await vscode.window.showInputBox({ title: `New password for ${dev.user} on ${dev.name}`, password: true, ignoreFocusOut: true });
    if (password === undefined) return;
    this.ssh.close(dev);
    const t = await this.ssh.test(dev, password);
    if (!t.ok) { vscode.window.showErrorMessage(`Kural: ${dev.name}: ${t.error}`); return; }
    await this.context.secrets.store(secretKey(id), password);
    vscode.window.setStatusBarMessage(`Saved the new password for ${dev.name}`, 2000);
  }

  // A chat linked to a device: the MCP server for its AI (see bridge.js) and the token to end it with.
  session(id, approve, { prefix } = {}) {
    const dev = this.get(id);
    if (!dev) return null;
    return this.bridge.session({ deviceId: id, name: `${dev.name} (${dev.user}@${dev.host})`, approve, prefix });
  }
  endSession(token) { if (token) this.bridge.end(token); }

  // What the chat's AI is told with every message, so it knows where the device tools go.
  note(id) {
    const d = this.get(id);
    if (!d) return "";
    return `\n\n(This chat is linked to the device "${d.name}": ${d.user}@${d.host}${d.port !== 22 ? `:${d.port}` : ""}${d.system ? `, ${d.system}` : ""}. ` +
      "To work on it, use the device tools (run_command, read_file, write_file, list_dir from the \"device\" MCP server). Your other " +
      "tools work on this computer's project. When the user talks about the device, the board or the Pi, they mean that device.)";
  }

  // A terminal on the device: `ssh` itself runs in it, with the password for its askpass in its own environment.
  async openTerminal(id) {
    const found = await this.withPassword(id);
    if (!found) return;
    const { dev, password } = found;
    const env = this.ssh.env(password);
    const t = vscode.window.createTerminal({ name: `${dev.name} (SSH)`, shellPath: this.ssh.bin, shellArgs: this.ssh.terminalArgs(dev),
      env: { SSH_ASKPASS: env.SSH_ASKPASS, SSH_ASKPASS_REQUIRE: "force", DISPLAY: env.DISPLAY, KURAL_SSH_PW: password },
      iconPath: new vscode.ThemeIcon("remote"),
      // Not restored after a restart: VS Code saves a restorable terminal's settings, env (the password) included, to disk.
      isTransient: true });
    t.show();
  }

  // ---------- Kural: Devices (Command Palette) ----------
  async pick(title) {
    const list = this.list();
    if (!list.length) { const ok = await vscode.window.showInformationMessage("No devices yet.", "Add a device"); if (ok) await this.addFlow(); return null; }
    const it = await vscode.window.showQuickPick(list.map((d) => ({ label: `$(remote) ${d.name}`, description: `${d.user}@${d.host}${d.port !== 22 ? `:${d.port}` : ""}`, detail: d.system, d })), { title });
    return it ? it.d : null;
  }

  async menu() {
    const items = this.list().map((d) => ({ label: `$(remote) ${d.name}`, description: `${d.user}@${d.host}${d.port !== 22 ? `:${d.port}` : ""}`, detail: d.system, d }));
    items.push({ label: "$(add) Add a device…", add: true });
    const it = await vscode.window.showQuickPick(items, { title: "Devices (SSH)", placeHolder: "Pick a device, or add one" });
    if (!it) return;
    if (it.add) return this.addFlow();
    const what = await vscode.window.showQuickPick([
      { label: "$(terminal) Open a terminal on it", run: () => this.openTerminal(it.d.id) },
      { label: "$(link) Link it to the current chat", run: () => vscode.commands.executeCommand("kural.chat.linkDevice", it.d.id) },
      { label: "$(key) Change its password", run: () => this.changePassword(it.d.id) },
      { label: "$(shield) Forget its key", detail: "After reinstalling the device: Kural trusts its new key on the next connection", run: () => { this.ssh.forgetKey(it.d); vscode.window.setStatusBarMessage(`Forgot ${it.d.name}'s key`, 2000); } },
      { label: "$(trash) Remove it from Kural", run: async () => {
        const ok = await vscode.window.showWarningMessage(`Remove ${it.d.name}?`, { modal: true, detail: "Kural forgets its address and password. Nothing changes on the device." }, "Remove");
        if (ok === "Remove") await this.remove(it.d.id);
      } },
    ], { title: it.d.name });
    if (what) await what.run();
  }

  // Add a device with input boxes (the chat's + menu has its own form).
  async addFlow() {
    const ask = (title, o = {}) => vscode.window.showInputBox({ title, ignoreFocusOut: true, ...o });
    const name = await ask("Name for the device", { placeHolder: "e.g. rpi-lab" }); if (!name) return;
    const host = await ask(`Address of ${name}`, { placeHolder: "e.g. 192.168.1.20 or raspberrypi.local" }); if (!host) return;
    const user = await ask(`Username on ${name}`, { placeHolder: "e.g. pi" }); if (!user) return;
    const password = await ask(`Password for ${user} on ${name}`, { password: true }); if (password === undefined) return;
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Connecting to ${host}…` },
      () => this.add({ name, host, port: 22, user, password }));
    if (r.ok) vscode.window.showInformationMessage(`Kural: ${r.device.name} is saved (${r.device.system || "connected"}).`);
    else vscode.window.showErrorMessage(`Kural: ${r.error}`);
    return r;
  }
}

module.exports = { Devices };
