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
