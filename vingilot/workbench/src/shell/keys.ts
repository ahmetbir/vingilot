// Pure keyboard model — no DOM, no React. resolveKey takes the minimal
// key-event shape it needs (so it is testable with plain objects) plus the
// bit of UI context (whether the palette is open) that changes what cmd+K
// means, and returns a typed Action or null. The event handler in App.tsx
// dispatches the Action; this module never touches state itself.

export interface KeyLike {
  key: string;
  metaKey: boolean;
}

export interface KeyContext {
  paletteOpen: boolean;
}

export type Action =
  | { type: "open-palette" }
  | { type: "close-palette" }
  | { type: "select-run"; n: number }
  | { type: "close" };

/** cmd+K toggles the palette (open when closed, close when open); cmd+1..9
 * selects the nth rail run; Escape closes the palette/overlay regardless of
 * the meta key; everything else is not an action recognized here. */
export function resolveKey(evt: KeyLike, ctx: KeyContext): Action | null {
  if (evt.key === "Escape") return { type: "close" };

  if (!evt.metaKey) return null;

  if (evt.key === "k" || evt.key === "K") {
    return ctx.paletteOpen ? { type: "close-palette" } : { type: "open-palette" };
  }

  if (/^[1-9]$/.test(evt.key)) {
    return { type: "select-run", n: Number(evt.key) };
  }

  return null;
}
