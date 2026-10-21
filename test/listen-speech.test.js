// Listen: text made ready for the voice (extension/lib/listen/speech.js): sentences, markdown and symbols left out,
// expression tags the voice can't say removed, tech words said the way a person would.
const assert = require("assert");
const { sentences, forVoice } = require("../extension/lib/listen/speech");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

check("sentences split after . ! ? and keep the text that has no end mark", () => {
  assert.deepStrictEqual(sentences("So, here's the fix. It checks the token! Then? Done"),
    ["So, here's the fix.", "It checks the token!", "Then?", "Done"]);
});
check("sentences don't split inside a number or a dotted name", () => {
  assert.deepStrictEqual(sentences("Version 1.2 of node.js is fine. Next."), ["Version 1.2 of node.js is fine.", "Next."]);
});
check("sentences of nothing is nothing", () => assert.deepStrictEqual(sentences("  "), []));
check("a tag stays with its sentence", () => {
  assert.deepStrictEqual(sentences("That's neat. <laugh> Anyway, next."), ["That's neat.", "<laugh> Anyway, next."]);
});
check("markdown marks and inline code go", () => assert.strictEqual(forVoice("Run **npm** `install` now.", []), "Run N P M install now."));
check("list bullets and headings become plain sentences", () => assert.strictEqual(forVoice("- a list item\n# Heading", []), "a list item. Heading"));
check("only the tags the voice can say stay", () => assert.strictEqual(forVoice("Ha <laugh> nice <sigh>.", ["laugh"]), "Ha <laugh> nice."));
check("an unknown tag goes", () => assert.strictEqual(forVoice("Look <wink> here.", []), "Look here."));
check("tech words are said like a person would", () => assert.strictEqual(forVoice("Read the README and the JSON file.", []), "Read the read me and the jason file."));
check("links keep their text; emoji go", () => assert.strictEqual(forVoice("A link [docs](https://x.y/z) and 🎉 emoji.", []), "A link docs and emoji."));
check("a .js name is said with dot", () => assert.strictEqual(forVoice("Open chat.js first.", []), "Open chat dot J S first."));

process.exit(failed ? 1 : 0);
