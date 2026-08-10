# The workspace stands up without a control plane

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Branch:** `vingilot/coordinator-optional` off `vingilot/dashboards`.

**Goal:** The owner installed the built app on his work Mac and could not use it at all:

> *"the coordinator is not answering — nothing was changed… control plane unreachable —
> read-only since 2:08:55 PM · new runs and transitions disabled · retrying, next in 2s…
> proje ekleyemedim"*

**This is not a bug in his install; it is a gap in the product.** The project list lives in
the coordinator's workspace document (`coordinatorClient.ts:201-216` writes the whole `repos`
array as one CAS mutation), and the coordinator is a development service: Postgres in Docker
on port 5435 plus `cargo run --bin vingilot-coordinator`
(`vingilot/scripts/coordinator-run.sh`). None of that ships in the `.dmg`. So on any machine
that is not his Mac mini, the workspace opens with no projects and no way to add one.

**The decision, made 2026-08-10:** the coordinator becomes **optional**. Everything the owner
actually uses day to day — projects, worktrees, terminals, diff, ⌘K, the cheatsheet, notes,
plan, the team thread — must work with no control plane at all. Runs are the one thing that
genuinely needs it, and their absence is stated in words rather than shown as a workspace
that appears broken.

A remote coordinator was considered and rejected: worktrees are local filesystem paths, so one
control plane serving two machines would be right about at most one of them.

---

## Task 1 — The project list becomes local

- [x] **Read first, report before building:** every path by which a project reaches the
      screen today — `coordinatorClient.ts`'s repos mutation, `lib/projects.ts`, the add and
      remove flows, and what a `Worktree` row needs from a repo. Say which of them the
      coordinator genuinely owns and which merely pass through it.
      *No artifact of its own: the finding is that the coordinator owned nothing here except
      the bytes. `readRepos`/`chooseRepo`/`removeProjectConfirm` were already pure and
      already local, and a `Worktree` row needs only `repo.path` and `repo.id` from a repo —
      `worktreeGit.ts` reads the checkout off the filesystem. Only the storage moved, which
      is why `repoChoice.ts` is untouched by this task. The reasoning is in
      `localProjects.ts`'s header where it stays next to the code it explains.*
- [x] Projects are stored locally and are the authority for what the workspace shows. Prefer a
      file the owner can read and back up over WebKit storage, which a reset clears and which
      is invisible to him — and say where it lives.
      *`~/.vingilot/projects.json`, beside `~/.vingilot/worktrees`. Written by
      `src-tauri/src/vingilot_projects/` (write-then-rename, so an interrupted save leaves
      the old list); read by `localProjects.ts`, which refuses an unparseable file rather
      than reading it as empty. When it cannot be read, `unreadableStoreNotice` says so on
      screen — an empty list with nothing said beside it is what a fresh install looks like.*
- [x] **One direction, never two.** When the coordinator is reachable, the local list is
      pushed into the workspace document so runs can still reference a repo; the coordinator
      never writes back into the local list. Two-way merge between a local file and a CAS
      document is a conflict machine, and this plan does not open it.
      *`pushDecision`. One case does not push either: a coordinator holding a list this
      machine has never taken, against a list started here, is a standoff rather than an
      overwrite (`unreconciledNotice` names the way out). That order is reachable on the Mac
      mini — launch while the coordinator is down, add one project, coordinator comes back
      with five.*
- [x] **His existing projects must not disappear.** On the Mac mini they live only in the
      coordinator today. Seed the local list from the workspace document the first time it is
      empty and the coordinator answers, and say in the UI that this happened. A silent
      import is indistinguishable from a silent loss when it goes wrong.
      *`seedOnceDecision`: never imported before, local list empty, coordinator **answered**
      (not "was polled"), and it has something to import. All four required, each one a way
      to lose or duplicate the list. Said by `importNotice` in `ProjectsNav`, and recorded in
      the file so the once survives a restart. It takes the workspace document rather than a
      list read out of it, which is a correction: it first shipped reading with `readRepos`,
      the lossy reader, so entries this build cannot parse were dropped at exactly the moment
      the coordinator's array became the file the owner is told to back up.*
- [x] Tests: the pure model (store, add, remove, seed-once, push-when-reachable) proved
      red-first, including the case that matters most — **a machine that has never seen a
      coordinator can add a project and still has it after a restart.**
      *41 in `localProjects.test.mjs`, 6 over real temp directories in `vingilot_projects`.*

## Task 2 — "Unreachable" stops lying on a machine that never had one

`UnreachableBanner` says *"control plane unreachable — read-only since 2:08:55 PM"*. On his
work Mac that sentence is false in the way that matters: nothing became unreachable, and
nothing is being read from. It reads as a fault to be waited out, so he waited.

*(It is `ControlPlaneBanner` from here on — `data-testid="control-plane-banner"`, carrying
`data-state="absent" | "outage"`, which is what a spec should assert on rather than the
prose.)*

- [x] Tell the two states apart and say each honestly: a coordinator that answered and then
      stopped (the current sentence is right there), versus **no control plane configured on
      this machine at all** — which is not an error, is not temporary, and should say what is
      and is not available rather than counting seconds since a failure.
      *`controlPlaneKind` in `reachability.ts`: `reachable` / `outage` / `absent`. What tells
      the last two apart is `lastOk` — whether a poll has come back ok since this workspace
      opened. Nothing **configures** a coordinator (the client always talks to
      `127.0.0.1:7117`), so an answer is the only evidence one exists here. A durable "one
      answered here once" record in `projects.json` was declined: that file holds his
      projects, a wrong value in it is permanent, and the fact it buys is only right on a
      machine that HAS a coordinator and was launched before it. The absent state is a muted
      note announced politely, not a destructive box announced assertively — the red box that
      never went away is how he learned to read this as a fault.*
- [x] Retrying forever against something that was never there is noise. Decide the retry
      policy for the never-configured case and say what you chose.
      *It keeps probing, but stops hammering and stops counting at him. `controlPlanePollMs`:
      the 2s cadence holds for the first minute (`ABSENT_SETTLE_AFTER_MS` — a coordinator he
      starts by hand right after launch is picked up at once), then settles to 30s, and
      "Check now" probes immediately at any time. It never stops entirely: `cargo run` on the
      Mac mini can start at any moment, and a state that needs a click to leave is one he
      would not know to leave. The banner never renders a countdown in this state.
      The cadence reaches **every** coordinator poll, which it did not when this box was
      first ticked: three of the five obeyed it and the deck and the run list kept 2s timers
      of their own, so ~83% of the traffic was unchanged and the hammer never stopped under
      a banner saying there was nothing to wait for. `pollMs` is now a prop, carried beside
      `controlPlane` through `PaneProps`, and `controlPlaneCadence.test.mjs` refuses any poll
      in the runs UI that does not take it — the two run-scoped exemptions are named there
      with their reason. Only `RunDetail`/`EvidencePane` are fixed at 2s: both read one run,
      and a run cannot exist on a machine that never had a coordinator.*
- [x] Whatever is genuinely unavailable is named: runs cannot start. Everything else must not
      advertise itself as broken — the banner is not permitted to imply the workspace is
      read-only when terminals, worktrees, diffs, notes and the thread all work.
      *"read-only" is gone from the app; a test asserts neither sentence can bring it back.
      Both name runs as the one thing unavailable and name what still works.
      `reachable: boolean` is gone from the pane chain in favour of the three-state reading —
      a component that only knew `!reachable` could only ever say "unreachable", which is how
      the Deck composer note, both pin notes and the status bar inherited the same lie.
      One clause of this box's own wording did not survive review: the thread is **not**
      local. It is on the relay (`teamThread.ts`), and both sentences said it was. They now
      name the five things that are on this machine and put the team thread where it is — a
      different service, and the one that is down the next time this banner is wrong.*
- [x] Tests on the pure derivation of which sentence applies, proved red-first.
      *31 in `reachability.test.mjs`, over which sentence applies, what each may and may not
      contain, and when the cadence settles — including that neither sentence may put the
      team thread on this machine, in either word order. Each mutation turned exactly the
      intended tests red.*

## Task 3 — Prove it the way he hit it

- [x] A Playwright spec over a real bundle with **no coordinator at all**: the workspace
      opens, a project can be added, it survives a reload, worktrees list from git, and the
      banner says the never-configured sentence rather than the outage one. Proved red first.
      *`desktop/tests/e2e/workspace-no-coordinator.spec.ts`, two tests. Nothing listens on
      7117: every request to it is aborted at the transport, which is what a closed port
      does. The project file is deliberately **not** held in the page — `projects_load` and
      `projects_save` cross into the test process through `page.exposeFunction` — so
      "survives a reload" means what it means on his disk rather than what a surviving React
      tree would mean. The Tauri surface goes in as a property trap in an init script rather
      than by overwriting `invoke` after boot: `projects_load` runs on the first render, and
      a rejection there is remembered for the session as "no local store on this machine".
      Proved able to fail with four product breaks, each rebuilt: `controlPlaneKind` forced
      to `"outage"` (banner test only); the git listing dropped from `withLocalGroups` (the
      `local:` row only); `readLocalProjects` always answering the empty document, so the
      file is written and never read back (the reload assertion only); and `addProject`
      re-gated on a reachable coordinator, the original bug.*
- [x] Check what else assumes the control plane before he finds it: run the workspace specs
      with the coordinator stubbed absent and report anything that breaks or renders a lie.
      *Two findings, and the first is the one that explains the gap.*

      ***Every workspace spec's project fixture IS the control plane.*** *All fourteen
      (`workspace-*`, `deck-two-devices`, `terminal-wheel`, `diff-keeps-up`) get their repos
      out of a mocked `GET /v1/workspaces/{id}`, and not one of them stubs `projects_load`.
      Run against a coordinator that does not answer, they do not fail on their subject —
      they never reach it: `workspace-cheatsheet.spec.ts` was run that way and all 7 tests
      timed out waiting for `projects-nav-repo-<id>`, a row that on the owner's machine
      comes from `~/.vingilot/projects.json`. So the suite could not have caught this and
      still cannot describe his machine; the new spec is the only one that can.*

      ***Two sentences that are still untrue when nothing has ever answered***, found by
      driving every surface with the coordinator absent and a project in the local file.
      Both are empty states that point at an act the same screen has just said is
      impossible, and neither is fixed here — they are reported, not repaired:
      `DeckPane.tsx`'s **"no runs yet — start one above"**, rendered directly under a
      disabled composer and the note "no control plane on this machine — runs cannot start
      here" ("yet" promises they are coming; "above" points at the disabled thing); and
      `RunList.tsx`'s **"no runs — start one from the Deck"** plus its live `+ New run`
      row, which sends him to a Deck that says runs cannot start here. A third, much
      smaller: the palette describes the Deck as "the project-less landing view — runs,
      lanes, the composer", three things that do nothing on this machine.*

      *What was checked and is honest: the banner, the status bar ("no control plane"), both
      pin notes, the projects column, the worktree column (both rows off `worktree_list`),
      Diff, Notes, Plan, the Team pane (relay-backed, correctly unaffected), the cheatsheet
      and the palette's blocked-reason sentences. `RunDetail` and `EvidencePane` still say
      "control plane unreachable" and are exempt for the reason Task 2 named: both read one
      run, and there is no run to open on a machine that never had a coordinator.*
- [x] `workbench.md`: what needs the coordinator and what does not, where the project list
      lives, the one-direction rule, and the seed-once behaviour.
      *A new section, "The control plane is optional", with the needs-it/does-not table (and
      the team thread on neither side of it — it is on the relay), the two banner states and
      the retry policy, where `projects.json` lives and why not `localStorage`, the
      one-direction rule with the standoff case that pushes nothing, and the seed's four
      required facts. Three stale passages went with it: the "Run it" block no longer opens
      with `docker compose up`, `UnreachableBanner` is `ControlPlaneBanner`, and the Notes
      section no longer says `repos` lives in the workspace document.*
- [ ] Owner checklist: install, add a project with no coordinator running, restart, confirm it
      is still there; then on the Mac mini confirm his existing projects are intact and that
      runs still work.
      *Only he can close this one — it is two machines and one of them holds his real
      projects. In order: (1) on the work Mac, with nothing on 7117, open the workspace and
      confirm the banner is the muted "no control plane on this machine" note and not a red
      box; (2) add a project, quit the app, reopen, confirm it is still listed and that
      `cat ~/.vingilot/projects.json` shows it; (3) open a worktree, confirm terminals, diff
      and notes work. Then on the Mac mini, **coordinator running**: (4) launch and confirm
      every existing project is still on screen, and that the seeded-once notice appeared
      exactly once and says how many came across; (5) `cat ~/.vingilot/projects.json` and
      check the count against what he expects — this is the file he backs up from now on;
      (6) start a run and confirm runs still work. The order matters: (4) before (5), and
      nothing on the Mac mini before the work Mac, because the seed only runs once and
      reading it wrong is not recoverable from the UI.*

## Task 4 — Standalone, said out loud

The owner raised this while Task 1 was being built, and it changes what "optional" has to
mean:

> *"iş bilgisayarımdaki şeylerin kaydedilmesini istemem tabi, iş sıkıntı çıkarmasın bana.
> uygulamayı full standalone modunda kullanabilmek isterim, bir upstream'e bağlamadan. aynı
> şekilde personal projelerimi de iş bilgisayarında görmesinler."*

Two directions, and the second is the one that surprises people: joining his personal relay
from a work machine brings his **personal** life onto it. The team-thread channels are named
after his worktrees and carry his paths in their descriptions
(`welcome-team-talon-main`, "about /Volumes/Ugreen-KIOXIA/Projects/talon"), so a work machine
that joins would display a list of his personal project paths.

Established while deciding this, and worth recording so nobody re-litigates it: **the app has
no telemetry.** No analytics SDK, no crash reporter, no phone-home. The only egress is the
relay the owner explicitly joins — plus the animated-avatar feature, which fetches a model
from a CDN when used. Nothing else leaves the machine on its own.

- [ ] A standalone state that is **stated, not inferred**: the workspace says that this
      machine is connected to nothing and that nothing leaves it. He should not have to trust
      an absence — he should be able to read it.
- [ ] Standalone must be **hard to leave by accident**. Onboarding and every empty state must
      not nudge toward joining a community; anything that would connect this machine to a
      relay is a deliberate act with a visible consequence, not a default or a hint.
- [ ] Say what standalone costs, in the same breath and just as plainly: no chat, no team
      threads, no relay agents. A mode that hides its own limits is how someone discovers
      them at the wrong moment.
- [ ] **Do not build encryption-at-rest for the local project list.** It was considered and
      declined: the threat is his personal work being visible on a work machine, and the
      answer to that is not putting it there. FileVault already covers the disk, and an
      app-level layer over data that should not exist locally is a weaker answer wearing a
      stronger costume. If a future task disagrees, it argues with this paragraph.
- [ ] Tests: the pure derivation of the standalone state and its sentences, proved red-first,
      including that a machine with no community configured never renders a sentence implying
      something is broken or pending.

---

## Global Constraints

- **`rm -rf` forbidden**, any path, including test teardown.
- **Do not run a release build.** A fresh `.dmg` is a separate step the owner will ask for.
- **Never launch the app or any GUI.** Proof is tests and Playwright over a built bundle.
- **Resource budget:** `df -h /System/Volumes/Data` before any build; stop below 20 GiB.
- **The owner is using this app for real work on two machines.** His Mac mini's coordinator is
  live and holds his real projects: never wipe, reset, or migrate his workspace document, and
  never `docker compose down -v` anything. Never touch the default tmux socket. Never kill a
  process you did not start. **Nothing outside this repo.**
- Never `git add -A`; never amend, rebase, or force-push. Trailers `Signed-off-by` then
  `Co-authored-by`; `git commit -F`, never `-s`.
- Island-first; anything outside `desktop/src/features/runs/**` and `vingilot_*/**` needs a
  `vingilot/seams.yaml` entry with a true, specific reason.
- **An empty read is "no answer", never "nothing there."**
- **A test must be able to fail** — prove each new test red by breaking what it guards.

## Self-Review

**Riskiest:** the seed-once import. His projects exist only in the coordinator on the Mac mini,
and the first run of this code decides whether he still has them. Seeding at the wrong moment —
before the coordinator has answered, or after a local list was already started — either
duplicates his projects or hides them behind an empty list that looks like a fresh install.
The condition must be exact and must be tested, and the UI must say when an import happened.

**Most likely to be got wrong quietly:** deciding the workspace is "read-only" in more places
than runs. The banner's current wording invites that reading, and a shortcut that gates
add-project, terminals or notes on reachability would leave the work Mac exactly as broken as
it is now, while the tests still pass on a machine that has a coordinator running.
