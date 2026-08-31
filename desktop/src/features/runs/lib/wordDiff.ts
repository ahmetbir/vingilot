// Which TOKENS of a changed line actually changed — the mockup's `.wd`
// highlight (redesign P4.6, DIFF-TAB-BRIEF §4).
//
// > "Word-level highlight (`.wd`) on the changed tokens inside a line —
// > rounded, stronger tint of the row color."
//
// **Why this is written here and not installed.** The brief allows a
// dependency ("`diff-match-patch` or equivalent") and this fork took the
// measurement instead of the default. `diff-match-patch` is a 2,500-line
// character-level differ carrying semantic cleanup, patch application and a
// line-mode codec — none of which a diff row wants: character granularity
// paints `.wd` across the inside of identifiers (`readFile` → `read`+`F`+`ile`)
// and the cleanup pass exists to undo exactly that. `jsdiff` is closer but
// arrives as 12 exported algorithms for the one this needs. What a diff row
// needs is *token* granularity over two short strings, which is a common
// prefix, a common suffix and an LCS over what is left — the fifty lines
// below, testable under `node --test` with no bundle cost and no supply chain.
//
// **Two ceilings, and both are about not making a slow thing slower.** The LCS
// is O(n·m) and a minified bundle's "line" is 200 KB, so a pair past
// `MAX_TOKENS` is not word-diffed at all (the row still draws, tinted, exactly
// as it did before this module existed). And a pair whose *result* would be
// mostly highlight is dropped too: a line rewritten end to end reads better as
// one tinted row than as confetti, which is the same judgement GitHub's own
// "this line is too different" fallback makes.
//
// Pure: no React, no DOM, no timers.

/** A run of the line, and whether it is part of what changed. Offsets are not
 * carried because the segments are contiguous and in order — the consumer that
 * needs character ranges builds them by accumulating `text.length`
 * (`changedRanges` below). */
export interface WordSegment {
  text: string;
  changed: boolean;
}

export interface WordDiff {
  before: WordSegment[];
  after: WordSegment[];
}

/** Words, whitespace runs, and every other character on its own.
 *
 * Identifier characters are grouped so a renamed variable highlights as a word
 * rather than as the three letters that differ inside it; whitespace is grouped
 * so an indent change is one segment; punctuation is split so `(cart, stub)`
 * can highlight `stub` without dragging the comma in with it. */
const TOKEN = /[A-Za-z0-9_$]+|\s+|[^A-Za-z0-9_$\s]/g;

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/** Past this many tokens on a side the pair is left alone. A source line is
 * tens of tokens; anything at this scale is generated, minified or a data blob,
 * and the O(n·m) table below is not what should meet it. */
const MAX_TOKENS = 320;

/** How much of the longer line may be highlighted before the highlight stops
 * being information. At 0.8 a line that shares its indent and nothing else is
 * drawn as a plain changed row — which is what it is. */
const MAX_CHANGED_SHARE = 0.8;

/** The changed tokens of `before` and `after`, or `null` when this pair is not
 * worth marking up: identical, too long to compare, or so different that the
 * markup would cover it.
 *
 * `null` is a first-class answer and the caller's fallback is the drawing it
 * already had — the row's tint. Nothing here throws. */
export function wordDiff(before: string, after: string): WordDiff | null {
  if (before === after) return null;
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length === 0 || b.length === 0) return null;
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null;

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1;
  }

  const aMid = a.slice(head, a.length - tail);
  const bMid = b.slice(head, b.length - tail);
  const marks = lcsMarks(aMid, bMid);

  const beforeSegments = assemble(a, head, tail, marks.a);
  const afterSegments = assemble(b, head, tail, marks.b);
  if (
    tooMuch(beforeSegments, before.length) ||
    tooMuch(afterSegments, after.length)
  ) {
    return null;
  }
  return { after: afterSegments, before: beforeSegments };
}

/** The changed character ranges of one side, as `[start, end)` pairs — what a
 * renderer needs to split syntax tokens on. */
export function changedRanges(
  segments: readonly WordSegment[],
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let at = 0;
  for (const segment of segments) {
    const end = at + segment.text.length;
    if (segment.changed) ranges.push({ end, start: at });
    at = end;
  }
  return ranges;
}

/** Which tokens of each middle are NOT in the longest common subsequence.
 *
 * The table is `|a| × |b|` `Uint16Array` cells, which at `MAX_TOKENS` is
 * 320×320 — a hundred thousand 16-bit cells, allocated once per changed pair
 * and thrown away. A middle is normally under twenty tokens; the ceiling is
 * for the pathological case, not the usual one. */
function lcsMarks(
  a: readonly string[],
  b: readonly string[],
): { a: boolean[]; b: boolean[] } {
  const aChanged = new Array<boolean>(a.length).fill(true);
  const bChanged = new Array<boolean>(b.length).fill(true);
  if (a.length === 0 || b.length === 0) return { a: aChanged, b: bChanged };

  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      aChanged[i] = false;
      bChanged[j] = false;
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return { a: aChanged, b: bChanged };
}

/** One side's segments: the shared head, the marked middle, the shared tail —
 * with runs of the same flag merged, so a renderer gets as few spans as the
 * line really needs. */
function assemble(
  tokens: readonly string[],
  head: number,
  tail: number,
  midChanged: readonly boolean[],
): WordSegment[] {
  const flags: boolean[] = [];
  for (let at = 0; at < head; at += 1) flags.push(false);
  for (const changed of midChanged) flags.push(changed);
  for (let at = 0; at < tail; at += 1) flags.push(false);

  const out: WordSegment[] = [];
  for (let at = 0; at < tokens.length; at += 1) {
    const changed = flags[at] === true;
    const last = out[out.length - 1];
    if (last !== undefined && last.changed === changed) {
      last.text += tokens[at];
      continue;
    }
    out.push({ changed, text: tokens[at] });
  }
  return out;
}

function tooMuch(segments: readonly WordSegment[], length: number): boolean {
  if (length === 0) return false;
  let changed = 0;
  for (const segment of segments) {
    if (segment.changed) changed += segment.text.length;
  }
  return changed / length > MAX_CHANGED_SHARE;
}
