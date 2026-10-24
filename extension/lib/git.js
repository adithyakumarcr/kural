// Which git program Kural uses (no vscode): the Plugins tab's Git address and parallel agents' worktrees.
// Homebrew's or another one on PATH first; on a Mac /usr/bin/git only when Apple's command line tools are there
// (without them it opens Apple's "install the tools?" window). null: none.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

async function findGit(env = process.env, platform = process.platform) {
  const dirs = String((env && env.PATH) || process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const exe = platform === "win32" ? "git.exe" : "git";
  const list = [...(platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : []), ...dirs].map((d) => path.join(d, exe));
  for (const g of [...new Set(list)]) {
    if (platform === "darwin" && g === "/usr/bin/git") continue;
    try { fs.accessSync(g, fs.constants.X_OK); return g; } catch { /* not here */ }
  }
  if (platform === "darwin" && fs.existsSync("/usr/bin/git")) {
    const tools = await new Promise((resolve) => execFile("/usr/bin/xcode-select", ["-p"], { timeout: 5000 }, (e) => resolve(!e)));
    if (tools) return "/usr/bin/git";
  }
  return null;
}

module.exports = { findGit };
