// Pure guards for the Terminal surface's resize paths: "may this container be
// fitted, and to what?". They live here rather than in Terminal.tsx so the
// rule is testable without a DOM, an xterm instance, or a Tauri bridge.
//
// Why a guard at all: a background terminal is `display: none`, so its
// container measures 0×0 while its ResizeObserver still fires. Fitting and
// resizing on that measurement pushes a geometry nobody laid out down to the
// shell, which reflows its output to match — the scrollback the owner
// switched away from is gone before they switch back.
//
// The container's box is only half of it. @xterm/addon-fit 0.10.0 declines to
// fit at all when the terminal's *cell* box has not been measured
// (`proposeDimensions` returns undefined on a 0×0 css cell), which is exactly
// the state of an XTerm constructed inside a hidden subtree — xterm only
// re-measures asynchronously, from its own IntersectionObserver, on a later
// frame. A caller that fits and then reads `term.cols`/`term.rows` reads the
// constructor default 80×24 and cannot tell it apart from a real 80×24, so
// checking the container alone still sends 80×24 to a live 213×51 shell.
// Hence: decide from the addon's own proposal, never from the terminal's
// current geometry, and treat "nothing proposed yet" as its own answer.

/** The floor @xterm/addon-fit 0.10.0 clamps its proposal to
 * (`Math.max(2, …)` columns, `Math.max(1, …)` rows). A container with a box
 * but no usable area proposes exactly this, so a terminal reported at or
 * under the floor on either axis is a layout artefact, not a geometry the
 * owner chose. */
const FIT_CLAMP_FLOOR_COLS = 2;
const FIT_CLAMP_FLOOR_ROWS = 1;

/** `pty_resize` takes `u16` (desktop/src-tauri/src/vingilot_pty/mod.rs), and
 * so does the `TIOCSWINSZ` ioctl underneath it. A larger number would wrap
 * to a small one on the way across rather than fail loudly. */
const MAX_PTY_DIMENSION = 65_535;

/** A terminal geometry, in whole cells — the shape @xterm/addon-fit's
 * `proposeDimensions()` returns. */
export interface TerminalGeometry {
  cols: number;
  rows: number;
}

/** What to do with a fit opportunity.
 *
 * - `apply`: fit the terminal to these cells and push them to the pty. Both
 *   halves, together — fitting without resizing leaves the xterm rendering a
 *   different shape than the shell is writing for.
 * - `wait`: the container is on screen but nothing has been measured yet.
 *   Try again on a later frame; do **not** fall back to the terminal's
 *   current geometry, which is where the 80×24 came from.
 * - `refuse`: measured, and not a geometry worth having. Change nothing. */
export type FitDecision =
  | ({ type: "apply" } & TerminalGeometry)
  | { type: "refuse" }
  | { type: "wait" };

/** True when a container's measured box is real enough to fit a terminal
 * into. Callers pass the ResizeObserver's `contentRect` (or a
 * `getBoundingClientRect()`) width/height in CSS pixels.
 *
 * A hidden container measures 0×0; anything with positive extent in both
 * axes is on screen. Sub-pixel extents count — an element mid-transition is
 * still laid out, and the geometry guard below catches whatever it proposes. */
export function shouldFit(width: number, height: number): boolean {
  return (
    Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
  );
}

/** True when a proposed terminal geometry may be pushed to the real pty.
 *
 * Refuses non-integers (the pty takes whole cells), anything at or below the
 * fit addon's clamp floor, and anything past the `u16` the resize crosses
 * into Rust as. */
export function shouldResizePty(cols: number, rows: number): boolean {
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols > FIT_CLAMP_FLOOR_COLS &&
    rows > FIT_CLAMP_FLOOR_ROWS &&
    cols <= MAX_PTY_DIMENSION &&
    rows <= MAX_PTY_DIMENSION
  );
}

/** The whole decision, from the container's measured box and whatever
 * @xterm/addon-fit proposes for it (`null` when it proposes nothing).
 *
 * `proposal === null` from a container that *does* have a box is the
 * hidden-construction case: the terminal exists but its cell size is
 * unmeasured, so nothing can be concluded yet. That is `wait`, not a licence
 * to use the terminal's current cols/rows. */
export function resolveFit(
  width: number,
  height: number,
  proposal: TerminalGeometry | null,
): FitDecision {
  if (!shouldFit(width, height)) return { type: "refuse" };
  if (proposal === null) return { type: "wait" };
  if (!shouldResizePty(proposal.cols, proposal.rows)) return { type: "refuse" };
  return { cols: proposal.cols, rows: proposal.rows, type: "apply" };
}

/** How far a view has got in attaching to a PTY session.
 *
 * - `unopened`: nothing has been opened for this view. It has no geometry to
 *   preserve and no session to resize.
 * - `opening`: `pty_open` is in flight. A second call would race the first.
 * - `open`: the session is live and this view is streaming it. */
export type SessionPhase = "opening" | "open" | "unopened";

/** What a fit opportunity means for a view in a given phase.
 *
 * - `open`: open the session **at this measured geometry**.
 * - `resize`: push this measured geometry to the session already open.
 * - `retry`: nothing is measured yet; ask again on a later frame.
 * - `idle`: nothing to do now. A later ResizeObserver callback, or this
 *   terminal being shown, is what brings it back. */
export type FitAction =
  | ({ type: "open" } & TerminalGeometry)
  | ({ type: "resize" } & TerminalGeometry)
  | { type: "idle" }
  | { type: "retry" };

/** The one rule that decides when a session may be opened at all.
 *
 * **Why an open waits for a measurement.** `pty_open`'s reattach branch
 * refuses to resize, precisely because the geometry a reattaching view reports
 * may be its pre-layout default — adopting it would reflow a live shell to a
 * shape nobody is looking at. Its *spawn* branch had no such scruple: it took
 * whatever it was handed, and the caller handed it a placeholder 80×24 for
 * every terminal born inside a hidden subtree, which is every worktree's
 * terminal but one each time a project opens.
 *
 * Under tmux that placeholder does not merely start a shell small — it
 * reshapes a session restored from a previous app run, because the sole
 * attached client's size *is* the session's size (`-D` having detached any
 * other). Measured on tmux 3.6a: a session created 213×51 becomes 80×23 the
 * moment an 80×24 client attaches, re-wrapping every line of the scrollback
 * the owner came back for. That is the same failure the reattach branch
 * refuses to commit, arriving by the other branch.
 *
 * So there is no action here that opens without an `apply`: a terminal that
 * has not been measured waits to be shown, and opens at the size it is
 * actually given. Nothing invents a geometry. */
export function resolveFitAction(
  phase: SessionPhase,
  decision: FitDecision,
): FitAction {
  // An open already in flight owns the session's geometry until it lands, and
  // signals for itself when it does.
  if (phase === "opening") return { type: "idle" };
  if (decision.type === "wait") return { type: "retry" };
  if (decision.type === "refuse") return { type: "idle" };
  const { cols, rows } = decision;
  return phase === "unopened"
    ? { cols, rows, type: "open" }
    : { cols, rows, type: "resize" };
}
