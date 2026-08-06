// The selected project's worktree explorer (VS Code: the tree tells you
// where you are) — the `main` checkout plus every task worktree the
// coordinator knows, each with its live state (`worktreeSummary`). Rows are
// numbered 1-9 to match the ⌘1…9 switch shortcut (`lib/terminalKeys.ts`);
// `RunsScreen` is the source of truth for which index maps to which
// worktree (the same ordering this column renders).

import type { Repo, Worktree } from "@/features/runs/lib/projects";
import { worktreeSummary } from "@/features/runs/lib/projects";
import type { WorktreeSummary } from "@/features/runs/lib/projects";

interface WorktreeColumnProps {
  repo: Repo;
  /** Ordered — index N backs the ⌘(N+1) shortcut for N < 9. */
  worktrees: Worktree[];
  selectedWorktreeId: string | null;
  onSelectWorktree: (bindingId: string) => void;
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
  onSelectWorktree,
  repo,
  selectedWorktreeId,
  worktrees,
}: WorktreeColumnProps) {
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
            return (
              <li key={wt.binding_id}>
                <button
                  className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
