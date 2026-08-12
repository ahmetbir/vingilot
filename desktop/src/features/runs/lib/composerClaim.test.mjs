// The one claimant ⌘K gives back, as a truth table
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 2).
//
// `readComposerCaret` is not tested here — it needs a document, and the E2E
// spec is what has one. What is here is the decision that document feeds.

import assert from "node:assert/strict";
import { test } from "node:test";

import { composerHoldsGo } from "./composerClaim.ts";

const OUTSIDE = { collapsed: true, inComposer: false, onLink: false };

test("outside a composer nothing is deferred, whatever the selection is", () => {
  // The workspace is the case: a ⌘K over a terminal, a diff or a file tree is
  // this fork's, and a selection in a code viewer is not a link editor.
  assert.equal(composerHoldsGo(OUTSIDE), false);
  assert.equal(composerHoldsGo({ ...OUTSIDE, collapsed: false }), false);
  assert.equal(composerHoldsGo({ ...OUTSIDE, onLink: true }), false);
});

test("a bare caret in a composer is the palette's — the state the bug is about", () => {
  // The composer is auto-focused on a channel screen, so this is where the
  // owner stands when he presses ⌘K. Deferring here would put upstream's
  // dialog back on the chord in the common case, which is the split Task 2
  // removes ("cmd k buzz kısmında farklı deck kısmında farklı çalışıyor").
  assert.equal(
    composerHoldsGo({ collapsed: true, inComposer: true, onLink: false }),
    false,
  );
});

test("a selection in a composer is upstream's, and so is a caret on a link", () => {
  // Upstream's own condition, both halves: `getLinkSelectionInfo` answers when
  // the caret resolves to a link, and otherwise when `from !== to`.
  assert.equal(
    composerHoldsGo({ collapsed: false, inComposer: true, onLink: false }),
    true,
  );
  assert.equal(
    composerHoldsGo({ collapsed: true, inComposer: true, onLink: true }),
    true,
  );
  assert.equal(
    composerHoldsGo({ collapsed: false, inComposer: true, onLink: true }),
    true,
  );
});
