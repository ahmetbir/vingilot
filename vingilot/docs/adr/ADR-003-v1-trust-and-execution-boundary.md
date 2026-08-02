# ADR-003 — V1 trust model and execution boundary

- **Status:** Proposed (blocks Phase 0 exit)
- **Date:** 2026-08-01
- **Resolves:** the contradiction between §5.2 ("a linked worktree is not a security
  boundary") and the Phase 2 acceptance criterion ("an agent makes a change in an
  *isolated* task worktree")
- **Related:** ADR-001, ADR-002 (partition rules, epoch source)

## Context

The proposal states correctly in §5.2 that linked Git worktrees share a common Git
directory, object database, and refs, and therefore are not a security boundary —
hostile code needs a dedicated clone or a container. It then describes Phase 2
acceptance in terms of an "isolated task worktree." Both statements cannot be true.
Left unresolved, the ambiguity resolves itself in six months as an assumption
nobody remembers making.

The proposal also uses "owner" throughout without stating whether V1 is
single-user or multi-user. That choice changes the capability model, the merge
policy, and the verifiability requirement in ADR-002.

## Decision

### Trust model

**V1 is one human owner, many devices, many agent identities.** Team semantics —
multiple humans with distinct rights over one Workspace — are out of scope for V1.
CAS is still required, because two of the owner's own devices race.

**V1 executes only agents the owner trusts and repository code the owner trusts.**
A project command executed on the host is in the same risk class as the owner
running that command in their own terminal. This is stated plainly rather than
dressed up: V1 buys convenience and auditability, not sandboxing.

### Execution boundary

- **A linked worktree is a collision boundary only.** It exists so that two Runs do
  not fight over one working tree. It carries **no isolation or security claim**,
  and no document or UI string may imply one.
- **A dedicated clone or container is mandatory before any untrusted execution** —
  external pull requests, foreign branches, or any repository content the owner has
  not vouched for. This gate exists from V1 even though the container work lands
  later: until it exists, untrusted execution is simply not offered.

### Trust does not defer the kill switch

Trusting an agent covers **malice, not malfunction**. A trusted agent with a loop,
a bad tool call, or a runaway budget does the same damage as a hostile one. The
following ship in Phase 2, the moment any agent holds a writable worktree or
`git:push`:

- global stop;
- per-agent revocation;
- Run cancel;
- supervised process-group termination (not a signal to one PID);
- a single "what did agents do in the last hour" view derived from Run evidence.

The broker seam makes these cheap: one revocation-flag check per operation plus one
evidence query. There is no justification for deferring them to Phase 5.

### Fencing

Every `WorktreeBinding` lease carries a **monotonic epoch issued by the
coordinator** (ADR-002). The target executor validates `(run_id, binding_id, epoch)`
on **every** broker operation, not only at lease acquisition. A stale epoch is
rejected. A lease that cannot be renewed fails closed.

This closes the split-brain path the laptop + VPS topology invites: harness
acquires lease → host sleeps → lease expires → reconciler quarantines the binding →
host wakes → harness attempts a write. Without per-operation epoch validation that
write succeeds against a binding the control plane has already reclaimed.

**Fencing does not make a raw, unbrokered shell safe.** It is a coordination
mechanism, not a sandbox. Agent write paths go through the executor; a shell that
bypasses the broker bypasses fencing too.

### Execution modes

A Run is executed in one of three modes, and they do not have the same control
surface. The implementer is an external harness in all of them — we do not host an
agent (`buzz-acp` already speaks Agent Client Protocol over stdio and already
supports `claude-agent-acp` and `codex-acp`).

| | **Interactive** | **Delegated** | **Chat** |
|---|---|---|---|
| Driven by | The owner, turn by turn, in a real PTY running the harness's own TUI | An objective; the harness speaks ACP over stdio | An `@mention` in a channel |
| Mid-task control | None per action — the agent owns its own permission prompts. Type, or kill. | Interrupt or pause at the next tool call | None needed |
| Where the boundary is | Process-level: cwd, scoped env, network policy, kill | Per tool call: each frame is checked against the Run's grants before it executes | No worktree, no grants |
| Credentials | The harness holds its own | App-held; the harness receives capabilities, not credentials | n/a |
| Worktree | Granted, but cwd is a **starting directory, not a jail** | Granted and enforced per action | None |

The interactive mode is where the "collision boundary, not a security boundary"
statement above becomes visible to the owner. It is acceptable because they trust
the agent they invoked. It is **not** acceptable for any surface to describe an
interactive Run's worktree as containment: the honest claim is where the session
starts, not where its writes stay.

### Capabilities are detected per harness, not assumed

Harnesses differ in what they expose — a structured session record, a resumable
session id, token accounting. These are **probed when the harness launches**, and
what a harness lacks is **absent, not disabled**. A greyed-out control implies the
capability exists and is unavailable; an absent one tells the truth.

The concrete consequence: two interactive Runs on two different harnesses are not
the same Run. One may offer resume-by-session-id and a typed evidence timeline;
the other may offer neither, and its primary recovery action is a new session in
the same worktree. Neither surface pretends to be the other.

### The evidence floor is what the app itself witnessed

Evidence has two tiers and they must not be confused:

1. **Witnessed by the app** — commits in the worktree, the resulting diff, command
   invocations it launched, timestamps, and the grant decisions it made. This tier
   is **harness-independent** and always present.
2. **Read from the harness's own record** — a structured session log, token
   accounting, per-action detail. This tier is a bonus and varies by harness.

Tier 2 is read **only for sessions this application launched under a Run.** The
harness's store may contain unrelated sessions from other projects; those are not
ours to index, and no surface should suggest otherwise.

Where tier 2 is unavailable, the app reports tier 1 and stops. It does not
interpolate: an approximate number requires some data, and a verdict inferred from
scraped terminal output ("tests passed" matched in a scrollback) is a fabricated
claim, not evidence. Anchor into the transcript; do not adjudicate from it.

### Enforced versus observed

Every one of the decisions above produces the same shape: a thing the system
guarantees per action, or a thing it merely states and observes. That distinction
is load-bearing — it is the difference between a boundary and a description — and
it must be legible wherever it appears.

**One form rule carries it everywhere:** enforced-per-action is rendered solid;
process-level-and-stated is rendered dashed. It applies uniformly to execution mode,
worktree grants, network policy, and budget components. A capability that is neither
enforced nor observed gets **no indicator at all** — absence of a claim, rather than
a claim of absence.

The rule is deliberately a form rule, not a colour rule: it must survive small
sizes, monochrome rendering, and colour-blindness. This is recorded in an ADR
rather than in a style guide because it is the visual expression of the trust model,
and a UI that renders an unenforced grant as though it were enforced has
misrepresented the security posture regardless of how correct the backend is.

### Repository-owned command configuration

`.buzz/project.yaml` is repository-owned and versioned (K11), which means it is also
an execution-configuration file living in mutable content. Editing it is a direct
path to command execution under the Run's capability grant — a different and worse
category than prompt injection, because the system is *designed* to trust the file.

Therefore:

- commands are resolved from the **Run's base commit**, never from the working tree;
- the Run pins the config **digest, schema version, and resolved `argv`** as
  evidence;
- **shell strings are not auto-executed** — a resolved `argv` vector is, so a
  command cannot smuggle a pipeline or a subshell;
- if the digest changes during a Run, the existing command grant **drops** and owner
  approval is required to continue.

**Evidence is not enforcement.** Pinning a digest records what happened; dropping
the grant is what prevents it.

### Resource identity

`ResourceRef` uses a new host under the **existing** `buzz://` scheme rather than a
`vingilot://` scheme of its own.

The reason is not that the product name is unsettled — it is settled (ADR-001).
It is that resource identifiers are shared with upstream Buzz and persist in signed
events: the upstream client already registers and parses this scheme, a new host is
purely additive, and two installed applications competing to own two schemes for
the same resources is a cost with no matching benefit.

Verified at `19d57b0d4`, the scheme's existing hosts are `message` (100 uses),
`join` (40), `nostr` (19), `connect` (13), `add` (9), `channel` (3), `user` (1).
There is no `resource` host today, so `buzz://resource/...` is available and
additive. The canonical grammar is versioned and specified in Phase 1; because
references are constructed from that grammar rather than hand-built as strings, the
scheme remains renameable later at one code site.

## Consequences

- V1 ships without sandboxing, stated openly in user-facing documentation. This is
  a scope decision, not an oversight, and it constrains who V1 can be given to.
- The untrusted-execution gate must be enforced in the broker from Phase 2, even
  though containers arrive later — otherwise "not offered" degrades into "not
  implemented."
- Per-operation epoch validation adds a round-trip or a cached-lease check to every
  broker operation. Accepted; it is the price of the laptop + VPS topology.
- Resolving commands from the base commit means a developer who edits
  `project.yaml` mid-Run does not see the change take effect until re-approval.
  This will feel wrong the first time and is correct.
- Multi-user support is a future ADR, not a future feature flag. It reopens ADR-002
  §Consequences item 2 (verifiability) and the whole capability model.

## Alternatives considered and rejected

**A. Treat the worktree as an isolation boundary and skip containers entirely.**
Rejected on the facts: shared common Git directory, object database, refs, and
reachable hooks/config mean a worktree constrains accidents, not adversaries.

**B. Require containers from Phase 2 for all execution.**
Rejected for V1 scope. With a single owner running their own trusted agents against
their own repositories, container isolation buys little against the threat model
that actually applies, and it delays the golden path. Revisit the moment untrusted
input enters — which is why the gate, not the container, is the Phase 2 deliverable.

**C. Leave the trust question implicit and decide per feature.**
Rejected. That is the current state of the proposal and it already produced one
direct contradiction between §5.2 and Phase 2 acceptance.
