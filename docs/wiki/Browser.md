# Browser (Design Mode)

Kural has a browser inside it: your app on localhost, or any website, in a tab beside the code. It's VS Code's own
Integrated Browser (a real browser: logins, dev tools, everything), with Kural's chat plugged into it, so you can do what
Cursor calls Design Mode: **click an element on the page and tell Kural what to change**.

**It keeps nothing.** No cookies, logins, site data or cache are saved on your computer: each time Kural starts, the
browser is fresh, and a login lasts until that window closes. (Kural 1.1.0-rc.3 and older saved them; that data is
deleted once.) On a Mac this also means the browser never needs the keychain.

## Open it

- **Kural: Open Browser** (Command Palette). (The chat's + no longer has *Pick from a browser*: open the page, then use
  the browser bar's inspect button.)
- **Any web link** in a chat answer opens here, not in your outside browser. So does a `localhost` link in the terminal
  (setting `workbench.browser.openLocalhostLinks`, on by default in Kural).

## Design Mode

Like Cursor's Design Mode: point at your app, say what to change, and the chat's AI changes the code.

**Turn it on:** the **pen button** in the browser bar, left of the inspect button (it looks pressed while Design Mode is
on), or **Cmd+Shift+D** (Ctrl+Shift+D on Windows and Linux) with the browser tab in front, or **Kural: Toggle Design
Mode**. A small toolbar appears at the top of the page: Select, the markup tools, Batch and Exit. While Design Mode is on,
links and buttons on the page don't act: your clicks are for Design Mode.

| Keys | Where | What it does |
|---|---|---|
| point | the page | outlines what's under the pointer, with its tag and size |
| Arrow Up / Down | pointing at an element | moves the outline to its parent / its first child |
| click | the page | opens a note for that element |
| Shift+click | the page | adds the element to the same note |
| Option+click (Alt+click) | the page | puts the element straight into the chat box (or into the open note) |
| drag (Shift: one axis, Option/Alt: from the centre) | the page | boxes in an area |
| Return | a note | sends it to the chat's AI at once (with Batch on: saves it as a numbered pin) |
| Shift+Return | a note | a new line |
| Cmd+L (Ctrl+L) | a note | puts it in the chat box instead of sending |
| double-click, then Return or Esc | text on the page | edits it in place: keeps it / puts the old text back |
| Cmd+Z (Ctrl+Z) | markup | undoes the last mark |
| Esc | anywhere | backs out one step (a mark, a text edit, the CSS panel, the note, the selection, the tool), then turns Design Mode off |

- **Markup:** the toolbar's Draw, Ellipse, Rectangle and Arrow tools draw on the page; the marks go into the note's picture.
- **Edit text in place:** double-click a piece of text. Text edits collect; the toolbar's **Send** sends them.
- **Edit CSS properties:** in a note for one element: filter the list, change a value, see it at once. The changes go with
  the note as old → new.
- **Dictate:** puts the note in the chat box and starts Kural's voice input there (offline, on your computer).
- **Batch** (toolbar, or the setting `kural.browser.designMode.batch`): Return saves each note as a numbered pin;
  **Send (n)** sends them all in one message and turns Design Mode off. The list beside it shows them; remove one there.
- **While the AI works:** a note you send while an answer runs queues like any message you send then. If the chat's AI is
  itself clicking in that tab, Design Mode steps aside until its answer ends.

**What the AI gets:** for each element its tag, id, classes, attributes, a selector path, its first 200 characters of text,
its size and position, six computed styles (color, background color, font size, font family, display, position) and the
start of its HTML; in React, Vue and Svelte apps (dev builds) the component, the components around it, and its source
file and line. With the note: a picture cropped to it (your marks drawn in), your words, and the text and CSS you changed.
Your edits change only what you see until the page reloads; the AI makes the real change in your code, and your dev
server's hot reload shows it.

Design Mode draws inside the page in a closed shadow root, from a world of its own the page's scripts can't reach, and
talks to Kural through a channel only that world has, so a page can't send Kural a note. It works on the main page, not
inside an iframe.

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

Design Mode's button is a build-time change too (`scripts/rebrand.py` `add_design_mode_button`: one menu item beside the
inspect button); without it, Cmd/Ctrl+Shift+D and **Kural: Toggle Design Mode** still turn Design Mode on. Design Mode
itself is Kural's (`extension/lib/browser/design*.js`): over the same DevTools connection the AI's browser tools use.

VS Code's browser sends what you pick to VS Code's own chat panel, which Kural doesn't have. A small build-time change
(`scripts/rebrand.py`) makes it call Kural instead, and turns on the "Add to Chat" buttons that VS Code hides when its
own chat is off. If a future VS Code changes that code, the build prints a warning and the browser works as plain
browser, without the buttons.

The AI's hands are VS Code's own browser API for extensions (its browser tabs, and a DevTools connection to one), not a
change to VS Code: the chat's program gets Kural's browser tools (an MCP server, `extension/lib/browser/`), each call
comes to Kural, and Kural clicks and types with real input events. The page outline the AI reads is the page's
accessibility tree (what a screen reader gets), with a ref for each thing on it.
