# Panes and Polish — the workspace stops looking like a prototype

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Branch:** `vingilot/panes` off `vingilot/workspace-v1`.

**Goal:** Take the working skeleton the owner just ran and make it a place he wants to be. Two
halves: **stop showing him things that are wrong** (bugs, vestigial UI, a worktree column that
buries the signal), and **build the one abstraction his whole wishlist reduces to** — a
selectable, resizable right pane.

**The owner's screenshot, 2026-08-07 10:57, is the source for everything in the polish half.**
It is a real first run, not a harness capture. Read the findings below as observations from it.

---

## The idea the wishlist reduces to

His list was: split view, worktree column that lives, tab identity, terminal search, ⌘K,
a `/btw`-style ask popup, a Plan tab fed by chat, Notes, agent-team chat, "choose what goes on
the right", resizable split, LSP, Docker visualisation, plugins, source control.

Most of that is one thing. **The right side of the split is a slot; everything else is a pane
that plugs into it.** Diff is a pane. Plan is a pane. Notes is a pane. Agent chat is a pane.
Docker status is a pane. The "plugin system" he asked about at the end *is* this slot, named
honestly — which is exactly why it must not be frozen into a public API yet. Build the slot,
write four panes against it, and only then look at what the fifth one needs.

So: **the pane host comes first, and every later feature is a pane.**

---

## Deliberately not now, and why

- **LSP.** A language-server lifecycle plus per-language config is a large commitment whose
  payoff is editing code. ADR-scope for this app says no editor (2026-08-07 plan, Self-Review).
  Adding LSP would quietly reverse that decision instead of taking it. Revisit only if the
  owner decides he wants an editor, as its own conversation.
- **Docker container visualisation.** The underlying need is almost certainly *"is my stack
  up?"* — a small status pane, not a Docker UI. It ships as a pane later, scoped to that.
- **A plugin API.** The pane host is the extension point. Freezing an API before four panes
  exist freezes the wrong one.
- **Source control (stage/commit/push).** Genuinely wanted and moderate, but it is a pane, so
  it waits for the host.

---

## Global Constraints

- Trailers: `Signed-off-by` FIRST, then `Co-authored-by`. Commit with `git commit -F <file>`,
  **never `-s`** (it appends a duplicate after Co-authored-by — that mistake is already on the
  previous branch four times).
- **`rm -rf` is forbidden, for any path, anywhere, including in generated scripts and test
  teardown.** `git worktree remove` for worktrees; named files only otherwise.
- Never `git add -A`. Never amend another session's commits. Never kill a process you did not
  start.
- Island-first: `desktop/src/features/runs/**`, `desktop/src-tauri/src/vingilot_*/**`,
  `vingilot/**`. Anything else needs a `vingilot/seams.yaml` entry with a real reason.
- Gates before every commit: `cd desktop && pnpm check && pnpm typecheck && pnpm test`;
  `cargo check` and `cargo fmt --check` on `desktop/src-tauri/Cargo.toml`;
  `./vingilot/scripts/check-seams.sh` exit 0.
- No `unsafe`; no new `unwrap()`/`expect()` outside `#[cfg(test)]`. Stock rem Tailwind tokens.
  File at its size cap may not grow — split it.
- **A session id crosses three alphabets** (tmux names, Tauri `is_event_name_valid`, the
  coordinator). A `#` separator once killed every terminal while 4000 tests stayed green,
  because the e2e bridge stubs `invoke`. Any change to id derivation needs a test against all
  three.

---

## Task 1 — The three bugs in the screenshot

### 1a. The replay re-asks questions, and the answers land on his command line
Visible as `1;2c0;276;0c` typed at the prompt. `scrollback.rs` retains **raw bytes and replays
them verbatim** — including terminal *queries* (DA1 `ESC[c`, DA2 `ESC[>c`, DSR `ESC[6n`,
XTVERSION, OSC 10/11 colour queries). xterm answers each one, but the program that asked is
long gone, so the answer arrives at an idle shell as typed input.

**The principle:** a replay may repeat what was *shown*; it may never repeat a *question*.
Output is idempotent, queries are not.

- [ ] Red: a scrollback containing DA1/DA2/DSR/XTVERSION/OSC-query sequences replays the
      surrounding text and **none of the queries**; a query split across two pushes is still
      caught; text that merely resembles one (a literal `ESC[c` inside a here-doc the shell
      echoed) is handled per whatever rule you choose — state the rule.
- [ ] Green: strip queries on the way *into* the ring, not on the way out (cheaper, and the
      ring then holds only replayable bytes by construction).
- [ ] Commit `fix(pty): a replay repeats what was shown, never what was asked`.

### 1b. tmux's own status bar is showing
The green bar (`[vingilot] 0:zsh*` … `Ahmets-Mac-mini.local 10:57`) duplicates the app's own
status bar and costs a row of terminal.
- [ ] Pass `set -g status off` for the sessions this app creates — **scoped to our sessions
      only**, never to the owner's global tmux config. Verify a session created outside the app
      is unaffected.
- [ ] Commit `fix(pty): our tmux sessions do not draw a second status bar`.

### 1c. A floating avatar badge sits on top of the terminal
The blue `A` circle in the terminal area belongs to another feature (presence/agent avatar) and
is painting over the work surface.
- [ ] Find what renders it and why it reaches this screen. Fix at the cause, not with a
      z-index patch. If it is upstream's and genuinely belongs elsewhere, say so.
- [ ] Commit `fix(runs): nothing floats over the terminal`.

## Task 2 — Delete what the old screen left behind
All from the same screenshot:
- [ ] **"All runs"** header above the project list — vestigial; the column lists projects.
- [ ] **"STOP"** button, top right — belongs to the old Runs screen, not to a project view.
      Confirm what it stops before removing; if it still has a job, it needs a home that makes
      sense, not a corner.
- [ ] **Window title "Buzz Dev (deck)"** — should name this product and this screen.
- [ ] Sweep for other leftovers: strings, testids, dead props, unreachable branches.
- [ ] Commit `fix(runs): remove what the Runs screen left behind`.

## Task 3 — A worktree column that answers its own question
The screenshot shows **eleven** `run/*` worktrees, every one "clean", every one from a dead
executor run. This column exists to answer *"what is happening right now?"* and currently
buries it. In a week it is fifty.

- [ ] Dead run worktrees (owner run finished, tree clean, no session) **collapse** behind one
      row — `9 finished runs` — expandable. They are not deleted; nothing here deletes.
- [ ] Order by what deserves attention: dirty first, then running, then clean. The main
      checkout stays pinned at the top regardless.
- [ ] Real `+/−` per row (Task 7's diff read already computes it — reuse, do not recompute) and
      a dirty marker that is visible without reading text.
- [ ] Filter/jump box once a project has more than ~8 worktrees.
- [ ] A **prune** action for worktrees git itself reports prunable — `git worktree prune`, which
      removes bookkeeping, not directories.
- [ ] Tests over a real temp repo for ordering, collapsing, and the prune classification.
- [ ] Commit `feat(runs): the worktree column shows what needs you first`.

## Task 4 — The pane host: a selectable, resizable right side
**This is the task the rest of the wishlist depends on.**

- [ ] A **pane registry**: `{ id, title, icon, component, availability }`. Panes declare
      whether they are available for a given worktree (a Diff pane is meaningless without a
      repo; an Agent pane without a harness must say so rather than render broken).
- [ ] The work surface becomes **left pane + divider + right pane**. Left defaults to Terminal.
      Right is chosen from the registry by a picker on the pane's own header — not a global
      tab bar, because the whole point is that the two sides are independent.
- [ ] **Resizable divider**: drag, double-click to reset, keyboard-adjustable. The ratio
      persists per worktree, alongside the tab layout.
- [ ] Collapse the right pane entirely (terminal full-width) and restore it — the owner's
      current layout must remain reachable in one gesture.
- [ ] Panes at v1: **Terminal**, **Diff**, **Runs**, **Evidence** (the existing four, ported
      to the registry — porting them IS the proof the abstraction is right).
- [ ] The pure layout model (which pane where, ratio, collapsed) lives in `lib/` with tests;
      the components only render it.
- [ ] **Do not design a plugin API.** The registry is internal. Note in the code that it is
      the intended extension point and that it stays internal until more panes exist.
- [ ] Commit `feat(runs): choose what sits beside your terminal`.

## Task 5 — Tab identity and terminal search
- [ ] A tab shows what is running in it: the foreground process name where obtainable, falling
      back to the shell. Renameable by the owner, and a manual name wins over the derived one.
- [ ] `⌘F` searches the terminal's scrollback (xterm's search addon — check whether it is
      already a dependency before adding one; if it needs adding, declare the seam).
- [ ] Copy mode / select-all that does not fight tmux.
- [ ] Commit `feat(runs): know which terminal is which, and find things in it`.

## Task 6 — Collapsible chrome, on VS Code's shortcuts
The owner, 2026-08-07: *"sol tarafı da VS Code shortcutları ile küçültebilsek sidebar'ı güzel
olur. çünkü ben normalde VS Code'da sidebar'ı sağda kullanıyorum ve sık sık açıp kapatıyorum
yer kaplamasın diye."*

Read that carefully: he does not want a wider sidebar, he wants it **out of the way most of
the time and back in one keystroke**. That makes the toggle the feature and the animation
irrelevant.

- [ ] **`⌘B` toggles the sidebar** (VS Code's binding for exactly this). Check first whether
      upstream's `AppSidebar` already has a collapse mechanism — if it does, bind to it rather
      than building a second one, and the seam is one line. If it does not, the collapse state
      belongs to the island and the seam must be as small as it can be.
- [ ] **`⌥⌘B` toggles the right pane** (VS Code's secondary sidebar), so the two sides of the
      workspace collapse with the two shortcuts his hands already know. This is the same state
      Task 4 already persists — bind, do not duplicate.
- [ ] The worktree column collapses too, with its own binding. Three columns, three toggles,
      and a terminal that can be full-screen without leaving the app.
- [ ] Collapsed state persists across restart, per project — coming back should look like how
      he left it.
- [ ] **Sidebar on the right is out of scope for this task, and worth saying why:** he puts it
      right in VS Code, but here the sidebar's right-hand neighbour is the pane slot, which is
      the thing he asked to be selectable. Moving the sidebar right would put two configurable
      surfaces on the same edge. Revisit once he has lived with the pane host — the answer may
      be that the sidebar becomes a pane.
- [ ] Pure key resolution in `lib/` with tests, following `terminalKeys.ts`. Check for
      conflicts with upstream's existing bindings before claiming any of these.
- [ ] Commit `feat(runs): collapse any column, on the shortcuts your hands already know`.

---

## What comes after this branch (recorded so the order is not re-litigated)

1. **⌘K command palette** — the connective tissue: jump to project/worktree/pane, run an
   action. The `/btw` ask-popup is a *mode* of this palette, not a second surface.
2. **Plan pane** + the tool that turns a plan agreed in chat into a worktree under a project.
3. **Notes pane.**
4. **Agent pane** — real ACP. Currently a `/bin/sh` stub because no adapter is installed
   (`claude-agent-acp`, `codex-acp`, `goose` are all absent on this machine, and `claude -p` is
   forbidden). Needs an install decision from the owner first.
5. **Source control pane** — stage/commit/push on top of the existing diff read.
6. **Stack status pane** — the honest version of "Docker visualisation".

## Self-Review

**Riskiest task:** 4. A pane host that is wrong is worse than no pane host, because five later
features inherit its shape. The mitigation is porting all four existing surfaces onto it in the
same task — if any of them fits badly, the abstraction is wrong and that is visible immediately
rather than in three features' time.

**Most likely to be underestimated:** 1a. Stripping terminal queries from a byte stream means
parsing enough of the escape grammar to know where a sequence ends, and the ring already
retains raw bytes across arbitrary read boundaries. The split-across-pushes case is the real
work; the happy path is easy and will look done before it is.
