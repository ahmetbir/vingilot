// The dot's derivation, state by state
// (vingilot/docs/plans/2026-08-09-signals-and-dashboards.md, Task 1).
//
// The rule this file exists to hold is the negative one: **a signal that has
// not answered produces no dot.** Everything else here is a state proving it
// can be reached from a real input; that one is a state proving it cannot be
// reached from an absent one.

import assert from "node:assert/strict";
import { test } from "node:test";
import { attentionMark, outranks, rollupMark } from "./attentionSignal.ts";
import { runAttention } from "./runModel.ts";

const EVERY_STATUS = [
  "draft",
  "provisioning",
  "ready",
  "running",
  "verifying",
  "paused",
  "blocked",
  "completed",
  "failed",
  "cancelled",
];

function stat(overrides = {}) {
  return {
    additions: 0,
    changedFiles: 0,
    deletions: 0,
    dirty: false,
    path: "/w/one",
    unreadable: false,
    untracked: 0,
    ...overrides,
  };
}

/** No signal at all: no run, no git answer, no turn in flight. */
function silence(overrides = {}) {
  return { askInFlight: false, runStatus: null, stat: null, ...overrides };
}

test("no signal has answered, so no dot is drawn", () => {
  assert.deepEqual(attentionMark(silence()), { sentence: "", state: null });
});

test("an unreadable worktree is not a quiet one", () => {
  // `usableStat` hands `null` on for an unreadable path, so the row that git
  // could not read arrives here the same way one it has not reached yet does —
  // and gets the same nothing.
  assert.equal(attentionMark(silence({ stat: null })).state, null);
});

test("paused and blocked runs need him, and the sentence names the status", () => {
  for (const status of ["paused", "blocked"]) {
    const mark = attentionMark(silence({ runStatus: status }));
    assert.equal(mark.state, "needs-you");
    assert.match(mark.sentence, /coordinator/);
    assert.match(mark.sentence, new RegExp(status));
  }
});

test("a live run is working, whichever live status it is in", () => {
  for (const status of ["provisioning", "ready", "running", "verifying"]) {
    const mark = attentionMark(silence({ runStatus: status }));
    assert.equal(mark.state, "working", status);
    assert.match(mark.sentence, new RegExp(status));
  }
});

test("this app's own in-flight turn is working, and says so", () => {
  const mark = attentionMark(silence({ askInFlight: true }));
  assert.equal(mark.state, "working");
  assert.match(mark.sentence, /agent turn/);
});

test("a draft run is not working — nothing was ever dispatched", () => {
  assert.equal(attentionMark(silence({ runStatus: "draft" })).state, null);
  assert.equal(
    attentionMark(silence({ runStatus: "draft", stat: stat() })).state,
    "quiet",
  );
});

test("a finished run leaves git as the only witness", () => {
  for (const status of ["completed", "failed", "cancelled"]) {
    assert.equal(
      attentionMark(silence({ runStatus: status, stat: stat({ dirty: true }) }))
        .state,
      "dirty",
      status,
    );
    assert.equal(attentionMark(silence({ runStatus: status })).state, null);
  }
});

test("git's dirty flag is what dirty means", () => {
  const mark = attentionMark(silence({ stat: stat({ dirty: true }) }));
  assert.equal(mark.state, "dirty");
  assert.match(mark.sentence, /git/);
});

test("clean plus no run is quiet, which is a real answer", () => {
  const mark = attentionMark(silence({ stat: stat() }));
  assert.equal(mark.state, "quiet");
  assert.match(mark.sentence, /clean/);
});

test("every run status produces a mark, and never an unexplained dot", () => {
  for (const status of EVERY_STATUS) {
    for (const s of [null, stat(), stat({ dirty: true })]) {
      for (const askInFlight of [false, true]) {
        const mark = attentionMark({ askInFlight, runStatus: status, stat: s });
        // The tooltip and the dot are produced together or not at all: a state
        // with no sentence is a dot that cannot say where it came from.
        assert.equal(
          mark.state === null,
          mark.sentence === "",
          `${status}/${s === null ? "no-stat" : s.dirty}/${askInFlight}`,
        );
      }
    }
  }
});

test("precedence: needs-you, then working, then dirty, then quiet", () => {
  const order = ["needs-you", "working", "dirty", "quiet"];
  for (let i = 0; i < order.length; i += 1) {
    for (let j = 0; j < order.length; j += 1) {
      assert.equal(
        outranks(order[i], order[j]),
        i < j,
        `${order[i]} vs ${order[j]}`,
      );
    }
  }
});

test("a run outranks the git state of the same worktree", () => {
  const dirty = stat({ dirty: true });
  assert.equal(
    attentionMark({ askInFlight: false, runStatus: "blocked", stat: dirty })
      .state,
    "needs-you",
  );
  assert.equal(
    attentionMark({ askInFlight: false, runStatus: "running", stat: dirty })
      .state,
    "working",
  );
  assert.equal(
    attentionMark({ askInFlight: true, runStatus: null, stat: dirty }).state,
    "working",
  );
});

test("a waiting run outranks a live one on the same project", () => {
  const rollup = rollupMark([
    attentionMark(silence({ runStatus: "running" })),
    attentionMark(silence({ runStatus: "paused" })),
    attentionMark(silence({ stat: stat({ dirty: true }) })),
  ]);
  assert.equal(rollup.state, "needs-you");
  assert.match(rollup.sentence, /1 worktree needs? you/);
});

test("the rollup counts only the worktrees in the state it reports", () => {
  const rollup = rollupMark([
    attentionMark(silence({ runStatus: "paused" })),
    attentionMark(silence({ runStatus: "blocked" })),
    attentionMark(silence({ runStatus: "running" })),
  ]);
  assert.equal(rollup.state, "needs-you");
  assert.match(rollup.sentence, /2 worktrees need you/);
});

test("a project nothing has answered about gets no dot either", () => {
  assert.deepEqual(rollupMark([]), { sentence: "", state: null });
  assert.deepEqual(
    rollupMark([attentionMark(silence()), attentionMark(silence())]),
    {
      sentence: "",
      state: null,
    },
  );
});

test("a project whose worktrees are all clean says so", () => {
  const rollup = rollupMark([
    attentionMark(silence({ stat: stat() })),
    attentionMark(silence({ stat: stat() })),
  ]);
  assert.equal(rollup.state, "quiet");
  assert.match(rollup.sentence, /nothing needs you/);
});

test("one silent worktree does not drag its project's dot down", () => {
  // The closed-project case: the coordinator has answered about one worktree
  // and git has been asked about none of them. The project still reports what
  // it actually knows.
  const rollup = rollupMark([
    attentionMark(silence({ runStatus: "blocked" })),
    attentionMark(silence()),
  ]);
  assert.equal(rollup.state, "needs-you");
});

test("the dot's mapping is the run rail's mapping, not a second copy", () => {
  // `runAttention` is the single definition of what a status says about the
  // owner's attention (`runModel.ts`); if the dot ever grew its own table this
  // would keep passing while the two drifted, so the assertion is that the dot
  // agrees with it for every status.
  for (const status of EVERY_STATUS) {
    const expected = {
      active: "working",
      idle: null,
      waiting: "needs-you",
    }[runAttention(status)];
    assert.equal(
      attentionMark(silence({ runStatus: status })).state,
      expected,
      status,
    );
  }
});
