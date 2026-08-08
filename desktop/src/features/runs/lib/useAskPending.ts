// The one turn in flight, as a React value
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 2).
//
// Both surfaces that can start a turn — the palette's ask mode and the Agent
// pane's Run button — need the same answer to "is one already running?", and
// each holding its own copy is how they came to disagree: the pane's Run was
// component-local, so the palette accepted a question while the pane had an
// adapter out. This hook is the only way either of them reads it.
//
// `useSyncExternalStore` rather than an effect-and-setState: the guard is read
// during render to decide whether Enter or Run does anything, and a value that
// arrives one render late is a value that says "nothing is running" for the
// one render in which a second turn can be started.
//
// The snapshot is the store's own object, replaced only when a turn starts or
// settles, so it is reference-stable between notifications — which is what
// `useSyncExternalStore` requires of it.

import * as React from "react";

import {
  type AskInFlight,
  pendingAsk,
  subscribeToAsks,
} from "@/features/runs/lib/askStore";

export function useAskPending(): AskInFlight | null {
  return React.useSyncExternalStore(subscribeToAsks, pendingAsk, pendingAsk);
}
