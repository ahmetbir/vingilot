// An element that reads wheel gestures itself, and the way the shell's
// boundary lock is told so.
//
// **Why this exists.** `shared/hooks/useWebviewScrollBoundaryLock.ts` consumes
// wheel gestures at *window capture* — above the whole tree — whenever nothing
// on the composed path is a CSS-scrollable container that can still move. That
// is right for the app's fixed-height panes, where a gesture with nowhere to go
// would rubber-band the webview. It is wrong wherever the gesture is an input
// rather than a scroll: the terminal's scrollback belongs to tmux, so no
// ancestor is CSS-scrollable and the lock deleted the wheel before xterm could
// turn it into a mouse report on the pty's wire.
//
// So an element may claim the gesture. What that buys it is *travel*, not
// exemption: the lock still cancels the default action over a wheel owner (the
// rubber-band is exactly as unwanted there), it just stops confiscating the
// event on the way down. Two facts make that split safe — xterm.js never reads
// `defaultPrevented`, and it scrolls its own viewport by assigning `scrollTop`
// rather than by letting the browser scroll it — so a cancelled default costs
// a wheel owner nothing.

/** What an element sets to claim wheel gestures over it. */
export const WHEEL_OWNER_ATTRIBUTE = "data-vingilot-wheel-owner";

/** Spread onto the claiming element, so the attribute the lock looks for and
 * the attribute the DOM carries cannot drift apart. */
export const wheelOwnerProps = { [WHEEL_OWNER_ATTRIBUTE]: "" } as const;

/**
 * Whether a wheel event's composed path crosses an element that owns the
 * gesture.
 *
 * Takes the path rather than the event: at window capture the event has not
 * descended yet, so `event.target.closest(...)` and the path are the same
 * question, and the path is the one that also answers it across a shadow
 * boundary. Non-element entries on the path (`document`, `window`) are simply
 * not owners.
 */
export function pathOwnsTheWheel(path: readonly unknown[]): boolean {
  for (const node of path) {
    const candidate = node as { hasAttribute?: (name: string) => boolean };
    if (
      typeof candidate?.hasAttribute === "function" &&
      candidate.hasAttribute(WHEEL_OWNER_ATTRIBUTE)
    ) {
      return true;
    }
  }
  return false;
}
