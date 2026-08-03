# Runs — the Vingilot surface inside Buzz desktop

Per ADR-001's 2026-08-03 Reversal, Vingilot's UI lives **inside the Buzz
desktop app**, not in a sibling application. The former standalone Workbench
(`vingilot/workbench`) is deleted; its logic modules and tests were ported
into the island and its history remains on the `vingilot/workbench-shell`
branch.

## Where things live

- **Island (fork-owned, additive):** `desktop/src/features/runs/**`
  - `lib/` — coordinator client, polling, run model, budget/legalNext,
    provision spec, reachability. All pure modules carry their `.test.mjs`
    next to them; desktop's own `pnpm test` glob runs them.
  - `ui/` — `RunsScreen` (list pane + Deck pane / Run detail), `RunList`,
    `DeckPane`, `RunDetail`, `BudgetBar`, `StopAllButton` (hold-to-engage),
    `UnreachableBanner`, `RunsLoadingFallback`.
- **Touch-points (declared in `vingilot/seams.yaml`):** the sidebar nav entry
  and the `/runs` route registration. Kept to a few lines each — these are
  the files upstream merges can conflict on.
- **Coordinator:** unchanged except a localhost-allowlist CORS layer so the
  webview can call `http://127.0.0.1:7117` directly.

## Run it

```bash
docker compose up -d                     # postgres/redis/minio (vingilot-isolated stack)
./vingilot/scripts/coordinator-run.sh    # control plane on 127.0.0.1:7117
just dev                                 # Buzz desktop — "Runs" in the sidebar
```

The Runs screen polls the coordinator; killing the coordinator surfaces the
persistent unreachable banner (read-only, `as of <t>` stamps, disabled
composer with the reason inline) and recovers on its own when it returns.

## Honest notes

- The dev bearer token is a constant in webview code (`lib/coordinatorClient.ts`)
  — acceptable for a localhost-only control plane in V1; the follow-up is a
  Tauri-side proxy holding the token in the keychain.
- Wall-clock budgets are enforced (solid meter — the reconciler pauses the
  run); token counts are observed only (dashed `≈`, absent entirely when no
  data exists). Illegal transitions are absent from the DOM, not disabled.
- No global ⌘K in the Runs screen — Buzz owns that shortcut for search.

## Deferred

Chat adapter tie-in (Runs ↔ channels), terminal/PTY surface for interactive
Runs, multibuffer diff review, Tauri-proxied coordinator auth, per-mode token
budget enforcement (needs the executor/broker — see `coordinator.md`'s
deferred gaps).

## Executor

The executor (`vingilot-executor`, `vingilot/coordinator/executor/`) is the
broker's first incarnation (ADR-003): it claims a `ready` delegated Run over
the coordinator's HTTP API, provisions a real `git worktree`, runs the Run's
command inside it, streams stdout/stderr as evidence rows, and drives the Run
to `completed`/`failed` honestly — a nonzero exit is a `failed` Run with the
exit code recorded, never a retry-until-green.

Every side-effecting step (worktree creation, running the command) is
preceded by a `validate-op` fencing check against the write-granted
binding's epoch (ADR-003 §Fencing). A denial — most commonly a stale epoch
from a concurrent re-acquisition — aborts `execute_run` immediately via
`ExecError::Fenced`, appends an `error` evidence row naming exactly what was
denied, and the run **never transitions past its current state on that
path** (no explicit `failed` transition is fired for a fencing denial itself
— the run simply stops progressing; the coordinator's reconciler
subsequently observes the lapsed/lost lease and moves it to `paused` with
reason `"lease lost"`, which is what live-tested fencing evidence looks like
in the Runs screen).

### Run it

```bash
docker compose up -d                        # postgres/redis/minio
./vingilot/scripts/coordinator-run.sh        # control plane on 127.0.0.1:7117
./vingilot/scripts/executor-run.sh <workspace-id>   # worker: polls every 3s,
                                              # claims oldest ready delegated run
```

`executor-run.sh` env: `VINGILOT_REPOS` (`repo_id=path` map, default
`buzz=<this checkout>`), `VINGILOT_WORKTREE_ROOT` (default
`~/.vingilot/worktrees`), `VINGILOT_CMD` (overrides the default `echo
executing: {objective}` command body). A single Run can also be driven
directly: `cargo run -p vingilot-executor -- execute --run <id>`.

### Live-tested loop (2026-08-03)

Against the dev workspace (`00000000-0000-0000-0000-000000000001`, the id
`RunsScreen` hardcodes): created a delegated Run with objective `"prove the
loop"` via `POST /v1/runs` + `POST /v1/runs/{id}/provision` (one write
binding on `repo_id: "buzz"`), started the worker, and watched it claim →
`git worktree add` → run the default echo command → `completed`, with real
evidence rows (the exact `git worktree add` command + its output, the
command + its output, an `outcome: completed` note) — captured in
`desktop/test-results/screenshots/executor-evidence.png` (Runs screen,
completed run selected, Evidence pane visible with live data from the
running coordinator, not mock data).

Fencing: reproduced by provisioning a second Run and, the instant it was
`ready`, flooding `POST /v1/bindings/{id}/lease` (an unconditional
re-acquire, per `binding.rs`'s doc comment: "always bumps the binding's
epoch regardless of who calls it") from an out-of-band client concurrently
with the worker's own claim — a race, not deterministic on the first try;
worktree_bindings epoch is a single contended row, capped at ~3–3.5k
acquisitions/sec by Postgres's per-row lock serialization, so multiple
attempts were needed before a bump landed between the worker's own
`acquire_lease` and its next `validate-op` call. The denied attempt shows up
exactly as `binding.rs` promises: an `error` evidence row — `"validate-op
denied before git worktree add: denied: stale epoch: binding <id> is at
epoch <N>, presented <N-8>"` — and the run never reaches `completed`; the
background reconciler later paused it (`running → paused`, reason `"lease
lost"`). Captured in
`desktop/test-results/screenshots/executor-fencing-denial.png`.

### Deferred (executor-specific)

Interactive/PTY execution mode, ACP harness launch (the command template —
`ExecutorConfig.command_template`, `{objective}` substituted — is the seam
where `claude -p` slots in later), per-mode token caps, worktree retirement
(worktrees are kept as the Run's artifact; cleanup is later UI work),
multi-run concurrency (the worker claims and runs exactly one Run at a
time), and an explicit `failed` transition on a fencing denial itself (today
the reconciler's `paused`/"lease lost" is the observable signal instead).
