// The overlay ⌃Tab holds up: where he has been, most recent first, with the
// row a release would land on marked
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 3).
//
// **It is drawn where ⌘K is drawn, and that is not a resemblance — it is the
// same box and the same z.** `absolute inset-0 z-30` inside `RunsScreen`'s
// work-surface region, positioned rather than portalled, so it covers the
// surface he is working on and not the chrome he is not. Sharing the palette's
// placement is also what makes it inherit the fix
// `workspace-palette-over-thread.spec.ts` was written for: a pane is a stacking
// context, so the hosted channel surface's own `z-40` layers are numbers *about
// the pane* and cannot outrank anything drawn here. A second overlay at a
// second z would be a second chance to relearn that defect, which is why this
// file writes no z-index of its own beyond the palette's.
//
// **No scrim button, and that is a difference from the palette rather than an
// omission.** The palette's scrim is an act — "put this away" — that a pointer
// and an assistive technology can reach, because the palette is a surface the
// owner stands in front of and decides in. This one exists only while a
// physical key is held down: there is no state in which a pointer can arrive at
// it, and a click target that cannot be clicked is a promise nothing keeps. So
// the backdrop is inert and `aria-hidden`, and the row a release would land on
// is marked with `aria-current` instead.
//
// **Focus does not move here, deliberately.** The palette takes focus because
// it has a field to type into; this has nothing to type into and one very good
// reason not to take it: the gesture is most often started with the keyboard in
// a shell, and moving focus out of the terminal for the duration of a keypress
// would mean giving it back on release — to an xterm that has meanwhile lost
// its selection, or to `<body>` if the landing changed which terminal is on
// screen. So the keyboard stays where it was and the listener is on `window`.
//
// **Nothing animates in**, for `CommandPalette.tsx`'s reason: a tap of ⌃Tab is
// over in under a tenth of a second, and a surface with an entry ramp would
// spend that time arriving. What the eye needs from it is the row it is on,
// present in the first frame.
//
// The vocabulary is the workspace's (vingilot/docs/plans/2026-08-12-polish-the-right-side.md,
// "The vocabulary"): rows are full-width `text-left`, the one on the cursor is
// `bg-muted text-foreground` and the rest are `text-muted-foreground`; the
// heading is the 3xs uppercase eyebrow every section in this island uses; the
// directory dims and the basename stays bright (`labelParts`, the same
// arrangement the Diff list and Search's group headers use).

import type { Place } from "@/features/runs/lib/placeMru";
import type { PlaceSwitcher as PlaceSwitcherState } from "@/features/runs/lib/usePlaceSwitcher";
import { type Worktree, worktreeSummary } from "@/features/runs/lib/projects";
import { labelParts } from "@/features/runs/lib/worktreeDiff";
import { paneEntry } from "@/features/runs/ui/paneRegistry";

/** What one place is called on screen: the checkout, then the pane, then the
 * file when there is one.
 *
 * The worktree is looked up rather than stored on the `Place`. A label copied
 * into the list when he visited is a label that goes stale the moment the
 * branch is renamed — and worse, two rows for one checkout under two names. A
 * worktree that has since left the workspace keeps its id, which is not pretty
 * and is honest: it is still a place he was, and the row says as much as this
 * app still knows. */
function placeRow(
  place: Place,
  worktrees: readonly Worktree[],
): { where: string; pane: string; lead: string | null; name: string | null } {
  const worktree = worktrees.find((wt) => wt.binding_id === place.worktreeId);
  const parts = place.file === null ? null : labelParts(place.file);
  return {
    lead: parts?.lead ?? null,
    name: parts?.name ?? null,
    pane: paneEntry(place.pane).title,
    where:
      worktree === undefined
        ? place.worktreeId
        : worktreeSummary(worktree).label,
  };
}

export function PlaceSwitcher({
  switcher,
  worktrees,
}: {
  switcher: PlaceSwitcherState;
  worktrees: readonly Worktree[];
}) {
  const { index, places } = switcher;
  if (index === null) return null;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-6">
      <div aria-hidden="true" className="absolute inset-0 bg-background/70" />
      <div
        className="relative flex max-h-full w-full max-w-sm flex-col overflow-hidden rounded-xl border border-border/60 bg-popover shadow-2xl"
        data-testid="place-switcher"
      >
        <p
          className="shrink-0 border-b border-border/60 px-3 py-2 text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
          id="place-switcher-heading"
        >
          Recent places
        </p>
        {/* A plain list, and no `role="listbox"`. A listbox promises focusable
         * options and an owner who can arrive at them; nothing here is
         * focusable by design (see the header), so the role would be a promise
         * the surface cannot keep — which is what biome's
         * `useFocusableInteractive` says too. What the row it would land on has
         * instead is `aria-current`, which is a statement rather than a
         * contract. */}
        <ul
          aria-labelledby="place-switcher-heading"
          className="min-h-0 flex-1 overflow-y-auto p-1.5"
        >
          {places.map((place, at) => (
            <Row
              active={at === index}
              key={`${place.worktreeId}:${place.pane}:${place.file ?? ""}`}
              row={placeRow(place, worktrees)}
              rowIndex={at}
            />
          ))}
          {/* One place is the trail's first morning: the chord was heard, and
           * saying so is the point — "the switcher opened with nowhere to go"
           * and "the chord never arrived" must not look identical
           * (`placeMru.ts`'s stepSwitcher, the day this was learned). */}
          {places.length === 1 ? (
            <li
              className="px-2 py-1.5 text-2xs text-muted-foreground/80"
              data-testid="place-switcher-only-place"
            >
              nowhere else yet — this trail grows as you move between worktrees,
              panes and files
            </li>
          ) : null}
        </ul>
        {/* The gesture, said once. The overlay is the only place he can be told
         * how to leave it, and he is holding the key that put it there. */}
        <p className="shrink-0 border-t border-border/60 px-3 py-1.5 text-2xs text-muted-foreground/80">
          hold ⌃, ⇥ down and ⇧⇥ up — let go to land, Esc to stay
        </p>
      </div>
    </div>
  );
}

function Row({
  active,
  row,
  rowIndex,
}: {
  active: boolean;
  row: ReturnType<typeof placeRow>;
  rowIndex: number;
}) {
  return (
    <li
      aria-current={active ? "true" : undefined}
      // Where a release would land, readable from outside React. The tint says
      // the same thing to a person looking at it, and a test that asserted on a
      // Tailwind class would be asserting on a paint choice.
      data-active={active ? "true" : undefined}
      data-testid={`place-row-${rowIndex}`}
    >
      <div
        className={`flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left ${
          active ? "bg-muted text-foreground" : "text-muted-foreground"
        }`}
      >
        <span
          className="shrink-0 truncate text-xs text-foreground"
          data-testid={`place-row-${rowIndex}-where`}
        >
          {row.where}
        </span>
        <span
          className="shrink-0 text-2xs"
          data-testid={`place-row-${rowIndex}-pane`}
        >
          {row.pane}
        </span>
        {row.name === null ? null : (
          <span
            className="flex min-w-0 flex-1 items-baseline justify-end gap-0 text-2xs"
            data-testid={`place-row-${rowIndex}-file`}
          >
            {/* The directory dims and the basename stays bright — the island's
             * rule for every path it draws. The testid is on the pair, so what
             * a test reads is the whole path rather than the half of it this
             * arrangement happens to paint brighter. */}
            <span className="min-w-0 truncate text-muted-foreground">
              {row.lead}
            </span>
            <span className="shrink-0 text-foreground">{row.name}</span>
          </span>
        )}
      </div>
    </li>
  );
}
