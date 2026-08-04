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

## Work products — what a Run changed

After the command exits, the executor captures the Run's work product (fenced,
like every other side effect):

1. `git status --porcelain` in the task worktree → a `note` evidence row.
2. If dirty: `git add -A && git commit` **inside that worktree, on the Run's own
   branch** → a `commit` evidence row carrying the real sha. This is the single
   place `add -A` is correct — the worktree exists solely for this Run and the
   commit *is* the artifact. The standing "never `git add -A`" rule applies to
   this repository and is unaffected.
3. `git diff HEAD~1 --stat` → `note`; the diff itself → a `diff` evidence row,
   capped at 48 KiB (the coordinator's per-row evidence ceiling is 64 KiB) with
   a truncation marker naming the real untruncated byte count.

A capture failure becomes `error` evidence; the Run's outcome still reflects the
command's exit code — capture is reporting, not verification.

RunDetail renders `kind=diff` through a pure `diffView` model: additions in the
ok colour, deletions in the stop colour, `@@` hunks emphasised, meta lines plain.
Commit rows appear in the Evidence timeline with a `⎘` prefix.

**Running a real coding agent as the command** is configuration, not code —
`VINGILOT_CMD` runs anything, so a headless harness slots straight in. That is
deliberately NOT wired up by default: an autonomous agent loop with approvals
disabled, inside a worktree ADR-003 declares is a collision boundary and not a
security boundary, is the owner's call to make explicitly — not a default.

## Deck — membership syncs, layout does not

Deck is the Runs screen's home pane (`ui/DeckPane.tsx`), not a separate
route or a second Deck identity. It splits what a pin *is* from where it
*sits*, because those two facts have different owners:

- **What's pinned (the set) syncs.** The pin set lives in Workspace state
  under `deck.pins` — `{ id, kind, pinnedAt }[]` — written through the
  coordinator's existing CAS mutation endpoint
  (`POST /v1/workspaces/{id}/mutations`) with `expected_revision` set to the
  revision the write was computed against. This is deliberately the *first*
  UI-driven exercise of ADR-002's mutation protocol; until Deck, only Rust
  tests wrote through it. `lib/deckSync.ts` is the orchestrator: read the
  current revision → compute the next `pins` array → write with that
  revision. It never retries a 409 on its own.
- **Where it sits (the layout) does not.** Order is `localStorage`, keyed by
  workspace id **and** a per-device id (`lib/deckLayout.ts`'s `layoutKey`).
  A laptop cannot scramble a monitor's arrangement, because the two devices
  never share a layout key — there is no server round-trip for order at all,
  so there is nothing to race. `deviceId()` is generated once and persisted
  locally; it never leaves the device (it is not part of any request body
  `deckSync` sends).

### Arrival on another device

When a pin appears in the synced set but this device's local `order` has
never seen its id — pinned elsewhere — `applyLayout` puts it in `unplaced`
rather than guessing a position. `DeckPane` renders unplaced cards with a
dashed border and the caption "pinned on another device — place it where you
like." Placing one (move-left/move-right or the `Place` action) inserts its
id into this device's `order` and persists it locally; it has no effect on
any other device's arrangement or on the synced set.

### Conflict resolution

A pin write races another device's write at the same revision → the
coordinator returns 409. `deckSync` surfaces this as
`{ conflict: true, revision, stateHash }` instead of retrying — nothing is
silently overwritten. The UI re-reads the winning state via a follow-up
`GET`, computes `pinsDiff(mine, theirs)`, and shows the conflict banner
(`data-testid="deck-conflict"`): "your pin didn't apply — `<device/rev>`
changed the pinned set first," with the added/removed ids listed. The owner
picks: **Keep theirs** (adopt the winning set, done) or **Re-apply mine on
top** (re-read the current revision and issue a fresh CAS write naming that
revision — a rebase, not a blind retry, per ADR-002).

### Tombstones

A pinned id whose Run no longer exists in the API (deleted, or from a
workspace this device can no longer see) renders a tombstone card — "no
longer available — unpin" — never a blank slot and never a crash. Unpinning
a tombstone is a normal CAS write removing that id from `deck.pins`.

### Reachability

While the coordinator is unreachable, pin toggles disable with the inline
reason inline, matching the rest of the Runs screen's honest-degradation
pattern — no fake queueing of a pin action that cannot actually be sent.

### Deferred

Drag-and-drop (ordering today is move-left/move-right buttons plus
keyboard — testable, no new dependency); `pr`/`surface` pin kinds (the
`Pin`/`PinKind` model already parses them; no UI renders them yet); multiple
Deck identities; Deck as a route independent of the Runs screen; interactive
surface actions (the design's action protocol — its own replay-safety work,
later).
