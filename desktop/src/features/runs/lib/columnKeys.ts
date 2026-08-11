// Pure keyboard-resolution for collapsing the workspace's columns, on the
// bindings the owner's hands already know from VS Code: ⌘B hides the sidebar,
// ⇧⌘B hides the workspace nav — the projects and, under the open one, its
// worktrees (`ui/WorkspaceNav.tsx`). Same shape as `terminalKeys.ts` — a
// `resolveKey`-style function so the map is unit-testable without React or a
// real keyboard, and the caller decides whether now is the time for it.
//
// **Every chord here was checked against four claimants before being taken**
// (vingilot/docs/plans/2026-08-07-panes-and-polish.md, Task 6):
//
// - Tauri's default macOS application menu, which this app installs by not
//   setting one (tauri 2.11.5 app.rs:2245). Its predefined items claim ⌘C/X/V,
//   ⌘Z, ⇧⌘Z, ⌘Y, ⌘A, ⌘M, ⌘W, ⌘Q, ⌘H, ⌥⌘H and ⌃⌘F (muda 0.19.3
//   items/predefined.rs:303-339). macOS resolves those in
//   `performKeyEquivalent:` before the webview sees them, so a chord that
//   collides is not merely shadowed — its handler never runs at all. Neither
//   ⌘B nor ⇧⌘B is among them.
// - Upstream's own window-level handler (app/AppShell.tsx), which claims ⌘K,
//   ⇧⌘K, ⇧⌘N, ⇧⌘O and ⇧⌘A, plus ⌘, (useSettingsShortcuts), ⌘[ / ⌘]
//   (useBackForwardControls), ⌘ +/-/0 (useWebviewZoomShortcuts) and ⌘F
//   (useChannelFind).
// - Upstream's sidebar primitive (shared/ui/sidebar.tsx), which binds ⌘S —
//   *not* shadcn's stock ⌘B, which is why ⌘B is free to mean here what it
//   means in VS Code. Both toggles drive the one `toggleSidebar` in that
//   provider; there is no second collapse mechanism.
// - This island's own map (`terminalKeys.ts`): ⌘1…9, ⌘`, ⌘T, ⇧⌘W, ⌥⌘←→.
//
// **⌥⌘B is not this map's.** In VS Code it toggles the secondary sidebar;
// here that surface is the work surface's right pane, and the chord landed
// with it — `paneKeys.ts` resolves it, `WorkSurface` binds it. It is refused
// below rather than ignored, because the two maps are read from two different
// listeners and a ⌘B that also fired on ⌥⌘B would hide the sidebar every time
// the owner hid a pane.
//
// **On a non-mac platform the primary modifier is Ctrl** (`shared/lib/
// platform.ts`), and ⌃B is tmux's default prefix — the terminals this app runs
// are tmux sessions. A caller on such a platform is taking the prefix key away
// from the terminal for as long as this map is bound. That trade does not
// arise on macOS, where ⌃ is left to the pty, and it is the caller's to make.

import type { CollapsibleColumn } from "./columnLayout.ts";
import type { KeyInput } from "./terminalKeys.ts";

export type ColumnKeyAction = {
  type: "toggle-column";
  column: CollapsibleColumn;
};

/** Resolves one keydown into a column toggle, or `null` when this map has
 * nothing to say about the event. Never throws; a `KeyInput` with unexpected
 * values just resolves to `null`. */
export function resolveColumnKey(input: KeyInput): ColumnKeyAction | null {
  // A held-down chord delivers 15-30 keydowns a second, and a column that
  // flickers open and shut is not a second press of anything.
  if (input.repeat === true) return null;
  if (!input.primaryModifier) return null;
  // ⌥ held is ⌥⌘B, which is `paneKeys.ts`'s — see above.
  if (input.altKey === true) return null;
  // Matched case-insensitively: macOS reports ⇧⌘B as "B" and ⌘B as "b", but a
  // stuck caps lock reports "B" for the unshifted chord too, and losing the
  // sidebar toggle to caps lock would be a bug nobody would think to look for.
  if (input.key.toLowerCase() !== "b") return null;
  return {
    column: input.shiftKey === true ? "nav" : "sidebar",
    type: "toggle-column",
  };
}
