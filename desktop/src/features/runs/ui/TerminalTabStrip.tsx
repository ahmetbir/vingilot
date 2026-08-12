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
//
// **Overflow is a scroller with the `+` outside it.** The strip is one row in
// a pane the owner can drag down to 80 columns, so enough tabs will always
// overflow it. Two things follow from that. The button that makes a new tab
// must not be able to scroll out of reach — it sits beside the scroller, not
// inside it, which is also why the scroller may shrink but the `+` may not.
// And selecting a tab has to be able to *show* it: ⌥⌘←/→ steps through the
// ordinals whether or not they are on screen, so the active tab is scrolled
// into view by the smallest movement that gets it there, on the scroller
// alone. The native horizontal scrollbar is hidden because a permanent bar
// under a 24px row is thicker than the thing it measures; what says there is
// more is the tab clipped at the edge.
//
// **The active tab is read by three signals, not one.** It was a `bg-muted`
// fill and nothing else, which on a header that is itself a muted surface is
// close to no signal at all. Now: the fill, a full-weight label against the
// others' normal weight, and an inset ring. The ring is drawn on every tab and
// is merely transparent on the inactive ones, so gaining or losing it moves no
// pixel of the row — the same reason the `×` fades rather than appears.

import * as React from "react";

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
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const activeRef = React.useRef<HTMLDivElement | null>(null);

  // Bring the showing tab into view, and no further. `scrollIntoView` would
  // have been one line, but its `block: "nearest"` still walks every scrollable
  // ancestor — and one of this row's ancestors is the work surface. Moving the
  // scroller by hand is the whole of what this needs and cannot reach anything
  // else.
  //
  // The dependency is the ordinal rather than the strip: the two acts that put
  // a tab off screen are selecting one (⌥⌘←/→) and opening one, and both land
  // here because both change which ordinal is active (`terminalTabs.ts`).
  // biome-ignore lint/correctness/useExhaustiveDependencies: tabs.active is a pure trigger — the body reads the DOM, not the value
  React.useEffect(() => {
    const scroller = scrollerRef.current;
    const tab = activeRef.current;
    if (scroller === null || tab === null) return;
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < scroller.scrollLeft) {
      scroller.scrollLeft = left;
    } else if (right > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollLeft = right - scroller.clientWidth;
    }
  }, [tabs.active]);

  return (
    <div
      className="flex min-w-0 items-center gap-1"
      data-testid="terminal-tab-strip"
    >
      {/* `relative` so a tab's `offsetLeft` is measured against this box —
       * without it the offset parent is whichever ancestor happens to be
       * positioned, and the arithmetic above scrolls to the wrong place. */}
      <div
        aria-label="terminal tabs"
        className="relative flex min-w-0 items-center gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden"
        data-testid="terminal-tab-scroller"
        ref={scrollerRef}
        role="tablist"
      >
        {tabs.tabs.map((n) => {
          const active = n === tabs.active;
          return (
            <div
              className={`group flex shrink-0 items-center gap-1 rounded-md pl-2 pr-1 text-xs ring-1 ring-inset transition-colors ${
                active
                  ? "bg-muted text-foreground ring-border"
                  : "text-muted-foreground ring-transparent hover:bg-muted/50 hover:text-foreground"
              }`}
              data-active={active}
              key={n}
              ref={active ? activeRef : null}
            >
              <button
                aria-selected={active}
                // Tabular figures so a strip that reaches double digits does
                // not re-space itself as the ordinals grow.
                className={`py-1 font-mono tabular-nums ${
                  active ? "font-semibold" : "font-normal"
                }`}
                data-testid={`terminal-tab-${n}`}
                onClick={() => onSelect(n)}
                role="tab"
                title={`Terminal ${n}`}
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
      </div>
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
