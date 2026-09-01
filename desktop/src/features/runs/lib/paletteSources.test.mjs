import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionSource,
  appSource,
  channelSource,
  crewSource,
  paletteMatches,
  paneSource,
  projectSource,
  recentFileSource,
  sourceIdsForMode,
  sourcesForMode,
  worktreeFileSource,
  worktreeSource,
} from "./paletteSources.ts";
import { rankMatches } from "./paletteModel.ts";

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
    openFile: null,
    paneChoices: PANES,
    prunable: 0,
    repos: REPOS,
    selectedRepoId: "p1",
    selectedWorktreeId: "main:p1",
    shim: null,
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

// The nav toggle row (`action:toggle-nav`, ⇧⌘B) is retired with the second
// sidebar it used to hide (vingilot/docs/plans/2026-08-14-single-sidebar.md,
// Task 2): the workspace nav renders inside the app sidebar now, which
// `action:toggle-sidebar` already moves. A retired row must be gone, not
// blocked — a blocked row is a sentence about a thing that still exists.
test("the retired nav toggle is not a row at all", () => {
  const landing = ctx({ selectedRepoId: null, selectedWorktreeId: null });
  for (const context of [landing, ctx()]) {
    assert.equal(
      actionSource(context, "").some((r) => r.id === "action:toggle-nav"),
      false,
    );
  }
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

test("an action carries the chord that already does it, in its own field", () => {
  const actions = actionSource(ctx(), "");
  // ⌘T belongs to the task now (redesign P2, `terminalKeys.ts`); the
  // new-tab row keeps its door and loses the chord it no longer has.
  assert.equal(row(actions, "action:new-task").chord, "⌘T");
  assert.equal(row(actions, "action:new-terminal-tab").chord, null);
  assert.equal(row(actions, "action:split-terminal-right").chord, "⌘D");
  assert.equal(row(actions, "action:split-terminal-down").chord, "⇧⌘D");
  assert.equal(row(actions, "action:close-terminal-split").chord, null);
  assert.equal(row(actions, "action:scratch-terminal").chord, "⌥⌘T");
  assert.equal(row(actions, "action:toggle-sidebar").chord, "⌘B");
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

test("both rename rows are drawn whatever the focused tab is, and the terminal one refuses in the reading's own words", () => {
  // A blocked row is drawn and refuses; it never disappears
  // (`CommandPalette.tsx`). So the three readings below are three sentences
  // on the same row, not a row that comes and goes.
  const drawn = (context) => ids(actionSource(context, ""));
  const shell = { kind: "terminal", n: 2 };
  const reading = { kind: "view", n: 1 };

  for (const focusedTab of [null, shell, reading]) {
    const listed = drawn(ctx({ focusedTab }));
    assert.ok(listed.includes("action:rename-terminal-tab"));
    assert.ok(listed.includes("action:rename-task"));
  }

  // The sentence is `tabMenu.ts`'s `renameRefusal`, read here rather than
  // written again — the menu's silence and this row's refusal are one rule.
  assert.equal(
    row(
      actionSource(ctx({ focusedTab: shell }), ""),
      "action:rename-terminal-tab",
    ).blocked,
    null,
  );
  assert.equal(
    row(
      actionSource(ctx({ focusedTab: null }), ""),
      "action:rename-terminal-tab",
    ).blocked,
    "no tab is focused, so there is nothing to rename.",
  );
  assert.equal(
    row(
      actionSource(ctx({ focusedTab: reading }), ""),
      "action:rename-terminal-tab",
    ).blocked,
    "this tab is a reading, and its name is what it shows — rename the file, not the tab.",
  );
});

test("with no worktree open there is nothing to rename, and both rows say so before they ask about tabs", () => {
  const none = ctx({ focusedTab: null, selectedWorktreeId: null });
  assert.equal(
    row(actionSource(none, ""), "action:rename-terminal-tab").blocked,
    "no worktree is open, so there is no terminal to rename.",
  );
  assert.equal(
    row(actionSource(none, ""), "action:rename-task").blocked,
    "no worktree is open, so there is no task to rename.",
  );
});

test("neither rename row claims a chord, because a rename is not fired blind", () => {
  const found = actionSource(
    ctx({ focusedTab: { kind: "terminal", n: 1 } }),
    "",
  );
  assert.equal(row(found, "action:rename-terminal-tab").chord, null);
  assert.equal(row(found, "action:rename-task").chord, null);
  assert.deepEqual(row(found, "action:rename-terminal-tab").command, {
    type: "rename-terminal-tab",
  });
  assert.deepEqual(row(found, "action:rename-task").command, {
    type: "rename-task",
  });
});

test("a query filters every source through the same matcher", () => {
  const matched = paletteMatches(ctx(), "palette");
  // Two sources, one matcher: the `vingilot/palette` branch by its label, and
  // three action rows because their prose happens to carry the letters in
  // order ("Put a cAret on the chip hoLding this tErminal — the sTrip above
  // the Tabs", "cLose the sPlit hALf...The Tab...", and the sidebar toggle's
  // detail). The extras are the subsequence matcher working, not a bug —
  // what is under test is that every source went through it, and a match
  // from two sources says that more plainly than a match from one.
  assert.deepEqual(ids(matched), [
    "worktree:wt-1",
    "action:rename-task",
    "action:close-terminal-split",
    "action:toggle-sidebar",
  ]);
});

test("the union is produced in source order: where you can go, then what you can do", () => {
  const all = ids(paletteMatches(ctx(), ""));
  assert.equal(all[0], "project:p1");
  assert.ok(all.indexOf("worktree:main:p1") > all.indexOf("project:landing"));
  assert.ok(all.indexOf("pane:diff") > all.indexOf("worktree:wt-1"));
  assert.ok(all.indexOf("action:new-worktree") > all.indexOf("pane:agent"));
});

test("the escape hatch's row is blocked on the FILE, not on the pane", () => {
  // The pane can be on screen with nothing in it — that is its own designed
  // empty state — and this row acts on a file:line. Blocking on the pane would
  // offer a door onto nothing.
  const shut = row(actionSource(ctx(), ""), "action:open-in-editor");
  assert.match(shut.blocked, /no file is open in the viewer/);
  // And the sentence says where the other doors are, because they are the ones
  // that work right now.
  assert.match(shut.blocked, /search hit|changed file/);

  const open = row(
    actionSource(ctx({ openFile: "src/main.rs" }), ""),
    "action:open-in-editor",
  );
  assert.equal(open.blocked, null);
  // The detail names the file, so Enter is a promise about which one.
  assert.match(open.detail, /src\/main\.rs/);
});

test("installing the shell command needs nothing and is never automatic", () => {
  // Needs no project and no worktree. Never automatic: the whole reason it is
  // a row is that it writes outside this app's own directories, which is the
  // owner's decision (ADR-003).
  const install = row(actionSource(ctx(), ""), "action:install-shim");
  assert.equal(install.blocked, null);
  assert.equal(install.chord, null);
  assert.match(install.label, /Install vingilot command…/);
  // The detail says both halves: what it does outside, and what already works
  // inside.
  assert.match(install.detail, /\/usr\/local\/bin/);
  assert.match(install.detail, /this app's own terminals already have it/);
});

test("the shell command's row reads the disk before it offers to install", () => {
  const status = {
    linkPath: "/usr/local/bin/vingilot",
    linked: true,
    shimPath: "/Users/me/.vingilot/bin/vingilot",
  };

  // Linked: the label is a statement, not an offer, and the row is blocked for
  // the reason "nothing to prune" is — the work it names has been done.
  const done = row(
    actionSource(ctx({ shim: status }), ""),
    "action:install-shim",
  );
  assert.match(done.label, /vingilot command installed/);
  assert.doesNotMatch(done.label, /Install/);
  // Both ends of the link, in the sentence rather than the detail: a blocked
  // row shows its reason INSTEAD of its detail, so this is the only line the
  // owner can check "installed" against.
  assert.match(done.blocked, /\/usr\/local\/bin\/vingilot/);
  assert.match(done.blocked, /\/Users\/me\/\.vingilot\/bin\/vingilot/);
  assert.match(done.blocked, /nothing left to install/);

  // Not linked, and not yet known, are the same row: a status that has not
  // answered must never be read as "installed".
  for (const shim of [{ ...status, linked: false }, null]) {
    const offer = row(actionSource(ctx({ shim }), ""), "action:install-shim");
    assert.match(offer.label, /Install vingilot command…/);
    assert.equal(offer.blocked, null);
  }
});

// ---------------------------------------------------------------------------
// The three doors' new sources (vingilot/docs/plans/
// 2026-08-12-an-ide-of-a-kind.md, Task 2).
// ---------------------------------------------------------------------------

const CHANNELS = [
  { dm: false, id: "c-general", name: "general", topic: "everything else" },
  { dm: false, id: "c-eng", name: "engineering", topic: null },
  { dm: true, id: "c-alice", name: "alice", topic: null },
];

const FILES = [
  { line: 12, path: "src/main.rs", worktree: "/w" },
  { line: null, path: "src/features/runs/lib/paletteModel.ts", worktree: "/w" },
];

test("a channel keeps its hash and a direct message keeps its person", () => {
  // Both are how this app writes them everywhere else; a palette that renamed
  // them would be a second vocabulary for one set of places.
  const found = channelSource(ctx({ channels: CHANNELS }), "");
  assert.deepEqual(ids(found), [
    "channel:c-general",
    "channel:c-eng",
    "channel:c-alice",
  ]);
  assert.equal(row(found, "channel:c-general").label, "#general");
  assert.equal(row(found, "channel:c-alice").label, "alice");
});

test("a channel row goes where upstream's switcher would have gone", () => {
  // "gineer" rather than "eng": the looser query also finds #general through
  // its topic line, which is the matcher working and not this row.
  const found = channelSource(ctx({ channels: CHANNELS }), "gineer");
  assert.deepEqual(ids(found), ["channel:c-eng"]);
  assert.deepEqual(found[0].candidate.command, {
    channelId: "c-eng",
    type: "open-channel",
  });
});

test("a channel's topic is its second line, and a channel without one still says what it is", () => {
  const found = channelSource(ctx({ channels: CHANNELS }), "");
  assert.equal(row(found, "channel:c-general").detail, "everything else");
  assert.equal(
    row(found, "channel:c-eng").detail,
    "a channel in this community",
  );
  assert.equal(row(found, "channel:c-alice").detail, "a direct message");
});

test("a host with no channel list draws no channel rows", () => {
  assert.deepEqual(channelSource(ctx(), ""), []);
});

test("a file is matched by its name first and its path second", () => {
  // Asserted on the BEST row rather than on the only one: the matcher will find
  // a subsequence of "main.rs" in any long enough path, and that is the
  // matcher working. What this test is about is which field won.
  const byName = rankMatches(
    recentFileSource(ctx({ recentFiles: FILES }), "main.rs"),
    [],
  );
  assert.equal(byName[0].candidate.id, "file:/w\u0000src/main.rs");
  assert.equal(byName[0].field, "label");

  const byPath = rankMatches(
    recentFileSource(ctx({ recentFiles: FILES }), "features/runs"),
    [],
  );
  assert.equal(
    byPath[0].candidate.id,
    "file:/w\u0000src/features/runs/lib/paletteModel.ts",
  );
  assert.equal(byPath[0].field, "detail");
});

test("a file row carries the worktree, the path and the line it left off at", () => {
  const found = recentFileSource(ctx({ recentFiles: FILES }), "main.rs");
  assert.deepEqual(found[0].candidate.command, {
    line: 12,
    path: "src/main.rs",
    type: "open-file",
    worktree: "/w",
  });
});

test("a file id is scoped by its checkout", () => {
  // Two checkouts of one project both have src/main.rs, and the id is what a
  // recent is recorded as — an unscoped one would hand the wrong file's row
  // yesterday's recency.
  const two = recentFileSource(
    ctx({
      recentFiles: [
        { line: null, path: "src/main.rs", worktree: "/a" },
        { line: null, path: "src/main.rs", worktree: "/b" },
      ],
    }),
    "main",
  );
  assert.equal(new Set(ids(two)).size, 2);
});

test("the two file sources are the same rows from different lists", () => {
  const one = { line: null, path: "src/main.rs", worktree: "/w" };
  assert.deepEqual(
    ids(recentFileSource(ctx({ recentFiles: [one] }), "")),
    ids(worktreeFileSource(ctx({ worktreeFiles: [one] }), "")),
  );
  // And neither reads the other's list — the front door must not list a
  // checkout's whole tree.
  assert.deepEqual(worktreeFileSource(ctx({ recentFiles: [one] }), ""), []);
});

// ── The crew (vingilot/docs/plans/2026-08-12-the-crew.md, Task 3) ────────────

/** One `crewReach.ts` row, as the host hands it down. */
const LOOKOUT_ROW = {
  berth: "thread",
  blocked: null,
  channelId: "channel-1",
  detail: "an adversarial read of what is about to land here",
  label: "Have Lookout review this worktree",
  message: "@Lookout review what is in the-crew. ",
  personaId: "builtin:lookout",
  pubkey: "a".repeat(64),
};

test("crewSource: a workspace with no crew has no crew rows", () => {
  assert.deepEqual(crewSource(ctx(), ""), []);
  assert.deepEqual(crewSource(ctx({ crew: [] }), ""), []);
});

test("crewSource: a minted member is one row, addressed by the command", () => {
  const [match] = crewSource(ctx({ crew: [LOOKOUT_ROW] }), "");
  assert.equal(match.candidate.label, "Have Lookout review this worktree");
  assert.equal(match.candidate.id, "crew:builtin:lookout");
  assert.deepEqual(match.candidate.command, {
    personaId: "builtin:lookout",
    type: "reach-crew",
  });
  assert.equal(match.candidate.blocked, null);
});

test("crewSource: the row is findable by the verb, not only by the name", () => {
  const rows = crewSource(ctx({ crew: [LOOKOUT_ROW] }), "review");
  assert.equal(rows.length, 1);
});

test("crewSource: a member with nowhere to be reached is still a row, carrying why", () => {
  const [match] = crewSource(
    ctx({
      crew: [{ ...LOOKOUT_ROW, blocked: "no thread yet.", channelId: null }],
    }),
    "",
  );
  assert.equal(match.candidate.blocked, "no thread yet.");
});

test("crewSource: crew rows rank in the same one ranking as everything else", () => {
  const ranked = rankMatches(
    paletteMatches(ctx({ crew: [LOOKOUT_ROW] }), "review"),
    [],
  );
  assert.ok(ranked.length > 0);
  assert.equal(ranked[0].candidate.id, "crew:builtin:lookout");
});

test("a mode asks its own sources, and a host narrows them", () => {
  assert.deepEqual(sourceIdsForMode("go"), [
    "projects",
    "worktrees",
    "channels",
    "recent-files",
    "panes",
    "crew",
    "actions",
    "app",
  ]);
  // What the shell can honestly answer for: no work surface, so no pane and no
  // action.
  assert.deepEqual(
    sourceIdsForMode("go", [
      "channels",
      "projects",
      "worktrees",
      "recent-files",
      "app",
    ]),
    ["projects", "worktrees", "channels", "recent-files", "app"],
  );
  // And the door that offers nothing here is the one that must fall through.
  assert.deepEqual(sourceIdsForMode("files", ["channels", "projects"]), []);
});

test("the commands door is the panes, the actions and the app rows", () => {
  const held = ctx();
  const commands = paletteMatches(held, "", sourcesForMode("commands"));
  assert.deepEqual(
    ids(commands),
    ids([
      ...paneSource(held, ""),
      ...actionSource(held, ""),
      ...appSource(held, ""),
    ]),
  );
});

test("appSource: the Appearance door is offered everywhere and never blocked", () => {
  const [row] = appSource(ctx(), "appear");
  assert.equal(row.candidate.id, "app:appearance");
  assert.equal(row.candidate.blocked, null);
  assert.deepEqual(row.candidate.command, { type: "open-appearance" });
});
