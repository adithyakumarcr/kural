// Live check of one-frame windows (macOS and Linux; needs an app built from source with patches/kural/0100-one-frame-windows.patch).
// Starts a throwaway copy of the built app (own user data, no Kural of yours is touched), opens two project folders, and
// drives the windows over the Chrome DevTools protocol: exactly one window visible, the others hidden but alive, same
// bounds, a visible window that closes hands the frame to the last hidden one. Prints what it saw, plus a screenshot
// of the visible window (the Projects bar's layout).
// Which windows are visible is asked of the app's MAIN process (Electron's BrowserWindow.isVisible/getBounds, through a
// Node inspector the test app is started with: --inspect). The page's document.visibilityState can't tell: the patch gives
// frame windows backgroundThrottling:false, so a hidden window's page still says "visible". macOS's own window list
// (CGWindowListCopyWindowInfo, a tiny Swift helper compiled with swiftc; optional) is shown beside it for comparison; on Linux
// the X server's own list (xdotool search --onlyvisible, when xdotool is there) is, and it is exact: an unmapped window is gone from it.
// The test app gets its own HOME (a temp folder): VS Code keeps the "recently opened" list in ~/.kural-shared, which the
// test folders would otherwise end up in.
// Run: node test/one-frame.live.js
//   Mac:   KURAL_APP=/path/to/Kural.app (default build/mac/Kural.app of this checkout)
//   Linux: KURAL_APP=/path/to/the/kural/program (default /usr/share/kural/kural, the .deb's); needs a display: DISPLAY (Xvfb), ideally
//          with a window manager running (openbox: windows hide and show like on a desktop). KURAL_APP_FLAGS="--no-sandbox ..." adds
//          flags (a container needs --no-sandbox). scripts/linux-container/run.sh live does all of it in Docker.
// Not named *.test.js: `npm test` does not run it. Never uses AppleScript. Quits only the processes it started.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const net = require("net");
const { spawn, spawnSync } = require("child_process");

const MACOS = process.platform === "darwin", LINUX = process.platform === "linux";
const APP = process.env.KURAL_APP || (MACOS ? path.join(__dirname, "..", "build/mac/Kural.app") : "/usr/share/kural/kural");
// Mac: Kural.app/Contents/MacOS/Kural and its bin/kural; Linux: the program and bin/kural beside it (the .deb's /usr/share/kural).
const BIN = MACOS ? path.join(APP, "Contents/MacOS/Kural") : APP;
const CLI = MACOS ? path.join(APP, "Contents/Resources/app/bin/kural") : path.join(path.dirname(APP), "bin/kural");
const APP_FLAGS = (process.env.KURAL_APP_FLAGS || "").split(/\s+/).filter(Boolean);
if (!(MACOS || LINUX) || !fs.existsSync(BIN) || !fs.existsSync(CLI)) {
  console.log(`SKIP: no Kural app built from source at ${APP} (or not a Mac or Linux computer). Set KURAL_APP to try another build.`);
  process.exit(0);
}
if (LINUX && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) { console.log("SKIP: no display (start Xvfb and set DISPLAY, or run scripts/linux-container/run.sh live)."); process.exit(0); }
if (typeof WebSocket === "undefined") { console.log("SKIP: needs Node 22+ (global WebSocket)."); process.exit(0); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];   // {name, ok, detail}
const findings = [];  // things the app does that look wrong
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); return !!ok; };
const finding = (text) => { findings.push(text); console.log(`FINDING  ${text}`); };
const info = (text) => console.log(`        ${text}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-oneframe-"));
const dirs = { home: path.join(tmp, "home"), user: path.join(tmp, "user-data"), ext: path.join(tmp, "extensions"), a: path.join(tmp, "proj-a"), b: path.join(tmp, "proj-b") };
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(dirs.a, "a.txt"), "project A\n");
fs.writeFileSync(path.join(dirs.b, "b.txt"), "project B\n");
const logFile = path.join(tmp, "app.log");
let main;

const SWIFT = `import CoreGraphics
import Foundation
let pid = Int32(CommandLine.arguments[1]) ?? 0
let list = (CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]]) ?? []
var out: [[String: Any]] = []
for w in list where (w[kCGWindowOwnerPID as String] as? Int32) == pid && (w[kCGWindowLayer as String] as? Int) == 0 {
  let b = w[kCGWindowBounds as String] as? [String: Double] ?? [:]
  out.append(["id": w[kCGWindowNumber as String] as? Int ?? 0, "on": w[kCGWindowIsOnscreen as String] as? Bool ?? false, "x": b["X"] ?? 0, "y": b["Y"] ?? 0, "w": b["Width"] ?? 0, "h": b["Height"] ?? 0])
}
print(String(data: try! JSONSerialization.data(withJSONObject: out), encoding: .utf8)!)
`;
let nativeBin = null;
const NATIVE = MACOS ? "macOS" : "X11";   // whose window list is shown beside Electron's
function buildNative() {
  if (!MACOS) {   // Linux: xdotool, when it is there
    if (spawnSync("xdotool", ["version"], { encoding: "utf8" }).status === 0) nativeBin = "xdotool";
    else info("no xdotool, so no comparison with the X server's own window list");
    return;
  }
  const src = path.join(tmp, "windows.swift"), bin = path.join(tmp, "windows");
  fs.writeFileSync(src, SWIFT);
  const r = spawnSync("swiftc", ["-O", src, "-o", bin], { encoding: "utf8", timeout: 120000 });
  if (r.status === 0 && fs.existsSync(bin)) nativeBin = bin;
  else info(`no swiftc, so no comparison with macOS's own window list (${(r.stderr || r.error || "").toString().trim().slice(0, 100)})`);
}
// The main process's windows as macOS sees them: [{id, on, x, y, w, h}] (hidden ones are on: false), or null.
function nativeWindows() {
  if (!nativeBin || !main || main.gone) return null;
  if (!MACOS) { // X11: the windows of the main process the server has mapped (a hidden/unmapped one is not listed)
    const ids = spawnSync("xdotool", ["search", "--onlyvisible", "--pid", String(main.pid)], { encoding: "utf8", timeout: 5000 }).stdout.split(/\s+/).filter(Boolean);
    const out = [];
    for (const id of ids) {
      const g = spawnSync("xdotool", ["getwindowgeometry", "--shell", id], { encoding: "utf8", timeout: 5000 }).stdout;
      const v = Object.fromEntries(g.split("\n").map((l) => l.split("=")).filter((p) => p.length === 2).map(([k, x]) => [k, Number(x)]));
      if (v.WIDTH > 200 && v.HEIGHT > 200) out.push({ id: Number(id), on: true, x: v.X, y: v.Y, w: v.WIDTH, h: v.HEIGHT });
    }
    return out;
  }
  const r = spawnSync(nativeBin, [String(main.pid)], { encoding: "utf8", timeout: 5000 });
  try { return JSON.parse(r.stdout).filter((w) => w.w > 200 && w.h > 200); } catch { return null; }
}

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.on("error", reject);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const getJson = (port, p) => new Promise((resolve, reject) => {
  const req = http.get({ host: "127.0.0.1", port, path: p, timeout: 3000 }, (res) => {
    let body = ""; res.on("data", (c) => body += c);
    res.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
  });
  req.on("error", reject); req.on("timeout", () => req.destroy(new Error("timeout")));
});

// A tiny CDP client, one WebSocket per page.
class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.waiting = new Map(); }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => resolve(this);
      this.ws.onerror = (e) => reject(new Error("websocket error " + (e.message || "")));
      this.ws.onclose = () => { this.closed = true; for (const w of this.waiting.values()) w.reject(new Error("closed")); this.waiting.clear(); };
      this.ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        const w = msg.id && this.waiting.get(msg.id);
        if (w) { this.waiting.delete(msg.id); msg.error ? w.reject(new Error(msg.error.message)) : w.resolve(msg.result); }
      };
    });
  }
  send(method, params = {}, timeout = 8000) {
    if (this.closed) return Promise.reject(new Error("closed"));
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const t = setTimeout(() => { this.waiting.delete(id); reject(new Error(`${method} timed out`)); }, timeout);
      this.waiting.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

const STATE = `({ vis: document.visibilityState, focus: document.hasFocus(), x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight, title: document.title })`;
// The test app's own environment, nothing of yours. Linux also needs the display and the session bus to open a window.
const keep = LINUX ? ["DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XDG_SESSION_TYPE", "DBUS_SESSION_BUS_ADDRESS", "XAUTHORITY"].filter((k) => process.env[k]).map((k) => `${k}=${process.env[k]}`) : [];
const mine = (env) => ["env", "-i", `HOME=${dirs.home}`, `PATH=${LINUX ? "/usr/local/bin:/usr/bin:/bin" : "/usr/bin:/bin"}`, ...keep, ...env];
const common = [`--user-data-dir=${dirs.user}`, `--extensions-dir=${dirs.ext}`, "--disable-workspace-trust", ...APP_FLAGS];
const CMD = MACOS ? 4 : 2;   // CDP modifiers: Alt 1, Ctrl 2, Meta (Cmd) 4, Shift 8

const started = []; // pids this script started
let port;
let screenshot;

function cleanup() {
  // Linux: the app was started detached, so it leads its own process group: that group is the app and its helpers, and
  // nothing else (a pattern on the folder could hit a Kural you installed in the same place).
  const stop = (sig) => { for (const pid of started) { try { process.kill(LINUX ? -pid : pid, sig); } catch {} } };
  stop("SIGTERM");
  spawnSync("sleep", ["2"]);
  stop("SIGKILL");
  // Mac, helpers of that build only: the pattern is the test app's own folder, never /Applications/Kural.app
  if (MACOS) spawnSync("pkill", ["-f", path.join(APP, "Contents").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/"]);
}

// The workbench pages (one per window) with a live connection each, keyed by the folder in their title.
const conns = new Map(); // target id -> Cdp
async function workbenches() {
  const list = (await getJson(port, "/json")).filter((t) => t.type === "page" && /workbench\.html/.test(t.url));
  const out = [];
  for (const t of list) {
    let c = conns.get(t.id);
    if (!c || c.closed) { c = await new Cdp(t.webSocketDebuggerUrl).open(); conns.set(t.id, c); }
    out.push({ id: t.id, title: t.title, c });
  }
  for (const [id, c] of conns) if (!list.some((t) => t.id === id)) { c.close(); conns.delete(id); }
  return out;
}
const nameOf = (t) => /proj-a/.test(t) ? "A" : /proj-b/.test(t) ? "B" : "?";
const MAC = Symbol(NATIVE), MAIN = Symbol("main process");
let inspector; // Cdp to the main process
async function mainWindows() {
  const r = await inspector.eval(`(() => { const { BrowserWindow } = process.mainModule.require("electron"); return BrowserWindow.getAllWindows().map((w) => ({ id: w.id, title: w.getTitle(), visible: w.isVisible(), min: w.isMinimized(), fs: w.isFullScreen(), x: w.getBounds().x, y: w.getBounds().y, w: w.getBounds().width, h: w.getBounds().height })); })()`);
  return r.sort((a, b) => a.id - b.id);
}
async function snapshot() {
  const out = {};
  for (const w of await workbenches()) {
    let s;
    try { s = await w.c.eval(STATE); } catch (e) { s = { error: e.message }; }
    const key = nameOf(s.title || w.title);
    out[key] = { ...s, id: w.id, c: w.c };
  }
  const wins = await mainWindows();
  out[MAIN] = wins;
  out[MAC] = nativeWindows(); // (the native window list: macOS's or X11's)
  for (const w of wins) { const o = out[nameOf(w.title)]; if (o) o.win = w; } // the main process's window of that page
  return out;
}
// How many windows exist and are visible, and which one is in front (the only visible one): from the main process.
const wins = (s) => s[MAIN];
const shown = (s) => wins(s).filter((w) => w.visible).length;
const total = (s) => wins(s).length;
const front = (s) => { const v = wins(s).filter((w) => w.visible); return v.length === 1 ? nameOf(v[0].title) : null; };
const macOn = (s) => s[MAC] ? s[MAC].filter((w) => w.on).length : null;
const show = (s) => `${wins(s).map((w) => `${nameOf(w.title)}: ${w.visible ? "VISIBLE" : "hidden"}${w.min ? " minimized" : ""}${w.fs ? " fullscreen" : ""} ${w.w}x${w.h}@${w.x},${w.y}`).join("  |  ")}${s[MAC] ? `  ||  ${NATIVE} list: ${s[MAC].length} window(s), ${macOn(s)} on screen` : ""}${Object.entries(s).filter(([, v]) => v.error).map(([k, v]) => `  ||  page ${k}: ${v.error}`).join("")}`;
const settled = (who) => (s) => !!(s.A && s.B) && shown(s) === 1 && total(s) === 2 && front(s) === who;

// Polls both windows (pages and the main process) every ~100 ms until `done(snapshot)` is true.
async function waitFor(label, done, ms = 30000) {
  const t0 = Date.now(); let last;
  while (Date.now() - t0 < ms) {
    try {
      last = await snapshot();
      if (done(last)) return { ok: true, snap: last, ms: Date.now() - t0 };
    } catch (e) { last = null; info(`${label}: ${e.message}`); }
    await sleep(100);
  }
  info(`${label}: timed out, last: ${last ? show(last) : "nothing"}`);
  return { ok: false, snap: last || {}, ms };
}

// Runs fn() while the main process's windows are sampled every ~10 ms: the visible windows (ids) and how many exist, each
// time that changes. A step of the frame (new window shown, old one hidden) is over in tens of milliseconds, so the
// 100 ms polling of waitFor() would miss a flash.
async function track(fn) {
  const states = []; let stop = false; const t0 = Date.now();
  const sampler = (async () => {
    while (!stop) {
      try {
        const w = await mainWindows();
        const key = `${w.filter((x) => x.visible).map((x) => x.id).join("+") || "none"}/${w.length}`;
        if (!states.length || states[states.length - 1].key !== key) states.push({ key, at: Date.now() - t0 });
      } catch {}
      await sleep(8);
    }
  })();
  let r;
  try { r = await fn(); } finally { stop = true; await sampler; }
  r.states = states; r.total = Date.now() - t0;
  return r;
}

const runCli = (args) => new Promise((resolve) => {
  const e = mine([CLI, ...common, ...args]);
  const c = spawn(e[0], e.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
  let err = ""; c.stderr.on("data", (d) => err += d);
  const t = setTimeout(() => c.kill("SIGKILL"), 30000);
  c.on("exit", (status) => { clearTimeout(t); resolve({ status, stderr: err }); });
});

async function key(c, k) { // a keyboard shortcut as the workbench sees it (the native menu is not involved)
  const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: k.mod };
  await c.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}
async function closeWindowOf(c) {
  // 1. the keybinding of "Close Window" (Cmd+Shift+W; Ctrl+Shift+W on Linux, Alt+F4's second key); 2. the Command Palette
  await c.send("Page.bringToFront").catch(() => {});
  await c.eval("document.body.focus(); true").catch(() => {});
  await key(c, { key: "W", code: "KeyW", vk: 87, mod: CMD | 8 }).catch(() => {});
  return MACOS ? "Cmd+Shift+W" : "Ctrl+Shift+W";
}
async function closeWindowViaPalette(c) {
  await c.send("Page.bringToFront").catch(() => {});
  await key(c, { key: "P", code: "KeyP", vk: 80, mod: CMD | 8 });
  await sleep(700);
  await c.send("Input.insertText", { text: "Close Window" });
  await sleep(700);
  await key(c, { key: "Enter", code: "Enter", vk: 13, mod: 0 });
  return "Command Palette: Close Window";
}

async function main_() {
  port = await freePort();
  const inspectPort = await freePort();
  console.log(`app:        ${APP}`);
  console.log(`temp:       ${tmp}   (HOME of the test app is ${dirs.home})`);
  console.log(`debug port: ${port}, inspector (main process): ${inspectPort}`);
  buildNative();
  const log = fs.openSync(logFile, "w");
  const e = mine([BIN, ...common, `--remote-debugging-port=${port}`, `--inspect=${inspectPort}`, dirs.a]);
  main = spawn(e[0], e.slice(1), { stdio: ["ignore", log, log], detached: true });
  started.push(main.pid);
  main.on("exit", (code, sig) => { main.gone = true; info(`main process ended (code ${code}, signal ${sig})`); });
  info(`main process pid ${main.pid}`);
  for (let i = 0; i < 100 && !inspector; i++) { // the inspector of the main process
    try { inspector = await new Cdp((await getJson(inspectPort, "/json"))[0].webSocketDebuggerUrl).open(); } catch { await sleep(300); }
  }
  if (!check("the main process answers on its inspector (--inspect)", !!inspector)) return;
  const bounds = (a, b) => ["x", "y", "w", "h"].every((k) => a[k] === b[k]); // windows of the main process (or page numbers)
  // What the 10 ms sampling saw: "ids of the visible windows / windows that exist", and for how long each state lasted.
  const flash = (what, r, snap) => {
    const names = {}; for (const w of snap ? wins(snap) : []) names[w.id] = nameOf(w.title);
    const label = (key) => { const [v, n] = key.split("/"); return `${v.replace(/\d+/g, (id) => names[id] || id)} visible, ${n} window(s)`; };
    const st = r.states || [];
    info(`${what}: visible windows over time: ${st.map((x) => `[${x.at} ms] ${label(x.key)}`).join(" -> ")} (watched ${r.total} ms)`);
    const lasts = (i) => (i + 1 < st.length ? st[i + 1].at : r.total) - st[i].at;
    st.forEach((x, i) => {
      const visibleNow = x.key.split("/")[0];
      if (visibleNow === "none" && i > 0) finding(`${what}: no window was visible for ${lasts(i)} ms (a flash)`);
      if (visibleNow.includes("+")) info(`${what}: ${visibleNow.split("+").length} windows were visible together for ${lasts(i)} ms (the new one over the old one, same bounds)`);
    });
  };

  // 1. A is up
  let r = await waitFor("start A", (s) => s.A && s.A.w > 0 && shown(s) === 1 && total(s) === 1, 90000);
  if (!check("the app starts with folder A: one window, visible", r.ok, r.ok ? `${r.ms} ms; ${show(r.snap)}` : "")) return;
  const a0 = r.snap.A.win;
  info(`window A at start: ${a0.w}x${a0.h} at ${a0.x},${a0.y}`);
  await sleep(4000); // let the extension host and the Projects bar settle

  // 2. Open B through the app's CLI: B takes the place of A
  r = await track(async () => {
    const cli = await runCli(["-n", dirs.b]);
    info(`CLI open B: exit ${cli.status}${cli.stderr ? " stderr: " + cli.stderr.trim().slice(0, 200) : ""}`);
    return waitFor("open B", settled("B"), 40000);
  });
  const s1 = r.snap;
  check("opening B: two windows exist (main process) and two workbench pages", total(s1) === 2 && !!(s1.A && s1.B), show(s1));
  check("opening B: exactly one window visible", shown(s1) === 1, show(s1));
  check("opening B: the visible one is B", front(s1) === "B", `visible: ${front(s1)}`);
  check("opening B: A is hidden, not closed (its window exists, isVisible() false, its page still answers Runtime.evaluate)", !!(s1.A && s1.A.win) && !s1.A.win.visible && !s1.A.error, s1.A ? (s1.A.error || (s1.A.win ? "ok" : "no window")) : "no A page");
  if (s1.A && s1.B && s1.A.win && s1.B.win) {
    check("opening B: same bounds as A (window x, y, width, height)", bounds(s1.A.win, s1.B.win), `A ${s1.A.win.w}x${s1.A.win.h}@${s1.A.win.x},${s1.A.win.y}; B ${s1.B.win.w}x${s1.B.win.h}@${s1.B.win.x},${s1.B.win.y}`);
    check("opening B: B took the bounds A had at start", bounds(s1.B.win, a0), `A at start ${a0.w}x${a0.h}@${a0.x},${a0.y}`);
    check("opening B: neither window is minimized or full screen", !s1.A.win.min && !s1.B.win.min && !s1.A.win.fs && !s1.B.win.fs);
    if (s1.A.vis === "visible") info(`note: the hidden window's page still says document.visibilityState = "visible" (backgroundThrottling:false), so that can't tell hidden from shown`);
  }
  if (s1[MAC] && !MACOS && macOn(s1) !== shown(s1)) finding(`the X server maps ${macOn(s1)} window(s) of the app, while Electron says ${shown(s1)} is visible: a hidden window may still be on screen. Look at the real screen (the window manager's list) to decide.`);
  if (s1[MAC] && MACOS && macOn(s1) !== shown(s1)) finding(`macOS's own window list (CGWindowList) says ${macOn(s1)} window(s) of the app are on screen (alpha ${s1[MAC].length ? "1" : "-"}), while Electron says ${shown(s1)} is visible (A.isVisible() false after hide()): either the list keeps ordered-out windows or the hidden window is still on screen. Look at the real screen to decide.`);
  flash("opening B", r, s1);
  if (!r.ok) finding(`after the CLI opened B, the frame did not settle on "B in front, one window on screen, two windows" within 40 s: ${show(s1)}`);

  // 3. The Projects bar, as the visible window shows it
  await sleep(3000);
  const snapNow = await snapshot();
  const vis = front(snapNow);
  if (vis === null) finding(`no single visible window to screenshot: ${show(snapNow)}`);
  if (vis && snapNow[vis]) {
    try {
      const png = await snapNow[vis].c.send("Page.captureScreenshot", { format: "png" }, 20000);
      screenshot = path.join(tmp, `projects-bar-${vis}.png`);
      fs.writeFileSync(screenshot, Buffer.from(png.data, "base64"));
      console.log(`SCREENSHOT  ${screenshot}`);
    } catch (e) { info(`screenshot failed: ${e.message}`); }
    try {
      const bar = await snapNow[vis].c.eval(`(() => {
        const items = [...document.querySelectorAll('.part.activitybar .actions-container .action-item')];
        const tops = items.map((e) => ({ label: e.getAttribute('aria-label') || e.querySelector('[aria-label]')?.getAttribute('aria-label') || e.textContent.trim(), y: Math.round(e.getBoundingClientRect().top) }));
        const side = document.querySelector('.part.sidebar');
        return { tops, sideTitle: side && !side.classList.contains('hidden') ? (side.querySelector('.title-label')?.textContent || '') : null, rows: [...document.querySelectorAll('.part.sidebar .project-name, .part.sidebar .project')].length };
      })()`);
      info(`activity bar, top to bottom: ${bar.tops.map((t) => t.label || "(unlabelled)").join(" | ")}`);
      info(`side bar title: ${bar.sideTitle === null ? "(side bar hidden)" : JSON.stringify(bar.sideTitle)}`);
      check("the side bar shows Projects at start", /projects/i.test(bar.sideTitle || ""), String(bar.sideTitle));
    } catch (e) { info(`activity bar read failed: ${e.message}`); }
  }

  // 4. Opening A again (it is open, hidden): its window comes forward, B hides
  r = await track(async () => { await runCli([dirs.a]); return waitFor("bring A forward", settled("A"), 20000); });
  check("opening an open project (A) brings its hidden window forward and hides B", r.ok, show(r.snap));
  flash("bringing A forward", r, r.snap);
  if (r.snap.A && r.snap.B && r.snap.A.win && r.snap.B.win) check("bringing A forward keeps the bounds", bounds(r.snap.A.win, r.snap.B.win), show(r.snap));

  // 5. Bring B forward again, then close it: A must take over
  r = await track(async () => { await runCli([dirs.b]); return waitFor("bring B forward", settled("B"), 20000); });
  flash("bringing B forward", r, r.snap);
  check("opening B again brings B forward", r.ok, show(r.snap));
  const before = r.snap;
  if (!before.B || !before.B.win) return;
  const closed = (s) => !s.B && shown(s) === 1 && front(s) === "A" && total(s) === 1;
  let how;
  r = await track(async () => {
    how = await closeWindowOf(before.B.c);
    let res = await waitFor("close B", closed, 8000);
    if (!res.ok) {
      const now = await snapshot();
      if (now.B) { // the keybinding did nothing: try the palette
        how = await closeWindowViaPalette(now.B.c);
        res = await waitFor("close B (palette)", closed, 15000);
      }
    }
    return res;
  });
  info(`closed B's window with: ${how}`);
  const s5 = r.snap;
  check("closing the visible window B removes it (page gone, one window left)", !s5.B && total(s5) === 1, show(s5));
  check("closing B shows A (the last hidden window): one window on screen, in front", shown(s5) === 1 && front(s5) === "A", show(s5));
  if (s5.A && !s5.A.error) {
    check("A is still alive after B closed", true);
    check("A shows with the bounds B had", !!s5.A.win && bounds(s5.A.win, before.B.win), s5.A.win ? `B had ${before.B.win.w}x${before.B.win.h}@${before.B.win.x},${before.B.win.y}; A has ${s5.A.win.w}x${s5.A.win.h}@${s5.A.win.x},${s5.A.win.y}` : "no window for A");
  }
  flash("closing B", r, before);
  if (s5[MAC] && !MACOS && s5[MAC].length !== shown(s5)) finding(`after B closed, the X server maps ${s5[MAC].length} window(s) of the app while Electron has ${shown(s5)} visible`);
  if (s5[MAC] && MACOS && s5[MAC].length !== total(s5)) finding(`after B closed, macOS's window list still has ${s5[MAC].length} window(s) of the app while Electron has ${total(s5)}: that list keeps closed windows too, so it cannot show a hidden one is gone from the screen`);
  check("the app is still running", !main.gone);
}

(async () => {
  let crashed = false;
  try { await main_(); }
  catch (e) { crashed = true; console.log("ERROR " + (e.stack || e)); }
  finally {
    for (const c of conns.values()) c.close();
    if (inspector) inspector.close();
    cleanup();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${findings.length ? `, ${findings.length} finding(s)` : ""}.`);
  if (screenshot) console.log(`Screenshot of the visible window: ${screenshot}`);
  console.log(`App log: ${logFile}  (temp folder is kept: ${tmp})`);
  for (const f of failed) console.log(`  FAILED: ${f.name}${f.detail ? " (" + f.detail + ")" : ""}`);
  process.exit(crashed || failed.length ? 1 : 0);
})();
