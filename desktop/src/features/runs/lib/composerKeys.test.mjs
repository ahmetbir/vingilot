import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveComposerKey } from "./composerKeys.ts";

test("primary+Enter sends", () => {
  assert.deepEqual(
    resolveComposerKey({ key: "Enter", primaryModifier: true }),
    {
      type: "send-message",
    },
  );
});

test("a bare Enter is a newline, not a send", () => {
  // The whole reason this chord is not ↵: a message here carries a path and
  // goes to a server, and a newline is the more likely keystroke.
  assert.equal(
    resolveComposerKey({ key: "Enter", primaryModifier: false }),
    null,
  );
});

test("⇧ and ⌥ do not stop a send", () => {
  // What the inline handler did, kept: a ⇧⌘↵ that put a newline in and sent
  // nothing would be a message the owner thinks he sent.
  assert.deepEqual(
    resolveComposerKey({
      altKey: true,
      key: "Enter",
      primaryModifier: true,
      shiftKey: true,
    }),
    { type: "send-message" },
  );
});

test("no other key in the composer is this map's", () => {
  // Everything else typed here is text. A map that answered to a letter would
  // eat it out of the draft.
  for (const key of ["k", "Escape", "ArrowUp", "Tab"]) {
    assert.equal(resolveComposerKey({ key, primaryModifier: true }), null, key);
  }
});
