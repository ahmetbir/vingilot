/**
 * Vingilot redesign P0 — appearance preference (wash + accent).
 *
 * The redesigned shell is dark-only; the user-facing appearance choice is a
 * sidebar *wash* (the window's gradient ground) and an *accent*. Both are
 * applied as data attributes on the document root — the CSS token layer in
 * `shared/styles/globals/vingilot-tokens.css` maps each value onto the
 * gradient and accent custom properties. The accent additionally feeds the shadcn
 * `--primary` family through `ThemeProvider`'s existing accent pipeline.
 *
 * Persistence follows the app's exclusive convention for UI preferences:
 * raw localStorage through the throw-safe wrapper, one key per concern.
 * No picker UI exists yet (P1 ships the Appearance tray); the typed setter
 * lives on the theme context for the tray to call.
 */

import { getStorageItem, setStorageItem } from "@/shared/lib/safeStorage";

export const VINGILOT_WASH_STORAGE_KEY = "vingilot-wash";
export const VINGILOT_ACCENT_STORAGE_KEY = "vingilot-accent";

export const VINGILOT_WASHES = [
  "buzz",
  "graphite",
  "slate",
  "ember",
  "ink",
] as const;
export type VingilotWash = (typeof VINGILOT_WASHES)[number];

export const VINGILOT_ACCENTS = [
  "ember",
  "orange",
  "mauve",
  "teal",
  "green",
] as const;
export type VingilotAccent = (typeof VINGILOT_ACCENTS)[number];

export const DEFAULT_VINGILOT_WASH: VingilotWash = "buzz";
export const DEFAULT_VINGILOT_ACCENT: VingilotAccent = "ember";

/**
 * Accent base colors from the mockup (`vingilot/design/mockup/vingilot.js`).
 * The hex feeds `applyAccentColor`, which derives the `--primary` family and
 * a contrast-safe foreground; the soft/text variants are stylesheet-owned
 * (`--vingilot-accent-soft` / `--vingilot-accent-text` in
 * vingilot-tokens.css) and switch on the `data-vingilot-accent` root
 * attribute. The hex values here and there are the same table by hand —
 * nothing links them mechanically yet; P1's tray, the first consumer of the
 * CSS half, should either single-source them or add a parity test.
 */
export const VINGILOT_ACCENT_HEX: Record<VingilotAccent, string> = {
  ember: "#e0a35f",
  orange: "#ff6b35",
  mauve: "#c6a0f6",
  teal: "#7fb2c9",
  green: "#8fb97c",
};

/**
 * Wash gradient endpoints from the mockup's setSide table (`vingilot.js`).
 * The live gradient is stylesheet-owned (vingilot-tokens.css overrides
 * --buzz-gradient-dark-top/bottom per `data-vingilot-wash`); this map exists
 * for surfaces that must *depict* a wash without applying it — the P1
 * Appearance tray's swatches. Same hand-copied-parity caveat as the accent
 * table above.
 */
export const VINGILOT_WASH_GRADIENTS: Record<
  VingilotWash,
  { top: string; bottom: string }
> = {
  buzz: { top: "#4a4616", bottom: "#0a1423" },
  graphite: { top: "#2c2c30", bottom: "#1a1a1e" },
  slate: { top: "#2a3240", bottom: "#10151d" },
  ember: { top: "#4a2e16", bottom: "#140e0a" },
  ink: { top: "#161616", bottom: "#161616" },
};

export type VingilotAppearance = {
  wash: VingilotWash;
  accent: VingilotAccent;
};

function isVingilotWash(value: string): value is VingilotWash {
  return (VINGILOT_WASHES as readonly string[]).includes(value);
}

function isVingilotAccent(value: string): value is VingilotAccent {
  return (VINGILOT_ACCENTS as readonly string[]).includes(value);
}

/** Read the stored appearance, falling back to the defaults (buzz + ember). */
export function readVingilotAppearance(): VingilotAppearance {
  const wash = getStorageItem(VINGILOT_WASH_STORAGE_KEY);
  const accent = getStorageItem(VINGILOT_ACCENT_STORAGE_KEY);
  return {
    wash: wash !== null && isVingilotWash(wash) ? wash : DEFAULT_VINGILOT_WASH,
    accent:
      accent !== null && isVingilotAccent(accent)
        ? accent
        : DEFAULT_VINGILOT_ACCENT,
  };
}

/** Persist both halves; best-effort (throw-safe) like every sibling key. */
export function persistVingilotAppearance(appearance: VingilotAppearance) {
  setStorageItem(VINGILOT_WASH_STORAGE_KEY, appearance.wash);
  setStorageItem(VINGILOT_ACCENT_STORAGE_KEY, appearance.accent);
}

/**
 * Stamp the root data attributes the CSS token layer keys on. Idempotent;
 * called synchronously at provider init (pre-first-paint) and from the setter.
 */
export function applyVingilotAppearanceAttributes(
  appearance: VingilotAppearance,
) {
  const root = document.documentElement;
  root.setAttribute("data-vingilot-wash", appearance.wash);
  root.setAttribute("data-vingilot-accent", appearance.accent);
}
