# Architecture Decision Records

These records are the authority for the decisions they cover. The K-table in the
main architecture document **points at them; it does not restate them.** A K-row is
a one-line index entry plus a link — rationale, consequences, and rejected
alternatives live here and only here. That is what keeps the two documents from
drifting into disagreement.

| ADR | Decision | Status |
|---|---|---|
| [ADR-001](ADR-001-product-composition-and-upstream-boundary.md) | Product composition and the upstream boundary | Proposed |
| [ADR-002](ADR-002-single-control-plane-authority.md) | A single control-plane authority | Proposed |
| [ADR-003](ADR-003-v1-trust-and-execution-boundary.md) | V1 trust model and execution boundary | Proposed |
| [ADR-004](ADR-004-contribution-policy.md) | Contribution policy: fork-local vs. upstream-bound work | Accepted |

All three block Phase 0 exit. They are Phase 0's first deliverable, not a detour
from it — Phase 0 scope already calls for foundational ADR files.

The product is **Vingilot** (ADR-001 §Naming, and the branding boundary). The
fork-owned root is `vingilot/`. Nothing should still describe the name as a
placeholder.

We brand the product, not the platform: upstream identifiers keep upstream names.
A total rebrand was measured and rejected — see ADR-001 §Alternatives D for the
numbers and for why it is an architecture decision rather than a naming one.

The three ADRs have been amended once, with findings the design work produced —
execution modes, per-harness capability detection, the evidence floor, the
enforced-versus-observed form rule (ADR-003), and revision-pinned queued writes
plus non-uniform budget enforceability (ADR-002). Those are architecture, not
screens, which is why they live here rather than only on a canvas.

## Pending: single revision pass on the main document

To be executed **after** the three ADRs above are reviewed and locked, in one pass,
not incrementally. Sequencing: lock ADRs → single revision → design.

**Structural**

- K-table rows for the three decisions become index entries linking here.
- Add a "Run states under partition" section carrying ADR-002's partition rules and
  ADR-003's fencing rules. These are one design concern, not two.
- Fold ADR-003's `.buzz/project.yaml` rules into §5, including the sentence
  "evidence is not enforcement."

**Model corrections**

- `Run` gains `parentRunId`. §7.2 derives depth from parent state; the link is
  absent from the model today.
- `RunStatus` becomes the full state machine:
  `DRAFT / PROVISIONING / READY / RUNNING / VERIFYING / PAUSED / BLOCKED /
  COMPLETED / FAILED / CANCELLED`.
- `QUARANTINED` is documented as a `WorktreeBinding` lifecycle state, explicitly not
  a `RunStatus`.
- `ResourceRef` gets a canonical, versioned grammar under `buzz://resource/...` —
  promoted from one paragraph to a specified Phase 1 deliverable.
- `Run` gains an execution mode (interactive / delegated / chat), since its
  available controls depend on it (ADR-003 §Execution modes).
- `RunBudget` distinguishes enforceable components from observed ones
  (ADR-002 §Budget enforceability is not uniform).
- The implementer is declared external: no hosted coding agent. `buzz-acp` already
  speaks ACP over stdio and already supports claude-code and codex, so §7.1's
  "heavy-work agent" is a configured harness, not something to build.

**Scope corrections**

- Kill switch, per-agent revoke, Run cancel, supervised process-group termination,
  and the last-activity view move from Phase 5 to **Phase 2**.
- HTTP collections move to the horizon. The terminal stays, after the golden path,
  because it exercises the broker.
- The battle protocol moves to the horizon. Phase 5 becomes "sentinel + stays alive
  with the laptop closed."
- Blanket TDD narrows to the coordinator, broker, CAS, Run state machine, and
  security contracts. Workbench chrome is verified by component and E2E tests.
- V1 is declared single-owner, multi-device, multi-agent-identity.

**Not changing**

- The §2.7 resource tree already labels `(write)` / `(read)` per worktree, and the
  cross-repository rule is consistent with K8's "default ≤ 1 writable, expands by
  explicit owner selection." Raised in review, checked, withdrawn.
