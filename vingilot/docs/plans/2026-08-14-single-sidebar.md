# One sidebar, contextual by view

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Branch:** `vingilot/single-sidebar` off `main`.
> **His ask, verbatim:** *"sidebar'in teke dusurulmesi. buzz'in kendi sidebar'ini
> bulundugumuz yere gore degismesii saglasak guzel olur. ust taraf sabit olur atiyorum
> project secilince alt tarafi degisir vs. bu sag pane'in sidebarini da buraya almamiz
> demek olacak. vscode gibisinden."*
> **Recon:** this plan is written off a same-day recon pass over
> `desktop/src/features/sidebar/ui/*`, `AppShell.*`, `desktop/src/features/runs/ui/*` and
> the two relevant e2e specs. Nothing in the recon was run or edited; every file/line
> citation below is from that read.

---

## 0. What exists, and the gap this closes

Two sidebars stand today, not one. `AppSidebar.tsx` (897 lines, `AppShell.tsx:734-797`)
mounts unconditionally beside every view — home, channel, messages, agents, workspace,
workflows, pulse, projects (Repos) all render the same fixed header, the same six-item
primary menu (`AppSidebarPrimaryMenu`, `AppSidebarPinnedHeader.tsx:98-221`), the same
channel/DM scroll list, and the same footer underneath them, whichever view is open.
Separately, the `workspace` view's own screen (`RunsScreen.tsx`) mounts a second,
independently-collapsible column, `WorkspaceNav.tsx` (607 lines) — the project + worktree
tree the 2026-08-11 one-column merge already unified into one 224px column with its own
rail and its own chord, **⇧⌘B**, distinct from `AppSidebar`'s own **⌘B**. Standing in the
workspace view today means looking at two sidebars at once: the app's, showing a channel
list that has nothing to do with where he is, and the workspace's own, showing the thing
he actually wants.

VS Code's model — a fixed Activity Bar plus one contextual tree under it that changes
with what is selected — already half-exists here: `channel`/`messages` views get a true
contextual lower region today, because the channel/DM list already lives inside
`AppSidebar`'s one scroll region. `workspace` has an equivalent tree, but it lives in a
sibling column instead of in that same slot. `agents`, `pulse`, `workflows` and `projects`
(the Repos browser) have no view-specific content at all — `AppSidebar` just keeps showing
the channel list underneath them, which answers nothing about where he is.

This plan absorbs `WorkspaceNav`'s tree into `AppSidebar`'s existing scroll region as a
contextual slot keyed on `selectedView`, gives the other four views an honest placeholder
in that same slot instead of a leftover channel list, and retires the now-redundant
`⇧⌘B` chord. It does not invent a new sidebar mechanism — `AppSidebar` already has the
fixed-top / scrollable-middle / fixed-footer shape this needs; the work is choosing what
the middle shows, per view, without rewriting the file that shape lives in.

---

## 1. The decisions, recorded once

### 1.1 The region model

Three regions, unchanged in count, one of them made to do more:

| Region | Today | After |
|---|---|---|
| **Fixed top** | `AppSidebarPinnedHeader` (search, ⌘K) + `AppSidebarPrimaryMenu` (the six destinations) | **Unchanged.** This is already the Activity Bar; it does not vary by view and should not start to. |
| **Contextual middle** | Only ever the channel/DM list (`SidebarContent`, `AppSidebar.tsx:497-755`), regardless of `selectedView` | **Switches on `selectedView`:** channel/messages keep today's list unchanged; workspace renders the tree `WorkspaceNav` owns today (absorbed, not rebuilt — §1.3); agents/pulse/workflows/projects get a named placeholder (§1.4) instead of the channel list bleeding through. |
| **Fixed footer** | `SidebarFooter` — relay card, update card, huddle control, profile card | **Unchanged.** Not in scope; nothing here reads or writes `selectedView`. |

`CommunityRail` (the far-left Discord-style rail, hidden with one community) is a fourth,
independent region mounted before `AppSidebar` at `AppShell.tsx:734` — it is not part of
this model and this plan does not touch it (§4).

### 1.2 The Deck decision — his call

The standing brief carries a tentative rename: the sidebar's own workspace entry, labelled
**"Projects"** in `AppSidebarPrimaryMenu` (`onSelectWorkspace`, `AppSidebarPinnedHeader.tsx:192-203`,
icon `SquareTerminal`), collides with upstream's own Projects entry two rows above it (the
Repos browser, `onSelectProjects`, icon `FolderGit2`, `AppSidebarPinnedHeader.tsx:157-170`) —
two menu items both readable as "Projects" one row apart. Recon found no blocker to the
rename and no other surface that depends on the string "Projects" meaning the fork's
workspace concept.

**Decision: yes, rename the label to "Deck".** Scope, exactly:

- Changes: the visible label text in `AppSidebarPrimaryMenu` only.
- Does not change: `selectedView`'s `"workspace"` member (all three copies of the union —
  `AppSidebar.types.ts:45-53`, `AppSidebarPinnedHeader.tsx:22-30`, `AppShell.helpers.ts:5-13`),
  the route `/workspace`, `onSelectWorkspace`, the test id `data-testid="open-workspace-view"`,
  the icon, or any internal variable, hook, or file name. `RunsScreen.tsx`'s own project-less
  landing state is already independently called "Deck" (`DeckPane`) — this rename does not
  touch that surface either; it is a separate, pre-existing "Deck" and this task does not
  merge the two concepts, only stop the label collision in the menu.
- This is his call, not a default: it is recorded here as HIS decision per the standing
  brief, not inferred. If he wants a different label than "Deck", replace it in the one
  place the label string lives — the rename is a one-line, low-risk task precisely because
  it is scoped this narrowly.

### 1.3 Migration strategy — mount into `AppSidebar`, do not rewrite it

`AppSidebar.tsx` is at 897 of a hard 1000-line ceiling with no override available
(`scripts/check-file-sizes.mjs`), and it is upstream's own growth surface — every line
rewritten in it is permanent merge friction, the exact cost the 231-commit merge already
proved out. The tradeoff, stated rather than assumed:

- **Chosen: a new fork-owned component, mounted into `AppSidebar`'s existing scroll
  region, dispatching on `selectedView`.** `AppSidebar.tsx` itself gains a small, bounded
  edit — gate today's channel/DM content behind `selectedView === "channel" ||
  selectedView === "messages"` (its natural condition, since that content answers only
  those two views) and render the new component in the `else` branch. That is an edit of
  perhaps a dozen lines in a file with no headroom, versus a rewrite of the file's
  structure to make it view-aware throughout.
- **Rejected: teaching `AppSidebar` itself the tree for every view.** That is the
  rewrite this plan is explicit about avoiding — it would grow the file past its ceiling
  immediately and scatter workspace-specific logic through an upstream file the fork must
  keep re-mergeable.
- **New file:** `desktop/src/features/sidebar/ui/SidebarContextualPane.tsx` (fork-owned,
  new — precedent already exists in this exact directory: `CommunityRail.tsx` is itself a
  fork addition living beside upstream's sidebar files). It owns the `selectedView` switch
  and, for `workspace`, mounts `WorkspaceNav` verbatim — moved, not rebuilt. Every prop,
  test id, dialog and behaviour §6 of `2026-08-11-one-column-design.md` ledgers for
  `WorkspaceNav` survives this move unchanged; only its mount point changes, from a sibling
  column inside `RunsScreen` to a slot inside `AppSidebar`.
- **The state this forces to move:** `WorkspaceNav` needs `selectedRepoId` /
  `selectedWorktreeId`, currently local `useState` in `RunsScreen.tsx:222-227`. Mounted
  inside `AppSidebar` — a sibling of `RunsScreen`'s outlet, not an ancestor or descendant of
  it — the tree can no longer read that state as a prop passed down from `RunsScreen`. This
  is new plumbing, unlike `selectedView` (already threaded end to end); it must be lifted
  to whatever both `AppSidebar` and `RunsScreen` can read without threading it through
  `AppShell`'s own props on every render. Task 2 below picks the mechanism; state it as a
  real cost now rather than discovering it mid-build.

### 1.4 What agents/pulse/workflows/projects show in v1

Recon found no existing contextual content for these four views — today they simply show
the channel list underneath them, which is not "nothing," it is a wrong answer standing in
for one. **v1 does not build new per-view trees for these four.** It replaces the
leftover channel list with a single, honest, named empty state — a placeholder that says
plainly "no sidebar detail for this view yet" (or a per-view line, if the strings are
already sitting somewhere convenient) rather than continuing to draw channels. This is a
bug fix wearing the same shape as the feature, not scope creep: showing nothing is strictly
more honest than showing something that misleads, and it costs one small component with no
new state, no new dialogs, no new tree logic. Building real contextual content for these
four views is explicitly **not** this plan's job — say so if asked, rather than quietly
scoping it in.

### 1.5 What does NOT change in v1 — the blast radius, kept honest

- **`CommunityRail`** — untouched. It is a separate region (§1.1) and is not folded into
  this model.
- **`SidebarDndContext` / custom-section drag-reorder** (`SidebarDnd.tsx`,
  `AppSidebar.tsx:562-671`) — untouched. It stays exactly where it is, inside the
  channel/messages branch of the contextual region. **`virtualization.spec.ts:146`**
  ("custom-section dnd reorder commits under content-visibility") is known red residue and
  sits squarely in this territory — this plan does not attempt to fix it, and if the DOM
  restructuring in Task 1 (gating the channel content behind a condition it did not have
  before) changes anything about that test's pass/fail state, that must be reported
  explicitly in Build, not silently absorbed either way.
- **`AppSidebarPinnedHeader`** (search) and **`SidebarFooter`** — untouched; neither reads
  `selectedView` and neither should start to for this plan.
- **`WorkSurface.tsx` / `paneRegistry.tsx`** (the content-pane picker, ⌃Tab) — unrelated
  surface, not touched.
- **`DeckPane`** (the project-less landing composer/triage screen) — unrelated to the Deck
  *label* decision in §1.2; not touched.
- **Route paths, `deriveShellRoute`, the router itself** — unchanged. `selectedView` is
  already threaded through `AppSidebarProps` end to end (`AppShell.tsx:885`); this plan
  reads it, it does not re-derive it.
- **`repos` (the `/projects` Repos browser view) content itself** — not inspected in depth
  by recon and not built here; it only gains the placeholder from §1.4 in the sidebar's
  lower region, nothing more.

---

## 2. Tasks

### Task 1 — The contextual pane, and gating `AppSidebar`'s existing content

- [ ] New file `desktop/src/features/sidebar/ui/SidebarContextualPane.tsx`: takes
      `selectedView` (and whatever `WorkspaceNav` needs, once Task 2 settles where that
      lives) and renders one of: nothing extra (channel/messages — handled by
      `AppSidebar` itself, not this component, per the bullet below), the absorbed
      workspace tree, or the named placeholder from §1.4.
- [ ] In `AppSidebar.tsx`, gate the existing `SidebarContent` channel/DM block
      (`:497-755` today) behind `selectedView === "channel" || selectedView === "messages"`
      and mount `<SidebarContextualPane selectedView={selectedView} … />` in the `else`
      branch. This is the only edit to `AppSidebar.tsx` this task makes — no other line in
      that file moves.
- [ ] Confirm `AppSidebar.tsx`'s line count after the edit; it has no headroom against the
      1000-line ceiling (`check-file-sizes.mjs`) and this edit must not need any.
- [ ] Red-proof: a spec asserting that switching `selectedView` away from
      channel/messages actually removes the channel list from the DOM (today it does not —
      it renders unconditionally). Prove this test fails against the current code before
      the gating lands, and passes after.

### Task 2 — Absorb `WorkspaceNav` into the contextual slot

- [ ] Move `WorkspaceNav`'s mount from `RunsScreen.tsx:806-839` into
      `SidebarContextualPane`'s `workspace` branch. Every prop, dialog, test id and
      behaviour in `2026-08-11-one-column-design.md` §6 survives verbatim — this is a
      relocation of the mount point, not a rebuild of the component.
- [ ] Lift `selectedRepoId` / `selectedWorktreeId` (and `selectRepo` / `selectLanding`,
      `RunsScreen.tsx:222-227`) out of `RunsScreen`'s local state into something both
      `AppSidebar` and `RunsScreen` can read — a small fork-owned hook/store
      (`useWorkspaceSelection.ts` or equivalent), not a prop threaded through `AppShell`
      on every render, and not a route/search-param unless a concrete reason for that
      shows up during the build. State which one was chosen and why in the same commit;
      do not leave it implicit.
- [ ] Retire `⇧⌘B`. With `WorkspaceNav` no longer a standalone column beside the work
      surface, there is nothing left for it to collapse independently — the whole
      workspace nav is now inside `AppSidebar`, which `⌘B` already toggles. Remove the
      chord binding, the `action:toggle-nav` palette row, its cheatsheet line
      (`column:toggle-column:column=nav`), and the corresponding `nav` flag in
      `columnLayout.ts` / `useColumns.ts`. State plainly, in the commit and here, that the
      per-project remembered collapse preference this flag held is discarded, not
      migrated — same reasoning `2026-08-11-one-column-design.md` §3 already used once for
      the equivalent v1→v2 storage discard: the safe direction is starting expanded, not
      preserving a stale preference for a mechanism that no longer exists.
- [ ] `RunsScreen.tsx`'s own layout after `WorkspaceNav` is removed from it: the work
      surface gains back the width the column gave up. Re-measure at his geometry
      (1728×1117, the number `workspace-diff-fits.spec.ts` and
      `workspace-one-column.spec.ts` already use) and update whichever width assertions
      moved — this is the same class of check the 2026-08-11 merge made, one level up.
- [ ] Re-run (do not skip) `workspace-columns.spec.ts`, `workspace-palette.spec.ts`,
      `workspace-no-coordinator.spec.ts`, `workspace-one-column.spec.ts`,
      `workspace-diff-fits.spec.ts` — the specs `2026-08-11-one-column-design.md` §6.8
      lists as the dense dependency on this exact markup. A test id surviving a move is
      the thing that proves the move is complete; report which, if any, needed a change
      versus which passed unchanged.

### Task 3 — The four placeholders

- [ ] For `agents`, `pulse`, `workflows`, `projects`: render the named "no sidebar detail
      for this view yet" placeholder from §1.4 in the contextual slot, replacing the
      leftover channel list. One small stateless component, no new dialogs, no new store.
- [ ] Red-proof: a spec per view (or one parametrised spec over the four) asserting the
      channel/DM list is *not* present when one of these views is selected — today it is,
      silently, and that silent presence is exactly the bug this task removes.

### Task 4 — The Deck rename

- [ ] Change the visible label in `AppSidebarPrimaryMenu` from "Projects" to "Deck" for
      the `onSelectWorkspace` entry only, per the scope in §1.2. Confirm by grep that no
      test asserts the literal string "Projects" against this specific menu item before
      changing it, and update the one that does if it exists.

### Task 5 — The seams fragment

- [ ] Create `vingilot/seams/single-sidebar.yaml`, following the existing fragment format
      (`vingilot/seams/home-harbor.yaml`, `vingilot/seams/the-crew.yaml` as models: header
      block naming the plan this fragment serves, then one entry per path). At minimum:
      - `desktop/src/features/sidebar/ui/SidebarContextualPane.tsx` — new, fork-owned.
      - `desktop/src/features/sidebar/ui/AppSidebar.tsx` — the gating edit from Task 1,
        with `removable_when` stated honestly (this one is likely never fully removable
        while the fork keeps a contextual model upstream doesn't have).
      - Whichever file ends up holding the lifted selection state (Task 2).
      - The retirement of `⇧⌘B` / `action:toggle-nav` — record as a deletion entry the
        same way `home-harbor.yaml` records a deleted upstream workflow, so a future
        upstream merge that reintroduces the chord is a decision, not a surprise.
      - `AppSidebarPinnedHeader.tsx` — the Deck label change (Task 4).
      - Register it with the glob mechanism (`vingilot/scripts/lib/seam-glob.sh` already
        globs fragments; confirm no script needs a manual update to pick up the new file).

---

## 3. Global Constraints

- **Only one mutating lens** — this Plan document is the only file this session writes;
  Build is the phase that touches code. Do not commit or push from Plan.
- **`rm -rf` forbidden**, any path.
- **Never launch the app, never run a release build.**
- **1000-line ratchet: split, never raise.** `AppSidebar.tsx` has no headroom — if Task 1's
  edit does not fit, split before raising, never raise.
- **Island + seams discipline.** `AppSidebar.tsx` and `AppSidebarPinnedHeader.tsx` are
  upstream-owned files; every touch to them needs a true, specific seam entry, not a
  blanket one. New fork-owned files need entries too.
- **Chord discipline.** No new chord is introduced here — `⇧⌘B` is retired, not
  reassigned. If a future need wants it back, that is a new decision, not this one.
- **rem tokens only** for any new text; `pnpm check:px-text` is the gate.
- **An empty read is "no answer," never "nothing there."** This is the exact bug Task 3
  removes (a channel list standing in for "no content"); do not reintroduce the same shape
  elsewhere in the placeholder's own implementation (e.g. it must not look like a channel
  list with nothing in it).
- **A test must be able to fail.** Every red-proof above must be shown red before the
  fix, then green after, and that sequence reported, not asserted.
- **Known red residue, not this plan's to fix:** composer block-format caret, own-message
  avatar, huddle voice menu, video speed menu, **sidebar section reorder
  (`virtualization.spec.ts:146` — this plan's territory; see §1.5)**, boot-mark light
  theme, workspace-find/search, `channels:2736`, community-rail flakes, relay-reconnect
  flakes.
- **Gates to real exit codes.** Never bare `biome`. `desktop/`: `pnpm biome check --write
  src`, `pnpm check:px-text`, `pnpm test`, `pnpm tsc --noEmit`. E2E:
  `pnpm test:e2e:smoke` — kill port 4173 first, no concurrent builds, build with
  `pnpm build:e2e` never plain `pnpm run build`. Repo root: `./vingilot/scripts/check-seams.sh`.
- **No commit stamped inside 08:00–18:00 Europe/Istanbul** — set `GIT_AUTHOR_DATE` /
  `GIT_COMMITTER_DATE` explicitly.
- **Never `git add -A`** on this branch; audit the file list before every push.

---

## 4. Self-Review

**Riskiest:** the state lift in Task 2. Moving `selectedRepoId`/`selectedWorktreeId` out of
`RunsScreen`'s local `useState` into shared state touched by two independently-mounted
trees (`AppSidebar` and `RunsScreen`'s own outlet) is exactly the kind of change that can
silently desync — a selection made from the sidebar's tree that the work surface does not
see, or vice versa, on some render ordering neither tree's author anticipated in isolation.
This is not a hypothetical: `RunsScreen`'s auto-select effect (`:420-425`) already depends on
`selectedRepoId` changing in a particular order relative to `selectedWorktreeId`, and
whatever mechanism replaces the local `useState` must preserve that ordering exactly, not
just the values. If the chosen mechanism cannot be shown to preserve it under a red-proof
test that changes project and asserts the auto-selected worktree is still correct, this
task is not done regardless of how the sidebar looks.

**Most likely to be got wrong quietly:** Task 3's placeholders being mistaken for done once
they compile. A placeholder that merely fails to render the channel list (e.g. because a
condition is now simply false, with nothing rendered in its place) satisfies "the channel
list is gone" without satisfying "something honest is here instead" — an empty `<div/>` and
a real "no sidebar detail yet" message are indistinguishable to a test that only checks
absence of channels. The red-proof in Task 3 must assert the *presence* of the named
placeholder, not only the *absence* of the old content, or this regresses to exactly the
"empty read standing in for nothing there" failure this plan otherwise corrects.

**Third, worth naming rather than assuming away:** `virtualization.spec.ts:146` sits inside
the exact region this plan restructures (the channel/messages branch of the newly-gated
content). Task 1's conditional render is a DOM shape change even though it changes no
markup for the channel/messages case itself — a component that goes from "always mounted"
to "mounted behind a condition that happens to always be true in that spec's setup" can
still change React's reconciliation behavior in ways `content-visibility` assumptions are
sensitive to. Build must run this spec before and after Task 1 specifically, not only at
the end of all five tasks, so a change here is attributed to the task that caused it.
