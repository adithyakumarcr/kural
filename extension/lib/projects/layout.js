// One side bar container for Projects and the Explorer: Projects on top, the Explorer below, both ordinary views (collapse,
// drag to reorder). No vscode inside: `commands` is vscode.commands (or a stand-in), `state` is a globalState-like store.
//
// How: VS Code's own command `vscode.moveViews` ({viewIds, destinationId}) moves views between containers (it is what the
// View > Move View menu uses), so this works on VSCodium's build and on a build from source alike, with no patch of the
// workbench's views code. A patch could only run before the extension's container exists, so it would need more of VS Code's
// internals. The workbench patches (0202 / rebrand.py projects_always_shown) keep the container pinned and the Projects view
// from being hidden; they no longer stop it from being moved.
//
//   - the Projects view is put back into its container at every start (a drag out of it is undone, the container stays whole);
//   - each of the Explorer's views (files, open editors, outline, timeline, NPM Scripts) is moved in ONCE (`MOVED_KEY` lists the
//     ones done), so what you rearrange afterwards stays, and a view added to the list later still moves for people who merged
//     before. Every one has to go: the Explorer's own container hides itself only when it is empty (hideIfEmpty), and one view
//     left in it (NPM Scripts in a folder with a package.json) kept the Explorer's icon in the activity bar (Adithya, 27 Oct 2026).
//   - Outline and Timeline are hidden once, when they come in (`QUIET_KEY`; Adithya: "disable them by default"): VS Code's
//     `<view>.removeView` hides a view only if it is visible, so it never shows one. Right-click a view title to show them again.
// A miss (no such command in this VS Code, a view id that isn't there) is logged and changes nothing.
const CONTAINER = "workbench.view.extension.kural-projects";
const PROJECTS_VIEW = "kural.projects";
const EXPLORER_VIEWS = ["workbench.explorer.fileView", "workbench.explorer.openEditorsView", "outline", "timeline", "npm"];
const QUIET_VIEWS = ["outline", "timeline"];
const MERGED_KEY = "kural.projects.explorerMerged.v1";   // (older: the first four were moved together)
const MOVED_KEY = "kural.projects.explorerMoved.v2";
const QUIET_KEY = "kural.projects.quietViews.v1";

async function moveView(commands, id) {
  await commands.executeCommand("vscode.moveViews", { viewIds: [id], destinationId: CONTAINER });
}

async function arrangeViews({ commands, state, log = () => {} }) {
  let have = [];
  try { have = await commands.getCommands(); } catch (e) { log(`projects: layout: ${e.message}`); }
  if (!have.includes("vscode.moveViews")) { log("projects: layout: this VS Code has no vscode.moveViews; Projects and the Explorer stay apart"); return { moved: [], missing: true }; }
  const get = (k) => (state ? state.get(k) : undefined);
  const save = async (k, v) => { if (state) try { await state.update(k, v); } catch (e) { log(`projects: layout: ${e.message}`); } };
  const done = new Set(Array.isArray(get(MOVED_KEY)) ? get(MOVED_KEY) : get(MERGED_KEY) ? EXPLORER_VIEWS.slice(0, 4) : []);
  const moved = [];
  for (const id of [PROJECTS_VIEW, ...EXPLORER_VIEWS.filter((v) => !done.has(v))]) {
    try { await moveView(commands, id); moved.push(id); } catch (e) { log(`projects: layout: ${id}: ${e.message}`); }
  }
  for (const id of moved) if (id !== PROJECTS_VIEW) done.add(id);
  if (moved.length > 1) await save(MOVED_KEY, EXPLORER_VIEWS.filter((v) => done.has(v)));
  // Outline and Timeline: hidden once, after they are in this container (the views' own Hide; a no-op when already hidden).
  const quiet = new Set(Array.isArray(get(QUIET_KEY)) ? get(QUIET_KEY) : []), hidden = [];
  for (const id of QUIET_VIEWS) {
    if (quiet.has(id) || !done.has(id) || !have.includes(`${id}.removeView`)) continue;
    try { await commands.executeCommand(`${id}.removeView`); hidden.push(id); quiet.add(id); } catch (e) { log(`projects: layout: hide ${id}: ${e.message}`); }
  }
  if (hidden.length) await save(QUIET_KEY, [...quiet]);
  return { moved, hidden, missing: false };
}

module.exports = { arrangeViews, CONTAINER, PROJECTS_VIEW, EXPLORER_VIEWS, QUIET_VIEWS, MERGED_KEY, MOVED_KEY, QUIET_KEY };
