// The React binding for `lib/diffMode.ts` — kept separate for the reason every
// `use*.ts` in this directory is: the model is testable under plain
// `node --test`, and the hook is the only part that needs a renderer.
//
// `useSyncExternalStore` rather than a context, because the two panes that read
// this flag (Diff and History) are never in the same subtree — they are two
// entries of `paneRegistry`, mounted in one slot or the other — so a provider
// would have to live above the whole work surface to serve a preference that
// concerns two leaves of it.

import * as React from "react";

import {
  type DiffMode,
  getDiffMode,
  serverDiffMode,
  subscribeDiffMode,
} from "@/features/runs/lib/diffMode";

/** The chosen mode. Not the *effective* one — `effectiveDiffMode` needs the
 * pane's width and only the pane has that. */
export function useDiffMode(): DiffMode {
  return React.useSyncExternalStore(
    subscribeDiffMode,
    getDiffMode,
    serverDiffMode,
  );
}
