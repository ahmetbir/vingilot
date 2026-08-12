// The scratch markdown buffer, over the work surface
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 4).
//
// **The scratch shell's sibling, and the frame is deliberately the same frame.**
// Same absolute overlay inside the same relative box, same scrim, same header
// shape — glyph, name, the path it is kept at, a × — same footer carrying the
// claim this surface makes about persistence. Two scratches that looked different
// would be two features; the whole point of Task 4 is that this is the other half
// of a gesture he already has. The one visual difference is the shadow:
// `shadow-xl` rather than the shell's `shadow-2xl`, because the design vocabulary
// (`2026-08-12-polish-the-right-side.md`) names `shadow-lg`/`shadow-xl` as the
// ceiling and it is law for anything drawn after it.
//
// **Drawn over the surface, not in it**, for `ScratchTerminal.tsx`'s reason and
// it applies here unchanged: under tmux the sole attached client's size *is* the
// session's size, so a layout that squeezed the persistent terminals to make room
// would reflow every one of the owner's live shells and re-wrap their scrollback.
// Nothing here unmounts, remeasures or resizes a terminal.
//
// **The editor is `DocumentEditor`, exactly as the notes and plan panes use it.**
// Same textarea, same character cap, same three save-state sentences, same
// promise that "saved" is never said before storage has taken it. What is this
// buffer's rather than a document's is only the two lines it says for itself:
// where it is kept, and how far it goes. Zero new editor code, which was the
// requirement and is also the reason the state line is trustworthy — there is one
// implementation of that sentence in the app.
//
// **What it says about itself.** The header names the file, because a buffer whose
// file you have to guess at is a buffer you cannot open in your own editor. The
// footer carries `SCRATCH_MARKDOWN_PRIVACY`, printed verbatim beside the sentence
// it must not be confused with — the shell's footer, one chord away, says
// *nothing is kept*.
//
// **The keyboard, while it is open.** A container-scoped capture listener, not a
// window one — `ScratchTerminal.tsx`'s argument, and here it also settles the
// palette: with ⌘K open over this, focus is in the palette's field, outside this
// subtree, so this hears nothing and the palette keeps its keys. What is stopped
// is exactly what the surfaces underneath would have acted on
// (`resolveScratchMarkdownShield`), so the app's global chords still work and —
// the part that matters for a text box — ⌘A, ⌘C, ⌘V and ⌘Z are the default menu's
// and are never touched.
//
// **Escape closes, and that is the one behaviour the two scratches do not share.**
// A terminal owns Escape; a textarea does not, and every modal editor he has used
// closes on it. The argument is in `scratchMarkdownKeys.ts`.
//
// **⌘W is deliberately not a fourth door.** `closeRequest.ts` resolves a close
// request against a fixed stack whose order the cheatsheet prints back to the
// owner as a promise; inserting a surface into it is a change to that promise and
// to a tested guarantee about a different feature. This buffer already has four
// ways out on screen or under the fingers — the chord, Escape, the ×, the scrim —
// so with nothing else stacked ⌘W keeps doing what the sheet says it does, which
// is minimize the window.

import * as React from "react";

import {
  SCRATCH_MARKDOWN_PATH,
  SCRATCH_MARKDOWN_PLACEHOLDER,
  SCRATCH_MARKDOWN_PRIVACY,
  SCRATCH_MARKDOWN_SCOPE,
} from "@/features/runs/lib/scratchMarkdown";
import { resolveScratchMarkdownShield } from "@/features/runs/lib/scratchMarkdownKeys";
import type { ScratchMarkdown as ScratchMarkdownBuffer } from "@/features/runs/lib/useScratchMarkdown";
import { DocumentEditor } from "@/features/runs/ui/DocumentEditor";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

interface Props {
  buffer: ScratchMarkdownBuffer;
}

/** Where focus was when this opened, given back when it closes — so closing does
 * not leave a keyboard owner on `<body>`, with the whole document to Tab through
 * to get anywhere.
 *
 * **Its own component, and it must stay above the editor in this tree**, for the
 * reason `ScratchTerminal.tsx` spells out: passive effects run child-first, so a
 * capture taken in this overlay's parent would run after the editor's own focus
 * effect and would record the textarea — an element removed with the overlay, so
 * the restore would silently do nothing. It is a child here and the focus is
 * taken by the *parent's* effect, which runs after every child's, so the order
 * holds by construction rather than by luck.
 *
 * It also settles the palette's door: `run()` closes the palette and opens this
 * in one commit, and every passive cleanup in a commit runs before every passive
 * mount effect in it — so by the time this reads `document.activeElement` the
 * palette has already put the keyboard back on the control he opened it from,
 * which is the element this buffer is really taking it from.
 *
 * **A return, not a theft.** Only when the keyboard would otherwise be left
 * nowhere. Focus that has already moved to something real, because the close was
 * a click on a worktree in the nav, is the owner's and is left alone. */
function FocusReturn({
  overlayRef,
}: {
  overlayRef: React.RefObject<HTMLDivElement | null>;
}) {
  React.useEffect(() => {
    const held = document.activeElement;
    // Read now: a ref is cleared as its subtree is deleted, and this closure has
    // to be able to ask "is the keyboard inside the thing that is going".
    const overlay = overlayRef.current;
    return () => {
      const focused = document.activeElement;
      const stranded =
        focused === null ||
        focused === document.body ||
        (overlay !== null && overlay.contains(focused));
      if (!stranded) return;
      if (held instanceof HTMLElement && held.isConnected) held.focus();
    };
  }, [overlayRef]);
  return null;
}

export function ScratchMarkdown({ buffer }: Props) {
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  const onClose = buffer.close;

  React.useEffect(() => {
    const overlay = overlayRef.current;
    if (overlay === null) return;
    function handleKeyDown(event: KeyboardEvent) {
      const action = resolveScratchMarkdownShield({
        altKey: event.altKey,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action === null) return;
      // Propagation only for a shield: the default action is left alone, so a
      // chord this surface merely hides from the panes underneath still does
      // whatever the browser or the editor would have done with it.
      event.stopPropagation();
      if (action.type === "close") {
        event.preventDefault();
        onClose();
      }
    }
    overlay.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      overlay.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onClose]);

  // The keyboard goes into the buffer he just opened, once, on the way in.
  //
  // Through the DOM rather than through a prop on `DocumentEditor`: that
  // component is shared with two panes that must *not* steal focus when they
  // mount (a pane appearing beside the terminal has no claim on the keyboard),
  // and adding a focus prop for one caller would be a feature between him and
  // typing — which is the one thing its header says it exists not to be. This
  // overlay renders exactly one textarea and knows it.
  //
  // Keyed on `loaded` as well as mounting, because the editor does not exist
  // until the file has answered: on a cold open the first commit is the "reading…"
  // line, and a focus call then would have nothing to focus.
  const loaded = buffer.refusal === null && !buffer.reading;
  React.useEffect(() => {
    if (!loaded) return;
    overlayRef.current?.querySelector("textarea")?.focus();
  }, [loaded]);

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col p-6"
      data-testid="scratch-markdown"
      ref={overlayRef}
    >
      <FocusReturn overlayRef={overlayRef} />
      {/* A real button rather than a div with a click handler: dismissing is an
       * act, and one an assistive technology should be able to name. */}
      <button
        aria-label="close the scratch markdown buffer"
        className="absolute inset-0 cursor-default bg-background/70"
        data-testid="scratch-markdown-scrim"
        onClick={onClose}
        type="button"
      />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-popover shadow-xl">
        <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
          <span aria-hidden="true" className="text-sm text-muted-foreground">
            ⌁
          </span>
          <span className="shrink-0 text-sm text-foreground">
            scratch markdown
          </span>
          <span aria-hidden="true" className="text-2xs text-muted-foreground">
            ·
          </span>
          {/* The file, as he would type it — the thing he would otherwise have
           * had to guess at, and the whole difference between a buffer he owns
           * and a buffer this app owns. */}
          <span
            className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground"
            data-testid="scratch-markdown-path"
            title={SCRATCH_MARKDOWN_PRIVACY.detail}
          >
            {SCRATCH_MARKDOWN_PATH}
          </span>
          <button
            aria-label="close the scratch markdown buffer"
            className="shrink-0 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            data-testid="scratch-markdown-close"
            onClick={onClose}
            title="Close the scratch markdown buffer (⇧⌘M)"
            type="button"
          >
            ×
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {buffer.refusal !== null ? (
            // A refusal, in the plain left-aligned form the vocabulary reserves
            // for one — not an empty state, because nothing about this is empty:
            // the file is there and this build could not open it. No editor is
            // drawn, and that is the point. A keystroke accepted here would arm
            // an autosave that writes over a file whose contents are unknown.
            <p
              className="px-4 py-3 text-sm text-destructive"
              data-testid="scratch-markdown-refusal"
            >
              {buffer.refusal}
            </p>
          ) : buffer.reading ? (
            <p
              className="px-4 py-3 text-sm text-muted-foreground"
              data-testid="scratch-markdown-reading"
            >
              reading {SCRATCH_MARKDOWN_PATH}…
            </p>
          ) : (
            <DocumentEditor
              doc={buffer.doc}
              placeholder={SCRATCH_MARKDOWN_PLACEHOLDER}
              scope={SCRATCH_MARKDOWN_SCOPE}
              // Its own prefix, so a spec written against this buffer cannot
              // silently pass against the notes pane.
              testId="scratch-md"
            />
          )}
        </div>

        <footer
          className="shrink-0 border-t border-border/60 px-3 py-1.5 text-2xs text-muted-foreground"
          data-testid="scratch-markdown-boundary"
          title={SCRATCH_MARKDOWN_PRIVACY.detail}
        >
          {SCRATCH_MARKDOWN_PRIVACY.label}
        </footer>
      </div>
    </div>
  );
}
