# Inline Edit (Ctrl+K)

Select code, press **Ctrl+K** (**Cmd+K** on a Mac) and a box opens right under the selection, in the code: say what to
change and press **Enter** (**Shift+Enter** for a new line; **Esc** or **Cancel** closes it). Kural shows a read-only diff, red and
green; keep it (**Ctrl+Enter**, **Cmd+Enter** on a Mac, or **Accept** above it) or reject it (**Ctrl+Shift+Backspace**,
**Cmd+Shift+Backspace** on a Mac, or **Reject**). With nothing selected, Ctrl+K proposes new code at the cursor.

While code is selected, a small label shows right after the selection: **Add to Chat ⌘L · Edit ⌘K** (Ctrl+L / Ctrl+K on
Windows and Linux). Point at it, or at the selected code, and the two are buttons: **Add to Chat** puts the selection into
your chat message, **Edit Selection** does the same as Ctrl+K. (Read-only files get Add to Chat only.) The label never
moves your code; the setting `kural.editor.selectionButtons` turns it off.

It uses the chat's model (Claude or [[Your Own Model]]).

**Apply** on a code block in the chat works the same way: Kural previews the proposed code before applying it.

The original file stays unchanged until Accept, including with Auto Save enabled. If you edit the original while
reviewing, Kural discards the proposal to preserve your edits.

Inside the editor, Ctrl+K is Kural's, so VS Code's two-key Ctrl+K shortcuts don't work there; Git's moved to
**Ctrl+Alt+K**. Use **Ctrl+/** to comment code.
