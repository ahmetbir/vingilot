// The owner run's transcript for the selected worktree — its commands, its
// output, the commits it made — as a pane (`ui/paneRegistry.tsx`).
//
// It polls, unlike the Diff pane beside it, because evidence is appended by a
// run that is still going and the question "what is it doing now" has a
// different answer every second. A worktree with no owner run never reaches
// this component at all: that is `evidenceAvailability`'s answer, and the
// frame prints it.

import * as React from "react";

import type { ApiResult } from "@/features/runs/lib/coordinatorClient";
import { listEvidence } from "@/features/runs/lib/coordinatorClient";
import { evidenceView } from "@/features/runs/lib/runModel";
import type { EvidenceKind, EvidenceRow } from "@/features/runs/lib/runModel";
import { usePolling } from "@/features/runs/lib/usePolling";
import type { PaneProps } from "@/features/runs/ui/paneRegistry";

const EVIDENCE_POLL_MS = 2000;

const EVIDENCE_KIND_CLASS: Record<EvidenceKind, string> = {
  command: "text-foreground",
  commit: "text-emerald-600 dark:text-emerald-400",
  diff: "text-muted-foreground",
  error: "text-destructive",
  note: "text-muted-foreground",
  output: "text-foreground",
};

async function fetchOwnerEvidence(
  ownerRunId: string | null,
): Promise<ApiResult<EvidenceRow[]>> {
  if (ownerRunId === null) return { ok: true, value: [] };
  return listEvidence(ownerRunId);
}

export function EvidencePane({ ownerRunId }: PaneProps) {
  const fetchEvidence = React.useCallback(
    () => fetchOwnerEvidence(ownerRunId),
    [ownerRunId],
  );
  const { data: evidenceRows } = usePolling(fetchEvidence, EVIDENCE_POLL_MS);
  const { rows, truncatedCount } = evidenceView(evidenceRows ?? []);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 py-3"
      data-testid="pane-evidence"
    >
      {rows.length === 0 ? (
        // Not "no evidence": nothing has *arrived*. A run that has only just
        // started and a poll that has not answered look identical from here,
        // and only one of them is a statement about the run.
        <p className="text-sm text-muted-foreground">
          nothing recorded for this run yet
        </p>
      ) : (
        <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/30 p-3 font-mono text-xs">
          {truncatedCount > 0 ? (
            <p className="text-2xs text-muted-foreground/70">
              {truncatedCount} earlier row{truncatedCount === 1 ? "" : "s"} not
              shown
            </p>
          ) : null}
          {rows.map((ev) => (
            <div
              className={`whitespace-pre-wrap break-words ${EVIDENCE_KIND_CLASS[ev.kind]}`}
              key={ev.seq}
            >
              {ev.kind === "command" ? "$ " : ""}
              {ev.kind === "commit" ? "⎘ " : ""}
              {ev.content}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
