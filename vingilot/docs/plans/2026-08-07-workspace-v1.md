# Workspace v1 — the environment the owner does not leave

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Branch:** `vingilot/workspace-v1` off `vingilot/projects-terminal`.

**Goal:** Turn the projects/worktrees/terminal skeleton into something the owner can actually
live in for a working day. His words, 2026-08-06: *"bana içinden ayrılmayacağım mümkünse bi
çalışma ortamı hazırlamanı istiyorum. bu ciddi bi iş."*

**What he actually does today** (from four screenshots of his real desktop): reads **diffs** in
VS Code, runs **many concurrent shells** in iTerm2 tabs (one of them a Claude Code session),
builds iOS in **Xcode**, writes in **Obsidian**. Xcode and Obsidian are out of scope and stay
out — a native iOS toolchain and a notes vault are not this app's business, and pretending
otherwise would produce two bad imitations instead of one good workspace. **In scope: projects,
worktrees, persistent multi-tab terminals, and diff review.** Those are the three windows he
would otherwise keep alt-tabbing between.

**Decisions he made 2026-08-06, verbatim:**
1. Sidebar: **Projects** at top level, listing repos. **"Runs" disappears as a front door** and
   becomes a tab inside a worktree.
2. Terminal: **multiple tabs per worktree**, and **sessions survive an app restart**.
3. Everything below ships; he is not bounded by "by morning".
4. ACP agent work is proven **in an isolated scratch repo**, never in his real checkouts.
5. **`rm -rf` is forbidden, for any path, anywhere, including for me.**

---

## Global Constraints

- Trailers per ADR-004 (`Signed-off-by` FIRST, then `Co-authored-by`); `git commit -s -F`;
  never `git add -A`; never amend another session's commits.
- Island-first: `desktop/src/features/runs/**`, `desktop/src-tauri/src/vingilot_pty/**`,
  `vingilot/**`. Every other touched path needs a `vingilot/seams.yaml` entry with a real reason.
- Gates before every commit: `cd desktop && pnpm check && pnpm typecheck && pnpm test`;
  `cargo check --manifest-path desktop/src-tauri/Cargo.toml`;
  `./vingilot/scripts/check-seams.sh` exit 0. Coordinator changes also run
  `./vingilot/scripts/coordinator-check.sh` with
  `COORD_DATABASE_URL=postgres://buzz:buzz_dev@localhost:5435/vingilot_coordinator`.
- No `unsafe`; no new `unwrap()`/`expect()` outside `#[cfg(test)]`. Stock rem Tailwind tokens only.
- **File-size ratchet:** a file at its cap may not grow. Split it; never raise the limit.
- **Deletion rule (hard):** no `rm -rf`, ever, for any path. Remove worktrees with
  `git worktree remove` (it refuses on dirty state — that refusal is the feature). Remove
  named files with `rm <file>`, empty dirs with `rmdir`. Anything that appears to need a
  recursive force-delete is a stop-and-ask, not a judgement call. **This binds generated code
  too**: no script, agent prompt, or cleanup path this plan produces may contain `rm -rf`.
- Never kill a process this session did not start.
- Long commands via Bash `run_in_background` + poll.

---

## The naming collision, and the call I made

**Upstream Buzz already ships a feature called Projects** — `desktop/src/features/projects/`
(60+ files: repos, issues, pull requests, reviews, commit diffs, a workspace tab list) backed
by `project_git*.rs` on the Rust side. It manages **relay-hosted** git repos: clone from the
Buzz relay, branch, open a PR, review it. Its "terminal" (`useOpenProjectTerminal.ts`,
`project_terminal.rs`) launches **Terminal.app** at the checkout — an external window, not an
embedded shell.

That is not what the owner asked for, and not what he works on: his repos are local checkouts
pushed to GitHub. But it means the sidebar would carry **two** things named Projects.

**Call:** the Vingilot island takes the name **Projects** (it is the one the owner opens all
day), and upstream's nav item is relabelled **Repos** — which is literally what it lists,
relay-hosted repositories. One string, one declared seam, nothing deleted, no capability lost,
trivially reversible if he disagrees. Recorded in ADR-001 as a naming decision; **flag it in the
morning report** so he can veto it cheaply.

Rejected: (a) *hide upstream Projects* — loses working PR review and is a much larger touch;
(b) *name the island something else* — he chose "Projects" from a rendered preview and the
sidebar is his, not upstream's; (c) *merge the two screens* — a large touch-point across a
60-file upstream feature, which ADR-001 exists to prevent.

---

## Terminal: what is actually broken

Read `Terminal.tsx` + `vingilot_pty/session.rs` against his report (*"bir daha gelmiyo ya da
persist etmiyo gibi"*). Four distinct defects, in the order they bite:

1. **`fit()` runs while the terminal is hidden.** A background terminal is
   `display:none` (`active ? "flex" : "hidden"`), so its container measures 0×0. The
   `ResizeObserver` still fires and calls `fit()` then `ptyResize(...)`, shrinking the real pty
   to a degenerate size. The shell reflows its output to that size, and the scrollback is
   destroyed before you ever switch back. **This is the "persist etmiyor" bug.**
2. **Reattach replays nothing.** `pty_open` on a live session returns early (correctly — it
   must not spawn a second shell), but the Rust side keeps no scrollback, so a fresh `XTerm`
   attached to a live session renders **blank** until the shell happens to emit again. **This
   is the "bir daha gelmiyor" bug.**
3. **`term.dispose()` without `pty_close`.** Unmounting drops the xterm but leaves the shell
   running and unreferenced by any view. Shells accumulate for the app's lifetime.
4. **Sessions die with the app.** Nothing survives a restart, which is decision 2 above.

**Fix for (4), and it also fixes (2) for free: run each shell under tmux.** tmux 3.6a is already
installed (`/opt/homebrew/bin/tmux`). `tmux new-session -A -s <session>` attaches to an existing
session or creates it, and tmux **redraws the full visible screen on attach** — so reattach shows
real content instead of a blank pane, and the session outlives the app because the tmux *server*
is not our child. Writing our own detachable session server would be reimplementing tmux badly.
**Fallback:** when tmux is absent, spawn the login shell directly and serve reattach from a
bounded in-memory ring buffer; the UI then says so honestly rather than implying persistence it
does not have.

---

## Tasks

### Task 1 — Terminal correctness (do this first; it is the reported bug)
- [ ] Red: `terminalFit.test.mjs` — a pure `shouldFit(el)`-style guard returns false for a
      zero-sized/hidden container, true otherwise. Rust: a session's ring buffer replays what
      was written, is bounded, and drops oldest-first.
- [ ] Green: guard every `fit()`/`ptyResize` behind the visibility check; add a bounded
      scrollback buffer to `PtySession`; `pty_open` on a live session **replays the buffer** to
      the newly attached view instead of returning silently.
- [ ] `pty_close` on real teardown (worktree/tab closed by the owner), never on a mere
      re-render. Prove no orphan shells: open, switch away, switch back, close — count children.
- [ ] Commit `fix(pty): a background terminal keeps its screen, and reattach shows it`.

### Task 2 — tmux-backed persistence
- [ ] Detect tmux once (`tmux -V`), cache the result. Session name derived from the binding id,
      sanitised to tmux's charset and namespaced `vingilot_`.
- [ ] Spawn `tmux new-session -A -s <name> -c <cwd>` when available; plain login shell otherwise.
- [ ] The status bar states which mode is live — "persistent" vs "this session only". **Never
      imply persistence that is not there**, same honesty rule as the isolation copy.
- [ ] Rust unit tests for name derivation + mode selection (the tmux call itself is proven live).
- [ ] Commit `feat(pty): terminals survive an app restart, under tmux`.

### Task 3 — Multiple terminal tabs per worktree
- [ ] Model: a worktree owns an ordered list of terminal tabs; session id becomes
      `<binding_id>#<n>`. Pure model + tests (add, close, reorder, active-tab selection, and
      what "close the last tab" means).
- [ ] UI: a tab strip inside the Terminal surface, `⌘T` new tab, `⌘W` close tab (with the
      last-tab rule), `⌥⌘←/→` to move between them. Pure `resolveKey` function with tests.
- [ ] Tab layout persists across restart alongside the tmux session names.
- [ ] Commit `feat(runs): many terminals per worktree, like the iTerm tabs they replace`.

### Task 4 — Projects: add and remove, from the UI
- [ ] `+ Add project` opens the native folder picker (Tauri dialog). Validate the choice is a
      git repository **before** writing state; reject with a readable reason otherwise.
- [ ] CAS write to workspace state (`expected_revision` always sent); a 409 refreshes and retries
      once, then surfaces the conflict rather than clobbering.
- [ ] Remove a project = **forget the path**. It never touches the directory on disk, and the
      confirm copy says exactly that.
- [ ] Tests: validation, CAS conflict path, remove-is-forget.
- [ ] Commit `feat(runs): add and remove projects without touching the coordinator by hand`.

### Task 5 — Naming: Projects is the front door, Runs is a tab
- [ ] Island nav item `Runs` → `Projects`; upstream's → `Repos` (one string; declare the seam).
- [ ] Route `/runs` → `/projects` (regenerate the route tree; update the existing seam reasons).
- [ ] Runs list becomes a tab inside a worktree. Nothing is deleted.
- [ ] Grep every user-visible string for "Run" used as a *place* rather than a noun.
- [ ] Commit `feat(runs): projects is the front door`.

### Task 6 — Worktree create and remove
- [ ] Create: branch name + base ref → `git worktree add`. Name collisions and dirty state are
      reported, not forced.
- [ ] Remove: `git worktree remove` (**never a recursive delete**). If it refuses because the
      tree is dirty, show what is dirty and stop. Removing a worktree closes its terminal tabs.
- [ ] Tests over a real temp git repo: create, list, remove, refuse-when-dirty.
- [ ] Commit `feat(runs): open and close worktrees from the workspace`.

### Task 7 — Diff review worth using
- [ ] Worktree diff: changed-file list + per-file unified diff, working tree vs base, with
      real +/− counts. Large files and binaries degrade honestly instead of hanging.
- [ ] Reuse upstream's diff rendering if it is genuinely reusable from an island; if reuse
      would mean editing upstream files, write the island's own and say why in the commit.
- [ ] Keyboard: `j/k` between files, `Enter` to open.
- [ ] Commit `feat(runs): read your changes without leaving the workspace`.

### Task 8 — ACP agent, proven in a scratch repo
- [ ] A throwaway git repo under the scratchpad — **not** `~/self-hosted`, **not**
      `/Volumes/ugreen/projects`.
- [ ] Drive a real ACP agent (`claude-agent-acp` or `codex-acp` via `BUZZ_ACP_AGENT_COMMAND`)
      in a worktree of that repo. **Never `claude -p`** — the owner pays extra usage for it.
- [ ] Prove: the agent edits a file in *its* worktree, the diff tab shows the change, evidence
      lands. Screenshot.
- [ ] Commit `feat(runs): an agent works in a worktree, end to end`.

### Task 9 — Live proof and docs
- [ ] Live under `just dev`: `pwd` in the terminal prints the worktree path; open a second tab;
      quit and relaunch the app and confirm the tmux session is still there with its scrollback;
      add a project through the picker; create and remove a worktree; read a diff.
- [ ] Screenshots for each, hash-distinct (`shasum -a 256`), under `desktop/test-results/screenshots/`.
- [ ] Update `vingilot/docs/workbench.md`; record the Projects/Repos naming call in ADR-001.
- [ ] Commit `docs(vingilot): the workspace, and what it does not do`.

---

## Self-Review

**Mapped to his ask:** persistent multi-tab terminals (T1–T3) replace the iTerm window; diff
review (T7) replaces the VS Code window; projects and worktrees (T4–T6) are the navigation
between them; "Runs" stops being a place (T5).

**Deliberately out of scope, and why:** Xcode (native iOS toolchain — not reproducible here),
Obsidian (a notes vault is a different product), an editor (VS Code's real value to him in the
screenshot is *reading a diff*, which T7 covers; a text editor is a much larger commitment and
he did not ask for one).

**The riskiest claim in this plan** is T2's "survives an app restart". It is true only while the
tmux *server* lives — a reboot, `tmux kill-server`, or a machine crash still ends it. The status
bar and the docs must say that, not just the commit message.
