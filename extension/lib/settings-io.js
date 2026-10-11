// Take your Kural preferences to another computer (or back after a fresh install): Kural Settings → Export settings /
// Import settings (also "Kural: Export Settings" / "Kural: Import Settings"). One JSON file with what you choose:
//   kural       Kural's own settings (kural.*), as you set them; never program paths (machine-scoped: they differ per computer)
//   editor      your other editor settings (settings.json): theme, font, formatting…
//   keybindings your keyboard shortcuts (keybindings.json)
//   extensions  the extensions you installed (installed again from the marketplace on import)
//   chat        your chat defaults (model, intensity, mode, mood…)
//   devices     your saved devices (name, address, port, user). There's no key or password in them: on the new
//               computer each one needs "Set up again" once (Kural: Devices).
// Other extensions' settings can hold private things: settings whose names (or values) look like passwords, tokens or
// keys are left out of the export, but check the file before you share it.
// A settings file can come from anyone, so import never takes: settings that pick a program, start a terminal, run
// tasks or change security (UNSAFE), shortcuts that type into or run things in the terminal (unsafeKeybinding), or chat
// mode Auto; extensions are listed and installed only after you agree.
const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const FORMAT = "kural-settings", VERSION = 1;
const CHAT_KEY = "kural.chat.last", DEVICES_KEY = "kural.devices.v1";
const own = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);

// settings.json and keybindings.json allow comments and trailing commas (JSONC). cleanJsonc turns the text into plain
// JSON of the SAME length (comments and trailing commas become spaces; strings stay as they are, so a "//" or ",]"
// inside one is kept), so a position in it is the same place in the text (appendKeybindings uses that). BOM dropped.
const stripBom = (t) => String(t || "").replace(/^﻿/, "");
function stringEnd(s, i) {   // s[i] is the opening quote: the index of the closing one (or the end)
  let j = i + 1;
  while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
  return Math.min(j, s.length - 1);
}
function cleanJsonc(text) {
  const s = stripBom(text);
  let out = "", i = 0;
  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (c === '"') { const j = stringEnd(s, i); out += s.slice(i, j + 1); i = j + 1; continue; }
    if (c === "/" && d === "/") { while (i < s.length && s[i] !== "\n") { out += " "; i++; } continue; }
    if (c === "/" && d === "*") { const e = s.indexOf("*/", i + 2), stop = e < 0 ? s.length : e + 2; out += s.slice(i, stop).replace(/[^\n]/g, " "); i = stop; continue; }
    out += c; i++;
  }
  let res = "";   // trailing commas: a "," whose next character (past white space) closes an object or array
  for (let k = 0; k < out.length; k++) {
    const c = out[k];
    if (c === '"') { const j = stringEnd(out, k); res += out.slice(k, j + 1); k = j; continue; }
    if (c === ",") { let j = k + 1; while (j < out.length && /\s/.test(out[j])) j++; if (out[j] === "}" || out[j] === "]") { res += " "; continue; } }
    res += c;
  }
  return res;
}
const parseJsonc = (text) => JSON.parse(cleanJsonc(text).trim() || "null");

// Adds shortcuts to the end of keybindings.json's text, keeping your comments and layout. Throws when the text isn't a
// JSONC array (the caller then imports nothing rather than replacing your file).
function appendKeybindings(text, entries) {
  const s = stripBom(text);
  const block = entries.map((e) => "  " + JSON.stringify(e, null, 2).replace(/\n/g, "\n  ")).join(",\n");
  if (!s.trim()) return `[\n${block}\n]\n`;
  const c = cleanJsonc(s), before = JSON.parse(c);
  if (!Array.isArray(before)) throw new Error("keybindings.json isn't a list");
  if (!entries.length) return s;
  const close = c.lastIndexOf("]");
  let out;
  if (before.length) { const last = c.slice(0, close).search(/\S\s*$/); out = `${s.slice(0, last + 1)},\n${block}${s.slice(last + 1)}`; }
  else out = `${s.slice(0, close)}\n${block}\n${s.slice(close)}`;
  const check = parseJsonc(out);
  if (JSON.stringify(check) !== JSON.stringify([...before, ...entries])) throw new Error("couldn't add to keybindings.json safely");
  return out;
}

// Replaces a file in one step (a temporary file beside it, then a rename): a crash halfway never leaves half a file.
function writeAtomic(file, text) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  let mode = 0o600;
  try { mode = fs.statSync(file).mode & 0o777; } catch { /* a new file */ }
  try { fs.writeFileSync(tmp, text, { mode, flag: "wx" }); fs.renameSync(tmp, file); }
  catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* gone */ } throw e; }
}

// Editor settings an imported file may NOT set: ones that choose a program to run, the terminal's shell, profiles or
// environment, proxies, tasks and security switches. (A denylist: anything else is copied as it is.)
const UNSAFE = [
  /^kural\./i,
  /^terminal\.integrated\.(env|profiles|defaultProfile|automationProfile|automationShell|shell|shellArgs|cwd)\b/i,
  /^terminal\.external\./i,
  /^http\./i, /^security\./i, /^tasks?\./i, /^launch$/i, /^extensions\./i, /^update\./i,
  /(^|\.)[^.]*(path|paths|executable|exec|interpreter|binary|command|commandline|args|shell|server|cmd)$/i,
  /proxy|externalBrowser|allowedLinkSchemes|trust/i,
];
const unsafeSetting = (key) => UNSAFE.some((r) => r.test(String(key)));

// Shortcuts that type text into the terminal or run several commands (a file could bind Enter to "curl … | sh").
function unsafeKeybinding(b) {
  const cmd = String((b && b.command) || "").replace(/^-/, "");
  if (/^(runCommands|workbench\.action\.terminal\.(sendSequence|runSelectedText|runActiveFile|runRecentCommand))$/i.test(cmd)) return true;
  return b.args !== undefined && /^(workbench\.action\.(terminal|tasks)\.|workbench\.action\.(createTerminalEditor|executeCommand))/i.test(cmd);
}

// Names (or values) that look secret: left out of an export.
const SECRET_KEY = /passw(or)?d|passphrase|secret|(?<!semantic)token(?!colou?r)|api[_-]?key|authoriz|auth[_-]?(token|key|header)|credential|cookie|private[_-]?key|proxy/i;
const SECRET_VALUE = /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})|-----BEGIN [A-Z ]*PRIVATE KEY/;
function withoutSecrets(value, dropped, at = "") {
  if (typeof value === "string") return SECRET_VALUE.test(value) ? (dropped.push(at), undefined) : value;
  if (Array.isArray(value)) return value.map((v, i) => withoutSecrets(v, dropped, `${at}[${i}]`)).filter((v) => v !== undefined);
  if (!isObj(value)) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const where = at ? `${at}.${k}` : k;
    if (SECRET_KEY.test(k)) { dropped.push(where); continue; }
    const kept = withoutSecrets(v, dropped, where);
    if (kept !== undefined) out[k] = kept;
  }
  return out;
}

// The user settings folder (…/Kural/User), from Kural's own storage folder (…/User/globalStorage/kural.kural).
const userDir = (context) => path.dirname(path.dirname(context.globalStorageUri.fsPath));
const readJsonc = (file, fallback) => { try { return parseJsonc(fs.readFileSync(file, "utf8")); } catch { return fallback; } };

// Kural's settings as you set them (user level), without the machine-scoped ones (program paths).
function kuralSettings(packageJSON, inspect) {
  const props = (packageJSON.contributes && packageJSON.contributes.configuration && packageJSON.contributes.configuration.properties) || {};
  const out = {};
  for (const [key, p] of Object.entries(props)) {
    if (p.scope === "machine" || p.scope === "machine-overridable") continue;
    const v = inspect(key.replace(/^kural\./, ""));
    if (v !== undefined) out[key] = v;
  }
  return out;
}

// The whole file, from the parts you chose. `dropped` (optional) collects the settings left out as secret-looking.
function build({ parts, packageJSON, inspect, userSettings, keybindings, extensions, chat, devices, version, dropped = [] }) {
  const out = { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), from: `Kural ${version}`, platform: process.platform };
  if (parts.includes("kural")) out.kural = withoutSecrets(kuralSettings(packageJSON, inspect), dropped);
  if (parts.includes("editor")) out.editor = withoutSecrets(Object.fromEntries(Object.entries(userSettings || {}).filter(([k]) => !k.startsWith("kural."))), dropped);
  if (parts.includes("keybindings")) out.keybindings = Array.isArray(keybindings) ? withoutSecrets(keybindings, dropped) : [];
  if (parts.includes("extensions")) out.extensions = extensions || [];
  if (parts.includes("chat") && chat) out.chat = chat;
  if (parts.includes("devices")) out.devices = (devices || []).map(({ id, name, host, port, user, system }) => ({ id, name, host, port, user, system }));
  return out;
}

// What's in a file, for the import's checklist: [{ id, label, detail }].
function contents(data, packageJSON) {
  const known = new Set(Object.keys((packageJSON.contributes.configuration || {}).properties || {}));
  const items = [];
  const n = (x) => isObj(x) ? Object.keys(x).length : 0;
  if (n(data.kural)) items.push({ id: "kural", label: "Kural settings", detail: `${n(data.kural)} setting${n(data.kural) === 1 ? "" : "s"}${Object.keys(data.kural).some((k) => !known.has(k)) ? " (ones this version doesn't know are skipped)" : ""}` });
  if (n(data.editor)) items.push({ id: "editor", label: "Editor settings", detail: `${n(data.editor)} setting${n(data.editor) === 1 ? "" : "s"}: theme, font, formatting… (never program paths, terminal, proxy or security settings)` });
  if (Array.isArray(data.keybindings) && data.keybindings.length) items.push({ id: "keybindings", label: "Keyboard shortcuts", detail: `${data.keybindings.length} shortcut${data.keybindings.length === 1 ? "" : "s"} (added to yours; never ones that type into the terminal)` });
  if (Array.isArray(data.extensions) && data.extensions.length) items.push({ id: "extensions", label: "Extensions", detail: `${data.extensions.length} to install (you see the list first)` });
  if (isObj(data.chat)) items.push({ id: "chat", label: "Chat defaults", detail: "model, intensity, mode, mood for new chats" });
  if (Array.isArray(data.devices) && data.devices.length) items.push({ id: "devices", label: "Devices", detail: `${data.devices.length} device${data.devices.length === 1 ? "" : "s"}: each needs "Set up again" once (no keys in the file)` });
  return items;
}

// Imported shortcuts are added after yours; one that's already there exactly isn't added twice.
function mergeKeybindings(mine, theirs) {
  const key = (b) => JSON.stringify([b.key, b.command, b.when || "", b.args === undefined ? null : b.args]);
  const have = new Set((mine || []).map(key));
  return [...(mine || []), ...(theirs || []).filter((b) => b && typeof b.key === "string" && typeof b.command === "string" && !have.has(key(b)))];
}

// Chat defaults from a file: only the fields Kural keeps, and never Auto (it runs commands without asking).
const CHAT_FIELDS = ["model", "effort", "mode", "team", "autoRoute", "routingProfile", "mood", "roles", "teamStyle", "buildMode"];
function safeChat(chat) {
  const out = {};
  for (const k of CHAT_FIELDS) if (own(chat, k) && chat[k] !== "auto") out[k] = chat[k];
  return out;
}

// What an import would change, decided without touching anything (the tests use it): { kural, editor, keybindings,
// skipped: { editor: [keys], kural: [keys], keybindings: [entries] } }.
function plan(data, packageJSON, mine = []) {
  const known = (packageJSON.contributes.configuration || {}).properties || {};
  const skipped = { kural: [], editor: [], keybindings: [] }, kural = [], editor = [];
  for (const [key, value] of Object.entries(isObj(data.kural) ? data.kural : {})) {
    const p = own(known, key) ? known[key] : null;
    if (!p) continue;
    if (p.scope === "machine" || p.scope === "machine-overridable" || (key === "kural.chat.mode" && value === "auto")) skipped.kural.push(key);
    else kural.push([key, value]);
  }
  for (const [key, value] of Object.entries(isObj(data.editor) ? data.editor : {})) (unsafeSetting(key) ? skipped.editor.push(key) : editor.push([key, value]));
  const theirs = Array.isArray(data.keybindings) ? data.keybindings : [];
  const ok = theirs.filter((b) => { if (b && unsafeKeybinding(b)) { skipped.keybindings.push(b); return false; } return true; });
  const keybindings = mergeKeybindings(mine, ok).slice((mine || []).length);
  return { kural, editor, keybindings, skipped };
}

function installedExtensions() {
  const app = vscode.env.appRoot;
  return vscode.extensions.all.filter((e) => !e.extensionPath.startsWith(app) && !e.id.startsWith("vscode.") && e.id !== "kural.kural").map((e) => e.id).sort();
}

const PARTS = [
  { id: "kural", label: "Kural settings", detail: "everything under kural.* you changed (not program paths)", picked: true },
  { id: "editor", label: "Editor settings", detail: "your settings.json: theme, font, formatting… (ones that look like passwords or tokens are left out)", picked: true },
  { id: "keybindings", label: "Keyboard shortcuts", detail: "your keybindings.json", picked: true },
  { id: "extensions", label: "Extensions", detail: "the list of extensions you installed", picked: true },
  { id: "chat", label: "Chat defaults", detail: "model, intensity, mode, mood for new chats", picked: true },
  { id: "devices", label: "Devices", detail: "names and addresses (no keys or passwords)", picked: true },
];

async function exportSettings(context) {
  const pick = await vscode.window.showQuickPick(PARTS, { canPickMany: true, title: "Export Kural settings: what to include" });
  if (!pick || !pick.length) return;
  const cfg = vscode.workspace.getConfiguration("kural"), dropped = [];
  const data = build({
    parts: pick.map((p) => p.id), packageJSON: context.extension.packageJSON, version: context.extension.packageJSON.version, dropped,
    inspect: (k) => { const i = cfg.inspect(k); return i ? i.globalValue : undefined; },
    userSettings: readJsonc(path.join(userDir(context), "settings.json"), {}),
    keybindings: readJsonc(path.join(userDir(context), "keybindings.json"), []),
    extensions: installedExtensions(),
    chat: context.globalState.get(CHAT_KEY), devices: context.globalState.get(DEVICES_KEY),
  });
  const target = await vscode.window.showSaveDialog({ title: "Export Kural settings", saveLabel: "Export",
    defaultUri: vscode.Uri.file(path.join(os.homedir(), `kural-settings-${new Date().toISOString().slice(0, 10)}.json`)), filters: { "Kural settings": ["json"] } });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(data, null, 2) + "\n", "utf8"));
  const counts = [data.kural && `${Object.keys(data.kural).length} Kural settings`, data.editor && `${Object.keys(data.editor).length} editor settings`,
    data.keybindings && `${data.keybindings.length} shortcuts`, data.extensions && `${data.extensions.length} extensions`, data.devices && `${data.devices.length} devices`].filter(Boolean);
  const left = dropped.length ? ` Left out ${dropped.length} that looked secret (${dropped.slice(0, 3).join(", ")}${dropped.length > 3 ? "…" : ""}).` : "";
  vscode.window.showInformationMessage(`Kural: exported ${counts.join(", ") || "your settings"} to ${path.basename(target.fsPath)}.${left} Other extensions' settings can still hold private things: check the file before you share it.`);
}

async function importSettings(context, devices = null) {
  const files = await vscode.window.showOpenDialog({ title: "Import Kural settings", openLabel: "Import", canSelectMany: false, filters: { "Kural settings": ["json"] },
    defaultUri: vscode.Uri.file(os.homedir()) });
  if (!files || !files.length) return;
  let data;
  try { data = JSON.parse(stripBom(Buffer.from(await vscode.workspace.fs.readFile(files[0])).toString("utf8"))); } catch { data = null; }
  if (!isObj(data) || data.format !== FORMAT) { vscode.window.showWarningMessage("Kural: that isn't a Kural settings file (made with Export settings)."); return; }
  const pkg = context.extension.packageJSON, items = contents(data, pkg);
  if (!items.length) { vscode.window.showInformationMessage("Kural: that settings file is empty."); return; }
  const pick = await vscode.window.showQuickPick(items.map((i) => ({ ...i, picked: true })), { canPickMany: true, title: `Import Kural settings from ${String(data.from || "a file").slice(0, 80)}` });
  if (!pick || !pick.length) return;
  const want = new Set(pick.map((p) => p.id)), done = [], notes = [];
  const kbFile = path.join(userDir(context), "keybindings.json");
  // Your keybindings.json as it is now. Unreadable (not JSONC) → no shortcuts are imported, the file isn't touched.
  let kbText = "", mine = [];
  if (want.has("keybindings")) {
    try { kbText = fs.readFileSync(kbFile, "utf8"); } catch (e) { if (e.code !== "ENOENT") mine = null; }
    if (mine) { try { mine = kbText.trim() ? parseJsonc(kbText) : []; } catch { mine = null; } }
    if (!Array.isArray(mine)) mine = null;
  }
  const p = plan(data, pkg, mine || []);
  const listed = (keys) => `${keys.slice(0, 4).join(", ")}${keys.length > 4 ? "…" : ""}`;
  if (want.has("kural")) {
    const cfg = vscode.workspace.getConfiguration("kural");
    let n = 0;
    for (const [key, value] of p.kural) { await cfg.update(key.replace(/^kural\./, ""), value, vscode.ConfigurationTarget.Global); n++; }
    done.push(`${n} Kural setting${n === 1 ? "" : "s"}`);
    if (p.skipped.kural.length) notes.push(`Not imported: ${listed(p.skipped.kural)} (program paths and chat mode Auto are set on this computer only).`);
  }
  if (want.has("editor")) {
    const all = vscode.workspace.getConfiguration();
    let n = 0;
    for (const [key, value] of p.editor) {
      try { await all.update(key, value, vscode.ConfigurationTarget.Global); n++; } catch { /* a setting of an extension you don't have */ }
    }
    done.push(`${n} editor setting${n === 1 ? "" : "s"}`);
    if (p.skipped.editor.length) notes.push(`Not imported, for safety (programs, terminal, proxy, tasks, security): ${listed(p.skipped.editor)}.`);
  }
  if (want.has("keybindings")) {
    if (!mine) notes.push("Your keybindings.json couldn't be read, so no shortcuts were imported (fix the file, then import again).");
    else {
      const added = p.keybindings.length;
      if (added) writeAtomic(kbFile, appendKeybindings(kbText, p.keybindings));
      done.push(`${added} shortcut${added === 1 ? "" : "s"}`);
    }
    if (p.skipped.keybindings.length) notes.push(`Skipped ${p.skipped.keybindings.length} shortcut${p.skipped.keybindings.length === 1 ? "" : "s"} that type into or run commands in the terminal.`);
  }
  if (want.has("chat") && isObj(data.chat)) {
    await context.globalState.update(CHAT_KEY, { ...(context.globalState.get(CHAT_KEY) || {}), ...safeChat(data.chat) });
    done.push("chat defaults");
  }
  if (want.has("devices") && Array.isArray(data.devices)) {
    const mine = context.globalState.get(DEVICES_KEY) || [];
    const have = new Set(mine.map((d) => `${d.user}@${d.host}:${d.port || 22}`));
    const add = data.devices.filter((d) => d && d.host && d.user && !have.has(`${d.user}@${d.host}:${d.port || 22}`))
      .map((d) => ({ id: typeof d.id === "string" && /^[\w-]{1,40}$/.test(d.id) ? d.id : crypto.randomBytes(5).toString("hex"), name: String(d.name || d.host), host: String(d.host), port: Number(d.port) || 22, user: String(d.user), system: typeof d.system === "string" ? d.system : "" }));
    if (add.length) { await context.globalState.update(DEVICES_KEY, [...mine, ...add]); if (devices && devices.changed) devices.changed(); }
    done.push(`${add.length} device${add.length === 1 ? "" : "s"}`);
    if (add.length) notes.push(`Set up each device again once (Kural: Devices): its key isn't in the file.`);
  }
  if (want.has("extensions") && Array.isArray(data.extensions)) {
    const have = new Set(vscode.extensions.all.map((e) => e.id.toLowerCase()));
    const missing = [...new Set(data.extensions.filter((id) => typeof id === "string" && /^[\w-]+\.[\w.-]+$/.test(id) && !have.has(id.toLowerCase())))];
    let ok = 0;
    // Extensions run code on this computer: show exactly which ones before installing any.
    const yes = missing.length && await vscode.window.showWarningMessage(
      `Install ${missing.length} extension${missing.length === 1 ? "" : "s"} from the marketplace? Extensions can run code on this computer. Only install ones you know.`,
      { modal: true, detail: missing.join("\n") }, "Install") === "Install";
    if (yes) {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Kural: installing extensions" }, async (progress) => {
        for (const id of missing) {
          progress.report({ message: id });
          try { await vscode.commands.executeCommand("workbench.extensions.installExtension", id); ok++; } catch { notes.push(`${id} couldn't be installed (not in the marketplace Kural uses?)`); }
        }
      });
    } else if (missing.length) notes.push("Extensions weren't installed.");
    done.push(`${ok} extension${ok === 1 ? "" : "s"} installed`);
  }
  vscode.window.showInformationMessage(`Kural: imported ${done.join(", ")}.${notes.length ? ` ${notes.join(" ")}` : ""}`);
}

module.exports = { exportSettings, importSettings, parseJsonc, cleanJsonc, appendKeybindings, writeAtomic, unsafeSetting, unsafeKeybinding,
  withoutSecrets, safeChat, plan, kuralSettings, build, contents, mergeKeybindings, FORMAT };
