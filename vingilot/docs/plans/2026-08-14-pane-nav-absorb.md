# Pane nav-halves, absorbed into the sidebar's contextual region

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Branch:** `vingilot/pane-nav-absorb` off `main`, once `vingilot/single-sidebar`
> (`2026-08-14-single-sidebar.md`) has landed — this plan's every mechanism assumes
> `SidebarContextualPane.tsx` and `shared/lib/sidebarNavSlot.ts` already exist and already
> carry `WorkspaceNav`.
> **His ask, verbatim, on seeing the single sidebar land:** *"hayir, history, filetree vs
> onlari kast ediyorum. ama nasil olacagi konusunda da endiselerim var. umarim guzelce
> yapilabilir."* — no, I mean history, file tree and the like [moving into the sidebar
> too]. But I have concerns about how that would work. I hope it can be done nicely.
> **Recon:** a same-day, read-only pass over `desktop/src/features/runs/ui/{FilesPane,
> HistoryPane}.tsx`, `desktop/src/features/runs/lib/diffLayout.ts`,
> `desktop/src/features/sidebar/ui/{SidebarContextualPane,AppSidebar,SidebarSection}.tsx`,
> `desktop/src/shared/{ui/sidebar.tsx,lib/sidebarNavSlot.ts}`, `WorkspaceNav.tsx`,
> `paneRegistry.tsx`, and the live e2e specs named throughout. Nothing in the recon was
> run or edited; every citation below is from that read, confirmed a second time against
> the current tree (line counts, current spec names) before this plan was written, not
> carried over from a stale fact base.

---

## 0. What exists, and the gap this closes

`2026-08-14-single-sidebar.md` gave the app one sidebar with a contextual lower region
(`SidebarContextualPane.tsx`, 74 lines) that switches on `selectedView`: channel/messages
keep the channel/DM list, `workspace` gets an empty slot element that `RunsScreen` portals
`WorkspaceNav` into (`sidebarNavSlot.ts`, 53 lines, one unnamed module-level slot), the other
four views get a named "no sidebar detail yet" sentence. That closed the *two sidebars at
once* problem for the project/worktree tree.

It did not touch the sidebars-*inside*-panes problem he is now naming directly: Files
(`FilesPane.tsx`, 502 lines) and History (`HistoryPane.tsx`, 452 lines) each still carry
their own list half — a file tree, a status+commit list — living beside their own detail
half inside the Deck's content pane, using the same `diffListPlacement(paneWidth)`
(`diffLayout.ts`, 304 lines) the Diff pane (`WorktreeDiffPanel.tsx`) also uses to decide
when the list yields to the detail view. At his own geometry (1728×1117) the Files/History
pane is ~435px wide today — under the ~503px `diffListPlacement` needs to keep list and
detail side by side — so the list is already the thing losing the fight for space in the
pane itself. His ask is to stop fighting that fight in the pane and move the list into the
sidebar instead, VS Code-style: one Explorer tree, one Timeline/History list, both
collapsible sections under the same Activity Bar the single-sidebar plan already built.

This plan decides which of those list-halves move, what the sidebar's own vertical model
looks like once they do (his named worry), how selection wires from the sidebar's tree to
the pane's full-width detail, and what is torn out rather than kept behind a flag.

---

## 1. Which list-halves move in v1, and which don't

Three panes share the `diffListPlacement` list-yields-to-detail shape: Files, History,
Diff (`WorktreeDiffPanel.tsx:215,497-511`). A fourth, Search, is list-only with no
companion detail of its own.

| Pane | Moves in v1? | Why |
|---|---|---|
| **Files** | **Yes.** | The pane his sentence names first ("filetree"), the simplest of the three (one tree, no shared-box constraint), and the one whose detail half (`FileViewer`) is already a clean, self-sufficient full-width view once the tree leaves — no other pane depends on `FilesPane`'s tree existing. |
| **History** | **Yes, second — built by reusing Files' primitive, not by re-deriving one.** | Same `diffListPlacement` shape, same owner's ask ("history" is literally the second word in his sentence). Task 5 below builds it only after Task 2-4 prove the sidebar accordion primitive on Files; if History needs anything the primitive doesn't already offer, that need is reported and the primitive is fixed generically, not special-cased for History. The one real wrinkle: History's list is **two sections sharing one `PatchView`** (status above, commits below, `HistoryPane.tsx:4-25`, "do not fork the patch component") — both move together as one sidebar section, they do not become two independent accordion entries, because splitting them was already forbidden by name for a different reason (patch-component forking) that still applies once they're in the sidebar. |
| **Diff** (`WorktreeDiffPanel.tsx`) | **No — stays in the pane, not deferred, excluded.** | Diff's `FileList` selection does not just switch a viewer, the way Files/History do — clicking a file there renders that file's patch *inline, in the same pane*, via `PatchView`. A second control (`onShowFile`, `paneRegistry.tsx:196-201`) already exists for "show me the whole file" and takes the user to the *Files* pane for that — Diff's list is not a "door" to itself, it is the pane's own primary content. Moving it to the sidebar would mean either duplicating patch rendering into a sidebar-hosted list (the exact "second renderer" antipattern `workspace-history.spec.ts:640`'s test name already warns about, one layer up) or making the sidebar drive an entire pane's primary view, which is a materially different, larger design question than "move a nav list." Out of scope; a future plan's job if he asks for it explicitly. |
| **Search** (⇧⌘F) | **No.** | Search's list *is* the whole pane — there is no companion detail view to leave behind; Enter already fires `onPaneAct({type:"show-file"})` and opens the result in the Files pane (`SearchPane.tsx:14-19,156-163`) — the exact "a result is a door" pattern this plan reuses for the sidebar's own Files section (§3). Moving Search's list to the sidebar would mean moving the entire pane, not half of one; not this plan's shape. |
| **Runs** | **No** (unchanged from the single-sidebar plan's own conclusion). | `RunsPane.tsx`'s own header already names itself "the pane that fits the host worst" and identifies as `ofWorkspace`, not `ofWorktree` — it isn't per-worktree nav at all. |

**v1, concretely:** the sidebar's `workspace` contextual region gains two new collapsible
sections under `WorkspaceNav`'s existing project/worktree tree — **Files** and
**History** — both scoped to whichever worktree is currently selected. Diff and Search are
untouched; their panes keep their own list halves exactly as they are today.

---

## 2. The vertical model — his named worry, answered with the real numbers

### 2.1 The budget is already nearly spent before either section is added

`SidebarContent` is one `overflow-auto` scroll region holding the pinned header (~52px),
the primary menu (112–220px depending on feature gates), and — for the `workspace`
view — `WorkspaceNav`'s own tree. At the owner's own resolution (1117px tall) that tree
alone, with one repo selected and its worktrees open, already runs **~520–560px**: the
Deck button, the Projects heading, one row per repo (~32px), the selected repo's filter
field, one row per worktree (~32–40px, can wrap), the "+ Add project" row, and any notice
boxes. Available remainder for *everything else* in the contextual region, footer included,
is **~705–889px at 1117px tall** and **~388–572px at a 800px laptop height** — and the
worktree tree by itself already spends 60–95% of that at the smaller size. Two more
sections stacked under it, each with their own header and rows, do not have slack to grow
into at a laptop height; they have to actively make room.

### 2.2 Decision: a single-open accordion across all three sections, not three independent ones

VS Code keeps Explorer, Outline, and Timeline open simultaneously with independently
scrolling, stacking sticky headers. We do not have the numbers for that at 800px, and we do
not have a sticky-header primitive at all — `sidebar.tsx` has none; the only `position:
sticky` anywhere in the sidebar/features/sidebar tree is an unrelated resize-easing comment
and Search's own results-list group header, which is a different, already-scrolling pane.
Building *and proving* a stacking multi-sticky-header system at laptop heights, on the
owner's first pass at this, is more surface than "umarim guzelce yapilabilir" asks for.

**Chosen instead:** the contextual region for `workspace` becomes **one accordion, three
members, exactly one expanded at a time** — Worktrees (today's `WorkspaceNav` tree),
Files, History. Selecting a different member collapses whichever was open; the collapsed
members shrink to a single sticky header row (~32–36px each), not to nothing, so the owner
always sees the other two doors and can open either without hunting. Default: Worktrees
open, same as today — nothing changes on first load. Opening Files or History does **not**
lose the current worktree selection; it collapses the *tree UI*, not the *state* choosing
which worktree is current (§2.4).

The math this buys, at 800px: 3 headers (~32px × 3 = 96px) + one open body. Worktrees'
body is the 520–560px figure above minus its own header (~24px), i.e. ~500–535px — tight
but the same as today, since nothing about the tree itself grows. Files' or History's body
gets the same remaining budget the Worktrees body has today, because only one is ever open.
Nothing here asks the owner's laptop for more vertical pixels than `WorkspaceNav` alone
already asks for today; it asks for ~64–72px more (two collapsed headers) than the tree
costs alone right now.

### 2.3 Sticky headers: only one matters at a time, which is why v1 can afford them

Each of the three headers is `position: sticky; top: 0` **within its own accordion item**,
not stacked against the others — because only one item is ever expanded, "sticky while its
body scrolls past it" is the only sticky behaviour v1 needs, and VS Code's harder problem
(N sticky headers pinning in a stack as you scroll past several *open* sections) never
arises here. If he later asks for multiple sections open at once — closer to VS Code
proper — that is the point where a real stacking-sticky-header primitive has to be built
and separately proven at 800px; call that out explicitly rather than half-build it now.

### 2.4 A new primitive, not a genericized `SidebarSection`

`SidebarSection.tsx` (558 lines) already has the exact collapse/chevron/`aria-expanded`
contract this needs, but it is hard-typed to `items: Channel[]` with channel-specific
rendering (avatar, unread badges, presence, DM participants) throughout. Two candidate
uses (Files, History) is not the third strike — retrofitting it generic now, on the first
time a second consumer shows up, is exactly the premature abstraction "three strikes, then
refactor" warns against, and it would widen the blast radius of a component the entire
channel list depends on for a feature that has nothing to do with channels.

**Chosen:** a new, small, fork-owned primitive —
`desktop/src/features/sidebar/ui/SidebarAccordionSection.tsx` — carrying only the generic
shape: a sticky header (chevron, title, item count), `aria-expanded`/`aria-controls`,
single-open coordination (controlled `openId`/`onOpenChange`, held by the parent), and a
`children: React.ReactNode` body. It does not know what a file or a commit is. If a third
genuinely generic consumer shows up later, *that* is the point to fold `SidebarSection`
onto the same primitive underneath — not before.

---

## 3. Selection wiring

### 3.1 Sidebar → pane, reusing the door that already exists

Search's Enter key already does exactly the thing this plan needs: fire
`onPaneAct({type: "show-file", path, line, worktree: cwd})`, which `RunsScreen` answers by
switching the active pane to Files and opening that file (`SearchPane.tsx:14-19`,
`paneRegistry.tsx:196-201` shows the same act fired the other direction, from Diff). The
sidebar's new Files section fires the identical act on row activation (click or Enter on
the tree's active descendant). If the Deck's active pane is not already Files, it switches
to Files; either way, `FileViewer` opens the file at full pane width — there is no drawer,
no threshold, no `diffListPlacement` call left in `FilesPane.tsx` to consult, because the
tree that call was arbitrating space against is no longer in the pane (§3.2).

History's new sidebar section does the equivalent: selecting a commit or a status-file row
fires an act that switches the active pane to History and opens that patch in the
pane's `PatchView` — same shared-patch-box rule (`HistoryPane.tsx:4-25`) holds, unmoved;
only the *list* that used to sit beside the box moved out.

### 3.2 The pane's old tree half: removed, not hidden behind a setting

Honest deletion. `FilesPane.tsx`'s `FileTree` (lines 407–492 today), its drawer toggle
button, its `drawerOpen` state, the `placement.where === "over"` branch, and its
`diffListPlacement` call all come out — not `display:none`, not a feature flag, not kept
for a "some users might prefer the old layout" hedge nobody asked for. `FilesPane.tsx`
becomes `FileViewer` and nothing else: always full pane width, no placement math, because
there is only one thing left in the pane to place. Same for `HistoryPane.tsx`'s status/log
list once Task 5 lands — `PatchView` remains, the list beside it does not.

`diffLayout.ts` itself is **not** deleted and **not** touched beyond removing the two
callers: `diffListPlacement` keeps its one remaining caller (`WorktreeDiffPanel.tsx`, out
of scope, §1), and the *unrelated* split-render threshold it also exports (the 695px
unified-vs-split check `workspace-history.spec.ts:640` and `workspace-diff-fits.spec.ts`
pin) keeps every one of its callers — that threshold governs how `PatchView` renders a
patch, not whether a list is present, and nothing in this plan changes it. Do not let a
"clean up `diffLayout.ts` now that only one placement caller is left" urge sneak into this
plan's tasks; that is a real, separate, smaller follow-on, explicitly not this plan's job.

### 3.3 Keyboard nav: the exact same logic, remounted, not rewritten

`resolveFileTreeKey` (`lib/filesModel.ts`) and the `role="tree"` /
`aria-activedescendant` wiring (`FilesPane.tsx:420-434` today) move host component along
with the tree — same functions, same tests, new parent. History's `j`/`k`/Enter handling
(`HistoryPane.tsx:87-101`, window-level `keydown`) needs one adjustment: today it is a
window listener because the pane owns the whole screen's key focus while open; hosted in
the sidebar, it must scope to the sidebar section's own focus/hover state instead of a bare
window listener, or opening the History pane's own copy of `j`/`k` (if any survives there)
and the sidebar's copy will both react to the same keystroke. State which one wins
explicitly during Task 5 rather than leaving two listeners to race.

---

## 4. Interaction quality bar

- **No layout jump:** the accordion is single-open by construction (§2.2), so collapsing
  one member and expanding another is the only motion that ever happens — nothing *outside*
  the three-member accordion moves (the fixed header and fixed footer are untouched
  regions), and the motion within it is exactly the member the owner clicked, not a
  side effect landing somewhere else. No entrance/exit animation is required to satisfy
  this — a deterministic, instant swap already satisfies "nothing moves that he didn't
  touch"; do not spend budget on animating the collapse for v1.
- **Tree/list state survives pane switches:** this falls out of the architecture rather
  than needing its own code. The sidebar's Files/History sections are siblings of the
  Deck's pane content (same relationship `WorkspaceNav` already has to `RunsScreen`,
  §0) — switching which pane tab is active in the Deck does not unmount the sidebar, so
  expanded directories, scroll position, and which accordion member is open all survive a
  pane switch for free. State this as a design win of the move, not merely a constraint
  satisfied.
- **Keyboard nav preserved:** §3.3.
- **Resize: fixed proportions, no drag handle, in v1.** The vertical budget is already
  tight at 800px (§2.1); a draggable split between accordion members invites configurations
  that don't fit on screen at all at laptop height, and the single-open model already gives
  the open member the entire remaining budget without a manual handle. If he wants
  per-section drag-resize after using v1, that's a v2 ask with its own math to work out —
  don't pre-build it speculatively now.

---

## 5. Migration honesty

**Specs pinning today's behaviour that this plan's tasks must re-run, not skip:**

- `workspace-files.spec.ts` — "the tree walks under the arrow keys and opens a file under
  Enter" (line 443), "the Files pane is reachable from the palette and from the pane
  picker" (line 425), "an opened file is really highlighted…" (499), "the viewer opens
  from outside the pane — a patch's file, shown whole" (653). All of these must still pass
  with the tree relocated; several assert on selectors that live inside `FilesPane.tsx`
  today and will need updating to the sidebar's testids, which is exactly the kind of
  test-id change that must be reported, not silently reconciled.
- `workspace-history.spec.ts` — "nothing in the pane offers a mutating action" (line 453)
  must still hold once the list moves: the mutating-verb absence rule cannot leak back in
  via the sidebar-hosted list having a control the pane version never had. "the split
  toggle is this pane's too, on the same flag and the same floor" (640) and
  `workspace-diff-fits.spec.ts` pin the unrelated split-render threshold (§3.2) — these
  must be shown unaffected by this plan's changes, not merely unmentioned.
- `virtualization.spec.ts` — already carries known red residue at line 146 for the
  sidebar's *own* custom-section drag-reorder, unrelated to this plan; this plan's new
  accordion sections must not add a second, different reason for anything in that file to
  flip, and if the DOM restructuring here changes its pass/fail state at all, that is
  reported explicitly per-task, the same discipline `2026-08-14-single-sidebar.md` §1.5
  already committed to.
- `sidebar-contextual.spec.ts` — the single-sidebar plan's own red-proof spec for the
  `workspace` slot; must keep passing since this plan builds directly on top of what it
  proved.

**Seam entries** (new fragment, `vingilot/seams/pane-nav-absorb.yaml`, following
`single-sidebar.yaml`'s format — header block, then one entry per path):

- `desktop/src/features/sidebar/ui/SidebarAccordionSection.tsx` — new, fork-owned, generic
  single-open accordion-section primitive (§2.4).
- `desktop/src/features/sidebar/ui/SidebarContextualPane.tsx` — widened: the `workspace`
  branch now composes the accordion (Worktrees/Files/History) instead of a bare slot;
  `WorkspaceNav` itself is still portalled in exactly as `sidebarNavSlot.ts` already
  arranges, just as one accordion member's body rather than the whole region.
- Whichever new fork file hosts the sidebar's Files tree and History list bodies (new,
  reusing `lib/filesModel.ts`'s `resolveFileTreeKey` and `HistoryPatch.tsx`'s shared
  `PatchView`, not forking either).
- `desktop/src/features/runs/ui/FilesPane.tsx` — shrinks (tree, drawer toggle,
  `diffListPlacement` call removed); record the honest-deletion, not a flag, explicitly.
- `desktop/src/features/runs/ui/HistoryPane.tsx` — same shrink, Task 5.
- `desktop/src/features/runs/lib/diffLayout.ts` — **not** edited; record explicitly in the
  seam entry that this plan deliberately leaves it alone beyond losing two of three
  `diffListPlacement` callers, and that consolidating its now-thinner caller list is a
  separate, later decision.

**Ratchet exposure:** `FilesPane.tsx` (502 → smaller) and `HistoryPane.tsx` (452 →
smaller) both move away from the 1000-line ceiling, which is pure headroom gained, not
spent. `SidebarContextualPane.tsx` (74 lines today) and `AppSidebar.tsx` (915 of 1000,
already flagged with no headroom by the prior plan) are the ones to watch — this plan's
tasks must not need a second edit to `AppSidebar.tsx` beyond what the single-sidebar plan
already made; everything new lives in `SidebarContextualPane.tsx` and the new accordion
files, exactly the same reasoning the prior plan used to keep `AppSidebar.tsx`'s edit to a
dozen lines.

**Blast radius, stated plainly:** touches `FilesPane.tsx`, `HistoryPane.tsx`,
`SidebarContextualPane.tsx`, adds 2-3 new fork files, adds one new seam fragment. Does
**not** touch `AppSidebar.tsx`, `AppSidebarPinnedHeader.tsx`, `CommunityRail.tsx`,
`WorktreeDiffPanel.tsx`, `SearchPane.tsx`, `diffLayout.ts`'s logic, `RunsPane.tsx`,
`sidebarNavSlot.ts`'s mechanism (still one unnamed slot — the accordion composes
`WorkspaceNav` alongside the new sections *inside* `SidebarContextualPane`'s `workspace`
branch, the same "Deck composes one element into one slot" precedent the prior plan's §5
already established; this is not the point at which `sidebarNavSlot` needs to become a
keyed registry, since there is still exactly one thing portalled through it), `⌘B`/⇧⌘B`
chord state (already retired, not reopened here), or any route/`selectedView` member.

---

## 5.5 Owner amendment (2026-08-14, v0.3.0 hands-on review) — a fourth member: Chats

> **His words, verbatim:** *"deckten geri channellari ve dmleri gormek icin
> agents'a ya da inboxa basmak gerekiyo. direk chatleri acabilecegim ya da deck
> sidebarini kapatabilecegim bi buton yok henuz."*

The accordion gains a **fourth member on the Deck: Chats** — the channel + DM
lists, reusing the EXISTING sidebar channel/DM components
(`ChannelGroupSection`/`SidebarSection` and their props, which already live in
`AppSidebar`'s scope), collapsed by default. Clicking a channel or DM there
navigates exactly as it does from the Inbox — the same `onSelectChannel`.

The channel list components are NOT forked and their props are NOT re-plumbed
into `SidebarContextualPane`: the amendment's own allowance — "render the
existing gated channel fragment as an accordion member via the same slot
idiom" — is the mechanism used. A second slot module
(`shared/lib/sidebarChatsSlot.ts`, mirroring `sidebarNavSlot.ts` with the roles
reversed) is registered by the Chats member's body; `AppSidebar` portals its
existing channel fragment into it whenever `selectedView === "workspace"`.
This costs `AppSidebar.tsx` one small gating edit (the condition widened and
the fragment wrapped in `SidebarChatsHome`, a fork component kept in
`SidebarContextualPane.tsx`), which the amendment sanctions where §5's
"does not touch AppSidebar.tsx" could not have — recorded honestly in
`vingilot/seams/pane-nav-absorb.yaml`.

(⌘B already collapses the whole sidebar — the second half of his sentence — so
no new control is added for it; the chord survives the rework untouched.)

---

## 6. Tasks

### Task 1 — The accordion primitive

- [ ] New file `desktop/src/features/sidebar/ui/SidebarAccordionSection.tsx`: sticky
      header (chevron, title, optional count), `aria-expanded`/`aria-controls`, a
      controlled `openId`/`onOpenChange` pair the parent owns (single-open coordination
      lives one level up, not inside each section), `children` for the body. No channel-
      specific typing anywhere in this file (§2.4).
- [ ] Unit test: only one section's body renders expanded at a time under a shared
      `openId`; toggling one collapses whichever was open, without unmounting the
      collapsed section's own DOM (state inside it — e.g. a tree's expanded directories —
      must survive being collapsed, not remount empty when reopened).

### Task 2 — Wire the accordion into `SidebarContextualPane`'s `workspace` branch

- [ ] `workspace` branch renders three `SidebarAccordionSection`s sharing one `openId`
      state: Worktrees (default open — `WorkspaceNav`'s existing portal slot, unchanged,
      §5), Files, History (bodies from Tasks 3–5). No other branch of
      `SidebarContextualPane` changes.
- [ ] Re-run `sidebar-contextual.spec.ts` before touching it — must still pass unmodified,
      since the `workspace` slot's own contract (one portalled tree, no second column)
      hasn't changed, only what sits above and below it in the same region.

### Task 3 — Absorb the Files tree

- [ ] New fork file hosting the tree body — reuse `resolveFileTreeKey` from
      `lib/filesModel.ts` and the lazy per-directory `readTree` verbatim; do not
      re-derive either. Scope: whichever worktree is currently selected (§2 — reads the
      same selection state `WorkspaceNav` already reads, does not invent a second copy of
      "current worktree").
- [ ] Row activation fires the same `onPaneAct({type:"show-file", …})` act Search already
      uses (§3.1) — confirm by grep that this is the same act shape, not a parallel one.
- [ ] Remove `FilesPane.tsx`'s tree, drawer toggle, `drawerOpen` state, and
      `diffListPlacement` call. Honest deletion (§3.2) — no flag, no dead branch left
      behind "just in case."
- [ ] Update `workspace-files.spec.ts`'s tree-selector assertions to the sidebar's new
      testids; report exactly which lines changed and why, per assertion, not as one bulk
      diff.
- [ ] Red-proof: a spec asserting the Files pane, once opened, is full pane width with no
      tree/drawer in its own DOM — prove this fails against the pre-move build (a tree or
      drawer element is findable inside the Files pane today) before the removal, passes
      after.

### Task 4 — Selection wiring, Files

- [ ] Confirm keyboard nav (`role="tree"`, `aria-activedescendant`, arrow/Enter) reaches
      the sidebar-hosted tree with no behavioural change from `workspace-files.spec.ts`
      line 443's assertions, just a different mount point.
- [ ] Confirm switching worktrees in the Worktrees accordion member updates the Files
      section's scope live (no stale tree from the previous worktree lingering if Files
      happens to be the open member when the worktree changes).

### Task 5 — Absorb History's list (built only after Task 3/4 prove the primitive)

- [ ] New fork file hosting History's status+commit list body, sharing `HistoryPatch.tsx`'s
      `PatchView` with the pane exactly as today — the list moves, the shared box does
      not fork (`HistoryPane.tsx:4-25`, unchanged rule, new location).
- [ ] Resolve the `j`/`k`/window-`keydown` question from §3.3 explicitly: scope the
      listener to the sidebar section's own state, and state in the commit which listener
      (sidebar's or the pane's, if any survives there) wins on a keystroke when both could
      theoretically be mounted.
- [ ] Remove `HistoryPane.tsx`'s status/commit list, keep `PatchView` full width. Same
      honest-deletion rule as Task 3.
- [ ] Re-run `workspace-history.spec.ts` in full, including line 453's "nothing in the pane
      offers a mutating action" and line 640's split-toggle test — report each as passed
      unchanged, passed after a selector update, or newly failing, not as one summary
      "green."
- [ ] If anything here needs the accordion primitive to do something Task 1 didn't build,
      fix the primitive generically and note the addition in Task 1's file — do not fork a
      History-specific variant of it.

### Task 6 — Diff and Search: confirm untouched, don't just assume it

- [ ] Re-run `workspace-diff-fits.spec.ts` and `diff-keeps-up.spec.ts` — must pass
      unchanged; if either regresses, that is this plan's bug even though Diff's own files
      were never edited (shared `diffLayout.ts` is still imported by `WorktreeDiffPanel.tsx`
      and must behave identically after Files/History stop calling it).
- [ ] Re-run `workspace-search.spec.ts` — must pass unchanged; Search's own list-is-the-
      pane shape and its existing door to Files are untouched by this plan.

### Task 7 — The seams fragment

- [ ] Create `vingilot/seams/pane-nav-absorb.yaml` per §5's entry list, following
      `single-sidebar.yaml`'s and `home-harbor.yaml`'s format (header block naming this
      plan, then one entry per path, `removable_when` stated honestly for each).
- [ ] Confirm the glob mechanism (`vingilot/scripts/lib/seam-glob.sh`) picks up the new
      fragment with no manual registration step, same as the prior fragment needed none.

---

## 7. Global Constraints

- **Only one mutating lens** — this Plan document is the only file this session writes;
  Build is the phase that touches code. Do not commit or push from Plan.
- **`rm -rf` forbidden**, any path.
- **Never launch the app, never run a release build.**
- **1000-line ratchet: split, never raise.** `AppSidebar.tsx` still has no headroom; this
  plan's tasks must not need to touch it at all (§5).
- **Island + seams discipline.** Every new fork file needs a seam entry (Task 7); the two
  shrinking upstream-adjacent files (`FilesPane.tsx`, `HistoryPane.tsx`) are fork-owned
  already (`desktop/src/features/runs/**` blanket seam) and don't need new entries beyond
  noting the shrink in the fragment's prose.
- **Chord discipline.** No new chord. `⇧⌘B` stays retired.
- **rem tokens only** for any new text; `pnpm check:px-text` is the gate.
- **An empty read is "no answer," never "nothing there."** If the Files/History accordion
  members are ever empty (no worktree selected, no commits yet), they must say so, the same
  rule the single-sidebar plan's placeholder already follows — do not let an empty
  accordion body render as a blank space with no sentence.
- **A test must be able to fail.** Every red-proof above shown red before the fix, green
  after, sequence reported.
- **Known red residue, not this plan's to fix:** `virtualization.spec.ts:146` (sidebar
  section drag-reorder — watch, don't fix, per §5), composer block-format caret,
  own-message avatar, huddle voice menu, video speed menu, boot-mark light theme,
  `workspace-find`, `channels:2736`, community-rail flakes, relay-reconnect flakes.
- **Gates to real exit codes.** `desktop/`: `pnpm biome check --write src`,
  `pnpm check:px-text`, `pnpm test`, `pnpm tsc --noEmit`. E2E: `pnpm test:e2e:smoke` — kill
  port 4173 first, build with `pnpm build:e2e` never plain `pnpm run build`. Repo root:
  `./vingilot/scripts/check-seams.sh`.
- **No commit stamped inside 08:00–18:00 Europe/Istanbul** — set `GIT_AUTHOR_DATE` /
  `GIT_COMMITTER_DATE` explicitly.
- **Never `git add -A`** on this branch; audit the file list before every push.

---

## 8. Self-Review

**Riskiest:** the single-open accordion silently eating a section the owner didn't mean to
close. Opening Files while he's mid-browse of the worktree list, or opening History while
Files has an unsaved scroll position, collapses the other two to header-only — correct by
design (§2.2), but only if the owner reads it as "I opened this," not as "my file tree
disappeared." The particular failure mode to watch for in Build: switching the *current
worktree* from the (now-collapsed) Worktrees header while Files is the open member. §4
requires the Files section's scope to follow live, but if the Worktrees member is collapsed
when that switch happens, there is no visible feedback that the switch even registered
until the owner reopens Worktrees or notices Files' contents changed underneath him. A
red-proof for this exact sequence — collapse Worktrees by opening Files, change worktree via
some other route (palette, a run card), confirm Files' tree updates to the new worktree
without requiring Worktrees to be reopened — is the test this plan's riskiest claim rests
on, and it is not explicitly listed as its own task above; Build should add it under Task 4
rather than treating Task 4's existing bullets as covering it by implication.

**Most likely to be got wrong quietly:** the keyboard-listener collision in History (§3.3,
Task 5). `HistoryPane.tsx`'s `j`/`k` binding is a *window*-level listener today, deliberately
duplicated from Diff's rather than shared (`HistoryPane.tsx:87-101`). Once the list moves to
the sidebar but `PatchView` stays in the pane, there are two plausible owners for `j`/`k` —
the sidebar list (which rows should the keys walk?) and whatever is left in the pane (is
there anything left to walk once the list is gone, or does the pane no longer bind `j`/`k`
at all?) — and "duplicate the binding, deliberately, the way Diff and History already do
today" is exactly the pattern that produces two listeners answering the same keystroke if
this isn't resolved with a stated, single owner before Task 5 is called done. A component
compiling with no visible bug is not evidence this was decided correctly; only a test that
presses `j` once and asserts exactly one thing moved is.

**Third, worth naming rather than assuming away:** `diffLayout.ts`'s `diffListPlacement`
goes from three callers to one (Diff alone) once Files and History stop calling it. Nothing
in this plan asks anyone to notice that a three-consumer abstraction quietly became a
one-consumer function with two unused generality knobs (`LIST_MIN_PX`, `LIST_LEAVES_BELOW_PX`
tuned for three different panes' widths) — that is not a bug this plan introduces, but it
is exactly the kind of drift that looks fine at every individual commit and only reads as a
smell in aggregate. §3.2 already forbids treating that cleanup as in scope; Build should
still say the sentence out loud once Task 6 confirms Diff is the sole remaining caller,
rather than letting the fact go unremarked because no task named it.
