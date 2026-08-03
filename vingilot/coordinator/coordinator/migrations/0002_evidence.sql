CREATE TABLE run_evidence (
    run_id     UUID NOT NULL REFERENCES runs(id),
    seq        BIGINT NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('command','output','error','note')),
    content    TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, seq)
);
