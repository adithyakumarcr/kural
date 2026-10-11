const assert = require("assert");
const os = require("os");
const { runsLater } = require("../extension/lib/paths");
// (Relative paths are also checked where they really are: from a folder whose path has ".claude" in it, like a Claude
// Code worktree, every relative path would look like one. Kural always passes absolute paths.)
process.chdir(os.tmpdir());

const yes = [".git/hooks/pre-commit", "/p/.git/hooks/post-merge", ".vscode/tasks.json", ".vscode/launch.json", "package.json",
  "sub/dir/.envrc", "a\\.github\\workflows\\x.yml", ".github/workflows/build.yml", ".env", ".env.local", "Makefile", "app/Dockerfile",
  ".husky/pre-push", "/home/u/.zshrc", ".claude/settings.local.json", ".codex/config.toml", ".pre-commit-config.yaml", "compose.yml",
  // AGENT-3: git settings that run programs, editor/container settings, AI instructions and MCP servers, build/test files.
  ".git/config", ".git/info/attributes", ".gitattributes", ".gitmodules", ".vscode/extensions.json", ".vscode/settings.json", ".devcontainer/devcontainer.json",
  ".devcontainer.json", "proj.code-workspace", ".mcp.json", "CLAUDE.md", "CLAUDE.local.md", "sub/CLAUDE.md", "AGENTS.md", "GEMINI.md",
  ".claude/skills/x/SKILL.md", ".claude/agents/a.md", ".claude/commands/c.md", ".npmrc", ".yarnrc", ".yarnrc.yml", ".pnpmfile.cjs",
  "pyproject.toml", "setup.py", "setup.cfg", "tests/conftest.py", "tox.ini", "noxfile.py", "Gemfile", "Rakefile", "build.gradle", "build.gradle.kts",
  "settings.gradle", "gradlew", "pom.xml", "build.rs", "Cargo.toml", ".cargo/config.toml", ".tool-versions", ".mise.toml", "/home/u/.zshenv", "/home/u/.zprofile",
  "/home/u/.config/fish/config.fish",
  // Case (macOS, Windows), trailing dots/spaces, NTFS streams and 8.3 short names (Windows).
  ".GIT/hooks/pre-commit", ".Git/config", ".VSCODE/tasks.json", ".vscode/Tasks.json", "Package.json", "MAKEFILE", ".git./config", ".git /config",
  "package.json.", "package.json::$DATA", ".git::$INDEX_ALLOCATION/config", "GIT~1/config", "C:\\proj\\PACKAG~1.JSO", "C:\\proj\\.git\\hooks\\pre-commit",
];
const no = ["src/app.js", "README.md", "packages/foo/index.js", "docs/package.json.md", "src/environment.js", "notes/envrc.txt",
  ".github/ISSUE_TEMPLATE/bug.yml", "my.gitignore", "src/makefile-parser.js", "src/setup.ts", "docs/pyproject-notes.md", "src/gradle.js",
  "lib/cargo.rs", "src/vscode/x.js", "docs/claude-notes.md", "src/agents/a.js", "tests/test_app.py", "C:\\proj\\src\\app.js", "notes~/x.md"];
for (const f of yes) assert(runsLater(f), `${f} should ask`);
for (const f of no) assert(!runsLater(f), `${f} should not ask`);
console.log("paths-runs-later ok");
