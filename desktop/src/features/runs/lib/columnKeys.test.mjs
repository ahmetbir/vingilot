import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveColumnKey } from "./columnKeys.ts";

test("primary+b toggles the sidebar", () => {
  assert.deepEqual(resolveColumnKey({ key: "b", primaryModifier: true }), {
    column: "sidebar",
    type: "toggle-column",
  });
});

test("shift+primary+b is retired — refused, not folded onto the sidebar", () => {
  // The chord that used to hide the workspace nav
  // (vingilot/docs/plans/2026-08-14-single-sidebar.md, Task 2). The nav lives
  // inside the app sidebar now, so a ⇧⌘B that still answered would either be
  // a second spelling of ⌘B or a toggle for a column that no longer exists.
  assert.equal(
    resolveColumnKey({ key: "b", primaryModifier: true, shiftKey: true }),
    null,
  );
});

test("caps lock does not lose the chord", () => {
  assert.deepEqual(resolveColumnKey({ key: "B", primaryModifier: true }), {
    column: "sidebar",
    type: "toggle-column",
  });
  // But a real ⇧ still refuses, capitals or not — the retirement above is
  // about the modifier, not the letter's case.
  assert.equal(
    resolveColumnKey({ key: "B", primaryModifier: true, shiftKey: true }),
    null,
  );
});

test("b without the primary modifier is just a letter", () => {
  assert.equal(resolveColumnKey({ key: "b", primaryModifier: false }), null);
  assert.equal(
    resolveColumnKey({ key: "b", primaryModifier: false, shiftKey: true }),
    null,
  );
});

test("alt+primary+b resolves to nothing — it is the right pane's chord", () => {
  assert.equal(
    resolveColumnKey({ altKey: true, key: "b", primaryModifier: true }),
    null,
  );
  assert.equal(
    resolveColumnKey({
      altKey: true,
      key: "b",
      primaryModifier: true,
      shiftKey: true,
    }),
    null,
  );
});

test("auto-repeat is not a second press", () => {
  assert.equal(
    resolveColumnKey({ key: "b", primaryModifier: true, repeat: true }),
    null,
  );
});

test("chords this map does not own fall through", () => {
  for (const key of ["a", "s", "t", "w", "k", "n", "1", "`", "Escape"]) {
    assert.equal(
      resolveColumnKey({ key, primaryModifier: true }),
      null,
      `primary+${key} is not a column toggle`,
    );
    assert.equal(
      resolveColumnKey({ key, primaryModifier: true, shiftKey: true }),
      null,
      `shift+primary+${key} is not a column toggle`,
    );
  }
});
