// Where a project's documents live between app runs
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 3).
//
// **localStorage, agreeing with `askStore.ts`** — and the agreement is the
// decision, so here is what it was weighed against.
//
// - *The coordinator's workspace state*, where `repos` and `deck.pins` already
//   live, was the real alternative: it is CAS-versioned, so it could detect a
//   conflicting write instead of losing one. It is refused for three reasons,
//   and the first alone decides it. **The coordinator can be down** — this
//   screen renders a `reachable` flag precisely because it often is — and a
//   note pane that will not keep a note because a local service is not running
//   is not a note pane. Second, workspace state is read-modify-write of one
//   blob: a document rewritten every few seconds would bump the revision under
//   whoever else is writing pins, turning an autosave into a source of 409s
//   for unrelated features. Third, it buys no sync — the coordinator is a
//   process on 127.0.0.1, not a server, so "it would follow the project across
//   machines" is not true of it either.
// - *A file on disk* — inside the project it would show up in the owner's `git
//   status` (a note is not a commit), and outside it would need a new Rust
//   command and a new directory this app decided to own without being asked.
//   Task 4 does write a plan into a worktree, but that is an explicit act with
//   a name, not where the document lives while it is being typed.
//
// So: the same origin-scoped storage the ask threads, the pane layout and the
// terminal tabs already use, injectable so `node --test` can pass a shim.
//
// **Two windows editing one project: last write wins, whole document.** There
// is no merge and no cross-window notification — this store does not listen
// for `storage` events, because a second window's write arriving into an
// editor mid-sentence would replace what the owner is typing, which is a worse
// failure than the one it fixes. Each window reads the document when its pane
// mounts and writes the whole of it when its own autosave fires, so the later
// write wins entirely: paragraphs typed in the other window between its mount
// and this write are gone, not merged. The exposure is exactly "both windows
// have the Notes pane open on the same project and both are being typed into",
// which for one owner on one machine is rare and, when it happens, is visible
// — the losing window still shows its own text until it is remounted.
//
// **A write that did not happen is never reported as saved.** `writeDocument`
// returns whether storage took it, and a build with no `localStorage` at all
// answers `false` rather than silently succeeding into a no-op: `autosave.ts`
// turns that into a "not saved" the owner can see. This is the one place the
// ask store's swallowing pattern is wrong for the case — a lost answer is
// annoying, a lost note is the owner's own writing.

import {
  type DocumentLibrary,
  documentText,
  parseLibrary,
  putDocument,
} from "./documents.ts";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Versioned for the reason `paneStore.ts` gives: a shape change gets a new
 * key rather than a migration, so an older build reading a newer library finds
 * nothing rather than something it half-understands. */
const DOCUMENTS_KEY = "vingilot-documents.v1";

/** `null`, not a no-op shim: a store that accepts writes and keeps nothing
 * would let this pane tell the owner his note is saved. */
function defaultStorage(): StorageLike | null {
  return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
}

export function readLibrary(
  storage: StorageLike | null = defaultStorage(),
): DocumentLibrary {
  if (storage === null) return {};
  try {
    return parseLibrary(storage.getItem(DOCUMENTS_KEY));
  } catch {
    // A webview that refuses reads (private mode, a revoked origin) has told
    // us nothing about what is stored — which is the same position as an
    // unparseable read, and is not an error worth costing a render for.
    return {};
  }
}

/** One document's text, or `""` when there is none — which is also what a
 * storage this build cannot read answers, because it does not know. */
export function readDocument(
  key: string,
  storage: StorageLike | null = defaultStorage(),
): string {
  return documentText(readLibrary(storage), key);
}

/** Write one document. **Returns whether it landed** — the caller must not
 * claim otherwise. */
export function writeDocument(
  key: string,
  text: string,
  now: number = Date.now(),
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(
      DOCUMENTS_KEY,
      JSON.stringify(putDocument(readLibrary(storage), key, text, now)),
    );
    return true;
  } catch {
    return false;
  }
}
