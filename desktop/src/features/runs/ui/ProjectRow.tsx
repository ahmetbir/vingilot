// One project in the workspace nav, and — when it is the selected one — its
// worktrees disclosed beneath it
// (vingilot/docs/plans/2026-08-11-one-column-design.md, §2.3).
//
// **Selecting a project and disclosing it are the same gesture.** There is no
// per-project chevron and no second project open at once: only the selected
// project has an ordered worktree list, ⌘1…9 digits and stats
// (`lib/useWorktreeSignals.ts` derives `ordered` for the open project alone),
// so a second disclosure would draw rows that look identical to real ones and
// answer fewer questions. Clicking the row you are already standing in is a
// no-op rather than a collapse — the gesture that hides worktrees is the
// which hides the whole nav, and the gesture that shortens the list is the
// quiet-rows fold inside the disclosure. The no-op is enforced where the state
// is, by the `id === selectedRepoId` guard in `RunsScreen.selectRepo`, and not
// by anything here: without it this row was a second door onto "clear the
// worktree selection", and the auto-select effect then moved the owner off the
// worktree he had open onto the project's primary checkout.
//
// **The rollup dot stays on every row, the selected one included.** It is the
// answer for the *other* projects — this workspace runs agents in several
// worktrees across several projects at once, and a view that hid the dots of
// the projects you are not standing in would be a drill-in, which is the shape
// this is deliberately not. On the selected row it is not redundant either:
// the disclosed list folds, filters and scrolls, so the rollup is still the
// one-glance answer when the row that changed is behind the fold.
//
// **The disclosure is mounted here, but it remembers nothing.** Moving the
// selection to another project re-renders this row with `disclosure === null`
// and mounts a fresh one under the row that now owns it — so anything held
// *inside* the disclosure dies on a project switch, which is right, and also on
// a sidebar collapse, which is not. `query` and `expanded` therefore live in
// `WorkspaceNav`, above the rail/column branch, with the render-phase reset
// that clears them on a project switch. This row is a mount point for the
// disclosure and nothing more.

import type { ReactNode } from "react";

import type { AttentionMark } from "@/features/runs/lib/attentionSignal";
import type { Repo } from "@/features/runs/lib/projects";
import { AttentionDot } from "@/features/runs/ui/AttentionDot";

interface ProjectRowProps {
  repo: Repo;
  /** The strongest attention state among this project's worktrees
   * (`lib/attentionSignal.ts`'s `rollupMark`), never derived here. */
  mark: AttentionMark;
  selected: boolean;
  /** True while an add or a remove is in flight. */
  pending: boolean;
  onSelect: (id: string) => void;
  /** Opens the remove-project confirm, whose exact words are a tested promise
   * (`lib/repoChoice.ts`) and which `RunsScreen` holds because the palette is
   * a second door to it. */
  onRemove: (repo: Repo) => void;
  /** The disclosed worktrees, or `null` when this is not the selected project.
   * Built by `WorkspaceNav`, which has the signals; mounted here so it unmounts
   * with the selection. */
  disclosure: ReactNode | null;
}

export function ProjectRow({
  disclosure,
  mark,
  onRemove,
  onSelect,
  pending,
  repo,
  selected,
}: ProjectRowProps) {
  return (
    <li className="flex flex-col">
      <div className="group flex items-center gap-0.5">
        <button
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
            selected
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted/60"
          }`}
          data-testid={`projects-nav-repo-${repo.id}`}
          onClick={() => onSelect(repo.id)}
          title={
            mark.sentence === "" ? repo.path : `${repo.path} — ${mark.sentence}`
          }
          type="button"
        >
          <AttentionDot idleWhenNone mark={mark} />
          <span className="min-w-0 flex-1 truncate">{repo.name}</span>
        </button>
        <button
          aria-label={`remove ${repo.name}`}
          className="shrink-0 rounded px-1 py-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          data-testid={`projects-nav-remove-${repo.id}`}
          disabled={pending}
          onClick={() => onRemove(repo)}
          title={`Remove ${repo.name} — forgets the path, never touches the folder`}
          type="button"
        >
          ×
        </button>
      </div>
      {disclosure}
    </li>
  );
}
