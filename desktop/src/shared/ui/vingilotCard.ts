// The mockup's card treatment (`.stage`/`.dock`/`.status`, vingilot.css): one
// rounded, bordered, shadowed surface floating on the window's gradient.
// Three cards wear this exact class list — the stage (`PaneFrame`'s `card`
// prop), the dock (`DockShell.tsx`), and the status bar (`ProjectStatusBar`,
// `ChatStatusBar.tsx`, redesign P4). Pulled out at the third user (three
// strikes, then refactor) rather than duplicated a fourth time — the same
// literal drifting across files is exactly the outcome per-file duplication
// risks.
//
// Lives in `shared/ui/`, not the runs island, on purpose: `ChatStatusBar`
// (upstream's `features/channels`) needs it too, and an upstream component
// reaching INTO the fork-owned runs island would be the dependency running
// backwards — the island may depend on upstream (`useReviewDispatch.ts` does,
// same as `useCrewReach.ts` already did), never the other way.
export const VINGILOT_CARD_CLASS =
  "rounded-xl border border-foreground/[.06] bg-background shadow-lg";
