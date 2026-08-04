ALTER TABLE run_evidence DROP CONSTRAINT run_evidence_kind_check;
ALTER TABLE run_evidence ADD CONSTRAINT run_evidence_kind_check
  CHECK (kind IN ('command','output','error','note','diff','commit'));
