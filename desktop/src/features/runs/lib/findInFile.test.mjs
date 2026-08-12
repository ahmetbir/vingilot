// The match model behind ⌘F
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 1).
//
// Everything the plan names as a rule is here: smart case, the count, the
// wrap-around, and the arithmetic that puts the amber on the right characters of
// a line whether that line was drawn as plain text or as Shiki's tokens. None of
// it needs a browser. What does — the chord arriving, the amber on screen, the
// walk scrolling — is `desktop/tests/e2e/workspace-find.spec.ts`.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  currentMatchIndex,
  findMatches,
  indexLines,
  matchLabel,
  segmentSpan,
  smartCaseSensitive,
  stepMatch,
} from "./findInFile.ts";

/** The matched substrings, which is what a reader can check by eye. */
function matched(text, query) {
  return findMatches(text, query).map((match) =>
    text.slice(match.start, match.end),
  );
}

test("smart case: insensitive until he types a capital", () => {
  assert.equal(smartCaseSensitive("todo"), false);
  assert.equal(smartCaseSensitive("toDo"), true);
  assert.equal(smartCaseSensitive("TODO"), true);
  // Not a letter at all is not a capital.
  assert.equal(smartCaseSensitive("todo("), false);
  assert.equal(smartCaseSensitive(""), false);
});

test("smart case reads the owner's own alphabet, not A-Z", () => {
  // **The reason the rule is `query !== query.toLowerCase()` and not `/[A-Z]/`.**
  // He types Turkish; `Ş`, `İ`, `Ğ` and `Ö` are capitals a Latin-A-to-Z test does
  // not see, and a `Şubat` that quietly matched `şubat` would be smart case
  // failing in exactly the alphabet he uses.
  assert.equal(smartCaseSensitive("Şubat"), true);
  assert.equal(smartCaseSensitive("şubat"), false);
  assert.equal(smartCaseSensitive("Ğ"), true);
});

test("a lower-case query matches either case", () => {
  assert.deepEqual(matched("Todo, toDo, TODO, todo", "todo"), [
    "Todo",
    "toDo",
    "TODO",
    "todo",
  ]);
});

test("one capital makes it exact", () => {
  assert.deepEqual(matched("Todo, toDo, TODO, todo", "TODO"), ["TODO"]);
  assert.deepEqual(matched("Todo, toDo, TODO, todo", "toDo"), ["toDo"]);
});

test("case folding never moves an offset", () => {
  // In JavaScript `"İ".toLowerCase()` is TWO code units. A model that folded the
  // haystack with `toLowerCase()` would shift every offset after such a
  // character by one, and every highlight past it would land one character to
  // the left — silently, and only in his language. So the fold is per code
  // point and skips any point whose lower case is a different length.
  const text = "İstanbul ve istanbul";
  const found = findMatches(text, "istanbul");
  assert.equal(found.length, 1);
  assert.equal(text.slice(found[0].start, found[0].end), "istanbul");
  // The stated cost of that choice, pinned rather than left as a surprise: the
  // capital dotted I is not folded, so it is not matched.
  assert.equal(found[0].start, text.indexOf("ve") + 3);
});

test("an empty query finds nothing, rather than everything", () => {
  assert.deepEqual(findMatches("anything at all", ""), []);
  assert.equal(matchLabel(0, 0), "no results");
});

test("matches do not overlap", () => {
  // `aa` in `aaaa` is two, not three. A set where Enter could land on a match
  // starting inside the one he is on is a walk that goes backwards to his eye.
  assert.deepEqual(findMatches("aaaa", "aa"), [
    { end: 2, start: 0 },
    { end: 4, start: 2 },
  ]);
});

test("the count is what the bar says, 1-based", () => {
  assert.equal(matchLabel(17, 2), "3/17");
  assert.equal(matchLabel(17, 0), "1/17");
  assert.equal(matchLabel(1, 0), "1/1");
  // A `current` left over from a longer match set is clamped rather than printed
  // — `18/17` is a bar contradicting itself.
  assert.equal(matchLabel(17, 99), "17/17");
  assert.equal(matchLabel(17, -3), "1/17");
});

test("the walk wraps at both ends", () => {
  // Wrap-around rather than stopping dead, because the gesture is "again".
  assert.equal(stepMatch(3, 0, 1), 1);
  assert.equal(stepMatch(3, 1, 1), 2);
  assert.equal(stepMatch(3, 2, 1), 0);
  assert.equal(stepMatch(3, 0, -1), 2);
  assert.equal(stepMatch(3, 2, -1), 1);
});

test("the walk is safe with nothing to walk", () => {
  assert.equal(stepMatch(0, 0, 1), 0);
  assert.equal(stepMatch(0, 5, -1), 0);
  assert.equal(currentMatchIndex(0, 0), -1);
  assert.equal(currentMatchIndex(4, 9), 3);
  assert.equal(currentMatchIndex(4, -1), 0);
});

test("the per-line index has one entry per line, matches filed on theirs", () => {
  const text = "alpha\nbeta\nalpha beta\n";
  const matches = findMatches(text, "beta");
  const lines = indexLines(text, matches);
  // Four lines: the trailing newline makes a fourth, empty one, and the
  // renderer draws it — so the index must have it too or the two would disagree
  // about what line 4 is.
  assert.equal(lines.length, 4);
  assert.deepEqual(
    lines.map((line) => line.start),
    [0, 6, 11, 22],
  );
  assert.deepEqual(
    lines.map((line) => line.matches.length),
    [0, 1, 1, 0],
  );
  // And the match on line 3 is the one at that line's own offset.
  assert.equal(lines[2].matches[0].start, text.indexOf("alpha beta") + 6);
});

test("a line knows where its matches sit in the WHOLE file's list", () => {
  // **The defect this pins, found by the browser spec and not by this file.**
  // A line only holds a slice of the file's matches, and `segmentSpan` numbers
  // them from that slice — so without `first` every line's own first match
  // compares equal to `current === 0`, and the current-match emphasis appears
  // once per LINE instead of once per file. On a file with a match on every line
  // that looks almost right, which is why it survived the first pass.
  const text = "foo\nbar foo\nfoo foo";
  const matches = findMatches(text, "foo");
  const lines = indexLines(text, matches);
  assert.equal(matches.length, 4);
  assert.deepEqual(
    lines.map((line) => line.first),
    [0, 1, 2],
  );
  // Read through `segmentSpan` the way the renderer reads it: the indices it
  // hands back are the file's, so exactly one segment in the whole file can be
  // the current one.
  const all = lines.flatMap((line, index) =>
    segmentSpan(
      text.split("\n")[index],
      line.start,
      line.matches,
      line.first,
    ).filter((segment) => segment.match !== null),
  );
  assert.deepEqual(
    all.map((segment) => segment.match),
    [0, 1, 2, 3],
  );
});

test("two matches on one line stay on that line, in order", () => {
  const text = "x\nfoo foo foo\ny";
  const lines = indexLines(text, findMatches(text, "foo"));
  assert.deepEqual(
    lines.map((line) => line.matches.length),
    [0, 3, 0],
  );
  const starts = lines[1].matches.map((match) => match.start - lines[1].start);
  assert.deepEqual(starts, [0, 4, 8]);
});

test("a whole line is cut into ground and matches, covering it exactly", () => {
  const text = "let foo = foo + 1";
  const matches = findMatches(text, "foo");
  const segments = segmentSpan(text, 0, matches);
  assert.deepEqual(segments, [
    { match: null, text: "let " },
    { match: 0, text: "foo" },
    { match: null, text: " = " },
    { match: 1, text: "foo" },
    { match: null, text: " + 1" },
  ]);
  // The invariant that matters: the pieces are the line, in order, with nothing
  // added and nothing dropped.
  assert.equal(segments.map((segment) => segment.text).join(""), text);
});

test("a match that straddles two spans is one match in two pieces", () => {
  // **The reason the find works over the text and not the spans.** Shiki gives
  // the viewer `greet` and `(name` as separate tokens; a query of `t(n` covers
  // the end of one and the start of the other. Both pieces have to come back
  // carrying the SAME match index, or the current match would be emphasised in
  // half of itself.
  const text = "greet(name)";
  const matches = findMatches(text, "t(n");
  const first = segmentSpan("greet", 0, matches);
  const second = segmentSpan("(name)", 5, matches);
  assert.deepEqual(first, [
    { match: null, text: "gree" },
    { match: 0, text: "t" },
  ]);
  assert.deepEqual(second, [
    { match: 0, text: "(n" },
    { match: null, text: "ame)" },
  ]);
  // Reassembled, it is the line — and the matched pieces are the query.
  assert.equal(
    [...first, ...second].map((segment) => segment.text).join(""),
    text,
  );
  assert.equal(
    [...first, ...second]
      .filter((segment) => segment.match === 0)
      .map((segment) => segment.text)
      .join(""),
    "t(n",
  );
});

test("a span wholly inside a match is all match", () => {
  // The middle token of a three-token match: no ground on either side.
  const text = "aXbXc";
  const matches = findMatches(text, "XbX");
  assert.deepEqual(segmentSpan("b", 2, matches), [{ match: 0, text: "b" }]);
});

test("a span with no matches on its line is one plain piece", () => {
  assert.deepEqual(segmentSpan("untouched", 0, []), [
    { match: null, text: "untouched" },
  ]);
  // An empty span is no pieces at all — the renderer draws a space for an empty
  // line and must not be handed an empty `<mark>`.
  assert.deepEqual(segmentSpan("", 0, []), []);
  assert.deepEqual(segmentSpan("", 4, [{ end: 6, start: 3 }]), []);
});

test("a match on another line paints nothing on this one", () => {
  const text = "foo\nbar";
  const matches = findMatches(text, "foo");
  // The second line, at offset 4, with the first line's match handed to it.
  assert.deepEqual(segmentSpan("bar", 4, matches), [
    { match: null, text: "bar" },
  ]);
});
