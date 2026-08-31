// The strip of terminal tabs for one worktree — the row of iTerm tabs this
// app is replacing, wearing an editor's manners since P4.7.
//
// It renders a strip, and nothing else: which tabs exist, which is showing,
// and what the owner just asked for. The layout it displays lives in
// `RunsScreen` (which never unmounts) and the rules that change it live in
// `lib/terminalTabs.ts`, `lib/viewTabs.ts` and `lib/tabSplit.ts`.
//
// **⌘W closes the focused tab now** (redesign P4.7, item 1: "cmd w ye filan
// basinca tab kapanmali"). The header that stood here said the opposite — that
// ⌘W could never reach the webview because macOS resolved it as the default
// menu's Close Window — and that stopped being true when `app_menu.rs` began
// building this app's menu without that item. `lib/closeKeys.ts` carries the
// re-run six-claimant audit and what still closes the window. ⇧⌘W stays, and
// stays narrower: it closes a terminal tab whatever is stacked over it.
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
// **Three states now, not two.** A tab is off the stage, on it, or focused on
// it. The third is what it always was — fill, full-weight label, an inset ring
// — and the second is the tab in the OTHER half of a tab split: the same fill
// at a quieter ring and weight, because it is on screen but the keyboard is
// not in it. The ring is drawn on every tab and merely transparent on the
// ones that are off, so gaining or losing it moves no pixel of the row.
//
// **Not every tab is a terminal** (redesign P4.1). A file, a commit's patch or
// the worktree's diff can hold a tab here too — drawn AFTER the shells, wearing
// their subject's name instead of an ordinal. The two lists are kept apart on
// purpose (`viewTabs.ts`): the ordinals name ptys, and nothing about a reading
// may reach the model that owns sessions. That is also why a drag reorders
// within its own run rather than interleaving the two.

import * as React from "react";

import { fileIconId } from "@/features/runs/lib/fileIcons";
import type { TabCloseScope } from "@/features/runs/lib/tabMenu";
import { stageKey, type TabSplitHalf } from "@/features/runs/lib/tabSplit";
import type { WorktreeTabs } from "@/features/runs/lib/terminalTabs";
import type { ViewTab } from "@/features/runs/lib/viewTabs";
import { viewLabel, viewTitle } from "@/features/runs/lib/viewTabs";
import { DraggableTab } from "@/features/runs/ui/TabDnd";
import { FileIcon } from "@/features/runs/ui/FileIcon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";

interface TerminalTabStripProps {
  tabs: WorktreeTabs;
  onSelect: (n: number) => void;
  onClose: (n: number) => void;
  onNew: () => void;
  /** The non-terminal tabs beside the shells, in the order they were opened. */
  views?: readonly ViewTab[];
  /** Which view is showing, or `null` while a terminal is. */
  activeViewId?: string | null;
  onSelectView?: (id: string) => void;
  onCloseView?: (id: string) => void;
  /** The tab the RIGHT half of the stage is drawing, or `null` when one tab
   * has the whole stage (`tabSplit.ts`). */
  splitSecondary?: string | null;
  /** Which half the keyboard is in, or `null` when there is no split. */
  splitFocus?: TabSplitHalf | null;
  /** The context menu's three close scopes, resolved against the strip's own
   * order by `tabMenu.ts` and performed by the deck. */
  onCloseScope?: (key: string, scope: TabCloseScope) => void;
  /** Put this tab in the other half of the stage. */
  onSplitTab?: (key: string) => void;
  onCopyPath?: (key: string) => void;
  /** True while the scratch shell is open over this surface. The mockup
   * (`#tab-scratch`) draws the scratch as a tab that exists only while it is
   * open: amber dot, always-visible ✕. This strip draws the same tab; the
   * surface itself stays the overlay (`ScratchTerminal.tsx`), so the tab is
   * a mirror with a close button, never a second owner of the session. */
  scratchOpen?: boolean;
  onCloseScratch?: () => void;
}

export function TerminalTabStrip({
  activeViewId = null,
  onClose,
  onCloseScope,
  onCloseScratch,
  onCloseView,
  onCopyPath,
  onNew,
  onSelect,
  onSelectView,
  onSplitTab,
  scratchOpen = false,
  splitFocus = null,
  splitSecondary = null,
  tabs,
  views = [],
}: TerminalTabStripProps) {
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const activeRef = React.useRef<HTMLDivElement | null>(null);

  // Which tab the left half draws — the strip's own selection, unchanged by
  // the split (`tabSplit.ts` says why the asymmetry is the point).
  const primaryKey =
    activeViewId !== null
      ? stageKey({ id: activeViewId, kind: "view" })
      : stageKey({ kind: "terminal", n: tabs.active });
  const focusedKey =
    splitFocus === "right" && splitSecondary !== null
      ? splitSecondary
      : primaryKey;

  // Bring the focused tab into view, and no further. `scrollIntoView` would
  // have been one line, but its `block: "nearest"` still walks every scrollable
  // ancestor — and one of this row's ancestors is the work surface. Moving the
  // scroller by hand is the whole of what this needs and cannot reach anything
  // else.
  //
  // The dependency is the focused key rather than the strip: the acts that put
  // a tab off screen are selecting one (⌥⌘←/→, a click, a half change) and
  // opening one, and all of them change which key is focused.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the focused key is a pure trigger — the body reads the DOM, not the value
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
  }, [focusedKey]);

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
          const key = stageKey({ kind: "terminal", n });
          const state = tabState(key, focusedKey, primaryKey, splitSecondary);
          return (
            <TabShell
              activeRef={state.focused ? activeRef : null}
              key={n}
              label={`Terminal ${n}`}
              onClose={() => onClose(n)}
              onCloseScope={onCloseScope}
              onCopyPath={onCopyPath}
              onSplit={onSplitTab}
              pad="pl-2.5 pr-1"
              stageKey={key}
              state={state}
              testid={`terminal-tab-shell-${n}`}
            >
              <button
                aria-selected={state.focused}
                // Tabular figures so a strip that reaches double digits does
                // not re-space itself as the ordinals grow.
                className={`flex items-center gap-2 py-1.5 font-mono tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
                  state.focused
                    ? "font-semibold"
                    : state.onStage
                      ? "font-medium"
                      : "font-normal"
                }`}
                data-testid={`terminal-tab-${n}`}
                onClick={() => onSelect(n)}
                role="tab"
                title={`Terminal ${n}`}
                type="button"
              >
                {/* The mockup's 5px state dot: accent-lit with a glow on the
                 * showing tab, quiet on the rest. */}
                <span
                  aria-hidden="true"
                  className={`h-[5px] w-[5px] shrink-0 rounded-full transition-colors ${
                    state.onStage
                      ? "bg-[var(--vingilot-accent)] shadow-[0_0_6px_var(--vingilot-accent)]"
                      : "bg-foreground/25"
                  }`}
                />
                {n}
              </button>
              <TabCloseButton
                label={`close terminal ${n}`}
                onClose={() => onClose(n)}
                testid={`terminal-tab-close-${n}`}
                title={`Close terminal ${n} (⌘W, or ⇧⌘W wherever you are)`}
              />
            </TabShell>
          );
        })}
        {views.map((view) => {
          const key = stageKey({ id: view.id, kind: "view" });
          const state = tabState(key, focusedKey, primaryKey, splitSecondary);
          const label = viewLabel(view.subject);
          return (
            <TabShell
              activeRef={state.focused ? activeRef : null}
              key={view.id}
              label={label}
              onClose={() => onCloseView?.(view.id)}
              onCloseScope={onCloseScope}
              onCopyPath={onCopyPath}
              onSplit={onSplitTab}
              pad="pl-2 pr-1"
              stageKey={key}
              state={state}
              testid={`view-tab-${view.id}`}
            >
              <button
                aria-selected={state.focused}
                className={`flex max-w-[14rem] items-center gap-1.5 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
                  state.focused
                    ? "font-semibold"
                    : state.onStage
                      ? "font-medium"
                      : "font-normal"
                }`}
                data-testid={`view-tab-select-${view.id}`}
                onClick={() => onSelectView?.(view.id)}
                role="tab"
                title={viewTitle(view.subject)}
                type="button"
              >
                {/* A view tab wears its subject rather than a state dot: the
                 * language icon a file has in the tree, and the two other
                 * kinds' own marks. Nothing here reports liveness — a reading
                 * has none. */}
                {view.subject.kind === "file" ? (
                  <FileIcon id={fileIconId(label)} />
                ) : (
                  <span
                    aria-hidden="true"
                    className="font-mono text-2xs text-muted-foreground"
                  >
                    {view.subject.kind === "commit"
                      ? "◇"
                      : view.subject.kind === "history"
                        ? "⑂"
                        : "±"}
                  </span>
                )}
                <span className="truncate">{label}</span>
              </button>
              <TabCloseButton
                label={`close ${viewTitle(view.subject)}`}
                onClose={() => onCloseView?.(view.id)}
                testid={`view-tab-close-${view.id}`}
                title="Close this reading — the shells are untouched"
              />
            </TabShell>
          );
        })}
        {scratchOpen ? (
          <div
            className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--vingilot-term,hsl(var(--muted)))] pl-2.5 pr-1 text-xs text-foreground ring-1 ring-inset ring-border"
            data-testid="terminal-tab-scratch"
          >
            <span className="flex items-center gap-2 py-1.5 font-mono">
              {/* Amber, the mockup's own scratch colour — a shell that keeps
               * nothing wears a different light than the tabs that stay. */}
              <span
                aria-hidden="true"
                className="h-[5px] w-[5px] shrink-0 rounded-full bg-[#d4b36a] shadow-[0_0_6px_#d4b36a]"
              />
              scratch
            </span>
            <button
              aria-label="close the scratch terminal"
              className="rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              data-testid="terminal-tab-scratch-close"
              onClick={onCloseScratch}
              title="Close the scratch shell (⌥⌘T) — keeps nothing"
              type="button"
            >
              ×
            </button>
          </div>
        ) : null}
      </div>
      <button
        aria-label="new terminal tab"
        className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid="terminal-tab-new"
        onClick={onNew}
        title="New terminal tab in this task — ⌘T opens a new task instead"
        type="button"
      >
        +
      </button>
    </div>
  );
}

/** The three states a tab can be in, read once per tab per render so the fill,
 * the ring, the weight and the dot cannot come to disagree. */
interface TabState {
  focused: boolean;
  onStage: boolean;
  half: TabSplitHalf | null;
}

function tabState(
  key: string,
  focusedKey: string,
  primaryKey: string,
  secondary: string | null,
): TabState {
  const half: TabSplitHalf | null =
    secondary !== null && key === secondary
      ? "right"
      : key === primaryKey
        ? "left"
        : null;
  return { focused: key === focusedKey, half, onStage: half !== null };
}

/** One tab: its chrome, its drag handle, its middle-click and its menu.
 *
 * The chrome is one component for both kinds because the three states have to
 * read identically whatever the tab is a tab OF — a shell and a reading that
 * wore different rings would make the row a puzzle rather than a strip. */
function TabShell({
  activeRef,
  children,
  label,
  onClose,
  onCloseScope,
  onCopyPath,
  onSplit,
  pad,
  stageKey: key,
  state,
  testid,
}: {
  activeRef: React.RefObject<HTMLDivElement | null> | null;
  children: React.ReactNode;
  label: string;
  onClose: () => void;
  onCloseScope?: (key: string, scope: TabCloseScope) => void;
  onCopyPath?: (key: string) => void;
  onSplit?: (key: string) => void;
  pad: string;
  stageKey: string;
  state: TabState;
  testid: string;
}) {
  return (
    <ContextMenu>
      {/* `display: contents` so the trigger adds listeners and no box: the
       * strip's own flex row still lays the tab out, the tab is still the drag
       * node, and every spec that reads `data-active` off the tab's own box
       * still reads it off the same element it always did. */}
      <ContextMenuTrigger
        className="contents"
        // Middle-click closes, the way it does on every tab bar the owner
        // uses. `onAuxClick` rather than a button check inside `onClick`,
        // which never fires for the middle button; the mousedown is
        // swallowed so Chromium does not start its autoscroll instead.
        onAuxClick={(event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          onClose();
        }}
        onMouseDown={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
      >
        <DraggableTab
          boxRef={activeRef}
          className={`group flex shrink-0 items-center gap-1 rounded-md ${pad} text-xs ring-1 ring-inset transition-colors ${
            state.focused
              ? "bg-[var(--vingilot-term,hsl(var(--muted)))] text-foreground ring-border"
              : state.onStage
                ? "bg-[var(--vingilot-term,hsl(var(--muted)))] text-foreground ring-border/50"
                : "text-muted-foreground ring-transparent hover:bg-muted/50 hover:text-foreground"
          }`}
          dataTestid={testid}
          half={state.half ?? undefined}
          isActive={state.focused}
          label={label}
          stageKey={key}
        >
          {children}
        </DraggableTab>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60" data-testid={`tab-menu-${key}`}>
        <ContextMenuItem
          data-testid="tab-menu-close"
          onSelect={() => onCloseScope?.(key, "this")}
        >
          Close
        </ContextMenuItem>
        <ContextMenuItem
          data-testid="tab-menu-close-others"
          onSelect={() => onCloseScope?.(key, "others")}
        >
          Close others
        </ContextMenuItem>
        <ContextMenuItem
          data-testid="tab-menu-close-right"
          onSelect={() => onCloseScope?.(key, "right")}
        >
          Close to the right
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          data-testid="tab-menu-split"
          onSelect={() => onSplit?.(key)}
        >
          Split the stage
        </ContextMenuItem>
        <ContextMenuItem
          data-testid="tab-menu-copy-path"
          onSelect={() => onCopyPath?.(key)}
        >
          Copy path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function TabCloseButton({
  label,
  onClose,
  testid,
  title,
}: {
  label: string;
  onClose: () => void;
  testid: string;
  title: string;
}) {
  return (
    <button
      aria-label={label}
      className="rounded px-1 py-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring group-hover:opacity-100"
      data-testid={testid}
      onClick={onClose}
      title={title}
      type="button"
    >
      ×
    </button>
  );
}
