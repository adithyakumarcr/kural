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

const REPO = "adithyakumarcr/kural";
const LAST_CHECK = "kural.update.lastCheck";
const DAY = 24 * 60 * 60 * 1000;

// "1.2.0-beta.2" → { nums: [1,2,0], pre: ["beta", 2] }
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v || "").trim());
  if (!m) return null;
  return { nums: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split(".").map((x) => /^\d+$/.test(x) ? +x : x) : [] };
}

// <0 if a is older than b, 0 if the same, >0 if newer. A final version is newer than its alpha/beta/rc.
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (!x.pre.length || !y.pre.length) return (x.pre.length ? -1 : 0) - (y.pre.length ? -1 : 0);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p - q;
    if (typeof p === "number") return -1;               // numbers sort before words
    if (typeof q === "number") return 1;
    return p < q ? -1 : 1;                               // alpha < beta < rc
  }
  return 0;
}

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

// Start a small script that waits for Kural (process `pid`) to quit, then runs `then`.
// It gets a clean environment: Kural's internal variables (ELECTRON_RUN_AS_NODE, VSCODE_…) would make the
// restarted Kural start as plain Node, or think it's a child of the old one.
function afterQuit(pid, then) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(ELECTRON_|VSCODE_|KURAL_RAW)/.test(k)) env[k] = v;
  if (process.platform === "win32") {
    const ps = `Wait-Process -Id ${pid} -ErrorAction SilentlyContinue; ${then}`;
    spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], { detached: true, stdio: "ignore", windowsHide: true, env }).unref();
  } else {
    const sh = `while kill -0 ${pid} 2>/dev/null; do sleep 0.3; done; ${then}`;
    spawn("/bin/sh", ["-c", sh], { detached: true, stdio: "ignore", env }).unref();
  }
}

const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;           // sh quoting
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
      if (!quiet) vscode.window.showInformationMessage(`Kural is up to date (${this.version}).`);
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

  async fetchAndInstall(rel, asset) {

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kural-update-"));
    const file = path.join(dir, asset.name);
    const ok = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Downloading Kural ${rel.version}`, cancellable: true },
      async (progress, token) => { await download(asset.browser_download_url, file, progress, token); return !token.isCancellationRequested; });
    if (!ok) return;
    log(`update: downloaded ${asset.name} (${fs.statSync(file).size} bytes)`);
    await this.install(file, dir, rel.version);
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
      afterQuit(pid, `${clear}exec /usr/share/kural/kural ${process.env.KURAL_RESTART_ARGS || ""}`);
    } else if (process.platform === "darwin") {
      // process.execPath is …/Kural.app/Contents/MacOS/Kural (or a helper inside it): the app is everything before /Contents/.
      const app = process.execPath.slice(0, process.execPath.indexOf(".app/") + 4);
      const unpacked = path.join(dir, "new");
      fs.mkdirSync(unpacked);
      const r = spawnSync("ditto", ["-x", "-k", file, unpacked]);
      if (r.status !== 0) throw new Error("couldn't unpack the download");
      const fresh = path.join(unpacked, "Kural.app");
      if (!fs.existsSync(fresh)) throw new Error("the download doesn't contain Kural.app");
      log(`update: replacing ${app} with ${version} after Kural quits`);
      afterQuit(pid, `${clear}rm -rf ${q(app)} && ditto ${q(fresh)} ${q(app)} && xattr -dr com.apple.quarantine ${q(app)}; open ${q(app)}`);
    } else if (process.platform === "win32") {
      const exe = process.execPath;   // …\Kural\Kural.exe
      log(`update: running the setup for ${version} after Kural quits`);
      afterQuit(pid, `${clear}Start-Process -Wait -FilePath ${qp(file)} -ArgumentList '/S'; Start-Process -FilePath ${qp(exe)}`);
    } else {
      throw new Error("updating isn't supported on this system");
    }
    vscode.window.showInformationMessage(`Kural ${version} is installed. Restarting…`);
    setTimeout(() => vscode.commands.executeCommand("workbench.action.quit"), 1500);
  }
}

module.exports = { Updater, compareVersions, parseVersion, newestRelease, assetFor };
