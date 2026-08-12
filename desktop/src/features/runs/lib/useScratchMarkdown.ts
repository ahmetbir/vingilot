// The one scratch markdown buffer, and its life inside the workspace screen
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 4).
//
// What the buffer *is* is `scratchMarkdown.ts`; when it is written is
// `scratchAutosave.ts`; where it lands is `vingilot_scratch`. What is here is the
// part that cannot be pure: the module singleton, the read that happens once, and
// the three doors the owner has into it.
//
// **A module singleton and not React state, which is the whole design.** Task 4
// asks for *one global buffer*, and "global" has to survive more than a
// re-render: it has to survive the overlay closing, the work surface unmounting
// on the way to the landing view, the workspace screen unmounting on a route
// change, and the community remount. React state at any of those levels would
// lose the buffer at whichever level it sat, and — worse — would lose it *with a
// debounce still armed*, which is the one way this feature could throw away
// something he typed. Held here, closing the overlay stops nothing: the timer
// fires a moment later and the write lands into a file that has no idea a
// component went away. The precedent is `diffMode.ts` — module state, a listener
// set, read through `useSyncExternalStore` — and it is deliberately **not** in
// `resetCommunityState()`, because a scratch buffer on this machine has nothing
// to do with which relay he is talking to and holds no community data to leak.
//
// **The read happens once per app run, and it is the *file* that survives
// restarts.** "Restored on open" is the requirement; re-reading on every open
// would be worse than pointless, because a read could then land between a
// debounce and its write and show him the buffer as it was two keystrokes ago.
// So the first open reads, and every later open shows the buffer this module is
// already holding — which is the same text, because nothing else writes that
// file while the app has it open.
//
// **Nothing may be typed into a buffer whose file did not answer.** A refused read
// is not an empty buffer (`scratchClient.ts`'s `ScratchRead`): the file is there
// and this build could not open it, so accepting a keystroke would arm an
// autosave that writes over it. The overlay draws the refusal instead, and the
// next open tries again — a disk that filled up and was cleared recovers without
// him having to know anything happened.
//
// **It never leaves this machine.** `scratchMarkdown.ts`'s header carries the
// argument; the only two calls that ever see this text are `readScratch` and
// `writeScratch`.

import * as React from "react";

import type { AutosaveClock, SaveState } from "@/features/runs/lib/autosave";
import {
  createScratchAutosave,
  type ScratchAutosave,
} from "@/features/runs/lib/scratchAutosave";
import { readScratch, writeScratch } from "@/features/runs/lib/scratchClient";
import { resolveScratchMarkdownKey } from "@/features/runs/lib/scratchMarkdownKeys";
import type { DocumentEditing } from "@/features/runs/lib/useDocument";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

const browserClock: AutosaveClock = {
  clearTimer: (handle) => window.clearTimeout(handle),
  now: () => Date.now(),
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
};

/** Everything about the one buffer, as one value — so a reader cannot see the
 * text of a load that has not finished, or a save state belonging to a different
 * read. */
interface ScratchBuffer {
  text: string;
  state: SaveState;
  /** True once the file has answered and typing is allowed. */
  loaded: boolean;
  /** True while the read is out. Drawn as a wait, which is not an empty state. */
  reading: boolean;
  /** The sentence the backend refused with, or `null`. */
  refusal: string | null;
}

let buffer: ScratchBuffer = {
  loaded: false,
  reading: false,
  refusal: null,
  state: "saved",
  text: "",
};

const listeners = new Set<() => void>();

function publish(next: Partial<ScratchBuffer>): void {
  buffer = { ...buffer, ...next };
  for (const listener of listeners) listener();
}

function subscribeScratchBuffer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function scratchBuffer(): ScratchBuffer {
  return buffer;
}

let machine: ScratchAutosave | null = null;
/** The read in flight, so two opens in the same second are one read. `null`
 * again after a refusal, which is what makes the next open a retry. */
let reading: Promise<void> | null = null;
let boundPageEnding = false;

/** The page's own ending, which no component's cleanup covers.
 *
 * Registered when the machine is created rather than at import, so importing this
 * module does nothing to the window; and never removed, because the thing it is
 * about outlives every component that could remove it. Both events for
 * `useDocument.ts`'s reason — `pagehide` is the page-lifecycle one WebKit fires,
 * `beforeunload` the older one, and `stop()` is idempotent so a teardown that
 * fires both writes once.
 *
 * **A quit is still not covered, and that is what the ceiling is for.** This app
 * ends its process without navigating the webview
 * (`src-tauri/src/shutdown.rs`), so nothing here is promised a turn then;
 * `CEILING_MS` is the honest worst case at a ⌘Q, exactly as it is for a note. */
function bindPageEnding(): void {
  if (boundPageEnding) return;
  boundPageEnding = true;
  const flush = () => machine?.stop();
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", flush);
}

/** Read the file, once. Idempotent and safe to call from any door. */
function loadScratchBuffer(): void {
  if (buffer.loaded || reading !== null) return;
  publish({ reading: true, refusal: null });
  reading = readScratch().then((read) => {
    if (!read.ok) {
      // The file is there and could not be opened. `reading` is cleared so the
      // next open asks again; `loaded` stays false so nothing can be typed.
      reading = null;
      publish({ reading: false, refusal: read.refusal });
      return;
    }
    // `null` is a machine that has never scratched anything, which reads as an
    // empty buffer — the one case where empty really is "nothing there", because
    // the backend said so rather than failing to say anything.
    const text = read.text ?? "";
    machine = createScratchAutosave({
      clock: browserClock,
      onState: (state) => publish({ state }),
      saved: text,
      write: writeScratch,
    });
    bindPageEnding();
    publish({
      loaded: true,
      reading: false,
      refusal: null,
      state: "saved",
      text,
    });
  });
}

function editScratchBuffer(next: string): void {
  // Before the file answered there is nothing to be editing. The overlay does not
  // draw an editor in that state, so this is the second lock rather than the
  // first — and it is the one that holds if a future surface forgets.
  if (!buffer.loaded) return;
  publish({ text: next });
  machine?.edit(next);
}

export interface ScratchMarkdown {
  /** Whether the buffer is on screen. */
  open: boolean;
  /** The buffer as `DocumentEditor` wants it — the same value shape the notes and
   * plan panes hand it, which is what makes this zero new editor code. */
  doc: DocumentEditing;
  /** True while the first read is out. */
  reading: boolean;
  /** Why the buffer cannot be shown, or `null`. */
  refusal: string | null;
  /** Opens, never toggles — the palette's door, for `paletteModel.ts`'s reason: a
   * row called "Scratch markdown" that closed one would be a row whose label lied
   * about what Enter does. */
  show: () => void;
  close: () => void;
  /** ⌥⌘M both ways: a key that opens a surface and then does nothing is a key the
   * owner presses twice looking for the way out. */
  toggle: () => void;
}

export function useScratchMarkdown(): ScratchMarkdown {
  const held = React.useSyncExternalStore(
    subscribeScratchBuffer,
    scratchBuffer,
    scratchBuffer,
  );
  // The one piece of state that is deliberately *not* global: whether the overlay
  // is up. A modal that reappeared because the owner navigated back to this
  // screen would be a modal he did not open, and the buffer it is a window onto
  // has lost nothing by being put away.
  const [open, setOpen] = React.useState(false);

  const show = React.useCallback(() => {
    loadScratchBuffer();
    setOpen(true);
  }, []);
  const close = React.useCallback(() => setOpen(false), []);
  const toggle = React.useCallback(() => {
    if (open) close();
    else show();
  }, [close, open, show]);

  // ⌥⌘M, bound here rather than in the screen for the reason `useSearchChord.ts`
  // binds ⇧⌘F: the chord belongs to the thing it opens. It is on `window` and not
  // on the work surface — deliberately, because this buffer is the one scratch
  // that needs no worktree, so it has to be reachable from the landing view and
  // from the triage board, neither of which mounts `WorkSurface`.
  //
  // The bubble phase, so the overlay's own capture listener claims the chord back
  // once it is open (`ScratchMarkdown.tsx`) and this one never sees it — the same
  // arrangement the scratch shell already has with `WorkSurface`'s listener.
  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const action = resolveScratchMarkdownKey({
        altKey: event.altKey,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action === null) return;
      event.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  const doc: DocumentEditing = React.useMemo(
    () => ({ edit: editScratchBuffer, state: held.state, text: held.text }),
    [held.state, held.text],
  );

  return {
    close,
    doc,
    open,
    reading: held.reading,
    refusal: held.refusal,
    show,
    toggle,
  };
}
