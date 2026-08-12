// A section header inside a pane, as one component in fact
// (vingilot/docs/plans/2026-08-12-polish-the-right-side.md, "Pane headers
// become one component in fact, not five imitations").
//
// One shape: the 3xs-uppercase title on the left — the voice History, the
// Deck, RunDetail and the palette already speak — `text-2xs` meta in the
// middle, an optional control on the right, `px-2 py-1`. The divider under a
// section is the caller's, because which edge a section owns depends on where
// it sits in the pane.

import type * as React from "react";

export function PaneSection({
  control,
  meta,
  title,
}: {
  /** The one control a section may carry, already styled by its owner —
   * History's Reread is the only one so far. */
  control?: React.ReactNode;
  /** What stands beside the title: a count, a headline, a spacer. Rendered
   * as given so the caller can carry its own testid. */
  meta?: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-baseline gap-2 px-2 py-1">
      <h2 className="shrink-0 text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h2>
      {meta ?? <span className="min-w-0 flex-1" />}
      {control}
    </div>
  );
}
