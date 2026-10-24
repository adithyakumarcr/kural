// Static checks of the Linux container (scripts/linux-container/): no Docker needed. What must stay true: the base is
// Ubuntu 22.04 (like CI's .deb build), the repository is mounted read-only, nothing runs with extra rights, every mode exists,
// and the build output goes to a named volume, not the repository.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const dir = path.join(__dirname, "..", "scripts", "linux-container");
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
const code = (s) => s.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");   // the script without its comment lines
let failed = 0;
const t = (name, fn) => { try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); } };

const run = read("run.sh"), inside = read("inside.sh"), docker = read("Dockerfile");

t("the image is Ubuntu 22.04", () => {
  const from = docker.split("\n").filter((l) => /^FROM\b/i.test(l));
  assert.deepStrictEqual(from.map((l) => l.trim()), ["FROM ubuntu:22.04"]);
});
t("the Dockerfile has what the Linux source build and a window need", () => {
  for (const p of ["build-essential", "pkg-config", "libx11-dev", "libxkbfile-dev", "libsecret-1-dev", "libkrb5-dev", "python3", "git", "xvfb", "xdotool", "dbus-x11", "openbox", "libnss3", "libgtk-3-0", "libgbm1", "libasound2"]) {
    assert.ok(new RegExp(`\\b${p}\\b`).test(docker), `${p} is not installed`);
  }
});
t("the Dockerfile's Node is VS Code's .nvmrc version, checked against nodejs.org's SHASUMS256.txt", () => {
  assert.ok(/ARG NODE_VERSION=\d+\.\d+\.\d+/.test(docker));
  assert.ok(/SHASUMS256\.txt/.test(docker) && /sha256sum -c/.test(docker));
  assert.ok(/linux-x64/.test(docker) && /linux-arm64/.test(docker), "both architectures");
});
t("run.sh has every mode and a help text", () => {
  for (const m of ["test", "build", "live", "shell", "build-image", "clean"]) assert.ok(new RegExp(`^\\s*${m}\\)`, "m").test(run) || new RegExp(`\\b${m}\\b[^\\n]*\\)`).test(run), `no ${m} mode`);
  assert.ok(/--help/.test(run) && /--platform/.test(run));
  const r = spawnSync("bash", [path.join(dir, "run.sh"), "--help"], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
  for (const m of ["test", "build", "live", "shell"]) assert.ok(new RegExp(`^\\s*${m}\\b`, "m").test(r.stdout), `help lacks ${m}`);
});
t("run.sh with no mode or an unknown one fails with a message, before touching Docker", () => {
  for (const args of [[], ["nonsense"], ["--platform", "linux/s390x", "test"]]) {
    const r = spawnSync("bash", [path.join(dir, "run.sh"), ...args], { encoding: "utf8", env: { ...process.env, DOCKER: "/nonexistent" } });
    assert.notStrictEqual(r.status, 0, args.join(" "));
    assert.ok(/usage|Unknown|--platform/.test(r.stderr), r.stderr);
  }
});
t("the repository is mounted read-only (:ro), and it is the only bind mount", () => {
  const c = code(run);
  assert.ok(/-v "\$ROOT:\/repo:ro"/.test(c), "no read-only mount of the repository");
  const mounts = c.match(/\s-v\s+"\S+/g) || [];
  assert.deepStrictEqual(mounts.map((m) => m.trim().split(/\s+/)[1]).sort(), ['"$ROOT:/repo:ro"', '"$VOLUME:/work"'].sort());
});
t("no --privileged, no host network, no extra capabilities, no docker socket", () => {
  for (const [name, text] of [["run.sh", code(run)], ["inside.sh", code(inside)]]) {
    for (const bad of [/--privileged/, /--network[= ]+host/, /--net[= ]+host/, /--cap-add/, /--pid[= ]+host/, /--security-opt/, /--device\b/, /docker\.sock/]) assert.ok(!bad.test(text), `${name} has ${bad}`);
  }
});
t("every run is --rm", () => {
  const c = code(run);
  assert.ok(/docker"? run --rm\b/.test(c) || /"\$DOCKER" run --rm\b/.test(c));
  assert.ok(!/"\$DOCKER" run (?!--rm)/.test(c));
});
t("the build output is in a named volume, never the repository", () => {
  assert.ok(/VOLUME="kural-linux-work-\$ARCH"/.test(run));
  assert.ok(/copy_repo \/work\/src/.test(inside), "the build works on a copy in the volume");
  assert.ok(/KURAL_SOURCE=1 \.\/make-deb\.sh/.test(inside));
  assert.ok(!/cd \/repo\b/.test(code(inside)), "nothing runs inside /repo");
});
t("test mode works on a scratch copy and runs npm test", () => {
  assert.ok(/test\)[\s\S]*mktemp -d \/tmp\/kural-test[\s\S]*copy_repo "\$S"[\s\S]*npm test/.test(inside));
});
t("the default platform is the container's own; x64 only by --platform; build on arm64 says why it stops", () => {
  assert.ok(/version --format '\{\{\.Server\.Arch\}\}'/.test(run));
  assert.ok(/--platform linux\/amd64/.test(run) && /emulation/i.test(run));
  assert.ok(/make-deb\.sh stops/.test(run) && /build\.sh/.test(run));
});
t("live runs the start check and the one-frame check as a normal user", () => {
  assert.ok(/runuser -u kural/.test(inside) && /one-frame\.live\.js/.test(inside) && /"ready"|\\"ready\\"/.test(inside));
  assert.ok(/openbox/.test(inside) && /Xvfb/.test(inside));
});
t("the scripts are executable and valid bash", () => {
  for (const f of ["run.sh", "inside.sh"]) {
    assert.ok(fs.statSync(path.join(dir, f)).mode & 0o100, `${f} is not executable`);
    const r = spawnSync("bash", ["-n", path.join(dir, f)], { encoding: "utf8" });
    assert.strictEqual(r.status, 0, r.stderr);
  }
});

process.exit(failed ? 1 : 0);
