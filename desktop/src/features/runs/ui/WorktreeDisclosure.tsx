// The selected project's worktrees, disclosed under its row in the one
// navigation column (vingilot/docs/plans/2026-08-11-one-column-design.md, §2.4).
// This is the body of the old `WorktreeColumn` with its width, its border and
// its scroll container taken away — those were the second column, and the
// second column is what this change spends on the work surface.
//
// **It answers one question: what is happening right now?** The order and the
// fold are `lib/worktreeAttention.ts`'s — dirty first, then running, then
// clean, with the project's own checkout pinned above all of it, and the quiet
// rows behind a single expandable row. Nothing is deleted by folding. The
// `+`/`−` on a row is git's own count of the uncommitted work in that worktree
// (`lib/useWorktreeStats.ts` reads it).
//
// **No chrome of its own.** No header, no border, no background, no card, no
// scroller: the project row directly above is the header, indentation is the
// only hierarchy cue, and the column's single scroller scrolls all of it. The
// one heading here is `sr-only` — the disclosed group needs an accessible
// name, the visible one is the project row two pixels above it, and drawing it
// twice 24px apart is exactly the nested chrome the design forbids. It is also
// a hard test contract: `workspace-palette.spec.ts` reads
// `getByTestId("worktree-column").getByRole("heading")` and asserts the
// project's name, so this must stay the *only* heading inside the section.
//
// **`worktree-column` is this section's test id**, not the column's. 22 e2e
// references keep meaning what they said: it is visible exactly when a project
// is open and the nav is not a rail, it is what ⇧⌘B hides, and it holds the
// `worktree-row-*` buttons.
//
// It is also where worktrees are opened and closed
// (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 6) — the buttons are
// here, the dialogs they open are `WorkspaceNav`'s, because collapsing the nav
// unmounts this component and must not take an open confirm with it.
//
// Prune is the narrowest of the three doors: it removes `.git/worktrees/`
// bookkeeping for worktrees whose directories git can no longer find, never a
// directory, and it shows git's own dry run before it does anything.
//
// **`query` and `expanded` are props, not state, and that is deliberate.**
// This component is rendered only inside the selected project's row, so ⇧⌘B
// unmounts it — and a filter the owner typed must not be destroyed by hiding
// the column, which is the one thing the two-column build got right that the
// first merge lost. `WorkspaceNav` holds both (it renders in the rail state
// too) and resets them during the render that brings a new project in, which
// is the same guarantee `WorktreeColumn`'s `scope` reset gave. Nothing here
// remembers anything.

import {
  type AttentionMark,
  NO_MARK,
} from "@/features/runs/lib/attentionSignal";
import type { Repo, Worktree } from "@/features/runs/lib/projects";
import type { WorktreeActions } from "@/features/runs/lib/useWorktreeActions";
import type { WorktreeStats } from "@/features/runs/lib/useWorktreeStats";
import type { WorktreeOverlap } from "@/features/runs/lib/worktreeOverlap";
import {
  prunableWorktrees,
  worktreeColumnView,
} from "@/features/runs/lib/worktreeAttention";
import type { RemovableWorktree } from "@/features/runs/lib/worktreePlan";
import { WorktreeRow } from "@/features/runs/ui/WorktreeRow";

interface WorktreeDisclosureProps {
  /** The disclosed project. Non-null by construction: this component is only
   * mounted inside the selected project's row. */
  repo: Repo;
  /** Ordered by `orderWorktrees` — index N backs the ⌘(N+1) shortcut for
   * N < 9, and `RunsScreen` passes this same array to the work surface so the
   * two agree. Never a copy, never re-sorted here. */
  worktrees: Worktree[];
  /** git's own read of each worktree, by binding id. A worktree with no entry
   * is one nothing is known about yet — never one that is clean. */
  stats: WorktreeStats;
  /** The attention dot per binding id, already derived
   * (`lib/attentionSignal.ts` via `useWorktreeSignals`). A `Map` here and a
   * `Record` for the project rollups — two shapes from one derivation, and
   * conflating them makes every dot silently blank. */
  worktreeMarks: ReadonlyMap<string, AttentionMark>;
  /** Which worktrees share changed files with another worktree of this
   * project, by binding id (`lib/worktreeOverlap.ts` via `useWorktreeSignals`).
   * A worktree with no entry shares nothing — or nothing has answered about it
   * yet, which draws the same nothing. Separate from `worktreeMarks` because
   * it is a separate signal: informational, not "needs you". */
  worktreeOverlaps: ReadonlyMap<string, WorktreeOverlap>;
  selectedWorktreeId: string | null;
  onSelectWorktree: (bindingId: string) => void;
  /** Resolved worktree root; `null` before the desktop shell has answered,
   * which is also when nothing here is removable. */
  worktreeRoot: string | null;
  actions: WorktreeActions;
  /** True while the new-worktree dialog is open. The refusal panel below is
   * suppressed then, because that dialog shows the same refusal — without the
   * suppression it is rendered twice. */
  creating: boolean;
  onCreatingChange: (creating: boolean) => void;
  onOpenPrune: () => void;
  /** Opens `WorkspaceNav`'s remove-worktree confirm. */
  onRemoveWorktree: (target: RemovableWorktree) => void;
  /** True while the quiet-rows fold is open. Held by `WorkspaceNav` so ⇧⌘B
   * does not destroy it — see the header. */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** The branch filter's text, held by `WorkspaceNav` for the same reason. */
  query: string;
  onQueryChange: (query: string) => void;
}

export function WorktreeDisclosure({
  actions,
  creating,
  expanded,
  onCreatingChange,
  onExpandedChange,
  onOpenPrune,
  onQueryChange,
  onRemoveWorktree,
  onSelectWorktree,
  query,
  repo,
  selectedWorktreeId,
  stats,
  worktreeMarks,
  worktreeOverlaps,
  worktreeRoot,
  worktrees,
}: WorktreeDisclosureProps) {
  const view = worktreeColumnView({
    expanded,
    query,
    selectedId: selectedWorktreeId,
    stats,
    worktrees,
  });
  const prunable = prunableWorktrees(worktrees).length;

  return (
    <section
      aria-labelledby={`worktrees-of-${repo.id}`}
      className="mt-0.5 flex flex-col pl-3"
      data-testid="worktree-column"
    >
      <h3 className="sr-only" id={`worktrees-of-${repo.id}`}>
        {repo.name}
      </h3>

      {view.showFilter ? (
        <input
          aria-label={`filter the worktrees of ${repo.name}`}
          className="w-full rounded-md border border-border/60 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring"
          data-testid="worktree-filter"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="filter branches"
          type="search"
          value={query}
        />
      ) : null}

      {worktrees.length === 0 ? (
        <p className="px-2 py-2 text-sm text-muted-foreground">
          no worktrees yet
        </p>
      ) : (
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {view.rows.map((row) => (
            <WorktreeRow
              key={row.worktree.binding_id}
              mark={worktreeMarks.get(row.worktree.binding_id) ?? NO_MARK}
              onRemove={onRemoveWorktree}
              onSelect={onSelectWorktree}
              overlap={worktreeOverlaps.get(row.worktree.binding_id) ?? null}
              pending={actions.pending}
              repo={repo}
              row={row}
              selected={row.worktree.binding_id === selectedWorktreeId}
              worktreeRoot={worktreeRoot}
            />
          ))}
        </ul>
      )}

      {view.foldLabel === "" ? null : (
        <button
          aria-expanded={view.folded.length === 0}
          className="mt-0.5 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground"
          data-testid="worktree-fold"
          onClick={() => onExpandedChange(!expanded)}
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
        className="mt-0.5 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
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
          <p className="text-sm text-destructive">{actions.refusal.message}</p>
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
    </section>
  );
}
