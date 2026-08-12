// The escape hatch, wired: one probe for the whole app, the remembered pick,
// and the call that opens a file
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 1).
//
// Every decision is somewhere else — `editors.ts` says what a click should do
// and holds the pick, `editorClient.ts` is the two commands. What is left here
// is the part that cannot be tested without React, plus the one thing a pure
// module must not own: **the probe is asked once for the whole app run.**
//
// **Once, not once per button.** Four surfaces draw this control and a Diff
// pane draws one per changed file, so a probe per component would be dozens of
// `fork`+`exec`s the first time a worktree with forty files is opened. The
// backend caches too (`vingilot_editor`'s `OnceLock`) — this cache is the one
// that keeps the *IPC* from happening, which is the one that would be visible.
//
// The store shape is `diffMode.ts`'s and is deliberately not community-scoped:
// which editors are installed on this machine has nothing to do with which
// relay is being talked to.

import * as React from "react";

import {
  type EditorProbe,
  probeEditors,
} from "@/features/runs/lib/editorClient";
import {
  type EditorAction,
  editorAction,
  getChosenEditor,
  subscribeChosenEditor,
} from "@/features/runs/lib/editors";

/** The answer, once it has come back. `null` while it has not — which
 * `editorAction` reads as "no editors yet" and words as a wait, never as a
 * refusal about this machine. */
let probed: EditorProbe | null = null;
let asking: Promise<EditorProbe> | null = null;
const listeners = new Set<() => void>();

function tell(): void {
  for (const listener of listeners) listener();
}

/** Ask, at most once. A second caller during the flight joins the first. */
function ensureProbe(): void {
  if (probed !== null || asking !== null) return;
  asking = probeEditors();
  void asking.then((answer) => {
    probed = answer;
    asking = null;
    tell();
  });
}

/** Drop the cached probe. Test-only: nothing in the product re-probes, because
 * an editor installed while the app is open is a restart away and pretending
 * otherwise would mean a `fork`+`exec` on a timer forever. */
export function resetEditorProbeForTests(): void {
  probed = null;
  asking = null;
  tell();
}

/** What the button at this moment should do. */
export function useEditorAction(): EditorAction {
  const [, bump] = React.useReducer((count: number) => count + 1, 0);
  React.useEffect(() => {
    ensureProbe();
    listeners.add(bump);
    const stopChoice = subscribeChosenEditor(bump);
    return () => {
      listeners.delete(bump);
      stopChoice();
    };
  }, []);
  return editorAction(
    probed?.editors ?? [],
    getChosenEditor(),
    probed?.refusal ?? null,
  );
}
