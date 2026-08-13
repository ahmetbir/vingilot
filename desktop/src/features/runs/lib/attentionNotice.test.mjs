// The two edges the workspace speaks on, and the rule that keeps it quiet
// (vingilot/docs/plans/2026-08-09-signals-and-dashboards.md, Task 2).
//
// The rules this file exists to hold are the negative ones: **a worktree that
// was already waiting is not news**, **a first reading is not a transition**,
// and **the surface he is standing in never announces itself**. The positive
// cases are here to prove those three can be reached past.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answeredNotice,
  needsYouNotices,
  suppressed,
} from "./attentionNotice.ts";

/** A mark as `attentionSignal.ts` produces one. */
function mark(state, sentence = `${state} — because a signal said so`) {
  return { sentence, state };
}

function marks(entries) {
  return new Map(Object.entries(entries));
}

/** The name a surface would give a worktree. */
const where = (id) => `buzz · ${id}`;

test("a worktree that turns needs-you is announced, in the mark's own words", () => {
  const notices = needsYouNotices(
    marks({ one: mark("working") }),
    marks({
      one: mark("needs-you", "needs you — the coordinator says blocked"),
    }),
    where,
  );
  assert.deepEqual(notices, [
    {
      body: "needs you — the coordinator says blocked",
      title: "buzz · one",
      worktreeId: "one",
    },
  ]);
});

test("an agent that stops for approval reaches him through this same path", () => {
  // The hook plan's third surface, and the whole of what it needed from this
  // module: nothing. A `claude` in a worktree's terminal going working→asking
  // makes `attentionMark` go working→needs-you, which is a transition this
  // function already fires on — with the dot's own sentence, so the
  // notification and the tooltip cannot come to describe it differently.
  //
  // Asserted here rather than only in a spec because a later "simplification"
  // that narrowed this to marks whose sentence mentions the coordinator would
  // pass every other test in this file and silently drop the one interruption
  // the owner is actually blocked on.
  const notices = needsYouNotices(
    marks({
      one: mark(
        "working",
        "working — an agent in this worktree's terminal is working: Bash",
      ),
    }),
    marks({
      one: mark(
        "needs-you",
        "needs you — an agent in this worktree's terminal is waiting for approval: Bash",
      ),
    }),
    where,
  );
  assert.deepEqual(notices, [
    {
      body: "needs you — an agent in this worktree's terminal is waiting for approval: Bash",
      title: "buzz · one",
      worktreeId: "one",
    },
  ]);
});

test("a worktree that was already waiting is not news", () => {
  const notices = needsYouNotices(
    marks({ one: mark("needs-you") }),
    marks({ one: mark("needs-you") }),
    where,
  );
  assert.deepEqual(notices, []);
});

test("the first reading of a worktree never fires, however loud it is", () => {
  const notices = needsYouNotices(
    new Map(),
    marks({ one: mark("needs-you"), two: mark("needs-you") }),
    where,
  );
  assert.deepEqual(notices, []);
});

test("a worktree nothing had answered about yet still fires when a run blocks", () => {
  // `state: null` is a reading — git said nothing and no run owned it. The
  // coordinator answering later is a transition this app watched happen.
  const notices = needsYouNotices(
    marks({ one: { sentence: "", state: null } }),
    marks({ one: mark("needs-you") }),
    where,
  );
  assert.deepEqual(
    notices.map((notice) => notice.worktreeId),
    ["one"],
  );
});

test("every other state is silent, including leaving needs-you", () => {
  for (const state of ["working", "dirty", "quiet"]) {
    assert.deepEqual(
      needsYouNotices(
        marks({ one: mark("needs-you") }),
        marks({ one: mark(state) }),
        where,
      ),
      [],
      `leaving needs-you for ${state} spoke`,
    );
    assert.deepEqual(
      needsYouNotices(
        marks({ one: mark("quiet") }),
        marks({ one: mark(state) }),
        where,
      ),
      [],
      `entering ${state} spoke`,
    );
  }
});

test("a worktree this app cannot name is not announced", () => {
  const notices = needsYouNotices(
    marks({ gone: mark("working") }),
    marks({ gone: mark("needs-you") }),
    () => null,
  );
  assert.deepEqual(notices, []);
});

test("two worktrees turning at once are two notices", () => {
  const notices = needsYouNotices(
    marks({ one: mark("working"), two: mark("dirty") }),
    marks({ one: mark("needs-you"), two: mark("needs-you") }),
    where,
  );
  assert.deepEqual(
    notices.map((notice) => notice.worktreeId),
    ["one", "two"],
  );
});

test("the settled turn names its worktree, or says nothing", () => {
  assert.deepEqual(answeredNotice("one", where("one")), {
    body: "the agent turn started here has ended — the Agent pane has what came back",
    title: "buzz · one",
    worktreeId: "one",
  });
  assert.equal(answeredNotice("one", null), null);
});

test("the surface he is standing in never announces itself", () => {
  const notice = { body: "needs you", title: "buzz · one", worktreeId: "one" };
  assert.equal(suppressed(notice, { focused: true, worktreeId: "one" }), true);
});

test("a sibling worktree still speaks, focused or not", () => {
  const notice = { body: "needs you", title: "buzz · one", worktreeId: "one" };
  assert.equal(suppressed(notice, { focused: true, worktreeId: "two" }), false);
  assert.equal(
    suppressed(notice, { focused: false, worktreeId: "two" }),
    false,
  );
});

test("the same worktree behind an unfocused window is not being looked at", () => {
  const notice = { body: "needs you", title: "buzz · one", worktreeId: "one" };
  assert.equal(
    suppressed(notice, { focused: false, worktreeId: "one" }),
    false,
  );
});

test("the landing view is not a worktree, so nothing is suppressed there", () => {
  const notice = { body: "needs you", title: "buzz · one", worktreeId: "one" };
  assert.equal(suppressed(notice, { focused: true, worktreeId: null }), false);
});
