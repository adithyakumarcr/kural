// Kural's own records (chats, conversations, session maps, crash reports) are for you alone: folders 0700, files
// 0600 (APP-10). A mode given to writeFileSync only counts when the file is new, so an older 0644 file is changed too.
// No vscode inside. (Windows ignores these modes: the user's profile folder is private there already.)
const fs = require("fs");
const path = require("path");

function privateFolder(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* not ours to change: the files below are still 0600 */ }
}

function writePrivate(file, data) {
  privateFolder(path.dirname(file));
  fs.writeFileSync(file, data, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* written: best effort */ }
}

function appendPrivate(file, data) {
  privateFolder(path.dirname(file));
  fs.appendFileSync(file, data, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* written: best effort */ }
}

module.exports = { privateFolder, writePrivate, appendPrivate };
