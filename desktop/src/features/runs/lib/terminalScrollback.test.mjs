import assert from "node:assert/strict";
import { test } from "node:test";
import {
  copyModeNotice,
  linesBehind,
  scrollbackNotice,
} from "./terminalScrollback.ts";

test("a terminal showing the newest output is behind by nothing", () => {
  assert.equal(linesBehind(0, 0), 0);
  assert.equal(linesBehind(4000, 4000), 0);
});

test("the distance scrolled back is the gap between the newest screen and the drawn one", () => {
  assert.equal(linesBehind(100, 88), 12);
  assert.equal(linesBehind(4000, 0), 4000);
});

test("a negative reading is not a scroll-up", () => {
  // xterm reports both figures while a buffer is being rebuilt — an alt-screen
  // switch, a reflow — and a transient negative there would put a "jump to
  // bottom" over a terminal that is already at the bottom.
  assert.equal(linesBehind(10, 40), 0);
});

test("a reading nobody can count lines with answers nothing", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(linesBehind(bad, 0), 0);
    assert.equal(linesBehind(100, bad), 0);
  }
});

test("a terminal at the bottom is offered no control at all", () => {
  // Not a disabled button: the ordinary state of a terminal is "showing the
  // newest output", and chrome that is present for it charges rent on every
  // terminal for the case that is not happening.
  assert.equal(scrollbackNotice(0), null);
  assert.equal(scrollbackNotice(-3), null);
  assert.equal(scrollbackNotice(Number.NaN), null);
});

test("the notice carries the count as a number, not only inside a sentence", () => {
  // What the DOM writes out, so a spec can assert the distance without
  // matching prose that is allowed to be reworded.
  const notice = scrollbackNotice(37);
  assert.ok(notice);
  assert.equal(notice.behind, 37);
  assert.match(notice.label, /37/);
});

test("one line is one line", () => {
  const one = scrollbackNotice(1);
  assert.ok(one);
  assert.match(one.label, /\b1 line\b/);
  assert.doesNotMatch(one.label, /lines/);
  const many = scrollbackNotice(2);
  assert.ok(many);
  assert.match(many.label, /\b2 lines\b/);
});

test("the detail says what clicking it does, the label only says where you are", () => {
  // The label sits over the owner's own output, so it is a reading. The detail
  // is the accessible name and the tooltip, where there is room for the act.
  const notice = scrollbackNotice(9);
  assert.ok(notice);
  assert.match(notice.detail, /jump to the newest output/i);
  assert.doesNotMatch(notice.label, /jump/i);
});

test("copy-mode gets the affordance the count-based notice cannot give it", () => {
  // Under tmux `linesBehind` is 0 by design, so the counted notice never
  // appears there. The copy-mode notice is the same control with a different
  // sentence: no count (tmux owns that number), a label that says what
  // clicking does bring back, and a detail naming why typed keys go nowhere.
  const notice = copyModeNotice(true);
  assert.ok(notice);
  assert.equal(notice.behind, 0);
  assert.match(notice.label, /back to live/i);
  assert.match(notice.detail, /copy-mode/i);
});

test("a pane on the live screen earns no copy-mode notice", () => {
  assert.equal(copyModeNotice(false), null);
});
