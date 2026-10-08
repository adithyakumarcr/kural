// Help → Check for Updates… (also in the Chat panel's … menu and the Account menu), and once a day by itself:
// install the newest Kural release from GitHub (also alpha, beta and rc).
//
// 1. Ask GitHub for the releases and pick the newest version (1.2.0 > 1.2.0-rc.1 > 1.2.0-beta.2 > 1.2.0-alpha.3).
// 2. Download the file for this computer: Ubuntu .deb, Mac .zip, Windows setup .exe.
// 3. Install it and restart Kural (the program itself changes, so a window reload isn't enough):
//    Ubuntu installs right away (it asks for your password); on a Mac and Windows a small script waits
//    until Kural has quit, swaps in the new version and starts it again.

const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { log } = require("./ai/claude");
const { expectedSha, verifySignature, pickManifest } = require("./release-verify");
const { RELEASE_PUBLIC_KEYS } = require("./release-keys");

const REPO = "adithyakumarcr/kural";
const LAST_CHECK = "kural.update.lastCheck";
const UPDATE_PENDING = "kural.update.pending";   // an update started: lastUpdate() reports how it went
const DAY = 24 * 60 * 60 * 1000;

const { parseVersion, compareVersions } = require("./version-compare");

// Which release file this computer needs.
function assetFor(assets, platform = process.platform, arch = process.arch) {
  const pick = (re) => (assets || []).find((a) => re.test(a.name));
  if (platform === "linux" && arch === "x64") return pick(/^kural_.*_amd64\.deb$/);
  if (platform === "darwin" && arch === "arm64") return pick(/^Kural-.*-macos-arm64\.zip$/);
  if (platform === "win32" && arch === "x64") return pick(/^Kural-.*-windows-x64-setup\.exe$/);
  return null;
}

// The newest published release (drafts skipped), with the version from its tag.
function newestRelease(releases) {
  let best = null;
  for (const r of releases || []) {
    if (r.draft || !parseVersion(r.tag_name)) continue;
    if (!best || compareVersions(r.tag_name, best.tag_name) > 0) best = r;
  }
  return best && { ...best, version: best.tag_name.replace(/^v/, "") };
}

async function download(url, file, progress, token) {
  const ctl = new AbortController();
  const sub = token && token.onCancellationRequested(() => ctl.abort());
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "Kural" } });
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const total = +res.headers.get("content-length") || 0;
    const out = fs.createWriteStream(file);
    const reader = res.body.getReader();
    let got = 0, shown = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(value)) await new Promise((r) => out.once("drain", r));
      const pct = total ? Math.floor((100 * got) / total) : 0;
      if (pct > shown) { progress.report({ increment: pct - shown, message: `${Math.round(got / 1e6)} of ${Math.round(total / 1e6)} MB` }); shown = pct; }
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  } finally { if (sub) sub.dispose(); }
}

// The asset must come from this repo's releases over https.
function downloadOk(asset) {
  return !!asset && typeof asset.browser_download_url === "string" && asset.browser_download_url.startsWith(`https://github.com/${REPO}/releases/download/`);
}
function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = require("crypto").createHash("sha256");
    fs.createReadStream(file).on("data", (d) => h.update(d)).on("error", reject).on("end", () => resolve(h.digest("hex")));
  });
}

// Start a small script (a file, run detached) that waits for Kural to quit COMPLETELY, then installs and starts the new
// version, writing what it does to `logFile` (read at the next start: lastUpdate()). Completely: the main process
// (`pid`) and every process started from inside the app (`inside`: the helpers, the extension host…), which exit a
// moment after it. Replacing the app while any of them still ran made Kural crash on the way out ("Kural quit
// unexpectedly", 6 Oct 2026) and the new one sometimes didn't start. It gets a clean environment: Kural's internal
// variables (ELECTRON_RUN_AS_NODE, VSCODE_…) would make the restarted Kural start as plain Node.
function afterQuit({ pid, inside, steps, logFile, dir }) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(ELECTRON_|VSCODE_|KURAL_RAW)/.test(k)) env[k] = v;
  if (process.platform === "win32") {
    const script = path.join(dir, "install.ps1");
    fs.writeFileSync(script, [
      `function Log($m) { Add-Content -Path ${qp(logFile)} -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m) }`,
      `Log "waiting for Kural (pid ${pid}) to quit"`,
      `Wait-Process -Id ${pid} -ErrorAction SilentlyContinue`,
      // Everything else running from Kural's folder: up to 20 s, then it's stopped.
      `$left = Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith(${qp(inside)}, [System.StringComparison]::OrdinalIgnoreCase) }`,
      `if ($left) { $left | Wait-Process -Timeout 20 -ErrorAction SilentlyContinue; Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith(${qp(inside)}, [System.StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue }`,
      steps, ""].join("\r\n"));
    spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script], { detached: true, stdio: "ignore", windowsHide: true, env }).unref();
  } else {
    // (A file, not sh -c: the app's path is in the script, and "pgrep -f <app>" would otherwise find the script itself.)
    const script = path.join(dir, "install.sh");
    fs.writeFileSync(script, unixScript({ pid, inside, steps, logFile }), { mode: 0o700 });
    spawn("/bin/sh", [script], { detached: true, stdio: "ignore", env }).unref();
  }
}

const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;           // sh quoting
// The Mac/Linux script (test/updates-script.test.js runs it on a stand-in app).
function unixScript({ pid, inside, steps, logFile, waitTicks = 66 }) {
  return ["#!/bin/sh",
    `log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> ${q(logFile)}; }`,
    `log "waiting for Kural (pid ${pid}) to quit"`,
    `while kill -0 ${pid} 2>/dev/null; do sleep 0.3; done`,
    // Everything else running from inside the app: up to 20 s, then it's stopped.
    `i=0; while pgrep -f ${q(inside)} >/dev/null 2>&1 && [ $i -lt ${waitTicks} ]; do sleep 0.3; i=$((i+1)); done`,
    `if pgrep -f ${q(inside)} >/dev/null 2>&1; then log "stopping what's still running"; pkill -f ${q(inside)}; sleep 2; pkill -9 -f ${q(inside)}; sleep 1; fi`,
    steps, ""].join("\n");
}
// The Mac steps: the old app set aside, the new one copied in, the old one back if that fails; then start it.
function macSteps({ app, fresh, version, clear = "", open = "open" }) {
  const old = `${app}.kural-old`;
  return [clear, `rm -rf ${q(old)}`, `log "installing ${version}"`,
    `if mv ${q(app)} ${q(old)} && ditto ${q(fresh)} ${q(app)}; then xattr -dr com.apple.quarantine ${q(app)} 2>/dev/null; rm -rf ${q(old)}; log "installed ${version}";`,
    `else log "failed: couldn't put the new version in place; the old one stays"; rm -rf ${q(app)}; mv ${q(old)} ${q(app)}; fi`,
    `${open} ${q(app)} && log "started" || log "failed: couldn't start Kural"`].join("\n");
}
const qp = (s) => `'${String(s).replace(/'/g, "''")}'`;             // PowerShell quoting

// VS Code keeps a cache of its built-in extensions' descriptions (Kural's own extension is one) and
// refreshes it only in the background after starting. Kural's updates keep the same VSCodium inside, so
// without deleting it the restarted Kural would first show the old version, commands and settings.
function builtinCaches(context) {
  const userData = path.resolve(context.globalStorageUri.fsPath, "..", "..", "..");   // …/User/globalStorage/kural.kural
  const dir = path.join(userData, "CachedProfilesData");
  let out = [];
  try { out = fs.readdirSync(dir).map((p) => path.join(dir, p, "extensions.builtin.cache")); } catch { /* no cache yet */ }
  return out;
}

class Updater {
  constructor(context) { this.context = context; this.busy = false; }

  get version() { return this.context.extension.packageJSON.version; }

  async check() {
    if (this.busy) return;
    this.busy = true;
    try { await this.run(); }
    catch (e) { log(`update: ${e.stack || e.message}`); this.failed(e); }
    finally { this.busy = false; }
  }

  failed(e) {
    vscode.window.showErrorMessage(`Kural couldn't update: ${e.message}`, "Open releases page")
      .then((p) => p && vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${REPO}/releases`)));
  }

  // By itself: a minute after Kural starts, then every few hours, it asks GitHub at most once a day (setting
  // kural.updates.autoCheck). Quiet: nothing on screen unless there's a new version, which it offers in a small
  // notification (not a window in your way).
  autoCheck() {
    const tick = async () => {
      if (!vscode.workspace.getConfiguration("kural").get("updates.autoCheck")) return;
      const last = this.context.globalState.get(LAST_CHECK) || 0;
      if (this.busy || Date.now() - last < DAY) return;
      this.busy = true;
      try { await this.context.globalState.update(LAST_CHECK, Date.now()); await this.run(true); }
      catch (e) { log(`update: automatic check: ${e.message}`); }   // (offline, say: try again tomorrow)
      finally { this.busy = false; }
    };
    const first = setTimeout(tick, 60 * 1000);
    const every = setInterval(tick, 4 * 60 * 60 * 1000);
    this.context.subscriptions.push({ dispose: () => { clearTimeout(first); clearInterval(every); } });
  }

  async releases() {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Kural" } });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    return res.json();
  }

  async run(quiet = false) {
    const releases = quiet ? await this.releases()
      : await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Checking for Kural updates…" }, () => this.releases());
    const rel = newestRelease(releases);
    log(`update: you have ${this.version}; newest on GitHub: ${rel ? rel.version : "none"}`);
    if (!rel || compareVersions(rel.version, this.version) <= 0) {
      if (!quiet) vscode.window.showInformationMessage(require("./version").unreleased(this.context.extensionPath)
        ? `No release is newer than ${this.version}. You're on a version built from the code (${require("./version").versionLabel(this.context.extensionPath, this.version)}).`
        : `Kural is up to date (${this.version}).`);
      return;
    }
    const asset = assetFor(rel.assets);
    if (!asset) {
      if (quiet) return;
      const p = await vscode.window.showWarningMessage(`Kural ${rel.version} is out, but has no download for this computer.`, "Open release");
      if (p) vscode.env.openExternal(vscode.Uri.parse(rel.html_url));
      return;
    }
    // The automatic check doesn't wait for your answer: a notification you ignore would otherwise keep Kural "busy",
    // and Check for Updates would do nothing.
    if (quiet) { this.offer(rel, asset, true).catch((e) => { log(`update: ${e.stack || e.message}`); this.failed(e); }); return; }
    await this.offer(rel, asset, false);
  }

  async offer(rel, asset, quiet) {
    const kind = /-(alpha|beta|rc)/i.exec(rel.version);
    const pick = await vscode.window.showInformationMessage(
      `Kural ${rel.version}${kind ? ` (${kind[1].toLowerCase()} test version)` : ""} is available. You have ${this.version}. Install it now? Kural restarts afterwards.`,
      { modal: !quiet }, "Install and restart", "What's new", ...(quiet ? ["Later"] : []));
    if (pick === "What's new") { vscode.env.openExternal(vscode.Uri.parse(rel.html_url)); return; }
    if (pick !== "Install and restart" || this.installing) return;
    this.installing = true;   // (two offers answered "Install": only one download)
    try { await this.fetchAndInstall(rel, asset); } finally { this.installing = false; }
  }

  // The two small files that sign a release's checksums (SHA256SUMS + .sig), as text.
  async manifest(rel) {
    const m = pickManifest(rel.assets);
    if (!m || !downloadOk(m.sums) || !downloadOk(m.sig)) return null;
    const text = async (a) => {
      const res = await fetch(a.browser_download_url, { headers: { "User-Agent": "Kural" } });
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      return res.text();
    };
    return { sums: await text(m.sums), sig: await text(m.sig) };
  }

  async fetchAndInstall(rel, asset) {
    // Only Kural's own GitHub releases, and the file must match the checksum list that Kural's release key signed.
    // GitHub's own SHA-256 comes from the same place as the file, so it only counts as an extra check: whoever could
    // replace the file on GitHub could replace that too, but not sign the list.
    if (!downloadOk(asset)) throw new Error("the download isn't from Kural's GitHub releases");
    const manifest = await this.manifest(rel);
    if (!manifest) throw new Error("this release has no signed checksum list, so Kural won't install it automatically. Download it from the releases page and install by hand.");
    const signedSha = expectedSha(manifest.sums, manifest.sig, asset.name, RELEASE_PUBLIC_KEYS);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kural-update-"));
    const file = path.join(dir, asset.name);
    const ok = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Downloading Kural ${rel.version}`, cancellable: true },
      async (progress, token) => { await download(asset.browser_download_url, file, progress, token); return !token.isCancellationRequested; });
    if (!ok) { fs.rmSync(dir, { recursive: true, force: true }); return; }
    log(`update: downloaded ${asset.name} (${fs.statSync(file).size} bytes)`);
    const got = await sha256(file);
    if (got !== signedSha) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error("the download is damaged or has been changed (its checksum doesn't match the signed list)"); }
    log("update: signature OK; checksum matches");
    const want = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || "");
    if (want && got !== want[1].toLowerCase()) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error("the download is damaged (its checksum doesn't match GitHub's); try again"); }
    await this.install(file, dir, rel.version);
  }

  // "Verify this installation": is the checksum list of the release you're running really signed by Kural's key?
  // (It can't re-hash the installed app: files change after install, so this only shows the release was authentic.)
  async verifyInstall() {
    const tag = `v${this.version}`;
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Kural" } });
      if (!res.ok) throw new Error(`GitHub has no release ${tag} (${res.status}). A version built from the code can't be checked.`);
      const m = await this.manifest(await res.json());
      if (!m) throw new Error(`release ${tag} has no signed checksum list`);
      const v = verifySignature(Buffer.from(m.sums), m.sig, RELEASE_PUBLIC_KEYS);
      if (!v.ok) throw new Error(`release ${tag}: the checksum list is NOT signed by Kural's key`);
      vscode.window.showInformationMessage(`Kural ${this.version}: the release's checksum list is signed by Kural's key (key #${v.keyIndex + 1}).`);
    } catch (e) { log(`verify: ${e.message}`); vscode.window.showWarningMessage(`Couldn't verify: ${e.message}`); }
  }

  async install(file, dir, version) {
    const pid = process.ppid;   // Kural's main process (this code runs in a child of it)
    const caches = builtinCaches(this.context);
    const clear = process.platform === "win32"
      ? caches.map((c) => `Remove-Item -Force -ErrorAction SilentlyContinue ${qp(c)}; `).join("")
      : caches.map((c) => `rm -f ${q(c)}; `).join("");
    if (process.platform === "linux") {
      // Installing needs administrator rights: pkexec shows Ubuntu's password window.
      const root = process.getuid && process.getuid() === 0;
      const cmd = root ? ["/usr/bin/dpkg", ["-i", file]] : ["pkexec", ["/usr/bin/dpkg", "-i", file]];
      // dpkg needs the system folders (/usr/sbin has ldconfig) even if Kural was started without them.
      const env = { ...process.env, PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" };
      const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Installing Kural ${version}…` },
        () => new Promise((resolve) => {
          const p = spawn(cmd[0], cmd[1], { stdio: ["ignore", "pipe", "pipe"], env });
          let err = "";
          p.stderr.on("data", (d) => { err += d; });
          p.on("error", (e) => resolve({ code: -1, err: e.message }));
          p.on("exit", (code) => resolve({ code, err }));
        }));
      if (r.code !== 0) {
        log(`update: install failed (${r.code}): ${r.err}`);
        if (r.code === 126 || r.code === 127) throw new Error("the password window was closed");
        throw new Error(r.code === -1 ? `can't run ${cmd[0]}: ${r.err}` : `installing failed. Install it by hand: sudo apt install ${file}`);
      }
      log(`update: installed ${version}; restarting`);
      // (KURAL_RESTART_ARGS: extra start options, only for testing, e.g. when Kural runs as root in a test machine)
      afterQuit({ pid, inside: "/usr/share/kural/", logFile: this.updateLog, dir, steps: [clear, `log "installed ${version}"`,
        `/usr/share/kural/kural ${process.env.KURAL_RESTART_ARGS || ""} >/dev/null 2>&1 & log "started"`].join("\n") });
    } else if (process.platform === "darwin") {
      // process.execPath is …/Kural.app/Contents/MacOS/Kural (or a helper inside it): the app is everything before /Contents/.
      const at = process.execPath.indexOf(".app/");
      const app = at > 0 ? process.execPath.slice(0, at + 4) : "";
      // (Never remove anything but an app: the swap below deletes this folder.)
      if (!/\/[^/]+\.app$/.test(app) || app.split("/").length < 3) throw new Error("couldn't find where Kural.app is; install the download by hand");
      const unpacked = path.join(dir, "new");
      fs.mkdirSync(unpacked);
      const r = spawnSync("ditto", ["-x", "-k", file, unpacked]);
      if (r.status !== 0) throw new Error("couldn't unpack the download");
      const fresh = path.join(unpacked, "Kural.app");
      if (!fs.existsSync(fresh)) throw new Error("the download doesn't contain Kural.app");
      // Kural can only replace itself where you may write (an app installed by another user of this Mac can't be).
      try { fs.accessSync(app, fs.constants.W_OK); fs.accessSync(path.dirname(app), fs.constants.W_OK); }
      catch { this.byHand(file, `Kural can't replace itself in ${path.dirname(app)} (no permission).`); return; }
      log(`update: replacing ${app} with ${version} after Kural quits`);
      // The old app is set aside first and comes back if copying the new one fails: never half an app.
      afterQuit({ pid, inside: `${app}/Contents/`, logFile: this.updateLog, dir, steps: macSteps({ app, fresh, version, clear }) });
    } else if (process.platform === "win32") {
      const exe = process.execPath;   // …\Kural\Kural.exe
      log(`update: running the setup for ${version} after Kural quits`);
      afterQuit({ pid, inside: path.dirname(exe) + path.sep, logFile: this.updateLog, dir, steps: [clear,
        `Log "installing ${version}"`,
        `$p = Start-Process -Wait -PassThru -FilePath ${qp(file)} -ArgumentList '/S'`,
        `if ($p.ExitCode -eq 0) { Log "installed ${version}" } else { Log ("failed: the setup ended with " + $p.ExitCode) }`,
        `Start-Process -FilePath ${qp(exe)}; Log "started"`].join("\r\n") });
    } else {
      throw new Error("updating isn't supported on this system");
    }
    await this.context.globalState.update(UPDATE_PENDING, { version, at: Date.now() });
    vscode.window.showInformationMessage(`Kural ${version} is ready. Kural closes and starts again…`);
    // (Linux: the files are already replaced, so close quickly. Mac/Windows install after Kural has closed.)
    setTimeout(() => vscode.commands.executeCommand("workbench.action.quit"), process.platform === "linux" ? 300 : 1500);
    // Still here after 20 s: something kept Kural open (an unsaved file, a running task). The update waits for it.
    setTimeout(() => vscode.window.showWarningMessage(`Kural ${version} installs as soon as Kural closes. Something kept it open (an unsaved file or a running task?): close Kural yourself to finish.`), 20000);
  }

  // Couldn't install it here: the download is shown in the Finder / Explorer to install by hand.
  byHand(file, why) {
    log(`update: ${why}`);
    vscode.window.showWarningMessage(`${why} Install the download by hand: replace Kural with the one in it.`, "Show the download")
      .then((p) => { if (p) vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(file)); });
  }

  get updateLog() { return path.join(this.context.globalStorageUri.fsPath, "update.log"); }

  // At startup: how the last update went (its script's log). Said only when it failed; logged either way.
  // Returns { version, failed } when an update had started (What's new uses it), else nothing.
  lastUpdate() {
    const pending = this.context.globalState.get(UPDATE_PENDING);
    if (!pending) return;
    this.context.globalState.update(UPDATE_PENDING, undefined);
    let text = "";
    try { text = fs.readFileSync(this.updateLog, "utf8"); } catch { /* the script didn't run */ }
    const lines = text.trim().split("\n").filter(Boolean).slice(-8);
    log(`update: last update to ${pending.version}: ${lines.length ? lines.join(" | ") : "no record"}`);
    const failed = lines.find((l) => / failed/.test(l));
    if (failed) vscode.window.showWarningMessage(`Kural's update to ${pending.version} didn't finish: ${failed.replace(/^\S+ \S+ failed: /, "")}.`, "Open releases page")
      .then((p) => p && vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${REPO}/releases`)));
    else if (compareVersions(this.version, pending.version) < 0) log(`update: still on ${this.version} after the update to ${pending.version}`);
    try { if (text.length > 64 * 1024) fs.writeFileSync(this.updateLog, lines.join("\n") + "\n"); } catch { /* keep it */ }
    return { version: pending.version, failed: !!failed };
  }
}

module.exports = { Updater, compareVersions, parseVersion, newestRelease, assetFor, downloadOk, unixScript, macSteps };
