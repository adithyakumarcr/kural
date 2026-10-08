const assert = require("assert");
const { runsLater } = require("../extension/lib/paths");

const yes = [".git/hooks/pre-commit", "/p/.git/hooks/post-merge", ".vscode/tasks.json", ".vscode/launch.json", "package.json",
  "sub/dir/.envrc", "a\\.github\\workflows\\x.yml", ".github/workflows/build.yml", ".env", ".env.local", "Makefile", "app/Dockerfile",
  ".husky/pre-push", "/home/u/.zshrc", ".claude/settings.local.json", ".codex/config.toml", ".pre-commit-config.yaml", "compose.yml"];
const no = ["src/app.js", "README.md", "packages/foo/index.js", "docs/package.json.md", "src/environment.js", "notes/envrc.txt",
  ".github/ISSUE_TEMPLATE/bug.yml", "my.gitignore", "src/makefile-parser.js"];
for (const f of yes) assert(runsLater(f), `${f} should ask`);
for (const f of no) assert(!runsLater(f), `${f} should not ask`);
console.log("paths-runs-later ok");
