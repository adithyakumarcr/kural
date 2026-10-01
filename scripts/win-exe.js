// Puts the Kural icon and name into a Windows .exe (what Explorer, the taskbar and
// Task Manager show). Uses resedit, which edits .exe files on any OS.
// Usage: node scripts/win-exe.js <exe> <icon.ico> <version>
const fs = require("fs");
const ResEdit = require("resedit");

const [exePath, icoPath, version] = process.argv.slice(2);
// ignoreCert: the file was signed by VSCodium; editing it makes that signature invalid,
// so it is dropped (Kural isn't signed; Windows shows a one-time "unknown publisher" note).
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);

const ico = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const iconId = groups.length ? groups[0].id : 1;
const lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, iconId, lang, ico.icons.map((i) => i.data));

const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
if (vi) {
  const nums = version.split(/[.+-]/).map((n) => parseInt(n, 10) || 0).concat([0, 0, 0, 0]).slice(0, 4);
  for (const l of vi.getAllLanguagesForStringValues()) {
    vi.setStringValues(l, {
      ProductName: "Kural Code Editor", FileDescription: "Kural Code Editor", CompanyName: "Adithya Chinnakkonda",
      InternalName: "Kural", OriginalFilename: "Kural.exe", ProductVersion: version,
    });
  }
  vi.setProductVersion(...nums);
  vi.outputToResourceEntries(res.entries);
}

res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log(`updated ${exePath}`);
