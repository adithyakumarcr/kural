#!/usr/bin/env node
// Writes a CycloneDX 1.5 bill of materials for a release: node scripts/sbom.js [out-file]  (default dist/kural-<ver>.cdx.json)
// No dependencies. Lists Kural, VSCodium (the version in codium.lock), Codicons, and any npm package in node_modules.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");

function build() {
  const ver = JSON.parse(fs.readFileSync(path.join(root, "extension", "package.json"), "utf8")).version;
  const codium = /^# VSCodium (\S+)\./m.exec(fs.readFileSync(path.join(root, "codium.lock"), "utf8"));
  if (!codium) throw new Error("codium.lock has no VSCodium version");
  const components = [
    { type: "application", "bom-ref": "vscodium", name: "VSCodium", version: codium[1], licenses: [{ license: { id: "MIT" } }], purl: `pkg:github/VSCodium/vscodium@${codium[1]}` },
    { type: "library", "bom-ref": "codicons", name: "Codicons", licenses: [{ license: { id: "CC-BY-4.0" } }], purl: "pkg:github/microsoft/vscode-codicons" },
  ];
  // Any npm package that is installed (today none: Kural has no dependencies).
  const nm = path.join(root, "node_modules");
  if (fs.existsSync(nm)) {
    for (const d of fs.readdirSync(nm)) {
      const dirs = d.startsWith("@") ? fs.readdirSync(path.join(nm, d)).map((x) => path.join(d, x)) : [d];
      for (const rel of dirs) {
        try {
          const p = JSON.parse(fs.readFileSync(path.join(nm, rel, "package.json"), "utf8"));
          components.push({ type: "library", "bom-ref": `npm:${p.name}@${p.version}`, name: p.name, version: p.version, purl: `pkg:npm/${p.name.replace(/^@/, "%40")}@${p.version}`,
            ...(p.license ? { licenses: [{ license: { name: String(p.license) } }] } : {}) });
        } catch { /* not a package */ }
      }
    }
  }
  return {
    ver,
    bom: {
      bomFormat: "CycloneDX", specVersion: "1.5", version: 1,
      metadata: { component: { type: "application", "bom-ref": "kural", name: "Kural Code Editor", version: ver, licenses: [{ expression: "LicenseRef-MIT-Commons-Clause" }] } },
      components,
      dependencies: [{ ref: "kural", dependsOn: components.map((c) => c["bom-ref"]) }],
    },
  };
}

if (require.main === module) {
  const { ver, bom } = build();
  const out = process.argv[2] || path.join(root, "dist", `kural-${ver}.cdx.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(bom, null, 2) + "\n");
  console.log(`wrote ${out}`);
}
module.exports = { build };
