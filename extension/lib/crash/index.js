// Kural's crash log: when Kural (a window, the extension host, the whole app) ended unexpectedly, the next start writes a
// report from what the computer kept (lib/crash/scan.js: unclean window markers, macOS crash reports, VS Code's logs) to
// <globalStorage>/crashes/, says so once ("Show report", "Report a bug"), and "Kural: Show Crash Reports" lists them.
// Errors in Kural's own code that nothing caught go to crashes/kural-errors.log too. Nothing leaves the computer unless
// you send a report yourself.
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const scan = require("./scan");
const { log } = require("../log");

const LAST_SCAN = "kural.crash.lastScan";
const ISSUE = "https://github.com/adithyakumarcr/kural/issues/new?template=bug_report.yml";

class CrashLog {
  constructor(context) {
    this.context = context;
    this.store = context.globalStorageUri.fsPath;
    this.markers = path.join(this.store, "sessions");
    this.dir = path.join(this.store, "crashes");
    this.userData = path.resolve(this.store, "..", "..", "..");   // …/Kural (from …/User/globalStorage/kural.kural)
    this.version = context.extension.packageJSON.version;
  }

  start() {
    const now = Date.now();
    // Windows of earlier runs that never closed normally (read before this one's marker is written).
    let markers = [];
    try { markers = scan.endedUnexpectedly(this.markers, process.pid); } catch (e) { log(`crash log: ${e.message}`); }
    const folder = (vscode.workspace.workspaceFolders || [])[0];
    this.info = { pid: process.pid, started: now, seen: now, version: this.version, folder: folder ? folder.name : "", clean: false };
    try { scan.writeMarker(this.markers, this.info); } catch (e) { log(`crash log: can't write the window marker: ${e.message}`); }
    this.timer = setInterval(() => { this.info.seen = Date.now(); try { scan.writeMarker(this.markers, this.info); } catch { /* next minute */ } }, 60000);
    this.context.subscriptions.push({ dispose: () => this.stop() });
    // Errors in Kural's own code that nothing caught (the extension host keeps running; they'd otherwise go unnoticed).
    const own = (e) => this.ownError(e);
    process.on("uncaughtException", own); process.on("unhandledRejection", own);
    this.context.subscriptions.push({ dispose: () => { process.off("uncaughtException", own); process.off("unhandledRejection", own); } });
    // A little later (startup first): the macOS reports and VS Code's logs since the last look.
    setTimeout(() => this.collect(markers).catch((e) => log(`crash log: ${e.stack || e.message}`)), 4000);
  }

  // Closed normally: this window's marker says so.
  stop() {
    clearInterval(this.timer);
    if (!this.info || this.info.clean) return;
    this.info.clean = true; this.info.seen = Date.now();
    try { scan.writeMarker(this.markers, this.info); } catch { /* gone */ }
  }

  async collect(markers) {
    const now = Date.now();
    // First time: the last 3 days (a crash from before Kural kept reports is still worth seeing once).
    const since = this.context.globalState.get(LAST_SCAN) || now - 3 * 86400000;
    const ips = process.platform === "darwin" ? scan.crashReports(since) : [];
    // VS Code's logs of the sessions since then (not this one: it just started).
    const sessions = scan.sessionsSince(path.join(this.userData, "logs"), since, (this.info.started || now) - 20000)
      .map((s) => ({ ...s, scan: scan.scanSession(s.dir) }));
    const crashedSessions = sessions.filter((s) => s.scan.crashes.length);
    await this.context.globalState.update(LAST_SCAN, now);
    if (!markers.length && !ips.length && !crashedSessions.length) return;
    // The sessions worth showing: those with crash lines, and the last one before each crash (its last errors).
    const keep = new Set(crashedSessions);
    for (const at of [...markers.map((m) => m.seen || m.started), ...ips.map((r) => r.at)]) {
      const before = sessions.filter((s) => s.at <= at).pop();
      if (before) keep.add(before);
    }
    const text = scan.report({ markers, ips, sessions: [...keep].sort((a, b) => a.at - b.at).slice(-4), version: this.version });
    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, `crash-${new Date(now).toISOString().replace(/[:.]/g, "-")}.md`);
    fs.writeFileSync(file, text);
    const what = [markers.length && `${markers.length} window${markers.length === 1 ? "" : "s"} closed unexpectedly`,
      ips.length && `${ips.length} macOS crash report${ips.length === 1 ? "" : "s"}`,
      crashedSessions.length && `crash lines in ${crashedSessions.length} log${crashedSessions.length === 1 ? "" : "s"}`].filter(Boolean).join(", ");
    log(`crash log: ${what}; report saved: ${file}`);
    const pick = await vscode.window.showWarningMessage(`Kural closed unexpectedly last time (${what}). A crash report is saved on this computer.`, "Show report", "Report a bug");
    if (pick === "Show report") this.open(file);
    if (pick === "Report a bug") this.reportBug(file);
  }

  ownError(e) {
    const stack = String((e && e.stack) || e || "");
    if (!stack.includes(this.context.extensionPath)) return;   // another extension's, or VS Code's: not ours to log
    log(`error nothing caught: ${stack.split("\n").slice(0, 4).join(" | ")}`);
    try { fs.mkdirSync(this.dir, { recursive: true }); fs.appendFileSync(path.join(this.dir, "kural-errors.log"), `${new Date().toISOString()} Kural ${this.version}\n${stack}\n\n`); } catch { /* best effort */ }
  }

  list() {
    try {
      return fs.readdirSync(this.dir).filter((n) => /\.(md|log)$/.test(n)).map((n) => ({ name: n, file: path.join(this.dir, n), at: fs.statSync(path.join(this.dir, n)).mtimeMs }))
        .sort((a, b) => b.at - a.at);
    } catch { return []; }
  }

  async open(file) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  // The report goes to the clipboard, and the bug form opens (paste it there; nothing is sent by Kural itself).
  async reportBug(file) {
    try { await vscode.env.clipboard.writeText(fs.readFileSync(file, "utf8")); } catch { /* the form still opens */ }
    vscode.window.showInformationMessage("Kural: the crash report is copied. Paste it into the bug report (check it first: it has file paths from your computer).");
    vscode.env.openExternal(vscode.Uri.parse(ISSUE));
  }

  async show() {
    const items = this.list();
    if (!items.length) { vscode.window.showInformationMessage("Kural: no crash reports. (Kural writes one when it closed unexpectedly.)"); return; }
    const pick = await vscode.window.showQuickPick([
      ...items.map((i) => ({ label: i.name.endsWith(".log") ? "Errors in Kural's own code" : `Crash report, ${new Date(i.at).toLocaleString()}`, description: i.name, file: i.file })),
      { label: "$(folder-opened) Open the folder", folder: true }], { title: "Kural's crash reports" });
    if (!pick) return;
    if (pick.folder) vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(this.dir));
    else this.open(pick.file);
  }
}

module.exports = { CrashLog };
