// Lesson pages (Learn mood). Ask a chat in Learn mood to explain something on a webpage: the AI writes a slide deck (one
// HTML file) into that chat's lesson folder, and Kural shows it in Kural's browser next to the chat, with the Explorer
// and the bottom panel (terminal) closed, so the screen is the chat and the lesson. On the page, select text or click a
// visual and "Add to chat" puts it into that chat's message box. The AI changes a slide by editing the file: the page
// reloads by itself.
//
//   Folder:  <globalStorage>/lessons/<chat id>/ (the profile's data folder, like handoffs), 0700. The chat lets the AI
//            write there without asking (writeRoots) and gives it to the AI's program as an extra folder (addDirs).
//            Deleted with the chat.
//   Notice:  a watcher on the folder (not the AI's tool calls: every program writes files its own way, and a command can
//            write one too). A new or changed .html file shows that page; the same file still open just reloads itself.
//   Serve:   server.js (127.0.0.1, a token, the slide runtime, a strict CSP).

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { LessonServer } = require("./server");
const scope = require("../profiles/scope");
const { privateTmp } = require("../paths");
const { log } = require("../log");

const CHAT_ID = /^[A-Za-z0-9_-]{1,80}$/;

class Lessons {
  // hooks: add(chatId, item) → a pill in that chat; inEditor(chatId): the chat shows in an editor (dragged out);
  // keepChat(chatId): the chat on screen in Kural's panel.
  constructor(context, hooks) {
    this.context = context;
    this.hooks = hooks;
    this.watchers = new Map();   // chat id → { watcher, seen: Map(name → mtime), timers: Map }
    this.open = new Map();       // chat id → { file, tab } (the browser tab showing its lesson)
    this.maximized = false;      // (Kural maximized the lesson's editor group: not toggled again)
    this.server = new LessonServer({
      root: (id) => CHAT_ID.test(id) ? this.dir(id) : null,
      media: path.join(context.extensionPath, "media"),
      onAdd: (id, item) => this.hooks.add(id, item),
      log,
    });
    context.subscriptions.push({ dispose: () => this.dispose() });
    if (typeof vscode.window.onDidCloseBrowserTab === "function") {
      context.subscriptions.push(vscode.window.onDidCloseBrowserTab((t) => {
        for (const [id, o] of this.open) if (o.tab === t) this.open.delete(id);
        if (![...this.open.values()].some((o) => o.tab)) this.maximized = false;
      }));
    }
  }

  base() {
    const storage = this.context.globalStorageUri && this.context.globalStorageUri.fsPath;
    return storage ? scope.dir("lessons", "data", storage) : privateTmp("lessons");
  }
  dir(id) { return path.join(this.base(), String(id).replace(/[^A-Za-z0-9_-]/g, "_")); }

  // The chat's folder exists and is watched (from when its AI starts in Learn mood). Returns the folder.
  ensure(id) {
    const dir = this.dir(id);
    try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (e) { log(`lessons: can't make ${dir}: ${e.message}`); return dir; }
    if (this.watchers.has(id)) return dir;
    const seen = new Map(), timers = new Map();
    for (const name of safeList(dir)) seen.set(name, mtime(path.join(dir, name)));   // (lessons from before aren't opened again)
    let watcher;
    try {
      watcher = fs.watch(dir, (ev, name) => {
        name = name && String(name);
        if (!name || !/\.html?$/i.test(name) || name.startsWith(".")) return;
        clearTimeout(timers.get(name));
        // (A file is often written in pieces: wait until it has been quiet a moment.)
        timers.set(name, setTimeout(() => { timers.delete(name); this.changed(id, name, seen); }, 400));
      });
      watcher.on("error", (e) => log(`lessons: stopped watching ${dir}: ${e.message}`));
    } catch (e) { log(`lessons: can't watch ${dir}: ${e.message}`); return dir; }
    this.watchers.set(id, { watcher, seen, timers });
    return dir;
  }

  changed(id, name, seen) {
    const file = path.join(this.dir(id), name);
    const t = mtime(file);
    if (!t || seen.get(name) === t) return;
    seen.set(name, t);
    this.show(id, file).catch((e) => log(`lessons: couldn't show ${name}: ${e.message}`));
  }

  // The lesson in Kural's browser, beside the chat. The same file already open: it reloads itself (lesson.js).
  async show(id, file) {
    const prev = this.open.get(id);
    const tabs = Array.isArray(vscode.window.browserTabs) ? vscode.window.browserTabs : null;
    if (prev && prev.file === file && (tabs ? prev.tab && tabs.includes(prev.tab) : true)) return;
    const url = await this.server.url(id, file);
    log(`lessons: showing ${path.basename(file)} for chat ${id}`);
    // A big screen: only the chat and the lesson.
    await run("workbench.action.closeSidebar");
    await run("workbench.action.closePanel");
    const beside = this.hooks.inEditor(id);   // (the chat is in the editor area: the lesson goes next to it, not over it)
    let tab = null;
    if (typeof vscode.window.openBrowserTab === "function") {
      tab = await vscode.window.openBrowserTab(url, { viewColumn: beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active, preserveFocus: true });
    } else if ((await vscode.commands.getCommands(true)).includes("workbench.action.browser.open")) {
      await vscode.commands.executeCommand("workbench.action.browser.open", { url, openToSide: beside });
    } else {
      await vscode.env.openExternal(vscode.Uri.parse(url));   // (an editor without the Integrated Browser: Add to chat still works)
    }
    this.open.set(id, { file, tab });
    // Code split into several editor groups: the lesson's group takes the whole editor area (once; VS Code's command toggles).
    if (!beside && !this.maximized && vscode.window.tabGroups.all.length > 1) {
      this.maximized = await run("workbench.action.toggleMaximizeEditorGroup");
    }
    await this.hooks.keepChat(id);
  }

  // A chat deleted for good: its lessons too.
  forget(id) {
    const w = this.watchers.get(id);
    if (w) { w.watcher.close(); for (const t of w.timers.values()) clearTimeout(t); this.watchers.delete(id); }
    this.open.delete(id);
    try { fs.rmSync(this.dir(id), { recursive: true, force: true }); } catch { /* best effort */ }
  }

  dispose() {
    for (const w of this.watchers.values()) { w.watcher.close(); for (const t of w.timers.values()) clearTimeout(t); }
    this.watchers.clear();
    this.server.stop();
  }
}

function safeList(dir) { try { return fs.readdirSync(dir).filter((n) => /\.html?$/i.test(n)); } catch { return []; } }
function mtime(f) { try { const s = fs.statSync(f); return s.isFile() ? s.mtimeMs : 0; } catch { return 0; } }
async function run(cmd) {
  try { await vscode.commands.executeCommand(cmd); return true; } catch (e) { log(`lessons: ${cmd}: ${e.message}`); return false; }
}

module.exports = { Lessons };
