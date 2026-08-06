# Projects and Terminal — the Dashboard the Owner Actually Asked For

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat Run list with the thing the owner has described since day one: **projects in the sidebar, each opening into its worktrees, each worktree opening into a live terminal**. iTerm's terminal, VS Code's tree. The screen must answer *"what is happening in my projects right now?"* at a glance — the question the current UI cannot answer at all.

**Why this exists:** The shipped Runs screen answers *"which runs exist?"*. The owner's words, verbatim: *"şu an ne olup bittiğine dair herhangi bir fikrim yok"* — no idea what is going on. That is a design miss, not a polish gap. The coordinator already models `repo_id`, `branch`, `lifecycle` and `owner_run_id` on every `worktree_binding`; the UI simply never surfaced them.

**Architecture:** Three columns. Sidebar gains a **Projects** section (repos, from Workspace state via CAS — repos belong to a Workspace, per the architecture's K5). Selecting a project shows its **worktrees** (the `main` checkout plus every task worktree the coordinator knows), each with live state. Selecting a worktree opens a **tabbed work surface** whose default tab is a real **terminal** (PTY) rooted at that worktree, alongside Diff and Evidence. A persistent status bar names where you are. Run rows do not disappear — they become a tab, not the front door.

**Tech Stack:** Existing (Rust coordinator, desktop island, React). **Two new dependencies, both load-bearing and justified in-plan:** `portable-pty` (Rust, spawns and drives a real PTY — the alternative is writing process/tty plumbing by hand) and `@xterm/xterm` + `@xterm/addon-fit` (renders VT sequences — the alternative is writing a terminal emulator, which is absurd for this project's purpose). No other new deps.

## Global Constraints

- Branch **`vingilot/projects-terminal`** from `vingilot/deck`. Trailers per ADR-004; `git commit -F`; never amend other sessions' commits; **never `git add -A`**.
- Island-first: everything under `desktop/src/features/runs/**` (the island glob already covers it) or `vingilot/**`. The Tauri PTY commands are new files under `desktop/src-tauri/src/vingilot_pty/` — **a new island inside the Rust side**; declare that directory as an island glob in `seams.yaml` (new directory, additive, cannot merge-conflict).
- **Touch-points expected (declare each in `seams.yaml` with a reason):** `desktop/package.json` (already declared — extend the reason to cover xterm), `desktop/src-tauri/Cargo.toml` (portable-pty), `desktop/src-tauri/src/lib.rs` or wherever the Tauri command registry lives (registering PTY commands — smallest possible diff), and the existing nav/route touch-points. **Nothing else.** More than these is a finding.
- Gates: `cd desktop && pnpm check && pnpm typecheck && pnpm test`; `./vingilot/scripts/coordinator-check.sh` (with `COORD_DATABASE_URL=postgres://buzz:buzz_dev@localhost:5435/vingilot_coordinator`) for Rust coordinator changes; `cargo check --manifest-path desktop/src-tauri/Cargo.toml` for Tauri-side Rust; `./vingilot/scripts/check-seams.sh` exit 0 before every commit.
- No `unsafe`; no new `unwrap()`/`expect()` outside `#[cfg(test)]`. Stock rem Tailwind tokens (`pnpm check:px-text` gates). The word "isolated" never describes a worktree.
- Long commands via Bash `run_in_background` + poll.
- **The PTY runs the owner's own shell in the owner's own worktree.** That is the same risk class as them typing in Terminal.app, per ADR-003's V1 trust model — but the UI must never imply containment: no "sandboxed", no "isolated". The worktree chip says where the shell *starts*, nothing more.

## Layout contract (the synthesis the owner chose: "iTerm ve VS Code karışık")

```
┌──────────────┬──────────────────┬────────────────────────────────────────┐
│ Inbox        │ buzz             │  Terminal │ Diff │ Evidence │ Runs      │
│ Agents       │ ──────────────── │ ───────────────────────────────────────│
│ ▾ Projects   │ ● main           │ $ cargo test -p buzz-acp               │
│   • buzz  ←  │   clean          │ running 3 tests                        │
│   • vingilot │                  │ test retry::replay ... ok              │
│   • infra    │ ● run/bz-142 ⌘1  │                                        │
│ Runs         │   +214 −87       │ $ ▌                                    │
│              │   terra running  │                                        │
│ Channels     │                  │                                        │
│  # general   │ ○ run/ada2b39 ⌘2 │                                        │
│              │   ✓ +2 −0        │                                        │
├──────────────┴──────────────────┴────────────────────────────────────────┤
│ buzz · run/bz-142 · terra ● running · +214 −87 · wall 12m/30m · synced   │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Terminal is the default tab** (iTerm: the terminal is the work surface, not a drawer).
- **Worktree column is the explorer** (VS Code: the tree tells you where you are).
- **⌘1…9 switches worktrees** (iTerm tab muscle memory), `⌘\`` focuses the terminal, `Esc` leaves it.
- A terminal session **persists while the app runs** — switching worktrees and coming back returns to the same live session, scrollback intact.

## Contracts fixed here

### Workspace state gains repos (CAS, same protocol as `deck.pins`)

```jsonc
{ "repos": [ { "id": "buzz", "name": "buzz", "path": "/Users/…/vingilot" } ] }
```

Written via the existing mutations endpoint with `expected_revision`. A repo with no worktrees still appears — a project you have not run anything in yet is still a project.

### Coordinator: `GET /v1/workspaces/{id}/worktrees` (NEW)

```jsonc
{ "worktrees": [ {
  "binding_id": "...", "repo_id": "buzz", "branch": "run/bz-142",
  "role": "task", "lifecycle": "ready", "base_commit": "...",
  "owner_run_id": "...", "owner_run_status": "running", "owner_run_objective": "...",
  "added": 214, "removed": 87, "commit_sha": "75269de…"   // from the run's diff/commit evidence, null when none
} ] }
```

One query joining `worktree_bindings` → `runs`, plus the latest `diff`/`commit` evidence per owner run. Same bearer auth.

### Tauri PTY commands (new island `desktop/src-tauri/src/vingilot_pty/`)

```rust
#[tauri::command] pty_open(session: String, cwd: String, cols: u16, rows: u16) -> Result<(), String>
#[tauri::command] pty_write(session: String, data: String)  -> Result<(), String>
#[tauri::command] pty_resize(session: String, cols: u16, rows: u16) -> Result<(), String>
#[tauri::command] pty_close(session: String) -> Result<(), String>
// output is pushed to the webview as a Tauri event: `vingilot://pty/<session>` { data: String }
```

Sessions live in a `Mutex<HashMap<String, PtySession>>` in Tauri state. **Poisoned locks are recovered with `into_inner`, never surfaced as an error** — the app already learned this lesson the hard way (`custom_harnesses.rs` does it right; `agent_config.rs` does not, and an OOM turned the Agents page into a permanent error screen). Session id = the worktree binding id, so "same worktree ⇒ same session".

## Tasks

### Task 1: Coordinator — repos in workspace state, worktrees endpoint
- [ ] Red: `tests/http_api.rs` — `GET /v1/workspaces/{id}/worktrees` returns a binding joined to its owner run's status/objective; a binding with no owner run still appears; diff counts come from the latest `diff` evidence and are null when absent; 401 without bearer.
- [ ] Green: `run::list_worktrees_for_workspace` + thin handler. Gate; seams 0.
- [ ] Commit `feat(coordinator): list a workspace's worktrees with their live owner state`.

### Task 2: Island model + client for projects/worktrees
- [ ] Red: `lib/projects.test.mjs` — `readRepos(state)` tolerant (bad shapes → `[]`, unknown extra keys preserved on write, mirroring the `deckPins` lesson: never drop what you do not understand, because the whole array is written back); `groupWorktrees(repos, worktrees)` puts every worktree under its repo, and a worktree whose `repo_id` matches no known repo lands in an `unknown` bucket rather than vanishing; `worktreeSummary(wt)` render-model (label, state class, diff counts or null).
- [ ] Green: `lib/projects.ts`, `listWorktrees` + `putRepos` in `coordinatorClient.ts` (CAS, `expected_revision` always sent). Gates.
- [ ] Commit `feat(runs): projects and worktrees as tolerant, tested models`.

### Task 3: Tauri PTY backend
- [ ] Add `portable-pty` to `desktop/src-tauri/Cargo.toml` (declare seam). New island `src/vingilot_pty/{mod.rs,session.rs}`; register commands at the existing registry (smallest diff; declare seam).
- [ ] Rust unit tests where the logic is testable without a real tty (session map insert/close/idempotent-open; poisoned-lock recovery). The PTY itself is verified live in Task 5.
- [ ] `cargo check --manifest-path desktop/src-tauri/Cargo.toml` clean; no unwrap/expect outside tests; poisoned locks recovered, never returned as errors.
- [ ] Commit `feat(pty): real terminal sessions, one per worktree`.

### Task 4: The three-column UI
- [ ] `ui/ProjectsNav.tsx` (sidebar section), `ui/WorktreeColumn.tsx`, `ui/WorkSurface.tsx` (tabs: Terminal default, Diff, Evidence, Runs), `ui/Terminal.tsx` (xterm + fit addon, wired to the PTY commands/events), `ui/ProjectStatusBar.tsx`.
- [ ] `RunsScreen` becomes the composition of these. The old Deck (composer + lanes) becomes the **Runs tab** and the project-less landing view — nothing is deleted, it stops being the front door.
- [ ] Keys: `⌘1…9` worktree switch, `⌘\`` focus terminal, `Esc` leave — pure `resolveKey`-style function with unit tests.
- [ ] Desktop gates (ratchet + px-text police idiom). Commit `feat(runs): projects, worktrees, and a terminal that greets you`.

### Task 5: Live proof + screenshots
- [ ] Seed the dev workspace's `repos` with the real checkout (`buzz` → this repo path) via the API.
- [ ] Live: `just dev` + coordinator; open the project, confirm the worktree column lists `main` plus any run worktrees with real diff counts; **type a command in the terminal and see it execute in that worktree** (`pwd` must print the worktree path — that is the proof the cwd is real); switch worktrees and back, confirm scrollback survived.
- [ ] Screenshots: `projects-dashboard`, `terminal-live`, `worktree-switch`. Save under `desktop/test-results/screenshots/`; name the paths.
- [ ] Update `vingilot/docs/workbench.md` (Projects/Terminal section: what the columns are, the key map, the PTY's honest boundary, the two new deps and why). Commit `docs(vingilot): projects and terminal`.

### Audit
Gates; seam scope (island paths + exactly the declared touch-points — count them, more than four is a finding); read the PTY session map for poisoned-lock recovery and for any unwrap outside tests; confirm the terminal's cwd is the worktree (reproduce `pwd`); confirm no UI copy implies isolation/sandboxing; confirm `putRepos` always sends `expected_revision`; reproduce one screenshot; trailer order; kill processes.

## Self-Review

**Owner's ask, mapped:** projects as sidebar sub-tabs (T4), entering one puts you in its worktrees (T1, T2, T4), a terminal greets you (T3, T4), and the screen says what is happening right now (worktree column live state + status bar). **Deliberately kept:** the Run list and Deck become tabs, not the entry point — the work done there is not thrown away. **Deferred, to record in docs:** multiple terminal tabs per worktree, terminal search/copy-mode, file tree inside a worktree, PR flow, worktree creation from the UI (today they come from Runs).

**Type consistency:** `Repo`/`Worktree` defined once in `projects.ts` and consumed by every UI file; the PTY session id is the binding id everywhere (Rust and TS); `worktreeSummary`'s output is exactly what `WorktreeColumn` renders.
