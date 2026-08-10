import assert from "node:assert/strict";
import { test } from "node:test";
import {
  groupWorktrees,
  isLocalWorktree,
  isMainCheckout,
  localBindingId,
  localWorktreePath,
  mergeForeignRepos,
  readRepoEntries,
  readRepos,
  worktreeCwd,
  worktreeSummary,
} from "./projects.ts";

// ---------------------------------------------------------------------
// readRepos
// ---------------------------------------------------------------------

test("readRepos: null state → []", () => {
  assert.deepEqual(readRepos(null), []);
});

test("readRepos: empty object → []", () => {
  assert.deepEqual(readRepos({}), []);
});

test("readRepos: repos not an array → []", () => {
  assert.deepEqual(readRepos({ repos: "nope" }), []);
});

test("readRepos: never throws on arbitrary garbage shapes", () => {
  assert.deepEqual(readRepos(undefined), []);
  assert.deepEqual(readRepos("string"), []);
  assert.deepEqual(readRepos(42), []);
  assert.deepEqual(readRepos([1, 2, 3]), []);
  assert.deepEqual(readRepos({ repos: null }), []);
});

test("readRepos: a malformed element is dropped, never throws", () => {
  const state = {
    repos: [
      { id: "buzz", name: "buzz", path: "/Users/x/buzz" },
      { id: "no-name", path: "/Users/x/whatever" }, // missing name
      { id: "no-path", name: "whatever" }, // missing path
      "not-an-object",
      null,
      42,
    ],
  };
  assert.deepEqual(readRepos(state), [
    { id: "buzz", name: "buzz", path: "/Users/x/buzz" },
  ]);
});

test("readRepos: valid multi-entry array parses in order", () => {
  const state = {
    repos: [
      { id: "buzz", name: "buzz", path: "/Users/x/buzz" },
      { id: "vingilot", name: "vingilot", path: "/Users/x/vingilot" },
    ],
  };
  assert.deepEqual(readRepos(state), [
    { id: "buzz", name: "buzz", path: "/Users/x/buzz" },
    { id: "vingilot", name: "vingilot", path: "/Users/x/vingilot" },
  ]);
});

// Audit finding (deckPins lesson, mirrored): putRepos writes the whole
// `repos` array back, so an unknown extra key on a repo object must survive
// a read/write round-trip rather than being silently dropped.
test("readRepos preserves unknown extra keys on an otherwise-valid repo", () => {
  const state = {
    repos: [
      {
        id: "buzz",
        name: "buzz",
        path: "/Users/x/buzz",
        futureField: "some-future-client-wrote-this",
      },
    ],
  };
  const repos = readRepos(state);
  assert.equal(repos.length, 1);
  assert.equal(repos[0].futureField, "some-future-client-wrote-this");
});

// ---------------------------------------------------------------------
// readRepoEntries / mergeForeignRepos
//
// The other half of that round-trip, and the one that bites: an entry
// `readRepos` DROPS (a missing `name`, say, or a shape a later client
// introduces) must not be erased by the next write of the whole array.
// ---------------------------------------------------------------------

test("readRepoEntries keeps what readRepos drops, with its index", () => {
  const state = {
    repos: [
      { id: "buzz", path: "/Users/x/buzz" },
      { id: "vingilot", name: "vingilot", path: "/Users/x/vingilot" },
      "junk",
    ],
  };
  const { foreign, repos } = readRepoEntries(state);

  assert.deepEqual(repos, [
    { id: "vingilot", name: "vingilot", path: "/Users/x/vingilot" },
  ]);
  assert.deepEqual(foreign, [
    { index: 0, value: { id: "buzz", path: "/Users/x/buzz" } },
    { index: 2, value: "junk" },
  ]);
});

test("readRepoEntries on garbage state yields nothing of either kind", () => {
  for (const state of [null, undefined, 42, "s", {}, { repos: "nope" }]) {
    assert.deepEqual(readRepoEntries(state), { foreign: [], repos: [] });
  }
});

test("mergeForeignRepos puts each foreign entry back at its old index", () => {
  const merged = mergeForeignRepos(
    [
      { id: "vingilot", name: "vingilot", path: "/o/vingilot" },
      { id: "nano", name: "nano", path: "/o/nano" },
    ],
    [{ index: 0, value: { id: "buzz", path: "/o/buzz" } }],
  );

  assert.deepEqual(merged, [
    { id: "buzz", path: "/o/buzz" },
    { id: "vingilot", name: "vingilot", path: "/o/vingilot" },
    { id: "nano", name: "nano", path: "/o/nano" },
  ]);
});

test("mergeForeignRepos clamps an index the shortened list no longer has", () => {
  const merged = mergeForeignRepos([], [{ index: 4, value: "junk" }]);
  assert.deepEqual(merged, ["junk"]);
});

test("mergeForeignRepos restores several entries in index order", () => {
  const merged = mergeForeignRepos(
    [{ id: "a", name: "a", path: "/a" }],
    [
      { index: 2, value: "second" },
      { index: 0, value: "first" },
    ],
  );
  assert.deepEqual(merged, [
    "first",
    { id: "a", name: "a", path: "/a" },
    "second",
  ]);
});

test("read then merge with an unchanged plan reproduces the array exactly", () => {
  const raw = [
    { id: "buzz", path: "/o/buzz" },
    { id: "vingilot", name: "vingilot", path: "/o/vingilot" },
    { extra: true },
  ];
  const { foreign, repos } = readRepoEntries({ repos: raw });
  assert.deepEqual(mergeForeignRepos(repos, foreign), raw);
});

// ---------------------------------------------------------------------
// groupWorktrees
// ---------------------------------------------------------------------

function wt(overrides = {}) {
  return {
    binding_id: "b1",
    repo_id: "buzz",
    branch: "run/bz-142",
    role: "task",
    lifecycle: "ready",
    base_commit: "abc123",
    owner_run_id: "r1",
    owner_run_status: "running",
    owner_run_objective: "do the thing",
    added: 214,
    removed: 87,
    commit_sha: "75269de",
    ...overrides,
  };
}

test("groupWorktrees: every worktree lands under its repo", () => {
  const repos = [{ id: "buzz", name: "buzz", path: "/x/buzz" }];
  const w1 = wt({ binding_id: "b1", repo_id: "buzz" });
  const w2 = wt({ binding_id: "b2", repo_id: "buzz" });
  const { byRepo, unknown } = groupWorktrees(repos, [w1, w2]);
  // The repo's own checkout is always row zero; task worktrees follow it.
  assert.deepEqual(byRepo.buzz.slice(1), [w1, w2]);
  assert.equal(isMainCheckout(byRepo.buzz[0]), true);
  assert.deepEqual(unknown, []);
});

test("groupWorktrees: a repo with no worktrees still gets an entry ([])", () => {
  const repos = [
    { id: "buzz", name: "buzz", path: "/x/buzz" },
    { id: "vingilot", name: "vingilot", path: "/x/vingilot" },
  ];
  const w1 = wt({ binding_id: "b1", repo_id: "buzz" });
  const { byRepo } = groupWorktrees(repos, [w1]);
  // "No worktrees" now means "only its own checkout" — never an empty column.
  assert.deepEqual(byRepo.buzz.slice(1), [w1]);
  assert.deepEqual(byRepo.vingilot.slice(1), []);
  assert.equal(isMainCheckout(byRepo.vingilot[0]), true);
});

test("groupWorktrees: a worktree whose repo_id matches no known repo lands in unknown, not dropped", () => {
  const repos = [{ id: "buzz", name: "buzz", path: "/x/buzz" }];
  const known = wt({ binding_id: "b1", repo_id: "buzz" });
  const orphan = wt({ binding_id: "b2", repo_id: "ghost-repo" });
  const { byRepo, unknown } = groupWorktrees(repos, [known, orphan]);
  assert.deepEqual(byRepo.buzz.slice(1), [known]);
  assert.deepEqual(unknown, [orphan]);
});

test("groupWorktrees: no repos at all → every worktree is unknown", () => {
  const orphan = wt({ binding_id: "b1", repo_id: "buzz" });
  const { byRepo, unknown } = groupWorktrees([], [orphan]);
  assert.deepEqual(byRepo, {});
  assert.deepEqual(unknown, [orphan]);
});

// ---------------------------------------------------------------------
// worktreeSummary
// ---------------------------------------------------------------------

test("worktreeSummary: a branch worktree uses the branch as its label", () => {
  const summary = worktreeSummary(wt({ branch: "run/bz-142" }));
  assert.equal(summary.label, "run/bz-142");
});

test("worktreeSummary: a primary checkout with no branch labels as 'main'", () => {
  const summary = worktreeSummary(
    wt({
      branch: null,
      role: "primary",
      owner_run_id: null,
      owner_run_status: null,
      owner_run_objective: null,
      added: null,
      removed: null,
      commit_sha: null,
    }),
  );
  assert.equal(summary.label, "main");
});

test("worktreeSummary: diff counts present → {added, removed}", () => {
  const summary = worktreeSummary(wt({ added: 214, removed: 87 }));
  assert.deepEqual(summary.diff, { added: 214, removed: 87 });
});

test("worktreeSummary: no diff evidence yet → diff is null, not {0, 0}", () => {
  const summary = worktreeSummary(wt({ added: null, removed: null }));
  assert.equal(summary.diff, null);
});

// ---------------------------------------------------------------------
// worktreeCwd
// ---------------------------------------------------------------------

const repo = { id: "buzz", name: "buzz", path: "/Users/x/buzz" };

test("worktreeCwd: primary role cwd is the repo's own path, ignoring worktreeRoot", () => {
  const primary = wt({
    role: "primary",
    branch: null,
    owner_run_id: null,
  });
  assert.equal(
    worktreeCwd(repo, primary, "/Users/x/.vingilot/worktrees"),
    "/Users/x/buzz",
  );
});

test("worktreeCwd: a task worktree's cwd is <worktreeRoot>/<owner_run_id>", () => {
  const task = wt({ role: "task", owner_run_id: "r1" });
  assert.equal(
    worktreeCwd(repo, task, "/Users/x/.vingilot/worktrees"),
    "/Users/x/.vingilot/worktrees/r1",
  );
});

test("worktreeCwd: a trailing slash on worktreeRoot doesn't double up", () => {
  const task = wt({ role: "task", owner_run_id: "r1" });
  assert.equal(
    worktreeCwd(repo, task, "/Users/x/.vingilot/worktrees/"),
    "/Users/x/.vingilot/worktrees/r1",
  );
});

test("worktreeCwd: a task worktree with no owner run yet has no derivable cwd", () => {
  const task = wt({ role: "task", owner_run_id: null });
  assert.equal(worktreeCwd(repo, task, "/Users/x/.vingilot/worktrees"), null);
});

// A project you have not run anything in yet must still open onto something.
// Before this, groupWorktrees returned an empty bucket and the screen said
// "no worktrees yet" — no rows, no terminal, the exact emptiness the projects
// view exists to end.
test("groupWorktrees always includes the repo's own checkout", () => {
  const repo = { id: "buzz", name: "vingilot", path: "/repos/vingilot" };
  const { byRepo } = groupWorktrees([repo], []);
  assert.equal(byRepo.buzz.length, 1);
  const main = byRepo.buzz[0];
  assert.equal(main.role, "primary");
  assert.equal(isMainCheckout(main), true);
  assert.equal(main.owner_run_id, null, "nothing runs in the main checkout");
  assert.equal(
    worktreeCwd(repo, main, "/root"),
    "/repos/vingilot",
    "the main checkout's terminal opens in the repo itself",
  );
});

test("task worktrees are listed after the main checkout, never instead of it", () => {
  const repo = { id: "buzz", name: "vingilot", path: "/repos/vingilot" };
  const task = {
    added: 3,
    base_commit: "abc",
    binding_id: "b1",
    branch: "run/aaa",
    commit_sha: null,
    lifecycle: "ready",
    owner_run_id: "r1",
    owner_run_objective: "do a thing",
    owner_run_status: "running",
    removed: 1,
    repo_id: "buzz",
    role: "task",
  };
  const { byRepo } = groupWorktrees([repo], [task]);
  assert.deepEqual(
    byRepo.buzz.map((w) => w.role),
    ["primary", "task"],
  );
  assert.equal(isMainCheckout(byRepo.buzz[1]), false);
});

// ---------------------------------------------------------------------
// local worktree ids
//
// A binding id is derived once and then consumed by three things with three
// different alphabets, none of which reports a violation usefully:
//
//   1. tmux session names — vingilot_pty/tmux.rs escapes every byte outside
//      [A-Za-z0-9_] as -<hex>, so any ASCII id survives injectively.
//   2. Tauri event names — is_event_name_valid (tauri 2.11.5) admits ONLY
//      [A-Za-z0-9-/:_]. An id outside it makes listen/emit fail, silently on
//      the emit side. (The session id itself no longer rides in an event
//      name — it travels in the payload — but the id must stay inside this
//      alphabet so that putting it back is never the thing that breaks.)
//   3. this app's own ids — MAIN_CHECKOUT_PREFIX / LOCAL_WORKTREE_PREFIX have
//      to stay distinguishable from each other and from a coordinator
//      binding id, which is a UUID.
//
// Hex encoding is what makes all three true at once: the path can be
// anything, the id is `local:` plus [0-9a-f].
// ---------------------------------------------------------------------

const TMUX_SAFE = /^[A-Za-z0-9_-]+$/;
const TAURI_EVENT_SAFE = /^[A-Za-z0-9\-/:_]+$/;

const AWKWARD_PATHS = [
  "/Users/o/self-hosted/vingilot",
  "/Users/o/my repo/tree #2",
  "/Users/o/.vingilot/worktrees/buzz/fix:this",
  "/Users/o/çalışma/ağaç",
  "/Users/o/emoji/🌱",
  "/",
];

test("a local binding id stays inside every alphabet that consumes it", () => {
  for (const path of AWKWARD_PATHS) {
    const id = localBindingId(path);
    assert.match(id, /^local:[0-9a-f]+$/, `${path} produced ${id}`);
    // 2: the Tauri event alphabet, which admits ":" and so admits this id.
    assert.match(id, TAURI_EVENT_SAFE, `${path} left the Tauri alphabet`);
    // 1: everything after the one ":" is already tmux-safe verbatim; the ":"
    // is escaped, exactly as it already is in every "main:<repo id>" id.
    assert.match(
      id.slice("local:".length),
      TMUX_SAFE,
      `${path} left the tmux alphabet`,
    );
    // 3: never mistakable for the repo's own checkout, and never a UUID.
    assert.equal(isMainCheckout({ binding_id: id }), false);
    assert.equal(isLocalWorktree({ binding_id: id }), true);
  }
});

test("a local binding id round-trips to the exact path, and is injective", () => {
  const seen = new Set();
  for (const path of AWKWARD_PATHS) {
    const id = localBindingId(path);
    assert.equal(localWorktreePath(id), path);
    assert.equal(seen.has(id), false, `${path} collided with an earlier path`);
    seen.add(id);
  }
  // Two paths one character apart must not share a shell.
  assert.notEqual(localBindingId("/a/b"), localBindingId("/a/c"));
});

test("an id that is not a local worktree decodes to null, never to a path", () => {
  assert.equal(localWorktreePath("main:buzz"), null);
  assert.equal(localWorktreePath("9f1c8d2e-0000-4000-8000-000000000000"), null);
  // Hand-edited or half-written ids: odd length, non-hex, empty.
  assert.equal(localWorktreePath("local:abc"), null);
  assert.equal(localWorktreePath("local:zz"), null);
  assert.equal(localWorktreePath("local:"), null);
});

test("a local worktree's terminal opens at the path its id carries", () => {
  const repo = { id: "buzz", name: "vingilot", path: "/repos/vingilot" };
  const local = wt({
    binding_id: localBindingId("/Users/o/.vingilot/worktrees/buzz/fix"),
    owner_run_id: null,
    role: "local",
  });
  assert.equal(
    worktreeCwd(repo, local, "/root"),
    "/Users/o/.vingilot/worktrees/buzz/fix",
    "no owner run to derive from, and none needed",
  );
});
