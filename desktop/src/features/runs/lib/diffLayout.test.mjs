import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diffListPlacement,
  LIST_LEAVES_BELOW_PX,
  LIST_MIN_PX,
  LIST_PREFERRED_PX,
  PATCH_MIN_PX,
  patchWrapsAt,
} from "./diffLayout.ts";

/** The pane width the owner's 16-inch MacBook Pro actually gives the Diff pane,
 * measured in a browser at 1728×1117: a 1003px work surface, less the 8px
 * divider, less the 752px `MIN_LEFT_PX` keeps for the terminal's 80 columns.
 *
 * Written out rather than imported from `paneModel.ts` and recomputed: a test
 * that derived the number the way the product does would pass through any
 * change to either, and this number is the whole reason this file exists. */
const SIXTEEN_INCH_PANE_PX = 243;

/** The same arithmetic on the 14-inch's 1512 logical width gives a 787px
 * surface, which `effectiveSolo` will not split at all — the terminal takes it
 * and the Diff pane goes to its rail. Kept here as the reason there is no
 * 14-inch case below: at that width there is no Diff pane to lay out. */
const FOURTEEN_INCH_SURFACE_PX = 787;

test("the file list does not stand beside the patch on a 16-inch laptop", () => {
  // The defect, stated as arithmetic: 288px of list in a 243px pane left the
  // patch 32px of client width against 704px of content.
  assert.ok(LIST_PREFERRED_PX > SIXTEEN_INCH_PANE_PX);
  assert.deepEqual(diffListPlacement(SIXTEEN_INCH_PANE_PX), { where: "over" });
});

test("the patch keeps its floor while the list gives ground", () => {
  // One pixel above the crossing: the list is beside the patch, and it is the
  // list that has been narrowed — the patch is at exactly its floor.
  const placement = diffListPlacement(LIST_LEAVES_BELOW_PX);
  assert.deepEqual(placement, { listPx: LIST_MIN_PX, where: "beside" });
  assert.equal(LIST_LEAVES_BELOW_PX - placement.listPx, PATCH_MIN_PX);
});

test("one pixel narrower and the list leaves", () => {
  assert.deepEqual(diffListPlacement(LIST_LEAVES_BELOW_PX - 1), {
    where: "over",
  });
});

test("a pane that can afford both gives the list its preferred width", () => {
  // What the pane gets when the owner maximises it (⌥⌘B) on the same laptop:
  // the whole 995px the two panes share.
  const soloed = 995;
  assert.deepEqual(diffListPlacement(soloed), {
    listPx: LIST_PREFERRED_PX,
    where: "beside",
  });
  assert.ok(soloed - LIST_PREFERRED_PX >= PATCH_MIN_PX);
});

test("between the two the list yields pixel for pixel, and only the list", () => {
  for (let pane = LIST_LEAVES_BELOW_PX; pane <= 900; pane += 1) {
    const placement = diffListPlacement(pane);
    assert.equal(placement.where, "beside", `pane ${pane}`);
    assert.ok(placement.listPx <= LIST_PREFERRED_PX, `pane ${pane}`);
    assert.ok(placement.listPx >= LIST_MIN_PX, `pane ${pane}`);
    // The patch is never below its floor while the list is still there. That
    // is the decision this module makes, and it is the one that could be got
    // wrong by a flexbox instead.
    assert.ok(pane - placement.listPx >= PATCH_MIN_PX, `pane ${pane}`);
  }
});

test("an unmeasured pane is not a narrow one", () => {
  // The rule `paneModel.ts` states twice: never invent a layout from a width
  // nobody has read. A pane mid-layout must not flash its drawer open.
  for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(
      diffListPlacement(width),
      { listPx: LIST_PREFERRED_PX, where: "beside" },
      `width ${width}`,
    );
  }
});

test("the patch wraps exactly where it is under its own floor", () => {
  // The pane he actually has. Sending the list away gave the patch all 243px
  // of it, which is 29 columns — the list leaving is not on its own an answer
  // to "diff görünmüyor".
  assert.equal(patchWrapsAt(SIXTEEN_INCH_PANE_PX), true);
  // The crossing, from both sides: at its floor the patch has the columns the
  // floor is made of and keeps the grid; one pixel under and it wraps.
  assert.equal(patchWrapsAt(PATCH_MIN_PX), false);
  assert.equal(patchWrapsAt(PATCH_MIN_PX - 1), true);
});

test("a patch with the list beside it never wraps", () => {
  // The other half of the decision: the list only ever yields, so while it is
  // standing there the patch is above its floor by construction — and a diff
  // above its floor is a grid, not a paragraph.
  for (let pane = LIST_LEAVES_BELOW_PX; pane <= 2000; pane += 1) {
    assert.equal(diffListPlacement(pane).where, "beside", `pane ${pane}`);
    assert.equal(patchWrapsAt(pane), false, `pane ${pane}`);
  }
});

test("an unmeasured pane does not wrap either", () => {
  for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(patchWrapsAt(width), false, `width ${width}`);
  }
});

test("the 14-inch never reaches this file", () => {
  // 787px of surface, less the 8px divider, is 779 — and 779 − 752 is 27px of
  // right pane, under `MIN_REACHABLE_PX`. `effectiveSolo` gives the terminal
  // the surface and puts Diff on its rail, so no width this module would have
  // to answer for is ever asked.
  assert.ok(FOURTEEN_INCH_SURFACE_PX - 8 - 752 < 48);
});
