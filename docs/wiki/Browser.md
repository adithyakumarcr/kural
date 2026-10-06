# Browser (Design Mode)

Kural has a browser inside it: your app on localhost, or any website, in a tab beside the code. It's VS Code's own
Integrated Browser (a real browser: logins, dev tools, everything), with Kural's chat plugged into it, so you can do what
Cursor calls Design Mode: **click an element on the page and tell Kural what to change**.

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

The dropdown also adds **a screenshot** (the page, an area, or the full page) and the page's **console logs** to the
message. Pictures arrive as attachments; click one in the chat to see it full size.

Sharing: the first time you pick from a site that isn't your own computer, VS Code asks whether you're happy to put its
content in the chat.

## Under the hood

VS Code's browser sends what you pick to VS Code's own chat panel, which Kural doesn't have. A small build-time change
(`scripts/rebrand.py`) makes it call Kural instead, and turns on the "Add to Chat" buttons that VS Code hides when its
own chat is off. If a future VS Code changes that code, the build prints a warning and the browser works as plain
browser, without the buttons.
