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
    id: "diff",
    title: "Diff",
  },
  {
    availability: { reason: "no ACP harness here.", status: "unavailable" },
    id: "agent",
    title: "Agent",
  },
];

function ctx(overrides = {}) {
  return {
    navCollapsed: false,
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

// Replaces "the worktree column cannot be toggled where there is not one".
// That row was blocked on the landing view because the column it hid held one
// project's worktrees; the merged nav holds the project list, so it is on
// screen there too and the condition it was guarding cannot occur
// (vingilot/docs/plans/2026-08-11-one-column-design.md, §7.4).
test("the nav toggle is never blocked — the landing view has a nav too", () => {
  const landing = ctx({ selectedRepoId: null, selectedWorktreeId: null });
  assert.equal(
    row(actionSource(landing, ""), "action:toggle-nav").blocked,
    null,
  );
  assert.equal(row(actionSource(ctx(), ""), "action:toggle-nav").blocked, null);
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
    row(actionSource(ctx({ navCollapsed: true }), ""), "action:toggle-nav")
      .label,
    "Show the projects",
  );
  assert.equal(
    row(actionSource(ctx(), ""), "action:toggle-nav").label,
    "Hide the projects",
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

test("an action carries the chord that already does it, in its own field", () => {
  const actions = actionSource(ctx(), "");
  assert.equal(row(actions, "action:new-terminal-tab").chord, "⌘T");
  assert.equal(row(actions, "action:scratch-terminal").chord, "⌥⌘T");
  assert.equal(row(actions, "action:toggle-sidebar").chord, "⌘B");
  assert.equal(row(actions, "action:toggle-nav").chord, "⇧⌘B");
  assert.equal(row(actions, "action:solo-left").chord, "⌥⌘B");
  assert.equal(row(actions, "action:solo-right").chord, "⇧⌥⌘B");
  // An action nothing is bound to says nothing rather than borrowing one.
  assert.equal(row(actions, "action:add-project").chord, null);
});

test("no chord is left buried in a detail line", () => {
  // The chord had been a suffix on `detail` — matched as prose, wrapped with
  // it, and read last. Every source is checked, not just the actions, because
  // this is the shape the next row would copy.
  const glyphs = /[⌘⌥⇧⌃]/;
  for (const match of paletteMatches(ctx(), "")) {
    assert.equal(
      glyphs.test(match.candidate.detail),
      false,
      `${match.candidate.id} still carries a chord in its detail: ${match.candidate.detail}`,
    );
  }
});

test("a worktree carries the digit that already selects it, up to nine", () => {
  // ⌘1…⌘9 index into the same array this source is handed
  // (`terminalKeys.ts`'s switch-worktree, applied in `WorkSurface.tsx`), so
  // the row's place in the list is the digit.
  const many = ctx({
    worktrees: Array.from({ length: 10 }, (_, n) => worktree(`wt-${n}`)),
  });
  const matches = worktreeSource(many, "");
  assert.equal(row(matches, "worktree:wt-0").chord, "⌘1");
  assert.equal(row(matches, "worktree:wt-8").chord, "⌘9");
  // There is no ⌘10, so the tenth row claims nothing.
  assert.equal(row(matches, "worktree:wt-9").chord, null);
});

test("a query filters every source through the same matcher", () => {
  const matched = paletteMatches(ctx(), "palette");
  // Two sources, one matcher: the `vingilot/palette` branch by its label, and
  // the sidebar toggle because its detail line happens to carry the letters in
  // order. The second is the subsequence matcher working, not a bug — what is
  // under test is that every source went through it, and a match from two of
  // them says that more plainly than a match from one.
  assert.deepEqual(ids(matched), ["worktree:wt-1", "action:toggle-sidebar"]);
});

test("the union is produced in source order: where you can go, then what you can do", () => {
  const all = ids(paletteMatches(ctx(), ""));
  assert.equal(all[0], "project:p1");
  assert.ok(all.indexOf("worktree:main:p1") > all.indexOf("project:landing"));
  assert.ok(all.indexOf("pane:diff") > all.indexOf("worktree:wt-1"));
  assert.ok(all.indexOf("action:new-worktree") > all.indexOf("pane:agent"));
});
