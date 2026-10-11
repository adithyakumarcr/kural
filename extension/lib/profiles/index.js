// Profiles: a personal and a work Kural, each with its own Claude / ChatGPT accounts, switched from the status bar.
//
//   store.js   the list of profiles and which is active (no vscode)
//   env.js     the variables that give Claude Code and Codex their own login folder (no vscode)
//   scope.js   which saved data is a profile's own and which is shared (no vscode)
//   index.js   this file: apply the active profile at startup, the status bar item, switch / new / manage (QuickPicks)
//
// Switching reloads the window: every program Kural started (Claude, Codex, their helpers) belongs to one account, so the
// simple and safe way to change accounts is to start them all again after the change. The window comes back in a second
// or two with the other profile's logins, chats (or the shared ones) and usage numbers.
// Other Kural windows keep the profile they started with until they are reloaded.

const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { ProfileStore, MAIN, MAX_NAME } = require("./store");
const { setProfileEnv, envFor, claudeKeepsLoginPerFolder, MIN_KEYCHAIN_CLAUDE } = require("./env");
const scope = require("./scope");
const { log } = require("../ai/claude");

const KEY = "kural.profiles.v1";
const SETUP_KEY = "kural.profiles.setupFor";   // a profile just made: after the reload, Get started opens for its logins
const ICON = { personal: "person", work: "briefcase" };
const KIND_LABEL = { personal: "Personal", work: "Work" };
const SAME_GEMINI = "Google Gemini uses the same account in every profile.";

// Called first thing in activate(), before anything starts Claude / Codex or reads chats: makes this window run as the
// active profile. Returns the store.
function applyActive(context) {
  const store = new ProfileStore(() => context.globalState.get(KEY), (v) => context.globalState.update(KEY, v));
  const p = store.active();
  const storage = context.globalStorageUri.fsPath;
  scope.configure({ storage, profile: p });
  const dir = scope.profileDir(storage, p.id);
  if (dir) {
    // The logins live in here: only you may read them.
    for (const sub of ["claude", "codex"]) { try { fs.mkdirSync(path.join(dir, sub), { recursive: true, mode: 0o700 }); } catch (e) { log(`profiles: ${e.message}`); } }
  }
  setProfileEnv(envFor(dir));
  return store;
}

class Profiles {
  // store: from applyActive. hooks: { busy(): a chat is answering, flush(): Promise (save what the window keeps),
  // changed(profile): the active profile's name changed, logout(dir): best-effort log out of a folder's accounts }
  constructor(context, store, hooks = {}) {
    this.context = context;
    this.store = store;
    this.hooks = hooks;
    this.item = vscode.window.createStatusBarItem("kural.profile", vscode.StatusBarAlignment.Right, 103);
    this.item.name = "Kural Profile";
    this.item.command = "kural.profiles.switch";
  }

  register() {
    this.context.subscriptions.push(this.item,
      vscode.commands.registerCommand("kural.profiles.switch", () => this.switchPick()),
      vscode.commands.registerCommand("kural.profiles.new", () => this.create()),
      vscode.commands.registerCommand("kural.profiles.manage", () => this.manage()));
    this.draw();
    this.item.show();
    log(`profiles: running as "${this.store.active().name}" (${scope.profileId()})`);
  }

  // The item is short on purpose: an icon and the name.
  draw() {
    const p = this.store.active();
    const name = p.name.length > 14 ? `${p.name.slice(0, 13)}…` : p.name;
    this.item.text = `$(${ICON[p.kind] || "person"}) ${name}`;
    const md = new vscode.MarkdownString(`**Profile: ${p.name}** · click to switch\n\n${SAME_GEMINI}`);
    md.supportThemeIcons = true;
    this.item.tooltip = md;
    this.item.accessibilityInformation = { label: `Profile ${p.name}; click to switch`, role: "button" };
    if (this.hooks.changed) this.hooks.changed(p);
  }

  describe(p) {
    const kind = KIND_LABEL[p.kind] || "Personal";
    return p.id === MAIN ? `${kind} · main profile` : `${kind} · ${p.share ? "shares data" : "own data"}`;
  }

  // ---------- switch ----------
  async switchPick() {
    const d = this.store.data();
    const items = d.list.map((p) => ({
      label: `${p.id === d.active ? "$(check) " : ""}$(${ICON[p.kind] || "person"}) ${p.name}`, description: this.describe(p), id: p.id }));
    items.push({ label: "", kind: vscode.QuickPickItemKind.Separator },
      { label: "$(add) New profile…", id: "@new" }, { label: "$(gear) Manage profiles…", id: "@manage" });
    const pick = await vscode.window.showQuickPick(items, { title: "Switch profile",
      placeHolder: `Each profile has its own Claude and ChatGPT accounts. Switching reloads this window; other Kural windows keep theirs until reloaded. ${SAME_GEMINI}` });
    if (!pick) return;
    if (pick.id === "@new") return this.create();
    if (pick.id === "@manage") return this.manage();
    if (pick.id !== d.active) await this.switchTo(pick.id);
  }

  // Save the active profile, then reload so everything starts again with it.
  async switchTo(id, setup) {
    if (this.hooks.busy && this.hooks.busy()) {
      const ok = await vscode.window.showWarningMessage("A chat is still working. Switch anyway?", { modal: true,
        detail: "Switching reloads this window, which stops the answer being written." }, "Switch");
      if (ok !== "Switch") return false;
    }
    try {
      if (this.hooks.flush) await this.hooks.flush();   // (this profile's open tabs and usage, under this profile's keys)
      if (setup) await this.context.globalState.update(SETUP_KEY, id);
      await this.store.setActive(id);
    } catch (e) { vscode.window.showErrorMessage(`Kural couldn't switch the profile: ${e.message}`); return false; }
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
    return true;
  }

  // After the reload into a profile that was just made: nothing is set up there, so open Get started for its logins.
  // (Called once Get started exists. Not every start: only for the profile that was just created.)
  openSetupIfNew(getStarted) {
    const want = this.context.globalState.get(SETUP_KEY);
    if (!want) return;
    this.context.globalState.update(SETUP_KEY, undefined);
    if (want === scope.profileId() && !getStarted.ready) setTimeout(() => getStarted.open(), 1500);
  }

  // ---------- new ----------
  // { found, version, ok }: is this computer's Claude Code new enough to keep each profile's login apart (a Mac's keychain)?
  async claudeCheck() {
    const v = this.hooks.claudeVersion ? await this.hooks.claudeVersion().catch(() => null) : null;
    return { found: v !== undefined && v !== "none", version: v && v !== "none" ? v : null, ok: v === "none" || claudeKeepsLoginPerFolder(v) };
  }

  async create() {
    const cc = await this.claudeCheck();
    if (!cc.ok) {
      vscode.window.showErrorMessage(`Kural can't make a profile yet: your Claude Code${cc.version ? ` (${cc.version})` : ""} is older than ${MIN_KEYCHAIN_CLAUDE}. On a Mac, an older Claude Code keeps one login for every folder, so a profile's login would replace your main one. Update Claude Code (run "claude update" in a terminal), then try again.`, { modal: true });
      return;
    }
    const kind = await vscode.window.showQuickPick([
      { label: "$(person) Personal", description: "for your own projects", kind: "personal" },
      { label: "$(briefcase) Work", description: "for your job", kind: "work" }],
      { title: "New profile (1 of 3): what kind?", placeHolder: "A profile has its own Claude and ChatGPT accounts. You name it next." });
    if (!kind) return;
    const taken = (n) => !!this.store.checkName(n);
    let suggestion = KIND_LABEL[kind.kind], i = 2;
    while (taken(suggestion)) suggestion = `${KIND_LABEL[kind.kind]} ${i++}`;
    const name = await vscode.window.showInputBox({ title: "New profile (2 of 3): name", value: suggestion, valueSelection: [0, suggestion.length],
      prompt: `Up to ${MAX_NAME} characters. You log in to this profile's Claude and ChatGPT accounts yourself. ${SAME_GEMINI}`,
      validateInput: (v) => this.store.checkName(v) });
    if (name === undefined) return;
    const share = await vscode.window.showQuickPick([
      { label: "$(link) Share", description: "chats, History, open tabs and Tab Completion's memory are the same as your main profile's", share: true },
      { label: "$(lock) Keep separate", description: "this profile has its own chats and History", share: false }],
      { title: "New profile (3 of 3): share chats and history with your other profiles?", placeHolder: "You can change this later in Manage profiles. Logins and usage are always separate." });
    if (!share) return;
    let p;
    try { p = await this.store.create({ name, kind: kind.kind, share: share.share }); }
    catch (e) { vscode.window.showErrorMessage(`Kural: ${e.message}`); return; }
    log(`profiles: made "${p.name}" (${p.id}, ${p.kind}, ${p.share ? "shared" : "separate"} data)`);
    await this.switchTo(p.id, true);   // (reloads; Get started then opens for its logins)
  }

  // ---------- manage ----------
  async manage() {
    const d = this.store.data();
    const pick = await vscode.window.showQuickPick(d.list.map((p) => ({
      label: `${p.id === d.active ? "$(check) " : ""}$(${ICON[p.kind] || "person"}) ${p.name}`, description: this.describe(p), id: p.id })),
      { title: "Manage profiles", placeHolder: "Pick a profile to rename, share or delete" });
    if (!pick) return;
    const p = this.store.get(pick.id), isActive = p.id === this.store.data().active;
    const actions = [{ label: "$(edit) Rename…", act: "rename" }];
    if (p.id !== MAIN) {
      actions.push({ label: p.share ? "$(lock) Stop sharing data" : "$(link) Share data with the main profile", act: "share",
        description: p.share ? "give it its own chats and History from now on" : "use the main profile's chats and History" });
      actions.push({ label: "$(trash) Delete…", act: "delete", description: isActive ? "it is in use: switch to another profile first" : "" });
    }
    const a = await vscode.window.showQuickPick(actions, { title: `Manage "${p.name}"` });
    if (!a) return;
    if (a.act === "rename") return this.rename(p);
    if (a.act === "share") return this.toggleShare(p, isActive);
    if (a.act === "delete") return this.remove(p, isActive);
  }

  async rename(p) {
    const name = await vscode.window.showInputBox({ title: `Rename "${p.name}"`, value: p.name, valueSelection: [0, p.name.length],
      validateInput: (v) => this.store.checkName(v, p.id) });
    if (name === undefined || name.trim() === p.name) return;
    try { await this.store.rename(p.id, name); } catch (e) { vscode.window.showErrorMessage(`Kural: ${e.message}`); return; }
    this.draw();
  }

  // Turning sharing on or off changes which chats this profile shows; the window reloads when it is the active one.
  async toggleShare(p, isActive) {
    const to = !p.share;
    const ok = await vscode.window.showWarningMessage(to ? `Share "${p.name}" with the main profile?` : `Stop sharing "${p.name}"?`, { modal: true,
      detail: to ? "From now on this profile shows the main profile's chats, History, open tabs and Tab Completion's memory. What it had of its own is kept on disk but not shown."
        : "From now on this profile has its own chats, History, open tabs and Tab Completion's memory (empty at first, unless it had its own before). The main profile's stay as they are." }, to ? "Share" : "Keep separate");
    if (!ok) return;
    if (isActive) {
      if (this.hooks.busy && this.hooks.busy()) {
        const go = await vscode.window.showWarningMessage("A chat is still working. Switch anyway?", { modal: true, detail: "This reloads the window." }, "Switch");
        if (go !== "Switch") return;
      }
      if (this.hooks.flush) await this.hooks.flush();
    }
    try { await this.store.setShare(p.id, to); } catch (e) { vscode.window.showErrorMessage(`Kural: ${e.message}`); return; }
    if (isActive) await vscode.commands.executeCommand("workbench.action.reloadWindow");
    else vscode.window.setStatusBarMessage(`"${p.name}" ${to ? "shares" : "keeps its own"} data`, 2500);
  }

  async remove(p, isActive) {
    if (isActive) { vscode.window.showInformationMessage(`"${p.name}" is in use. Switch to another profile first, then delete it.`); return; }
    const cc = await this.claudeCheck();
    const detail = `Close other Kural windows that use this profile first.\n\n` + (cc.ok ? "" : `Kural will NOT log this profile's Claude out: your Claude Code (${cc.version || "unknown version"}) is older than ${MIN_KEYCHAIN_CLAUDE} and could log your main account out instead. Log out in Claude yourself if needed.\n\n`) + `Its Claude and ChatGPT logins are removed from this computer's Kural folder (you can log in again by making a new profile).` +
      (p.share ? " Its chats are not deleted: they are shared with your main profile." : " Its own chats, History and Tab Completion's memory are deleted too.");
    const ok = await vscode.window.showWarningMessage(`Delete the profile "${p.name}"?`, { modal: true, detail }, "Delete");
    if (ok !== "Delete") return;
    const storage = this.context.globalStorageUri.fsPath;
    const dir = scope.profileDir(storage, p.id);
    // Log out of its Claude (and Codex) first: on a Mac the login is in the keychain (an item named for the folder), which
    // deleting the folder would leave behind. Best effort; the folder is deleted either way.
    if (dir && this.hooks.logout) { try { await this.hooks.logout(dir, { claude: cc.ok }); } catch (e) { log(`profiles: log out of ${p.id}: ${e.message}`); } }
    try { await this.store.remove(p.id); } catch (e) { vscode.window.showErrorMessage(`Kural: ${e.message}`); return; }
    try { scope.removeProfileDir(storage, p.id); } catch (e) { log(`profiles: deleting ${p.id}'s folder: ${e.message}`); }
    // Its saved records in this window's storage (the keys that end in @<id>; other folders' workspace keys are tiny and stay).
    for (const k of this.context.globalState.keys()) if (k.endsWith(`@${p.id}`)) await this.context.globalState.update(k, undefined);
    log(`profiles: deleted "${p.name}" (${p.id})`);
    vscode.window.setStatusBarMessage(`Deleted profile "${p.name}"`, 2500);
  }
}

module.exports = { Profiles, applyActive, KEY };
