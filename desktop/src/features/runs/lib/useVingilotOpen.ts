// The door in, wired: what happens when `vingilot <file>` is run in a terminal
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 1).
//
// The shim asks the OS to open `buzz://open?arg=…&cwd=…`; `deep_link.rs` hands
// it to `vingilot_shim`, which resolves it against the filesystem and emits
// either `vingilot-open` (a canonical path, a line, and whether it is a
// directory) or `vingilot-open-refused` (a sentence). This hook is the other
// end of those two events.
//
// **Where each answer lands is `openTarget.ts`'s decision, and it is pure.**
// This file listens, builds the list of known places from what the screen
// already holds, and calls the same four handlers the buttons and the palette
// call. Nothing here is a second implementation of selecting a project, landing
// on a worktree, or showing a file — `filesTarget.requestFile` is the one door
// into the viewer and this is its fourth caller, not its second landing.
//
// **The window is already raised by the time this runs** (`activate_main_window`
// in the deep-link arm), which is why nothing here touches window state: the
// app being in front is the OS's job and it has already done it.

import * as React from "react";
import { listen } from "@tauri-apps/api/event";

import { requestFile } from "@/features/runs/lib/filesTarget";
import {
  type KnownPlace,
  type OpenRequest,
  type OpenResolution,
  resolveOpen,
  unknownPlaceSentence,
} from "@/features/runs/lib/openTarget";

export interface VingilotOpenHandlers {
  /** The places this workspace knows, most recently rebuilt. Read through a ref
   * so the listener is registered once for the life of the screen rather than
   * re-registered on every 2s poll — a re-register drops events that arrive in
   * the gap, and the gap is exactly when a terminal command lands. */
  places: readonly KnownPlace[];
  selectRepo: (repoId: string) => void;
  selectWorktree: (bindingId: string) => void;
  /** Bring the Files pane forward. Called after the target is filed, which is
   * the order `RunsScreen`'s own `show-file` act already uses: the pane reads
   * what is pending on mount, so filing first is what makes a request for a
   * pane that is not yet on screen work at all. */
  showFiles: () => void;
  /** Open the add-project flow for a directory in no project. */
  addProject: (directory: string) => void;
  /** Say something that did not work. One sentence, the backend's own words
   * where there are any — `open` returned to the shim long before this, so a
   * refusal printed in the terminal would be a refusal nobody sees. */
  report: (sentence: string) => void;
}

/** Act on one resolved request. Exported so the acting and the listening are
 * separable: a spec can drive this with a fabricated payload, and the listener
 * below stays three lines of Tauri. */
export function actOnOpen(
  resolution: OpenResolution,
  on: VingilotOpenHandlers,
): void {
  switch (resolution.type) {
    case "project":
      on.selectRepo(resolution.repoId);
      return;
    case "worktree":
      on.selectRepo(resolution.repoId);
      on.selectWorktree(resolution.bindingId);
      return;
    case "file":
      on.selectRepo(resolution.repoId);
      // A file of a project whose worktrees are not listed yet has no binding
      // to select — the project's own directory is the checkout, and
      // `shouldLand` will match on the path.
      if (resolution.bindingId !== null) {
        on.selectWorktree(resolution.bindingId);
      }
      requestFile({
        line: resolution.line,
        path: resolution.path,
        worktree: resolution.worktree,
      });
      on.showFiles();
      return;
    case "unknown":
      // Both: the sentence says why nothing opened, and the flow that would fix
      // it is put in front of him. Opening the dialog alone would answer a
      // question he did not ask.
      on.report(unknownPlaceSentence(resolution.directory));
      on.addProject(resolution.directory);
      return;
  }
}

/** Whatever came over the bridge, as an `OpenRequest`, or `null`.
 *
 * Narrowed rather than cast: this payload names a path the app is about to read
 * and a project it is about to select, and a malformed one must land as nothing
 * rather than as `undefined` reaching `resolveOpen`. */
export function readOpenRequest(payload: unknown): OpenRequest | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.path !== "string" || value.path === "") return null;
  const line = typeof value.line === "number" ? value.line : null;
  return {
    directory: value.directory === true,
    // Line 0 is refused on the Rust side; here it is simply not a line, for
    // `filesTarget.ts`'s reason — `null` is the top of the file.
    line: line !== null && line > 0 ? line : null,
    path: value.path,
  };
}

export function useVingilotOpen(handlers: VingilotOpenHandlers): void {
  const held = React.useRef(handlers);
  held.current = handlers;

  React.useEffect(() => {
    // Registered once. Both `listen` calls answer with an unlisten function
    // that arrives asynchronously, so an unmount before the promise settles has
    // to be remembered rather than raced — the `stopped` flag is what makes
    // this safe under React's development double-mount.
    let stopped = false;
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => {
      if (stopped) {
        stop();
        return;
      }
      stops.push(stop);
    };

    void listen<unknown>("vingilot-open", (event) => {
      const request = readOpenRequest(event.payload);
      if (request === null) {
        held.current.report(
          "a vingilot command arrived in a shape this build cannot read. Nothing was opened.",
        );
        return;
      }
      actOnOpen(resolveOpen(request, held.current.places), held.current);
    }).then(keep);

    void listen<unknown>("vingilot-open-refused", (event) => {
      held.current.report(
        typeof event.payload === "string"
          ? event.payload
          : "a vingilot command could not be resolved.",
      );
    }).then(keep);

    return () => {
      stopped = true;
      for (const stop of stops) stop();
    };
  }, []);
}
