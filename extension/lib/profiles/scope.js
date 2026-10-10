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
  const root = storage || "";
  if (isMain() || (kind === "data" && state.share)) return path.join(root, name);
  return path.join(root, "profiles", state.id, name);
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

module.exports = { configure, profileId, isMain, key, dir, profileDir, removeProfileDir, SAFE_ID };
