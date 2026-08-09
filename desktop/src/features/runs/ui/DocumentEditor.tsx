// The editing surface both document panes are
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Tasks 3 and 4).
//
// Plain markdown in a box, no ceremony — no toolbar, no preview, no rendering.
// A document is where the owner puts what he would otherwise put in a scratch
// buffer, and every feature added to it is a feature between him and typing.
//
// **It exists as one component because of the promise, not the markup.**
// "Never say saved before storage has taken it" is a claim this app makes to
// the owner about his own writing, and a second copy of the line that makes it
// is a second chance to make it wrongly. The textarea would have been cheap to
// duplicate; `STATE_TEXT` would not.
//
// Everything a pane wants to say for itself — what this document is, where it
// is kept, what may be done with it — is `scope` and `children`, which the
// pane owns.

import type * as React from "react";

import { DEBOUNCE_MS, type SaveState } from "@/features/runs/lib/autosave";
import { MAX_DOCUMENT_CHARS } from "@/features/runs/lib/documents";
import type { DocumentEditing } from "@/features/runs/lib/useDocument";

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
  doc: DocumentEditing;
  /** Prefix for this pane's test ids — `notes` gives `notes-editor`,
   * `notes-state`, `notes-full`. The pane's own name, so a spec written
   * against one document pane cannot silently pass against the other. */
  testId: string;
  placeholder: string;
  /** The line under the state: what this document is and where it is kept.
   * Every word of it is the pane's, because the promise differs — a note is
   * private to this machine, a plan is about to be copied into a checkout. */
  scope: React.ReactNode;
  /** Whatever the pane puts between the editor and its state line — the Plan
   * pane's action lives here. */
  children?: React.ReactNode;
}

export function DocumentEditor({
  children,
  doc,
  placeholder,
  scope,
  testId,
}: Props) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-3"
      data-testid={`pane-${testId}`}
    >
      <textarea
        className="min-h-0 w-full flex-1 resize-none rounded-lg border border-border/60 bg-background px-3 py-2 font-mono text-sm outline-none focus:border-border"
        data-testid={`${testId}-editor`}
        maxLength={MAX_DOCUMENT_CHARS}
        onChange={(event) => doc.edit(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        value={doc.text}
      />
      {children}
      <div className="flex shrink-0 flex-col gap-0.5">
        <p
          className={`text-2xs ${STATE_CLASS[doc.state]}`}
          data-testid={`${testId}-state`}
        >
          {STATE_TEXT[doc.state]}
        </p>
        {/* The cap is on the textarea, so past it a keystroke simply does not
            arrive and a long paste is cut — both silently, which is the same
            quiet loss this pane exists to avoid. It is worth a line only when
            it is about to bite. */}
        {doc.text.length >= MAX_DOCUMENT_CHARS ? (
          <p
            className="text-sm text-amber-600 dark:text-amber-500"
            data-testid={`${testId}-full`}
          >
            this document is full at {MAX_DOCUMENT_CHARS} characters — nothing
            more typed or pasted here is taken.
          </p>
        ) : null}
        <p
          className="truncate font-mono text-2xs text-muted-foreground/70"
          data-testid={`${testId}-scope`}
        >
          {scope}
        </p>
      </div>
    </div>
  );
}
