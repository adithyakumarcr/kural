// Voice input on a Mac: the build lets the app use the microphone (the main program's entitlements) and says why when
// macOS asks; the camera stays off.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const sh = fs.readFileSync(path.join(__dirname, "..", "build-mac.sh"), "utf8");

check("the main program's entitlements have device.audio-input and no camera", () => {
  const line = sh.split("\n").find((l) => /^\s*ent "\$E\/main\.plist"/.test(l));
  assert.ok(line, "the main entitlements line");
  assert.ok(/\bdevice\.audio-input\b/.test(line), line);
  assert.ok(!/device\.camera/.test(sh));
});

check("NSMicrophoneUsageDescription says what the microphone is for", () => {
  assert.ok(sh.includes('d["NSMicrophoneUsageDescription"] = "Kural uses the microphone only while you record a voice prompt in the chat."'));
});

console.log(failed ? `build-mac-mic: ${failed} FAILED` : "build-mac-mic: ALL PASS");
process.exit(failed ? 1 : 0);
