// The strip of terminal tabs for one worktree — the row of iTerm tabs this
// app is replacing.
//
// It renders a strip, and nothing else: which tabs exist, which is showing,
// and what the owner just asked for. The layout it displays lives in
// `RunsScreen` (which never unmounts) and the rules that change it live in
// `lib/terminalTabs.ts`.
//
// Every affordance here also has a key (`lib/terminalKeys.ts`), and the close
// key is ⇧⌘W rather than the ⌘W an iTerm tab would use: macOS's default
// application menu claims ⌘W for "Close Window" and resolves it before the
// webview sees the event, so binding it here would not close a tab, it would
// close the owner's window. The `×` is what makes that a preference rather
// than a limitation.
//
// A tab is labelled by its ordinal, not its position. The ordinal is what
// names the shell (and, under tmux, the session), so it stays with the tab
// through a reorder; a label that renumbered on every move would be naming
// the strip instead of the terminal.
//
// It draws no border or outer padding of its own: it lives inside the terminal
// pane's header (`ui/PaneFrame.tsx`), which already has both, and a second set
// would put a rule through the middle of one row.

import type { WorktreeTabs } from "@/features/runs/lib/terminalTabs";

interface TerminalTabStripProps {
  tabs: WorktreeTabs;
  onSelect: (n: number) => void;
  onClose: (n: number) => void;
  onNew: () => void;
}

export function TerminalTabStrip({
  onClose,
  onNew,
  onSelect,
  tabs,
}: TerminalTabStripProps) {
  return (
    <div
      className="flex min-w-0 items-center gap-1 overflow-x-auto"
      data-testid="terminal-tab-strip"
      role="tablist"
    >
      {tabs.tabs.map((n) => {
        const active = n === tabs.active;
        return (
          <div
            className={`group flex shrink-0 items-center gap-1 rounded-md pl-2 pr-1 text-xs transition-colors ${
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60"
            }`}
            key={n}
          >
            <button
              aria-selected={active}
              className="py-1 font-medium"
              data-testid={`terminal-tab-${n}`}
              onClick={() => onSelect(n)}
              role="tab"
              type="button"
            >
              {n}
            </button>
            <button
              aria-label={`close terminal ${n}`}
              className="rounded px-1 py-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              data-testid={`terminal-tab-close-${n}`}
              onClick={() => onClose(n)}
              title={`Close terminal ${n} (⇧⌘W)`}
              type="button"
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        aria-label="new terminal tab"
        className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        data-testid="terminal-tab-new"
        onClick={onNew}
        title="New terminal tab (⌘T)"
        type="button"
      >
        +
      </button>
    </div>
  );
}
