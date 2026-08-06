// Pure guards for the Terminal surface's two resize paths: "may this
// container be fitted?" and "may this proposed geometry be pushed to the
// real pty?". Both live here rather than in Terminal.tsx so the rule is
// testable without a DOM, an xterm instance, or a Tauri bridge.
//
// Why a guard at all: a background terminal is `display: none`, so its
// container measures 0×0 while its ResizeObserver still fires. Fitting and
// resizing on that measurement pushes a geometry nobody laid out down to the
// shell, which reflows its output to match — the scrollback the owner
// switched away from is gone before they switch back.
//
// @xterm/addon-fit 0.10.0 already refuses to *fit* a container whose
// computed height/width parse to NaN (fit() bails on isNaN), but it does not
// refuse the clamp floor it applies to a real-but-empty box, and it has no
// say over what its caller then sends to the pty. These two functions close
// both.

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
