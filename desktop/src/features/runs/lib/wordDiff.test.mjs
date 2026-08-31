import assert from "node:assert/strict";
import { test } from "node:test";
import { changedRanges, tokenize, wordDiff } from "./wordDiff.ts";

/** The changed text of one side, joined — what a reader would see highlighted. */
function marked(segments) {
  return segments
    .filter((segment) => segment.changed)
    .map((segment) => segment.text)
    .join("|");
}

test("identifiers are one token, so a rename highlights as a word", () => {
  // Character granularity is what makes `diff-match-patch` the wrong tool
  // here: it would mark `read`+`F`+`ile` inside one identifier.
  assert.deepEqual(tokenize("let cart = try makeCart(3)"), [
    "let",
    " ",
    "cart",
    " ",
    "=",
    " ",
    "try",
    " ",
    "makeCart",
    "(",
    "3",
    ")",
  ]);
});

test("only the tokens that really changed are marked", () => {
  const found = wordDiff(
    "  let receipt = checkout.complete(cart)",
    "  let receipt = try await checkout.complete(cart)",
  );
  assert.notEqual(found, null);
  // The removed side gained nothing, so nothing on it is marked; the added
  // side is marked exactly on what arrived.
  assert.equal(marked(found.before), "");
  assert.equal(marked(found.after), "try await ");
});

test("both sides are marked when a token is replaced", () => {
  const found = wordDiff("Thread.sleep(0.3)", "Thread.sleep(0.5)");
  assert.notEqual(found, null);
  // `0.3` is three tokens — `0`, `.`, `3` — because `.` is punctuation, so the
  // shared `0.` stays out of the highlight and only the digit that changed is
  // in it. That is the granularity this differ exists for.
  assert.equal(marked(found.before), "3");
  assert.equal(marked(found.after), "5");
});

test("a line rewritten end to end is left alone", () => {
  // The row's own tint says "this changed"; confetti over every token says
  // nothing more and costs legibility.
  assert.equal(wordDiff("alpha beta gamma", "delta epsilon zeta"), null);
});

test("identical and empty pairs answer null rather than an empty markup", () => {
  assert.equal(wordDiff("same", "same"), null);
  assert.equal(wordDiff("", "something"), null);
  assert.equal(wordDiff("something", ""), null);
});

test("a pair past the token ceiling is not compared at all", () => {
  // A minified bundle's "line". The O(n·m) table is the reason for the
  // ceiling, and the fallback is the drawing the row already had.
  const long = "a b ".repeat(400);
  assert.equal(wordDiff(long, `${long}x`), null);
});

test("changedRanges are the character offsets a renderer can split on", () => {
  const found = wordDiff("call(a)", "call(b)");
  assert.notEqual(found, null);
  assert.deepEqual(changedRanges(found.after), [{ end: 6, start: 5 }]);
  // And the ranges really index the string they came from.
  assert.equal("call(b)".slice(5, 6), "b");
});

test("a common prefix and suffix are never inside the markup", () => {
  const found = wordDiff(
    "export function readFile(path) {",
    "export function readFile(path, line) {",
  );
  assert.notEqual(found, null);
  const first = found.after[0];
  assert.equal(first.changed, false);
  assert.ok(first.text.startsWith("export function readFile(path"));
  assert.equal(marked(found.after), ", line");
});
