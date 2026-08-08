// The document substrate: what a project's own markdown *is*, before anything
// decides where to keep it (vingilot/docs/plans/2026-08-08-palette-and-
// documents.md, Task 3).
//
// **A document is per project, not per worktree, and it is keyed by the
// project's path.** The path is what the project *is* on this machine; the
// `Repo.id` beside it is a workspace row's name for it, minted from that path
// and suffixed on collision (`repoChoice.ts`'s `uniqueRepoId`), so a project
// removed and added back can come back as `vingilot-2` and would find an empty
// note where the owner left half a page. The path survives that. It also means
// two workspaces pointed at the same checkout read the same notes, which is
// the answer the owner would expect from "the notes for this project".
//
// `kind` is in the key because Task 4's Plan pane is the same shape as this
// one — a document a project carries, edited in a pane, persisted, restored.
// Two kinds under one key space rather than two stores, so a plan and a note
// share these caps and this parser instead of drifting into two of each.
//
// Pure: shapes, the key, the parser and the caps. `documentStore.ts` puts it
// in storage and says why there; `autosave.ts` decides when a write happens.

/** The documents a project can carry. `plan` is Task 4's and is not on the
 * registry yet — it is named here because the key space is shared and a kind
 * invented later would be a kind that could collide with a stored one. */
export type DocumentKind = "notes" | "plan";

export interface ProjectDocument {
  text: string;
  /** Epoch milliseconds of the write that produced this text, from the
   * writer's clock. Used for the eviction order below, and it is the only
   * thing that makes a stale entry identifiable at all. */
  savedAt: number;
}

/** Keyed by `documentKey`. A flat record rather than a nested one so a single
 * document can be read and written without reasoning about a project's whole
 * shelf. */
export type DocumentLibrary = Record<string, ProjectDocument>;

/** How long one document may be. **Enforced at the editing surface**
 * (`NotesPane.tsx` puts it on the textarea's `maxLength`), never here: a cap
 * applied on the way into storage could only be a truncation, and truncating
 * is losing the work this whole task exists to keep. A keystroke that cannot
 * be stored must not be accepted in the first place.
 *
 * 40 000 characters is roughly a 15-page note. `MAX_DOCUMENTS` of them is
 * under a megabyte against a webview's ~5 MB origin quota, which leaves room
 * for the ask threads and the layouts sharing it. */
export const MAX_DOCUMENT_CHARS = 40_000;

/** How many documents are kept at all. Past this the least recently saved one
 * goes — a note about a project the owner removed months ago is not worth the
 * quota that loses the one he is typing into.
 *
 * **It is 24 because there are two kinds, not because 24 is a nicer number.**
 * It was 12, chosen as "twelve projects' notes" when notes were the only
 * document. The Plan pane made every project able to hold two, which silently
 * turned the same 12 into *six* projects — and the eviction that followed
 * would not have been a stale note going, it would have been a plan going to
 * make room for a note. This is the one place the substrate was shaped around
 * its first tenant, and this is the shape it should have had.
 *
 * The arithmetic still holds: 24 × 40 000 characters is ~960 KB against a
 * webview's ~5 MB origin quota, worst case, with every document at its cap —
 * and a 40 000-character document is fifteen pages. */
export const MAX_DOCUMENTS = 24;

export function documentKey(kind: DocumentKind, projectPath: string): string {
  // NUL, because a project path can contain anything a filesystem allows —
  // including a colon — and a separator that can appear in the value is a
  // separator two different documents can collide on.
  return `${kind}\u0000${projectPath}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a stored library. Missing, unparseable or half-readable storage reads
 * as whatever *is* readable — never a throw, and never an empty library
 * standing in for a failed parse of one entry (an empty read is "no answer",
 * not "nothing there"). */
export function parseLibrary(raw: string | null): DocumentLibrary {
  if (raw === null || raw === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const library: DocumentLibrary = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!isRecord(value)) continue;
    const text = value.text;
    if (typeof text !== "string") continue;
    library[key] = {
      savedAt: typeof value.savedAt === "number" ? value.savedAt : 0,
      text,
    };
  }
  return library;
}

/** The library trimmed to `MAX_DOCUMENTS`, oldest save evicted first.
 *
 * `protect` is the document the write that triggered this trim was for, and it
 * is never evicted: the entry that made the library too long must not be the
 * entry that pays for it, or a write would report success having thrown itself
 * away. */
export function capLibrary(
  library: DocumentLibrary,
  protect: string | null = null,
): DocumentLibrary {
  const keys = Object.keys(library);
  if (keys.length <= MAX_DOCUMENTS) return library;
  const kept = keys
    .sort((a, b) => {
      if (a === protect) return -1;
      if (b === protect) return 1;
      return (library[b]?.savedAt ?? 0) - (library[a]?.savedAt ?? 0);
    })
    .slice(0, MAX_DOCUMENTS);
  const capped: DocumentLibrary = {};
  for (const key of kept) {
    const entry = library[key];
    if (entry !== undefined) capped[key] = entry;
  }
  return capped;
}

/** The library with one document's text replaced.
 *
 * Emptying a document removes its entry rather than storing an empty string:
 * a note cleared to nothing is a note the owner no longer has, and keeping the
 * row would spend a slot of `MAX_DOCUMENTS` on it. Reading it back gives `""`
 * either way, so nothing downstream can tell the difference. */
export function putDocument(
  library: DocumentLibrary,
  key: string,
  text: string,
  now: number,
): DocumentLibrary {
  if (text === "") {
    const { [key]: _dropped, ...rest } = library;
    return rest;
  }
  return capLibrary({ ...library, [key]: { savedAt: now, text } }, key);
}

/** One document's text, or `""` for one that was never written. */
export function documentText(library: DocumentLibrary, key: string): string {
  return library[key]?.text ?? "";
}
