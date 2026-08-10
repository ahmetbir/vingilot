import assert from "node:assert/strict";
import { test } from "node:test";
import { localBindingId, mainCheckout } from "./projects.ts";
import {
  attentionOf,
  FILTER_THRESHOLD,
  FOLD_THRESHOLD,
  foldLabelFor,
  isFinishedRun,
  orderWorktrees,
  prunableWorktrees,
  rowDetail,
  worktreeColumnView,
} from "./worktreeAttention.ts";

const repo = { id: "buzz", name: "vingilot", path: "/repos/vingilot" };
const main = mainCheckout(repo);

/** A worktree a Run owns. */
function task(branch, status, overrides = {}) {
  return {
    added: null,
    base_commit: "abc",
    binding_id: `bind-${branch}`,
    branch,
    commit_sha: null,
    lifecycle: "ready",
    owner_run_id: `run-${branch}`,
    owner_run_objective: null,
    owner_run_status: status,
    removed: null,
    repo_id: repo.id,
    role: "task",
    ...overrides,
  };
}

/** A worktree git listed and the coordinator knows nothing about. */
function local(branch, overrides = {}) {
  return {
    added: null,
    base_commit: "abc",
    binding_id: localBindingId(`/w/${branch}`),
    branch,
    commit_sha: null,
    lifecycle: "ready",
    owner_run_id: null,
    owner_run_objective: null,
    owner_run_status: null,
    removed: null,
    repo_id: repo.id,
    role: "local",
    ...overrides,
  };
}

function stat(overrides = {}) {
  return {
    additions: 0,
    changedFiles: 0,
    deletions: 0,
    dirty: false,
    path: "/w/x",
    unreadable: false,
    untracked: 0,
    ...overrides,
  };
}

const dirty = stat({
  additions: 12,
  changedFiles: 2,
  deletions: 3,
  dirty: true,
});

function statsFor(pairs) {
  return Object.fromEntries(pairs.map(([wt, s]) => [wt.binding_id, s]));
}

// ---------------------------------------------------------------------------
// what a row is
// ---------------------------------------------------------------------------

test("uncommitted work outranks everything else a row can be", () => {
  // A finished run whose tree is dirty is still work that can be lost.
  assert.equal(attentionOf(task("fix", "completed"), dirty), "dirty");
  assert.equal(attentionOf(task("fix", "running"), dirty), "dirty");
});

test("a run that has not finished is running, including one waiting on you", () => {
  for (const status of [
    "running",
    "verifying",
    "provisioning",
    "ready",
    "paused",
    "blocked",
    "draft",
  ]) {
    assert.equal(attentionOf(task("fix", status), stat()), "running");
  }
});

test("a finished run over a clean tree is clean", () => {
  for (const status of ["completed", "failed", "cancelled"]) {
    assert.equal(attentionOf(task("fix", status), stat()), "clean");
  }
});

test("a tree nothing is known about is never called dirty", () => {
  // A marker that appears because a read is slow trains the owner to ignore
  // it. `null` is "not read yet, or unreadable".
  assert.equal(attentionOf(local("mine"), null), "clean");
  assert.equal(attentionOf(task("fix", "running"), null), "running");
});

test("only a worktree with a run that ended is a finished run", () => {
  assert.equal(isFinishedRun(task("fix", "completed")), true);
  assert.equal(isFinishedRun(task("fix", "running")), false);
  assert.equal(isFinishedRun(local("mine")), false);
  assert.equal(isFinishedRun(main), false);
});

// ---------------------------------------------------------------------------
// the ordering rule
// ---------------------------------------------------------------------------

test("dirty first, then running, then clean", () => {
  const clean = task("clean", "completed");
  const live = task("live", "running");
  const changed = task("changed", "completed");
  const ordered = orderWorktrees(
    [clean, live, changed],
    statsFor([[changed, dirty]]),
  );
  assert.deepEqual(
    ordered.map((wt) => wt.branch),
    ["changed", "live", "clean"],
  );
});

test("the project's own checkout is pinned first whatever state it is in", () => {
  const changed = task("changed", "completed");
  const ordered = orderWorktrees([changed, main], statsFor([[changed, dirty]]));
  assert.equal(ordered[0].binding_id, main.binding_id);

  // Even when the checkout itself is the dirty one, it does not move.
  const alsoDirty = orderWorktrees(
    [changed, main],
    statsFor([
      [changed, dirty],
      [main, dirty],
    ]),
  );
  assert.equal(alsoDirty[0].binding_id, main.binding_id);
});

test("a worktree only moves because its own state moved", () => {
  // Stable within a rank: the incoming order is kept, so a poll that changes
  // nothing cannot reshuffle the column under the owner's fingers.
  const rows = ["a", "b", "c", "d"].map((b) => task(b, "completed"));
  assert.deepEqual(
    orderWorktrees(rows, {}).map((wt) => wt.branch),
    ["a", "b", "c", "d"],
  );
});

// ---------------------------------------------------------------------------
// the fold
// ---------------------------------------------------------------------------

/** Every worktree, read and clean — the ordinary state once git has answered.
 * It is the default here because folding requires an answer: a test that wants
 * "not read yet" has to say so, rather than getting it by omission. */
function allClean(worktrees) {
  return statsFor(worktrees.map((wt) => [wt, stat({ path: wt.binding_id })]));
}

function view(worktrees, overrides = {}) {
  return worktreeColumnView({
    expanded: false,
    query: "",
    selectedId: null,
    stats: allClean(worktrees),
    worktrees,
    ...overrides,
  });
}

test("clean worktrees fold behind one row, and the row says what they are", () => {
  const finished = ["one", "two", "three", "four"].map((b) =>
    task(b, "completed"),
  );
  const answer = view([main, ...finished]);
  assert.deepEqual(
    answer.rows.map((row) => row.worktree.binding_id),
    [main.binding_id],
  );
  assert.equal(answer.folded.length, 4);
  assert.equal(answer.foldLabel, "4 finished runs");
});

test("a fold that is not all finished runs does not call itself one", () => {
  const answer = view([
    main,
    task("one", "completed"),
    task("two", "failed"),
    local("mine"),
  ]);
  assert.equal(answer.foldLabel, "3 clean worktrees");
});

test("too few quiet worktrees is not worth a fold", () => {
  const few = Array.from({ length: FOLD_THRESHOLD - 1 }, (_, n) =>
    task(`t${n}`, "completed"),
  );
  const answer = view([main, ...few]);
  assert.equal(answer.folded.length, 0);
  assert.equal(answer.foldLabel, "");
  assert.equal(answer.rows.length, few.length + 1);
});

test("the row you are standing in is never folded away", () => {
  const finished = ["one", "two", "three", "four"].map((b) =>
    task(b, "completed"),
  );
  const answer = view([main, ...finished], {
    selectedId: finished[1].binding_id,
  });
  assert.ok(
    answer.rows.some(
      (row) => row.worktree.binding_id === finished[1].binding_id,
    ),
  );
  assert.equal(answer.foldLabel, "3 finished runs");
});

test("a worktree git has not answered about yet is never folded away", () => {
  // `stats` starts empty and is not cleared on a project switch, so without
  // this the whole column folds on first paint and again on every switch —
  // and folding is the one place a wrong guess removes the row from sight.
  const finished = ["one", "two", "three", "four"].map((b) =>
    task(b, "completed"),
  );
  const answer = view([main, ...finished], { stats: {} });
  assert.equal(answer.folded.length, 0);
  assert.equal(answer.foldLabel, "");
  assert.equal(answer.rows.length, finished.length + 1);
});

test("a worktree that could not be read is never folded away", () => {
  // The owner keeps projects on /Volumes/ugreen. If that unmounts, git cannot
  // read any of them — and an unreadable tree may have been dirty when it was
  // last readable. Folding it behind "N finished runs" would claim something
  // git never said, with uncommitted work hidden behind the claim.
  const finished = ["one", "two", "three", "four"].map((b) =>
    task(b, "completed"),
  );
  const stats = statsFor(
    finished.map((wt) => [wt, stat({ dirty: true, unreadable: true })]),
  );
  const answer = view([main, ...finished], { stats });
  assert.equal(answer.folded.length, 0);
  assert.equal(answer.foldLabel, "");
  assert.deepEqual(
    answer.rows.map((row) => row.worktree.binding_id),
    [main.binding_id, ...finished.map((wt) => wt.binding_id)],
  );
});

test("nothing dirty or running is ever folded", () => {
  const worktrees = [
    main,
    task("live", "running"),
    task("changed", "completed"),
    task("a", "completed"),
    task("b", "completed"),
    task("c", "completed"),
  ];
  // Git has answered about every row — clean for all but one — so the only
  // reason anything stays out of the fold is the state it is in, which is what
  // this test is about.
  const stats = { ...allClean(worktrees), "bind-changed": dirty };
  // The column is rendered from the ordered list, so the test is too — the
  // view folds, it does not sort.
  const answer = view(orderWorktrees(worktrees, stats), { stats });
  assert.deepEqual(
    answer.rows.map((row) => row.worktree.branch ?? "main"),
    ["main", "changed", "live"],
  );
  assert.equal(answer.folded.length, 3);
});

test("expanding shows everything and keeps the row that closes it again", () => {
  const finished = ["one", "two", "three"].map((b) => task(b, "completed"));
  const answer = view([main, ...finished], { expanded: true });
  assert.equal(answer.rows.length, 4);
  assert.equal(answer.folded.length, 0);
  assert.equal(answer.foldLabel, "3 finished runs");
});

test("folding hides nothing from the shortcut it carries", () => {
  // The digit is the row's place in the ordered list, so it stays with the
  // worktree whether the fold is open or shut — and selecting a folded
  // worktree by its digit unfolds it, because the selected row never folds.
  const finished = ["one", "two", "three"].map((b) => task(b, "completed"));
  const shut = view([main, ...finished]);
  const open = view([main, ...finished], { expanded: true });
  assert.deepEqual(
    shut.rows.map((row) => row.index),
    [0],
  );
  assert.deepEqual(
    open.rows.map((row) => row.index),
    [0, 1, 2, 3],
  );
});

test("an empty fold has no label", () => {
  assert.equal(foldLabelFor([]), "");
  assert.equal(
    foldLabelFor([{ worktree: task("one", "completed") }]),
    "1 finished run",
  );
});

// ---------------------------------------------------------------------------
// the filter
// ---------------------------------------------------------------------------

test("the filter box appears once a project has more worktrees than fit the eye", () => {
  const under = Array.from({ length: FILTER_THRESHOLD }, (_, n) =>
    task(`t${n}`, "completed"),
  );
  assert.equal(view(under).showFilter, false);
  assert.equal(
    view([...under, task("one-more", "completed")]).showFilter,
    true,
  );
});

test("a query narrows by what the row is labelled, either case", () => {
  const answer = view([main, task("Fix-Login", "completed"), local("docs")], {
    query: "fix",
  });
  assert.deepEqual(
    answer.rows.map((row) => row.worktree.branch),
    ["Fix-Login"],
  );
  assert.equal(answer.filteredOut, 2);
});

test("a search that hid its own matches would not be a search", () => {
  // Nothing folds while a query is on, however many quiet rows match it.
  const finished = ["run-a", "run-b", "run-c", "run-d"].map((b) =>
    task(b, "completed"),
  );
  const answer = view([main, ...finished], { query: "run-" });
  assert.equal(answer.folded.length, 0);
  assert.equal(answer.foldLabel, "");
  assert.equal(answer.rows.length, 4);
});

test("whitespace is not a query", () => {
  const finished = ["one", "two", "three"].map((b) => task(b, "completed"));
  const answer = view([main, ...finished], { query: "   " });
  assert.equal(answer.folded.length, 3);
});

// ---------------------------------------------------------------------------
// what a row says, and what git says is prunable
// ---------------------------------------------------------------------------

test("a row states git's own numbers, and nothing else", () => {
  assert.equal(
    rowDetail({
      attention: "dirty",
      index: 0,
      stat: dirty,
      worktree: local("x"),
    }),
    "+12 −3",
  );
  assert.equal(
    rowDetail({
      attention: "dirty",
      index: 0,
      stat: stat({ dirty: true, untracked: 2 }),
      worktree: local("x"),
    }),
    "2 new",
  );
  assert.equal(
    rowDetail({
      attention: "dirty",
      index: 0,
      stat: stat({ additions: 1, changedFiles: 1, dirty: true, untracked: 2 }),
      worktree: local("x"),
    }),
    "+1 −0 · 2 new",
  );
});

test("a change with no lines on either side still reads as a change", () => {
  // A binary or mode-only edit: "+0 −0" beside a dirty marker reads as a
  // contradiction, so the file count is what is shown.
  assert.equal(
    rowDetail({
      attention: "dirty",
      index: 0,
      stat: stat({ changedFiles: 1, dirty: true }),
      worktree: local("x"),
    }),
    "1 changed",
  );
});

test("a clean row still says its run stopped without finishing", () => {
  // The signal the column's old destructive status dot carried, kept in words:
  // the tree is clean and the run failed, and neither fact implies the other.
  for (const status of ["failed", "cancelled"]) {
    assert.equal(
      rowDetail({
        attention: "clean",
        index: 0,
        stat: stat(),
        worktree: task("fix", status),
      }),
      `clean · ${status}`,
      status,
    );
  }
  assert.equal(
    rowDetail({
      attention: "clean",
      index: 0,
      stat: stat(),
      worktree: task("fix", "completed"),
    }),
    "clean",
  );
});

test("a row says clean only when git said so", () => {
  assert.equal(
    rowDetail({
      attention: "clean",
      index: 0,
      stat: stat(),
      worktree: local("x"),
    }),
    "clean",
  );
  // No stat: the coordinator's own evidence if there is any, then the run's
  // status, then nothing — never the word "clean".
  assert.equal(
    rowDetail({
      attention: "clean",
      index: 0,
      stat: null,
      worktree: task("fix", "completed", { added: 4, removed: 1 }),
    }),
    "+4 −1",
  );
  assert.equal(
    rowDetail({
      attention: "running",
      index: 0,
      stat: null,
      worktree: task("fix", "running"),
    }),
    "running",
  );
  assert.equal(
    rowDetail({
      attention: "clean",
      index: 0,
      stat: null,
      worktree: local("x"),
    }),
    "",
  );
});

test("prunable is git's own flag and nothing this app inferred", () => {
  const gone = local("gone", { lifecycle: "prunable" });
  assert.deepEqual(
    prunableWorktrees([main, task("fix", "completed"), local("here"), gone]),
    [gone],
  );
});
