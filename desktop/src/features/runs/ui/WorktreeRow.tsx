// One worktree, one row, indented under the project that owns it
// (vingilot/docs/plans/2026-08-11-one-column-design.md, §6.4). Split out of
// the old `WorktreeColumn` unchanged: the dot, the label, the ⌘N hint, the
// detail line and the remove ×, in that order and with the same test ids.
//
// `data-testid="worktree-row-<binding id>"` is the contract, prefixes
// included — `main:` for a project's own checkout, `local:` for one git found
// on disk. Eight e2e assertions read it, two of them by prefix.
//
// Two things here that look cosmetic and are not:
//
// - The row's `title` repeats the attention mark's sentence in words. The dot
//   is `aria-hidden` (`ui/AttentionDot.tsx`), so this is the only accessible
//   rendering of what it says.
// - The × is *absent*, not disabled, whenever `removableWorktree` cannot
//   produce a target — the project's own checkout, a worktree a Run owns, and
//   every row while the worktree root has not been resolved. Both are
//   un-removable in the model (`lib/worktreePlan.ts`); this render just has
//   nothing to draw. It is revealed on `group-hover` **and** `focus-visible`,
//   and the second half is the keyboard's only way to see it.

import type { AttentionMark } from "@/features/runs/lib/attentionSignal";
import type { Repo } from "@/features/runs/lib/projects";
import { worktreeSummary } from "@/features/runs/lib/projects";
import {
  type WorktreeRow as WorktreeRowModel,
  rowDetail,
} from "@/features/runs/lib/worktreeAttention";
import {
  type RemovableWorktree,
  removableWorktree,
} from "@/features/runs/lib/worktreePlan";
import { AttentionDot } from "@/features/runs/ui/AttentionDot";

interface WorktreeRowProps {
  /** The row as `worktreeColumnView` built it. `row.index` is the place in the
   * *ordered* list, which is the digit of the ⌘1…9 chord — it stays with the
   * worktree whether the fold is open or shut. */
  row: WorktreeRowModel;
  mark: AttentionMark;
  /** The project that owns this worktree, for `removableWorktree`. */
  repo: Repo;
  /** `null` before the shell has answered; nothing is removable until it has. */
  worktreeRoot: string | null;
  selected: boolean;
  /** True while an add/remove/prune is in flight. */
  pending: boolean;
  onSelect: (bindingId: string) => void;
  /** Opens the confirm, which is held by `WorkspaceNav` so that collapsing the
   * column cannot take an open confirm with it. */
  onRemove: (target: RemovableWorktree) => void;
}

export function WorktreeRow({
  mark,
  onRemove,
  onSelect,
  pending,
  repo,
  row,
  selected,
  worktreeRoot,
}: WorktreeRowProps) {
  const wt = row.worktree;
  const summary = worktreeSummary(wt);
  const shortcutDigit = row.index < 9 ? row.index + 1 : null;
  const removable = removableWorktree(repo, wt, worktreeRoot);
  const detail = rowDetail(row);

  return (
    <li className="group flex items-start gap-0.5">
      <button
        className={`flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
          selected
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted/60"
        }`}
        data-testid={`worktree-row-${wt.binding_id}`}
        onClick={() => onSelect(wt.binding_id)}
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
          disabled={pending}
          onClick={() => onRemove(removable)}
          title="Remove this worktree — git refuses if anything in it is uncommitted"
          type="button"
        >
          ×
        </button>
      )}
    </li>
  );
}
