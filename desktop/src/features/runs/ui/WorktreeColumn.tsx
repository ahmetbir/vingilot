// The selected project's worktree explorer (VS Code: the tree tells you
// where you are) — the `main` checkout, every task worktree the coordinator
// knows, and every worktree git knows about that neither of those covers,
// each with its live state (`worktreeSummary`). Rows are numbered 1-9 to
// match the ⌘1…9 switch shortcut (`lib/terminalKeys.ts`); `RunsScreen` is the
// source of truth for which index maps to which worktree (the same ordering
// this column renders).
//
// It is also where worktrees are opened and closed
// (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 6). Two things about
// the × on a row:
//
// - It is absent, not disabled, on the project's own checkout — because
//   `removableWorktree` cannot produce a target for it (`lib/worktreePlan.ts`).
//   The repository is un-removable in the model; this render just has nothing
//   to draw.
// - It runs `git worktree remove`, which refuses when there is uncommitted
//   work in the tree. The refusal is shown, with the dirty paths listed, and
//   nothing is removed. There is no override anywhere in this feature.

import * as React from "react";

import type { Repo, Worktree } from "@/features/runs/lib/projects";
import type { WorktreeActions } from "@/features/runs/lib/useWorktreeActions";
import { worktreeSummary } from "@/features/runs/lib/projects";
import type { WorktreeSummary } from "@/features/runs/lib/projects";
import {
  type RemovableWorktree,
  removableWorktree,
  removeWorktreeConfirm,
} from "@/features/runs/lib/worktreePlan";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { NewWorktreeDialog } from "@/features/runs/ui/NewWorktreeDialog";

interface WorktreeColumnProps {
  repo: Repo;
  /** Ordered — index N backs the ⌘(N+1) shortcut for N < 9. */
  worktrees: Worktree[];
  selectedWorktreeId: string | null;
  onSelectWorktree: (bindingId: string) => void;
  /** Resolved worktree root; `null` before the desktop shell has answered,
   * which is also when nothing here is removable. */
  worktreeRoot: string | null;
  actions: WorktreeActions;
}

const STATE_DOT_CLASS: Record<WorktreeSummary["stateClass"], string> = {
  clean: "bg-muted-foreground/40",
  live: "bg-emerald-500 motion-safe:animate-pulse",
  ok: "bg-emerald-500",
  attn: "bg-amber-500",
  stop: "bg-destructive",
  muted: "bg-muted-foreground/40",
};

export function WorktreeColumn({
  actions,
  onSelectWorktree,
  repo,
  selectedWorktreeId,
  worktreeRoot,
  worktrees,
}: WorktreeColumnProps) {
  const [creating, setCreating] = React.useState(false);
  const [confirming, setConfirming] = React.useState<RemovableWorktree | null>(
    null,
  );
  const confirm =
    confirming === null ? null : removeWorktreeConfirm(confirming);

  return (
    <div
      className="flex min-h-0 w-56 shrink-0 flex-col overflow-y-auto border-r border-border/60 px-2 py-3"
      data-testid="worktree-column"
    >
      <h2 className="truncate px-2 text-sm font-semibold" title={repo.name}>
        {repo.name}
      </h2>

      {worktrees.length === 0 ? (
        <p className="px-2 py-4 text-xs text-muted-foreground">
          no worktrees yet
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-0.5">
          {worktrees.map((wt, index) => {
            const summary = worktreeSummary(wt);
            const shortcutDigit = index < 9 ? index + 1 : null;
            const removable = removableWorktree(repo, wt, worktreeRoot);
            return (
              <li
                className="group flex items-start gap-0.5"
                key={wt.binding_id}
              >
                <button
                  className={`flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                    wt.binding_id === selectedWorktreeId
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60"
                  }`}
                  data-testid={`worktree-row-${wt.binding_id}`}
                  onClick={() => onSelectWorktree(wt.binding_id)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STATE_DOT_CLASS[summary.stateClass]}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {summary.label}
                      </span>
                      {shortcutDigit !== null ? (
                        <span className="shrink-0 text-3xs text-muted-foreground/60">
                          ⌘{shortcutDigit}
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-2xs text-muted-foreground/80">
                      {summary.diff !== null
                        ? `+${summary.diff.added} −${summary.diff.removed}`
                        : summary.stateClass === "clean"
                          ? "clean"
                          : wt.owner_run_status}
                    </span>
                  </span>
                </button>
                {removable === null ? null : (
                  <button
                    aria-label={`remove the worktree for ${removable.label}`}
                    className="mt-1 shrink-0 rounded px-1 py-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    data-testid={`worktree-remove-${wt.binding_id}`}
                    disabled={actions.pending}
                    onClick={() => setConfirming(removable)}
                    title="Remove this worktree — git refuses if anything in it is uncommitted"
                    type="button"
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <button
        className="mt-1 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
        data-testid="worktree-column-new"
        disabled={actions.pending}
        onClick={() => setCreating(true)}
        type="button"
      >
        + New worktree
      </button>

      {actions.refusal === null || creating ? null : (
        <div
          className="mt-1 rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1.5"
          data-testid="worktree-column-refusal"
        >
          <p className="text-xs text-destructive">{actions.refusal.message}</p>
          {actions.refusal.entries.length === 0 ? null : (
            <ul className="mt-1 flex flex-col gap-0.5 font-mono text-2xs text-muted-foreground">
              {actions.refusal.entries.map((entry) => (
                <li className="truncate" key={entry} title={entry}>
                  {entry}
                </li>
              ))}
            </ul>
          )}
          <button
            className="mt-1 text-3xs uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
            data-testid="worktree-column-refusal-dismiss"
            onClick={actions.dismissRefusal}
            type="button"
          >
            dismiss
          </button>
        </div>
      )}

      <NewWorktreeDialog
        onCreate={actions.create}
        onOpenChange={setCreating}
        open={creating}
        pending={actions.pending}
        refusal={actions.refusal}
        repo={repo}
        worktreeRoot={worktreeRoot}
      />

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        open={confirming !== null}
      >
        <AlertDialogContent data-testid="worktree-remove-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="worktree-remove-confirm-action"
              onClick={() => {
                if (confirming !== null) actions.remove(confirming);
                setConfirming(null);
              }}
            >
              {confirm?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
