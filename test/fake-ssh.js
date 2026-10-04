#!/usr/bin/env node
// A stand-in for `ssh`, for testing lib/devices without a real device: it checks the password the way the real one gets
// it (through SSH_ASKPASS, which prints KURAL_SSH_PW), then runs the command here with sh. The right password is
// $FAKE_SSH_PASSWORD (default "secret"); with -i <key>, the key's .pub must be in $FAKE_SSH_HOME/.ssh/authorized_keys.
// The host "nowhere" fails like an unknown name.
const { spawnSync, spawn } = require("child_process");
const fs = require("fs"), path = require("path");
const args = process.argv.slice(2);
if (args.includes("-O")) process.exit(0);                       // "close the reused connection"
const target = args.find((a) => /@/.test(a)) || "";
const command = args[args.indexOf(target) + 1] || "";
if (/@nowhere$/.test(target)) { process.stderr.write("ssh: Could not resolve hostname nowhere: Name or service not known\n"); process.exit(255); }
const home = process.env.FAKE_SSH_HOME || process.cwd();
const ki = args.indexOf("-i");
if (ki >= 0) {
  // Key login: the key's public half must be in the device's ~/.ssh/authorized_keys (like sshd checks).
  let pub = "", keys = "";
  try { pub = fs.readFileSync(`${args[ki + 1]}.pub`, "utf8").trim(); } catch { /* no key */ }
  try { keys = fs.readFileSync(path.join(home, ".ssh", "authorized_keys"), "utf8"); } catch { /* none */ }
  if (!pub || !keys.split("\n").map((l) => l.trim()).includes(pub)) { process.stderr.write(`${target}: Permission denied (publickey,password).\n`); process.exit(255); }
} else {
  const pw = spawnSync(process.env.SSH_ASKPASS || "false", [], { encoding: "utf8" }).stdout.replace(/\r?\n$/, "");
  if (pw !== (process.env.FAKE_SSH_PASSWORD || "secret")) { process.stderr.write(`${target}: Permission denied (password).\n`); process.exit(255); }
}
const p = spawn("sh", ["-c", command], { stdio: ["pipe", "inherit", "inherit"], cwd: process.env.FAKE_SSH_HOME || process.cwd(),
  env: { ...process.env, HOME: process.env.FAKE_SSH_HOME || process.env.HOME, SHELL: "/bin/sh" } });
process.stdin.pipe(p.stdin);
p.on("close", (code) => process.exit(code));
