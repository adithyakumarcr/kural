// Project rules, the commands (lib/rules/core.js reads and picks them; lib/chat/index.js tells the AI):
// "New Rule" makes .kural/rules/<name>.md from a template and opens it, "Open Rules Folder" shows the folder in the Explorer.
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const ws = require("../workspace");
const { within } = require("../paths");

const kebab = (s) => String(s || "").trim().toLowerCase().replace(/\.mdc?$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

const TEMPLATE = (name) => `---
description:
globs:
alwaysApply: false
---

<!--
  ${name}: a rule Kural follows in this project.
  - alwaysApply: true     the AI always gets this rule.
  - globs: src/**/*.ts    the AI gets it when a file in your message matches (comma-separated).
  - description: ...      the AI sees this line and reads the rule when it is relevant.
  - none of them          the rule applies only when you @-mention this file.
  Example: Use named exports. Write tests next to the code, in a file ending in .test.ts.
-->
`;

// The rules folder of the first project folder (made when asked), or null when no folder is open or it leads out of the project.
function rulesDir(make) {
  const root = ws.root();
  if (!root) return null;
  const dir = path.join(root, ".kural", "rules");
  if (!within(dir, [root])) return null;   // (checked first: a .kural that is a link elsewhere would get the folder made there)
  if (make) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function registerRules(context, { log = () => {} } = {}) {
  context.subscriptions.push(
    vscode.commands.registerCommand("kural.rules.new", async () => {
      if (!ws.root()) return vscode.window.showInformationMessage("Open a folder first: rules belong to a project.");
      const typed = await vscode.window.showInputBox({ title: "New Rule", prompt: "A name for the rule (for example: typescript-style)",
        validateInput: (v) => v.trim() && !kebab(v) ? "Use letters or numbers." : undefined });
      const name = kebab(typed);
      if (!name) return;
      try {
        const dir = rulesDir(true);
        if (!dir) return vscode.window.showWarningMessage("Kural won't write rules outside the project (.kural/rules leads elsewhere).");
        const file = path.join(dir, `${name}.md`);
        if (!fs.existsSync(file)) fs.writeFileSync(file, TEMPLATE(name), { flag: "wx" });
        log(`rules: ${file}`);
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file)));
      } catch (e) {
        log(`rules: couldn't make the rule: ${e.message}`);
        vscode.window.showErrorMessage(`Kural couldn't make the rule: ${e.message}`);
      }
    }),
    vscode.commands.registerCommand("kural.rules.openFolder", async () => {
      if (!ws.root()) return vscode.window.showInformationMessage("Open a folder first: rules belong to a project.");
      try {
        const dir = rulesDir(true);
        if (!dir) return vscode.window.showWarningMessage("Kural won't open rules outside the project (.kural/rules leads elsewhere).");
        await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(dir));
      } catch (e) {
        log(`rules: couldn't open the folder: ${e.message}`);
        vscode.window.showErrorMessage(`Kural couldn't open the rules folder: ${e.message}`);
      }
    }));
}

module.exports = { registerRules, kebab, TEMPLATE };
