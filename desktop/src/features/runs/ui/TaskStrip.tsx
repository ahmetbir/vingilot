// The Deck's tasks strip — the mockup's `.tasks` row, drawn over the fork's
// own task model (2026-08-29 redesign, P2).
//
// A chip is a task: a named group of the selected worktree's terminal tabs
// (`lib/taskStrip.ts` — the header there is the decision record for why a
// task is not a run). The strip says which task is showing, offers a `+` for
// a new one, and carries the ⌘T hint on its right, exactly as the mockup
// draws it: 46px, dot + name + hover ✕ per chip, accent-lit dot on the
// active chip.
//
// Contrast, measured rather than copied: the mockup paints inactive chips at
// `rgba(255,255,255,.5)` and the hint at `.3`, both under WCAG AA on the
// stage's #1a1a1a. The P0 verify already raised this app's muted ink for the
// same reason, so chips wear `text-muted-foreground` (the raised seed,
// ~4.9:1) and the hint does too — the mockup's hierarchy, at legal strength.

import type {
  TaskGroup,
  WorktreeTaskStrip,
} from "@/features/runs/lib/taskStrip";

interface TaskStripProps {
  strip: WorktreeTaskStrip;
  /** The task holding the worktree's active tab — the lit chip. */
  activeTaskId: number | null;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onNew: () => void;
}

function TaskChip({
  active,
  group,
  onClose,
  onSelect,
}: {
  active: boolean;
  group: TaskGroup;
  onClose: () => void;
  onSelect: () => void;
}) {
  return (
    <div
      className={`group flex shrink-0 items-center gap-2 rounded-lg border pl-3.5 pr-2 transition-colors ${
        active
          ? "border-foreground/10 bg-foreground/[.07] text-foreground shadow-md"
          : "border-transparent text-muted-foreground hover:bg-foreground/[.04] hover:text-foreground"
      }`}
      data-active={active}
      data-testid={`task-chip-${group.id}`}
    >
      <button
        aria-current={active}
        className="flex items-center gap-2 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid={`task-chip-select-${group.id}`}
        onClick={onSelect}
        title={`${group.name} — ${group.tabs.length} ${group.tabs.length === 1 ? "terminal" : "terminals"}`}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`h-[5px] w-[5px] shrink-0 rounded-full transition-colors ${
            active
              ? "bg-[var(--vingilot-accent)] shadow-[0_0_6px_var(--vingilot-accent)]"
              : "bg-foreground/25"
          }`}
        />
        {group.name}
      </button>
      <button
        aria-label={`close ${group.name} and end its ${group.tabs.length === 1 ? "shell" : "shells"}`}
        className="flex h-4 w-4 items-center justify-center rounded text-2xs text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring group-hover:opacity-100"
        data-testid={`task-chip-close-${group.id}`}
        onClick={onClose}
        title={`Close ${group.name} — ends every shell it holds`}
        type="button"
      >
        ✕
      </button>
    </div>
  );
}

export function TaskStrip({
  activeTaskId,
  onClose,
  onNew,
  onSelect,
  strip,
}: TaskStripProps) {
  return (
    <div
      className="flex h-[46px] shrink-0 items-center gap-1.5 border-b border-border/60 px-3"
      data-testid="task-strip"
    >
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden">
        {strip.groups.map((group) => (
          <TaskChip
            active={group.id === activeTaskId}
            group={group}
            key={group.id}
            onClose={() => onClose(group.id)}
            onSelect={() => onSelect(group.id)}
          />
        ))}
      </div>
      <button
        aria-label="new task"
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-sm text-muted-foreground transition-colors hover:bg-foreground/[.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid="task-strip-new"
        onClick={onNew}
        title="New task (⌘T) — its own chip, its own shell"
        type="button"
      >
        +
      </button>
      <span
        className="ml-auto shrink-0 text-2xs text-muted-foreground"
        data-testid="task-strip-hint"
      >
        ⌘T new task
      </span>
    </div>
  );
}
