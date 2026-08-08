import assert from "node:assert/strict";
import { test } from "node:test";
import {
  began,
  COST_SHARE,
  ended,
  freshnessLabel,
  indexAfterRefresh,
  MAX_GAP_MS,
  MIN_GAP_MS,
  nextGapMs,
  shouldRead,
  UNREAD,
} from "./diffRefresh.ts";

const SEEN = { now: 0, onScreen: true, trigger: "tick" };

/** A pane that read `tookMs` worth of git and finished at `at`. */
function readOnce(tookMs, at) {
  return ended(began(UNREAD), { now: at, ok: true, tookMs });
}

// ---------------------------------------------------------------------------
// the interval
// ---------------------------------------------------------------------------

test("the gap is the last read's cost times the share it is allowed", () => {
  // 400ms of git buys 8s of quiet at a 1/20th share — between the floor and
  // the ceiling, so this is the rule itself and not a clamp.
  assert.equal(nextGapMs(400), 400 * COST_SHARE);
});

test("a cheap read still waits out the floor, and an expensive one stops at the ceiling", () => {
  // Measured: a one-file worktree reads in ~70ms. Twenty times that is 1.4s,
  // which is a poll nobody asked for.
  assert.equal(nextGapMs(70), MIN_GAP_MS);
  assert.equal(nextGapMs(1), MIN_GAP_MS);
  // Measured: 200 changed files cost ~2.5s. Fifty seconds of quiet would be
  // a pane that has stopped keeping up in all but name.
  assert.equal(nextGapMs(2524), MAX_GAP_MS);
});

test("a read that reported no time at all is treated as free, not as instant", () => {
  // Zero times anything is zero, and a zero gap is a read every pump tick.
  for (const nonsense of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(nextGapMs(nonsense), MIN_GAP_MS);
  }
});

test("the gap is measured from when the read ended, not from when it started", () => {
  // A 545ms read (forty changed files) that started at 0 ended at 545. Its
  // 10.9s gap runs from 545, so the next read is due at 11_445 — not at
  // 10_900, which is what a fixed-period interval would have scheduled.
  const state = ended(began(UNREAD), { now: 545, ok: true, tookMs: 545 });
  assert.equal(state.gapMs, 545 * COST_SHARE);
  assert.equal(
    shouldRead(state, { ...SEEN, now: 545 + state.gapMs - 1 }),
    false,
  );
  assert.equal(shouldRead(state, { ...SEEN, now: 545 + state.gapMs }), true);
});

// ---------------------------------------------------------------------------
// no overlap
// ---------------------------------------------------------------------------

test("nothing automatic starts while a read is in flight, however overdue", () => {
  const busy = began(readOnce(400, 1_000));
  for (const trigger of ["opened", "shown", "tick"]) {
    assert.equal(
      shouldRead(busy, { now: 9_000_000, onScreen: true, trigger }),
      false,
      trigger,
    );
  }
});

test("the owner's own press is the one thing a read in flight cannot block", () => {
  // A button that silently does nothing is worse than a superseded read; the
  // caller drops the stale answer.
  const busy = began(readOnce(400, 1_000));
  assert.equal(
    shouldRead(busy, { now: 1_001, onScreen: true, trigger: "asked" }),
    true,
  );
  // And it is not gated on being on screen either — the press proves it.
  assert.equal(
    shouldRead(UNREAD, { now: 0, onScreen: false, trigger: "asked" }),
    true,
  );
});

// ---------------------------------------------------------------------------
// visibility gating
// ---------------------------------------------------------------------------

test("a pane nobody can see does not spend git subprocesses", () => {
  for (const trigger of ["opened", "shown", "tick"]) {
    assert.equal(
      shouldRead(UNREAD, { now: 0, onScreen: false, trigger }),
      false,
      trigger,
    );
  }
});

test("coming back to the window obeys the same gap the pump does", () => {
  // Forty changed files: a 545ms read, so a 10.9s gap — far above the floor,
  // which is what makes an exemption for wake-ups measurable at all.
  const state = readOnce(545, 1_000);
  const wake = (now) =>
    shouldRead(state, { now, onScreen: true, trigger: "shown" });
  // A ⌘-tab out and straight back is not new information about the worktree.
  assert.equal(wake(1_500), false);
  // Nor is it after the floor. Letting a wake-up through on MIN_GAP_MS was
  // measured at 15% of a core when alternating with an editor every three
  // seconds, against a module built around 5% — and the exemption bought
  // nothing, because a real absence outlasts the gap on its own (below).
  assert.equal(wake(1_000 + MIN_GAP_MS), false);
  assert.equal(
    shouldRead(state, {
      now: 1_000 + MIN_GAP_MS,
      onScreen: true,
      trigger: "tick",
    }),
    false,
  );
  // Away long enough for the worktree to have moved: both read, at once.
  assert.equal(wake(1_000 + state.gapMs), true);
  assert.equal(
    shouldRead(state, {
      now: 1_000 + state.gapMs,
      onScreen: true,
      trigger: "tick",
    }),
    true,
  );
});

test("a pane that has never read reads the moment it is on screen", () => {
  for (const trigger of ["opened", "shown", "tick"]) {
    assert.equal(shouldRead(UNREAD, { now: 0, onScreen: true, trigger }), true);
  }
});

test("a clock that went backwards does not freeze the pane until it catches up", () => {
  // A laptop that slept, or an NTP step. `since` is negative, and a naive
  // comparison would refuse every read until wall-clock time passed the old
  // value again.
  const state = readOnce(400, 1_000_000);
  assert.equal(shouldRead(state, { ...SEEN, now: 5 }), true);
});

// ---------------------------------------------------------------------------
// what a read does to the state
// ---------------------------------------------------------------------------

test("a refusal moves the schedule on but does not make the screen any newer", () => {
  const good = ended(began(UNREAD), { now: 1_000, ok: true, tookMs: 200 });
  const bad = ended(began(good), { now: 2_000, ok: false, tookMs: 400 });
  assert.equal(bad.readAt, 1_000, "the answer on screen is still the old one");
  assert.equal(bad.attemptedAt, 2_000, "but the attempt is what schedules");
  assert.equal(
    bad.gapMs,
    400 * COST_SHARE,
    "and a slow refusal cost real time",
  );
  assert.equal(bad.reading, false);
});

// ---------------------------------------------------------------------------
// saying how stale it is
// ---------------------------------------------------------------------------

test("the label says when, in the unit the number deserves", () => {
  const at = 1_000_000;
  assert.equal(freshnessLabel(null, at), "not read yet");
  assert.equal(freshnessLabel(at, at), "read just now");
  assert.equal(freshnessLabel(at, at + 4_999), "read just now");
  assert.equal(freshnessLabel(at, at + 5_000), "read 5s ago");
  assert.equal(freshnessLabel(at, at + 59_000), "read 59s ago");
  assert.equal(freshnessLabel(at, at + 60_000), "read 1m ago");
  assert.equal(freshnessLabel(at, at + 59 * 60_000), "read 59m ago");
  assert.equal(freshnessLabel(at, at + 60 * 60_000), "read 1h ago");
});

test("a clock that moved backwards reads as fresh, never as negative", () => {
  assert.equal(freshnessLabel(1_000, 0), "read just now");
});

// ---------------------------------------------------------------------------
// the reader's place
// ---------------------------------------------------------------------------

test("the open file is followed by path when the list reorders under it", () => {
  const was = ["src/b.ts", "src/c.ts"];
  // The agent created src/a.ts; git sorts it first and everything shifts.
  const now = ["src/a.ts", "src/b.ts", "src/c.ts"];
  assert.equal(indexAfterRefresh(now, was[1], 1), 2);
  assert.equal(indexAfterRefresh(now, was[0], 0), 1);
});

test("a file that is gone leaves the cursor where it stood, not at the top", () => {
  const now = ["src/a.ts", "src/b.ts", "src/c.ts"];
  assert.equal(indexAfterRefresh(now, "src/reverted.ts", 2), 2);
  // Clamped when the list shrank past it — the last row, not row zero.
  assert.equal(indexAfterRefresh(["src/a.ts"], "src/reverted.ts", 7), 0);
  assert.equal(indexAfterRefresh(now, "src/reverted.ts", 99), 2);
});

test("an empty list is the one case that is row zero, and a null place is honest", () => {
  assert.equal(indexAfterRefresh([], "src/a.ts", 4), 0);
  assert.equal(indexAfterRefresh(["src/a.ts", "src/b.ts"], null, 1), 1);
  assert.equal(indexAfterRefresh(["src/a.ts", "src/b.ts"], null, -3), 0);
});
