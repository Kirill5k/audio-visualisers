# Agent Instructions

## Project Structure

- Each HTML file in the project root is a stand-alone audio visualiser. Open the relevant HTML page directly through the local server.
- Some visualisers use shared assets in `js/`, `css/`, and `fonts/`; account for other consumers when changing shared files.
- HTML files under `tests/` are browser test harnesses, not visualisers.

## Package Manager

- This is a static HTML/CSS/JavaScript project with no package manifest or build step. Use npm's `npx` to run the local server.

## Browser Testing

- First check `http://localhost:3000`; the server is frequently already running. Reuse it when it serves this project.
- If no project server is running, start one from the project root:

  ```sh
  npx serve
  ```

- Open the HTML file being changed, for example `http://localhost:3000/signal-atlas.html`. If the server reports a different port, use that URL.
- Load the project's `reference.mp3` using the page's reference-track control or audio file picker, then start playback if needed.
- Check that the visualiser responds to the audio, exercise the controls affected by the change, and check the browser console for errors.

## File-Scoped Commands

- Run the relevant existing Node test when changing covered logic, for example:

  ```sh
  node --test tests/mesh-grid-analysis.test.mjs
  ```
