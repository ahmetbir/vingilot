// **⌘B and ⌥⌘B, owned by the shell** (vingilot redesign P1).
//
// Until P1 the ⌘B binding lived in the workspace (`useColumns.ts`, mounted
// only on /workspace), so the chord hid the sidebar on one screen and typed
// Bold on the rest. Since the v0.3.0 merge there is exactly ONE sidebar
// (upstream's `SidebarProvider`), so the chord is the shell's: bound once
// here, driving that provider's own `toggleSidebar` — never a second collapse
// mechanism beside it. `useColumns` keeps its per-project restore/record
// effects, which observe the same provider state this hook moves.
//
// **Every chord here was checked against six claimants** (the
// `columnKeys.ts` / `paneKeys.ts` audit, re-run for the app-wide scope):
//
// 1. Tauri's default macOS application menu — claims ⌘C/X/V, ⌘Z, ⇧⌘Z, ⌘Y,
//    ⌘A, ⌘M, ⌘W, ⌘Q, ⌘H, ⌥⌘H and ⌃⌘F, resolved in `performKeyEquivalent:`
//    before the webview sees them. Neither ⌘B nor ⌥⌘B is among them.
// 2. Upstream's window-level handler (`useAppShellKeyboardShortcuts`) — ⌘K,
//    ⇧⌘K, ⇧⌘N, ⇧⌘O, ⇧⌘A, ⌘F; plus ⌘, (settings), ⌘[/⌘] (history),
//    ⌘ +/-/0 (zoom). No B chord.
// 3. Upstream's sidebar primitive (`shared/ui/sidebar.tsx`) — binds ⌘S, not
//    shadcn's stock ⌘B. Both toggles drive the one `toggleSidebar`.
// 4. The workspace island's own maps — `terminalKeys.ts` (⌘1…9, ⌘`, ⌘T,
//    ⇧⌘W, ⌥⌘←→), `paletteKeys.ts` (⌘K/⌘P/⇧⌘P) and `paneKeys.ts`, which
//    resolves ⌥⌘B *inside the workspace* (see below).
// 5. TipTap's Bold — the composer claims ⌘B at the element level and
//    `preventDefault`s when it applies. This hook is a bubble-phase window
//    listener, so a composer-handled ⌘B arrives here `defaultPrevented` and
//    is left alone: the editor's claim wins whenever the caret is in one.
// 6. The scratch shields (`scratchTerminal.ts`, `scratchMarkdownKeys.ts`),
//    which pass ⌘B through untouched via `resolveColumnKey` — the map whose
//    *meaning* this hook now hosts; the pure map stays where it was so the
//    shields keep working unchanged.
//
// **⌥⌘B is zen** (mockup: hide the dock, terminal gets the whole surface).
// Inside the workspace that semantic already exists as pane-solo, and
// `WorkSurface.tsx` binds it — so while /workspace is the view this hook
// REFUSES the chord (`zenOwnedByWorkspace`) rather than double-claiming it:
// two listeners toggling on one keydown would cancel each other. Everywhere
// else the chord is CLAIMED but a no-op until P3's dock exists — claimed, so
// no later feature takes it by accident; a no-op, because there is no dock to
// hide yet and pretending otherwise would be a dead gesture that looks broken.
//
// **⇧⌘B stays retired** (single-sidebar plan, Task 2) and is refused here for
// `columnKeys.ts`'s reason: folding it onto ⌘B would be a second spelling to
// unlearn if the chord is ever given a new meaning.

import * as React from "react";

import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";
import { useOptionalSidebar } from "@/shared/ui/sidebar";

export function useShellChords({
  zenOwnedByWorkspace,
}: {
  /** True while /workspace is the view — there `WorkSurface` resolves ⌥⌘B as
   * pane-solo and this hook must not also claim it. */
  zenOwnedByWorkspace: boolean;
}) {
  const sidebar = useOptionalSidebar();

  const latest = React.useRef({ sidebar, zenOwnedByWorkspace });
  latest.current = { sidebar, zenOwnedByWorkspace };

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // A chord an editor already answered (TipTap Bold) is the editor's.
      if (event.defaultPrevented) return;
      // A held chord delivers 15-30 keydowns a second; a sidebar that
      // flickers open and shut is not a second press of anything.
      if (event.repeat) return;
      if (!hasPrimaryShortcutModifier(event)) return;
      // Matched case-insensitively, and with ⌥'s macOS compositions ("∫" for
      // ⌥b, "ı" for ⇧⌥b) — `paneKeys.ts`'s reading, for its reasons.
      const key = event.key.toLowerCase();
      if (key !== "b" && key !== "∫" && key !== "ı") return;

      if (event.altKey) {
        // ⌥⌘B — zen. The workspace's pane-solo owns it there; here it is
        // claimed-but-idle until P3's dock exists (see the header).
        if (latest.current.zenOwnedByWorkspace) return;
        event.preventDefault();
        return;
      }

      // ⇧⌘B — retired, refused rather than folded onto ⌘B.
      if (event.shiftKey) return;

      const bar = latest.current.sidebar;
      if (bar === null) return;
      event.preventDefault();
      bar.toggleSidebar();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
