// **The one claimant ⌘K did not take from upstream: the composer's link
// editor** (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 2).
//
// `paletteKeys.ts`'s original claimant check named upstream's composer
// (`features/messages/lib/useRichTextEditor.ts`) as a live claimant of ⌘K and
// mitigated it **by scope**: "It is on the channel screens, never on
// /workspace." Task 2 moved this palette onto exactly those channel screens, so
// that mitigation expired the moment the chord went app-wide, and the check has
// to be run again for the new scope. This module is the answer.
//
// **What upstream actually claims, and how.** The composer's ProseMirror
// handler consumes ⌘K *conditionally* — `useLinkEditor.tsx`'s
// `openFromShortcut` returns `true` only when `getLinkSelectionInfo()` answers,
// which is when **text is selected or the caret sits inside an existing link**,
// and `false` otherwise so "a bare caret still falls through to the app-wide
// quick-search binding". Their own comment states the contract: the composer
// wins where the shortcut applies, the app-wide binding wins everywhere else.
//
// **Why a fall-through is needed at all.** `usePalette.ts` binds `keydown` on
// `window` in the *capture* phase and calls `stopPropagation()`. Capture runs
// before the target phase, and stopping there means the event never reaches the
// composer's handler — so without this module the fork wins ⌘K
// *unconditionally* and the link editor becomes unreachable from the keyboard.
// That is a gesture removed in silence, which is the one thing hosting rather
// than rewriting (ADR-001) is supposed not to do.
//
// **The resolution: upstream's contract, kept exactly.** The palette defers
// ⌘K to the composer under the composer's own condition and takes it in every
// other case — including a bare caret in a focused composer, which is the state
// the owner is in most of the time on a chat route and the state his whole
// complaint is about ("cmd k buzz kısmında farklı deck kısmında farklı
// çalışıyor"). Deferring on *focus* instead would have been simpler and wrong:
// the composer is auto-focused on a channel screen, so ⌘K would still open
// upstream's dialog in the common case and the split the task removes would be
// back under a narrower name.
//
// **Only ⌘K.** ⌘P and ⇧⌘P are claimed by nothing in the composer
// (`paletteKeys.ts`'s table), and deferring them here would invent a claimant
// to be polite to.
//
// **Drift, and which way it fails.** The condition below is upstream's, read
// from their code and their comment, not called through it — there is no seam
// to call. If upstream ever widens what the composer consumes, this defers less
// than they expect and the palette opens over a chord they wanted; if it
// narrows, this defers where they would have fallen through and upstream's own
// search dialog answers, which is the behaviour that shipped before this fork.
// Both are recoverable, both are visible, and neither is silent.
//
// The decision is a pure function of three facts so it can be proved without a
// document; reading those facts off one is the second half, and the E2E spec
// (`tests/e2e/workspace-palette-doors.spec.ts`) is what proves that half.

/** The three facts upstream's condition is written in.
 *
 * Deliberately not "the ProseMirror view" or "the editor": this module knows
 * about a caret in a rich-text surface, and nothing about Tiptap. */
export interface ComposerCaret {
  /** Is the keystroke's target inside a rich-text composer at all? */
  inComposer: boolean;
  /** Is the selection an insertion point rather than a range? */
  collapsed: boolean;
  /** Does that selection sit inside a link? */
  onLink: boolean;
}

/** Whether upstream's composer would consume this ⌘K — the whole of the
 * deference. */
export function composerHoldsGo(caret: ComposerCaret): boolean {
  if (!caret.inComposer) return false;
  return !caret.collapsed || caret.onLink;
}

/** Every rich-text composer in this app, named the one way the DOM itself
 * names them. Upstream has three (`MessageComposer`, `ForumComposer`,
 * `ProjectsAgentPromptPage`) and they are the same editor; matching the
 * attribute rather than a class or a testid means a fourth is covered on the
 * day it is written, and means this module never imports a component. */
const COMPOSER = '[contenteditable="true"]';

/** Read the three facts off a real document. The one part of this file a unit
 * test cannot reach, kept to eleven lines for that reason. */
export function readComposerCaret(
  target: EventTarget | null,
  selection: Selection | null,
): ComposerCaret {
  const root =
    target instanceof Element ? (target.closest(COMPOSER) ?? null) : null;
  if (root === null)
    return { collapsed: true, inComposer: false, onLink: false };
  const anchor = selection?.anchorNode ?? null;
  // A selection somewhere else in the document says nothing about this
  // composer's caret, and reading it as a range would defer a chord the
  // composer is not going to take.
  if (anchor === null || !root.contains(anchor)) {
    return { collapsed: true, inComposer: true, onLink: false };
  }
  const at = anchor instanceof Element ? anchor : anchor.parentElement;
  const link = at?.closest("a") ?? null;
  return {
    collapsed: selection?.isCollapsed !== false,
    inComposer: true,
    onLink: link !== null && root.contains(link),
  };
}
