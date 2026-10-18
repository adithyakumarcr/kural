// Kural's browser keeps nothing between starts (rebrand.py fresh_browser, setting workbench.browser.dataStorage
// "ephemeral"). Versions before 1.1.0-rc.4 saved its cookies, logins, cache and site data on disk; this deletes what they
// left: the global partition (<user data>/Partitions/vscode-browser) and each workspace's (User/workspaceStorage/<id>/
// browserStorage). Nothing in this window uses them any more. No vscode here.

const fs = require("fs");
const path = require("path");

// <user data> from the extension's globalStorage folder (<user data>/User/globalStorage/<ext>, or under a VS Code profile:
// <user data>/User/profiles/<id>/globalStorage/<ext>).
function userDataOf(globalStorage) {
  let d = path.resolve(globalStorage);
  for (let i = 0; i < 6; i++) {
    if (path.basename(d) === "User") return path.dirname(d);
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

// The folders to delete (only real folders: never a link, never anything outside <user data>).
function savedBrowserData(globalStorage) {
  const root = userDataOf(globalStorage);
  if (!root) return [];
  const isDir = (p) => { try { return fs.lstatSync(p).isDirectory(); } catch { return false; } };
  const out = [path.join(root, "Partitions", "vscode-browser")].filter(isDir);
  const wsDir = path.join(root, "User", "workspaceStorage");
  let ids = [];
  try { ids = fs.readdirSync(wsDir); } catch { /* no workspaces yet */ }
  for (const id of ids) { const p = path.join(wsDir, id, "browserStorage"); if (isDir(p)) out.push(p); }
  return out;
}

// Delete them (in the background; a folder Windows still holds open stays until next time).
async function forgetSaved(globalStorage, log = () => {}) {
  const gone = [];
  for (const p of savedBrowserData(globalStorage)) {
    try { await fs.promises.rm(p, { recursive: true, force: true }); gone.push(p); }
    catch (e) { log(`browser: could not delete its old saved data ${p}: ${e.message}`); }
  }
  if (gone.length) log(`browser: deleted the data older versions saved (cookies, logins, cache): ${gone.join(", ")}`);
  return gone;
}

module.exports = { userDataOf, savedBrowserData, forgetSaved };
