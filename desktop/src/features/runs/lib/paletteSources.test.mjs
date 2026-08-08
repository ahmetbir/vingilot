import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionSource,
  paletteMatches,
  paneSource,
  projectSource,
  worktreeSource,
} from "./paletteSources.ts";

const REPOS = [
  { id: "p1", name: "vingilot", path: "/Users/me/vingilot" },
  { id: "p2", name: "buzz", path: "/Volumes/ugreen/buzz" },
];

function worktree(bindingId, overrides = {}) {
  return {
    added: null,
    base_commit: "",
    binding_id: bindingId,
    branch: null,
    commit_sha: null,
    lifecycle: "ready",
    owner_run_id: null,
    owner_run_objective: null,
    owner_run_status: null,
    removed: null,
    repo_id: "p1",
    role: "task",
    ...overrides,
  };
}

const PANES = [
  {
    availability: { status: "available" },
    icon: "±",
    id: "diff",
    title: "Diff",
  },
  {
    availability: { reason: "no ACP harness here.", status: "unavailable" },
    icon: "◆",
    id: "agent",
    title: "Agent",
  },
];

function ctx(overrides = {}) {
  return {
    hasWorktreeColumn: true,
    paneChoices: PANES,
    prunable: 0,
    repos: REPOS,
    selectedRepoId: "p1",
    selectedWorktreeId: "main:p1",
    sidebarCollapsed: false,
    solo: null,
    worktrees: [
      worktree("main:p1", { role: "primary" }),
      worktree("wt-1", { branch: "vingilot/palette" }),
    ],
    worktreeCwd: "/Users/o/vingilot-worktrees/main-p1",
    worktreeCwdPending: false,
    worktreesCollapsed: false,
    ...overrides,
  };
}

/** The candidate behind an id, or `undefined`. */
function row(matches, id) {
  return matches.find((match) => match.candidate.id === id)?.candidate;
}

function ids(matches) {
  return matches.map((match) => match.candidate.id);
}

test("every project is a candidate, and so is the way back to the Deck", () => {
  const found = ids(projectSource(ctx(), ""));
  assert.deepEqual(found, ["project:p1", "project:p2", "project:landing"]);
});

test("a project is findable by its path as well as its name", () => {
  const matched = projectSource(ctx(), "ugreen");
  assert.deepEqual(ids(matched), ["project:p2"]);
  assert.equal(matched[0].field, "detail");
});

test("the open project says so, and the others do not", () => {
  const matches = projectSource(ctx(), "");
  assert.equal(row(matches, "project:p1").detail, "/Users/me/vingilot · open");
  assert.equal(row(matches, "project:p2").detail, "/Volumes/ugreen/buzz");
});

test("worktrees are labelled the way the column labels them", () => {
  const matches = worktreeSource(ctx(), "");
  assert.equal(row(matches, "worktree:main:p1").label, "main");
  assert.equal(row(matches, "worktree:wt-1").label, "vingilot/palette");
});

test("no project open means no worktree nouns at all — not a blocked one", () => {
  assert.deepEqual(
    worktreeSource(ctx({ selectedRepoId: null, worktrees: [] }), ""),
    [],
  );
});

test("a pane carries its own refusal, not one the palette invented", () => {
  const matches = paneSource(ctx(), "");
  assert.equal(row(matches, "pane:diff").blocked, null);
  assert.equal(row(matches, "pane:agent").blocked, "no ACP harness here.");
});

test("with no worktree open, every pane says the same thing and none vanishes", () => {
  const matches = paneSource(ctx({ selectedWorktreeId: null }), "");
  assert.deepEqual(ids(matches), ["pane:diff", "pane:agent"]);
  for (const match of matches) {
    assert.equal(
      match.candidate.blocked,
      "no worktree is open, so there is nothing to put a pane beside.",
    );
  }
});

test("prune with nothing prunable is offered, and says why it will not run", () => {
  const stopped = row(
    actionSource(ctx({ prunable: 0 }), ""),
    "action:prune-worktrees",
  );
  assert.equal(
    stopped.blocked,
    "nothing to prune — git can still find every worktree's directory in this project.",
  );
  const live = row(
    actionSource(ctx({ prunable: 2 }), ""),
    "action:prune-worktrees",
  );
  assert.equal(live.blocked, null);
  assert.match(live.detail, /2 records/);
});

test("remove project names the project, and refuses when there is none", () => {
  const withOne = row(actionSource(ctx(), ""), "action:remove-project");
  assert.equal(withOne.label, "Remove vingilot…");
  assert.equal(withOne.blocked, null);
  assert.match(withOne.detail, /never touches the folder/);

  const withNone = row(
    actionSource(ctx({ selectedRepoId: null }), ""),
    "action:remove-project",
  );
  assert.equal(withNone.label, "Remove project…");
  assert.ok(withNone.blocked !== null);
});

test("adding a project is never blocked — it is the way out of an empty workspace", () => {
  const empty = ctx({ repos: [], selectedRepoId: null, worktrees: [] });
  assert.equal(
    row(actionSource(empty, ""), "action:add-project").blocked,
    null,
  );
});

test("a new terminal tab needs a worktree, and a new worktree needs a project", () => {
  const none = ctx({ selectedRepoId: null, selectedWorktreeId: null });
  assert.ok(
    row(actionSource(none, ""), "action:new-terminal-tab").blocked !== null,
  );
  assert.ok(
    row(actionSource(none, ""), "action:new-worktree").blocked !== null,
  );
  assert.equal(
    row(actionSource(ctx(), ""), "action:new-terminal-tab").blocked,
    null,
  );
  assert.equal(
    row(actionSource(ctx(), ""), "action:new-worktree").blocked,
    null,
  );
});

test("the scratch shell is offered, and says how it differs from the tab above it", () => {
  const scratch = row(actionSource(ctx(), ""), "action:scratch-terminal");
  assert.equal(scratch.blocked, null);
  assert.equal(scratch.detail.endsWith("⌥⌘T"), true);
  // The only thing separating these two rows is what happens afterwards, so
  // the row that keeps nothing has to say so where it is read.
  assert.match(scratch.detail, /keeps nothing/);
  assert.match(scratch.detail, /no tmux session/);
  // And the door says the lifetime, not only the absence of one: the row is
  // read before the shell exists, which is the last moment saying so is free.
  assert.match(scratch.detail, /ends when you close it or leave this worktree/);
  assert.notEqual(
    scratch.label,
    row(actionSource(ctx(), ""), "action:new-terminal-tab").label,
  );
});

test("the scratch shell is refused rather than opened somewhere arbitrary", () => {
  const none = ctx({
    selectedRepoId: null,
    selectedWorktreeId: null,
    worktreeCwd: null,
  });
  assert.match(
    row(actionSource(none, ""), "action:scratch-terminal").blocked,
    /no worktree is open/,
  );
  // A worktree selected but not yet located: still blocked, and never told as
  // "this worktree has no checkout" — the lookup simply has not answered.
  const pending = ctx({ worktreeCwd: null, worktreeCwdPending: true });
  assert.match(
    row(actionSource(pending, ""), "action:scratch-terminal").blocked,
    /not been resolved yet/,
  );
});

test("the worktree column cannot be toggled where there is not one", () => {
  const landing = ctx({ hasWorktreeColumn: false });
  assert.ok(
    row(actionSource(landing, ""), "action:toggle-worktrees").blocked !== null,
  );
  assert.equal(
    row(actionSource(ctx(), ""), "action:toggle-worktrees").blocked,
    null,
  );
});

test("a toggle's label says which way it is about to go", () => {
  assert.equal(
    row(
      actionSource(ctx({ sidebarCollapsed: true }), ""),
      "action:toggle-sidebar",
    ).label,
    "Show the sidebar",
  );
  assert.equal(
    row(actionSource(ctx(), ""), "action:toggle-sidebar").label,
    "Hide the sidebar",
  );
  assert.equal(
    row(actionSource(ctx({ solo: "left" }), ""), "action:solo-left").label,
    "Share the surface with the right pane again",
  );
  assert.equal(
    row(actionSource(ctx(), ""), "action:solo-left").label,
    "Give the terminal the whole surface",
  );
});

test("an action carries the chord that already does it", () => {
  assert.equal(
    row(actionSource(ctx(), ""), "action:new-terminal-tab").detail.endsWith(
      "⌘T",
    ),
    true,
  );
  assert.equal(
    row(actionSource(ctx(), ""), "action:toggle-worktrees").detail,
    "⇧⌘B",
  );
  assert.equal(
    row(actionSource(ctx(), ""), "action:solo-right").detail,
    "⇧⌥⌘B",
  );
});

test("a query filters every source through the same matcher", () => {
  const matched = paletteMatches(ctx(), "palette");
  assert.deepEqual(ids(matched), ["worktree:wt-1"]);
});

test("the union is produced in source order: where you can go, then what you can do", () => {
  const all = ids(paletteMatches(ctx(), ""));
  assert.equal(all[0], "project:p1");
  assert.ok(all.indexOf("worktree:main:p1") > all.indexOf("project:landing"));
  assert.ok(all.indexOf("pane:diff") > all.indexOf("worktree:wt-1"));
  assert.ok(all.indexOf("action:new-worktree") > all.indexOf("pane:agent"));
});
