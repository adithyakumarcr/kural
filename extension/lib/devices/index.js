// Devices: the computers you work on over SSH (a Raspberry Pi, a robot's board computer…), saved in Kural by name.
//
//   Saved:     name, address, port, username       → globalState "kural.devices.v1" (no secrets in it)
//   Login:     Kural's own SSH key (ssh.js). The password is used once, when you add the device (or set it up again),
//              to put the key on it, and is then forgotten. Nothing is kept in the keychain: on a Mac, keychain items
//              made Kural ask for your login password (and again after every update, since each build is a new app).
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

class Devices {
  constructor(context) {
    this.context = context;
    this.ssh = new Ssh({ dir: path.join(context.globalStorageUri.fsPath, "ssh") });
    this.bridge = new Bridge(this.ssh, (id) => this.lookup(id));
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

  // For the bridge: the device, and how to log in (always Kural's key: password null). A device saved by an earlier
  // version (its password in the keychain, no key) has to be set up again once.
  async lookup(id) {
    const dev = this.get(id);
    if (!dev) return null;
    if (dev.auth !== "key") {
      vscode.window.showWarningMessage(`Kural: ${dev.name} needs to be set up again once (Kural now logs in with its own SSH key, not a saved password).`, "Set up again")
        .then((p) => p && this.setUpAgain(id));
      return { error: `${dev.name} needs to be set up again: the user has been asked to (Kural: Devices → ${dev.name} → Set up again). Tell them, then wait.` };
    }
    return { dev, password: null };
  }

  // Check the login, put Kural's key on the device, then save (without the password). { ok, device } or { ok: false, error }.
  async add({ name, host, port, user, password }) {
    const dev = { name: String(name || "").trim(), host: String(host || "").trim(), port: Number(port) || 22, user: String(user || "").trim() };
    // "pi@raspberrypi.local" or "192.168.1.20:2222" typed into the address box: take them apart.
    const at = /^([\w.-]+)@(.+)$/.exec(dev.host); if (at) { if (!dev.user) dev.user = at[1]; dev.host = at[2]; }
    const hp = /^([^:]+):(\d+)$/.exec(dev.host); if (hp) { dev.host = hp[1]; dev.port = Number(hp[2]); }
    if (!dev.name || !dev.host || !dev.user) return { ok: false, error: "Give the device a name, its address and the username." };
    if (!/^[\w.:%-]+$/.test(dev.host) || !/^[\w.-]+$/.test(dev.user)) return { ok: false, error: "The address or username has characters SSH can't use." };
    if (this.list().some((d) => d.name.toLowerCase() === dev.name.toLowerCase())) return { ok: false, error: `There's already a device called ${dev.name}.` };
    const t = await this.ssh.installKey(dev, password || "");
    log(`devices: key for ${dev.user}@${dev.host}:${dev.port}: ${t.ok ? `ok (${t.system})` : t.error}`);
    if (!t.ok) return { ok: false, error: t.error };
    const saved = { id: crypto.randomBytes(6).toString("hex"), ...dev, auth: "key", system: t.system, added: Date.now() };
    await this.save([...this.list(), saved]);
    return { ok: true, device: saved };
  }

  // Remove from Kural, and take Kural's key off the device if it's reachable (so nothing of Kural's stays there).
  async remove(id) {
    const dev = this.get(id);
    if (!dev) return;
    // (Not when another saved device is the same login: it uses the same key.)
    const same = this.list().some((d) => d.id !== id && d.host === dev.host && d.user === dev.user && Number(d.port) === Number(dev.port));
    if (dev.auth === "key" && !same) await this.ssh.removeKey(dev).catch(() => {});
    this.ssh.close(dev);
    await this.save(this.list().filter((d) => d.id !== id));
  }

  // Put Kural's key on the device again (it was reinstalled, the key was removed, or it was saved by an older Kural).
  // Asks for the password this once; it isn't kept.
  async setUpAgain(id) {
    const dev = this.get(id);
    if (!dev) return false;
    const password = await vscode.window.showInputBox({ title: `Password for ${dev.user} on ${dev.name}`, password: true, ignoreFocusOut: true,
      prompt: "Used once to put Kural's SSH key on the device. Kural doesn't save it." });
    if (password === undefined) return false;
    this.ssh.close(dev);
    const t = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Setting up ${dev.name}…` }, () => this.ssh.installKey(dev, password));
    if (!t.ok) { vscode.window.showErrorMessage(`Kural: ${dev.name}: ${t.error}`); return false; }
    await this.save(this.list().map((d) => d.id === id ? { ...d, auth: "key", system: t.system || d.system } : d));
    vscode.window.setStatusBarMessage(`${dev.name} is set up`, 2500);
    return true;
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

  // A terminal on the device: `ssh` itself runs in it, with Kural's key.
  async openTerminal(id) {
    let dev = this.get(id);
    if (!dev) return;
    if (dev.auth !== "key") { if (!(await this.setUpAgain(id))) return; dev = this.get(id); }
    const t = vscode.window.createTerminal({ name: `${dev.name} (SSH)`, shellPath: this.ssh.bin, shellArgs: this.ssh.terminalArgs(dev),
      iconPath: new vscode.ThemeIcon("remote"), isTransient: true });
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
      { label: "$(key) Set up again", detail: "Puts Kural's SSH key on it again (after reinstalling it). Asks for the password once; Kural doesn't save it.", run: () => this.setUpAgain(it.d.id) },
      { label: "$(shield) Forget its key", detail: "After reinstalling the device: Kural trusts its new key on the next connection", run: () => { this.ssh.forgetKey(it.d); vscode.window.setStatusBarMessage(`Forgot ${it.d.name}'s key`, 2000); } },
      { label: "$(trash) Remove it from Kural", run: async () => {
        const ok = await vscode.window.showWarningMessage(`Remove ${it.d.name}?`, { modal: true, detail: "Kural forgets the device and, if it's reachable, takes Kural's SSH key off it." }, "Remove");
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
    const password = await ask(`Password for ${user} on ${name}`, { password: true, prompt: "Used once to put Kural's SSH key on the device. Kural doesn't save it." }); if (password === undefined) return;
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Connecting to ${host}…` },
      () => this.add({ name, host, port: 22, user, password }));
    if (r.ok) vscode.window.showInformationMessage(`Kural: ${r.device.name} is saved (${r.device.system || "connected"}).`);
    else vscode.window.showErrorMessage(`Kural: ${r.error}`);
    return r;
  }
}

module.exports = { Devices };
