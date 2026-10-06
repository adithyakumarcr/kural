# Kural Browser

Your web app beside the code, with **Select element**: click something on the page and it's added to the chat, the way
Cursor does it.

- Open it with **Kural: Open Browser** (Command Palette), **+ → Pick from a browser** in the chat, or a
  `http://localhost:…` link in an answer. Type the address (`localhost:5173`, or just `5173`) and press Enter.
- **Select element** (or the button's icon in a narrow tab), then move over the page: what's under the mouse is
  outlined with its tag and size. Click it, and it's added to the message you're writing as a pill. **Esc** stops.
- The model gets the element's tag, a CSS selector, its text, its HTML (shortened), its main styles, its size, and, for
  React or Vue apps in development, the component that drew it and the file it's in.
- Back, forward, reload, and **Open in your browser** are in the bar.

How it works: the page comes through a small proxy on your own computer (only your computer can reach it), which adds
Kural's picker to each page. The dev server's live reload keeps working.
