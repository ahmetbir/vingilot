// Notes: the first pane on the document substrate
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 3).
//
// The editor, the autosave state and the character cap are `DocumentEditor`,
// shared with the Plan pane. What is left here is the only thing that is a
// note's rather than a document's: **where it is kept**, said in as many
// words, because a note that reads as belonging to the project would be
// expected to travel with the project, and this one does not — it is in this
// app's storage on this machine.

import type { DocumentEditing } from "@/features/runs/lib/useDocument";
import { DocumentEditor } from "@/features/runs/ui/DocumentEditor";

interface Props {
  /** This project's notes, opened by the workspace (`useProjectDocuments`).
   * Handed in rather than opened here so there is one reading of the document
   * per project, whichever surface is looking at it. */
  doc: DocumentEditing;
  /** The project these notes belong to, by its path on disk. `null` only on a
   * surface with no project — the pane's availability rule refuses that case
   * first, so the editor here is a fallback rather than a state to design
   * for. */
  projectPath: string | null;
}

export function NotesPane({ doc, projectPath }: Props) {
  return (
    <DocumentEditor
      doc={doc}
      placeholder="notes for this project — markdown, kept as you type."
      scope={
        projectPath === null
          ? "no project"
          : `notes for ${projectPath}, kept in this app on this machine — not in the project, and not on a server.`
      }
      testId="notes"
    />
  );
}
