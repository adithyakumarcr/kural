// "Kural: Remove Kural's Data…" (Command Palette; Kural Settings → More): before uninstalling, or for a clean start.
// What only a running Kural can undo happens at once: Kural's key comes off your devices, its approval gate comes out of
// Antigravity's settings, the connectors whose key Kural keeps are removed from Claude Code and Codex, your other
// profiles are logged out. Then, if you chose it, Kural closes and a small script deletes everything Kural keeps on this
// computer (core.js wipeTargets) once every Kural process has ended (lib/updates.js afterQuit, the updater's own wait).
// Claude Code, Codex, Antigravity and Ollama are programs of their own: they and their logins stay.
const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const core = require("./core");
const scope = require("../profiles/scope");
const { log } = require("../log");

const GUIDE = "https://github.com/adithyakumarcr/kural/wiki/Uninstall";
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("no answer in time")), ms))]);

// Where Kural runs from (to wait until nothing of it runs any more): /usr/share/kural/, …/Kural.app/Contents/, the
// install folder on Windows.
function appInside() {
  const exe = process.execPath;
  if (process.platform === "darwin") { const at = exe.indexOf(".app/"); return at > 0 ? `${exe.slice(0, at + 4)}/Contents/` : null; }
  return path.dirname(exe) + path.sep;
}

class RemoveData {
  // deps: devices (lib/devices), profileStore + profileHooks (lib/profiles: logout), program(ai) → { bin, env } for
  // connectors (like Kural Settings), keyDir() (connector keys).
  constructor(context, deps) { this.context = context; this.d = deps; }

  register() {
    this.context.subscriptions.push(vscode.commands.registerCommand("kural.removeData", () => this.run().catch((e) => {
      log(`remove data: ${e.stack || e.message}`);
      vscode.window.showErrorMessage(`Kural couldn't finish removing its data: ${e.message}`);
    })));
  }

  userDataDir() { return path.resolve(this.context.globalStorageUri.fsPath, "..", "..", ".."); }   // …/User/globalStorage/kural.kural

  async run() {
    const { devices, profileStore } = this.d;
    const devs = devices ? devices.list() : [];
    const keyed = core.keyedConnectors(this.d.keyDir());
    const others = profileStore ? profileStore.list().filter((p) => p.id !== "default") : [];
    const targets = core.wipeTargets({ userDataDir: this.userDataDir() });
    const items = [];
    if (devs.length) items.push({ id: "devices", label: `Take Kural's key off your devices (${devs.length})`, detail: devs.map((d) => d.name).join(", "), picked: true });
    if (core.gateInstalled()) items.push({ id: "gate", label: "Take Kural's approval gate out of Google Gemini (Antigravity)", detail: "The entry \"kural-gate\" in ~/.gemini/config/hooks.json; your own entries stay", picked: true });
    if (keyed.length) items.push({ id: "connectors", label: `Remove the connectors whose key Kural keeps (${keyed.length})`, detail: `${keyed.map((c) => `${c.name} (${c.ai === "claude" ? "Claude" : "ChatGPT"})`).join(", ")}: they stop working without Kural's folder`, picked: true });
    if (others.length) items.push({ id: "profiles", label: `Log out your other profiles (${others.length})`, detail: others.map((p) => p.name).join(", "), picked: true });
    items.push({ id: "all", label: "Then close Kural and delete everything it keeps on this computer", detail: "Chats, History, checkpoints, settings, extensions, caches, its SSH key and connector keys", picked: true });
    const pick = await vscode.window.showQuickPick(items, { canPickMany: true, ignoreFocusOut: true, title: "Remove Kural's data from this computer",
      placeHolder: "For uninstalling: all of it. Claude Code, Codex, Antigravity and Ollama (and their logins) stay." });
    if (!pick || !pick.length) return;
    const ids = new Set(pick.map((p) => p.id));
    const lines = pick.map((p) => `- ${p.label}`);
    if (ids.has("all")) lines.push("", "Deleted once Kural has closed:", ...targets.map((t) => `  ${t.replace(os.homedir(), "~")}`));
    const go = await vscode.window.showWarningMessage("Remove Kural's data?", { modal: true, detail: `${lines.join("\n")}\n\nThis can't be undone.` },
      ids.has("all") ? "Remove and close Kural" : "Remove");
    if (!go) return;

    const report = [];
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Removing Kural's data…" }, async (progress) => {
      if (ids.has("devices")) for (const d of devs) {
        progress.report({ message: d.name });
        let r;
        try { r = await withTimeout(devices.remove(d.id), 30000); } catch (e) { r = { ok: false, error: e.message }; }
        report.push(r.ok ? `${d.name}: Kural's key removed` : `${d.name}: ${r.error}; remove the line ending in "kural@…" from ~/.ssh/authorized_keys there yourself`);
      }
      if (ids.has("gate")) {
        progress.report({ message: "Gemini's approval gate" });
        try { require("../ai/agy-gate-host").host.stop(); } catch { /* not started */ }
        for (const r of core.removeGate()) report.push(r.error ? `${r.file}: ${r.error}` : `removed Kural's gate from ${r.file.replace(os.homedir(), "~")}`);
      }
      if (ids.has("connectors")) for (const c of keyed) {
        progress.report({ message: c.name });
        const { bin, env } = this.d.program(c.ai);
        const r = bin ? await require("../ai/connectors").remove(c.ai, bin, env, c.name, os.tmpdir(), this.d.keyDir()) : { error: "the program isn't installed" };
        report.push(r.ok ? `connector ${c.name} removed` : `connector ${c.name}: ${r.error}`);
      }
      if (ids.has("profiles")) for (const p of others) {
        progress.report({ message: p.name });
        const dir = scope.profileDir(this.context.globalStorageUri.fsPath, p.id);
        try { if (dir && this.d.profileHooks && this.d.profileHooks.logout) await withTimeout(this.d.profileHooks.logout(dir, { claude: await this.d.claudeSafe() }), 60000); report.push(`profile ${p.name}: logged out`); }
        catch (e) { report.push(`profile ${p.name}: ${e.message}`); }
      }
    });
    for (const r of report) log(`remove data: ${r}`);

    if (!ids.has("all")) {
      const more = await vscode.window.showInformationMessage(`Kural removed what you picked.${report.length ? ` ${report.slice(0, 4).join("; ")}.` : ""}`, "How to uninstall Kural");
      if (more) vscode.env.openExternal(vscode.Uri.parse(GUIDE));
      return;
    }
    // The folders: after every Kural process has ended (the updater's wait), with a log in the temp folder.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kural-remove-"));
    const logFile = path.join(os.tmpdir(), `kural-removed-${new Date().toISOString().slice(0, 10)}.log`);
    const inside = appInside();
    require("../updates").afterQuit({ pid: process.ppid, inside: inside || os.tmpdir() + path.sep, logFile, dir,
      steps: core.wipeSteps(targets) });
    log(`remove data: deleting ${targets.length} folders after Kural closes (log: ${logFile})`);
    await vscode.window.showInformationMessage(`Kural closes now and deletes its data. Then uninstall the program (what's left is listed in ${logFile}).`, { modal: true, detail: `How to uninstall on each system: ${GUIDE}` }, "Close Kural");
    await vscode.commands.executeCommand("workbench.action.quit");
  }
}

module.exports = { RemoveData, appInside };
