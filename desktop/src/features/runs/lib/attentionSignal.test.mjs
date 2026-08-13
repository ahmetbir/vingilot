// The dot's derivation, state by state
// (vingilot/docs/plans/2026-08-09-signals-and-dashboards.md, Task 1).
//
// The rule this file exists to hold is the negative one: **a signal that has
// not answered produces no dot.** Everything else here is a state proving it
// can be reached from a real input; that one is a state proving it cannot be
// reached from an absent one.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attentionMark,
  endedNote,
  outranks,
  rollupMark,
} from "./attentionSignal.ts";
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

/** No signal at all: no run, no git answer, no turn in flight, no live agent
 * in the terminal. */
function silence(overrides = {}) {
  return {
    agent: null,
    askInFlight: false,
    runStatus: null,
    stat: null,
    ...overrides,
  };
}

/** One live agent, as `hook_liveness` reports it. */
function agent(overrides = {}) {
  return {
    path: null,
    sentence: "working",
    sessions: 1,
    state: "working",
    tool: null,
    ...overrides,
  };
}

/** What "no dot" is, whole — asserted as a shape rather than a state so a mark
 * that grew a field would have to say what that field is when nothing has
 * answered. */
const NO_DOT = { ended: null, sentence: "", state: null };

test("no signal has answered, so no dot is drawn", () => {
  assert.deepEqual(attentionMark(silence()), NO_DOT);
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

test("a clean tree under a run that failed does not claim no run is active", () => {
  // The dot is quiet either way — the tree is what it reports, and the run
  // ending did not change the tree — but the sentence is the only place the
  // ending survives now that the column's destructive status dot is gone.
  for (const status of ["failed", "cancelled"]) {
    const mark = attentionMark(silence({ runStatus: status, stat: stat() }));
    assert.equal(mark.state, "quiet", status);
    assert.match(mark.sentence, new RegExp(status));
  }
  // A run that finished is not one of them: nothing happened worth naming.
  assert.match(
    attentionMark(silence({ runStatus: "completed", stat: stat() })).sentence,
    /no run is active/,
  );
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
        const mark = attentionMark({
          agent: null,
          askInFlight,
          runStatus: status,
          stat: s,
        });
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

test("an agent stopped at a permission prompt needs him, in its own words", () => {
  // The sentence names its source — "an agent in this worktree's terminal" —
  // because the whole argument for a dot is that it can be believed without
  // being checked, and this one is the first that is not about a run or a
  // tree. The tool comes from the record beside the sentence, never from
  // splitting the harness's own string.
  const mark = attentionMark(
    silence({
      agent: agent({
        sentence: "waiting for approval: Bash",
        state: "asking",
        tool: "Bash",
      }),
      stat: stat(),
    }),
  );
  assert.equal(mark.state, "needs-you");
  assert.equal(
    mark.sentence,
    "needs you — an agent in this worktree's terminal is waiting for approval: Bash",
  );
  assert.equal(mark.ended, null);
});

test("an agent mid-turn is working, and names the tool it is running", () => {
  const mark = attentionMark(
    silence({ agent: agent({ sentence: "working — Edit", tool: "Edit" }) }),
  );
  assert.equal(mark.state, "working");
  assert.equal(
    mark.sentence,
    "working — an agent in this worktree's terminal is working: Edit",
  );
  // And with no tool running, no colon and no invented noun.
  assert.equal(
    attentionMark(silence({ agent: agent() })).sentence,
    "working — an agent in this worktree's terminal is working",
  );
});

test("several agents in one worktree are counted and lose the tool", () => {
  // The rollup the backend already does, kept true in the dot's grammar: one
  // session's `Bash` reported over two is a claim about the other that nothing
  // made.
  const mark = attentionMark(
    silence({
      agent: agent({
        sentence: "2 sessions working",
        sessions: 2,
        tool: "Bash",
      }),
    }),
  );
  assert.equal(
    mark.sentence,
    "working — 2 agents in this worktree's terminals are working",
  );
});

test("an agent sitting at its prompt draws nothing at all", () => {
  // `waiting` is a live session that needs nothing and is doing nothing. It
  // must not outrank the row's real answer, and it must not invent one where
  // git has none.
  assert.equal(
    attentionMark(
      silence({ agent: agent({ sentence: "waiting", state: "waiting" }) }),
    ).state,
    null,
  );
  assert.equal(
    attentionMark(
      silence({
        agent: agent({ sentence: "waiting", state: "waiting" }),
        stat: stat(),
      }),
    ).state,
    "quiet",
  );
});

test("no live agent is silence, and silence changes no other state", () => {
  // The negative rule, at this signal: a worktree with no session reads
  // exactly as it did before this signal existed — for every combination of
  // the other three.
  for (const runStatus of [null, "running", "paused", "failed"]) {
    for (const s of [null, stat(), stat({ dirty: true })]) {
      for (const askInFlight of [false, true]) {
        const without = attentionMark({
          agent: null,
          askInFlight,
          runStatus,
          stat: s,
        });
        assert.deepEqual(
          attentionMark({
            agent: agent({ sentence: "waiting", state: "waiting" }),
            askInFlight,
            runStatus,
            stat: s,
          }),
          without,
          `${runStatus}/${s === null ? "no-stat" : s.dirty}/${askInFlight}`,
        );
      }
    }
  }
});

test("the run and the tree still outrank what the terminal says", () => {
  // The precedence the plan fixed: the claims this app has been making for
  // weeks keep their meaning, and terminal liveness fills the silence under
  // them. An `asking` agent is the strongest thing this signal can say, so it
  // is what each of these is asserted against.
  const asking = agent({ sentence: "waiting for approval", state: "asking" });
  for (const [runStatus, expected] of [
    ["running", "working"],
    ["paused", "needs-you"],
  ]) {
    const mark = attentionMark(silence({ agent: asking, runStatus }));
    assert.equal(mark.state, expected, runStatus);
    assert.match(mark.sentence, /coordinator/, runStatus);
  }
  const dirty = attentionMark(
    silence({ agent: asking, stat: stat({ dirty: true }) }),
  );
  assert.equal(dirty.state, "dirty");
  assert.match(dirty.sentence, /git's own count/);

  const ask = attentionMark(silence({ agent: asking, askInFlight: true }));
  assert.equal(ask.state, "working");
  assert.match(ask.sentence, /this app has an agent turn/);
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
    attentionMark({
      agent: null,
      askInFlight: false,
      runStatus: "blocked",
      stat: dirty,
    }).state,
    "needs-you",
  );
  assert.equal(
    attentionMark({
      agent: null,
      askInFlight: false,
      runStatus: "running",
      stat: dirty,
    }).state,
    "working",
  );
  assert.equal(
    attentionMark({
      agent: null,
      askInFlight: true,
      runStatus: null,
      stat: dirty,
    }).state,
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
  assert.deepEqual(rollupMark([]), NO_DOT);
  assert.deepEqual(
    rollupMark([attentionMark(silence()), attentionMark(silence())]),
    NO_DOT,
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

test("a project of clean trees whose run failed does not say nothing needs him", () => {
  // The row-level sentence names the ending (`a clean tree under a run that
  // failed does not claim no run is active`); the rollup one level up is read
  // from further away — the project's dot in the nav, and the headline over the
  // whole Deck board — and was saying "nothing needs you" over exactly that.
  for (const status of ["failed", "cancelled"]) {
    const rollup = rollupMark([
      attentionMark(silence({ runStatus: status, stat: stat() })),
      attentionMark(silence({ stat: stat() })),
    ]);
    assert.equal(rollup.state, "quiet", status);
    assert.doesNotMatch(rollup.sentence, /nothing needs you/, status);
    assert.match(rollup.sentence, /clean/, status);
    assert.match(rollup.sentence, new RegExp(`1 run here ${status}`), status);
  }
  // A run that finished is not one of them, and the quiet answer survives it.
  assert.match(
    rollupMark([
      attentionMark(silence({ runStatus: "completed", stat: stat() })),
      attentionMark(silence({ stat: stat() })),
    ]).sentence,
    /^nothing needs you/,
  );
});

test("the rollup counts the runs that stopped, and names them only when they agree", () => {
  const same = rollupMark([
    attentionMark(silence({ runStatus: "failed", stat: stat() })),
    attentionMark(silence({ runStatus: "failed", stat: stat() })),
  ]);
  assert.match(same.sentence, /2 runs here failed/);
  const mixed = rollupMark([
    attentionMark(silence({ runStatus: "failed", stat: stat() })),
    attentionMark(silence({ runStatus: "cancelled", stat: stat() })),
  ]);
  assert.match(mixed.sentence, /2 runs here stopped without finishing/);
});

test("a dirty worktree carries no ending, so nothing summing it up can name one", () => {
  // The other half of the row-level rule: dirty outranked the run's status on
  // the old status dot too, so the row says nothing about how its run ended
  // and neither may anything summing that row up. Asserted on the mark and on
  // `endedNote` rather than on a rollup sentence, because dirty outranks quiet
  // — a set holding a dirty mark never reaches the sentence the note goes in,
  // so a rollup assertion here would pass whatever the mark carried.
  const dirty = attentionMark(
    silence({ runStatus: "failed", stat: stat({ dirty: true }) }),
  );
  assert.equal(dirty.state, "dirty");
  assert.equal(dirty.ended, null);
  assert.equal(endedNote([dirty]), "");
  // And the quiet mark beside it is where the ending does live.
  const quiet = attentionMark(silence({ runStatus: "failed", stat: stat() }));
  assert.equal(quiet.ended, "failed");
  assert.equal(endedNote([dirty, quiet]), ", but 1 run here failed");
});

test("the rollup's verbs agree with its count, at one and at many", () => {
  // This sentence is a headline over a board as well as a tooltip, and "1
  // worktree need you" is read as a typo by everyone who reads it.
  const one = (signals) =>
    rollupMark([attentionMark(silence(signals))]).sentence;
  const two = (signals) =>
    rollupMark([
      attentionMark(silence(signals)),
      attentionMark(silence(signals)),
    ]).sentence;
  assert.match(
    one({ runStatus: "blocked" }),
    /^1 worktree needs you — .* its run is paused or blocked$/,
  );
  assert.match(
    two({ runStatus: "blocked" }),
    /^2 worktrees need you — .* their runs are paused or blocked$/,
  );
  assert.match(one({ runStatus: "running" }), /^1 worktree is working/);
  assert.match(two({ runStatus: "running" }), /^2 worktrees are working/);
  assert.match(one({ stat: stat({ dirty: true }) }), /^1 worktree is dirty/);
  assert.match(two({ stat: stat({ dirty: true }) }), /^2 worktrees are dirty/);
});

test("a project with one unanswered worktree does not claim they are all clean", () => {
  // git could not read one tree (`vingilot_worktree/stat.rs`'s `unreadable`),
  // or was never asked about it, and every tree it did read came back clean.
  // "every worktree here is clean" is then a claim about a subset, and the
  // unread one is exactly where uncommitted work would be invisible.
  assert.deepEqual(
    rollupMark([
      attentionMark(silence()),
      attentionMark(silence({ stat: stat() })),
    ]),
    NO_DOT,
  );
});

test("a silent worktree does not take the loud states off a project", () => {
  // The other half of the rule: needs-you, working and dirty each say that
  // *some* worktree is in that state, which stays true whatever the silent one
  // turns out to be. Only the quiet sentence speaks for all of them.
  for (const [signals, expected] of [
    [{ runStatus: "blocked" }, "needs-you"],
    [{ runStatus: "running" }, "working"],
    [{ stat: stat({ dirty: true }) }, "dirty"],
  ]) {
    assert.equal(
      rollupMark([attentionMark(silence(signals)), attentionMark(silence())])
        .state,
      expected,
    );
  }
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
