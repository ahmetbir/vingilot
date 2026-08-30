// The dock's Checks tab (redesign P3, mockup `#dp-checks`) — honestly empty.
//
// The mockup's panel draws four `.chk` rows off a pull request's CI. This app
// has no source for any of them yet: there is no `gh` island, no PR read, no
// checks read anywhere in the backend (P3 recon grepped for it; the plan's P5
// correction is where the real one arrives, wrapping `gh` in a Tauri
// command). Under the no-fake-data rule the panel therefore renders ONE
// designed empty state in the mockup's `.chk` vocabulary — the glyph column,
// the sentence — and nothing that could be mistaken for a wired row.

export function DockChecksPanel() {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-4 text-center"
      data-testid="dock-checks-empty"
    >
      <span aria-hidden="true" className="text-sm text-muted-foreground">
        ✓
      </span>
      <p className="text-sm text-muted-foreground">
        No checks wired to this worktree yet — they arrive with the pull-request
        island.
      </p>
    </div>
  );
}
