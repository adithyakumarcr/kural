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
//   - the Explorer's views (files, open editors, outline, timeline) are moved in ONCE (`kural.projects.explorerMerged.v1`), so what
//     you rearrange afterwards stays; "Reset View Locations" brings the old layout back, and then the next start merges again
//     only if the flag is cleared (it isn't: Reset is yours to keep).
// A miss (no such command in this VS Code, a view id that isn't there) is logged and changes nothing.
const CONTAINER = "workbench.view.extension.kural-projects";
const PROJECTS_VIEW = "kural.projects";
const EXPLORER_VIEWS = ["workbench.explorer.fileView", "workbench.explorer.openEditorsView", "outline", "timeline"];
const MERGED_KEY = "kural.projects.explorerMerged.v1";

async function moveView(commands, id) {
  await commands.executeCommand("vscode.moveViews", { viewIds: [id], destinationId: CONTAINER });
}

async function arrangeViews({ commands, state, log = () => {} }) {
  let have = false;
  try { have = (await commands.getCommands()).includes("vscode.moveViews"); } catch (e) { log(`projects: layout: ${e.message}`); }
  if (!have) { log("projects: layout: this VS Code has no vscode.moveViews; Projects and the Explorer stay apart"); return { moved: [], missing: true }; }
  const moved = [];
  const ids = [PROJECTS_VIEW];
  const merged = !!(state && state.get(MERGED_KEY));
  if (!merged) ids.push(...EXPLORER_VIEWS);
  for (const id of ids) {
    try { await moveView(commands, id); moved.push(id); } catch (e) { log(`projects: layout: ${id}: ${e.message}`); }
  }
  // (Only once the Explorer's main view went over: else the next start tries again.)
  if (!merged && moved.includes("workbench.explorer.fileView") && state) {
    try { await state.update(MERGED_KEY, true); } catch (e) { log(`projects: layout: ${e.message}`); }
  }
  return { moved, missing: false };
}

module.exports = { arrangeViews, CONTAINER, PROJECTS_VIEW, EXPLORER_VIEWS, MERGED_KEY };
