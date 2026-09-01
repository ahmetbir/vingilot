// What a name the owner typed into a strip is worth, before either strip
// keeps it (2026-08-29 redesign, P4.5; owner, pointing at a chip reading
// "task 1" and a tab bar reading "1 3 6": "suralari da rename edebilelim ya").
//
// Two strips, two models, one rule — which is the whole reason this is a
// module and not two private helpers. A chip's name lives in `taskStrip.ts`
// and a tab's in `terminalTabs.ts`; they are different data with different
// lifetimes, but "what counts as a name" is one question and two answers to it
// would drift the day one strip trimmed and the other did not.
//
// **Empty is not a name.** Whitespace committed into either editor restores
// the default the strip was born with (`task 3`, or the ordinal), rather than
// leaving a chip the owner cannot see or click. The models spell that as "the
// normal form is the empty string", so the decision of what to fall back TO
// stays with whichever model knows the default — this one only says the name
// is not a name.
//
// **A cap, because the strip has a `+` at the end of it.** The task strip's
// new-task button and the tab bar's both sit AFTER a scroller, so they cannot
// be pushed off screen by a long name; but a name long enough to fill the row
// makes the strip a single chip, which is the same loss by a slower road. The
// cap is on what is STORED so nothing downstream has to re-apply it, and the
// strips truncate visually on top of it (`title` carries the whole name, which
// at this length is the same string).

/** The longest name either strip keeps. Long enough for the phrases the owner
 * actually types over a shell ("agent", "test loop", "rebase onto main") and
 * short enough that a strip of them is still a strip. */
export const STRIP_NAME_MAX = 32;

/** A typed name in its stored form: one line, no edge whitespace, capped.
 *
 * Inner whitespace is collapsed rather than preserved because the sources are
 * an `<input>` and the clipboard, and a pasted line break or a run of tabs
 * would otherwise be stored as a name the strip cannot draw. The trim is
 * applied again after the cut so a name truncated mid-space does not keep the
 * space it was cut at. */
export function normalizeStripName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, STRIP_NAME_MAX).trim();
}
