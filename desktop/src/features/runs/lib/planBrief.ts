// Turning a plan into the two strings a worktree needs — a branch name and a
// file (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 4).
//
// **What is derived is offered, never taken.** `planOffer` reads the plan's
// title and suggests a branch; the dialog puts that suggestion in an editable
// field, and what git is asked for is whatever is in the field when the owner
// presses the button. Nothing here decides a branch name on his behalf, and a
// plan whose title yields no name is not an error — it is an empty field with
// a sentence beside it.
//
// **Legality is git's answer, not this file's.** The slug below is shaped to
// be an ordinary branch name, but it is not a validator and must not become
// one: `worktreePlan.ts` already states why a second copy of
// `check-ref-format`'s rules in this app would eventually disagree with git.
// A name git rejects comes back as `invalid-branch` with git's own verdict
// behind it.
//
// **Non-ASCII letters survive.** The owner writes in Turkish, and git ref
// names are UTF-8; `dokümanlar` is a perfectly good branch name and mangling
// it to `dok-manlar` would be this app deciding his language is a problem.
// The *directory* the worktree lands in is reduced to ASCII separately by
// `branchSlug`, which is a fact about paths rather than about refs.

/** The plan's filename inside the worktree it opens.
 *
 * **`PLAN.md`, at the root, in capitals.** Three things decided it:
 *
 * - Whoever opens this checkout next — the owner in a shell, an agent handed
 *   the directory — has to *find* it without being told where to look. Root
 *   capitals is the convention every repository already uses for a document
 *   about the whole checkout: `README.md`, `CONTRIBUTING.md`, `AGENTS.md`.
 * - It is a fixed name, not the plan's title. A filename that varied per
 *   worktree could not be found by convention, would inherit every problem a
 *   title has (length, slashes, a language's own letters), and would make the
 *   brief harder to open than the work it describes.
 * - It is visible and committable. Not `.vingilot/plan.md`: a hidden file is
 *   one nobody reads, and this document is meant to be read, and to be in the
 *   first commit if the owner wants it there. It costs one line of `git
 *   status` in a checkout that was created seconds ago for this plan.
 *
 * `docs/` was considered and refused: not every repository has one, and
 * creating a directory in somebody else's layout is a decision about their
 * project rather than about this worktree. */
export const BRIEF_FILE = "PLAN.md";

/** How long an offered branch name may be. Not git's limit — git has none
 * worth naming — but a path's: the worktree's directory is this name under
 * `~/.vingilot/worktrees/<project>/`, and a title-length directory is one
 * nobody can read in a shell prompt. Only the *offer* is cut; a name the owner
 * types himself is his. */
export const MAX_BRANCH_CHARS = 60;

export interface PlanOffer {
  /** The plan has nothing in it. */
  empty: boolean;
  /** The plan's title — its first heading, or its first line of prose.
   * `null` when there is no line to read one from. */
  title: string | null;
  /** The branch name to put in the field, or `""` when the title gives
   * nothing that can be one. Empty is a field the owner fills in, never a
   * name invented to fill it for him. */
  branch: string;
}

/** The plan's title: the first line with anything on it, with a markdown
 * heading's `#`s taken off.
 *
 * A line that is *only* `#`s is not a title, so the search continues past it —
 * the alternative is offering a branch named after a horizontal rule. */
export function planTitle(text: string): string | null {
  for (const line of text.split("\n")) {
    const stripped = line
      .trim()
      .replace(/^#{1,6}\s*/, "")
      .replace(/\s*#+$/, "")
      .trim();
    if (stripped !== "") return stripped;
  }
  return null;
}

/** A title reduced to a branch name, or `""`.
 *
 * Lowercase, letters and digits kept whatever alphabet they are in, everything
 * else a single `-`. `.` is deliberately *not* kept: it is the character git's
 * ref rules have the most to say about (no leading dot in a component, no
 * `..`, no trailing `.lock`), and dropping it costs nothing a reader of the
 * name would miss. */
export function branchFromTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= MAX_BRANCH_CHARS) return slug;
  // Cut at a word boundary when there is one to cut at, so the offer reads as
  // a shortened name rather than as a name that ran out of room mid-word.
  const cut = slug.slice(0, MAX_BRANCH_CHARS);
  const boundary = cut.lastIndexOf("-");
  return (boundary > MAX_BRANCH_CHARS / 3 ? cut.slice(0, boundary) : cut)
    .replace(/-+$/, "")
    .replace(/^-+/, "");
}

export function planOffer(text: string): PlanOffer {
  const title = planTitle(text);
  return {
    branch: title === null ? "" : branchFromTitle(title),
    empty: text.trim() === "",
    title,
  };
}

/** Why this plan cannot open a worktree, or `null`.
 *
 * Only one thing can be in the way here, and an unusable *title* is not it:
 * the branch field is editable, so a plan whose title yields no name is a plan
 * the owner names himself. An empty plan is different — there would be nothing
 * to write into the worktree, and a briefless worktree is what this whole
 * action exists not to make. */
export function planBlocked(offer: PlanOffer): string | null {
  if (!offer.empty) return null;
  return `this project's plan is empty, and the worktree would carry an empty ${BRIEF_FILE}. Write what the work is first.`;
}

/** The plan as it is written to disk: its own text, with a final newline.
 *
 * The text is otherwise untouched — no header naming the branch, no timestamp,
 * no "generated by". A brief that arrived in the worktree with something added
 * to it would be a brief the owner has to read past to find his own words. The
 * newline is not an edit but a file's terminator; every editor that opens this
 * would add it. */
export function briefText(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}
