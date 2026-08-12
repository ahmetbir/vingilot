import { createRootRoute } from "@tanstack/react-router";

import { AppShell } from "@/app/AppShell";
import { ShellPalette } from "@/features/runs/ui/ShellPalette";

/**
 * The root route renders upstream's shell, plus the fork's palette beside it —
 * the seam for "⌘K means one thing app-wide"
 * (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 2). It is mounted
 * here rather than inside `AppShell` for two reasons: this is the highest point
 * INSIDE the router (the palette navigates, so it needs `useAppNavigation`),
 * and `AppShell.tsx` sits at the 1000-line ratchet's cap, where the house rule
 * is to split rather than grow.
 *
 * `ShellPalette` draws nothing while the workspace's own palette is mounted
 * (`features/runs/lib/paletteClaim.ts`), and it takes no chord upstream binds
 * except ⌘K — whose channel list it hosts rather than replaces, and which it
 * hands back to the composer's link editor under upstream's own condition
 * (`features/runs/lib/composerClaim.ts`).
 */
function Root() {
  return (
    <>
      <AppShell />
      <ShellPalette />
    </>
  );
}

export const Route = createRootRoute({
  component: Root,
});
