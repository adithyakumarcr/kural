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

// The source patches an app was built with (product.json kuralSource.patches; none for a VSCodium-based build).
function builtIn(app) {
  try { const s = JSON.parse(fs.readFileSync(path.join(app, "product.json"), "utf8")).kuralSource; return (s && Array.isArray(s.patches)) ? s.patches : []; } catch { return []; }
}

// The "app" folder of a built Kural, or null. notBuiltIn: patch names (patches/kural/, without .patch); an app built from
// source with any of them is left out, since rebrand.py skips those patches there (a test of them needs another app).
function findAppRoot({ notBuiltIn = [] } = {}) {
  const given = process.env.KURAL_WORKBENCH || process.env.KURAL_APP_ROOT;
  const list = [];
  if (given) {
    // (The workbench file itself: its app folder is four levels up.)
    if (path.basename(given) === "workbench.desktop.main.js") list.push(path.resolve(given, "..", "..", "..", ".."));
    list.push(given, path.join(given, "Contents", "Resources", "app"), path.join(given, "resources", "app"));
  }
  list.push(...apps);
  return list.find((d) => fs.existsSync(path.join(d, WORKBENCH)) && !builtIn(d).some((n) => notBuiltIn.includes(n))) || null;
}

// A file inside it (default: the workbench's main script), or null.
function findWorkbench(rel = WORKBENCH, opts) {
  const app = findAppRoot(opts);
  const f = app && path.join(app, rel);
  return f && fs.existsSync(f) ? f : null;
}

const skipped = (what = "") => `(skipped${what ? " " + what : ""}: no built workbench (set KURAL_WORKBENCH))`;

module.exports = { findAppRoot, findWorkbench, skipped, WORKBENCH };
