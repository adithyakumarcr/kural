# Search & Ask

The magnifier icon in the left side bar has two tabs: **Search** (find and replace text) and **Ask** (find code by
describing it). Kural's Search takes the place of VS Code's own Search view, which Kural hides.

## Search (Ctrl+Shift+F)

Everything VS Code's Search did:

- **Toggles** in the search box: **Match Case** (Alt+C), **Match Whole Word** (Alt+W), **Use Regular Expression**
  (Alt+R). Ctrl+Enter adds a new line, to search across lines.
- **Replace** (Ctrl+Shift+H, or the arrow left of the box), with **Preserve Case** (Alt+P). With a regular expression,
  `$1`, `$&`, `\n`, and `\u` `\l` `\U` `\L` (upper/lower case) work. The results show each change (old struck through,
  new after it); click one for the **Replace Preview** (the file beside your changed version). Replace one match, a whole
  file, or **Replace All** (Ctrl+Alt+Enter; it asks first). Files you weren't editing are saved; undo with Ctrl+Z.
- **Search details** (the **...** under the box): **files to include** and **files to exclude** (`*.ts`, `src`,
  `./docs/*.md`, several with commas), **Search only in Open Editors**, and **Use Exclude Settings and Ignore Files**
  (VS Code's `files.exclude` / `search.exclude` and your `.gitignore`).
- Results come **as you type**, grouped by file, with a count on the icon. Files you're editing are searched as they
  are on screen, not as saved, and the results follow your changes.
- **Up/Down** in the box: earlier searches.
- The title bar: **Refresh**, **Clear**, **Open in Search Editor**, **View as Tree / List**, **Collapse / Expand All**.
- In the results: click opens the place, double-click keeps the tab; arrow keys move, **Enter** opens, **Space** opens
  and stays in the list, **Delete** dismisses. Hover for **Replace** and **Dismiss**. Right-click: **Copy**, **Copy
  Path**, **Copy All**, **Reveal in Explorer View**.
- **F4 / Shift+F4**: the next / previous result, from anywhere.
- Explorer: right-click a folder → **Find in Folder...**.

VS Code's search settings still apply (`search.searchOnType`, `search.smartCase`, `search.collapseResults`,
`search.defaultViewMode`, `search.showLineNumbers`, `search.maxResults`, `search.followSymlinks`).

## Ask (Ctrl+Alt+A)

Ask finds code by describing it: "where is the retry limit set?", "what sends the welcome email?". Kural searches your
project and lists the exact places (`file:line`); click one to open it. It uses the chat's model (Claude, Gemini,
ChatGPT or [[Your Own Model]]).
