# Browser (Design Mode)

Kural has a browser inside it: your app on localhost, or any website, in a tab beside the code. It's VS Code's own
Integrated Browser (a real browser: logins, dev tools, everything), with Kural's chat plugged into it, so you can do what
Cursor calls Design Mode: **click an element on the page and tell Kural what to change**.

**It keeps nothing.** No cookies, logins, site data or cache are saved on your computer: each time Kural starts, the
browser is fresh, and a login lasts until that window closes. (Kural 1.1.0-rc.3 and older saved them; that data is
deleted once.) On a Mac this also means the browser never needs the keychain.

## Open it

- **Kural: Open Browser** (Command Palette), or **+ → Pick from a browser** in the chat (it asks for the address, e.g.
  `3000` or `localhost:5173`, then turns the picker on).
- **Any web link** in a chat answer opens here, not in your outside browser. So does a `localhost` link in the terminal
  (setting `workbench.browser.openLocalhostLinks`, on by default in Kural).

## Pick an element

1. Click the **inspect button** in the browser's bar (**Add Element to Chat**, **Cmd/Ctrl+Shift+C**), then click
   something on the page. It's added to your message as a pill (`<button#order>`) with its HTML, its size, its computed
   CSS, and a picture of it.
2. Or use its dropdown: **Comment on Elements**: click an element and type what you want ("make this red and bigger").
   Your comment becomes the start of your message, so you can just press Enter.
3. Kural finds the code that makes the element (it searches your project for the classes, id and text) and changes it.
   Reload the page to see the result.

If nothing is added to your message when you click an element, use the dropdown's **screenshot of an area** instead.

The dropdown also adds **a screenshot** (the page, an area, or the full page) and the page's **console logs** to the
message. Pictures arrive as attachments; click one in the chat to see it full size.

Sharing: the first time you pick from a site that isn't your own computer, VS Code asks whether you're happy to put its
content in the chat.

## The AI uses the browser

Ask the chat to do something on a website and it does it in Kural's browser, like you would: open the page, read it,
click, type, choose from lists, upload a file, drag a slider or a trim handle, scroll, look at a picture of the page.

- "Open instagram.com and make a reel from `videos/run.mp4`: trim it, pick a cover, write the caption."
- "Fill in the form on this page with my details from `notes/me.md`."
- "Answer the quiz in the browser tab."

It works in a tab beside the code, so you can watch; each step shows in the answer ("Clicked Next", "Typed …"). If a
site asks to log in, log in there yourself (the AI never asks for passwords); the login lasts until the window closes. Claude and ChatGPT
(Codex) models can do this; Gemini and a model on your computer can't. Turn it off with the setting
`kural.browser.aiControl`.

### It never publishes

Kural's rule: **the AI never publishes, posts, shares or sends anything**: no post, reel, story, comment, message or
email, in any mode, not even when you ask it to. It goes as far as a draft and stops, saying what's ready; pressing
**Share** is yours.

- Before every click Kural checks what's really under the pointer (and the buttons around it): Share, Post, Publish,
  Send, Reply, Go live, Boost… are refused, in many languages. "Save draft", "Save as draft" and "Finish later" are fine.
  "Post" in a menu (Instagram's Create → Post) only opens the composer, so that's fine too.
- Enter in a caption, comment or message box is refused (it can post what's in it); new lines in a text are typed
  as part of it. Enter in a search box is fine.
- OK on the page's own "Publish this?" question is refused (Cancel is fine).
- On Instagram, the request that publishes is also stopped in the network while the AI works in that tab, even if
  something got past the labels. That includes your own Share in that tab until the AI's answer is done; then Kural lets
  go of the tab and it's all yours.

Instagram's website doesn't save drafts (Instagram keeps drafts in its phone app), so there the AI prepares the reel up
to the caption and stops before **Share**: the reel waits in that tab for you. Meta Business Suite offers
**Save as draft** / **Finish later** for some accounts.

### When it asks

| Mode | A site, the first time in a chat | Submit, Pay, Delete, Discard… | Upload a file from outside the project | Publish |
|---|---|---|---|---|
| Agent | asks | asks | asks | never |
| Auto | doesn't ask | doesn't ask | doesn't ask | never |
| Plan, Ask | asks (reading only) | refused | refused | never |

"Allow all browser actions in this chat" on a card covers every site and the Submit kind, never an upload from outside
the project, and never publishing. Like every "Allow all", it ends when the mode, the model or the conversation changes.

ChatGPT's own browser and computer use are off in every mode (Kural can't see what they click); Gemini's own browser
(Antigravity's) asks before every action, in Auto too.

## Under the hood

VS Code's browser sends what you pick to VS Code's own chat panel, which Kural doesn't have. A small build-time change
(`scripts/rebrand.py`) makes it call Kural instead, and turns on the "Add to Chat" buttons that VS Code hides when its
own chat is off. If a future VS Code changes that code, the build prints a warning and the browser works as plain
browser, without the buttons.

The AI's hands are VS Code's own browser API for extensions (its browser tabs, and a DevTools connection to one), not a
change to VS Code: the chat's program gets Kural's browser tools (an MCP server, `extension/lib/browser/`), each call
comes to Kural, and Kural clicks and types with real input events. The page outline the AI reads is the page's
accessibility tree (what a screen reader gets), with a ref for each thing on it.
