# One column — the design

> Implements Task 1 of `2026-08-11-one-column-and-loose-ends.md`. This document is the
> specification; the plan is the mandate. Where they disagree, this document is wrong.
>
> **Written for an implementer who has not read the surveys.** Everything the two current
> components carry is enumerated in §6 with a destination. Anything not written here was not
> decided here — do not invent it, ask.

---

## 0. The decision, once

`ProjectsNav` (192px) and `WorktreeColumn` (224px) become **one column, 224px wide, holding a
two-level tree**. Projects are the rows. The selected project's worktrees disclose underneath it,
indented, in the same scroll container, with no border and no box of their own.

It is a tree, not a drill-in. There is no back button, because you never left. Every project row
stays on screen with its rollup attention dot while you work inside one of them — this workspace
runs agents in several worktrees across several projects at once, and the dots on the *other*
projects are the whole triage story. A drill-in view hides them; that is why this is not one.

Elegance here has a definition, and it is the acceptance test for every sub-decision below:

- **one border, one scroll container** where there were two;
- **no nested chrome** — the disclosure has no header, no border, no background, no card;
- **indentation is the only hierarchy cue** — no guide lines, no chevrons, no rails inside rails;
- **nothing moves that does not have to** — no enter animation, no re-sorting project rows, no
  layout that shifts when a stat arrives.

---

## 1. The component shape

### 1.1 Files after this change

| File | Lines (budget) | Owns |
|---|---|---|
| `desktop/src/features/runs/ui/WorkspaceNav.tsx` | ~260 | The column itself: container, collapsed rail, Deck row, `Projects` eyebrow + collapse button, the four project notices, the project `<ul>`, `+ Add project`, **and all four dialogs**. |
| `desktop/src/features/runs/ui/ProjectRow.tsx` | ~120 | One project `<li>`: the row button, its rollup dot, its remove `×`, and — when this project is the selected one — the disclosure mounted beneath it. |
| `desktop/src/features/runs/ui/WorktreeDisclosure.tsx` | ~240 | The disclosed subtree: filter box, worktree `<ul>`, fold row, filtered-out count, `+ New worktree`, `Prune…`, the refusal panel. Owns `query` and `expanded`. |
| `desktop/src/features/runs/ui/WorktreeRow.tsx` | ~110 | One worktree `<li>`: dot, label, ⌘N hint, detail line, remove `×`. |

**Deleted:** `ui/ProjectsNav.tsx`, `ui/WorktreeColumn.tsx`.

The split is named up front for the reason the brief gives: one component holding 450 lines of two
merged columns crosses the 1000-line ceiling the moment anyone touches it again, and the ceiling is
enforced (`scripts/check-file-sizes.mjs`) with no override available. Each of the four files above
is under a third of the budget with the whole merge in it.

The split lines are not arbitrary — they are the two places the tree branches. `WorkspaceNav` is the
column. `ProjectRow` is a row that may have children. `WorktreeDisclosure` is the children.
`WorktreeRow` is a child. A future change lands in exactly one of them.

### 1.2 Where every line comes from

| New file | From `ProjectsNav` | From `WorktreeColumn` | New |
|---|---|---|---|
| `WorkspaceNav.tsx` | container (:107-110), Deck row (:111-122), eyebrow (:124-127), store notice (:129-136), empty state (:138-147), `<ul>` (:149), `+ Add project` (:189-197), import notice (:199-214), coordinator notice (:216-223), error panel (:225-240), remove-project confirm (:242-266) | `CollapsedRail` (:126-158), collapse `‹` (:225-234), `NewWorktreeDialog` mount (:401-409), `PruneWorktreesDialog` mount (:411-419), remove-worktree confirm (:421-445), the `confirming` state (:177) | the rail's per-project dot stack |
| `ProjectRow.tsx` | row `<li>` + button (:153-171), selected styling (:155-159), title (:162-166), dot (:151,169), remove `×` (:172-182) | — | mounts `WorktreeDisclosure` when selected |
| `WorktreeDisclosure.tsx` | — | filter (:237-247), empty state (:249-252), `<ul>` (:254), `view` derivation (:196-202), `prunable` (:203), fold row (:326-340), filtered-out (:342-346), `+ New worktree` (:348-356), `Prune…` (:358-369), refusal panel (:371-397) | `sr-only <h3>` naming the disclosed project |
| `WorktreeRow.tsx` | — | row `<li>` + button (:262-306), dot (:282), label (:283-287), ⌘N hint (:288-292), detail (:294-304), remove `×` (:307-319) | — |

Nothing in the two current files is unaccounted for. §6 is the line-by-line ledger.

### 1.3 State ownership

Unchanged where it can be: **selection still lives in `RunsScreen`** (`selectedRepoId`,
`selectedWorktreeId`, `selectRepo`, `selectLanding`), and the merge changes no state ownership at
the screen level. Three notes:

- **`confirming` (the remove-worktree target) moves up from `WorktreeColumn` into `WorkspaceNav`.**
  It has to: its dialog must stay mounted when the column collapses, and `WorktreeDisclosure`
  unmounts on collapse. `WorkspaceNav` renders in both states, so it is the lowest component that
  can hold it. It is **not** lifted to `RunsScreen` — the palette is not a second door to
  remove-worktree, so there is no one-dialog-two-doors reason, and lifting state without one is how
  `RunsScreen` grows.
- **`query` and `expanded` move up to `WorkspaceNav`, passed down as props.** *(Corrected
  2026-08-11 — this section first said they stay local to `WorktreeDisclosure`, and that was
  wrong for the same reason `confirming` had to move: the disclosure renders only in the
  expanded branch, so ⇧⌘B destroys anything it holds. `WorktreeColumn` was itself the component
  that chose between rail and column, so the two-column build kept the filter and the fold
  across a collapse; keeping them in the disclosure silently shortened their lifetime from
  "until you switch project" to "until you press ⇧⌘B". `WorkspaceNav` is the lowest component
  that renders in both states, which is the same argument, applied to the same boundary.)*
- **The render-phase `scope` reset (`WorktreeColumn.tsx:189-194`) moves to `WorkspaceNav`,
  keyed on `selectedRepoId`.** *(Corrected 2026-08-11 — it was to be replaced by
  `key={repo.id}` on `<WorktreeDisclosure>`, which is only a reset while the state being reset
  lives inside the disclosure. With the state lifted, the reset is the three lines it always
  was, verbatim from `WorktreeColumn`: `if (scope !== selectedRepoId) { setScope(…);
  setQuery(""); setExpanded(false); }`. Same guarantee, and now the only mechanism — the `key`
  is dropped as redundant, since `ProjectRow`'s own `key={repo.id}` already unmounts the
  disclosure on a project switch.)* A project switch clears the filter and the fold during the
  render that brought the new project in, so the column is never painted showing the previous
  project's filter. **A ⇧⌘B collapse clears neither**, and both halves are asserted in
  `workspace-one-column.spec.ts`.

### 1.4 Props of `WorkspaceNav`

Flat, alphabetical, exactly as both current components declare theirs. The union is 28 props. That
is a lot and it is still the right shape: bundling them into `projects={{…}}` / `worktrees={{…}}`
objects would build a fresh object every render for no consumer that memoises. Do not bundle them
in this change.

Two props deserve naming discipline, because conflating them silently blanks every dot:

```
repoMarks:     Readonly<Record<string, AttentionMark>>   // signals.byRepo     — a Record
worktreeMarks: ReadonlyMap<string, AttentionMark>        // signals.byWorktree — a Map
```

`repoMarks[id] ?? NO_MARK` on a project row; `worktreeMarks.get(id) ?? NO_MARK` on a worktree row.
Both come from the single `useMemo` in `useWorktreeSignals.ts:124-148` — the merged column reads
both and **recomputes neither**. A second derivation is how two dots come to disagree about the same
worktree.

`repo: Repo` becomes `selectedRepo: Repo | null`, because the column now renders on the landing view
as well. Everything that needed a non-null `Repo` (`removableWorktree`, the filter's aria-label, the
sr-only heading) lives inside `WorktreeDisclosure`, which only mounts with one.

### 1.5 The two test-id anchors, and why they both survive on one column

`data-testid="projects-nav"` has 49 references and `data-testid="worktree-column"` has 22. Both stay,
on different elements of the one column:

- **`projects-nav`** — the outer column container (and, when collapsed, nothing; the rail keeps its
  own id, below).
- **`worktree-column`** — the `<section>` that is the *disclosed subtree of the selected project*.
  It is a descendant of `projects-nav` now instead of its sibling. Every existing assertion still
  means what it said: it is visible exactly when a project is open and the column is not a rail; it
  is hidden by ⇧⌘B; it contains the `worktree-row-*` buttons.

`workspace-palette.spec.ts:226-229` and `:259-262` do
`getByTestId("worktree-column").getByRole("heading")` and assert the **project's name**. That is a
hard contract and it is met by an `sr-only <h3>{repo.name}</h3>` as the first child of the section.
It is not decoration: the disclosed group needs an accessible name, and the visual one — the project
row two pixels above it — is not inside the group. It must be the *only* heading in that section, or
the locator goes strict-mode-ambiguous and both palette tests fail. **The `Projects` eyebrow is an
`<h2>` and it lives in `WorkspaceNav`, outside the section.** Keep it there.

> Renaming test ids buys nothing and costs five guarded assertions. `worktree-column-rail`,
> `worktree-column-expand` and `worktree-column-collapse` keep their literal strings even though the
> things they name are now the whole column's. Test ids are a test vocabulary, not a description of
> the DOM. Each new file's header comment says what its ids now name.

---

## 2. The tree's behaviour, exactly

### 2.1 Selecting a project and expanding it are the same gesture

**This is the decision most likely to be got wrong, so it is stated first and without hedging.**

There is exactly one disclosure and it belongs to the selected project. Clicking a project row
selects it, which discloses its worktrees. There is no per-project chevron, no independent
expand/collapse, no second project open at the same time.

Two reasons, both load-bearing:

1. **Only the selected project has worktrees worth drawing.** `signals.ordered` is the selected
   project's slice alone (`useWorktreeSignals.ts:97-98`). It is the array `orderWorktrees` sorted, the
   array `WorkSurface` indexes for ⌘1…9, and the array the palette derives its ⌘N chords from. A
   non-selected project's worktrees exist only in `grouped.byRepo`, unordered, with no digit, and —
   past the backend's 64-path stat cap — often with no stat at all. Disclosing them would draw rows
   that look identical to real ones and answer fewer questions. **The merge does not start reading
   `grouped.byRepo`.** `signals.ordered` remains the only worktree array the nav sees, and the
   `unknown` bucket in `projects.ts:229-242` stays exactly as unrendered as it is today.
2. **Four states where the owner wanted two.** An independent toggle produces
   selected-but-collapsed — the row you are standing in, hiding its own contents — which is a state
   nobody asked for and which the auto-select effect (`RunsScreen.tsx:420-425`) would immediately
   contradict by selecting a worktree inside it.

**Clicking the already-selected project row does not collapse it.** It is a no-op for selection and
for disclosure. The one gesture that hides worktrees is ⇧⌘B, which hides the whole column; the one
gesture that shortens the disclosed list is the existing quiet-rows fold.

That no-op is **not free, and it is not this component's** — `selectRepo` has to enforce it.
`RunsScreen.selectRepo` clears `selectedWorktreeId` so that the auto-select effect lands the owner
on the primary checkout of the project he just entered; run unguarded on the project he is *already*
in, that same line throws away the worktree he has open and bounces him to `main`. So
`selectRepo` begins `if (id === selectedRepoId) return;`. This closes all three doors onto it at
once — the project row, the rail dot, and the palette's `open-project` — and it is what makes the
sentence above true rather than aspirational. `workspace-one-column.spec.ts` asserts it by clicking
the selected row and reading which worktree row is still `bg-muted`.

### 2.2 What is on screen, state by state

| State | The column shows |
|---|---|
| Landing (`selectedRepoId === null`) | Deck row highlighted, `Projects` eyebrow + count, notices, one row per project with its rollup dot, `+ Add project`. Nothing disclosed. |
| A project selected | The same, plus: that project's row is `bg-muted font-medium text-foreground`, and its worktrees disclosed directly beneath its `<li>`, indented one step. A worktree is always selected within it (the auto-select effect picks the `primary` checkout, or the first row), so there is never an "expanded but nothing chosen" state. |
| Column collapsed (⇧⌘B) | The 36px rail — see §2.5. Collapsing takes nothing from the workspace (the worktrees are still open, still running, still selected) and nothing from the nav's own state (the branch filter, the quiet-rows fold and the four dialogs are all held above the rail/column branch, so ⇧⌘B hides them rather than destroying them — §1.3). What it unmounts is the expanded column's DOM. |

### 2.3 A project row, collapsed or not

Every project row carries, always, whether it is selected or not:

- its `AttentionDot` from `repoMarks` — the rollup of that project's worktrees;
- `title` = `${repo.path}` or `${repo.path} — ${mark.sentence}` — the only surface showing the full
  path, and the accessible words-form of the aria-hidden dot;
- its remove `×`, revealed on `group-hover` **and** `focus-visible`.

The selected project keeps its rollup dot too. It is not redundant with the worktree dots below it:
the disclosed list folds, filters and scrolls, and the rollup is still the one-glance answer when
the row that changed is behind the fold or off the top of the viewport. Rows do not change shape
when selected.

**Project rows are never re-sorted.** They stay in `useLocalProjects` order. A list that reorders
itself while agents run is precisely "something that moves when it does not have to".

### 2.4 The disclosure

- **No header.** The project row above it is the header. No border, no background, no card.
- **Indentation is the only cue.** The section is inset one step (`pl-3`) relative to the project
  rows' `px-2`. No guide line — a vertical hairline is nested chrome.
- **No scroll container of its own.** The column's single `overflow-y-auto` scrolls everything.
- **No animation.** Conditional render, exactly as `SidebarSection.tsx:430` does it. There is no
  chevron to rotate. The island's only animation token is `transition-colors`, and a fold that
  animates in is a window where the surface is on screen and the input is not live
  (`paletteChrome.test.mjs:57-79` argues this for the palette; it generalises).
- Contents, in order: sr-only `<h3>`, filter box (only above 8 worktrees), the worktree `<ul>` or
  `no worktrees yet`, the fold row, the filtered-out count, `+ New worktree`, `Prune N missing
  worktrees…`, the refusal panel.
- **There is no project filter.** `worktree-filter` filters branches within the disclosed project
  and nothing else. Filtering projects is a new feature; the list is short.

### 2.5 The rail

⇧⌘B collapses the whole column to a 36px rail — `data-testid="worktree-column-rail"`. The rail is
the reason the column is safe to hide at all; a collapsed column plus a shortcut the owner has to
remember is a trap. It shows, top to bottom:

1. **`›`** — `data-testid="worktree-column-expand"`, aria-label `show the projects`,
   title `Show projects and worktrees (⇧⌘B)`. The way back, on screen, not only on the keyboard.
2. **A `!` refusal mark**, `data-testid="nav-rail-refusal"`, present only when there is a refusal
   to read. Its aria-label and `title` *are* the sentence(s) — `storeNotice`, `error` and
   `actions.refusal.message`, joined — and clicking it opens the column, which is where they are
   written out and dismissible. *(Added 2026-08-11; the third source added the same day — see
   below.)* Reason: every surface that reports project state lives in the expanded branch, and
   `action:add-project` is reachable from the palette while the nav is a rail, so a
   refusal raised then — `could not read <path>`, `could not save the project list: …` — was shown
   nowhere at all.

   *(Corrected 2026-08-11 — this item first named only `storeNotice` and `error`, which left the
   mark one refusal short of the family it was added to close. `actions.refusal`'s only renderer is
   the `worktree-column-refusal` panel inside `WorktreeDisclosure`, which is a level further inside
   the branch ⇧⌘B unmounts, and `paletteSources.ts` blocks `action:prune-worktrees` on
   `project === null || ctx.prunable === 0` and on nothing about the collapse — so with a project
   open and something prunable, the palette runs a prune against a rail and git's refusal lands
   nowhere. Blocking the palette row on `navCollapsed` was the alternative and is the wrong one: it
   would answer "a refusal has nowhere to go" by removing the gesture rather than the hole, and the
   same hole would still be open for a refusal from `prune()` itself, which fires after the confirm
   dialog has already closed. It is **not** suppressed while `creating`, unlike the panel: that
   suppression exists because `NewWorktreeDialog` prints the same sentence in the same place, and a
   `!` behind a modal overlay is not a second copy of it.)* `ProjectsNav` had no collapse before this merge, so that class of silent refusal
   is new here and had to be answered rather than inherited. It is also the honest reading of a
   rail showing a bare `0` and no dots because the list could not be read: that is "nothing there"
   standing in for "no answer". The two *informational* notices (`importNotice`,
   `coordinatorNotice`) get no mark — they are said once at start-up rather than in answer to a
   gesture, and they are still there to read when the column opens.
3. **One `AttentionDot` per project**, in list order, each wrapped in a button
   (`data-testid="nav-rail-repo-${repo.id}"`, aria-label = the project name, or
   `${name} — ${mark.sentence}` when there is one). The selected project's dot sits in a `bg-muted`
   pill. The rail scrolls (`min-h-0 overflow-y-auto`) when there are more projects than fit.
   **Clicking a dot:**
   - *another project's* — selects it, and nothing more. The whole work surface changes to that
     project, which is the visible answer. Whether the column then opens is **that project's own
     remembered `nav` flag**, not a forced expand. *(Corrected 2026-08-11 — this section and §6.3
     both said "and expands the column", unqualified. The flag is per project (§3); a project the
     owner has never collapsed defaults to expanded and so does open, but one he collapsed on
     purpose stays a rail, and overriding that from here would throw away a choice he made in the
     project he is entering. The narrower rule is the one implemented, and
     `workspace-columns.spec.ts` now asserts it against a second project whose flag is set —
     the reading that can actually fail.)*
   - *the selected project's* — **expands the column.** Selection is already where it points and
     `selectRepo` is idempotent (§2.1), so this is the one dot that would otherwise be a dead
     button. It is not a guess overriding a remembered flag; it is the owner asking, now, for the
     column of the project he is standing in, which is the only thing that gesture can mean.
4. **The project count**, `aria-hidden`, `text-2xs tabular-nums`.

This is the one place the merge adds an affordance rather than moving one, and it is the design
brief's own requirement: collapsing the column must not destroy the answer to "which project needs
me". The old rail's worktree count is replaced by the project count — see §6 for that removal.

---

## 3. The storage decision

**The stored layout is discarded, not migrated.** The key becomes `vingilot-columns.v2` and the
`worktrees` member becomes `nav`.

Today: `localStorage["vingilot-columns.v1"]` holds
`Record<repoId | "@landing", { sidebar: boolean; worktrees: boolean }>` where `true` means
collapsed, only a literal `true` collapses, and a fully-expanded key is dropped on parse.

The **shape** does not change — there are still exactly two independently collapsible things, so
`ColumnState` keeps two booleans. What changes is what one of them **means**: `worktrees: true` used
to hide a 224px list of branches; `nav: true` hides the entire navigation of the workspace,
projects included.

Why discard rather than migrate:

- A migration that renamed the member would carry a `true` forward into a flag that means something
  else. On the first launch of the new build, an owner who once hid a branch list in one project
  would find that project's whole navigation gone. `columnLayout.ts`'s own header names exactly this
  failure: "an owner who opens the app to a column that is missing for reasons he cannot see".
- The file already states the idiom for this situation, in the code, before anyone asked:
  *"Versioned: a future shape change gets a new key rather than a migration, so an older build
  reading a newer layout finds nothing and starts with everything expanded."* Follow the file's own
  rule rather than arguing with it.
- The discard direction is the safe one. `ALL_EXPANDED` is the default, so what is lost is a
  collapse the owner asked for once, not a surface he cannot get back.

**The cost, stated rather than hidden:** the `sidebar` flag lives in the same record, so discarding
v1 also forgets every project's remembered sidebar state. One launch where everything starts
expanded. That is the whole price and it is paid once. No migration code is written; v1 is simply
never read again, and is left in storage rather than deleted (an older build must still find it).

Consequences the implementer must land in the same commit:

- `columnLayout.ts` — `LAYOUT_KEY = "vingilot-columns.v2"`; `CollapsibleColumn = "sidebar" | "nav"`;
  `ColumnState = { sidebar: boolean; nav: boolean }`; `readState` reads `record.nav === true`;
  `parseColumnLayout`'s "fully expanded is dropped" test becomes `!state.sidebar && !state.nav`.
- `columnKeys.ts` — the `worktrees` member of `ColumnKeyAction` becomes `nav`.
- `useColumns.ts` — `worktreesCollapsed` → `navCollapsed`, `toggleWorktrees` → `toggleNav`.
- `columnLayout.test.mjs` (14 tests) and `columnKeys.test.mjs` (7 tests) — mechanical rename.
- `workspace-columns.spec.ts:256` and `:284` poll the literal `"vingilot-columns.v1"`. **Both go red
  unless changed to `.v2` in the same commit.** They are not to be left failing.
- `cheatsheet.ts` — the `WHAT` map is keyed on the resolved action's identity, so
  `column:toggle-column:column=worktrees` becomes `column:toggle-column:column=nav`. Missing it is a
  MISSING KEY failure in `cheatsheet.test.mjs:28` and `:51`, which is the gate proving the rename
  was carried through.

---

## 4. Keyboard, and what the palette now says

### 4.1 The three chords

| Chord | Before | After |
|---|---|---|
| **⌘B** | upstream's `SidebarProvider` sidebar | **unchanged.** Still delegates to the provider's own `toggleSidebar`; this island never builds a second collapse mechanism beside it. |
| **⇧⌘B** | collapse the 224px worktree column, leaving the 192px project list on screen | **collapse the whole merged column to its rail.** Half a collapse is no longer a thing that exists. |
| **⌘1…9** | switch to the Nth worktree of the selected project | **unchanged in mechanism and meaning.** Resolved in `terminalKeys.ts:144-148`, bound in `WorkSurface.tsx:210-216`, indexed into `signals.ordered` — the same array `WorktreeDisclosure` numbers. Still unbound when no worktree is selected, because `WorkSurface` is not mounted then. |

`⌥⌘B` and `⇧⌥⌘B` are the right pane's and are untouched. `columnKeys.ts` still refuses every `⌥`
chord, which is what keeps the two maps from firing on each other.

**⇧⌘B is now bound on the landing view too.** The column exists there — it holds the project list —
so the `hasWorktreeColumn` guard is a guard against a condition that can no longer occur.

- `ColumnsOptions.hasWorktreeColumn` is **deleted**; `useColumns.ts:155` (`if (!hasWorktreeColumn)
  return;`) and the effect's dependency on it go with it.
- `RunsScreen.tsx:327` stops passing it; `useColumns({ projectId: selectedRepoId })` is the whole
  call.
- `PaletteContext.hasWorktreeColumn` (`paletteSources.ts:59-85`) is deleted, along with
  `RunsScreen.tsx:617`.
- `paletteSources.test.mjs:216-225` — *"the worktree column cannot be toggled where there is not
  one"* — asserts behaviour that no longer exists. It is **replaced**, not deleted, by a test
  asserting the toggle is never blocked, including on the landing view. The `ctx()` fixture's
  `hasWorktreeColumn` field (`:49`) goes.

**No new chord.** No per-project expand chord, no arrow-key tree navigation, no roving tabindex.
Selection is disclosure, so clicking a project plus ⌘1…9 is the whole tree. Keyboard reach inside
the column is what it is today: native `<button>`/`<input>` semantics, the `focus-visible:opacity-100`
reveal on both kinds of `×`, and the ⌘N hints.

### 4.2 The palette rows

`action:toggle-worktrees` is renamed **`action:toggle-nav`**, and its command becomes
`{ type: "toggle-nav" }` (with the matching case in `RunsScreen`'s `runPaletteCommand` switch).
Exact copy, to be used verbatim:

```
id:      "action:toggle-nav"
chord:   "⇧⌘B"
detail:  "the projects, and the open one's worktrees"
label:   ctx.navCollapsed ? "Show the projects" : "Hide the projects"
blocked: null
```

`action:toggle-sidebar` keeps its chord, command and label; only its detail changes, because
"on the left" no longer identifies one thing:

```
detail:  "the app's own sidebar, left of the workspace"
```

Everything else in the palette is unchanged and must stay that way:

- `project:landing` ("Deck") and one `open-project` row per repo — the palette twins of the Deck
  button and the project rows.
- `open-worktree` rows carrying `⌘{index+1}` derived from position in `ctx.worktrees`. The digit is
  the disclosure's row position *by construction*, not by a written-down table. Preserving the
  ordering preserves this for free.
- `action:new-worktree`, `action:prune-worktrees`, `action:remove-project` remain second doors to
  the *same* dialog state the column's buttons open. **The merge must not create a second dialog
  instance.**

Test consequences to land in the same commit:

- `paletteSources.test.mjs:249-259` asserts `action:toggle-worktrees` carries `⇧⌘B`. Rename to
  `action:toggle-nav`.
- `workspace-palette.spec.ts:357` types the literal string `"hide the worktrees"` and presses Enter.
  It becomes `"hide the projects"`. The label text is a test contract.

### 4.3 The cheatsheet

Two sentences change; both are gated.

- `column:toggle-column:column=nav` → **"show or hide the projects and their worktrees"** (section
  `columns`). The old key `…column=worktrees` no longer resolves, so leaving it fails
  `cheatsheet.test.mjs` with MISSING KEY rather than printing a wrong line.
- `terminal:switch-worktree` → **"switch to the Nth worktree under the open project"**. The word
  "column" no longer identifies a surface. The key is unchanged, so this edit is free —
  `cheatsheet.test.mjs:128` and `:172` count nine chords, not words, and keep passing.

---

## 5. The geometry claim

Today, measured at 1728×1117 (the 16-inch MacBook Pro's logical resolution, already written down in
`workspace-diff-fits.spec.ts:7-18`):

```
window 1728 → sidebar 300 + projects nav 192 + worktree column 224 → work surface 1003
```

After:

```
window 1728 → sidebar 300 + workspace nav 224                      → work surface 1195
```

**The merged column is `w-56` — 224px, exactly the width the worktree column had.** The entire
192px of the old `ProjectsNav` goes to the work surface, which is the claim in a form a test can
assert: **the work surface gains 192px, 1003 → 1195.**

Why 224 and not 192 or 240: the tightest row in the column is a worktree label indented one step
under a project row. At 224 with a `pl-3` indent it has 180px of content box against the 192px it
has today — 12px tighter, on a row whose label already truncates with a `title`. At 192 it would be
148px, which truncates branch names the owner reads. And 224 makes the gain *exactly the column that
went away*, which is a cleaner sentence than an arbitrary number and a cleaner assertion than an
inequality.

Collapsed, the rail is `w-9` — 36px — and the work surface is 1383.

### 5.1 The new spec

`desktop/tests/e2e/workspace-one-column.spec.ts`, at `{ width: 1728, height: 1117 }`, needs a
`vingilot/seams.yaml` entry mirroring the other fork specs' (`playwright.config.ts`'s `testDir` is
the reason those live at the upstream-owned path) and registration in `playwright.config.ts`.

What it pins:

1. `projects-nav`'s bounding box is **224** wide, and there is no second nav element beside it —
   `[data-testid="worktree-column"]` is a **descendant** of `projects-nav`, not a sibling.
2. With a project open, `work-surface`'s bounding box is **≥ 1190** (it was 1003). The floor rather
   than the exact integer, because the 1728 − 300 − 224 = 1204 arithmetic and the measured 1003
   already differ by the same handful of pixels of border and scrollbar; the assertion that matters
   is the ~190px gain, not a pixel.
3. **Self-checking sum:** `sidebar.width + nav.width + surface.width === 1728`. This catches a
   third column reappearing without anyone having to update a magic number.
4. ⇧⌘B: `worktree-column-rail` is 36 wide, `work-surface` grows by ~188, and
   `worktree-column-expand` is visible and brings the column back.

"It looks roomier" is not a test; three measured numbers and a sum are.

`RunsLoadingFallback.tsx:63` hardcodes `w-48` to mirror `ProjectsNav`'s first paint. It becomes
`w-56` in the same commit, or the first paint jumps 32px on every cold start.

---

## 6. The ledger — every item, with a destination

The three surveys overlapped; each item is answered once. **"Survives"** means the same element,
copy, behaviour and test id, moved. Where anything at all differs it says so.

### 6.1 `WorktreeColumn` — props

| Item | Where it lands |
|---|---|
| `repo` | Becomes `selectedRepo: Repo \| null` on `WorkspaceNav`; passed down as a non-null `repo` to `WorktreeDisclosure`, which only mounts with one. Still drives the filter's aria-label, `removableWorktree(repo, …)`, and the sr-only heading. No longer drives a rail label (§6.3) and no longer drives a render-phase reset (it drives `key={repo.id}` instead). |
| `worktrees` | Survives on `WorktreeDisclosure`, still `signals.ordered`, still the same array `WorkSurface` indexes for ⌘1…9. **This sharing is why the ordinal hints are correct; do not pass a copy, a filtered list, or a re-sort.** |
| `stats` | Survives on `WorktreeDisclosure`. A missing entry is still "unknown", never "clean" — it gates folding and produces the `+/−` badge. |
| `marks` (Map) | Survives as `worktreeMarks: ReadonlyMap<…>` on `WorktreeDisclosure` → `WorktreeRow`. **Distinct prop, distinct name, distinct type from `repoMarks` (a Record).** Conflating them makes every dot `NO_MARK` silently. |
| `selectedWorktreeId` | Survives on `WorktreeDisclosure`. Still the row's `bg-muted` styling **and** `worktreeColumnView`'s `selectedId`, which is what guarantees the selected row is never folded away. |
| `onSelectWorktree` | Survives; still `setSelectedWorktreeId` from `RunsScreen.tsx:881`, fired by the row button. |
| `worktreeRoot` | Survives on `WorktreeDisclosure`. Still `null` before the shell answers, and `removableWorktree` still returns `null` for every row while it is — so no `×` is drawn at all rather than one with no resolvable path. |
| `actions` (`WorktreeActions`) | Survives, split by consumer: `WorktreeDisclosure` uses `pending`, `refusal`, `dismissRefusal`; `WorkspaceNav` uses `create`, `remove`, `prune`, `pending`, `refusal` for the three dialogs. One object, passed to both. |
| `collapsed` | Becomes `collapsed={columns.navCollapsed}` on `WorkspaceNav` and chooses rail vs column there. The flag now hides the whole nav (§3). |
| `onToggleCollapsed` | Becomes `onToggleCollapsed={columns.toggleNav}`. Still bound to **both** the header `‹` and the rail `›` — the same single act ⇧⌘B and the palette drive. |
| `creating` / `onCreatingChange` | **Stay lifted to `RunsScreen`**, passed through `WorkspaceNav` (which mounts the dialog) and to `WorktreeDisclosure` (whose `+ New worktree` sets it, and whose refusal panel is suppressed by it). Re-localising this state breaks `workspace-palette.spec.ts:339-346` — one dialog, two doors. |
| `prunePreview` / `onOpenPrune` / `onPrunePreviewChange` | Stay lifted, same reason. `RunsScreen.openPrune` still fetches git's dry run and still refuses to open a dialog that would name nothing. |

### 6.2 `WorktreeColumn` — state and derived values

| Item | Where it lands |
|---|---|
| `confirming` (`RemovableWorktree \| null`) | **Moves up to `WorkspaceNav`** (§1.3). Set by a worktree row's `×` via a callback prop, cleared on cancel and on confirm. It must not live in `WorktreeDisclosure`, which unmounts on collapse. |
| `query` | Survives, and **moves up to `WorkspaceNav`** with `expanded` and `scope` below — *corrected 2026-08-11, this row read "local to `WorktreeDisclosure`"*. Its lifetime must not shorten from "until you switch project" to "until you press ⇧⌘B": the disclosure renders only in the expanded branch. Non-empty still disables folding entirely and produces the hidden-count line. |
| `expanded` | Survives, **moved to `WorkspaceNav`** for the same reason — *corrected 2026-08-11*. Still toggled only by the fold row, which now calls up through `onExpandedChange`. |
| `scope` (render-phase project reset) | **Survives verbatim in `WorkspaceNav`, keyed on `selectedRepoId`** — *corrected 2026-08-11, this row said it was replaced by `key={repo.id}` on `<WorktreeDisclosure>`. That is only a reset while the state being reset lives inside the disclosure; with the state lifted, the three original lines are the mechanism again, and the `key` is dropped as redundant (`ProjectRow`'s own `key={repo.id}` already unmounts the disclosure on a project switch).* Identical guarantee: cleared during the render that brought the new project in, never painted with the previous project's filter. See §1.3. |
| `view = worktreeColumnView(…)` | Survives verbatim in `WorktreeDisclosure`. All five members (`rows`, `folded`, `foldLabel`, `showFilter`, `filteredOut`) are rendered; none is derivable from another and `worktreeAttention.ts:216-218` says so. |
| `prunable = prunableWorktrees(worktrees).length` | Survives in `WorktreeDisclosure`. The Prune button exists only when non-zero and its label states the count. |
| No key handler in the file | Still true of all four new files. ⇧⌘B stays in `useColumns.ts`, ⌘1…9 in `terminalKeys.ts` + `WorkSurface.tsx`. The column owns native button/input semantics, the `focus-visible` reveals, and the ⌘N hints — nothing else. |

### 6.3 `WorktreeColumn` — the rail

| Item | Where it lands |
|---|---|
| Collapsed rail container (`worktree-column-rail`, `w-9`) | Survives on `WorkspaceNav`, same test id, same width. Gains `min-h-0 overflow-y-auto` for the dot stack. Now the collapsed state of the whole nav, and reachable on the landing view too. |
| Rail expand button (`worktree-column-expand`, `›`) | Survives, same test id, same glyph. **Copy changes:** aria-label `show the projects`, title `Show projects and worktrees (⇧⌘B)` — the old strings named one project's worktrees. `workspace-columns.spec.ts:118-121` clicks it by test id and keeps passing. |
| Rail worktree count | **Deliberately gone**, replaced by the project count in the same position and the same `aria-hidden text-2xs tabular-nums` styling. Reason: the rail no longer stands for one project's worktrees; a worktree count on a rail that hides every project answers a question nobody is asking from there. No test guards either number. |
| *(new)* Rail per-project dot stack | `nav-rail-repo-${repo.id}` buttons, one `AttentionDot` each, selected one in a `bg-muted` pill. Click on another project's dot **selects it and lets that project's own remembered `nav` flag decide** whether the column opens; click on the *selected* project's dot **expands the column**. *(Corrected 2026-08-11 — this row said "selects the project and expands the column" for every dot; §2.5 has the full reasoning and the test that distinguishes the two readings.)* §2.5. |
| *(new)* Rail refusal mark | `nav-rail-refusal` — a `!` whose accessible name is `storeNotice`, `error` and `actions.refusal.message` joined, present only when there is one, opening the column on click. *(Added 2026-08-11; `actions.refusal` added the same day — §2.5 item 2 says why the first two were not the whole family.)* The notice and refusal panels are the one group that was **not** lifted out of the rail/column branch with the four dialogs, and unlike the dialogs they cannot be: they are in-flow text panels, and rendering them beside a 36px rail would be a second column of unspecified width — the exact thing this merge removes. A mark on the rail is the answer instead. §2.5. |

### 6.4 `WorktreeColumn` — the expanded column

| Item | Where it lands |
|---|---|
| Expanded container (`worktree-column`, `w-56`, own scroll, own border) | The **test id survives on the disclosed `<section>`**; the width, border and scroll container do not — they are the merged column's now, and that is the merge (§1.5, §5). Its visible/hidden state is still the ⇧⌘B contract and still what 22 e2e references read. |
| Column heading (`<h2>` repo name) | Becomes an **`sr-only <h3>`** as the first child of the `worktree-column` section. `workspace-palette.spec.ts:226-229/:259-262` read `getByTestId("worktree-column").getByRole("heading")` and assert the project name — met exactly. It must be the section's only heading. The visible project name is the project row directly above it; repeating it visibly is nested chrome. |
| Header collapse `‹` (`worktree-column-collapse`) | Survives with its test id, **moved** to `WorkspaceNav`'s header row beside the `Projects` eyebrow. Copy changes: aria-label `hide the projects`, title `Hide projects and worktrees (⇧⌘B)`. It remains the only pointer affordance that collapses the column. Unguarded by e2e — which is not permission to drop it. |
| Filter box (`worktree-filter`) | Survives inside `WorktreeDisclosure`, unchanged: `type=search`, placeholder `filter branches`, aria-label `filter the worktrees of <repo>`, shown only above `FILTER_THRESHOLD` (8) worktrees. It filters branches, never projects. |
| Empty state `no worktrees yet` | Survives inside the disclosure, indented, replacing the worktree list when the project has none. |
| Worktree row button (`worktree-row-${binding_id}`) | Survives on `WorktreeRow`. **The test id pattern is the contract** — literally `worktree-row-` + binding id, `main:` and `local:` prefixes included. 8 e2e references, two of them prefix locators. |
| Row selected styling | Survives verbatim: `bg-muted text-foreground` when selected, else `text-muted-foreground hover:bg-muted/60`. |
| Row `title` = label + attention sentence | Survives verbatim. It is the only accessible rendering of attention state — the dot is `aria-hidden` and `AttentionDot.tsx:24-27` names this caller as required to repeat it in words. |
| Row attention dot | Survives: `<AttentionDot className="mt-1" mark={worktreeMarks.get(id) ?? NO_MARK} />`. `className` stays margins-only. |
| Row label | Survives: `worktreeSummary(wt).label`, truncated, `text-sm`. |
| ⌘1…9 ordinal hint | **Survives unchanged** — `row.index < 9 ? row.index + 1 : null`, drawn as `⌘N` in `text-2xs`. The plan names it a must-not-lose: it is the only discoverability surface for the switch-worktree chord. The digit is the row's place in the ordered array, so it stays with the worktree whether the fold is open or shut. |
| Row detail line (numstat badge) | Survives verbatim: `rowDetail(row)` in `text-2xs`, `text-amber-600 dark:text-amber-500` when `row.attention === "dirty"`, muted otherwise. |
| Row remove `×` (`worktree-remove-${binding_id}`) | Survives on `WorktreeRow`, calling up to `WorkspaceNav`'s `confirming`. Still **absent, not disabled**, when `removableWorktree` returns `null` — never for the main checkout, never for a run-owned worktree, never while `worktreeRoot` is `null`. Still disabled while `actions.pending`. Rendering a disabled `×` for the main checkout would change the stated model. |
| Row hover/focus reveal of `×` | Survives verbatim: `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` on a `<li className="group">`. The `focus-visible` half is the keyboard affordance and is not optional. |
| Fold row (`worktree-fold`) | Survives inside the disclosure, unchanged: `aria-expanded`, `▾`/`▸`, label from `foldLabelFor`, title *"Nothing is removed by folding — these worktrees are all still here"*, threshold `FOLD_THRESHOLD` (3). It is now the **only** way to shorten the disclosed list — there is no per-project chevron (§2.1). |
| Filtered-out count | Survives: `N hidden by the filter`, `text-2xs`, only when `view.filteredOut > 0`. It is what keeps a filter from looking like a shortened list. |
| `+ New worktree` (`worktree-column-new`) | Survives at the foot of the disclosure, disabled while pending, calling `onCreatingChange(true)` — the same state the palette's `action:new-worktree` sets. |
| `Prune N missing worktrees…` (`worktree-column-prune`) | Survives, rendered only when `prunable > 0`, label pluralised, title *"Show what `git worktree prune` would remove — records only, no directories"*. The plan singles this out: dropping it is "a regression with a nicer border". |
| Refusal panel (`worktree-column-refusal`) | Survives inside the disclosure: destructive box, `actions.refusal.message`, and the `font-mono text-2xs <ul>` of the dirty paths git named, each truncated with a `title`. **Still suppressed while `creating`**, because `NewWorktreeDialog` shows the same refusal — losing that suppression double-renders it, and it is the single most losable line in the merge. *(2026-08-11: this panel sits one component deeper inside the branch ⇧⌘B unmounts than the project notices do, so `actions.refusal` also drives the rail's `!` mark — §2.5 item 2. The prune door is reachable from the palette while the nav is a rail.)* |
| Refusal dismiss (`worktree-column-refusal-dismiss`) | Survives, text `dismiss`, calls `actions.dismissRefusal`. Without it a refusal is sticky. |
| `NewWorktreeDialog` mount | Moves to `WorkspaceNav`, still opened by `creating`, still wired to `actions.create/pending/refusal`, `repo`, `worktreeRoot`. Its own test ids are asserted by `workspace-palette.spec.ts:346`. |
| `PruneWorktreesDialog` mount | Moves to `WorkspaceNav`; `onConfirm` still clears the preview then runs `actions.prune()`, `onOpenChange` still always clears. |
| Remove-worktree confirm (`worktree-remove-confirm` / `-action`) | Moves to `WorkspaceNav`. Copy still comes from `removeWorktreeConfirm` (`worktreePlan.ts:346-358`) — a tested promise about the owner's disk. **Never inline new copy here.** |
| All dialogs outside the collapsed/expanded branch | **Preserved and extended.** `WorkspaceNav` returns a fragment: the rail/column ternary, then all four dialogs. Collapsing the column while a confirm is open must not take the confirm with it. |

### 6.5 `ProjectsNav` — props

| Item | Where it lands |
|---|---|
| `repos` | Survives on `WorkspaceNav`; drives the rows, the eyebrow's count, and the rail's dot stack. |
| `marks` (Record) | Survives as **`repoMarks`**, still `signals.byRepo`, still the `rollupMark` of each project's worktrees. Still a Record, never merged with the Map (§1.4). |
| `selectedRepoId` | Survives. `null` still means the landing view, which still highlights the Deck row and discloses nothing. |
| `onSelectRepo` | Survives → `selectRepo`, which still clears `selectedWorktreeId` — **when the project is a different one**. Choosing a *different* project must keep clearing the worktree selection; the auto-select effect then picks the primary checkout, which is why disclosing a project immediately shows a terminal. Choosing the project already open must clear nothing, so `selectRepo` opens with `if (id === selectedRepoId) return;` (§2.1). *(Added 2026-08-11: unguarded, the merge gave that line a second, much more visible door. `ProjectsNav`'s row had the same defect, but it sat in its own column away from the worktree list; the merged nav puts it directly above the list it silently resets, and §2.1 had already promised in writing that it was a no-op.)* |
| `onSelectLanding` | Survives → `selectLanding`, still clearing repo, worktree **and** the open run detail. Still the only pointer route back to the project-less home. |
| `onAddProject` / `onRemoveProject` / `pending` | Survive; `pending` still disables the add button and every project row's `×`. |
| `importNotice` / `onDismissImportNotice` | Survive verbatim, still deliberately not error-styled. |
| `coordinatorNotice` | Survives verbatim and **still has no dismiss button**. It is a state, not an event; adding a dismiss would be a behavioural change, not a tidy-up. |
| `storeNotice` | Survives verbatim and **still renders above the project list**, because while it holds, the rows below are not this machine's projects. *(2026-08-11: it now also drives the rail's `!` mark, because the merge gave this panel a collapsed state it never had — §2.5 item 2.)* |
| `error` / `onDismissError` | Survive verbatim, destructive styling, dismissible. *(2026-08-11: also drives the rail's `!` mark — §2.5 item 2. It is the one of the four whose refusal can be raised *while* the nav is a rail, from the palette's `action:add-project`.)* |
| `confirming` / `onConfirmingChange` | **Stay lifted to `RunsScreen`** (`removingProject`), because the palette is a second door and the confirm's words are a tested promise. Still cleared by `RunsScreen`'s `dismissDialogs`. |

### 6.6 `ProjectsNav` — markup

| Item | Where it lands |
|---|---|
| Container (`projects-nav`, `w-48`, own scroll, own border) | Test id, scroll container and border survive on `WorkspaceNav`'s container; **`w-48` becomes `w-56`** (§5). `workspace-no-coordinator.spec.ts:220` (`toContainText "no projects yet"`) keeps passing. |
| Deck row (`projects-nav-landing`) | Survives verbatim at the top, label `Deck`, highlighted when `selectedRepoId === null`. Still the only pointer route back to the Deck. |
| `Projects` eyebrow + count (`<h2>`, `text-3xs uppercase tracking-[0.14em]`) | Survives, and is now **the column's only visible heading** — the heading-idiom disagreement between the two columns is settled in the eyebrow's favour (§6.9). It stays in `WorkspaceNav`, **outside** the `worktree-column` section, or the palette's `getByRole("heading")` locator goes ambiguous. The `‹` collapse button joins it on the same row. |
| Store-notice panel (`projects-nav-store-notice`) | Survives verbatim, above the list. `workspace-no-coordinator.spec.ts:223` asserts `toHaveCount(0)` on the happy path — the test id must keep existing for that negative assertion to mean anything. |
| `no projects yet`, suppressed while unreadable | Survives verbatim, including the suppression when `storeNotice !== null`. This is the one place an empty read is explicitly not "nothing there", and `workspace-no-coordinator.spec.ts:220-223` asserts both halves together. |
| Project row button (`projects-nav-repo-${repo.id}`) | Survives on `ProjectRow` with the **exact same test id** — 40 references across 18 specs, the entry gesture for nearly every workspace spec. Changing it would edit 13 unrelated specs. |
| Project row selected styling | Survives verbatim, `font-medium` included. With worktrees disclosed beneath it the weight is a second cue, and it is kept: the disclosure scrolls and folds, and the row still has to answer "which project owns these" when it does. |
| Project row `title` = path + attention sentence | Survives verbatim. Two jobs, both still needed: the only surface showing the full path, and the accessible words-form of the aria-hidden dot. |
| Project rollup dot | Survives on **every** project row, selected or not (§2.3), `<AttentionDot mark={repoMarks[repo.id] ?? NO_MARK} />` with no `className` so it sits at the component's own size. It is the answer for the *other* projects, which is the whole reason this is a tree. |
| Project remove `×` (`projects-nav-remove-${repo.id}`) | Survives verbatim on `ProjectRow`: aria-label `remove <name>`, title `Remove <name> — forgets the path, never touches the folder`, disabled while pending, `opacity-0` + `group-hover` + `focus-visible` reveal. |
| `+ Add project` (`projects-nav-add`) | Survives at the foot of the project list, disabled while pending. Clicked by `workspace-no-coordinator.spec.ts:226/:300`. |
| Import notice + `got it` | Survive verbatim, both test ids. Both are live contracts (`workspace-readme-shots.spec.ts:424-427`, `workspace-no-coordinator.spec.ts:242`). |
| Coordinator notice | Survives verbatim, no dismiss. |
| Error panel + dismiss | Survive verbatim, both test ids. |
| Remove-project confirm (`projects-nav-remove-confirm` / `-action`) | Survives, copy still from `removeProjectConfirm` (`repoChoice.ts`) — the tested promise that removing forgets a path and nothing in this feature writes inside a project directory. |
| The dialog-nesting asymmetry | **Resolved in `WorktreeColumn`'s favour.** `ProjectsNav`'s AlertDialog sat inside its scrolling container; in the merged column every dialog moves out of the collapsible subtree, or collapsing unmounts an open confirm. |
| No key handler, no shortcut hints, no collapse chord of its own | Still true. The column gains ⇧⌘B, which it did not have — that is the plan's point, not a new mechanism. |

### 6.7 The screen, the signals, the libs

| Item | Where it lands |
|---|---|
| `ProjectsNav` mount (13 props, always mounted) + `WorktreeColumn` mount (15 props, inside the `selectedRepo !== null` branch) | **One `<WorkspaceNav>` mount**, always, in `ProjectsNav`'s position — the first child of the flex row at `RunsScreen.tsx:821`, outside the `selectedRepo === null` branch. The disclosure appears inside it when a project is selected. |
| Selection state in `RunsScreen` | Unchanged. The merge changes no state ownership at the screen level. |
| Auto-select the primary checkout | Unchanged (`RunsScreen.tsx:420-425`). It is what makes "expanded" and "a worktree is selected" the same state. |
| `useColumns` call site | `useColumns({ projectId: selectedRepoId })`. `hasWorktreeColumn` is deleted (§4.1). |
| `columnKeys.ts` (⌘B / ⇧⌘B / ⌥ refused) | Unchanged logic; the `worktrees` member of the action becomes `nav`. `columnKeys.test.mjs` renames with it. |
| The keydown listener and its `hasWorktreeColumn` no-op guard | The listener survives; **the guard is deleted** — the column now exists everywhere, so ⇧⌘B is bound everywhere. |
| Sidebar push/record pair and the `pushed` echo guard | **Untouched.** Do not go near it. It is the subtlest code in `useColumns.ts` and the merge gives it no reason to change. |
| `vingilot-columns.v1`, its value shape, its coercive parse, its version policy | Discarded for `.v2` with `worktrees` renamed `nav`. §3 is the whole argument. |
| `PaletteContext` fields the columns feed | `worktreesCollapsed` → `navCollapsed`; `hasWorktreeColumn` deleted; `worktrees`, `selectedRepoId`, `selectedWorktreeId`, `prunable`, `sidebarCollapsed` unchanged. |
| Palette `toggle-worktrees` / `toggle-sidebar` rows | Rewritten per §4.2, copy given verbatim there. |
| Palette worktree rows deriving ⌘N from array position | Unchanged and preserved for free, because the ordering is preserved. |
| Palette project rows and the Deck row | Unchanged. |
| Palette prune / new-worktree / remove-project rows as second doors | Unchanged; the merge must not create a second dialog instance. |
| ⌘1…9 in `terminalKeys.ts`, bound in `WorkSurface.tsx` | Unchanged, including the consequence that it is unbound when no worktree is selected. |
| `orderWorktrees` | Unchanged. One array feeds the disclosure, the palette and the ⌘N map. |
| Cheatsheet sentences | Two edits, §4.3. |
| `useWorktreeSignals` — all five fields, and `byRepo` as a rollup of `byWorktree` derived once | Unchanged, and the merged column reads both maps from it rather than recomputing either. |
| Stats are workspace-wide, capped at 64 paths, open project first | Unchanged. The merge discloses no more worktrees at once than today, so it does not change which rows go statless. |
| `grouped.byRepo` | **Not read by the merged column.** §2.1 says why. The `unknown` bucket stays where it is. |
| `unreadable` projects | Unchanged and still never rendered — "a project git cannot read is not shown a refusal; nobody asked for this listing". The plan's "unreadable project refusal" is the `actions.refusal` panel (§6.4); the unreadable-project logic is screen-level and this merge does not touch it. |
| The palette's centring box | Structurally unchanged — `WorkspaceNav` is still the first child, the `relative` box still its sibling. The worktree list moving out of that box means the palette is now centred over the work surface alone, which is what the comment at `RunsScreen.tsx:841-845` always said it was for. Re-run `workspace-palette-over-thread.spec.ts`. |
| `RunsLoadingFallback.tsx:63` (`w-48` skeleton) | `w-56`, in the same commit, or the first paint jumps. |
| `paneKeys.ts:21` prose about "a worktree-column chord" | Reword to name the nav column. Prose only, no behaviour. |
| `workbench.md:23-24, 1258` | The two-column table is rewritten as one column. Both promises must still read true of it: *removing a project forgets the path*, and *if git refuses because the tree is dirty, what is dirty is shown and nothing happens*. |

### 6.8 Tests

| Item | What happens to it |
|---|---|
| `columnKeys.test.mjs` (7) | Mechanical rename `worktrees` → `nav`; the second test's name becomes "shift+primary+b toggles the nav column". |
| `columnLayout.test.mjs` (14) | Mechanical rename plus the `.v2` key. This file is the spec for the discard decision; it does not gain a migration test, because there is no migration. |
| `paletteSources.test.mjs` | `action:toggle-worktrees` → `action:toggle-nav` in the chord assertion; the `ctx()` fixture loses `hasWorktreeColumn`; the "cannot be toggled where there is not one" test is **replaced** by one asserting the toggle is never blocked, landing view included. |
| `cheatsheet.test.mjs` (10) | Passes once the `WHAT` key is renamed; it is the gate that catches a half-done rename. |
| `worktreeAttention.test.mjs`, `attentionSignal.test.mjs`, `triage.test.mjs`, `terminalKeys.test.mjs` | Untouched. The merge changes no view model, no ordering, no mark derivation, no chord resolution. |
| `typeScale.test.mjs` | Untouched, and it gates the four new files: only `text-sm` / `text-xs` / `text-2xs` / `text-3xs`, and `text-3xs` only ever with `uppercase tracking-[0.14em]`. |
| `paletteChrome.test.mjs` | Untouched; its no-animation rationale is why the disclosure is a conditional render. |
| `workspace-columns.spec.ts` (7) | Storage literal → `.v2` (2 places). The ⇧⌘B test keeps passing unchanged (the column hides, the rail's `›` brings it back). The two per-project persistence tests keep passing — the flag is still keyed per project. |
| `workspace-palette.spec.ts` | `"hide the worktrees"` → `"hide the projects"` at `:357`. The two heading assertions pass against the sr-only `<h3>`. The chord-blocking test at `:152-188` passes unchanged. |
| `workspace-no-coordinator.spec.ts` | Passes unchanged — every test id it reads survives. It is the densest single dependency on both columns' markup and is therefore the best single check that the merge is complete. |
| `workspace-triage.spec.ts`, `workspace-no-overlays.spec.ts`, `workspace-plan.spec.ts` | Pass unchanged; `worktree-row-*` and its prefixes survive. |
| The 13 specs using `projects-nav-repo-{id}` as navigation | Pass unchanged. |
| `workspace-diff-fits.spec.ts` | Its header records `1728 → 300 + 192 + 224 → 1003`. **The arithmetic in that comment is now wrong** and the pane widths it asserts derive from a 1003px surface. Re-measure at 1195 and update the header and any width assertion that moved. This is the one spec most likely to go red for a reason that is not a defect. |
| *(new)* `workspace-one-column.spec.ts` | §5.1. Needs a `seams.yaml` entry and a `playwright.config.ts` registration. |
| Test ids with no e2e coverage | `worktree-column-collapse`, `-new`, `-prune`, `-refusal`, `-refusal-dismiss`, `worktree-filter`, `worktree-fold`, `worktree-remove-*`, `worktree-remove-confirm(-action)`, `projects-nav-landing`, `projects-nav-remove-*`, `projects-nav-remove-confirm(-action)`, `projects-nav-error-dismiss`. **No test goes red if these are dropped, which is the opposite of permission to drop them.** Every one is in §6.4/§6.6 with a destination. |

### 6.9 Style decisions the merge was forced to make

| Question | Answer |
|---|---|
| Two heading idioms (eyebrow vs `text-sm font-semibold`) | **The eyebrow wins.** One column, one visible heading: `Projects` in `text-3xs uppercase tracking-[0.14em]` with the count. The project name survives as the sr-only `<h3>` inside the disclosure. A second visible heading inside the column is nested chrome. |
| Row idiom | Both columns already agree: `rounded-lg px-2 py-1.5 transition-colors`, selected `bg-muted text-foreground`, unselected `text-muted-foreground hover:bg-muted/60`. Kept verbatim for both row kinds; the only difference between a project row and a worktree row is indentation and what is inside it. |
| Colour family | `border-border/60` + `muted`, as both columns already use. **Not** the `sidebar-*` family — reusing `SidebarMenuSubButton` would import a second colour family into one column. |
| Reuse `SidebarMenuSub`/`SubButton`? | **No.** It is unused anywhere in `src`, it carries the wrong colour family, and `shared/ui/sidebar.tsx` is 1011 lines against a 1000-line ceiling with no seam entry — not one line may be added to it. |
| A collapsible/accordion dependency? | **No.** None exists in the tree and adding `@radix-ui/react-collapsible` for a conditional render would be a new dependency for zero behaviour. |
| Disclosure control size | `text-xs` — the recorded type scale puts a disclosure in the Control role. The fold row already is. |
| `cn()` | Not introduced. The island composes conditional classes with template literals throughout; a merged column that reaches for `cn()` introduces an idiom for one file. |
| Animation | None beyond `transition-colors`. No `transition-transform`, no `duration-*`, no height trick. |

---

## 7. Everything deliberately removed, in one place

Four things. Nothing else in either component is gone.

1. **The second column's width, border and scroll container** (`w-56`, `border-r`, `overflow-y-auto`
   on the worktree list). That is the merge itself: one border, one scroller, 192px back to the work
   surface.
2. **The visible `<h2>` naming the project inside the worktree column.** It becomes an `sr-only`
   `<h3>`. The project row directly above it is the visible name; drawing it twice, 24px apart, is
   the nested chrome the brief forbids. The accessible name and the palette's heading contract are
   both kept.
3. **The rail's worktree count**, replaced by the project count. The rail no longer stands for one
   project; a count of one project's worktrees on a rail that hides every project answers nothing
   asked from there.
4. **`hasWorktreeColumn`** — the option, the `useColumns` guard, the `PaletteContext` field, the
   palette's `blocked` string, and the unit test asserting the blocked state. A guard against a
   condition that can no longer occur: the column exists on every view now, including the Deck.

And one replacement that is not a removal: **the render-phase `scope` reset becomes
`key={repo.id}`**. Identical guarantee, less machinery, §1.3.

---

## 8. Implementation order

Ordered so the tree is never in a state where a whole gate is red for a reason you have not read yet.

1. **The rename, alone, with no UI change.** `columnLayout.ts` (`.v2`, `nav`), `columnKeys.ts`,
   `useColumns.ts`, `paletteSources.ts`, `cheatsheet.ts`, and their five unit-test files, plus the
   two `.v1` literals in `workspace-columns.spec.ts` and the typed string in
   `workspace-palette.spec.ts`. Everything still renders as two columns; every gate is green. This
   step alone answers §3 and §4.
2. **The four new files**, built from the two old ones, with `RunsScreen` mounting `WorkspaceNav`
   once. Delete `ProjectsNav.tsx` and `WorktreeColumn.tsx` in the same commit — a merge that leaves
   the old files importable is how one comes back.
3. **`hasWorktreeColumn` deleted**, and its palette test replaced.
4. **Widths:** `RunsLoadingFallback.tsx` to `w-56`; re-measure and update
   `workspace-diff-fits.spec.ts`'s header and any assertion that moved.
5. **The new spec** `workspace-one-column.spec.ts`, its `seams.yaml` entry, its
   `playwright.config.ts` registration.
6. **`workbench.md`** — the two-column table becomes one column, with both promises intact.

**A test must be able to fail.** For the new geometry spec, prove it red before believing it: set
the merged column back to `w-48` and watch the width assertion and the sum assertion both fail, then
put it back. For the disclosure's `key={repo.id}`, prove it red: remove the `key`, type into the
filter of a project with more than eight worktrees, switch project, and assert the filter is empty —
that assertion must fail without the key. A test that has not been seen red is not coverage.

> **This document changed no code and proved no test red.** Steps 1-6 are the implementer's, and the
> two red-proofs above are theirs to perform and to report.

---

## 9. Gates

From `desktop/`:

```
pnpm biome check --write src
pnpm check:px-text
pnpm test
pnpm tsc --noEmit
```

From the repo root:

```
./vingilot/scripts/check-seams.sh
```

Notes the implementer will need:

- **Every file this change touches is already inside the island** (`desktop/src/features/runs/*`,
  seam entry at `vingilot/seams.yaml:105`), so the four new files, the deletions and the lib renames
  need **no new seam entry**. The one exception is the new e2e spec: `desktop/tests/e2e/` is
  upstream-owned and every fork spec there carries its own entry. Add one, with the same reason the
  others give (`playwright.config.ts`'s `testDir` is fixed).
- `pnpm` may fail on this machine under Node 20 with `ERR_UNKNOWN_BUILTIN_MODULE node:sqlite`. The
  gates run directly: `node ./scripts/check-px-text.mjs`, `node ./scripts/check-file-sizes.mjs`, and
  `node --import ./test-loader.mjs --experimental-strip-types --test 'src/**/*.test.mjs'`. Both
  checkers print nothing and exit 0 on success.
- **Do not launch the app, do not run a release build, do not touch Rust.** This task is entirely
  `desktop/src` plus two docs and one spec.
