// The selected project's worktree explorer (VS Code: the tree tells you
// where you are) — the `main` checkout, every task worktree the coordinator
// knows, and every worktree git knows about that neither of those covers,
// each with its live state.
//
// **It answers one question: what is happening right now?**
// (vingilot/docs/plans/2026-08-07-panes-and-polish.md, Task 3.) The order and
// the fold are `lib/worktreeAttention.ts`'s — dirty first, then running, then
// clean, with the project's own checkout pinned above all of it, and the quiet
// rows behind a single expandable row. Nothing is deleted by folding; nothing
// in this component deletes anything at all except through the two confirms
// below. The `+`/`−` on a row is git's own count of the uncommitted work in
// that worktree (`lib/useWorktreeStats.ts` reads it).
//
// The dot on a row is `ui/AttentionDot.tsx`, derived by
// `lib/attentionSignal.ts` from signals this app actually holds — never by this
// component, which also draws none at all for a worktree nothing has answered
// about. Each state has its own *shape* as well as its own colour, so the
// answer survives being glanced at, and the row's `title` repeats the dot's
// sentence in words.
//
// Rows are numbered 1-9 to match the ⌘1…9 switch shortcut
// (`lib/terminalKeys.ts`), and the digit is the row's place in the ordered
// list — it stays with the worktree whether the fold is open or shut, and
// selecting a folded worktree by its digit unfolds it, because the selected
// row is never folded.
//
// It is also where worktrees are opened and closed
// (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 6). Two things about
// the × on a row:
//
// - It is absent, not disabled, on the project's own checkout and on any
//   worktree a Run owns — because `removableWorktree` cannot produce a target
//   for either (`lib/worktreePlan.ts`, which says why). Both are un-removable
//   in the model; this render just has nothing to draw.
// - It runs `git worktree remove`, which refuses when there is uncommitted
//   work in the tree. The refusal is shown, with the dirty paths listed, and
//   nothing is removed. There is no override anywhere in this feature.
//
// Prune is the third door and the narrowest: it removes `.git/worktrees/`
// bookkeeping for worktrees whose directories git can no longer find, never a
// directory, and it shows git's own dry run before it does anything.
//
// Collapsed, it is a rail rather than nothing (`lib/useColumns.ts` owns the
// flag and its ⇧⌘B binding). A collapsed column plus a shortcut the owner has
// to remember is a trap: the rail's button is the way back, and it is the
// reason this column is safe to hide at all. The dialogs stay mounted in both
// states — collapsing the column while a confirm is open must not take the
// confirm with it.

import * as React from "react";

import {
  type AttentionMark,
  NO_MARK,
} from "@/features/runs/lib/attentionSignal";
import type { Repo, Worktree } from "@/features/runs/lib/projects";
import { worktreeSummary } from "@/features/runs/lib/projects";
import type { WorktreeActions } from "@/features/runs/lib/useWorktreeActions";
import type { WorktreeStats } from "@/features/runs/lib/useWorktreeStats";
import {
  prunableWorktrees,
  rowDetail,
  worktreeColumnView,
} from "@/features/runs/lib/worktreeAttention";
import {
  type RemovableWorktree,
  removableWorktree,
  removeWorktreeConfirm,
} from "@/features/runs/lib/worktreePlan";
import { AttentionDot } from "@/features/runs/ui/AttentionDot";
import { NewWorktreeDialog } from "@/features/runs/ui/NewWorktreeDialog";
import { PruneWorktreesDialog } from "@/features/runs/ui/PruneWorktreesDialog";
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

interface WorktreeColumnProps {
  repo: Repo;
  /** Ordered by `orderWorktrees` — index N backs the ⌘(N+1) shortcut for
   * N < 9, and `RunsScreen` passes this same array to the work surface so the
   * two agree. */
  worktrees: Worktree[];
  /** git's own read of each worktree, by binding id. A worktree with no entry
   * is one nothing is known about yet — never one that is clean. */
  stats: WorktreeStats;
  /** The attention dot per binding id, already derived
   * (`lib/attentionSignal.ts` via `useWorktreeSignals`). Derived once for the
   * screen so this column and the project nav cannot disagree; a worktree with
   * no entry is one no signal has answered about, and draws no dot. */
  marks: ReadonlyMap<string, AttentionMark>;
  selectedWorktreeId: string | null;
  onSelectWorktree: (bindingId: string) => void;
  /** Resolved worktree root; `null` before the desktop shell has answered,
   * which is also when nothing here is removable. */
  worktreeRoot: string | null;
  actions: WorktreeActions;
  /** True while this column is a rail. Nothing is unmounted by collapsing —
   * the worktrees are still open, still running, still selected. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** The two dialogs below are held by the screen rather than here, because
   * the palette is a second door to both. One state each, so whichever door
   * the owner came through he gets the same dialog — a second copy would be a
   * second chance for git's dry run and this column's button to disagree about
   * what is about to be pruned. */
  creating: boolean;
  onCreatingChange: (creating: boolean) => void;
  /** git's own dry run of `worktree prune`, or `null` for a closed dialog.
   * Fetched by the screen, because both doors have to fetch it before they
   * have anything to show. */
  prunePreview: string[] | null;
  onOpenPrune: () => void;
  onPrunePreviewChange: (preview: string[] | null) => void;
}

/** The column when it is collapsed: a rail whose only job is to be the way
 * back, and to say how much is behind it. */
function CollapsedRail({
  count,
  onExpand,
  repoName,
}: {
  count: number;
  onExpand: () => void;
  repoName: string;
}) {
  return (
    <div
      className="flex min-h-0 w-9 shrink-0 flex-col items-center gap-1 border-r border-border/60 py-3"
      data-testid="worktree-column-rail"
    >
      <button
        aria-label={`show the worktrees for ${repoName}`}
        className="rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        data-testid="worktree-column-expand"
        onClick={onExpand}
        title={`${repoName} — show worktrees (⇧⌘B)`}
        type="button"
      >
        ›
      </button>
      <span
        aria-hidden="true"
        className="text-2xs tabular-nums text-muted-foreground/70"
      >
        {count}
      </span>
    </div>
  );
}

export function WorktreeColumn({
  actions,
  collapsed,
  creating,
  marks,
  onCreatingChange,
  onOpenPrune,
  onPrunePreviewChange,
  onSelectWorktree,
  onToggleCollapsed,
  prunePreview,
  repo,
  selectedWorktreeId,
  stats,
  worktreeRoot,
  worktrees,
}: WorktreeColumnProps) {
  const [confirming, setConfirming] = React.useState<RemovableWorktree | null>(
    null,
  );
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState(false);
  const confirm =
    confirming === null ? null : removeWorktreeConfirm(confirming);

  // A project switch is a different list; the filter and the fold from the
  // last one mean nothing here. Adjusted during the render that brought the
  // new project in rather than in an effect, so the column is never painted
  // once showing another project's query.
  const [scope, setScope] = React.useState(repo.id);
  if (scope !== repo.id) {
    setScope(repo.id);
    setQuery("");
    setExpanded(false);
  }

  const view = worktreeColumnView({
    expanded,
    query,
    selectedId: selectedWorktreeId,
    stats,
    worktrees,
  });
  const prunable = prunableWorktrees(worktrees).length;

  return (
    <>
      {collapsed ? (
        <CollapsedRail
          count={worktrees.length}
          onExpand={onToggleCollapsed}
          repoName={repo.name}
        />
      ) : (
        <div
          className="flex min-h-0 w-56 shrink-0 flex-col overflow-y-auto border-r border-border/60 px-2 py-3"
          data-testid="worktree-column"
        >
          <div className="flex items-center gap-1 px-2">
            <h2
              className="min-w-0 flex-1 truncate text-sm font-semibold"
              title={repo.name}
            >
              {repo.name}
            </h2>
            <button
              aria-label="hide the worktrees"
              className="shrink-0 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              data-testid="worktree-column-collapse"
              onClick={onToggleCollapsed}
              title="Hide worktrees (⇧⌘B)"
              type="button"
            >
              ‹
            </button>
          </div>

          {view.showFilter ? (
            <input
              aria-label={`filter the worktrees of ${repo.name}`}
              className="mt-2 w-full rounded-md border border-border/60 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring"
              data-testid="worktree-filter"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="filter branches"
              type="search"
              value={query}
            />
          ) : null}

          {worktrees.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              no worktrees yet
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-0.5">
              {view.rows.map((row) => {
                const wt = row.worktree;
                const summary = worktreeSummary(wt);
                const shortcutDigit = row.index < 9 ? row.index + 1 : null;
                const removable = removableWorktree(repo, wt, worktreeRoot);
                const detail = rowDetail(row);
                const mark = marks.get(wt.binding_id) ?? NO_MARK;
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
                      title={
                        mark.sentence === ""
                          ? summary.label
                          : `${summary.label} — ${mark.sentence}`
                      }
                      type="button"
                    >
                      <AttentionDot className="mt-1" mark={mark} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {summary.label}
                          </span>
                          {shortcutDigit !== null ? (
                            <span className="shrink-0 text-2xs text-muted-foreground/60">
                              ⌘{shortcutDigit}
                            </span>
                          ) : null}
                        </span>
                        {detail === "" ? null : (
                          <span
                            className={`block text-2xs ${
                              row.attention === "dirty"
                                ? "text-amber-600 dark:text-amber-500"
                                : "text-muted-foreground/80"
                            }`}
                          >
                            {detail}
                          </span>
                        )}
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

          {view.foldLabel === "" ? null : (
            <button
              aria-expanded={view.folded.length === 0}
              className="mt-0.5 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground"
              data-testid="worktree-fold"
              onClick={() => setExpanded((prev) => !prev)}
              title="Nothing is removed by folding — these worktrees are all still here"
              type="button"
            >
              <span aria-hidden="true" className="w-2 text-center">
                {view.folded.length === 0 ? "▾" : "▸"}
              </span>
              {view.foldLabel}
            </button>
          )}

          {view.filteredOut === 0 ? null : (
            <p className="px-2 py-1 text-2xs text-muted-foreground/70">
              {view.filteredOut} hidden by the filter
            </p>
          )}

          <button
            className="mt-1 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
            data-testid="worktree-column-new"
            disabled={actions.pending}
            onClick={() => onCreatingChange(true)}
            type="button"
          >
            + New worktree
          </button>

          {prunable === 0 ? null : (
            <button
              className="rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
              data-testid="worktree-column-prune"
              disabled={actions.pending}
              onClick={onOpenPrune}
              title="Show what `git worktree prune` would remove — records only, no directories"
              type="button"
            >
              Prune {prunable} missing worktree{prunable === 1 ? "" : "s"}…
            </button>
          )}

          {actions.refusal === null || creating ? null : (
            <div
              className="mt-1 rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1.5"
              data-testid="worktree-column-refusal"
            >
              <p className="text-sm text-destructive">
                {actions.refusal.message}
              </p>
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
                className="mt-1 text-xs text-muted-foreground underline transition-colors hover:text-foreground"
                data-testid="worktree-column-refusal-dismiss"
                onClick={actions.dismissRefusal}
                type="button"
              >
                dismiss
              </button>
            </div>
          )}
        </div>
      )}

      <NewWorktreeDialog
        onCreate={actions.create}
        onOpenChange={onCreatingChange}
        open={creating}
        pending={actions.pending}
        refusal={actions.refusal}
        repo={repo}
        worktreeRoot={worktreeRoot}
      />

      <PruneWorktreesDialog
        onConfirm={() => {
          onPrunePreviewChange(null);
          void actions.prune();
        }}
        onOpenChange={() => onPrunePreviewChange(null)}
        pending={actions.pending}
        preview={prunePreview}
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
    </>
  );
}
