# ADR-002 — A single control-plane authority

- **Status:** Proposed (blocks Phase 0 exit)
- **Date:** 2026-08-01
- **Supersedes:** the "relay CAS for Workspace, coordinator for Run" split proposed
  during review; and §4.2 of the architecture proposal, which left the authority
  question open
- **Related:** ADR-001, ADR-003 (fencing and execution)

## Context

§4.2 of the proposal correctly identified that a Nostr replaceable event is
last-write-wins, and that blind LWW cannot be the mutation protocol for Workspace
membership: two owner devices racing would silently erase each other. It proposed a
compare-and-swap API:

```
updateWorkspace(workspaceId, expectedRevision, mutations[])
  -> accept atomically and emit the next revision
  -> or reject as stale with the current state/revision
```

What it did not settle is **where that guarantee lives**. Two candidates were
considered in review:

- **Split** — implement real CAS in the relay for Workspace state (unique index on
  `(kind, pubkey, d_tag, revision)`, insert at `expected + 1`, uniqueness violation
  means stale), and keep Run state in a coordinator database.
- **Single** — keep both Workspace and Run authority in the coordinator database;
  the relay carries notification, audit, and a readable snapshot.

## Decision

**The coordinator database is the single authority for all control-plane state.**
This covers Workspace membership, Run state, WorktreeBinding lifecycle, capability
grants, budgets, and leases.

**The relay is not an authority.** It carries:

- signed mutation *requests* (as a transport, where a client is relay-only);
- notification and fan-out of accepted state;
- the durable, signed audit trail;
- a readable snapshot for clients that do not talk to the coordinator directly.

### Mutation protocol

A mutation is applied inside one coordinator transaction that checks
`expected_revision` against the current row. On success the coordinator writes the
next revision and publishes a signed snapshot event to the relay. On conflict it
rejects and returns the **current revision and state hash**, so the client can
render conflict/retry UX rather than guessing.

A rejection is a first-class protocol response, not an error string: `accepted:
false` plus current revision plus state hash.

### Partition behaviour

This ADR closes the partition gap the proposal left open. There is one set of
rules, not one per subsystem:

- **Coordinator unreachable** → no new Run, no new grant, no Workspace mutation.
  Client caches become read-only and say so in the UI.
- **Target cannot renew its lease** → the Run moves to `PAUSED` / `RECONCILING`.
- **A target that reconnects with a stale epoch performs no new broker
  operation.** Fail-closed. (Epoch validation is specified in ADR-003.)
- **`QUARANTINED` is a `WorktreeBinding` lifecycle state, not a Run status.** A Run
  whose binding is quarantined is blocked, not quarantined.

### Queued writes pin the revision they were made against

A write composed while the coordinator is unreachable is queued, not lost. Every
queued write **records the revision it was authored against**, and on reconnect it
applies only if that revision still holds. If the state moved, the write does not
apply and does not silently rebase — it re-prompts.

This is the same staleness rule the surface-action protocol already requires
(actions carry the event and revision they target; stale and replayed actions are
rejected). It is stated here because the control plane's highest-stakes write is
the exception people reach for first: **an owner-signed merge.**

A queued merge pins the PR head, the base, the approval it relies on, and the
check results. All four must still match on reconnect. A merge signed at one head
and applied at another is a replayed authorization, and the fact that the signature
is cryptographically valid is exactly what makes it dangerous — the signature
proves who decided, not what they decided over.

The same applies to a retried CAS write after a conflict resolution: the retry
names the revision it rebases onto, and a second conflict re-opens the choice
rather than resolving it silently.

### Budget enforceability is not uniform

`RunBudget` has components the coordinator can enforce and components it can only
observe, and the difference depends on how the Run is executed:

| Component | Delegated Run (harness speaks ACP) | Interactive Run (harness owns a PTY) |
|---|---|---|
| Wall clock | Enforceable — the app owns the clock and can pause at the cap | Enforceable — same |
| Token spend | Enforceable — metered per call as frames pass the broker | **Observable only** — recovered from the harness's own session record, with lag; can warn, can never pause |
| Currency | Real when the app meters the API | An estimate at list price, or omitted; never presented as a charge |

A budget component that can only be observed is not a limit, and no surface may
present it as one. This distinction has a required visual expression; see ADR-003
§Enforced versus observed.

Consequence for measurement: §12.1's per-Run token and cost metrics mean different
things in the two modes. Any aggregate over Runs must either separate them or
declare that interactive figures are recovered approximations.

### Deployment

A separate database on the existing VPS PostgreSQL instance. This is not a new
deployment target and does not change the topology.

## Consequences

These are the costs of the decision and they are accepted knowingly.

1. **The coordinator becomes a signing principal.** It holds a key and attests
   state. That key joins the relay key as a crown-jewel secret: it enters the
   Phase 0 secret inventory, the backup scope, and the key-recovery procedure, and
   its rotation must be rehearsed alongside restore.

2. **The system stops being purely Nostr-verifiable.** A client reading only the
   relay sees coordinator-attested state; it cannot independently verify that a
   mutation was legitimate without trusting the coordinator key. This is acceptable
   under ADR-003's single-owner V1 and **must be revisited before any multi-tenant
   or untrusted-participant scenario.** Recorded here so that revisit is a decision
   rather than a discovery.

3. **The coordinator is a single point of failure for writes.** Reads degrade to
   cached/relay snapshots; writes stop. The partition rules above define the
   behaviour; they are not a mitigation.

4. **Relay-only clients see eventually-consistent state.** Mobile and any future
   third-party reader observe snapshots, not authority. Any UI that lets such a
   client mutate must round-trip the coordinator.

5. **The relay fork stays minimal** — this is the second-order benefit and it is
   substantial. With no CAS in the relay, the entire relay seam is "new kinds +
   payload validation + scope arms," which is the shape already demonstrated to be
   mergeable against upstream. ADR-001's seam inventory stays short.

## Alternatives considered and rejected

**A. Split authority — relay CAS for Workspace, coordinator for Run.**
Rejected for two reasons.

*Correctness:* a capability decision reads Workspace membership, capability grants,
and budget together. Split across two authorities, that evaluation spans two
systems with no shared transaction. Authorization checks that read across
consistency domains are where security defects live. Equally, a single user action
("add this repository and start a Run against it") crosses both domains and would
require a distributed transaction or tolerate torn state.

*Cost:* it forces a new consistency primitive into relay ingest. Confining the CAS
check to a new kind's own validation module (as proposed in review) limits the blast
radius but does not change the fact that the relay would then guarantee something
upstream's ingest path does not guarantee — the exact class of change ADR-001's
additive discipline is designed to keep out.

**B. Relay-only, blind LWW replaceable events.**
Rejected per §4.2. Two owner devices silently erase each other's membership edits.

**C. CRDTs for Workspace state.**
Out of scope for V1, as the proposal already states. CAS plus visible conflict UX is
the V1 answer.
