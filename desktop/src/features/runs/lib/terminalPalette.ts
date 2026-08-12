// Three rules about the colours the terminal is painted with, kept out of the
// component that reads them: whether a colour the app resolved is one xterm
// can be handed, how to thin one into a form xterm still reads, and whether two
// readings of that palette are the same reading.
//
// Separate for the same reason `terminalScrollback.ts` is: both are decisions
// that used to sit inside `ui/Terminal.tsx`, where checking them needs a DOM,
// an xterm and a bridge. The one that stayed inside was the one that shipped a
// bug — a colour test written as a pattern match on the end of a string, which
// read every opaque colour with a zero blue channel (`rgb(255, 255, 0)`, and
// every warm accent at high saturation) as fully transparent and dropped it.
// A dropped colour is not a missing colour: it reverts that slot to xterm's own
// default, which is the white-on-near-white this whole palette exists to
// replace.

/** The five colours the app decides and xterm is handed. `undefined` is a slot
 * the app could not answer for, which xterm fills with its own default —
 * spelled that way because that is what an xterm theme object holds. */
export interface TerminalPalette {
  background?: string;
  cursor?: string;
  cursorAccent?: string;
  foreground?: string;
  selectionBackground?: string;
}

/** How much of the accent a selection is. xterm applies exactly this to an
 * opaque `selectionBackground` of its own accord — but only to the copy the
 * canvas renderers use, and only *after* it has already composited the one the
 * DOM renderer paints, so an opaque colour reaches the screen at full strength
 * (@xterm/xterm 5.5.0 `ThemeService._setTheme`: `selectionBackgroundOpaque` is
 * blended first, the `isOpaque` re-thinning happens second, and
 * `color.blend(bg, fg)` returns `fg` untouched when `fg` is opaque). So the
 * thinning is done here, before xterm sees the colour, and both of xterm's
 * copies then agree. */
export const SELECTION_ALPHA = 0.3;

/** The same colour at a given alpha, spelled the one way xterm 5.5.0 can read
 * back — or `null` when the reading is not a form this can re-spell.
 *
 * Not `bg-primary/30`, and not `color-mix(…)`: Tailwind compiles a slash
 * opacity to `color-mix(in oklab, …)`, Chromium computes that to `oklab(…)`,
 * and xterm's `css.toColor` reads hex, `rgb()`/`rgba()`, and otherwise falls
 * through to a 1×1 canvas that *throws on anything not fully opaque*. A
 * translucent colour therefore has to arrive as literal `rgba(…)` or it is
 * swallowed and the slot silently reverts to xterm's own default. Composing the
 * string here is what guarantees that form.
 *
 * Only a fully opaque `rgb(…)` reading is accepted as input. A colour that
 * already carries an alpha is not re-thinned — that would be two opinions about
 * the same channel — and anything else is a shape this cannot take apart
 * without guessing. */
export function translucent(color: string, alpha: number): string | null {
  if (!(alpha > 0) || !(alpha < 1)) return null;
  const match =
    /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*\)$/.exec(
      color.trim(),
    );
  if (match === null) return null;
  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`;
}

/** The alpha channel of a computed colour, or `null` when the value carries no
 * alpha component at all — which is to say it is opaque.
 *
 * Both spellings a browser can hand back: the legacy comma form
 * (`rgba(24, 24, 37, 0.3)`), where alpha is a fourth component and three
 * components mean opaque, and the modern slash form (`rgb(24 24 37 / 30%)`,
 * `color(srgb 0 0 0 / 0)`), where it is whatever follows the slash. Anything
 * else — a keyword, a hex string, a function this does not recognise — has no
 * alpha to report and is opaque as far as this is concerned. */
function alphaOf(value: string): number | null {
  const open = value.indexOf("(");
  if (open === -1 || !value.endsWith(")")) return null;
  const body = value.slice(open + 1, -1);
  const slash = body.lastIndexOf("/");
  if (slash !== -1) return parseAlpha(body.slice(slash + 1));
  const parts = body.split(",");
  if (parts.length !== 4) return null;
  return parseAlpha(parts[3]);
}

/** One alpha component, as a number in 0…1, or `null` for anything that is not
 * one. Percentages included: `rgb(0 0 0 / 0%)` is as transparent as
 * `rgba(0, 0, 0, 0)` and a reader that only understood the second would let the
 * first through. */
function parseAlpha(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  if (text.endsWith("%")) {
    const percent = Number.parseFloat(text.slice(0, -1));
    return Number.isFinite(percent) ? percent / 100 : null;
  }
  const alpha = Number.parseFloat(text);
  return Number.isFinite(alpha) ? alpha : null;
}

/** The colour, or `null` when it is no colour at all.
 *
 * An unresolved token computes to `rgba(0, 0, 0, 0)` and an unset one to the
 * empty string; handing either to xterm would paint that slot in nothing, which
 * looks like an empty shell rather than like the styling bug it is. So those
 * two answer `null` and the caller lets xterm keep its own default.
 *
 * Transparency is decided on the alpha channel, never on the shape of the
 * string. A partly transparent colour is a real colour and is kept: only
 * *fully* transparent means "no answer". What the caller may then do with a
 * partly transparent colour is its own problem — xterm 5.5.0's parser reads
 * hex and `rgb()`/`rgba()` and nothing else, so `ui/Terminal.tsx` is careful
 * about which tokens it probes. That is a question about xterm, not about
 * whether a colour resolved. */
export function usableColor(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "transparent") return null;
  return alphaOf(trimmed) === 0 ? null : trimmed;
}

/** Whether two readings of the app's palette say the same thing.
 *
 * The theme is re-read whenever the root element's `class` or `style` changes,
 * because that is how a theme switch reaches the document
 * (`shared/theme/ThemeProvider.tsx`). It is not the only thing that writes
 * there: Cmd +/- sets an inline `font-size` on the same element
 * (`app/useWebviewZoomShortcuts.ts`), so every zoom keystroke arrives as a
 * theme change too. Re-applying an identical palette is not free — xterm 5.5.0
 * does not diff `options.theme`, it rebuilds the palette and makes the DOM
 * renderer re-inject its stylesheet and refresh every row, on every mounted
 * terminal — so the reading is compared before it is used. */
export function samePalette(a: TerminalPalette, b: TerminalPalette): boolean {
  return (
    a.background === b.background &&
    a.cursor === b.cursor &&
    a.cursorAccent === b.cursorAccent &&
    a.foreground === b.foreground &&
    a.selectionBackground === b.selectionBackground
  );
}
