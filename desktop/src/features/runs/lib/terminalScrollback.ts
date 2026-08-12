// Whether a terminal is showing the newest output, and what to say when it is
// not.
//
// **This is about xterm's own viewport, and only about that.** A terminal
// backed by tmux has no scrollback here at all: tmux owns the history, the
// wheel over the pane is an input rather than a scroll (`ui/Terminal.tsx`),
// and xterm's buffer never accumulates behind the view. So `baseY` stays at 0
// there, `linesBehind` stays at 0, and the affordance built on it never
// appears — which is correct rather than a gap. Where it does appear is
// exactly where there is something to jump back to: the scratch shell, which
// is spawned outside tmux, and every terminal on a machine with no tmux at all
// (`lib/terminalPersistence.ts`'s `app-process` backing).
//
// Pure, and separate from the component, for the same reason `terminalFit.ts`
// is: the rule is then checkable without a DOM, an xterm, or a bridge.

/** How many lines of output are below the view, from xterm's buffer figures.
 *
 * `baseY` is the top row of the *newest* screen and `viewportY` the top row of
 * what is drawn, so their difference is the distance scrolled back. Clamped at
 * zero rather than trusted: xterm reports both while a buffer is being rebuilt
 * (an alt-screen switch, a reflow), and a transient negative there would read
 * as "scrolled up" on a terminal sitting at the bottom.
 *
 * Non-integer or non-finite readings answer 0 for the same reason — the answer
 * this feeds is "is there something to jump to", and a number nobody can count
 * lines with is not evidence that there is. */
export function linesBehind(baseY: number, viewportY: number): number {
  if (!Number.isFinite(baseY) || !Number.isFinite(viewportY)) return 0;
  const behind = Math.floor(baseY) - Math.floor(viewportY);
  return behind > 0 ? behind : 0;
}

/** What the jump-to-bottom control says about itself. */
export interface ScrollbackNotice {
  /** Lines below the view — also written to the DOM, so a test can assert the
   * count without reading the sentence. */
  behind: number;
  /** The visible label. Short, because it sits over the owner's output. */
  label: string;
  /** The same thing said in full, for the title/tooltip and the accessible
   * name — where there is room to say what clicking it does. */
  detail: string;
}

/** The notice for a reading, or `null` when the terminal is at the bottom.
 *
 * `null` rather than a disabled control: a terminal showing the newest output
 * is the ordinary state, and a permanent button over the corner of every
 * terminal to say so is chrome charging rent. It appears when it has something
 * to offer and leaves when it does not. */
export function scrollbackNotice(behind: number): ScrollbackNotice | null {
  if (!Number.isFinite(behind) || behind <= 0) return null;
  const lines = Math.floor(behind);
  return {
    behind: lines,
    detail: `Scrolled up — ${lines} ${lines === 1 ? "line" : "lines"} below this view. Jump to the newest output.`,
    label: `↓ ${lines} ${lines === 1 ? "line" : "lines"}`,
  };
}
