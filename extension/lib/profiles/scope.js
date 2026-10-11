// Which saved data belongs to which profile. No vscode here (tests run without it).
//
// Two kinds of data:
//   "account"  describes the logins: Get started's "is it set up" record, the usage numbers, the Codex / Gemini
//              conversation ids. Always its own per profile (a different login = different state), except the main
//              profile, which keeps today's names.
//   "data"     what you made: the chat History, the open tabs, what Tab Completion learned, the model router's memory,
//              checkpoints. Its own per profile only when the profile isn't sharing; a sharing profile uses the main
//              profile's, so both see the same chats.
// The main profile (id "default") always uses the plain names, so nothing changes for people who never make a second one.

const fs = require("fs");
const path = require("path");

const state = { storage: null, id: "default", share: true };

// storage: Kural's globalStorage folder; profile: { id, share } of the profile this window runs.
function configure({ storage, profile }) {
  state.storage = storage || null;
  state.id = (profile && profile.id) || "default";
  state.share = !profile || profile.share !== false;
}

const profileId = () => state.id;
const isMain = () => state.id === "default";

// A key in globalState / workspaceState: "kural.usage.v1" stays that for the main profile, else "kural.usage.v1@work-1a2b3c".
function key(base, kind) {
  if (isMain()) return base;
  if (kind === "data" && state.share) return base;
  return `${base}@${state.id}`;
}

// A folder inside Kural's storage: "chats", "checkpoints"… (same rule as key(); storage: another storage folder than the one configured, for tests).
function dir(name, kind, storage = state.storage) {
  // (Never a relative path: without a storage folder (tests, or before activate) that would write into whatever folder
  // Kural was started from.)
  const root = storage || require("os").tmpdir();
  if (isMain() || (kind === "data" && state.share)) return path.join(root, name);
  return path.join(root, "profiles", state.id, name);
}

// What the AI may read in Kural's storage without asking: everything except <storage>/profiles (other profiles' logins,
// Claude's and Codex's credential files, and chats they keep apart). Of this window's own profile only its data folders
// (not claude/ or codex/, where the login is), plus Claude's projects and plans, which Claude Code needs. Folders are
// listed now, so ask again for each request; "images" is always in (a model may save its first picture there).
function storageReadRoots(storage, id = state.id, share = state.share) {
  if (!storage) return [];
  let names = [];
  try { names = fs.readdirSync(storage); } catch { /* not made yet */ }
  const out = names.filter((n) => n !== "profiles").map((n) => path.join(storage, n));
  if (!names.includes("images")) out.push(path.join(storage, "images"));
  const own = id !== "default" && SAFE_ID.test(id) ? path.join(storage, "profiles", id) : null;
  if (own) {
    try { for (const n of fs.readdirSync(own)) if (n !== "claude" && n !== "codex") out.push(path.join(own, n)); } catch { /* none yet */ }
    out.push(path.join(own, "claude", "projects"), path.join(own, "claude", "plans"));
    if (!names.includes("images")) out.push(path.join(own, "images"));
  }
  return out;
}

// Ids become folder names: nothing else gets in.
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

// A profile's own folder (its logins, and its data when it doesn't share). The main profile has none.
function profileDir(storage, id) {
  if (!id || id === "default" || !SAFE_ID.test(id)) return null;
  return path.join(storage, "profiles", id);
}

// Delete a profile's folder. Only ever inside <storage>/profiles/.
function removeProfileDir(storage, id) {
  const d = profileDir(storage, id);
  if (!d) return false;
  fs.rmSync(d, { recursive: true, force: true });
  return true;
}

module.exports = { storageReadRoots, configure, profileId, isMain, key, dir, profileDir, removeProfileDir, SAFE_ID };
