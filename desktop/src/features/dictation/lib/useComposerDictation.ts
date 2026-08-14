// Dictation wired into a rich-text message composer: the fold-into-the-
// editor callback, the ⌃⌘D chord (scoped to this composer having focus), and
// the nav-away auto-stop (vingilot/docs/plans/2026-08-13-voice.md, Task 3).
//
// Split out of `MessageComposer.tsx` itself so that file's contribution to
// this feature stays a single hook call plus two render lines — that file
// was already at the desktop file-size ratchet's ceiling, and "may not grow"
// is the rule for a file already over it (`vingilot_command_table.rs`'s
// header is the earlier split against the same ceiling, on `lib.rs`).

import * as React from "react";

import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";
import type { UseRichTextEditorResult } from "@/features/messages/lib/useRichTextEditor";
import { dictationCaretInsertionText } from "./dictationFold";
import { resolveDictationKey } from "./dictationKeys";
import { type Dictation, useDictation } from "./useDictation";

/** Positional, matching this island's other few-argument composer hooks
 * (`useComposerSpoilerParticles(editor, scrollRef)`,
 * `useTypingBroadcast(channelId, parentId, rootId)`) rather than a named-
 * options object — this file was split out of an already-oversized
 * `MessageComposer.tsx` specifically to keep that call site small (this
 * file's header).
 *
 * `effectiveDraftKey` is the draft's identity: a channel switch reuses the
 * composer instance without remounting it, so this is what tells the hook
 * "the owner navigated away". `scopeRef` is where "this composer has focus"
 * is read from for the chord — a global `window` listener would fire for
 * every mounted composer (e.g. a thread panel beside the main one) on one
 * keypress. */
export function useComposerDictation(
  richText: UseRichTextEditorResult,
  composerDisabled: boolean,
  effectiveDraftKey: string | null,
  scopeRef: React.RefObject<HTMLElement | null>,
): Dictation {
  // Each finished utterance folds in AT THE CARET as a rich-text insertion —
  // never a wholesale `setContent` (see `dictationFold.ts`'s header on why
  // that would risk mangling mention/emoji atoms) and never spaced off the
  // end of the whole document (the caret can be anywhere; see
  // `dictationCaretInsertionText`'s header).
  const appendDictationSegment = React.useCallback(
    (text: string) => {
      const editor = richText.editor;
      if (!editor) return;
      const { text: currentText, cursor } = richText.getPlainTextAndCursor();
      const delta = dictationCaretInsertionText(currentText, cursor, text);
      if (!delta) return;
      editor.chain().focus().insertContent(delta).run();
    },
    [richText.editor, richText.getPlainTextAndCursor],
  );

  const dictation = useDictation({ onSegment: appendDictationSegment });
  const dictationRef = React.useRef(dictation);
  dictationRef.current = dictation;

  // ⌃⌘D toggles dictation (scoped to this composer having focus — see
  // `dictationKeys.ts`'s header for the six-claimant audit that cleared the
  // chord itself), and plain Escape stops an active session — the second
  // half of "press again / Esc stops". Both live in one listener rather than
  // adding a second effect for one `if`.
  React.useEffect(() => {
    if (composerDisabled) return;
    function handleKeyDown(event: KeyboardEvent) {
      const action = resolveDictationKey({
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      const isEscapeStop =
        action === null &&
        event.key === "Escape" &&
        dictationRef.current.status === "listening";
      if (action === null && !isEscapeStop) return;
      if (!scopeRef.current?.contains(document.activeElement)) return;
      event.preventDefault();
      if (isEscapeStop) {
        dictationRef.current.stop();
        return;
      }
      const current = dictationRef.current;
      if (current.status === "listening") current.stop();
      else current.start();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [composerDisabled, scopeRef]);

  // Auto-stop on navigation away.
  // biome-ignore lint/correctness/useExhaustiveDependencies: effectiveDraftKey is the sole trigger
  React.useEffect(() => {
    if (dictationRef.current.status !== "idle") dictationRef.current.stop();
  }, [effectiveDraftKey]);

  return dictation;
}
