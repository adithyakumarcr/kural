// Take your Kural preferences to another computer (or back after a fresh install): Kural Settings → Export settings /
// Import settings (also "Kural: Export Settings" / "Kural: Import Settings"). One JSON file with what you choose:
//   kural       Kural's own settings (kural.*), as you set them; never program paths (machine-scoped: they differ per computer)
//   editor      your other editor settings (settings.json): theme, font, formatting…
//   keybindings your keyboard shortcuts (keybindings.json)
//   extensions  the extensions you installed (installed again from the marketplace on import)
//   chat        your chat defaults (model, intensity, mode, mood…)
//   devices     your saved devices (name, address, port, user). There's no key or password in them: on the new
//               computer each one needs "Set up again" once (Kural: Devices).
// Nothing secret is in the file: Kural keeps no passwords or keys in settings, and logins stay with each AI's program.
const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");

const FORMAT = "kural-settings", VERSION = 1;
const CHAT_KEY = "kural.chat.last", DEVICES_KEY = "kural.devices.v1";

// settings.json and keybindings.json allow comments and trailing commas (JSONC).
function parseJsonc(text) {
  let out = "", i = 0, inStr = false;
  const s = String(text || "");
  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (inStr) { out += c; if (c === "\\") { out += d || ""; i += 2; continue; } if (c === '"') inStr = false; i++; continue; }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === "/" && d === "/") { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++; i += 2; continue; }
    out += c; i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1") || "null");
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

// The whole file, from the parts you chose.
function build({ parts, packageJSON, inspect, userSettings, keybindings, extensions, chat, devices, version }) {
  const out = { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), from: `Kural ${version}`, platform: process.platform };
  if (parts.includes("kural")) out.kural = kuralSettings(packageJSON, inspect);
  if (parts.includes("editor")) out.editor = Object.fromEntries(Object.entries(userSettings || {}).filter(([k]) => !k.startsWith("kural.")));
  if (parts.includes("keybindings")) out.keybindings = Array.isArray(keybindings) ? keybindings : [];
  if (parts.includes("extensions")) out.extensions = extensions || [];
  if (parts.includes("chat") && chat) out.chat = chat;
  if (parts.includes("devices")) out.devices = (devices || []).map(({ id, name, host, port, user, system }) => ({ id, name, host, port, user, system }));
  return out;
}

// What's in a file, for the import's checklist: [{ id, label, detail }].
function contents(data, packageJSON) {
  const known = new Set(Object.keys((packageJSON.contributes.configuration || {}).properties || {}));
  const items = [];
  const n = (x) => Object.keys(x || {}).length;
  if (data.kural && n(data.kural)) items.push({ id: "kural", label: "Kural settings", detail: `${n(data.kural)} setting${n(data.kural) === 1 ? "" : "s"}${Object.keys(data.kural).some((k) => !known.has(k)) ? " (ones this version doesn't know are skipped)" : ""}` });
  if (data.editor && n(data.editor)) items.push({ id: "editor", label: "Editor settings", detail: `${n(data.editor)} setting${n(data.editor) === 1 ? "" : "s"}: theme, font, formatting…` });
  if (Array.isArray(data.keybindings) && data.keybindings.length) items.push({ id: "keybindings", label: "Keyboard shortcuts", detail: `${data.keybindings.length} shortcut${data.keybindings.length === 1 ? "" : "s"} (added to yours)` });
  if (Array.isArray(data.extensions) && data.extensions.length) items.push({ id: "extensions", label: "Extensions", detail: `${data.extensions.length} to install (the ones you don't have yet)` });
  if (data.chat) items.push({ id: "chat", label: "Chat defaults", detail: "model, intensity, mode, mood for new chats" });
  if (Array.isArray(data.devices) && data.devices.length) items.push({ id: "devices", label: "Devices", detail: `${data.devices.length} device${data.devices.length === 1 ? "" : "s"}: each needs "Set up again" once (no keys in the file)` });
  return items;
}

// Imported shortcuts are added after yours; one that's already there exactly isn't added twice.
function mergeKeybindings(mine, theirs) {
  const key = (b) => JSON.stringify([b.key, b.command, b.when || "", b.args === undefined ? null : b.args]);
  const have = new Set((mine || []).map(key));
  return [...(mine || []), ...(theirs || []).filter((b) => b && b.key && b.command && !have.has(key(b)))];
}

function installedExtensions() {
  const app = vscode.env.appRoot;
  return vscode.extensions.all.filter((e) => !e.extensionPath.startsWith(app) && !e.id.startsWith("vscode.") && e.id !== "kural.kural").map((e) => e.id).sort();
}

const PARTS = [
  { id: "kural", label: "Kural settings", detail: "everything under kural.* you changed (not program paths)", picked: true },
  { id: "editor", label: "Editor settings", detail: "your settings.json: theme, font, formatting…", picked: true },
  { id: "keybindings", label: "Keyboard shortcuts", detail: "your keybindings.json", picked: true },
  { id: "extensions", label: "Extensions", detail: "the list of extensions you installed", picked: true },
  { id: "chat", label: "Chat defaults", detail: "model, intensity, mode, mood for new chats", picked: true },
  { id: "devices", label: "Devices", detail: "names and addresses (no keys or passwords)", picked: true },
];

async function exportSettings(context) {
  const pick = await vscode.window.showQuickPick(PARTS, { canPickMany: true, title: "Export Kural settings: what to include" });
  if (!pick || !pick.length) return;
  const cfg = vscode.workspace.getConfiguration("kural");
  const data = build({
    parts: pick.map((p) => p.id), packageJSON: context.extension.packageJSON, version: context.extension.packageJSON.version,
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
  vscode.window.showInformationMessage(`Kural: exported ${counts.join(", ") || "your settings"} to ${path.basename(target.fsPath)}.`);
}

async function importSettings(context, devices = null) {
  const files = await vscode.window.showOpenDialog({ title: "Import Kural settings", openLabel: "Import", canSelectMany: false, filters: { "Kural settings": ["json"] },
    defaultUri: vscode.Uri.file(os.homedir()) });
  if (!files || !files.length) return;
  let data;
  try { data = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(files[0])).toString("utf8")); } catch { data = null; }
  if (!data || data.format !== FORMAT) { vscode.window.showWarningMessage("Kural: that isn't a Kural settings file (made with Export settings)."); return; }
  const pkg = context.extension.packageJSON, items = contents(data, pkg);
  if (!items.length) { vscode.window.showInformationMessage("Kural: that settings file is empty."); return; }
  const pick = await vscode.window.showQuickPick(items.map((i) => ({ ...i, picked: true })), { canPickMany: true, title: `Import Kural settings from ${data.from || "a file"}` });
  if (!pick || !pick.length) return;
  const want = new Set(pick.map((p) => p.id)), done = [], notes = [];
  const known = (pkg.contributes.configuration || {}).properties || {};
  if (want.has("kural")) {
    const cfg = vscode.workspace.getConfiguration("kural");
    let n = 0;
    for (const [key, value] of Object.entries(data.kural)) {
      const p = known[key];
      if (!p || p.scope === "machine" || p.scope === "machine-overridable") continue;
      await cfg.update(key.replace(/^kural\./, ""), value, vscode.ConfigurationTarget.Global); n++;
    }
    done.push(`${n} Kural setting${n === 1 ? "" : "s"}`);
  }
  if (want.has("editor")) {
    const all = vscode.workspace.getConfiguration();
    let n = 0;
    for (const [key, value] of Object.entries(data.editor)) {
      try { await all.update(key, value, vscode.ConfigurationTarget.Global); n++; } catch { /* a setting of an extension you don't have */ }
    }
    done.push(`${n} editor setting${n === 1 ? "" : "s"}`);
  }
  if (want.has("keybindings")) {
    const file = path.join(userDir(context), "keybindings.json");
    const mine = readJsonc(file, []), merged = mergeKeybindings(Array.isArray(mine) ? mine : [], data.keybindings);
    const added = merged.length - (Array.isArray(mine) ? mine.length : 0);
    if (added) fs.writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");
    done.push(`${added} shortcut${added === 1 ? "" : "s"}`);
  }
  if (want.has("chat") && data.chat && typeof data.chat === "object") {
    await context.globalState.update(CHAT_KEY, { ...(context.globalState.get(CHAT_KEY) || {}), ...data.chat });
    done.push("chat defaults");
  }
  if (want.has("devices") && Array.isArray(data.devices)) {
    const mine = context.globalState.get(DEVICES_KEY) || [];
    const have = new Set(mine.map((d) => `${d.user}@${d.host}:${d.port || 22}`));
    const add = data.devices.filter((d) => d && d.host && d.user && !have.has(`${d.user}@${d.host}:${d.port || 22}`))
      .map((d) => ({ id: d.id || Math.random().toString(36).slice(2, 10), name: String(d.name || d.host), host: String(d.host), port: Number(d.port) || 22, user: String(d.user), system: d.system || "" }));
    if (add.length) { await context.globalState.update(DEVICES_KEY, [...mine, ...add]); if (devices && devices.changed) devices.changed(); }
    done.push(`${add.length} device${add.length === 1 ? "" : "s"}`);
    if (add.length) notes.push(`Set up each device again once (Kural: Devices): its key isn't in the file.`);
  }
  if (want.has("extensions")) {
    const have = new Set(vscode.extensions.all.map((e) => e.id.toLowerCase()));
    const missing = data.extensions.filter((id) => typeof id === "string" && /^[\w-]+\.[\w.-]+$/.test(id) && !have.has(id.toLowerCase()));
    let ok = 0;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Kural: installing extensions" }, async (progress) => {
      for (const id of missing) {
        progress.report({ message: id });
        try { await vscode.commands.executeCommand("workbench.extensions.installExtension", id); ok++; } catch { notes.push(`${id} couldn't be installed (not in the marketplace Kural uses?)`); }
      }
    });
    done.push(`${ok} extension${ok === 1 ? "" : "s"} installed`);
  }
  vscode.window.showInformationMessage(`Kural: imported ${done.join(", ")}.${notes.length ? ` ${notes.join(" ")}` : ""}`);
}

module.exports = { exportSettings, importSettings, parseJsonc, kuralSettings, build, contents, mergeKeybindings, FORMAT };
