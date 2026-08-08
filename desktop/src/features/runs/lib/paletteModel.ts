// What the palette can offer, how a query is matched against it, and — the
// part that decides whether the surface feels like an answer or a lottery —
// **one ranking function over every source**
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 1).
//
// **One scorer, not one per source.** A palette that ordered projects among
// projects and actions among actions, then concatenated, would put the fourth
// best project above the perfect action every time; the owner would learn that
// the first row is not the answer and start reading the whole list, which is
// the list he opened the palette to avoid. So every source produces
// `PaletteMatch`es through the same `matchCandidate`, and `rankMatches` orders
// the union. Nothing in the sort reads `kind` — deliberately, and asserted.
//
// **Tiers cannot cross.** The five match tiers are 150 points apart at the
// closest and every penalty below is capped, so a substring match can never
// out-score a prefix match by being shorter or earlier. That is what makes the
// ordering explainable ("it matched better") rather than emergent, and it is
// the property the tests pin.
//
// **An action that cannot run is ranked down, never dropped.** Prune with
// nothing prunable and "remove project" on the landing view are still in the
// list, still findable by name, carrying the sentence that says why they are
// not going to happen. A palette that hid them would answer "there is no such
// command", which is a different and false statement.
//
// Pure: no React, no Tauri, no storage. `paletteSources.ts` builds the
// candidates, `usePalette.ts` runs the commands.

/** Which surface a row came from. Carried for the renderer's glyph and for
 * nothing else — **it is not an input to the ranking**, which is the whole
 * point of having one ranking. */
export type PaletteKind = "project" | "worktree" | "pane" | "action";

/** Everything the palette can do, as data. The host runs these; the model
 * never calls anything. */
export type PaletteCommand =
  | { type: "open-landing" }
  | { type: "open-project"; repoId: string }
  | { type: "open-worktree"; bindingId: string }
  | { type: "choose-pane"; pane: string }
  | { type: "new-worktree" }
  /** Open the dialog that turns this project's plan into a worktree. The
   * command opens it and nothing more: the branch name is derived from the
   * plan and shown in an editable field, and a palette row that skipped that
   * would be the palette taking a name on the owner's behalf. */
  | { type: "plan-to-worktree" }
  | { type: "new-terminal-tab" }
  /** Open the scratch shell over the work surface. A different thing from the
   * row above it, and the reason both are here: one keeps everything, the
   * other keeps nothing (`scratchTerminal.ts`). */
  | { type: "open-scratch-terminal" }
  | { type: "add-project" }
  | { type: "remove-project" }
  | { type: "prune-worktrees" }
  | { type: "toggle-sidebar" }
  | { type: "toggle-worktrees" }
  | { type: "toggle-solo"; side: "left" | "right" }
  /** Not a row: the ask mode's question, carried out the same door every other
   * command leaves by (`askMode.ts`). The host decides where it is asked — the
   * model never held a directory and is not about to start. */
  | { type: "ask"; question: string };

export interface Candidate {
  /** Stable across app runs and unique across sources — it is what a recent
   * is recorded as, so a generated or index-derived id would hand yesterday's
   * recents to today's rows. */
  id: string;
  kind: PaletteKind;
  /** What the row is called, and the first thing matched. */
  label: string;
  /** The line under it: a path, a branch's state, what an action will do, the
   * chord that already does it. Matched too, at a discount. */
  detail: string;
  /** A glyph for the row. Text, like the rest of this island's chrome. */
  icon: string;
  /** `null` when this can run right now; otherwise the sentence saying why it
   * cannot. A blocked row is shown, ranked down, and refuses Enter. */
  blocked: string | null;
  command: PaletteCommand;
}

/** Half-open `[start, end)` over the matched field, for the renderer to
 * emphasise. Ranges never overlap and are in ascending order. */
export interface MatchRange {
  start: number;
  end: number;
}

export interface PaletteMatch {
  candidate: Candidate;
  /** The match's own quality, before recency and availability are applied.
   * `rankMatches` returns rows with `score` left as-is and orders by the
   * final figure, so a caller can still see what the text alone was worth. */
  score: number;
  /** Which field matched — the renderer emphasises that one. */
  field: "label" | "detail";
  ranges: MatchRange[];
}

/** The whole query matched, as a contiguous run, and the field is nothing
 * else. "diff" typed against the Diff pane. */
export const SCORE_EXACT = 1000;
/** A contiguous run at the start of the field. "wor" against "worktree". */
export const SCORE_PREFIX = 700;
/** A contiguous run starting a word inside the field — after a space, a
 * hyphen, a slash, a dot or an underscore. "tab" against "New terminal tab". */
export const SCORE_WORD = 500;
/** A contiguous run anywhere else. "erm" against "terminal". */
export const SCORE_SUBSTRING = 350;
/** The characters in order but not together. "ntt" against "New terminal
 * tab" — the loosest thing this module will call a match at all. */
export const SCORE_SUBSEQUENCE = 150;

/** What matching the detail line costs. Set so that an *exact* detail match
 * (1000 − 400 = 600) still beats a *word* label match (500) and still loses to
 * a *prefix* label match (700): what a thing is called outranks what is
 * written under it, unless the under-text match is much the stronger. */
export const DETAIL_PENALTY = 400;

/** What a row that cannot run right now gives up. Large enough to sink a
 * blocked exact match (1000 − 500 = 500) to the level of a runnable word
 * match, small enough that typing a blocked action's name in full still puts
 * it near the top — where its own sentence can explain itself. */
export const BLOCKED_PENALTY = 500;

/** What the most recent row is worth, falling by `RECENT_STEP` per place.
 * Under every tier gap (150), so recency breaks ties and reorders equals — it
 * never promotes a worse match over a better one. */
export const RECENT_BONUS = 120;
export const RECENT_STEP = 10;

/** Caps on the three shape penalties, so no accumulation of them can cross a
 * tier boundary. 40 + 40 + 30 = 110 < 150. */
const MAX_OFFSET_PENALTY = 40;
const MAX_SLACK_PENALTY = 40;
const MAX_LENGTH_PENALTY = 30;

/** Characters a word may start after. `·` is here because this island's detail
 * lines join their parts with it. */
const BOUNDARY = new Set([" ", "-", "_", "/", ".", ":", "·", "…", "("]);

function lengthPenalty(text: string): number {
  return Math.min(MAX_LENGTH_PENALTY, Math.floor(text.length / 2));
}

/** Greedy leftmost subsequence scan. Returns the matched indices, or `null`
 * when the query's characters do not all appear in order. */
function subsequenceIndices(text: string, query: string): number[] | null {
  const found: number[] = [];
  let at = 0;
  for (const ch of query) {
    const hit = text.indexOf(ch, at);
    if (hit === -1) return null;
    found.push(hit);
    at = hit + 1;
  }
  return found;
}

/** Consecutive indices merged into runs, so the renderer draws one emphasis
 * per run rather than one per character. */
function rangesOf(indices: readonly number[]): MatchRange[] {
  const ranges: MatchRange[] = [];
  for (const index of indices) {
    const last = ranges[ranges.length - 1];
    if (last !== undefined && last.end === index) last.end = index + 1;
    else ranges.push({ end: index + 1, start: index });
  }
  return ranges;
}

export interface FieldMatch {
  score: number;
  ranges: MatchRange[];
}

/** How well `query` matches `text`, or `null` for no match at all. An empty
 * query matches everything at zero — the empty-query view is recents and a
 * listing, not a ranking, and this is what says so.
 *
 * Case-insensitive on both sides: nobody types a branch name's capitals. */
export function matchField(text: string, query: string): FieldMatch | null {
  if (query === "") return { ranges: [], score: 0 };
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  const at = haystack.indexOf(needle);
  if (at !== -1) {
    const base =
      at === 0
        ? haystack.length === needle.length
          ? SCORE_EXACT
          : SCORE_PREFIX
        : BOUNDARY.has(haystack[at - 1] ?? "")
          ? SCORE_WORD
          : SCORE_SUBSTRING;
    // No slack term: a contiguous run has none by definition.
    return {
      ranges: [{ end: at + needle.length, start: at }],
      score: base - Math.min(MAX_OFFSET_PENALTY, at) - lengthPenalty(haystack),
    };
  }

  const indices = subsequenceIndices(haystack, needle);
  if (indices === null) return null;
  const first = indices[0] ?? 0;
  const last = indices[indices.length - 1] ?? 0;
  const slack = last - first + 1 - needle.length;
  return {
    ranges: rangesOf(indices),
    score:
      SCORE_SUBSEQUENCE -
      Math.min(MAX_OFFSET_PENALTY, first) -
      Math.min(MAX_SLACK_PENALTY, slack) -
      lengthPenalty(haystack),
  };
}

/** One candidate against one query: the label first, the detail as a fallback
 * at a discount. `null` when neither field matches, which is what keeps a row
 * out of the list. */
export function matchCandidate(
  candidate: Candidate,
  query: string,
): PaletteMatch | null {
  const label = matchField(candidate.label, query);
  if (label !== null) {
    return {
      candidate,
      field: "label",
      ranges: label.ranges,
      score: label.score,
    };
  }
  const detail = matchField(candidate.detail, query);
  if (detail === null) return null;
  return {
    candidate,
    field: "detail",
    ranges: detail.ranges,
    score: detail.score - DETAIL_PENALTY,
  };
}

/** Where a candidate sits in the recents list, or `-1`. */
function recentIndex(recents: readonly string[], id: string): number {
  return recents.indexOf(id);
}

/** What a row is actually worth: its match, plus recency, less what being
 * unrunnable costs. Exported so a test can state the arithmetic it expects
 * rather than re-deriving it. */
export function finalScore(
  match: PaletteMatch,
  recents: readonly string[],
): number {
  const place = recentIndex(recents, match.candidate.id);
  const recency =
    place === -1 ? 0 : Math.max(0, RECENT_BONUS - place * RECENT_STEP);
  const blocked = match.candidate.blocked === null ? 0 : BLOCKED_PENALTY;
  return match.score + recency - blocked;
}

/** **The one ranking, over every source.**
 *
 * Ties are broken by label and then by id — never by `kind`. A per-kind
 * tiebreak would be a per-source ordering wearing a single function's clothes,
 * and it is exactly what makes a palette feel like it is guessing. */
export function rankMatches(
  matches: readonly PaletteMatch[],
  recents: readonly string[],
): PaletteMatch[] {
  return [...matches]
    .map((match) => ({ final: finalScore(match, recents), match }))
    .sort((a, b) => {
      if (a.final !== b.final) return b.final - a.final;
      const byLabel = a.match.candidate.label.localeCompare(
        b.match.candidate.label,
      );
      if (byLabel !== 0) return byLabel;
      return a.match.candidate.id.localeCompare(b.match.candidate.id);
    })
    .map((entry) => entry.match);
}

/** What the palette draws. `recentCount` rows lead, and they are only ever the
 * recents on an empty query — a ranked list has no such division, because
 * dividing a ranked list is admitting the ranking was not one. */
export interface PaletteView {
  rows: PaletteMatch[];
  recentCount: number;
}

/** Assemble the view from an already-matched union.
 *
 * On an empty query the rows are **the recents the workspace still has, in the
 * order they were last run**, then everything else in the order the sources
 * produced it. That listing is the answer to "an empty query must not be an
 * empty box": a workspace with no history still shows its projects, its
 * worktrees, its panes and its actions, which is a map of what the palette is
 * for. */
export function assembleView(
  matches: readonly PaletteMatch[],
  query: string,
  recents: readonly string[],
): PaletteView {
  if (query !== "") {
    return { recentCount: 0, rows: rankMatches(matches, recents) };
  }
  const byId = new Map(matches.map((match) => [match.candidate.id, match]));
  const lead: PaletteMatch[] = [];
  for (const id of recents) {
    const match = byId.get(id);
    if (match !== undefined) {
      lead.push(match);
      byId.delete(id);
    }
  }
  return {
    recentCount: lead.length,
    rows: [...lead, ...matches.filter((match) => byId.has(match.candidate.id))],
  };
}

/** Where the cursor lands after a move, wrapping at both ends — a list you
 * cannot fall off is a list you can drive without looking at where you are.
 * An empty list has no cursor and answers 0. */
export function moveCursor(
  cursor: number,
  delta: number,
  rows: number,
): number {
  if (rows <= 0) return 0;
  return (((cursor + delta) % rows) + rows) % rows;
}
