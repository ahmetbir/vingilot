/** Minimum width shared by desktop left and right navigation sidebars.
 *
 * 196, not upstream's 220: this fork's sidebar is drawn to the owner's mockup,
 * whose own resize is `Math.min(340, Math.max(196, …))` (vingilot.js), and
 * `vingilot-shell`'s spec asserts both ends of that range. The 2026-09 sync
 * moved this constant out of `ui/sidebar.tsx` into this shared module, so the
 * fork's number moved with it rather than being redeclared beside the import.
 */
export const SIDEBAR_WIDTH_MIN = 196;
