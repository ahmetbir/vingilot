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
      the file so the once survives a restart.*
- [x] Tests: the pure model (store, add, remove, seed-once, push-when-reachable) proved
      red-first, including the case that matters most — **a machine that has never seen a
      coordinator can add a project and still has it after a restart.**
      *38 in `localProjects.test.mjs`, 6 over real temp directories in `vingilot_projects`.*

## Task 2 — "Unreachable" stops lying on a machine that never had one

`UnreachableBanner` says *"control plane unreachable — read-only since 2:08:55 PM"*. On his
work Mac that sentence is false in the way that matters: nothing became unreachable, and
nothing is being read from. It reads as a fault to be waited out, so he waited.

- [ ] Tell the two states apart and say each honestly: a coordinator that answered and then
      stopped (the current sentence is right there), versus **no control plane configured on
      this machine at all** — which is not an error, is not temporary, and should say what is
      and is not available rather than counting seconds since a failure.
- [ ] Retrying forever against something that was never there is noise. Decide the retry
      policy for the never-configured case and say what you chose.
- [ ] Whatever is genuinely unavailable is named: runs cannot start. Everything else must not
      advertise itself as broken — the banner is not permitted to imply the workspace is
      read-only when terminals, worktrees, diffs, notes and the thread all work.
- [ ] Tests on the pure derivation of which sentence applies, proved red-first.

## Task 3 — Prove it the way he hit it

- [ ] A Playwright spec over a real bundle with **no coordinator at all**: the workspace
      opens, a project can be added, it survives a reload, worktrees list from git, and the
      banner says the never-configured sentence rather than the outage one. Proved red first.
- [ ] Check what else assumes the control plane before he finds it: run the workspace specs
      with the coordinator stubbed absent and report anything that breaks or renders a lie.
- [ ] `workbench.md`: what needs the coordinator and what does not, where the project list
      lives, the one-direction rule, and the seed-once behaviour.
- [ ] Owner checklist: install, add a project with no coordinator running, restart, confirm it
      is still there; then on the Mac mini confirm his existing projects are intact and that
      runs still work.

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
