import assert from "node:assert/strict";
import { test } from "node:test";
import { hasStackedSurface, resolveCloseRequest } from "./closeRequest.ts";

/** Nothing on screen but the work surface. */
const BARE = {
  cheatsheet: false,
  dialog: false,
  palette: false,
  scratch: false,
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

test("a dialog outranks everything under it", () => {
  assert.deepEqual(
    resolveCloseRequest({
      cheatsheet: true,
      dialog: true,
      palette: true,
      scratch: true,
    }),
    { type: "dismiss-dialog" },
  );
});

test("a close request over the bare workspace is about the window", () => {
  assert.equal(resolveCloseRequest(BARE), null);
});

test("what the backend is told is exactly what would be dismissed", () => {
  // Every arrangement, so the two answers cannot disagree for any of them —
  // a disagreement is the window minimizing over a shell the owner meant to
  // close, or a ⌘W that does nothing at all.
  for (const cheatsheet of [false, true]) {
    for (const dialog of [false, true]) {
      for (const palette of [false, true]) {
        for (const scratch of [false, true]) {
          const stacked = { cheatsheet, dialog, palette, scratch };
          assert.equal(
            hasStackedSurface(stacked),
            resolveCloseRequest(stacked) !== null,
            `disagreed for ${JSON.stringify(stacked)}`,
          );
        }
      }
    }
  }
  assert.equal(hasStackedSurface(BARE), false);
  assert.equal(hasStackedSurface({ ...BARE, scratch: true }), true);
});
