# One column, and two loose ends

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Branch:** `vingilot/one-column` off `main`.
> Runs alongside `2026-08-11-what-sent-him-to-vscode.md`, which owns search, the file
> tree and source control. Nothing here touches those surfaces.

**Goal:** the workspace spends too much of a 16-inch screen on chrome, a tmux session can
outlive the worktree it was opened on, and the app has no way for an agent that Vingilot did
not launch to speak into the team thread.

> *"bizim çok yer kaplayan 2 hatta 3 sidebar'ımız var. burayı düzeltmemiz lazım. elegant bir
> şekilde… ayrıca sildiğim worktree'lerin tmux terminali de silinsin."*

---

## Task 1 — One column where there were two

Measured, not guessed: `ProjectsNav` is `w-48` (192px) and `WorktreeColumn` is `w-56` (224px),
side by side and both always mounted inside a project. That is **416px of navigation** before
the work surface begins, and upstream's own `SidebarProvider` rail can sit left of both — the
third one he counted. On the 1728pt logical width of his 16-inch MacBook Pro that is a quarter
of the window spent on two lists that are read once per context switch.

Only `WorktreeColumn` collapses today (⇧⌘B, `useColumns.ts`); `ProjectsNav` has no collapse at
all.

- [ ] **Merge the two into one column.** Projects are the rows; the selected project discloses
      its worktrees beneath it, indented, in place. One border, one scroll container, one
      width. This is the shape the reference he sent uses (Spotify's Xirp: repositories with
      their sessions nested under them, one rail) and it is the shape the data already has —
      `grouped.byRepo` is exactly a project-to-worktrees map.
- [ ] **Do not lose what the second column carries.** Read `WorktreeColumn` before deleting a
      line of it: attention dots, `stats` (the numstat badge), the ⌘1…9 ordinal hints, the
      create/prune affordances and their dialogs, and the "unreadable project" refusal all live
      there. Each one either survives into the merged column or is a stated, reasoned removal.
      A merge that quietly drops the prune entry point is a regression with a nicer border.
- [ ] **Collapse the whole thing, not half of it.** ⇧⌘B collapses the merged column to its
      rail; ⌘B stays upstream's sidebar. Remembered per project exactly as now
      (`columnLayout.ts`) — and migrate, or deliberately discard, the `worktrees` key already
      stored under the old shape. Say which.
- [ ] **The palette entry follows.** `paletteSources.ts:330` labels the toggle from
      `worktreesCollapsed`; that label now describes a different object and must say so.
- [ ] Widths and paddings come from the recorded type scale; no arbitrary text-size literals
      (`pnpm check:px-text` is the gate).
- [ ] A spec at **his** geometry (the same width Task 1 of the vscode plan pins) asserting the
      work surface gains the width the second column gave up. "It looks roomier" is not a test.

## Task 2 — A tmux session must not outlive its worktree

What is already true, verified before writing this: `pty_close` ends the tmux session as well
as the pty (`vingilot_pty/mod.rs`), and `RunsScreen` calls it on all four paths it knows —
worktree removed, project removed, tab closed, and worktree gone from git's listing once
`worktreeActions.settled`. On this Mac, all twelve live `vingilot_*` sessions map to worktrees
that still exist, so those paths are working.

**The gap is everything that is not one of those four.** Every one of them starts from the
saved tab layout in the webview's local storage. A layout that is lost — a fresh install under
a new bundle identifier, cleared storage, a machine where the app was replaced rather than
updated — takes with it the only reference to those sessions, and the shells run until the
Mac reboots with nothing left that knows their names.

- [ ] **Sweep on start, from tmux's own listing rather than from app state.** `session_name`
      in `tmux.rs` is deliberately injective and reversible; write its inverse, prove the round
      trip with a test, and use it to read a live session's binding id back out.
- [ ] **Sweep `local:<path>` bindings only.** A local worktree's binding id *is* its path
      (`worktreeGit.ts`), so its existence is checkable. `main:<repo id>` names a project's own
      checkout, which is never removed by a worktree action and whose sessions the
      project-removed path already ends — leave them alone and say so in the code.
- [ ] **An unmounted volume is not a removed worktree.** His projects live on
      `/Volumes/ugreen` as well as the internal SSD. A missing path under a missing mount point
      must read as *no answer*, not as *nothing there*: sweep a path only when its **parent
      directory exists and the path does not**. Test both — a removed worktree beside a live
      parent (swept) and a whole missing tree (kept).
- [ ] Log what was ended, by name. A sweeper that kills silently is indistinguishable from a
      sweeper that is broken.

## Task 3 — Let an agent speak into the team thread

His own framing, and the shape is already half-built:

> *"bir mcp tarzı bir şey mi yapsak, claude code team kısmına mesaj atıp cevap alabilse mi ne?"*

`crates/buzz-acp/src/broker.rs` already carries exactly one operation — `send_message` — over a
0600 unix socket, and exists because the harnesses strip the environment agents would otherwise
read their credentials from. `buzz-cli` already sends and reads threads. What is missing is a
door a Claude Code the app did not launch can be pointed at (`claude mcp add`), and a way to
*wait* for an answer, which a CLI does badly and a tool call does well.

- [ ] **Read before designing.** `buzz-dev-mcp` is an existing MCP server in this repo; the
      broker is an existing socket protocol with a refusal vocabulary. Say which of the two this
      builds on and why, rather than starting a third mechanism.
- [ ] Three tools, no more: post to the thread, read it back, and wait for a reply with a
      **bounded** timeout that returns "no answer yet" rather than holding the agent's turn open.
- [ ] The same refusals the broker already names apply: no identity disclosure, no arbitrary
      signing, no relay proxying. An MCP server is a wider door than the socket; it does not get
      a wider grant.
- [ ] **Say what a work machine sends.** This is the surface most likely to carry a repository
      path or a branch name off the machine. The scope sentence the team thread already shows
      is the model; whatever this posts must be enumerable in the same way.

---

## Global Constraints

- **`rm -rf` forbidden**, any path, including test teardown.
- **Never launch the app or any GUI**; **do not run a release build.**
- Read-only against his real repos: no `git checkout`, no `git clean`, no `git reset`, no stash
  pop. **Never touch the default tmux socket** except through the app's own prefixed names, and
  never kill a session this repo did not create. Never kill a process you did not start.
  **Nothing outside this repo.**
- Never `git add -A`; never amend, rebase, or force-push. Trailers `Signed-off-by` then
  `Co-authored-by`; `git commit -F`, never `-s`.
- **No commit may be stamped inside 08:00–18:00 Europe/Istanbul.** Set `GIT_AUTHOR_DATE` and
  `GIT_COMMITTER_DATE` on every commit; map a time in that window onto the same day's
  `[18:00, 23:00)` and never let a later commit take an earlier stamp than the one before it.
- Island-first; anything outside `desktop/src/features/runs/**` and `vingilot_*/**` needs a
  `vingilot/seams.yaml` entry with a true, specific reason.
- **An empty read is "no answer", never "nothing there."**
- **A test must be able to fail** — prove each new test red by breaking what it guards.
- Run `cargo clippy --all-targets -- -D warnings` yourself; the fork's CI builds a `.dmg` and
  runs no lints.

## Self-Review

**Riskiest:** Task 2's sweeper. It is the one thing here that destroys state, it runs without
being asked, and its input is a directory listing — the exact shape that has produced a wrong
confident answer three times in this project already. The parent-exists guard is not a nicety;
it is what stands between a detached external disk and every shell on it being killed at the
next app start. If that guard cannot be tested, the sweeper does not ship.

**Most likely to be got wrong quietly:** Task 1's merge. Two components' worth of affordances
collapsing into one is how a feature disappears without anyone deciding to remove it. The
checklist above names them; a diff that does not account for each one is incomplete regardless
of how it looks.
