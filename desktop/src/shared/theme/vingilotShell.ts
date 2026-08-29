/**
 * The single source of truth for the Vingilot dark-only shell switch
 * (redesign plan decision 1, vingilot/docs/plans/2026-08-29-redesign.md).
 *
 * A pure constant in its own module, deliberately: `ThemeProvider` consumes
 * it for the runtime pin, and the e2e specs that had to adapt to the pinned
 * shell (buzz-theme-screenshots, vingilot-boot-mark, channel-mute,
 * needs-restart-screenshots) import the SAME constant — so flipping the
 * shell back to themed light/dark automatically un-skips every adapted
 * assertion instead of leaving them silently parked behind a stale copy of
 * the flag. No imports, no DOM, no side effects; safe in both the app bundle
 * and the Playwright node context.
 *
 * VETO POINT: flips on the owner's word only.
 */
export const VINGILOT_FORCE_DARK = true;
