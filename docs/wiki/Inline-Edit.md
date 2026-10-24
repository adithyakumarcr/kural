# Inline Edit (Ctrl+K)

Select code, press **Ctrl+K** (**Cmd+K** on a Mac) and a box opens right under the selection, in the code: say what to
change and press **Enter** (**Shift+Enter** for a new line; **Esc** or **Cancel** closes it). Kural shows a read-only diff, red and
green; keep it (**Ctrl+Enter**, **Cmd+Enter** on a Mac, or **Accept** above it) or reject it (**Ctrl+Shift+Backspace**,
**Cmd+Shift+Backspace** on a Mac, or **Reject**). With nothing selected, Ctrl+K proposes new code at the cursor.

Select code and, a moment after you stop, two buttons pop up at the cursor: **Add to Chat** puts the selection into your
chat message (Ctrl+L, Cmd+L on a Mac), **Edit Selection** does the same as Ctrl+K. (Read-only files get Add to Chat only.)
They don't take the keyboard, so you can keep typing or extend the selection; they go when the cursor moves, when you
type or press Esc, and pointing at the selected code brings them back. Another extension's information for that spot (a
type, a blame line) can show in the same pop-up. The setting `kural.editor.selectionButtons` turns them off.

The box Ctrl+K opens starts two lines tall and grows as you type more lines.

It uses the chat's model (Claude or [[Your Own Model]]).

**Apply** on a code block in the chat works the same way: Kural previews the proposed code before applying it.

The original file stays unchanged until Accept, including with Auto Save enabled. If you edit the original while
reviewing, Kural discards the proposal to preserve your edits.

Inside the editor, Ctrl+K is Kural's, so VS Code's two-key Ctrl+K shortcuts don't work there; Git's moved to
**Ctrl+Alt+K**. Use **Ctrl+/** to comment code.
