// Which host owns the palette, proved as a counter
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 2).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  claimPalette,
  paletteClaimed,
  resetPaletteClaim,
  subscribePaletteClaim,
} from "./paletteClaim.ts";

test("nothing is claimed until a workspace mounts", () => {
  resetPaletteClaim();
  assert.equal(paletteClaimed(), false);
  const release = claimPalette();
  assert.equal(paletteClaimed(), true);
  release();
  assert.equal(paletteClaimed(), false);
});

test("an overlapping mount does not hand the palette back early", () => {
  // React can mount the next instance before unmounting the last (a route
  // transition, StrictMode's double-invoke). A flag would be cleared by the
  // departing one AFTER the arriving one set it, and the shell would bind ⌘K
  // over a live workspace — two hosts, one chord, which is the bug this whole
  // module exists to make impossible.
  resetPaletteClaim();
  const first = claimPalette();
  const second = claimPalette();
  first();
  assert.equal(paletteClaimed(), true);
  second();
  assert.equal(paletteClaimed(), false);
});

test("a release runs once however often it is called", () => {
  resetPaletteClaim();
  const release = claimPalette();
  release();
  release();
  release();
  assert.equal(paletteClaimed(), false);
  // And the count is not negative: a claim after those releases still claims.
  const again = claimPalette();
  assert.equal(paletteClaimed(), true);
  again();
});

test("subscribers hear both edges, and one that throws does not silence the rest", () => {
  resetPaletteClaim();
  const heard = [];
  const stopAngry = subscribePaletteClaim(() => {
    throw new Error("a subscriber's failure is not the claimant's");
  });
  const stop = subscribePaletteClaim((claimed) => heard.push(claimed));
  const release = claimPalette();
  release();
  assert.deepEqual(heard, [true, false]);
  stopAngry();
  stop();
});
