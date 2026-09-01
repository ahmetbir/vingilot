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
// **A chip can be renamed** (P4.5; owner, pointing at a chip reading "task 1":
// "suralari da rename edebilelim ya"). Double-click puts a field where the
// label is; the palette's "Rename this task" opens the same one. The name it
// writes is `TaskGroup.name`, which has existed and persisted since P2 —
// nothing here is a second store, and `task 3` was always the DEFAULT rather
// than the identity, which is why clearing the field restores it.
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
import { StripNameEditor } from "@/features/runs/ui/StripNameEditor";

interface TaskStripProps {
  strip: WorktreeTaskStrip;
  /** The task holding the worktree's active tab — the lit chip. */
  activeTaskId: number | null;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onNew: () => void;
  /** The chip whose name is being typed, or `null` — held by the surface
   * rather than here, because the palette's "Rename this task" opens the same
   * editor and the surface is where that request lands. */
  renamingId: number | null;
  onRenameStart: (id: number) => void;
  onRenameCommit: (id: number, name: string) => void;
  onRenameCancel: () => void;
}

function TaskChip({
  active,
  group,
  onClose,
  onRenameCancel,
  onRenameCommit,
  onRenameStart,
  onSelect,
  renaming,
}: {
  active: boolean;
  group: TaskGroup;
  onClose: () => void;
  onRenameCancel: () => void;
  onRenameCommit: (name: string) => void;
  onRenameStart: () => void;
  onSelect: () => void;
  renaming: boolean;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only gesture — the nested buttons are the keyboard path through the chip, and the palette's "Rename this task" row is the keyboard door to this same editor.
    <div
      className={`group flex shrink-0 items-center gap-2 rounded-lg border pl-3.5 pr-2 transition-colors ${
        active
          ? "border-foreground/10 bg-foreground/[.07] text-foreground shadow-md"
          : "border-transparent text-muted-foreground hover:bg-foreground/[.04] hover:text-foreground"
      }`}
      data-active={active}
      data-testid={`task-chip-${group.id}`}
      // Double-click on the chip, the gesture every renameable label in the
      // owner's day already answers. On the chip rather than on the label
      // alone so the dot and the padding are part of the target.
      onDoubleClick={onRenameStart}
    >
      {renaming ? (
        // The field takes the chip's own row: same height, same type size, so
        // the strip does not reflow around the one chip being renamed.
        <StripNameEditor
          className="my-1.5 w-[8.5rem] rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground outline-none ring-1 ring-inset ring-[var(--vingilot-accent)]"
          label={`rename ${group.name}`}
          onCancel={onRenameCancel}
          onCommit={onRenameCommit}
          seed={group.name}
          testid={`task-chip-rename-${group.id}`}
        />
      ) : (
        <>
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
            {/* Truncated here, whole in the `title` above: a long name may
             * shorten a chip, never push the strip's `+` out of reach. */}
            <span className="max-w-[10rem] truncate">{group.name}</span>
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
        </>
      )}
    </div>
  );
}

export function TaskStrip({
  activeTaskId,
  onClose,
  onNew,
  onRenameCancel,
  onRenameCommit,
  onRenameStart,
  onSelect,
  renamingId,
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
            onRenameCancel={onRenameCancel}
            onRenameCommit={(name) => onRenameCommit(group.id, name)}
            onRenameStart={() => onRenameStart(group.id)}
            onSelect={() => onSelect(group.id)}
            renaming={group.id === renamingId}
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
