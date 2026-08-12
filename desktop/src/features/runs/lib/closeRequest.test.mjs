import assert from "node:assert/strict";
import { test } from "node:test";
import { hasStackedSurface, resolveCloseRequest } from "./closeRequest.ts";

/** Nothing on screen but the work surface — and a lone terminal tab, which is
 * not closable (`closeRequest.ts`: closing the last tab would end its shell). */
const BARE = {
  cheatsheet: false,
  closableTab: false,
  dialog: false,
  palette: false,
  scratch: false,
  scratchMarkdown: false,
};

test("a close request over the scratch shell takes the scratch shell", () => {
  assert.deepEqual(resolveCloseRequest({ ...BARE, scratch: true }), {
    type: "dismiss-scratch",
  });
});

test("a close request over the palette takes the palette", () => {
  assert.deepEqual(resolveCloseRequest({ ...BARE, palette: true }), {
    type: "dismiss-palette",
  });
});

test("a close request over a dialog takes the dialog", () => {
  assert.deepEqual(resolveCloseRequest({ ...BARE, dialog: true }), {
    type: "dismiss-dialog",
  });
});

test("the palette opened over the scratch shell is what a close takes", () => {
  assert.deepEqual(
    resolveCloseRequest({ ...BARE, palette: true, scratch: true }),
    { type: "dismiss-palette" },
  );
});

test("a close request over the cheatsheet takes the cheatsheet", () => {
  assert.deepEqual(resolveCloseRequest({ ...BARE, cheatsheet: true }), {
    type: "dismiss-cheatsheet",
  });
});

test("the sheet is above the shell it was opened over and below the palette", () => {
  // The order the sheet's own ⌘W row prints back to the owner. It reads the
  // sheet away first, then the shell — one surface per request, in the order
  // they are stacked.
  assert.deepEqual(
    resolveCloseRequest({ ...BARE, cheatsheet: true, scratch: true }),
    { type: "dismiss-cheatsheet" },
  );
  assert.deepEqual(
    resolveCloseRequest({
      ...BARE,
      cheatsheet: true,
      palette: true,
      scratch: true,
    }),
    { type: "dismiss-palette" },
  );
});

test("the markdown scratch is taken before the shell it sits beside", () => {
  // The two scratches are drawn at the same layer, and the buffer is the
  // typing surface — ⌘W with text on screen takes the thing the cursor is in.
  assert.deepEqual(
    resolveCloseRequest({ ...BARE, scratch: true, scratchMarkdown: true }),
    { type: "dismiss-scratchMarkdown" },
  );
});

test("a dialog outranks everything under it", () => {
  assert.deepEqual(
    resolveCloseRequest({
      cheatsheet: true,
      closableTab: true,
      dialog: true,
      palette: true,
      scratch: true,
      scratchMarkdown: true,
    }),
    { type: "dismiss-dialog" },
  );
});

test("with nothing stacked, ⌘W closes the active terminal tab", () => {
  // The VS Code hand the owner asked for: ⌘W closes the thing he is looking
  // at. The overlays still outrank it — a tab must not vanish behind an open
  // palette.
  assert.deepEqual(resolveCloseRequest({ ...BARE, closableTab: true }), {
    type: "dismiss-closableTab",
  });
  assert.deepEqual(
    resolveCloseRequest({ ...BARE, closableTab: true, scratch: true }),
    { type: "dismiss-scratch" },
  );
});

test("a close request over the bare workspace is about the window", () => {
  // No overlay and a lone tab: the request is the window's, and the backend
  // answers it by minimizing — never by ending the last shell.
  assert.equal(resolveCloseRequest(BARE), null);
});

test("what the backend is told is exactly what would be dismissed", () => {
  // Every arrangement, so the two answers cannot disagree for any of them —
  // a disagreement is the window minimizing over a shell the owner meant to
  // close, or a ⌘W that does nothing at all.
  for (const cheatsheet of [false, true]) {
    for (const closableTab of [false, true]) {
      for (const dialog of [false, true]) {
        for (const palette of [false, true]) {
          for (const scratch of [false, true]) {
            for (const scratchMarkdown of [false, true]) {
              const stacked = {
                cheatsheet,
                closableTab,
                dialog,
                palette,
                scratch,
                scratchMarkdown,
              };
              assert.equal(
                hasStackedSurface(stacked),
                resolveCloseRequest(stacked) !== null,
                `disagreed for ${JSON.stringify(stacked)}`,
              );
            }
          }
        }
      }
    }
  }
  assert.equal(hasStackedSurface(BARE), false);
  assert.equal(hasStackedSurface({ ...BARE, closableTab: true }), true);
});
