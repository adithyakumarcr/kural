# Cell Console

Web console for a robotic welding cell: operators chat with an assistant about the current job, and the app plans weld
seams and sends programs to the robot controller.

- `src/api/` talks to the cell's backend (`ApiClient`).
- `src/components/` holds the Vue components (the chat input is `ChatInput.vue`).
- `src/weld/` plans seams and weave patterns.
- Tests are in `test/` and run with `npm test` (vitest).
