# Signals, and a dashboard worth landing on

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Branch:** `vingilot/dashboards` off `vingilot/keys-and-type`.

**Goal:** The owner asked on 2026-08-09: *"dashboardlar, visualisationlar istiyorum"*, and pointed
at two products whose logic he likes — nodeterm and VelaTerm — saying *"fikirden alıntı
yapabiliriz"*. What he is pointing at, concretely, in both:

- **VelaTerm:** status dots per session in the sidebar — green *working*, yellow *needs you*,
  magenta *replied and unseen* — plus OS notifications when an agent stops and waits, and live
  diffstat on the focused session.
- **nodeterm:** agent badges ("RUNNING / NEEDS YOU"), OS notifications when a turn completes,
  every project doubling as a live board of sessions.

The common idea is not charts. It is **the workspace answering "where is my attention needed"
without being asked, from across the room.** That is the product being built here; the tasks
below are that idea applied to what this workspace already knows.

**Borrow the logic, not the chrome.** Everything below must be grounded in a signal the app
actually has. A dot that guesses is worse than no dot — it trains the owner to ignore the
surface. Every state in Task 1 names its source of truth; a state without one is not shipped.

---

## Task 1 — Attention dots: worktree rows, and a project rollup

- [x] **Inventory first, report before building:** every live signal the island already holds.
      A survey (2026-08-09) mapped eleven; verify and extend, don't re-derive: `Attention` is
      exactly three derived states (`worktreeAttention.ts:43`, dirty/running/clean, recomputed
      per render); `WorktreeStat` polls at 5 s with a single-flight guard and never blanks on
      failure (`useWorktreeStats.ts`); coordinator rows/revision poll at 2 s
      (`usePolling.ts`); the ask slot is one global `AskInFlight {id, cwd}` pushed via
      `useSyncExternalStore` (`askStore.ts:131-140`); the team thread is the only pushed,
      relay-fed signal. For each used signal: source of truth, refresh, what it can honestly
      claim.
- [x] **Known gap, decide it visibly:** there is NO per-session terminal liveness signal —
      tmux backing is probed once per app run and never re-asked, no exit event, no
      `has-session` query. So *working* cannot honestly come from "a terminal is busy" today.
      Either derive *working* from coordinator run status alone (which `Attention` already
      does), or build the liveness plumbing first as its own step — do not infer liveness
      from tab state, which is the app's guess about itself.
- [x] One dot per worktree row, with states derived **only** from the inventory. The candidate
      set, to be confirmed against what is real: *working* (something is running on this
      worktree), *needs you* (an agent waits for input, or an answer arrived and has not been
      seen), *dirty* (uncommitted changes — already tracked), *quiet*. If "working" cannot be
      told from a real signal, it is dropped, not approximated.
- [x] Projects roll up: a project in the sidebar shows the strongest state among its worktrees,
      so the sidebar answers "which project needs me" when collapsed. Precedence is written
      down, not implied.
- [x] Both themes; distinguishable without color alone (shape or position carries the state
      too); each dot's tooltip states the signal it derives from, in words.
- [x] Tests on the pure derivation: every state provable from inputs, precedence proved, and
      the "no signal → no dot" rule proved red-first.

## Task 2 — OS notifications when the workspace needs him

- [x] **Read first — the channel is pre-cut, use it:** `tauri-plugin-notification` is wired
      end to end (`Cargo.toml:117`, registered `lib.rs:131`, granted in
      `capabilities/default.json:18` — main window only) with a frontend wrapper at
      `features/notifications/lib/desktop.ts` and three live call sites (feed mentions, DM
      replies, reminders) as precedent. Nothing under `features/runs` fires one today. Note
      also `features/notifications/lib/sound.ts:26-58`: four `job_*` sound slots exist,
      wired but disabled "coming soon" — if this task's events fit those slots, filling the
      designed socket beats inventing beside it; if not, say why. Report all this confirmed
      before building; a seam is only needed if a capability changes.
- [x] Notify on transitions into *needs you* — an agent waiting, an ask answered — and on
      nothing else. A notification per diff refresh would be noise that costs the channel.
- [x] Never notify about a surface the owner is looking at: focused window + visible worktree
      suppresses. The suppression rule is in one pure function with tests.
- [x] Clicking the notification lands on the thing that needs him, not on the app's last state.
- [x] The whole feature is one setting, default on, discoverable where settings live today.

## Task 3 — The landing view becomes the dashboard

Two landing states exist today: no project selected renders `DeckPane` ("Deck — workspace
home", run composer + pinned + card grid — `ui/DeckPane.tsx`), and a selected project with no
worktree renders a literally blank panel saying "select a worktree"
(`ui/RunsScreen.tsx:882-888`). The dashboard takes both: **the place you stand to see
everything** — Deck grows the triage table below its composer, and the blank panel shows the
same table filtered to that project. One component, two filters, DeckPane's existing idiom
(count-badged uppercase headers, responsive card grid) — not a new pane, not a chart page,
not a second design language.

- [x] All projects × worktrees on one surface: per row — attention dot (Task 1's, same
      derivation, never a second one), branch, diffstat, and last activity the app can
      honestly date (newest of: coordinator revision, stat observation — say which in the
      tooltip). Diffstat comes from `WorktreeStat` (cheap numstat, 5 s poll), **never** from
      `WorktreeDiff` (per-file subprocess patches). Stats are currently narrowed to the open
      project on cost grounds (`RunsScreen.tsx:345-355`, `statTargets`) — widening is small
      but deliberate: state the cost (one numstat per worktree per 5 s) and cap or stagger if
      the worktree count makes that real. No running-terminal count unless Task 1 built the
      liveness signal honestly.
- [x] Everything is a door: click a row, land on that worktree with its panes as he left them.
- [x] Ordering is attention-first (*needs you* on top, then *working*, then *dirty*, then
      quiet), stable within a state. The dashboard's job is triage.
- [x] Empty states answered honestly, each its own sentence: no projects; projects but no
      worktrees; everything quiet ("nothing needs you" is a real answer and a good one).
- [x] Type scale and idiom from `workbench.md` (Tasks 2–3 of the keys-and-type branch recorded
      them). This surface inherits; it does not re-decide.
- [x] Playwright over a real bundle: dashboard renders rows from seeded state, ordering holds,
      a row click lands on the worktree — each spec proved red first.

## Task 4 — Proof and docs

- [x] `workbench.md`: the signal inventory (Task 1's, as a table: state → source of truth →
      refresh), the notification suppression rule, and the landing-is-dashboard decision with
      the nodeterm/VelaTerm provenance noted in one line.
- [ ] The cheatsheet and palette pick up whatever navigation this added, generated as ever.

> Left unticked, with nothing to show for it: this branch bound no chord and added no palette
> command. The board is reached by standing where the owner already lands and clicked with the
> mouse, so `cheatsheet.ts`'s `KEY_MAPS` and `paletteSources.ts` are untouched — there was
> nothing for either generator to pick up. A chord onto the board would need this box again.

---

## Global Constraints

- **`rm -rf` forbidden**, any path, including generated scripts and test teardown.
- **Resource budget:** `df -h /System/Volumes/Data` before any build; **stop below 20 GiB**;
  never a release build; never two heavy builds at once; reclaim only with `cargo clean`.
- **Never launch the app or any GUI** — no `just dev`, no `tauri dev`, no `open`. Proof is
  tests and pinned sources; anything only a human can see goes in an owner checklist.
- **The owner's tmux sessions live on the default socket** — never touch it; isolated-socket
  helpers only. Never kill a process you did not start. **Nothing outside this repo.**
- Never `git add -A` (the tree carries untracked design-sync files that are not ours); never
  amend or rebase. Trailers `Signed-off-by` then `Co-authored-by`; `git commit -F`, never `-s`.
- Island-first; any other path needs a `vingilot/seams.yaml` entry with a real reason. Task 2's
  capability/plugin wiring is the expected seam on this branch.
- **An empty read is "no answer", never "nothing there."**
- **A test must be able to fail** — prove each new test red by breaking what it guards.
- **Run the suites your change touches**, including the Playwright specs beside the unit tests.

## Self-Review

**Riskiest:** Task 1's *working* and *needs you* states. The temptation is to infer "working"
from a heuristic (recent output? a busy cursor?) because the honest signal is fiddly to reach.
A dot that is sometimes wrong poisons the whole surface — the inventory-first step exists so
the decision "drop the state" can be made visibly instead of the heuristic being slipped in.

**Most likely to be got wrong quietly:** Task 2's suppression. Notifications that fire while
he is looking at the very thing train him to swipe them away unread, and the failure is
invisible in tests that never model focus. The suppression rule being one pure function with
its own tests is the deliverable; the plugin call is plumbing.
