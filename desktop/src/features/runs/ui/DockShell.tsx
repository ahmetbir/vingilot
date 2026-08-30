// The dock (redesign P3): the mockup's `.dock` card — the `.dtop` tab row
// (Crew / Diff / Files / Checks / History / Run), the `.dctl` position
// switcher, and one panel under them — built from Vingilot.html:202-325 as
// the spec, per the owner's birebir demand.
//
// **What it replaces.** The work surface's right slot used to wear
// `PaneFrame` + `PanePicker` chrome — an open dropdown over the registry.
// The dock is the mockup's closed six-tab strip over the SAME slot state:
// the four pane-backed tabs write through `panes.choose` (per-worktree
// persistence unchanged, palette doors unchanged), Checks and Run are the
// dock's own two panels (`dockModel.ts` is the decision record), and a ⌘K
// pane with no tab (Notes, Plan, Agent, Evidence, Runs, Search) renders
// body-only with its name in the strip's place — reachable exactly as
// before, just not promoted to fixed furniture the mockup does not draw.
//
// **Availability sentences survive the rewrite** — the registry's
// `availability(ctx)` rules still gate every pane-backed panel, and the
// refusal/pending words render in the dock body the way `PaneFrame` printed
// them. That is the cheapest honest continuity there is, and the specs that
// unit-test those rules stay meaningful.
//
// **Where the tab-count chips went.** The mockup stamps counts on Crew and
// Diff (`.dtab .n`). No real count reaches this shell today — the diff
// panel's file count lives inside its own read, the crew's unread count
// inside upstream's stores — and a chip fed by a second read invented for
// the chrome would be decoration pretending to be data. Chips land when a
// real count is plumbed to this level; none are drawn until then.

import type * as React from "react";

import {
  DOCK_TAB_TITLES,
  DOCK_TABS,
  type DockExtra,
  type DockSelection,
  type DockTab,
  dockSelection,
  paneOfTab,
} from "@/features/runs/lib/dockModel";
import type {
  PaneAct,
  PaneAvailability,
  PaneContext,
  PaneId,
  PaneState,
} from "@/features/runs/lib/paneModel";
import type { Worktree } from "@/features/runs/lib/projects";
import type { ControlPlaneKind } from "@/features/runs/lib/reachability";
import type { RunSummary } from "@/features/runs/lib/runModel";
import type { ProjectDocuments } from "@/features/runs/lib/useDocument";
import type { Panes } from "@/features/runs/lib/usePanes";
import type { VingilotCrewPosition } from "@/shared/theme/vingilot-crew-position";
import { DockChecksPanel } from "@/features/runs/ui/DockChecksPanel";
import { DockFilesPanel } from "@/features/runs/ui/DockFilesPanel";
import { DockHistoryPanel } from "@/features/runs/ui/DockHistoryPanel";
import { DockRunPanel } from "@/features/runs/ui/DockRunPanel";
import { paneEntry, type PaneProps } from "@/features/runs/ui/paneRegistry";

export interface DockContentProps {
  context: PaneContext;
  controlPlane: ControlPlaneKind;
  documents: ProjectDocuments;
  onChoose: Panes["choose"];
  onPaneAct: (act: PaneAct) => void;
  pollMs: number;
  right: PaneState["right"];
  runs: RunSummary[];
  worktree: Worktree | null;
  workspaceId: string;
  /** The dock-only overlay (Checks/Run), owned by the work surface. */
  extra: DockExtra | null;
  onExtra: (extra: DockExtra | null) => void;
  position: VingilotCrewPosition;
  onPosition: (position: VingilotCrewPosition) => void;
}

interface DockShellProps extends DockContentProps {
  frameRef?: React.RefObject<HTMLElement | null>;
  /** Inline geometry from the host — the right card's width, the drawer's
   * height. The float host passes none. */
  style?: React.CSSProperties;
  /** The float panel hosts this same shell; its hint line and Esc live in
   * `DockFloat`, so the shell only needs to know not to draw a card border
   * of its own. */
  variant?: "card" | "float";
}

/** The `.dc` position glyphs, traced from the mockup's own SVGs. */
function PositionIcon({ position }: { position: VingilotCrewPosition }) {
  if (position === "right") {
    return (
      <svg
        aria-hidden="true"
        fill="none"
        height="12"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width="12"
      >
        <rect height="16" rx="2" width="18" x="3" y="4" />
        <path d="M15 4v16" />
      </svg>
    );
  }
  if (position === "drawer") {
    return (
      <svg
        aria-hidden="true"
        fill="none"
        height="12"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width="12"
      >
        <rect height="16" rx="2" width="18" x="3" y="4" />
        <path d="M3 14h18" />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="12"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="12"
    >
      <rect height="12" rx="2" width="13" x="3" y="8" />
      <path d="M8 8V5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-3" />
    </svg>
  );
}

const POSITION_TITLES: Record<VingilotCrewPosition, string> = {
  drawer: "Dock bottom",
  float: "Float (⌘\\)",
  right: "Dock right",
};

export function DockShell({
  frameRef,
  style,
  variant = "card",
  ...content
}: DockShellProps) {
  const { extra, onChoose, onExtra, onPosition, position, right } = content;
  const selection = dockSelection(right, extra);

  const selectTab = (tab: DockTab) => {
    const pane = paneOfTab(tab);
    if (pane === null) {
      onExtra(tab as DockExtra);
      return;
    }
    onExtra(null);
    onChoose(pane);
  };

  return (
    <section
      aria-label="dock"
      // The mockup's `.dock` is a rounded, bordered card. Here it is drawn
      // WITHIN the stage card (a true sibling card with the window gradient
      // in the gutter needs the shell's card layer opened up — noted for the
      // sweep); the float variant leaves the chrome to `DockFloat`.
      className={`isolate flex min-h-0 min-w-0 flex-col overflow-hidden ${
        variant === "card"
          ? "m-1 shrink-0 rounded-xl border border-foreground/[.06] bg-background shadow-lg"
          : "flex-1"
      }`}
      data-dock-position={position}
      data-dock-selection={
        selection.kind === "tab" ? selection.tab : `pane:${selection.pane}`
      }
      data-testid="dock"
      ref={frameRef}
      style={style}
    >
      {/* The `.dtop` row: the tab strip scrolls if it must; the `.dctl`
       * switcher never leaves the card. */}
      <div className="flex min-h-[42px] shrink-0 items-center border-b border-border/60 px-2.5 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [&::-webkit-scrollbar]:hidden">
          {DOCK_TABS.map((tab) => {
            const active = selection.kind === "tab" && selection.tab === tab;
            return (
              <button
                aria-pressed={active}
                className={`shrink-0 rounded-[7px] px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                  active
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                }`}
                data-testid={`dock-tab-${tab}`}
                key={tab}
                onClick={() => selectTab(tab)}
                type="button"
              >
                {DOCK_TAB_TITLES[tab]}
              </button>
            );
          })}
          {selection.kind === "pane" ? (
            // A ⌘K pane with no fixed tab, named where a tab would be lit.
            <span
              className="shrink-0 rounded-[7px] bg-foreground/10 px-2 py-1.5 text-xs font-medium text-foreground"
              data-testid="dock-pane-label"
            >
              {paneEntry(selection.pane).title}
            </span>
          ) : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-1">
          {(["right", "drawer", "float"] as const).map((candidate) => (
            <button
              aria-pressed={position === candidate}
              className={`flex h-6 w-6 items-center justify-center rounded-[5px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                position === candidate
                  ? "bg-foreground/[.08] text-foreground/75"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground/75"
              }`}
              data-testid={`dock-position-${candidate}`}
              key={candidate}
              onClick={() => onPosition(candidate)}
              title={POSITION_TITLES[candidate]}
              type="button"
            >
              <PositionIcon position={candidate} />
            </button>
          ))}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <DockPanel selection={selection} {...content} />
      </div>
    </section>
  );
}

/** The active panel, availability-gated through the registry's own rules. */
function DockPanel({
  selection,
  ...content
}: DockContentProps & { selection: DockSelection }) {
  const { context } = content;

  if (selection.kind === "tab" && selection.tab === "checks") {
    return <DockChecksPanel />;
  }

  const paneProps: PaneProps = {
    controlPlane: content.controlPlane,
    cwd: context.cwd,
    documents: content.documents,
    onChoosePane: content.onChoose,
    onPaneAct: content.onPaneAct,
    ownerRunId: context.ownerRunId,
    pollMs: content.pollMs,
    projectPath: context.projectPath,
    runs: content.runs,
    workspaceId: content.workspaceId,
    worktree: content.worktree,
  };

  if (selection.kind === "tab" && selection.tab === "run") {
    return <DockRunPanel {...paneProps} />;
  }

  // Everything else is pane-backed: the registry's availability rule gates
  // it, and its identity string keys the remount — the exact contract the
  // old right slot kept.
  const pane: PaneId =
    selection.kind === "pane"
      ? selection.pane
      : (paneOfTab(selection.tab) as PaneId);
  const entry = paneEntry(pane);
  const availability = entry.availability(context);
  if (availability.status !== "available") {
    return <DockNotice availability={availability} />;
  }
  const key = `${pane}:${entry.identity(context)}`;
  if (selection.kind === "tab" && selection.tab === "files") {
    return <DockFilesPanel key={key} {...paneProps} />;
  }
  if (selection.kind === "tab" && selection.tab === "history") {
    return <DockHistoryPanel key={key} {...paneProps} />;
  }
  const Pane = entry.component;
  return Pane === null ? null : <Pane key={key} {...paneProps} />;
}

/** `PaneFrame`'s two-state notice, kept word-for-word in shape: pending is a
 * wait, unavailable is an answer, and reading one as the other is the
 * island's twice-made mistake. */
function DockNotice({ availability }: { availability: PaneAvailability }) {
  if (availability.status === "available") return null;
  const pending = availability.status === "pending";
  return (
    <p
      className="flex flex-1 items-center justify-center px-6 py-4 text-center text-sm text-muted-foreground"
      data-testid={pending ? "dock-pending" : "dock-unavailable"}
    >
      {pending ? availability.note : availability.reason}
    </p>
  );
}
