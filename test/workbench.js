// Where a built Kural's files are, for the tests that run on the real workbench file or the real ripgrep.
// Looked for in this order: env KURAL_WORKBENCH (a Kural.app, an unpacked "app" folder, or the workbench file itself),
// this repo's own build output (build/mac, build/win, pkg), then the standard install places. Nothing found: null, and
// the test skips that part (use skipped() for the message).
const fs = require("fs"), path = require("path");

const root = path.join(__dirname, "..");
const WORKBENCH = path.join("out", "vs", "workbench", "workbench.desktop.main.js");
const apps = [   // folders that hold "out/", "node_modules.asar.unpacked/"…
  path.join(root, "build", "mac", "Kural.app", "Contents", "Resources", "app"),
  path.join(root, "build", "mac", "dmg", "Kural.app", "Contents", "Resources", "app"),
  path.join(root, "build", "win", "Kural", "resources", "app"),
  path.join(root, "pkg", "usr", "share", "kural", "resources", "app"),
  "/Applications/Kural.app/Contents/Resources/app",
  "/usr/share/kural/resources/app",
];

// The "app" folder of a built Kural, or null.
function findAppRoot() {
  const given = process.env.KURAL_WORKBENCH || process.env.KURAL_APP_ROOT;
  const list = [];
  if (given) {
    // (The workbench file itself: its app folder is four levels up.)
    if (path.basename(given) === "workbench.desktop.main.js") list.push(path.resolve(given, "..", "..", "..", ".."));
    list.push(given, path.join(given, "Contents", "Resources", "app"), path.join(given, "resources", "app"));
  }
  list.push(...apps);
  return list.find((d) => fs.existsSync(path.join(d, WORKBENCH))) || null;
}

// A file inside it (default: the workbench's main script), or null.
function findWorkbench(rel = WORKBENCH) {
  const app = findAppRoot();
  const f = app && path.join(app, rel);
  return f && fs.existsSync(f) ? f : null;
}

const skipped = (what = "") => `(skipped${what ? " " + what : ""}: no built workbench (set KURAL_WORKBENCH))`;

module.exports = { findAppRoot, findWorkbench, skipped, WORKBENCH };
