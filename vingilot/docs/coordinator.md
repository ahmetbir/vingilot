# Coordinator Core

The control-plane service ADR-002 decided: a single authority over Workspace
state, Runs, WorktreeBindings, capability grants, leases/fencing epochs, and
budgets. `vingilot/coordinator/` is a standalone Rust Cargo workspace — NOT a
member of the repo-root workspace — with a Postgres store and an HTTP mutation
API, test-proven against the real database. Relay snapshot publishing and
signing are explicitly out of scope (see Deferred Gaps below).

## Where it runs

- Postgres: the existing `vingilot-postgres` container, port **5435**.
- Database: `vingilot_coordinator` (created on demand by the check script).
- Connection string: `postgres://buzz:buzz_dev@localhost:5435/vingilot_coordinator`.
- Crate: `vingilot-coordinator` at `vingilot/coordinator/coordinator/`, its own
  Cargo workspace rooted at `vingilot/coordinator/Cargo.toml` — deliberately
  outside the repo-root workspace, so no `Cargo.toml` seam is needed and
  upstream `cargo test` is unaffected.

## Running the gate

```bash
. ./bin/activate-hermit
export COORD_DATABASE_URL=postgres://buzz:buzz_dev@localhost:5435/vingilot_coordinator
./vingilot/scripts/coordinator-check.sh   # fmt --check, clippy -D warnings, cargo test --workspace
./vingilot/scripts/check-seams.sh         # confirms no files landed outside vingilot/
```

`coordinator-check.sh` creates the `vingilot_coordinator` database itself
(idempotent, via `docker exec` into `vingilot-postgres`) when Docker and the
container are present, then exports `COORD_DATABASE_URL` if it isn't already
set. DB-backed integration tests print `SKIP: COORD_DATABASE_URL not set` and
return early when the variable is absent; they run for real when it is set.

## HTTP API

All bodies are JSON. Error body shape: `{ "error": <machine-readable str>, "detail": <human str> }`.
Auth: static bearer token from `COORD_AUTH_TOKEN`; the server refuses to boot
if the env var is missing (fail-closed, no auth-less mode). Comparison is
constant-time.

| Method | Path | Request | Success | Failure |
|---|---|---|---|---|
| POST | `/v1/workspaces/{id}/mutations` | `{ expected_revision, mutations: [...] }` | `200 { accepted: true, revision, state_hash }` | `409 { accepted: false, revision, state_hash }` — stale, carries the winner's data |
| POST | `/v1/runs` | `{ workspace_id, parent_run_id?, objective, mode, wall_limit_secs? }` | `201 { run_id }` | — |
| POST | `/v1/runs/{id}/transition` | `{ to, reason }` | `200` | `409` — illegal edge, names both `from` and `to` |
| POST | `/v1/runs/{id}/tokens` | `{ total, observed_at }` | `204` | — |
| POST | `/v1/bindings/{id}/validate-op` | `{ run_id, epoch }` | `204` | `403 { error: <which check failed> }` |
| POST | `/v1/runs/{id}/provision` | `ProvisionSpec` | `200` | `409` + compensation already applied |
| GET | `/v1/workspaces/{id}` | — | `200 { revision, state_hash, state }` | — |
| GET | `/v1/runs/{id}` | — | `200` full run row + grants + transitions | — |

Every route requires the bearer token; missing or wrong token → `401`.

## Domain model

```
RunStatus:   Draft | Provisioning | Ready | Running | Verifying | Paused
             | Blocked | Completed | Failed | Cancelled
RunMode:     Interactive | Delegated | Chat
Lifecycle:   Provisioning | Ready | Quarantined | Removed   (WorktreeBinding)
Access:      Read | Write
```

`QUARANTINED` is a binding lifecycle state, never a `RunStatus` (ADR-002). A
Run whose binding is quarantined is `Paused` (lease loss) or `Blocked`
(awaiting owner decision).

## ADR conformance table

Every ADR-002/003 claim this plan made, mapped to the specific test proving it.

| Claim (ADR) | Test file | Test name(s) |
|---|---|---|
| Mutation protocol: accept at expected revision, append event row | `tests/workspace_cas.rs` | `accepts_at_expected_revision` |
| Mutation protocol: stale write rejected, **carries current revision + state hash** (not just a bool) | `tests/workspace_cas.rs` | `rejects_stale_with_current_state` |
| Mutation protocol: concurrent writers at same revision — exactly one wins | `tests/workspace_cas.rs` | `two_racing_writers_one_wins` |
| State hash is deterministic (canonical JSON, sha256 hex) | `src/workspace.rs` | `workspace::tests::hash_is_deterministic` |
| Mutation protocol on the wire: 409 carries current state (same contract as above, over HTTP) | `tests/http_api.rs` | `mutation_conflict_carries_current_state` |
| Run status/mode model, full closed transition table (every legal edge accepted) | `src/domain.rs` | `domain::tests::every_legal_edge_from_the_table_is_accepted` |
| Transition table is *closed* — exhaustive 10×10 sweep matches the legal set exactly | `src/domain.rs` | `domain::tests::exhaustive_sweep_matches_the_legal_set_exactly` |
| Terminal states (`Completed`/`Failed`/`Cancelled`) allow no further transitions | `src/domain.rs` | `domain::tests::terminal_states_allow_no_transitions` |
| `as_str`/`parse` round-trip the SQL CHECK strings for `RunStatus`, `RunMode`, `Access` | `src/domain.rs` | `domain::tests::as_str_round_trips_through_parse_for_every_status`, `run_mode_round_trips_through_parse`, `access_round_trips_through_parse` |
| Runs persist Draft→Provisioning→Ready→Running with sequential `run_transitions.seq` | `tests/run_lifecycle.rs` | `legal_chain_recorded_with_sequential_seq` |
| Illegal transition rejected AND no `run_transitions` row appended | `tests/run_lifecycle.rs` | `illegal_transition_rejected_without_appending_row` |
| Run depth is derived by walking the parent chain, never trusted input | `tests/run_lifecycle.rs` | `depth_walks_parent_chain` |
| Illegal transition named on the wire (both `from` and `to`) | `tests/http_api.rs` | `illegal_transition_names_both_states` |
| ADR-003 fencing: `validate_op` is fail-closed, denies on wrong run | `tests/fencing.rs` | `wrong_run_is_denied` |
| ADR-003 fencing: denies when binding lifecycle is quarantined | `tests/fencing.rs` | `quarantined_lifecycle_is_denied` |
| ADR-003 fencing: stale epoch denied after re-acquire bumps the epoch | `tests/fencing.rs` | `stale_epoch_after_reacquire_is_denied` |
| ADR-003 fencing: expired lease denied | `tests/fencing.rs` | `expired_lease_is_denied` |
| ADR-003 fencing: happy path validates | `tests/fencing.rs` | `happy_path_validates` |
| `create_binding` is idempotent — same key ⇒ same binding id, one row | `tests/fencing.rs` | `create_binding_is_idempotent` |
| `OpDenied` names the failed check on the wire (403 body) | `tests/http_api.rs` | `validate_op_403_names_the_failed_check` |
| K8 ≤1 writable worktree per Run, enforced in the DB (partial unique index) | `migrations/0001_init.sql` (`one_writable_per_run`) + `tests/fencing.rs` | `second_writable_grant_on_same_run_is_rejected` |
| Saga §5.3: forward provisioning moves Draft→Ready with bindings + grants | `tests/saga.rs` | `provision_moves_draft_to_ready_with_bindings_and_grants` |
| Saga §5.3: idempotent forward — same spec twice is a no-op success | `tests/saga.rs` | `second_call_with_same_spec_is_a_no_op` |
| Saga §5.3: crash-resume converges to Ready without duplicate bindings | `tests/saga.rs` | `crash_resume_converges_to_ready_without_duplicate_bindings` |
| Saga §5.3: compensation on conflict leaves no editable, ownerless worktree; run → Failed | `tests/saga.rs` | `conflicting_idempotency_key_fails_and_compensates` |
| Partition rule: expired lease on a ready binding quarantines the binding and pauses the owning Run | `tests/reconcile.rs` | `expired_lease_quarantines_binding_and_pauses_run` |
| Budget: wall-clock is the ENFORCEABLE component — exhausted budget pauses the run | `tests/reconcile.rs` | `wall_clock_budget_exhausted_pauses_run` |
| Budget: token observation is monitored only, NEVER pauses a run (enforce-vs-observe) | `tests/reconcile.rs` | `token_observation_never_pauses_the_run` |
| Budget: token observation keeps the monotonic max, ignores a lower later value | `tests/reconcile.rs` | `token_observation_keeps_the_monotonic_max` |
| Auth: server refuses to boot without `COORD_AUTH_TOKEN` (fail-closed) | `tests/http_api.rs` (integration) + `src/http.rs` (unit) | `server_refuses_to_boot_without_auth_token`; `http::tests::missing_token_is_refused`, `empty_token_is_refused`, `non_empty_token_is_accepted` |
| Auth: missing/wrong bearer token rejected with 401 | `tests/http_api.rs` | `missing_bearer_is_401`, `wrong_bearer_is_401` |
| Store bootstrap: connect + run migrations against the real Postgres | `tests/store_smoke.rs` | `connects_migrates_and_counts_zero_workspaces` |

## Deferred gaps (recorded honestly, not silently resolved)

These are explicitly out of scope for this plan, per the plan's own
Self-Review:

- **Relay snapshot publishing and signing** — needs a relay seam and key
  management; a later plan.
- **Queued-write revision pinning** — lives client-side today, NOT in this
  service.
- **Capability grants beyond worktree access** — schema-only for now; only
  `run_worktree_grants` (read/write on a `WorktreeBinding`) is implemented and
  enforced. Other capability kinds named in ADR-002 are not yet modeled.

## Appendix: full gate output

Captured from `./vingilot/scripts/coordinator-check.sh` with
`COORD_DATABASE_URL` set (DB tests executed, not skipped):

```
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.29s
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.14s
     Running unittests src/lib.rs (target/debug/deps/vingilot_coordinator-383c2ad46853f838)

running 12 tests
test domain::tests::as_str_round_trips_through_parse_for_every_status ... ok
test domain::tests::non_terminal_states_are_not_terminal ... ok
test domain::tests::run_mode_round_trips_through_parse ... ok
test domain::tests::terminal_states_allow_no_transitions ... ok
test domain::tests::every_legal_edge_from_the_table_is_accepted ... ok
test domain::tests::parse_rejects_unknown_strings ... ok
test domain::tests::exhaustive_sweep_matches_the_legal_set_exactly ... ok
test domain::tests::access_round_trips_through_parse ... ok
test http::tests::empty_token_is_refused ... ok
test http::tests::missing_token_is_refused ... ok
test http::tests::non_empty_token_is_accepted ... ok
test workspace::tests::hash_is_deterministic ... ok

test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running unittests src/main.rs (target/debug/deps/vingilot_coordinator-2951db0aae353157)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/fencing.rs (target/debug/deps/fencing-4aaa4a6cf6971cb9)

running 7 tests
test happy_path_validates ... ok
test wrong_run_is_denied ... ok
test stale_epoch_after_reacquire_is_denied ... ok
test quarantined_lifecycle_is_denied ... ok
test second_writable_grant_on_same_run_is_rejected ... ok
test create_binding_is_idempotent ... ok
test expired_lease_is_denied ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.11s

     Running tests/http_api.rs (target/debug/deps/http_api-e8d2d2005c06f5da)

running 6 tests
test server_refuses_to_boot_without_auth_token ... ok
test mutation_conflict_carries_current_state ... ok
test missing_bearer_is_401 ... ok
test validate_op_403_names_the_failed_check ... ok
test illegal_transition_names_both_states ... ok
test wrong_bearer_is_401 ... ok

test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s

     Running tests/reconcile.rs (target/debug/deps/reconcile-fcdaf349766e0193)

running 4 tests
test token_observation_keeps_the_monotonic_max ... ok
test wall_clock_budget_exhausted_pauses_run ... ok
test token_observation_never_pauses_the_run ... ok
test expired_lease_quarantines_binding_and_pauses_run ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.11s

     Running tests/run_lifecycle.rs (target/debug/deps/run_lifecycle-a82173fe496de7e4)

running 5 tests
test unknown_parent_surfaces_as_run_error ... ok
test create_defaults_to_draft ... ok
test depth_walks_parent_chain ... ok
test illegal_transition_rejected_without_appending_row ... ok
test legal_chain_recorded_with_sequential_seq ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s

     Running tests/saga.rs (target/debug/deps/saga-976095a75289cc0d)

running 5 tests
test provision_moves_draft_to_ready_with_bindings_and_grants ... ok
test second_call_with_same_spec_is_a_no_op ... ok
test crash_resume_converges_to_ready_without_duplicate_bindings ... ok
test unexpected_status_is_rejected ... ok
test conflicting_idempotency_key_fails_and_compensates ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s

     Running tests/store_smoke.rs (target/debug/deps/store_smoke-d515c22e71179b99)

running 1 test
test connects_migrates_and_counts_zero_workspaces ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s

     Running tests/workspace_cas.rs (target/debug/deps/workspace_cas-041be8ddfc3fb1f2)

running 3 tests
test rejects_stale_with_current_state ... ok
test accepts_at_expected_revision ... ok
test two_racing_writers_one_wins ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s

   Doc-tests vingilot_coordinator

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```
