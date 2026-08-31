import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changeAnchors,
  fileTally,
  hiddenNote,
  ratioBlocks,
  rowWindow,
  stepAnchor,
  withoutWhitespaceChanges,
  wordMarkup,
} from "./diffTab.ts";
import { unifiedRows } from "./unifiedDiff.ts";

const PATCH = [
  "@@ -41,7 +41,8 @@ func testCheckoutCompletes()",
  "   let cart = try makeCart(items: 3)",
  "-  Thread.sleep(forTimeInterval: 0.3)",
  "-  let receipt = checkout.complete(cart)",
  "+  let stub = try await paymentStub.ready(timeout: 0.5)",
  "+  let receipt = try await checkout.complete(",
  "+      cart, using: stub)",
  "   XCTAssertEqual(receipt.state, .paid)",
].join("\n");

test("the ratio bar never says a side changed nothing when it did", () => {
  // The defect proportional rounding alone produces: 200 added against 1
  // removed rounds to five green blocks, which is a bar claiming a pure
  // addition.
  const lopsided = ratioBlocks(200, 1);
  assert.equal(lopsided.length, 5);
  assert.ok(lopsided.includes("deleted"));
  assert.ok(lopsided.includes("added"));

  assert.deepEqual(ratioBlocks(10, 0), [
    "added",
    "added",
    "added",
    "added",
    "added",
  ]);
  assert.deepEqual(ratioBlocks(0, 10), [
    "deleted",
    "deleted",
    "deleted",
    "deleted",
    "deleted",
  ]);
});

test("a file git reports as +0 −0 draws a neutral bar, not an empty one", () => {
  assert.deepEqual(ratioBlocks(0, 0), ["none", "none", "none", "none", "none"]);
});

test("word markup pairs a change block's removals with its additions", () => {
  const rows = unifiedRows(PATCH);
  const marks = wordMarkup(rows);
  // Two removed, three added: two pairs, and the third addition replaces
  // nothing so it carries no markup.
  const dels = rows
    .map((row, at) => [row, at])
    .filter(([row]) => row.kind === "line" && row.sign === "-")
    .map(([, at]) => at);
  const adds = rows
    .map((row, at) => [row, at])
    .filter(([row]) => row.kind === "line" && row.sign === "+")
    .map(([, at]) => at);
  assert.equal(dels.length, 2);
  assert.equal(adds.length, 3);
  assert.ok(marks.has(adds[0]) || marks.has(adds[1]));
  assert.equal(marks.has(adds[2]), false);
  // A context row is never marked up.
  assert.equal(marks.has(0), false);
});

test("ignore whitespace drops only PAIRED whitespace-only rewrites, and counts them", () => {
  const patch = [
    "@@ -1,4 +1,4 @@",
    " keep",
    "-  indented(x)",
    "+\tindented(x)",
    "-real(1)",
    "+real(2)",
  ].join("\n");
  const rows = unifiedRows(patch);
  const filtered = withoutWhitespaceChanges(rows);
  assert.equal(filtered.hidden, 2);
  const texts = filtered.rows
    .filter((row) => row.kind === "line")
    .map((row) => row.text);
  assert.deepEqual(texts, ["keep", "real(1)", "real(2)"]);
  assert.equal(hiddenNote(2), "2 whitespace-only lines hidden");
  assert.equal(hiddenNote(0), null);
});

test("a line only ADDED is never hidden, whatever it contains", () => {
  // A blank line added on its own is a real change to the file; a filter that
  // ate it would be hiding a change nobody asked to hide.
  const rows = unifiedRows(["@@ -1,1 +1,2 @@", " keep", "+   "].join("\n"));
  assert.equal(withoutWhitespaceChanges(rows).hidden, 0);
});

test("J and K walk change BLOCKS, not lines, and clamp at both ends", () => {
  const rows = unifiedRows(PATCH);
  const anchors = changeAnchors(rows);
  // One block: two removals then three additions, uninterrupted.
  assert.equal(anchors.length, 1);

  const many = [0, 5, 9];
  assert.equal(stepAnchor(many, null, 1), 0);
  assert.equal(stepAnchor(many, null, -1), 9);
  assert.equal(stepAnchor(many, 5, 1), 9);
  // Clamped, never wrapped — `historyModel.ts`'s rule: a history is a list,
  // not a ring.
  assert.equal(stepAnchor(many, 9, 1), 9);
  assert.equal(stepAnchor(many, 0, -1), 0);
  assert.equal(stepAnchor([], null, 1), null);
});

test("the window is empty for a card that is off screen and whole for a short one", () => {
  // A card 10,000px below the viewport.
  const below = rowWindow({
    count: 1000,
    rowHeight: 22,
    scrollTop: 0,
    top: 10_000,
    viewport: 800,
  });
  assert.equal(below.start, below.end);

  // An unmeasured viewport draws everything rather than nothing: a window
  // computed from a height nobody read is the mistake `diffListPlacement`
  // names.
  const unmeasured = rowWindow({
    count: 40,
    rowHeight: 22,
    scrollTop: 0,
    top: 0,
    viewport: 0,
  });
  assert.deepEqual(unmeasured, { end: 40, start: 0 });
});

test("the window covers the viewport with overscan on both sides", () => {
  const view = rowWindow({
    count: 1000,
    rowHeight: 22,
    scrollTop: 2200,
    top: 0,
    viewport: 440,
  });
  // Rows 100..120 are on screen; the window contains them with room around.
  assert.ok(view.start <= 100);
  assert.ok(view.end >= 120);
  assert.ok(view.start >= 0);
  assert.ok(view.end <= 1000);
});

test("the tally is the count on screen, said in words", () => {
  assert.equal(fileTally(1), "1 file");
  assert.equal(fileTally(3), "3 files");
  assert.equal(fileTally(0), "0 files");
});
