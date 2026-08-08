// Notes: the first pane on the document substrate
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 3).
//
// Plain markdown in a box, no ceremony — no toolbar, no preview, no rendering.
// A note is where the owner puts what he would otherwise put in a scratch
// buffer, and every feature added to it is a feature between him and typing.
//
// Two things are on screen besides the text, and both are promises rather than
// decoration: **what state the document is in** (never "saved" before storage
// has taken it — `autosave.ts`), and **where it is kept**, because a note that
// reads as belonging to the project would be expected to travel with the
// project, and this one does not: it is in this app's storage on this machine.

import { DEBOUNCE_MS, type SaveState } from "@/features/runs/lib/autosave";
import { documentKey, MAX_DOCUMENT_CHARS } from "@/features/runs/lib/documents";
import { useDocument } from "@/features/runs/lib/useDocument";

const STATE_CLASS: Record<SaveState, string> = {
  failed: "text-destructive",
  saved: "text-muted-foreground",
  unsaved: "text-amber-600 dark:text-amber-500",
};

const STATE_TEXT: Record<SaveState, string> = {
  failed:
    "not saved — this app could not write to its own storage, so what is on screen is all there is.",
  saved: "saved",
  unsaved: `unsaved — written ${DEBOUNCE_MS / 1000}s after you stop typing`,
};

interface Props {
  /** The project these notes belong to, by its path on disk. `null` only on a
   * surface with no project — the pane's availability rule refuses that case
   * first, so the editor here is a fallback rather than a state to design
   * for. */
  projectPath: string | null;
}

export function NotesPane({ projectPath }: Props) {
  const doc = useDocument(
    projectPath === null ? null : documentKey("notes", projectPath),
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-3"
      data-testid="pane-notes"
    >
      <textarea
        className="min-h-0 w-full flex-1 resize-none rounded-lg border border-border/60 bg-background px-3 py-2 font-mono text-sm outline-none focus:border-border"
        data-testid="notes-editor"
        maxLength={MAX_DOCUMENT_CHARS}
        onChange={(event) => doc.edit(event.target.value)}
        placeholder="notes for this project — markdown, kept as you type."
        spellCheck={false}
        value={doc.text}
      />
      <div className="flex shrink-0 flex-col gap-0.5">
        <p
          className={`text-2xs ${STATE_CLASS[doc.state]}`}
          data-testid="notes-state"
        >
          {STATE_TEXT[doc.state]}
        </p>
        {/* The cap is on the textarea, so past it a keystroke simply does not
            arrive and a long paste is cut — both silently, which is the same
            quiet loss this pane exists to avoid. It is worth a line only when
            it is about to bite. */}
        {doc.text.length >= MAX_DOCUMENT_CHARS ? (
          <p
            className="text-2xs text-amber-600 dark:text-amber-500"
            data-testid="notes-full"
          >
            this note is full at {MAX_DOCUMENT_CHARS} characters — nothing more
            typed or pasted here is taken.
          </p>
        ) : null}
        <p
          className="truncate font-mono text-3xs text-muted-foreground/70"
          data-testid="notes-scope"
        >
          {projectPath === null
            ? "no project"
            : `notes for ${projectPath}, kept in this app on this machine — not in the project, and not on a server.`}
        </p>
      </div>
    </div>
  );
}
