// **Which host owns the palette right now** — the workspace's, or the shell's
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 2).
//
// ⌘K is one gesture with one meaning app-wide now, but it is drawn by two
// components, and this module is why that is not a contradiction.
//
// **Why two hosts at all.** The palette is `absolute inset-0 z-30` *inside*
// `RunsScreen`'s work-surface box — positioned rather than portalled, so on the
// workspace it covers the surface he is working on and not the chrome he is
// not. That geometry is the subject of two specs (`workspace-palette-over-thread`
// proves nothing paints over it, `workspace-one-column` proves the box it sits
// in), and it is the right geometry on the one screen that has a work surface.
// A chat route has none, so the shell's host centres over the window instead.
// Moving the workspace's palette out to the shell to get one mount point would
// have traded a correct geometry for a uniform one and re-opened a bug the
// owner already reported.
//
// **What is shared is everything else**: `usePalette`'s state machine,
// `paletteDoors.ts`'s grammar, `paletteSources.ts`'s sources,
// `paletteModel.ts`'s one ranking and `CommandPalette.tsx` itself. The split
// the owner filed — *"cmd k buzz kısmında farklı deck kısmında farklı
// çalışıyor"* — was two different **surfaces** with different rows and
// different keys; two mounts of one surface is not that.
//
// **The claim, not the route.** The shell host could have asked the router
// whether it is on /workspace. It asks this instead, because what must not
// happen is *both* hosts binding ⌘K or *neither* doing so, and the honest
// condition for that is "is the workspace's palette mounted" — which is not the
// same as "is the route /workspace" during the lazy chunk's load, when the route
// matches and nothing is there to answer the key.
//
// A module-level value survives the community remount (`useCommunityInit.ts`'s
// rule), and this one is meant to: it holds no community data, only whether a
// component of this app is currently mounted, and the register/release pair is
// an effect cleanup — so a remount releases and re-claims by itself.

type Listener = (claimed: boolean) => void;

/** How many workspace hosts are mounted. A count rather than a flag because
 * React can mount the next instance before unmounting the last (a route
 * transition, `<React.StrictMode>`'s double-invoke), and a flag would be
 * cleared by the departing one after the arriving one set it. */
let claims = 0;
const listeners = new Set<Listener>();

function announce(): void {
  const claimed = claims > 0;
  for (const listen of [...listeners]) {
    try {
      listen(claimed);
    } catch {
      // A subscriber's failure is not the claimant's; the others still hear.
    }
  }
}

/** Take the palette. Returns the release, so a caller can hand the whole thing
 * to a `useEffect` and cannot forget the other half. */
export function claimPalette(): () => void {
  claims += 1;
  announce();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims -= 1;
    announce();
  };
}

/** Is a workspace palette mounted? */
export function paletteClaimed(): boolean {
  return claims > 0;
}

export function subscribePaletteClaim(listen: Listener): () => void {
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
  };
}

/** Drop everything. For tests: a module-level counter that leaks between cases
 * would make the second one depend on the first. */
export function resetPaletteClaim(): void {
  claims = 0;
  listeners.clear();
}
