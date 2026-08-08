// A project's document, as a React value
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 3).
//
// Everything that decides anything is next door: `documentStore.ts` says where
// the text lives, `autosave.ts` says when it is written and what the owner is
// told. This hook is only the wiring, and it has exactly one job of its own —
// **calling `stop()` when the editor's life ends**, which is the effect
// cleanup below. A hook that returned the machine and left that to a component
// would be a hook that moved the losing-the-last-keystroke bug rather than
// fixing it.
//
// The text is held here rather than read back out of storage on every render:
// storage is behind a debounce, so a render that read from it would show the
// document as it was 600ms ago while the owner was still typing into it.

import * as React from "react";

import {
  type Autosave,
  type AutosaveClock,
  createAutosave,
  type SaveState,
} from "@/features/runs/lib/autosave";
import { type DocumentKind, documentKey } from "@/features/runs/lib/documents";
import { readDocument, writeDocument } from "@/features/runs/lib/documentStore";

const browserClock: AutosaveClock = {
  clearTimer: (handle) => window.clearTimeout(handle),
  now: () => Date.now(),
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
};

export interface DocumentEditing {
  text: string;
  state: SaveState;
  edit: (next: string) => void;
}

/** `key` is `documentKey(kind, projectPath)`, or `null` on a surface with no
 * project to name — which reads as an empty document that keeps nothing,
 * never as an error. */
export function useDocument(key: string | null): DocumentEditing {
  const [loaded, setLoaded] = React.useState(() => ({
    key,
    text: textFor(key),
  }));
  const [state, setState] = React.useState<SaveState>("saved");
  const machine = React.useRef<Autosave | null>(null);

  // React's own "adjust state when a prop changes" — the read happens during
  // this render rather than in an effect, so there is no frame in which the
  // previous project's notes are on screen under the new project's name. The
  // previous document's outstanding text is not lost by this: the effect below
  // is keyed on `key` too, and its cleanup flushes the old machine, whose
  // `write` is still bound to the old key.
  if (loaded.key !== key) {
    setLoaded({ key, text: textFor(key) });
    setState("saved");
  }

  React.useEffect(() => {
    const autosave = createAutosave({
      clock: browserClock,
      onState: setState,
      saved: textFor(key),
      write: (text) => (key === null ? false : writeDocument(key, text)),
    });
    machine.current = autosave;
    return () => {
      // The unmount door. Every way this editor can end goes through here: the
      // pane being swapped, ⌥⌘B taking the right side away, the project
      // changing, the workspace screen closing.
      autosave.stop();
      machine.current = null;
    };
  }, [key]);

  const edit = React.useCallback((next: string) => {
    setLoaded((prev) => ({ ...prev, text: next }));
    machine.current?.edit(next);
  }, []);

  return { edit, state, text: loaded.text };
}

function textFor(key: string | null): string {
  return key === null ? "" : readDocument(key);
}

/** Every document the open project carries, by kind. */
export type ProjectDocuments = Record<DocumentKind, DocumentEditing>;

/** Open a project's documents **in the workspace**, above the panes that edit
 * them and above the dialogs that act on them.
 *
 * This is where they belong rather than in each pane, and the reason is a bug
 * the pane-owned version could not avoid: the Plan pane held its own copy of
 * the plan while `PlanWorktreeDialog` read the same document back out of
 * storage, which is a debounce behind — so the worktree got briefed with the
 * text the owner had already replaced, and the button that offered the act and
 * the dialog that performed it could disagree about whether the plan was even
 * empty. One reading, held here, is what makes those two the same value.
 *
 * A flush before the read would not have fixed it: it cannot cover what is
 * typed after it, and the dialog's own reading would still be a copy. The live
 * document is passed in instead.
 *
 * Both kinds are opened for the project whether or not a pane is showing
 * either. They cost a state and a timer that never fires until something is
 * edited, and the alternative — opening a document when its pane mounts — is
 * exactly the arrangement that made the plan's text unreachable from anywhere
 * else. */
export function useProjectDocuments(
  projectPath: string | null,
): ProjectDocuments {
  const notes = useDocument(
    projectPath === null ? null : documentKey("notes", projectPath),
  );
  const plan = useDocument(
    projectPath === null ? null : documentKey("plan", projectPath),
  );
  return { notes, plan };
}
