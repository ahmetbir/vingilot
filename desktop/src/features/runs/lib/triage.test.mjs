// The triage board's model — ordering, the one date a row may carry, and the
// four sentences it answers an empty or quiet board with
// (vingilot/docs/plans/2026-08-09-signals-and-dashboards.md, Task 3).
//
// Two rules here are negative and they are the ones worth the file: a row
// nothing has answered about sinks below a quiet one rather than rising above
// it, and a worktree no run owns carries no date rather than borrowing one.

import assert from "node:assert/strict";
import { test } from "node:test";
import { attentionMark } from "./attentionSignal.ts";
import { ageLabel, triageBoard, triageModel } from "./triage.ts";

const REPOS = [
  { id: "alpha", name: "alpha", path: "/repos/alpha" },
  { id: "beta", name: "beta", path: "/repos/beta" },
];

function worktree(overrides = {}) {
  return {
    added: null,
    base_commit: "",
    binding_id: "wt-1",
    branch: "feature",
    commit_sha: null,
    lifecycle: "ready",
    owner_run_id: null,
    owner_run_objective: null,
    owner_run_status: null,
    removed: null,
    repo_id: "alpha",
    role: "task",
    ...overrides,
  };
}

function stat(overrides = {}) {
  return {
    additions: 0,
    changedFiles: 0,
    deletions: 0,
    dirty: false,
    path: "/w",
    unreadable: false,
    untracked: 0,
    ...overrides,
  };
}

/** A model over one project, with the marks derived exactly the way the screen
 * derives them — `attentionMark` itself, never a hand-written mark, so a test
 * cannot assert an ordering over states the dot can no longer produce. */
function model({ worktrees, stats = {}, runs = [], repos = [REPOS[0]] }) {
  const byRepo = {};
  for (const repo of repos) byRepo[repo.id] = [];
  for (const wt of worktrees) byRepo[wt.repo_id].push(wt);
  const marks = new Map();
  for (const wt of worktrees) {
    const raw = stats[wt.binding_id];
    marks.set(
      wt.binding_id,
      attentionMark({
        askInFlight: false,
        runStatus: wt.owner_run_status,
        stat: raw === undefined || raw.unreadable ? null : raw,
      }),
    );
  }
  return triageModel({
    grouped: { byRepo, unknown: [] },
    marks,
    repos,
    runs,
    stats,
  });
}

function ids(view) {
  return view.rows.map((row) => row.worktreeId);
}

test("the board orders needs-you, working, dirty, quiet", () => {
  const view = triageBoard(
    model({
      stats: {
        clean: stat(),
        dirty: stat({ additions: 4, changedFiles: 1, dirty: true }),
      },
      worktrees: [
        worktree({ binding_id: "clean" }),
        worktree({ binding_id: "dirty" }),
        worktree({ binding_id: "working", owner_run_status: "running" }),
        worktree({ binding_id: "needs", owner_run_status: "blocked" }),
      ],
    }),
    null,
  );
  assert.deepEqual(ids(view), ["needs", "working", "dirty", "clean"]);
});

test("a worktree nothing has answered about sinks below a quiet one", () => {
  // The whole argument for the rank: stat answers land asynchronously, so a
  // silent row ranked above a clean one would jump to the top of the board and
  // drop back on the next 5s tick, moving for a reason nothing on screen says.
  const view = triageBoard(
    model({
      stats: { clean: stat() },
      worktrees: [
        worktree({ binding_id: "silent" }),
        worktree({ binding_id: "clean" }),
      ],
    }),
    null,
  );
  assert.deepEqual(ids(view), ["clean", "silent"]);
});

test("within one state the incoming order is kept", () => {
  const view = triageBoard(
    model({
      stats: {
        a: stat({ dirty: true }),
        b: stat({ dirty: true }),
        c: stat({ dirty: true }),
      },
      worktrees: [
        worktree({ binding_id: "a" }),
        worktree({ binding_id: "b" }),
        worktree({ binding_id: "c" }),
      ],
    }),
    null,
  );
  assert.deepEqual(ids(view), ["a", "b", "c"]);
});

test("a project id filters the board to that project, and null spans them all", () => {
  const built = model({
    repos: REPOS,
    stats: { one: stat(), two: stat() },
    worktrees: [
      worktree({ binding_id: "one", repo_id: "alpha" }),
      worktree({ binding_id: "two", repo_id: "beta" }),
    ],
  });
  assert.deepEqual(ids(triageBoard(built, null)), ["one", "two"]);
  assert.deepEqual(ids(triageBoard(built, "beta")), ["two"]);
});

test("the diffstat is git's own numbers, and a row with no answer says nothing", () => {
  const view = triageBoard(
    model({
      stats: {
        counted: stat({
          additions: 12,
          deletions: 3,
          changedFiles: 2,
          dirty: true,
        }),
      },
      worktrees: [
        worktree({ binding_id: "counted" }),
        worktree({ binding_id: "silent" }),
      ],
    }),
    null,
  );
  const by = new Map(view.rows.map((row) => [row.worktreeId, row]));
  assert.equal(by.get("counted").detail, "+12 −3");
  assert.equal(by.get("silent").detail, "");
});

test("only a worktree a run owns carries a date, and the note names the signal", () => {
  const view = triageBoard(
    model({
      runs: [{ id: "run-7", updated_at: "2026-08-09T10:11:12Z" }],
      stats: { owned: stat(), ownerless: stat() },
      worktrees: [
        worktree({
          binding_id: "owned",
          owner_run_id: "run-7",
          owner_run_status: "running",
        }),
        worktree({ binding_id: "ownerless" }),
      ],
    }),
    null,
  );
  const by = new Map(view.rows.map((row) => [row.worktreeId, row]));
  assert.equal(by.get("owned").activityAt, "2026-08-09T10:11:12Z");
  assert.match(by.get("owned").activityNote, /updated_at/);
  assert.equal(by.get("ownerless").activityAt, null);
  assert.equal(by.get("ownerless").activityNote, "");
});

test("a run the workspace no longer lists leaves the row dateless", () => {
  // The binding still names a run; the runs poll has not caught up, or the run
  // is gone. Either way there is no `updated_at` to print, and printing the
  // binding's own id in a date column is not an answer.
  const view = triageBoard(
    model({
      runs: [],
      stats: { owned: stat() },
      worktrees: [worktree({ binding_id: "owned", owner_run_id: "run-7" })],
    }),
    null,
  );
  assert.equal(view.rows[0].activityAt, null);
});

test("everything quiet is answered, and it is a good answer", () => {
  const view = triageBoard(
    model({
      stats: { a: stat(), b: stat() },
      worktrees: [worktree({ binding_id: "a" }), worktree({ binding_id: "b" })],
    }),
    null,
  );
  assert.match(view.headline, /nothing needs you/i);
});

test("one unanswered row costs the board its everything-is-clean claim", () => {
  const view = triageBoard(
    model({
      stats: { a: stat() },
      worktrees: [worktree({ binding_id: "a" }), worktree({ binding_id: "b" })],
    }),
    null,
  );
  assert.doesNotMatch(view.headline, /every worktree/i);
  assert.match(view.headline, /1 worktree is clean/);
  assert.match(view.headline, /has not reported on 1/);
});

test("a board nothing has answered about says exactly that", () => {
  const view = triageBoard(
    model({ worktrees: [worktree({ binding_id: "a" })] }),
    null,
  );
  assert.match(view.headline, /Nothing has answered yet/);
});

test("no projects and a project with no worktrees are different sentences", () => {
  const none = triageBoard({ projects: 0, rows: [] }, null);
  assert.match(none.headline, /No projects yet/);
  const empty = triageBoard({ projects: 2, rows: [] }, "beta");
  assert.match(empty.headline, /no worktrees yet/);
  assert.notEqual(none.headline, empty.headline);
});

test("the loud headline names the strongest state and how many rows are in it", () => {
  const view = triageBoard(
    model({
      stats: { a: stat({ dirty: true }), b: stat() },
      worktrees: [
        worktree({ binding_id: "a" }),
        worktree({ binding_id: "b", owner_run_status: "paused" }),
      ],
    }),
    null,
  );
  assert.match(view.headline, /1 worktree need(s)? you/);
});

test("an age is said in the largest unit that still fits", () => {
  const at = Date.parse("2026-08-09T12:00:00Z");
  assert.equal(ageLabel("2026-08-09T12:00:00Z", at + 30_000), "just now");
  assert.equal(ageLabel("2026-08-09T12:00:00Z", at + 60_000), "1m ago");
  assert.equal(ageLabel("2026-08-09T12:00:00Z", at + 90 * 60_000), "1h ago");
  assert.equal(ageLabel("2026-08-09T12:00:00Z", at + 50 * 3_600_000), "2d ago");
});

test("a row with no date, and one with a date nothing can parse, say nothing", () => {
  // Not "never" and not the epoch: both are claims about when work happened,
  // and neither is one this app was told.
  assert.equal(ageLabel(null, Date.now()), "");
  assert.equal(ageLabel("whenever", Date.now()), "");
});

test("a date a few seconds ahead of this clock is not a negative age", () => {
  // The coordinator stamps `updated_at` on its own machine. Skew between two
  // clocks is not a fact about the run, and "-1m ago" on a board is a defect
  // the owner would report rather than read past.
  const at = Date.parse("2026-08-09T12:00:00Z");
  assert.equal(ageLabel("2026-08-09T12:00:00Z", at - 4_000), "just now");
});

test("a row carries the project that owns it, so a click can name both", () => {
  const built = model({
    repos: REPOS,
    stats: { two: stat() },
    worktrees: [worktree({ binding_id: "two", repo_id: "beta" })],
  });
  const row = triageBoard(built, null).rows[0];
  assert.equal(row.repoId, "beta");
  assert.equal(row.projectName, "beta");
  assert.equal(row.label, "feature");
});
