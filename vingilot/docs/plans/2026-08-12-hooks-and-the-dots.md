# Hooks and the dots — the terminal's agents become visible

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Prior art, both read as source:** VelaTerm's `agent/inject.rs`
> (`vingilot/docs/research/2026-08-12-velaterm-notes.md`) and AFK's
> `HookInstaller.swift` + `HookHTTPServer.swift` (`/Volumes/Ugreen-KIOXIA/Projects/AFK`,
> the owner's own prior work — "we played with hooks so much in afk").

**Goal:** the owner's framing — *"we can write hooks to control sidebar while claude code
working. or we can do bottom bar for status with hooks."* And the signals plan's oldest open
finding: **no per-session terminal liveness exists.** A Claude Code he launches by hand in a
worktree terminal is invisible to the attention dots; the dot says "quiet" while the agent is
mid-refactor or waiting on a permission prompt he cannot see.

Claude Code's hooks carry everything needed: every hook payload includes `session_id` and
`cwd`, and `cwd` maps onto worktree binding ids (`local:<path>`) — the sidebar's own key.

## The shape, decided up front

- **A local hook endpoint** (Rust, fork island): `127.0.0.1`, per-run token, VelaTerm's
  URL-carries-everything pattern (`/hook/<scope>?t=<token>&e=<event>`). Localhost only, no
  request leaves the machine — the work-machine stance holds by construction.
- **Two injection rings, both opt-in by construction:**
  - **Ring 1 — our terminals.** The owner types `claude` himself, so there is no launch flag to
    inject — but the app owns the terminal's PATH. An app-owned `bin/` (the shim mechanism the
    IDE plan already wants for `vingilot .`) carries a `claude` wrapper: set
    `--settings "$VINGILOT_CLAUDE_SETTINGS"` (VelaTerm's inline-JSON pattern, hooks of
    `type: "http"`), then exec the real binary. Ephemeral: nothing written to `~/.claude`,
    the injection lives and dies with the session. Same wrapper story for other harnesses
    later; Claude first.
  - **Ring 2 — everything else (optional).** AFK-style managed install into
    `~/.claude/settings.json` — install/uninstall as a settings toggle, AFK's cleanup
    discipline (named hook keys, legacy sweep). Covers iTerm and anything the app never saw;
    `cwd` still maps sessions to worktrees. Default OFF: ring 1 costs nothing and covers how
    he actually works in the app.

## Task 1 — The endpoint and the state

- [ ] `vingilot_hooks` module: bind loopback, mint a token per app run, accept POSTs, parse
      the event vocabulary. Event → state map (VelaTerm's, kept): prompt-submit/pre-tool/
      post-tool → working; Stop → waiting; Notification(permission_prompt|elicitation_dialog)
      → **asking**; idle_prompt → waiting, silently. Keep their race note: any event mapping
      identical to a neighbor that can land after Stop is dropped, not debounced.
- [ ] State keyed by `(session_id, cwd→binding_id)`; a session with an unmappable cwd is held
      but unattributed (an honest bucket, not dropped). Staleness: a session that has said
      nothing for N minutes decays to unknown — absence of hooks is "no answer", never "done".
- [ ] Tests: the mapper (cwd → binding, the unmappable case), the decay, the token refusal
      (wrong token → 403 and nothing changes).

## Task 2 — Ring 1 injection

- [ ] The shim dir + `claude` wrapper, added to `vingilot_pty`'s spawn env (PATH prepend —
      the module already owns `terminal_env`). Wrapper builds the settings JSON with the pty
      session's binding id in the hook URLs, execs the real `claude` found *after* our dir.
- [ ] The wrapper must be inert outside our terminals and removable: no writes outside the
      app's own data dir, and `claude --version`-style passthrough untouched.
- [ ] A live test in the `vingilot_pty::live` style: spawn, run the wrapper with a fake
      `claude` that posts a hook, see the state land.

## Task 3 — The surfaces

- [ ] **The dots:** hook state joins `useWorktreeSignals` as a signal beside run status and
      git. `asking` → needs-you with the notification's own sentence ("waiting for approval:
      Bash"); `working` → working. Run-status and dirty keep their existing precedence;
      hook liveness fills the silence where today there is nothing.
- [ ] **The bottom bar:** `ProjectStatusBar` gains one segment for the selected worktree's
      live agent — "claude · working — Bash" / "claude · waiting" / "claude · asking" — in the
      quiet-plate vocabulary the terminal polish established. Nothing when no session: absence
      says nothing.
- [ ] OS notification on the working→asking transition for a non-selected worktree, through
      the existing attention-notice path (it already owns dedupe and focus rules).
- [ ] Specs: mock the endpoint state, assert dot + bar + sentence; the geometry spec still
      holds (the bar segment must not move the layout).

## Later, named now

- **Ring 2** (managed global install) — settings toggle, AFK's installer as the model.
- **PermissionRequest answered from the app** — AFK proved the loop (hook → HTTP response
  allow/deny). Powerful and squarely an ADR-003 trust-boundary decision; not before it.
- **OTLP telemetry** (AFK's env injection): token/cost per session into a local collector —
  the observability pane the market survey called our strongest ground. Separate plan when
  wanted.

## Global Constraints

The standing set: `rm -rf` forbidden; never launch the app; no release builds; agents never
commit; island + seams (the gate can fail now); rem tokens; 1000-line ratchet; an empty read
is "no answer"; every test proved able to fail; gates to real exit codes; never bare `biome`;
no commit stamps inside 08:00–18:00 Europe/Istanbul; localhost-only — nothing here may post
off the machine.

## Self-Review

**Riskiest:** the wrapper. A `claude` shim that breaks his real Claude Code — wrong exec, a
swallowed flag, a PATH loop — damages the tool he lives in. The wrapper is twenty lines,
tested with a fake binary, and passes through everything it does not understand.

**Most likely to be got wrong quietly:** state without decay. A crashed session's last event
was "working"; without decay the dot lies green forever. The decay is Task 1's acceptance
criterion, not an enhancement.
