# Coordinator Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The control-plane service ADR-002 decided: a single authority over Workspace state, Runs, WorktreeBindings, capability grants, leases/fencing epochs, and budgets — as a standalone Rust crate with a Postgres store and an HTTP mutation API, test-proven against the real database.

**Architecture:** `vingilot/coordinator/` is its **own Cargo workspace** — deliberately NOT a member of the repo-root workspace, so no seam in the root `Cargo.toml` is needed and upstream `cargo test` is unaffected. Pure domain logic (state machine, transition rules) lives DB-free and unit-tested; persistence and CAS live in a store module integration-tested against the local vingilot Postgres; a thin axum HTTP layer exposes the ADR-002 mutation protocol verbatim. Relay snapshot publishing and signing are **explicitly out of scope** (they need a relay seam and key management — a later plan).

**Tech Stack:** Rust (tokio, axum, sqlx runtime queries — no sqlx macros, so no compile-time DB dependency), serde/serde_json, uuid, sha2, thiserror. Postgres = the existing `vingilot-postgres` container (port 5435), new database `vingilot_coordinator`.

## Global Constraints

- **Everything lives under `vingilot/coordinator/`.** Zero files outside `vingilot/`; `./vingilot/scripts/check-seams.sh` must exit 0 before every commit (ADR-001 §6).
- **Branch:** `vingilot/coordinator`, created from `vingilot/workbench-mount-spike` if it does not exist.
- **Commit trailers:** `Signed-off-by:` first, then `Co-authored-by:` (ADR-004). Commit via `git commit -F <tempfile>`.
- **Never `git commit --amend` a commit created by another session** — stack follow-up commits instead (harness security guard).
- **No `unsafe`. No new `unwrap()`/`expect()` in production paths** — `?` and typed errors (repo rule + owner's culture). `unwrap` is fine inside `#[cfg(test)]`.
- **No dependencies beyond the tech-stack list above** without recording why in the commit message.
- **DB-backed tests must skip cleanly when the database is absent** (runtime skip with a printed notice), and must run for real when `COORD_DATABASE_URL` is set. Agents executing this plan MUST export it:
  `COORD_DATABASE_URL=postgres://buzz:buzz_dev@localhost:5435/vingilot_coordinator`
- **ADR-002 and ADR-003 are the spec.** Where this plan and an ADR disagree, the ADR wins and the discrepancy gets reported, not silently resolved.

## Domain model (fixed here, used verbatim by every task)

```
RunStatus:   Draft | Provisioning | Ready | Running | Verifying | Paused
             | Blocked | Completed | Failed | Cancelled
RunMode:     Interactive | Delegated | Chat            (ADR-003 §Execution modes)
Lifecycle:   Provisioning | Ready | Quarantined | Removed   (WorktreeBinding)
Access:      Read | Write
```

Legal Run transitions (everything else is rejected):

```
Draft        → Provisioning | Cancelled
Provisioning → Ready | Failed | Cancelled
Ready        → Running | Cancelled
Running      → Verifying | Paused | Blocked | Failed | Cancelled
Verifying    → Completed | Running | Blocked | Failed | Cancelled
Paused       → Running | Failed | Cancelled          (resume re-validates lease)
Blocked      → Running | Failed | Cancelled
Completed    → ∅        Failed → ∅       Cancelled → ∅   (terminal)
```

`QUARANTINED` is a **binding** lifecycle state, never a RunStatus (ADR-002). A Run whose binding is quarantined is `Paused` (lease loss) or `Blocked` (awaiting owner decision).

## File Structure

```
vingilot/coordinator/
├── Cargo.toml                  # [workspace] + single member crate for now
├── coordinator/
│   ├── Cargo.toml
│   ├── migrations/0001_init.sql
│   └── src/
│       ├── lib.rs              # module wiring + shared types
│       ├── domain.rs           # pure: statuses, transitions, modes — no DB, no IO
│       ├── store.rs            # PgPool bootstrap, migrations runner
│       ├── workspace.rs        # CAS mutation protocol (ADR-002 §Mutation protocol)
│       ├── run.rs              # Run CRUD + transition persistence
│       ├── binding.rs          # WorktreeBinding, leases, fencing epochs, validate_op
│       ├── saga.rs             # provisioning saga + compensation + quarantine
│       ├── reconcile.rs        # expired-lease sweep, wall-clock budget enforcement
│       └── http.rs             # axum API speaking the mutation protocol verbatim
└── (tests colocated: src/*/ unit in-module, tests/ dir for DB integration)
vingilot/scripts/coordinator-check.sh   # fmt + clippy -D warnings + test, standalone
```

---

### Task 1: Standalone workspace, schema, and the check gate

**Files:**
- Create: `vingilot/coordinator/Cargo.toml`, `vingilot/coordinator/coordinator/Cargo.toml`
- Create: `vingilot/coordinator/coordinator/migrations/0001_init.sql`
- Create: `vingilot/coordinator/coordinator/src/lib.rs`, `src/store.rs`
- Create: `vingilot/scripts/coordinator-check.sh`

**Interfaces:**
- Produces: `store::connect(url: &str) -> Result<sqlx::PgPool, StoreError>`; `store::migrate(pool: &PgPool) -> Result<(), StoreError>`; the check script every later task runs before committing.

- [ ] **Step 1: Workspace + crate manifests**

`vingilot/coordinator/Cargo.toml`:

```toml
[workspace]
members = ["coordinator"]
resolver = "2"
```

`vingilot/coordinator/coordinator/Cargo.toml`:

```toml
[package]
name = "vingilot-coordinator"
version = "0.1.0"
edition = "2021"
license = "Apache-2.0"

[dependencies]
tokio = { version = "1", features = ["rt-multi-thread", "macros", "time", "signal"] }
axum = "0.8"
sqlx = { version = "0.8", features = ["runtime-tokio", "postgres", "uuid", "chrono", "json"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
sha2 = "0.10"
hex = "0.4"
thiserror = "2"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

[dev-dependencies]
anyhow = "1"
reqwest = { version = "0.12", features = ["json"] }
```

- [ ] **Step 2: Schema**

`migrations/0001_init.sql` — the ADR-002/003 model, no more:

```sql
CREATE TABLE workspaces (
    id          UUID PRIMARY KEY,
    revision    BIGINT NOT NULL DEFAULT 0,
    state       JSONB  NOT NULL DEFAULT '{}'::jsonb,
    state_hash  TEXT   NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit of every accepted mutation: prev/next revision + the mutation list.
CREATE TABLE workspace_events (
    workspace_id  UUID   NOT NULL REFERENCES workspaces(id),
    revision      BIGINT NOT NULL,
    prev_revision BIGINT NOT NULL,
    mutations     JSONB  NOT NULL,
    state_hash    TEXT   NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, revision)
);

CREATE TABLE runs (
    id            UUID PRIMARY KEY,
    workspace_id  UUID NOT NULL REFERENCES workspaces(id),
    parent_run_id UUID REFERENCES runs(id),
    objective     TEXT NOT NULL,
    mode          TEXT NOT NULL CHECK (mode IN ('interactive','delegated','chat')),
    status        TEXT NOT NULL CHECK (status IN
        ('draft','provisioning','ready','running','verifying','paused',
         'blocked','completed','failed','cancelled')),
    -- wall-clock budget: enforceable. tokens: observed only (ADR-002).
    wall_limit_secs   BIGINT,
    wall_started_at   TIMESTAMPTZ,
    tokens_observed   BIGINT NOT NULL DEFAULT 0,
    tokens_observed_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE run_transitions (
    run_id      UUID NOT NULL REFERENCES runs(id),
    seq         BIGINT NOT NULL,
    from_status TEXT NOT NULL,
    to_status   TEXT NOT NULL,
    reason      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, seq)
);

CREATE TABLE worktree_bindings (
    id            UUID PRIMARY KEY,
    repo_id       TEXT NOT NULL,
    target_id     TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('primary','task')),
    base_commit   TEXT NOT NULL,
    branch        TEXT,
    lifecycle     TEXT NOT NULL CHECK (lifecycle IN
        ('provisioning','ready','quarantined','removed')),
    owner_run_id  UUID REFERENCES runs(id),
    -- fencing (ADR-003): monotonic epoch; ops must present the current one.
    epoch             BIGINT NOT NULL DEFAULT 0,
    lease_expires_at  TIMESTAMPTZ,
    idempotency_key   TEXT NOT NULL UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE run_worktree_grants (
    run_id     UUID NOT NULL REFERENCES runs(id),
    binding_id UUID NOT NULL REFERENCES worktree_bindings(id),
    access     TEXT NOT NULL CHECK (access IN ('read','write')),
    PRIMARY KEY (run_id, binding_id)
);

-- V1 default ≤1 writable worktree per Run (ADR / K8), enforced in the DB.
CREATE UNIQUE INDEX one_writable_per_run
    ON run_worktree_grants (run_id) WHERE access = 'write';
```

- [ ] **Step 3: store.rs + lib.rs**

`store.rs`: `connect()` (PgPool with 5s acquire timeout), `migrate()` running `sqlx::migrate!("./migrations")`, `StoreError` via thiserror. `lib.rs` declares modules (only `store` and `domain` exist yet — add stubs `pub mod domain;` with an empty file if needed, or declare modules as tasks add them; keep it compiling).

Test helper used by ALL later DB tests — put in `src/store.rs` under `#[cfg(test)]` is wrong (integration tests can't reach it); put it in `tests/common/mod.rs`:

```rust
pub async fn test_pool() -> Option<sqlx::PgPool> {
    let url = match std::env::var("COORD_DATABASE_URL") {
        Ok(u) => u,
        Err(_) => {
            eprintln!("SKIP: COORD_DATABASE_URL not set");
            return None;
        }
    };
    let pool = vingilot_coordinator::store::connect(&url).await.ok()?;
    vingilot_coordinator::store::migrate(&pool).await.ok()?;
    Some(pool)
}
```

- [ ] **Step 4: DB bootstrap + check script**

`vingilot/scripts/coordinator-check.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../coordinator"
# Create the database if the vingilot postgres is up (idempotent, best-effort).
if command -v docker >/dev/null && docker ps --format '{{.Names}}' | grep -q '^vingilot-postgres$'; then
  docker exec vingilot-postgres psql -U buzz -d buzz -tc \
    "SELECT 1 FROM pg_database WHERE datname='vingilot_coordinator'" | grep -q 1 || \
  docker exec vingilot-postgres psql -U buzz -d buzz -c "CREATE DATABASE vingilot_coordinator"
  export COORD_DATABASE_URL="${COORD_DATABASE_URL:-postgres://buzz:buzz_dev@localhost:5435/vingilot_coordinator}"
fi
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

`chmod +x` it.

- [ ] **Step 5: Run the gate, first integration test**

`tests/store_smoke.rs`: connect + migrate + `SELECT count(*) FROM workspaces` returns 0. Run `./vingilot/scripts/coordinator-check.sh` — expect green with the DB test executed (not skipped). Then `./vingilot/scripts/check-seams.sh` (exit 0).

- [ ] **Step 6: Commit**

Message: `feat(coordinator): standalone workspace, schema, and check gate` + body explaining the own-workspace/no-seam decision and the ≤1-writable partial unique index. Trailers per ADR-004.

---

### Task 2: Workspace CAS — the mutation protocol

**Files:**
- Create: `src/workspace.rs`; Test: `tests/workspace_cas.rs`
- Modify: `src/lib.rs` (add module)

**Interfaces:**
- Produces:

```rust
pub struct MutationOutcome { pub accepted: bool, pub revision: i64, pub state_hash: String }
pub async fn apply_mutations(
    pool: &PgPool, workspace_id: Uuid, expected_revision: i64,
    mutations: &[serde_json::Value],
) -> Result<MutationOutcome, WorkspaceError>
pub async fn ensure_workspace(pool: &PgPool, workspace_id: Uuid) -> Result<(), WorkspaceError>
pub fn state_hash(state: &serde_json::Value) -> String   // sha256 hex of canonical JSON
```

ADR-002 §Mutation protocol, verbatim: one transaction, `UPDATE ... SET revision = revision + 1, ... WHERE id = $1 AND revision = $2`; zero rows affected ⇒ stale ⇒ **`accepted:false` carrying the CURRENT revision and state hash** (read them in the same transaction). Accepted mutations append a `workspace_events` row. Mutations for V1 are JSON merge-patches applied server-side (`state = state || patch` semantics via `jsonb` merge in Rust, then written whole); the protocol shape is what matters, not the patch language.

- [ ] **Step 1: Write failing tests** — four of them:
  1. `accepts_at_expected_revision` — apply at rev 0, get `accepted:true, revision:1`, event row exists.
  2. `rejects_stale_with_current_state` — apply at rev 0 twice; second gets `accepted:false, revision:1` and the hash of the winner's state. **Assert the reject carries data, not just a boolean** — that is the whole protocol.
  3. `two_racing_writers_one_wins` — `tokio::join!` two `apply_mutations` at the same expected revision; exactly one accepted (assert `accepted_count == 1`).
  4. `hash_is_deterministic` — same state twice ⇒ same hash (unit, no DB).
- [ ] **Step 2: Run, confirm all fail** (module doesn't exist).
- [ ] **Step 3: Implement** — single `sqlx::Transaction`; no unwrap; `WorkspaceError::NotFound` distinct from stale.
- [ ] **Step 4: Green + gates** — `coordinator-check.sh`, `check-seams.sh`.
- [ ] **Step 5: Commit** — `feat(coordinator): workspace CAS with data-carrying rejections`.

---

### Task 3: Run state machine — pure domain

**Files:**
- Create: `src/domain.rs` (replace stub); unit tests in-module.

**Interfaces:**
- Produces:

```rust
pub enum RunStatus { Draft, Provisioning, Ready, Running, Verifying,
                     Paused, Blocked, Completed, Failed, Cancelled }
pub enum RunMode { Interactive, Delegated, Chat }
impl RunStatus {
    pub fn can_transition_to(self, next: RunStatus) -> bool  // table above, exact
    pub fn is_terminal(self) -> bool
    pub fn as_str(self) -> &'static str      // matches the SQL CHECK strings
    pub fn parse(s: &str) -> Option<RunStatus>
}
```

- [ ] **Step 1: Failing tests** — (a) every legal edge from the table accepted; (b) a **complete** illegal-edge sweep: iterate all 10×10 pairs, assert `can_transition_to` matches a hardcoded legal-set constant — so adding a status later forces the test to be revisited; (c) terminal states allow nothing; (d) `parse(as_str(x)) == Some(x)` for all variants (round-trip against the SQL strings).
- [ ] **Step 2-4:** red → implement (a `match` over pairs, no macros) → green, gates.
- [ ] **Step 5: Commit** — `feat(coordinator): run state machine as a closed transition table`.

---

### Task 4: Runs persisted — create, transition, parent depth

**Files:**
- Create: `src/run.rs`; Test: `tests/run_lifecycle.rs`

**Interfaces:**
- Produces:

```rust
pub struct NewRun { pub workspace_id: Uuid, pub parent_run_id: Option<Uuid>,
                    pub objective: String, pub mode: RunMode,
                    pub wall_limit_secs: Option<i64> }
pub async fn create(pool, new: NewRun) -> Result<Uuid, RunError>          // status = Draft
pub async fn transition(pool, run_id: Uuid, to: RunStatus, reason: &str)
    -> Result<(), RunError>   // validates via domain table INSIDE the tx; appends run_transitions
pub async fn depth(pool, run_id: Uuid) -> Result<i64, RunError>          // walk parent chain (ADR: depth is DERIVED, never trusted input)
```

- [ ] **Step 1: Failing tests** — create→Draft; legal chain Draft→Provisioning→Ready→Running recorded with seq 1,2,3; illegal `Draft→Running` rejected with `RunError::IllegalTransition{from,to}` AND no row appended; depth: run→child→grandchild ⇒ 2; unknown parent ⇒ FK error surfaces as `RunError`.
- [ ] **Step 2-4:** red → implement (transition = `SELECT ... FOR UPDATE` then validate then update+append, one tx) → green, gates.
- [ ] **Step 5: Commit** — `feat(coordinator): persisted runs with validated transitions and derived depth`.

---

### Task 5: Bindings, leases, fencing — validate_op fail-closed

**Files:**
- Create: `src/binding.rs`; Test: `tests/fencing.rs`

**Interfaces:**
- Produces:

```rust
pub struct Lease { pub binding_id: Uuid, pub epoch: i64, pub expires_at: DateTime<Utc> }
pub async fn create_binding(pool, run_id: Uuid, repo_id: &str, target_id: &str,
    role: &str, base_commit: &str, branch: Option<&str>, idempotency_key: &str)
    -> Result<Uuid, BindingError>       // idempotent: same key ⇒ same binding id back
pub async fn grant(pool, run_id: Uuid, binding_id: Uuid, access: Access) -> Result<(), BindingError>
pub async fn acquire_lease(pool, binding_id: Uuid, ttl_secs: i64) -> Result<Lease, BindingError>
    // bumps epoch (+1) every acquire — a re-acquire after expiry MUST fence out the old holder
pub async fn renew_lease(pool, binding_id: Uuid, epoch: i64, ttl_secs: i64) -> Result<Lease, BindingError>
    // same epoch kept; stale epoch ⇒ BindingError::StaleEpoch
pub async fn validate_op(pool, run_id: Uuid, binding_id: Uuid, epoch: i64)
    -> Result<(), OpDenied>
```

`validate_op` is ADR-003's per-operation check and it is **fail-closed**: deny unless binding exists ∧ `owner_run_id == run_id` ∧ `lifecycle == 'ready'` ∧ `epoch` matches ∧ lease unexpired. `OpDenied` is an enum naming WHICH check failed — the executor surfaces it, so "denied" must never be a mystery.

- [ ] **Step 1: Failing tests** — the full denial matrix, one test per arm: wrong run, quarantined lifecycle, stale epoch (acquire → acquire again → old epoch denied), expired lease (acquire with ttl 1s, sleep 2s, denied), plus the happy path; and idempotency: `create_binding` twice with one key ⇒ same id, one row.
- [ ] **Step 2-4:** red → implement → green, gates. The ≤1-writable index gets its test here too: second `grant(.., Write)` on the same run ⇒ `BindingError::WritableLimitExceeded` (map the unique-violation SQLSTATE).
- [ ] **Step 5: Commit** — `feat(coordinator): fencing epochs and a fail-closed validate_op`.

---

### Task 6: Provisioning saga — idempotent forward, compensating backward

**Files:**
- Create: `src/saga.rs`; Test: `tests/saga.rs`

**Interfaces:**
- Produces:

```rust
pub struct ProvisionSpec { pub run_id: Uuid, pub worktrees: Vec<WorktreeSpec> }
pub struct WorktreeSpec { pub repo_id: String, pub target_id: String, pub role: String,
                          pub base_commit: String, pub branch: Option<String>,
                          pub access: Access, pub idempotency_key: String }
pub async fn provision(pool, spec: &ProvisionSpec) -> Result<(), SagaError>
    // Draft→Provisioning→(bindings+grants+lease each, idempotent)→Ready
pub async fn compensate(pool, run_id: Uuid) -> Result<(), SagaError>
    // revoke grants; bindings: provisioning→removed, ready→quarantined; run→Failed
```

ADR-002 §5.3 invariants under test, not prose:
- **Idempotent forward**: run `provision` twice with the same spec ⇒ second call is a no-op success (idempotency keys dedupe bindings; transitions already-done are skipped, not errors).
- **Crash-resume**: simulate by calling `provision`, then manually deleting the Ready transition and calling again ⇒ converges to Ready without duplicate bindings.
- **Compensation**: a spec whose second worktree has a duplicate idempotency key belonging to ANOTHER run ⇒ `provision` fails, `compensate` leaves **no editable, ownerless worktree**: every binding this run created is `removed` or `quarantined`, grants gone, run `Failed`.
- [ ] Steps: red → implement → green, gates → commit `feat(coordinator): provisioning saga that never leaves an ownerless worktree`.

---

### Task 7: Reconciler + budget — leases sweep, wall-clock enforced, tokens observed

**Files:**
- Create: `src/reconcile.rs`; Test: `tests/reconcile.rs`
- Modify: `src/run.rs` (token observation append)

**Interfaces:**
- Produces:

```rust
pub async fn sweep_once(pool) -> Result<SweepReport, ReconcileError>
pub struct SweepReport { pub leases_expired: u32, pub runs_paused: u32,
                         pub bindings_quarantined: u32, pub runs_wall_exceeded: u32 }
pub async fn observe_tokens(pool, run_id: Uuid, total: i64, observed_at: DateTime<Utc>)
    -> Result<(), RunError>   // monotonic max; NEVER pauses a run (ADR-002: observed ≠ enforced)
```

`sweep_once`:
1. Expired lease on a `ready` binding owned by a `running` Run ⇒ binding → `quarantined`, run → `Paused` (reason `"lease lost"`). ADR-002 partition rule, exactly.
2. `running` Run with `wall_started_at + wall_limit_secs < now()` ⇒ run → `Paused` (reason `"wall clock budget exhausted"`). Wall clock is the ENFORCEABLE budget component.
3. Returns counts; a long-running `tokio::time::interval` wrapper `run_reconciler(pool, period)` calls it — the loop is 5 lines, the logic all lives in the testable `sweep_once`.

- [ ] **Step 1: Failing tests** — lease-expiry path (1s ttl + sleep); wall-clock path (limit 1s, started 2s ago via direct SQL update); **token observation never pauses**: observe tokens wildly over any number ⇒ run still `Running` (this is ADR-002's enforce-vs-observe distinction as a test); monotonicity: observing a LOWER total keeps the max.
- [ ] **Step 2-4:** red → implement → green, gates.
- [ ] **Step 5: Commit** — `feat(coordinator): reconciler sweep; wall clock enforced, tokens observed`.

---

### Task 8: HTTP API — the protocol on the wire

**Files:**
- Create: `src/http.rs`, `src/main.rs` (bin target); Test: `tests/http_api.rs`

**Interfaces (all JSON; error body = `{ "error": <machine-readable str>, "detail": <human str> }`):**

```
POST /v1/workspaces/{id}/mutations   { expected_revision, mutations: [...] }
  → 200 { accepted: true,  revision, state_hash }
  → 409 { accepted: false, revision, state_hash }        # stale — DATA-CARRYING, per ADR-002
POST /v1/runs                        { workspace_id, parent_run_id?, objective, mode, wall_limit_secs? } → 201 { run_id }
POST /v1/runs/{id}/transition        { to, reason } → 200 | 409 (illegal edge, names from/to)
POST /v1/runs/{id}/tokens            { total, observed_at } → 204
POST /v1/bindings/{id}/validate-op   { run_id, epoch } → 204 | 403 { error: <which check failed> }
POST /v1/runs/{id}/provision         ProvisionSpec body → 200 | 409 + compensation applied
GET  /v1/workspaces/{id}             → 200 { revision, state_hash, state }   # read snapshot
GET  /v1/runs/{id}                   → 200 full run row + grants + transitions
```

Auth for V1 single-owner dev: static bearer token from `COORD_AUTH_TOKEN` env; missing env ⇒ the server REFUSES to start (fail-closed, no auth-less mode to forget about). Constant-time comparison.

- [ ] **Step 1: Failing contract tests** — spawn the axum app on an ephemeral port (`TcpListener::bind("127.0.0.1:0")`), drive with reqwest: the 409-carries-current-state contract; illegal transition names both states; validate-op 403 body names the failed check; missing/wrong bearer ⇒ 401; **server refuses to boot without `COORD_AUTH_TOKEN`**.
- [ ] **Step 2-4:** red → implement (thin: every handler = parse → call the module fn → map error; zero business logic in http.rs) → green, gates.
- [ ] **Step 5: Commit** — `feat(coordinator): HTTP mutation API with data-carrying conflicts`.

---

### Task 9: Conformance doc + branch wrap-up

**Files:**
- Create: `vingilot/docs/coordinator.md`

- [ ] **Step 1:** Write `vingilot/docs/coordinator.md`: what runs where (5435, database `vingilot_coordinator`), how to run the gate, the API table above, and an **ADR-conformance table** — each ADR-002/003 requirement this plan claimed, mapped to the test file that proves it, with any gaps listed honestly (expected gaps: relay snapshot publishing + signing deferred; queued-write revision pinning lives client-side and is NOT in this service yet; capability grants beyond worktree access are schema-only).
- [ ] **Step 2:** Full gate re-run: `coordinator-check.sh` verbatim output into the doc's appendix; `check-seams.sh` exit 0.
- [ ] **Step 3:** Commit `docs(coordinator): conformance map and runbook`.

---

## Self-Review

**Spec coverage:** ADR-002 mutation protocol → Task 2+8 (the 409-carries-data contract is tested twice, module and wire). Partition rules → Task 7 (lease→Paused, quarantine) and Task 5 (stale-epoch fail-closed). Budget enforce-vs-observe → Task 7 (token observation cannot pause — as a test). ADR-003 fencing per-op → Task 5. Saga §5.3 (idempotent, compensating, never-ownerless) → Task 6. Run model amendments (parentRunId, full status set, modes) → Tasks 3–4. K8 ≤1 writable → schema index (Task 1) + test (Task 5). Deliberately absent, recorded in Task 9: relay snapshot publishing/signing, client-side queued-write pinning, non-worktree capability kinds.

**Placeholders:** none — every step names its tests and the exact signatures; SQL is complete in Task 1.

**Type consistency:** `RunStatus`/`RunMode`/`Access` defined once in Task 3 (domain) and consumed by Tasks 4–8 with the same variants; `as_str` round-trips the SQL CHECK strings and Task 3 tests that; `validate_op(pool, run_id, binding_id, epoch)` signature identical in Task 5 (module) and Task 8 (wire).
