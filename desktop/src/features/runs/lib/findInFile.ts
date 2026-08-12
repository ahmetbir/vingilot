// ⌘F inside the open file: which bytes match, which one he is on, and where the
// amber goes
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 1).
//
// > *"cmd F"* — the second of the four gestures. Not ⇧⌘F, which is
// > `searchKeys.ts` and searches the whole checkout; this one searches the pane
// > he is looking at.
//
// **Everything here is over the TEXT, and that is the load-bearing decision.**
// Task 0 made the viewer render Shiki's tokens, so the file on screen is a tree
// of `<span>`s whose boundaries are the *grammar's* — `HIGHLIGHT_BYTE_CEILING`
// away from anything a reader means by "the file". A find that walked the spans
// would miss every match that straddles two of them (`greet` in
// `greeting.length` is one span; `t(na` in `greet(name` is three) and would
// answer a different count for the same file before and after the background
// tokenise landed. So the match set is computed once against `file.text`, as
// offsets into that one string, and the renderer's job is only to ask which
// of them fall inside the piece of text it is about to draw. `indexLines` and
// `segmentSpan` are that question, and the answer does not change when the
// colours arrive.
//
// **Smart case, said out loud.** A lower-case query matches either case; the
// moment he types a capital he means it. That is VS Code's rule and every
// editor's, and it is announced in the field's own title rather than left to be
// discovered — `smartCaseSensitive` is the whole of it, and it is one line
// because the rule is one line.
//
// **Nothing here touches the DOM or React**, so all of it is proved in
// `findInFile.test.mjs` without a browser. What only a browser can say — that
// the chord arrives, that the amber is on screen, that walking scrolls — is
// `desktop/tests/e2e/workspace-find.spec.ts`.

/** A match, as a half-open range of character offsets into the whole file text.
 * Global rather than per-line because the walk order is the file's order and
 * because the current match is one number, not a (line, column) pair. */
export type FindMatch = { start: number; end: number };

/** One piece of a span the renderer is about to draw: the text, and which match
 * covers it (`null` for the ground between matches). */
export type FindSegment = { text: string; match: number | null };

/** One line's share of the match set: where the line starts in the file, every
 * match that touches it, and **where those matches sit in the whole file's
 * list**.
 *
 * `first` is the reason this type has three fields instead of two, and it is
 * worth the sentence: the current match is one number counted over the *file*,
 * while a line only ever holds a slice of the file's matches. Without `first`,
 * every line's own first match would compare equal to `current === 0` and the
 * emphasis would appear once per line instead of once per file — which is exactly
 * the defect the browser spec caught. The matches are sorted and non-overlapping
 * and lines partition the text, so a line's matches are always a contiguous run
 * of the file's list and one offset is enough to name it. */
export type FindLine = { start: number; first: number; matches: FindMatch[] };

/** The empty list, shared, for the renderer's "this line has no matches" path.
 * A fresh `[]` per line per render is a new reference on every keystroke for
 * every line of a 2,000-line file, and this pane draws one element per line. */
export const NO_MATCHES: FindMatch[] = [];

/** Whether this query is case-sensitive — **smart case**: insensitive until he
 * types a capital.
 *
 * `query !== query.toLowerCase()` rather than `/[A-Z]/`, because the owner types
 * Turkish: `Ş`, `İ`, `Ğ` and `Ö` are capitals a Latin-A-to-Z test does not see,
 * and a query of `Şubat` that quietly matched `şubat` would be the rule failing
 * in exactly his alphabet. */
export function smartCaseSensitive(query: string): boolean {
  return query !== query.toLowerCase();
}

/** A case-folded copy of `text` **with every offset preserved**.
 *
 * The reason this is not `text.toLowerCase()`: in JavaScript lower-casing can
 * change a string's length. `"İ".toLowerCase()` is two code units (`i` plus a
 * combining dot), so folding a file with one `İ` in it shifts every offset after
 * it by one — and every match past that point would be highlighted one character
 * to the left, silently, in the owner's own language. So each code point is
 * folded only when folding it keeps its length, and left alone otherwise. The
 * cost is stated: an insensitive query for `i` does not match `İ`. That is a
 * missing match, which he can see; a shifted highlight is a wrong answer, which
 * he cannot. */
function fold(text: string): string {
  let out = "";
  for (const point of text) {
    const lower = point.toLowerCase();
    out += lower.length === point.length ? lower : point;
  }
  return out;
}

/** Every match of `query` in `text`, in the file's own order, non-overlapping.
 *
 * Non-overlapping — `aa` in `aaaa` is two matches and not three — because the
 * walk is what the count is a count of, and a set where Enter can land on a
 * match that starts inside the one he was on is a walk that goes backwards to
 * his eye.
 *
 * An empty query is no matches rather than a match at every position: a find bar
 * he has just opened must not claim to have found the whole file. */
export function findMatches(text: string, query: string): FindMatch[] {
  if (query === "") return [];
  const sensitive = smartCaseSensitive(query);
  const haystack = sensitive ? text : fold(text);
  const needle = sensitive ? query : fold(query);
  if (needle === "") return [];
  const found: FindMatch[] = [];
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    found.push({ end: at + needle.length, start: at });
    at = haystack.indexOf(needle, at + needle.length);
  }
  return found;
}

/** The next match in `direction`, wrapping at both ends.
 *
 * **Wrap-around rather than stopping at the end**, because the gesture is
 * "again" and not "forward": VS Code wraps, ⌘G wraps, and a walk that stopped
 * dead on the last match would leave him pressing Enter at a bar that has
 * stopped answering. `0` for an empty match set, which is the only index a
 * caller can safely hold when there is nothing to hold. */
export function stepMatch(
  count: number,
  current: number,
  direction: 1 | -1,
): number {
  if (count <= 0) return 0;
  return (((current + direction) % count) + count) % count;
}

/** What the bar says: `"3/17"`, or the sentence for a query that found nothing.
 *
 * 1-based on purpose — it is a position he reads, not an index — and the count
 * comes second, so the pair reads the way a page number does. The no-match case
 * is words rather than `"0/0"`: a bar showing two zeroes is a bar he has to
 * interpret. */
export function matchLabel(count: number, current: number): string {
  if (count <= 0) return "no results";
  const at = Math.min(Math.max(current, 0), count - 1);
  return `${at + 1}/${count}`;
}

/** The match set, split per line: one entry per line of `text`, in order,
 * carrying that line's start offset and the matches that touch it.
 *
 * One entry per line even when it holds no matches, so the renderer can index
 * this by line number — the same positional indexing `markedLineIndex` and both
 * of the viewer's render paths already agree on.
 *
 * A match is filed under every line it touches. A query typed into a one-line
 * field cannot contain a newline, so today that is always exactly one line; the
 * clamping in `segmentSpan` is what makes the multi-line case draw correctly
 * rather than off the end, and it costs nothing to be right about it here. */
export function indexLines(text: string, matches: FindMatch[]): FindLine[] {
  const lines: FindLine[] = [];
  let start = 0;
  let from = 0;
  for (const lineText of text.split("\n")) {
    const end = start + lineText.length;
    // The matches are sorted and non-overlapping, so the scan only ever moves
    // forward: `from` is the first match that can still touch a later line.
    while (from < matches.length && matches[from].end <= start) from += 1;
    const mine: FindMatch[] = [];
    for (let at = from; at < matches.length; at += 1) {
      if (matches[at].start >= end) break;
      mine.push(matches[at]);
    }
    // `from` is where this line's run starts in the file's list — meaningless
    // and unread when the run is empty.
    lines.push({ first: from, matches: mine, start });
    // +1 for the newline the split ate.
    start = end + 1;
  }
  return lines;
}

/** One span of text, cut into the pieces the renderer draws: plain runs and
 * matched runs, in order, covering `text` exactly.
 *
 * `offset` is where this span starts in the file, which is what lets the same
 * function serve both of the viewer's render paths. On the plain path a span is
 * a whole line; on the highlighted path it is one of Shiki's tokens, and a match
 * that straddles two tokens arrives here as two segments carrying the same match
 * index — which is why the index is on the segment rather than being inferred
 * from the shape of the output.
 *
 * `matches` is the line's own list (`indexLines`), so this is linear in the
 * matches on the line rather than in the matches in the file — and `first` is
 * that list's offset into the file's, so the index a segment carries is the same
 * number the bar counts with. Passing the line's list without its offset is how
 * the emphasis ends up on one match per *line* instead of one per file, which is
 * a mistake that looks almost right on a file with a match on every line. */
export function segmentSpan(
  text: string,
  offset: number,
  matches: FindMatch[],
  first = 0,
): FindSegment[] {
  if (matches.length === 0 || text === "") {
    return text === "" ? [] : [{ match: null, text }];
  }
  const end = offset + text.length;
  const out: FindSegment[] = [];
  let at = offset;
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    // Clamped to this span: a match may start before it (a token in the middle
    // of a match) and may end after it.
    const from = Math.max(match.start, at);
    const to = Math.min(match.end, end);
    if (to <= from) continue;
    if (from > at)
      out.push({ match: null, text: text.slice(at - offset, from - offset) });
    out.push({
      match: first + index,
      text: text.slice(from - offset, to - offset),
    });
    at = to;
  }
  if (at < end) out.push({ match: null, text: text.slice(at - offset) });
  return out;
}

/** Which of `matches` is the one to put on screen, given the line the renderer
 * is drawing — the index the renderer compares a segment's `match` against.
 *
 * A separate function because the number the bar shows and the number a segment
 * carries are the same number, and it is clamped in exactly one place: a match
 * set that shrinks under a keystroke leaves `current` past its end for one
 * render, and an unclamped compare would emphasise nothing while the label still
 * read `1/1`. */
export function currentMatchIndex(count: number, current: number): number {
  if (count <= 0) return -1;
  return Math.min(Math.max(current, 0), count - 1);
}
