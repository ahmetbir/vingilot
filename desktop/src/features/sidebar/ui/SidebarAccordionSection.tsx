// One member of the sidebar's single-open accordion
// (vingilot/docs/plans/2026-08-14-pane-nav-absorb.md, Task 1).
//
// **A new, small, fork-owned primitive — deliberately NOT a genericized
// `SidebarSection`.** That component has the same collapse/chevron contract
// but is hard-typed to `items: Channel[]` with channel rendering throughout;
// retrofitting it generic on its second consumer is the premature abstraction
// "three strikes" warns against, and it would widen the blast radius of a
// component the whole channel list depends on (plan §2.4). This file knows
// nothing about files, commits, worktrees or channels: a sticky header, the
// ARIA pair, and a body.
//
// **Single-open coordination lives one level up, not here.** The parent holds
// one `openId` and every member reports clicks to it through `onOpenChange`;
// `resolveAccordionOpen` is the whole of the decision and is exported so the
// unit test can hold it without a DOM. Clicking the open member's own header
// is a no-op — the accordion keeps exactly one member expanded, always, which
// is also what makes "no layout jump" true by construction (plan §4): the
// only motion that can ever happen is the one member the owner clicked.
//
// **The collapsed body is hidden, never unmounted.** State inside it — a
// tree's expanded directories, a list's scroll — must survive being collapsed
// and come back intact, not remount empty (Task 1's second checkbox). The
// `hidden` attribute keeps the DOM alive and out of both the layout and the
// accessibility tree.
//
// **Sticky, and only one sticky ever matters at a time** (plan §2.3): each
// header is `sticky top-0` within the sidebar's one scroll container, and
// because only one body is ever expanded, the VS Code problem — N sticky
// headers pinning in a stack — never arises. If multiple-open ever becomes an
// ask, a real stacking-sticky primitive has to be built and proven at 800px;
// that is explicitly not this file.

import * as React from "react";

/** The single-open rule, held apart from the DOM so it has a test that cannot
 * lie: clicking a collapsed member opens it (and thereby collapses whichever
 * was open, since the parent holds one id); clicking the open member keeps it
 * open — the accordion never has zero members expanded. */
export function resolveAccordionOpen(openId: string, clicked: string): string {
  if (clicked === openId) return openId;
  return clicked;
}

export function SidebarAccordionSection({
  children,
  count,
  id,
  onOpenChange,
  openId,
  title,
}: {
  children: React.ReactNode;
  /** An optional row count for the collapsed header, so a shut member still
   * says how much is behind it. `null` for "no count to claim". */
  count?: number | null;
  id: string;
  onOpenChange: (openId: string) => void;
  openId: string;
  title: string;
}) {
  const expanded = openId === id;
  const bodyId = `sidebar-accordion-body-${id}`;
  // **Mounted on first open, never unmounted after.** Two halves, both
  // deliberate: a member the owner has never opened must not spend anything
  // (the Files/History bodies fire git reads on mount — eager mounting would
  // run them for members he is not looking at); a member he HAS opened keeps
  // its DOM alive under `hidden` when collapsed, so tree expansions, scroll
  // and cursor survive the round trip (Task 1's second checkbox).
  const [mounted, setMounted] = React.useState(expanded);
  if (expanded && !mounted) setMounted(true);
  return (
    <section
      className="flex w-full flex-col"
      data-open={expanded}
      data-testid={`sidebar-accordion-${id}`}
    >
      <button
        aria-controls={bodyId}
        aria-expanded={expanded}
        className="sticky top-0 z-10 flex h-8 w-full shrink-0 items-center gap-1.5 border-b border-border/40 bg-sidebar px-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid={`sidebar-accordion-header-${id}`}
        onClick={() => onOpenChange(resolveAccordionOpen(openId, id))}
        type="button"
      >
        <span aria-hidden="true" className="w-3 shrink-0 text-center">
          {expanded ? "▾" : "▸"}
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {count === undefined || count === null ? null : (
          <span className="shrink-0 text-2xs tabular-nums">{count}</span>
        )}
      </button>
      {/* Hidden, not unmounted, once it has been opened: the member's own
          state survives a collapse. */}
      <div
        className="flex w-full flex-col"
        data-testid={bodyId}
        hidden={!expanded}
        id={bodyId}
      >
        {mounted ? children : null}
      </div>
    </section>
  );
}
