# VelaTerm, read as source — what Vingilot takes

Read 2026-08-12 from `vlinx-io/VelaTerm` (MIT, Tauri, TS+Rust, updated the same day). Not a
survey: the code was read, files are cited, and each idea ends with take / skip and why.

## 1. TAKE — hook-injected agent liveness (`src-tauri/src/agent/inject.rs`)

The one that matters. The signals plan's own survey found this app's biggest gap: **no
per-session terminal liveness exists** — a Claude Code the owner launches by hand in a worktree
terminal is invisible to the attention dots. VelaTerm solved exactly this, cleanly:

- Launch is `claude --settings "$VLX_CLAUDE_SETTINGS"` where the env var holds inline settings
  JSON containing **`type: "http"` hooks** posting to a local hook server. No file in the user's
  `~/.claude` is touched; the injection lives and dies with the session.
- The URL carries everything: `http://127.0.0.1:<port>/hook/<sid>?t=<token>&e=<event>` — session
  id and a per-run token in the URL, so the server needs no env correlation and no body parsing.
- Event mapping (their comments, verified in code): `UserPromptSubmit`/`PreToolUse`/`PostToolUse`
  → working; `Stop` → waiting; `Notification(permission_prompt|elicitation_dialog)` → **asking**;
  `Notification(idle_prompt)` → idle, corrected silently.
- A hard-won race note worth keeping: for Codex they **drop PostToolUse entirely** because each
  hook is its own short-lived process and a PostToolUse landing after Stop leaves a finished turn
  stuck on "working" forever.
- A launch guard reports agent-not-found by GET to a pre-built `e=notfound` URL — the "agent is
  not installed" state is authoritative, not parsed off the screen.

**Fit here:** `asking` → `needs-you`, `working` → `working` — it drops straight into
`AttentionMark`'s taxonomy and would make the dots true for hand-launched sessions, which is how
the owner actually works. The obvious seam: `vingilot_pty` already builds the spawn env
(`terminal_env`), and the marks pipeline already exists. Needs a small local hook endpoint
(the coordinator is optional, so this must not live there).

## 2. TAKE — PATH shims: the terminal is a door into the app (`agent/spawn_cli.rs`)

At startup they install thin shims into an app-owned `bin/` prepended to every session's PATH:
`vopen <file>` opens the file in the app's viewer; `vspawn "task"` starts a child session,
`vspawn-tree` forces a worktree. Each shim calls the main binary's hidden subcommand — a
`#!/bin/sh` one-liner, Rust does the rest.

**Fit here:** `vin open src/foo.rs:120` from a worktree terminal → the Files pane at that line
(the pane's outside door already exists — `filesTarget`); `vin spawn` → PlanWorktreeDialog
pre-filled. And an **agent** in the terminal can call it too, which quietly gives every harness
a way to show the owner a file without any MCP negotiation. Shim names must not shadow real
commands (their `v`-prefix note is right; ours would be `vin` or `vingilot`).

## 3. TAKE (smaller) — auto-resume with existence checks (`agent/resume.rs`)

They capture the agent's native session id from hook bodies, and on reopen offer
`claude --resume <id>` — but only after verifying the conversation file exists under
`~/.claude`, falling back to a fresh launch **only when absence is certain**. Same
empty-read discipline this repo already enforces. Pairs naturally with #1: the id arrives in
the same hook POST.

## 4. NOTE — child session + merge back

Their spawn model ends with "merge it back when the work is done" as a first-class gesture.
We have worktrees as the core object already; the missing gesture is the *end* of the loop —
today merging back is a terminal job. Worth folding into the source-control surface later,
carefully (their merge is a plain `git merge`; ours must stay read-only until decided).

## SKIP, with reasons

- **Screen parsing** (`src/terminal/screenDetect.ts`) — they fall back to reading the terminal
  screen to detect agent state. The hooks made this mostly unnecessary and it is exactly the
  guess-from-pixels signal this repo's plans forbid.
- **Remote browser access / device pairing / mobile view** — real engineering (tunnel over
  `ssh -R`, E2E pairing) but a different product decision; Vingilot's remote story is the relay.
- **Built-in browser tab, i18n, their WYSIWYG markdown** — surface area without a current need;
  the scratch-md plan already reuses our own editor.
- **Their tree model** (project → nested groups → sessions) — ours is project → worktree and
  that is the product's spine, not a gap.
