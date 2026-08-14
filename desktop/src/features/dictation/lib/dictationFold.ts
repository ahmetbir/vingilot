// The dictation fold: what one recognized utterance does to the text already
// there (vingilot/docs/plans/2026-08-13-voice.md, Task 3).
//
// **There is no partial to replace.** The recon this task is built on read
// `huddle/stt.rs`: the recognizer (`sherpa_onnx::OfflineRecognizer`) is
// non-streaming, and earshot VAD flushes it once per finished utterance — one
// final string, never an interim one to overwrite. So this module has exactly
// one case, not two: append the finished segment. A `foldDictationSegment`
// that also handled a partial-replace case would be documenting a UX this
// backend cannot produce.
//
// **Spacing, not concatenation, is the actual job here.** Speech segments
// arrive as trimmed sentences with no leading/trailing whitespace of their
// own (`huddle/stt.rs`'s `flush_to_stt` trims); whether a space belongs
// between the existing text and the new segment depends on what the existing
// text already ends with. Two callers use this: the message composer inserts
// only the *delta* this function implies (`next.slice(existing.length)`) at
// the rich-text cursor, since a rich editor's atoms (mentions, custom emoji)
// must not round-trip through a wholesale `setContent`; the Ask box, being
// plain string state, can use the returned string directly.
//
// Pure: no React, no Tauri.

/** Fold one finished dictation segment onto the text already present.
 *
 * - An empty or whitespace-only segment changes nothing (a VAD flush with no
 *   decodable words is possible and must be a no-op, not a stray space).
 * - Otherwise the segment is trimmed and appended, with exactly one space
 *   inserted when `existing` is non-empty and doesn't already end in
 *   whitespace — so dictating "hello" then "world" reads "hello world", and
 *   dictating into an already-space-terminated draft (the owner typed a
 *   trailing space, then pressed the mic) doesn't double it. */
export function foldDictationSegment(
  existing: string,
  segment: string,
): string {
  const trimmedSegment = segment.trim();
  if (trimmedSegment.length === 0) return existing;
  if (existing.length === 0) return trimmedSegment;
  const needsSpace = !/\s$/.test(existing);
  return needsSpace
    ? `${existing} ${trimmedSegment}`
    : `${existing}${trimmedSegment}`;
}

/** What a rich-text caller should insert at the cursor for one segment: the
 * suffix `foldDictationSegment` would append, and nothing else. `""` means
 * "insert nothing" — the segment was empty/whitespace, or (defensively) not a
 * suffix of the fold result at all, which should never happen for a pure
 * append function but is checked rather than assumed.
 *
 * **End-of-document only.** This folds onto the END of `existing` — correct
 * for the Ask box (plain string state, caret always effectively at the end)
 * but wrong for a caret that can sit anywhere, which is why the message
 * composer uses `dictationCaretInsertionText` instead (see that function's
 * header). */
export function dictationInsertionText(
  existing: string,
  segment: string,
): string {
  const next = foldDictationSegment(existing, segment);
  if (!next.startsWith(existing)) return ""; // defensive: never observed, never trusted.
  return next.slice(existing.length);
}

/** What a rich-text caller should insert AT THE CARET for one segment, given
 * the caret's plain-text offset into the document.
 *
 * Unlike `dictationInsertionText` (which reads spacing off the END of the
 * whole document — correct only when the caret is always there), dictation
 * can resume with the caret anywhere the owner left it: mid-sentence, inside
 * a reply that already has trailing text, after an autocomplete insert. So
 * this reads spacing off the text immediately touching the caret on BOTH
 * sides:
 *
 * - A leading space is added when there is text before the caret and it
 *   doesn't already end in whitespace (same rule `foldDictationSegment` uses
 *   at the end of a document, just evaluated at the caret instead).
 * - A trailing space is added when there is text after the caret and it
 *   doesn't already start with whitespace — otherwise a segment inserted
 *   before already-typed text would run straight into it
 *   (`"helloworld"` instead of `"hello there world"`), which
 *   `dictationInsertionText` can't produce because it only ever appends at
 *   the end, where there is no "after".
 * - An empty/whitespace-only segment inserts nothing, same as
 *   `foldDictationSegment`. */
export function dictationCaretInsertionText(
  text: string,
  cursor: number,
  segment: string,
): string {
  const trimmedSegment = segment.trim();
  if (trimmedSegment.length === 0) return "";
  const before = text.slice(0, cursor);
  const after = text.slice(cursor);
  const leadingSpace = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const trailingSpace = after.length > 0 && !/^\s/.test(after) ? " " : "";
  return `${leadingSpace}${trimmedSegment}${trailingSpace}`;
}
