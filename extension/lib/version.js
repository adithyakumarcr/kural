// Which Kural this is, in words: "v1.1.0-alpha.3" for a release; "Unreleased version · main (b233785)" for one built
// from the code with ./install.sh, so you can tell you're not on a release. install.sh writes extension/build.json
// (not in git); release builds (the GitHub workflow) don't have it. No vscode here.
const fs = require("fs");
const path = require("path");

function buildInfo(extensionPath) {
  try { return JSON.parse(fs.readFileSync(path.join(extensionPath, "build.json"), "utf8")); } catch { return null; }
}

function versionLabel(extensionPath, version) {
  const b = buildInfo(extensionPath);
  if (!b || b.release) return `v${version}`;
  return `Unreleased version · ${b.branch || "local"}${b.commit ? ` (${b.commit})` : ""}`;
}

const unreleased = (extensionPath) => { const b = buildInfo(extensionPath); return !!b && !b.release; };

module.exports = { versionLabel, unreleased, buildInfo };
