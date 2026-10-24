# Inline Edit (Ctrl+K)

Select code, press **Ctrl+K** (**Cmd+K** on a Mac) and a box opens right under the selection, in the code, like Cursor's.
Its buttons show their keys:

| Button | Key | What it does |
|---|---|---|
| **Edit** | Enter | Kural changes the code as you said (below). |
| **Quick Question** | Alt+Enter (⌥Enter on a Mac) | A quick answer about that code, right in the box. |
| **Send to Chat** | Ctrl+L (Cmd+L on a Mac) | The selected code and what you typed go into the chat's message box; you press Send. |
| **Cancel** | Esc | Closes the box. |

**Shift+Enter** is a new line.

**Edit:** say what to change and press **Enter**. Kural shows a read-only diff, red and
green; keep it (**Ctrl+Enter**, **Cmd+Enter** on a Mac, or **Accept** above it) or reject it (**Ctrl+Shift+Backspace**,
**Cmd+Shift+Backspace** on a Mac, or **Reject**). With nothing selected, Ctrl+K proposes new code at the cursor.

**Quick Question:** ask something about the code ("why a while loop here?") and press **Alt+Enter**. The fastest model
you have answers (Claude's Haiku, or the lightest Gemini or ChatGPT model), without tools: it only reads what you
selected and the lines around it, and changes nothing. The box stays open: ask again (it remembers what you asked in
it), or type an instruction and press **Enter** to edit; the edit knows your questions and the answers, so "do what you
suggested" works. With nothing selected, the question is about the line you're on.

**Send to Chat:** for something bigger than a quick question. The selected code (with nothing selected, the file) goes
into your chat message as a chip, followed by what you typed in the box. Nothing is sent until you press Send.

Select code and, a moment after you stop, two buttons pop up at the cursor, with their keys: **Add to Chat ⌘L** puts the
selection into your chat message (Ctrl+L on Windows and Linux), **Quick Edit ⌘K** opens the Ctrl+K box. (Read-only files get Add to Chat only.)
They don't take the keyboard, so you can keep typing or extend the selection; they go when the cursor moves, when you
type or press Esc, and pointing at the selected code brings them back. Another extension's information for that spot (a
type, a blame line) can show in the same pop-up. The setting `kural.editor.selectionButtons` turns them off.

The box Ctrl+K opens starts two lines tall and grows as you type more lines.

Edit uses the chat's model (Claude or [[Your Own Model]]); Quick Question uses the fastest one you have.

**Apply** on a code block in the chat works the same way: Kural previews the proposed code before applying it.

The original file stays unchanged until Accept, including with Auto Save enabled. If you edit the original while
reviewing, Kural discards the proposal to preserve your edits.

Inside the editor, Ctrl+K is Kural's, so VS Code's two-key Ctrl+K shortcuts don't work there; Git's moved to
**Ctrl+Alt+K**. Use **Ctrl+/** to comment code.
