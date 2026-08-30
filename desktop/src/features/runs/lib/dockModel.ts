// The dock's vocabulary (vingilot redesign P3, mockup `.dock` —
// vingilot/design/mockup/Vingilot.html lines 202-325, the owner's own DOM,
// built to birebir per the P1.1 clarification).
//
// **Six fixed tabs over the pane registry's open slot.** The mockup's dock is
// a closed set — Crew / Diff / Files / Checks / History / Run — while the
// registry (`paneRegistry.tsx`) is an open table of eleven panes. This module
// is the bridge and the decision record: four tabs are faces of existing
// panes (crew→team, diff→diff, files→files, history→history) and ride the
// SAME per-worktree `panes.state.right` persistence the picker used, so
// nothing the palette or `useShowPane` does needs to change; Checks and Run
// are dock-only panels with no registry row, held as a transient overlay
// (`DockExtra`) because they are not "the pane in the right slot" — they are
// the dock's own furniture. The six registry panes without a tab (agent,
// evidence, notes, plan, runs, search) are NOT dropped: ⌘K still chooses
// them through `panes.choose`, and the dock renders them body-only with no
// tab lit (`dockSelection` answers `{ kind: "pane" }`). Their tab-less state
// is the mockup's own claim about what deserves a fixed button.
//
// **The geometry is the mockup's, in pixels.** `--dockw` 376 default,
// resizable 300-540; drawer `--dockh` 280 default, 170-480 (vingilot.js:83).
// Ratios were the shared-slot model's arithmetic; the dock is a fixed-width
// card, so the clamps are px and the terminal's 80-column floor
// (`paneModel.ts`'s MIN_LEFT_PX) is applied as a cap on top — the same
// ranking `clampRatioAt` documents: the terminal's floor outranks the dock's.

import { MIN_LEFT_PX, type PaneId } from "./paneModel.ts";

/** The mockup's six, in the mockup's order (`.dtop`, Vingilot.html:205). */
export const DOCK_TABS = [
  "crew",
  "diff",
  "files",
  "checks",
  "history",
  "run",
] as const;

export type DockTab = (typeof DOCK_TABS)[number];

/** The two dock-only panels — tabs with no pane behind them in the registry. */
export type DockExtra = "checks" | "run";

/** The mockup's labels, verbatim (Vingilot.html:205). */
export const DOCK_TAB_TITLES: Record<DockTab, string> = {
  checks: "Checks",
  crew: "Crew",
  diff: "Diff",
  files: "Files",
  history: "History",
  run: "Run",
};

/** The registry pane a tab is a face of, or `null` for the dock-only two. */
export function paneOfTab(tab: DockTab): PaneId | null {
  if (tab === "crew") return "team";
  if (tab === "diff") return "diff";
  if (tab === "files") return "files";
  if (tab === "history") return "history";
  return null;
}

/** The tab a chosen pane lights, or `null` for a pane with no tab (agent,
 * evidence, notes, plan, runs, search — ⌘K's panes, rendered body-only). */
export function tabOfPane(pane: PaneId): DockTab | null {
  if (pane === "team") return "crew";
  if (pane === "diff") return "diff";
  if (pane === "files") return "files";
  if (pane === "history") return "history";
  return null;
}

/** What the dock is showing: one of the six tabs, or a ⌘K pane with no tab. */
export type DockSelection =
  | { kind: "tab"; tab: DockTab }
  | { kind: "pane"; pane: PaneId };

/** The one resolution rule, so the tab row and the body cannot disagree:
 * a dock-only overlay (Checks/Run) wins while it is set; otherwise the pane
 * in the slot answers, as a tab when it has one and as itself when not. */
export function dockSelection(
  right: PaneId,
  extra: DockExtra | null,
): DockSelection {
  if (extra !== null) return { kind: "tab", tab: extra };
  const tab = tabOfPane(right);
  return tab === null ? { kind: "pane", pane: right } : { kind: "tab", tab };
}

/** The mockup's `--dockw` bounds (vingilot.js:83): 300..540, default 376. */
export const DOCK_MIN_W = 300;
export const DOCK_MAX_W = 540;
export const DOCK_DEFAULT_W = 376;

/** The mockup's `--dockh` bounds: 170..480, default 280. */
export const DOCK_MIN_H = 170;
export const DOCK_MAX_H = 480;
export const DOCK_DEFAULT_H = 280;

/** The resizer's own width — the row's third member, `paneModel.ts`'s
 * DIVIDER_PX lesson applied to the dock's rail. */
export const DOCK_RESIZER_PX = 8;

/** The dock's width on a surface, ranked the way `clampRatioAt` ranks:
 * 1. the terminal's 80 columns (MIN_LEFT_PX) — its loss is unrecoverable;
 * 2. the mockup's 300px floor;
 * 3. the mockup's 540px ceiling.
 * A surface of 0 (unmeasured) applies only the mockup's own bounds — never
 * invent a floor from a width nobody has read. */
export function clampDockWidth(wanted: number, surfaceWidth: number): number {
  const inBounds = Math.min(
    DOCK_MAX_W,
    Math.max(DOCK_MIN_W, Number.isFinite(wanted) ? wanted : DOCK_DEFAULT_W),
  );
  if (!Number.isFinite(surfaceWidth) || surfaceWidth <= 0) return inBounds;
  const cap = surfaceWidth - DOCK_RESIZER_PX - MIN_LEFT_PX;
  return Math.max(DOCK_MIN_W, Math.min(inBounds, cap));
}

/** The drawer's height: the mockup's own clamp, nothing else — a drawer does
 * not share a row with the terminal's columns. */
export function clampDockHeight(wanted: number): number {
  return Math.min(
    DOCK_MAX_H,
    Math.max(DOCK_MIN_H, Number.isFinite(wanted) ? wanted : DOCK_DEFAULT_H),
  );
}

/** Whether a right-docked card fits beside the terminal at all. Under this,
 * the surface falls back to the terminal alone with the dock on its rail —
 * `effectiveSolo`'s trap-avoidance, restated for a px card. */
export function dockFitsBeside(surfaceWidth: number): boolean {
  if (!Number.isFinite(surfaceWidth) || surfaceWidth <= 0) return true;
  return surfaceWidth - DOCK_RESIZER_PX - DOCK_MIN_W >= MIN_LEFT_PX;
}

/** One arrow press on the focused resizer, in px — coarse with ⇧. */
export const DOCK_RESIZE_STEP = 16;
export const DOCK_RESIZE_STEP_COARSE = 64;
