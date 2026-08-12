// ⌥⌘M, and what an open scratch buffer shields
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 4).
//
// The chord half of this is about the two readings macOS can deliver for one key
// press and the three neighbouring chords it must not answer to. The shield half
// is about a text box: the chords that must reach it are the ones a text box is
// made of, and getting that wrong makes an editor that cannot copy or paste.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveScratchMarkdownKey,
  resolveScratchMarkdownShield,
} from "./scratchMarkdownKeys.ts";

const OPEN = { type: "open-scratch-markdown" };

/** A keydown, with the fields this map reads. */
function press(
  key,
  { alt = true, primary = true, repeat = false, shift } = {},
) {
  return {
    altKey: alt,
    key,
    primaryModifier: primary,
    repeat,
    shiftKey: shift,
  };
}

test("⌥⌘M opens the buffer", () => {
  assert.deepEqual(resolveScratchMarkdownKey(press("m")), OPEN);
});

test("the reading macOS gives when ⌥ still composes is the same chord", () => {
  // ⌥m is "µ" on a US layout, exactly as ⌥t is "†" and ⌥b is "∫". Losing the
  // chord to the composition would make it work on nobody's machine.
  assert.deepEqual(resolveScratchMarkdownKey(press("µ")), OPEN);
});

test("a stuck caps lock does not take the chord away", () => {
  // "M" with no ⇧ held: the bug nobody would think to look for.
  assert.deepEqual(resolveScratchMarkdownKey(press("M")), OPEN);
});

test("the three neighbours it must not answer to", () => {
  // ⌘M is the default macOS menu's minimize (muda's own table) and never reaches
  // the webview at all; ⌥M without ⌘ is a composed character somebody is typing;
  // and ⇧⌥⌘M is nobody's, so claiming it would take a chord the four-claimant
  // check in this module's header was never run for.
  assert.equal(resolveScratchMarkdownKey(press("m", { alt: false })), null);
  assert.equal(resolveScratchMarkdownKey(press("m", { primary: false })), null);
  assert.equal(resolveScratchMarkdownKey(press("m", { shift: true })), null);
});

test("a held-down chord is one press, not fifteen a second", () => {
  assert.equal(resolveScratchMarkdownKey(press("m", { repeat: true })), null);
});

test("no other key opens it", () => {
  for (const key of ["t", "†", "b", "∫", "n", "Enter", "Escape", "1"]) {
    assert.equal(
      resolveScratchMarkdownKey(press(key)),
      null,
      `${key} is not this chord`,
    );
  }
});

test("the same chord closes what it opened", () => {
  // A key that opens a surface and then does nothing is a key the owner presses
  // twice looking for the way out.
  assert.deepEqual(resolveScratchMarkdownShield(press("m")), {
    type: "close",
  });
  assert.deepEqual(resolveScratchMarkdownShield(press("µ")), {
    type: "close",
  });
});

test("Escape closes it, which is the one thing the two scratches do not share", () => {
  // The shell shields Escape because a terminal owns it — vim, less, every
  // reader. A textarea does not, and every modal editor he has used closes on it.
  assert.deepEqual(
    resolveScratchMarkdownShield(
      press("Escape", { alt: false, primary: false }),
    ),
    { type: "close" },
  );
});

test("the chords the surfaces underneath would have acted on are shielded", () => {
  // Each of these does something to a surface that is not in front of him:
  // ⇧⌘W ends a shell, ⌘T opens one he cannot see, ⌘` and ⌘1 move the keyboard or
  // the worktree out from under the buffer, ⌥⌘B and ⌘B rearrange the columns
  // behind it.
  const shielded = [
    press("w", { alt: false, shift: true }),
    press("t", { alt: false }),
    press("`", { alt: false }),
    press("1", { alt: false }),
    press("b"),
    press("b", { alt: false }),
    press("ArrowRight"),
  ];
  for (const input of shielded) {
    assert.deepEqual(
      resolveScratchMarkdownShield(input),
      { type: "shield" },
      `${input.key} should not reach the panes behind the buffer`,
    );
  }
});

test("the keys a text box is made of are not shielded", () => {
  // The failure this guards is a buffer you cannot copy out of or undo in.
  // ⌘A/⌘C/⌘X/⌘V/⌘Z are the default macOS menu's and are resolved before the
  // webview ever sees them; nothing here may claim to have an opinion about
  // them. ⌘K is left alone on purpose too — the palette is a second door to this
  // very surface, so a buffer that swallowed it would close the door it came
  // through.
  const through = [
    press("a", { alt: false }),
    press("c", { alt: false }),
    press("x", { alt: false }),
    press("v", { alt: false }),
    press("z", { alt: false }),
    press("k", { alt: false }),
    press("Enter", { alt: false, primary: false }),
    press("a", { alt: false, primary: false }),
    press("ArrowUp", { alt: false, primary: false }),
  ];
  for (const input of through) {
    assert.equal(
      resolveScratchMarkdownShield(input),
      null,
      `${input.key} has to reach the editor`,
    );
  }
});
