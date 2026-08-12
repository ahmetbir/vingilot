// Search results, as data: what a hit is, how hits stack into the rows that are
// drawn, which part of a line is the match, and what the pane says in each of
// the four states it can be in
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 2).
//
// **Nothing here touches React, Tauri or a subprocess.** `searchClient.ts` puts
// the one command, `SearchPane.tsx` holds the field, the debounce and the
// layout, and every decision either of them makes is a call into this file —
// which is what makes the decisions testable at all. The same split
// `filesModel.ts`, `paneModel.ts` and `terminalKeys.ts` use.
//
// **Four states, not two, and the fourth is the one Task 2 insists on.**
// `idle`, `searching`, `refused` and `answered` are kept apart all the way to
// the sentence that is drawn, because *"no matches"* is a claim about the
// repository and only an answer entitles anybody to make it. A pane that
// rendered an empty list while the search was still running would be saying
// there is nothing there, on the strength of not having been told yet — which
// is the house rule this island has already broken twice.

import { humanCount } from "@/features/runs/lib/filesModel";
import type { KeyInput } from "@/features/runs/lib/terminalKeys";

/** One matching line, exactly as `vingilot_search::grep::SearchHit`
 * serialises it. */
export interface SearchHit {
  /** Worktree-relative — the same string `file_read` takes, which is what makes
   * a result a door rather than a label. */
  path: string;
  /** 1-based. */
  line: number;
  /** **A 0-based character offset into `text`.** The backend converted git's
   * 1-based byte column, because it is the side that still had the bytes. */
  column: number;
  text: string;
  /** The line was longer than the backend's per-line window and `text` is a
   * slice of it, placed on the match. */
  clipped: boolean;
}

/** One search's answer, with the bounds it was produced under. */
export interface SearchAnswer {
  pattern: string;
  regex: boolean;
  hits: SearchHit[];
  /** There were more matches than are here. */
  capped: boolean;
  limit: number;
}

/** Why a search did not answer. The mirror of `vingilot_search::SearchError`;
 * the words are `searchRefusal` below, so the backend owns the facts and this
 * file owns the copy. */
export type SearchError =
  | { kind: "git-missing" }
  | { kind: "not-a-repo"; path: string }
  | { kind: "empty-pattern" }
  | { kind: "timed-out"; seconds: number }
  | { kind: "git-failed"; command: string; stderr: string };

const KINDS = new Set([
  "empty-pattern",
  "git-failed",
  "git-missing",
  "not-a-repo",
  "timed-out",
]);

/** Read a rejected `invoke`'s payload as a refusal, or `null` when it is not
 * one of ours. A shape this build cannot read must not be silently turned into
 * a refusal it never received — the caller reports it as the bridge failing,
 * which is what it is. */
export function readSearchError(thrown: unknown): SearchError | null {
  if (typeof thrown !== "object" || thrown === null) return null;
  const kind = (thrown as { kind?: unknown }).kind;
  if (typeof kind !== "string" || !KINDS.has(kind)) return null;
  return thrown as SearchError;
}

/** **Each refusal is its own sentence**, for the reason the Files pane gives:
 * the next action differs for each, and one sentence covering all of them is a
 * sentence he can do nothing with.
 *
 * `git-failed` carries git's own words *verbatim*. An unbalanced bracket in a
 * regex is a thing git already says better than this file could, and putting a
 * paraphrase in front of it would mean he reads this app's opinion of his
 * mistake instead of the mistake. */
export function searchRefusal(error: SearchError): string {
  switch (error.kind) {
    case "git-missing":
      return "no git on this machine answers --version, and this search is git's — there is nothing here that can read the checkout.";
    case "not-a-repo":
      return `${error.path} is not a git repository, so there is no checkout here to search.`;
    case "empty-pattern":
      return "type something to search for — an empty pattern matches every line of every file, which is not an answer.";
    case "timed-out":
      return `this search ran past ${error.seconds} seconds and was stopped. A pattern that has to look at every line of a large repository is one for the terminal one pane over.`;
    case "git-failed":
      return `${error.command} refused: ${error.stderr.trim()}`;
  }
}

/** The sentence for a capped answer.
 *
 * **It counts what he really got rather than repeating the limit**, and that is
 * deliberate: the cap can also be reached by the backend's byte budget, where
 * the number of hits returned is whatever fitted rather than exactly `limit`.
 * "Capped at 2,000" under a list of 1,143 rows would be a sentence the screen
 * itself contradicts. */
export function cappedNote(answer: SearchAnswer): string | null {
  if (!answer.capped) return null;
  return `stopped at ${humanCount(answer.hits.length)} matches — there are more in this checkout than this list shows. Narrow the search, or use the terminal.`;
}

/** What a field with nothing in it says. Not "no matches": nothing has been
 * asked. */
export const IDLE_NOTE = "type to search this worktree's checkout.";

/** What an answer of nothing says — and it is only ever reachable from an
 * answer. */
export const NO_MATCHES = "no matches.";

/** One file's hits, in the order git printed them. */
export interface SearchGroup {
  path: string;
  hits: SearchHit[];
}

/** Hits grouped by the file they are in, **each file kept in the order git
 * first mentioned it** rather than sorted.
 *
 * Not sorted, because `git grep` walks the index, which is sorted by path
 * already — re-sorting would be doing again, in a second place, something that
 * is already true, and would then differ from it the first time a path sorted
 * differently in JavaScript's collation than in git's byte order. A group is
 * re-opened rather than started twice if git ever does interleave, which
 * `--untracked` can produce: tracked files come first, then untracked ones, and
 * a file could in principle appear in both halves. */
export function groupHits(hits: readonly SearchHit[]): SearchGroup[] {
  const groups: SearchGroup[] = [];
  const byPath = new Map<string, SearchGroup>();
  for (const hit of hits) {
    const found = byPath.get(hit.path);
    if (found === undefined) {
      const group: SearchGroup = { hits: [hit], path: hit.path };
      byPath.set(hit.path, group);
      groups.push(group);
      continue;
    }
    found.hits.push(hit);
  }
  return groups;
}

/** A hit's identity for the purpose of a selection, and its element id.
 *
 * **The line comes first, which is what makes it unambiguous.** A path may
 * contain anything, including a colon, so `<path>:<line>` has two readings for
 * a file called `a.rs:1`; `<line>:<path>` has one, because everything before
 * the first colon is digits. It is one string rather than a pair because
 * `aria-activedescendant` names an element by id, and one hit is one row.
 *
 * There is exactly one hit per (file, line): `git grep` prints one record per
 * matching *line*, however many times the pattern occurs in it - which is also
 * why nothing here has to tell two matches on one line apart. */
export function hitKey(hit: SearchHit): string {
  return `${hit.line}:${hit.path}`;
}

/** Where the selection goes.
 *
 * A selection whose hit is gone — a new answer arrived, he retyped — lands on
 * the first row rather than on nothing: a list with no selection has no
 * keyboard, and this is the case that produces one without anybody choosing it.
 *
 * **Deliberately does not wrap.** A list that jumped from its last row to its
 * first on one more ↓ would move him somewhere he did not ask to be, and the
 * ends of a list are a useful thing to feel. The same rule the file tree
 * follows. */
export function stepHit(
  hits: readonly SearchHit[],
  selected: string | null,
  to: "first" | "last" | "next" | "previous",
): string | null {
  if (hits.length === 0) return null;
  const keys = hits.map(hitKey);
  if (to === "first") return keys[0];
  if (to === "last") return keys[keys.length - 1];
  const at = selected === null ? -1 : keys.indexOf(selected);
  if (at < 0) return keys[0];
  const next = to === "next" ? at + 1 : at - 1;
  if (next < 0 || next >= keys.length) return selected;
  return keys[next];
}

export function hitFor(
  hits: readonly SearchHit[],
  selected: string | null,
): SearchHit | null {
  if (selected === null) return null;
  return hits.find((hit) => hitKey(hit) === selected) ?? null;
}

/** The most characters of one line the owner's own regular expression is ever
 * run against.
 *
 * **Sixteen, and the number is measured rather than picked.** A backtracking
 * engine's cost explodes with the length of what it *fails* to match, and this
 * engine runs on the thread that draws the workspace — nothing here can
 * interrupt an `exec` once it has started, so the only bound available is on
 * what it is handed. Measured on this machine with the repository's own node,
 * the classic catastrophic patterns (`(a+)+b`, `(a|a)*b`, `(a*)*b`) against a
 * line of sixteen characters cost **0.6 ms**; at twenty-four, 153 ms; at
 * thirty-two, **fifteen seconds**.
 *
 * **A cheap probe was tried instead and the measurements refuted it.** Running
 * the pattern against a short prefix first and then against the whole line if
 * that was fast sounds like it keeps both the bound and the feature — but
 * `a*a*a*a*a*b` costs 0.26 ms at twenty characters and more than fifteen
 * seconds at four hundred. Cost at a short length predicts nothing about cost
 * at a long one, so the long one is never run at all.
 *
 * What this costs him: in regex mode a match longer than this window is drawn
 * plain rather than bold, because this engine never saw where it ended. That is
 * the degradation this file already calls the correct one — the row is still a
 * row, and an emphasis in the wrong place is worse than none. */
const REGEX_WINDOW = 16;

/** The most wall-clock one render pass may spend measuring emphases.
 *
 * [`REGEX_WINDOW`] bounds one line; this bounds two thousand of them. About one
 * frame, checked *before* each match rather than after, so a pass costs at most
 * this plus one windowed match. When it is gone the rest of the answer is drawn
 * plain — the same degradation, applied to the list instead of to the line. */
const REGEX_BUDGET_MS = 20;

/** The matching line, split into what is before the match, the match, and what
 * is after it. */
export interface Emphasis {
  before: string;
  match: string;
  after: string;
}

/** How many characters of `rest` the match takes, or `null` when this engine
 * cannot say. */
type Measure = (rest: string) => number | null;

/** A measurer for **one answer, drawn once** — and the reason the budget above
 * can exist at all.
 *
 * **The column is git's and is authoritative; the length is a second opinion
 * and can only affect how many characters are emphasised.** That distinction is
 * the whole design here:
 *
 * - *Literal search.* The pattern **is** the match, so the length is known
 *   exactly, and no second engine runs. The slice is compared against the
 *   pattern before it is used — on a clipped line, or if the backend and this
 *   file ever disagreed about what a character is, an emphasis in the wrong
 *   place is worse than none.
 * - *Regex search.* git ran a POSIX ERE and this file has an ECMAScript
 *   engine. They agree on what people type — classes, `+`, `*`, `|`, groups,
 *   anchors — and differ at the edges: ERE has backreferences JS spells
 *   differently, JS has `\d` and `\w` that ERE lacks, ERE has `[[:alpha:]]`
 *   that JS does not. So the pattern is compiled here **only to measure the
 *   match**, anchored at the column git already found, bounded by
 *   [`REGEX_WINDOW`] and [`REGEX_BUDGET_MS`], and where it will not compile,
 *   does not match there, or costs more than it is worth, the emphasis is
 *   dropped and the line is still a result. A second engine that can change
 *   *which lines are results* would be a second opinion about the repository;
 *   one that can only change which characters are bold is a rendering detail —
 *   and a rendering detail is not allowed to freeze the workspace.
 *
 * Compiled once for the whole answer rather than once per hit, which is also
 * two thousand `new RegExp` calls that no longer happen per render pass.
 *
 * `now` is injected so the budget can be driven from a test without a
 * pathological pattern and without a clock nobody controls. */
export function emphasiser(
  pattern: string,
  regex: boolean,
  now: () => number = () => performance.now(),
): (hit: SearchHit) => Emphasis {
  const measure = regex ? regexMeasure(pattern, now) : literalMeasure(pattern);
  return (hit) => split(hit, measure);
}

/** One hit's emphasis, on a budget of its own. The unit `emphasiser` is built
 * from, and what the tests below drive: a single call is bounded by
 * [`REGEX_WINDOW`] whatever the budget says. */
export function emphasis(
  hit: SearchHit,
  pattern: string,
  regex: boolean,
): Emphasis {
  return emphasiser(pattern, regex)(hit);
}

/** `match` is `""` when nothing could be measured, which the renderer draws as
 * a plain line. */
function split(hit: SearchHit, measure: Measure): Emphasis {
  const chars = [...hit.text];
  const plain = { after: "", before: hit.text, match: "" };
  if (hit.column < 0 || hit.column >= chars.length) return plain;
  const before = chars.slice(0, hit.column).join("");
  const rest = chars.slice(hit.column).join("");

  const length = measure(rest);
  if (length === null || length <= 0) return plain;

  const restChars = [...rest];
  return {
    after: restChars.slice(length).join(""),
    before,
    match: restChars.slice(0, length).join(""),
  };
}

/** How many characters of `rest` the literal pattern takes, or `null` when what
 * is at the column is not the pattern after all — which a clipped line can
 * produce, and which must be drawn as no emphasis rather than as a highlight
 * over the wrong characters. */
function literalMeasure(pattern: string): Measure {
  return (rest) => {
    if (pattern === "") return null;
    return rest.startsWith(pattern) ? [...pattern].length : null;
  };
}

/** How many characters of `rest` the regex matches at its start, or `null` when
 * this engine cannot say — or may not spend what saying it would cost. */
function regexMeasure(pattern: string, now: () => number): Measure {
  let compiled: RegExp | null;
  try {
    // `y` (sticky) rather than `^`: anchoring by rewriting the owner's pattern
    // would change what it means for any pattern that is itself anchored or
    // alternated — `^a|b` with a `^` glued on is a different expression.
    compiled = new RegExp(pattern, "y");
  } catch {
    compiled = null;
  }
  let spent = 0;

  return (rest) => {
    if (compiled === null) return null;
    // Before the match, not after it: checked afterwards, the pass would cost
    // the budget plus however long the call that overran it took, which is the
    // unbounded number this whole design exists to not have.
    if (spent >= REGEX_BUDGET_MS) return null;

    const chars = [...rest];
    const whole = chars.length <= REGEX_WINDOW;
    const window = whole ? rest : chars.slice(0, REGEX_WINDOW).join("");

    const started = now();
    compiled.lastIndex = 0;
    const found = compiled.exec(window);
    spent += now() - started;

    if (found === null || found.index !== 0) return null;
    const length = [...found[0]].length;
    // A match that runs to the edge of a window that is not the whole line is a
    // match whose end this engine never saw: on the rest of the line it could
    // go further, so emphasising exactly this much would be a claim about where
    // the match ends that nothing here checked.
    if (!whole && length >= REGEX_WINDOW) return null;
    return length;
  };
}

/** Where the pane has got to. */
export type SearchState =
  | { status: "idle" }
  | { status: "searching"; pattern: string }
  | { status: "answered"; answer: SearchAnswer }
  | { status: "refused"; error: SearchError };

/** What the pane draws, decided here so the one rule Task 2 puts hardest is
 * tested without a browser: **"no matches" is only ever reachable from an
 * answer.**
 *
 * `note` on a `hits` reading is the capped sentence or `null`. Everything else
 * carries the whole of what is said. */
export type SearchReading =
  | { show: "idle"; note: string }
  | { show: "searching"; note: string }
  | { show: "refused"; note: string }
  | { show: "empty"; note: string }
  | {
      show: "hits";
      groups: SearchGroup[];
      hits: SearchHit[];
      note: string | null;
    };

export function searchReading(state: SearchState): SearchReading {
  if (state.status === "idle") return { note: IDLE_NOTE, show: "idle" };
  if (state.status === "searching") {
    return {
      // Named, because two searches deep he cannot tell which one is still
      // running — and a spinner with no subject is a spinner about the app
      // rather than about his question.
      note: `searching for ${state.pattern}…`,
      show: "searching",
    };
  }
  if (state.status === "refused") {
    return { note: searchRefusal(state.error), show: "refused" };
  }
  const hits = state.answer.hits;
  if (hits.length === 0) return { note: NO_MATCHES, show: "empty" };
  return {
    groups: groupHits(hits),
    hits,
    note: cappedNote(state.answer),
    show: "hits",
  };
}

/** One keydown in the results list, resolved.
 *
 * **Bound to the list's own container, never to the window.** An unmodified
 * arrow belongs to whatever has focus, and a global arrow binding would move a
 * result selection while he was moving a cursor in the terminal one pane over —
 * the rule `paneKeys.ts` states for the divider and `filesModel.ts` for the
 * tree, for the same reason.
 *
 * Any chord falls through untouched, so ⇧⌘F itself still reaches the window
 * handler while the field has focus. */
export type SearchListAction =
  | { type: "step"; to: "first" | "last" | "next" | "previous" }
  | { type: "open" };

/** Whether the caret is in the search field. The same extra fact
 * `resolveDiffKey` takes, and here it decides exactly two keys.
 *
 * **↑ and ↓ are claimed even in the field, and Home/End are not.** A
 * single-line input has nothing above or below the caret, so an arrow there is
 * dead — claiming it is what lets him type a query and walk into the results
 * without reaching for the mouse or the Tab key. `Home` and `End` are not dead
 * in a field: they move the caret to the ends of what he has typed, which is
 * how every text field on this machine behaves, and taking that to jump a
 * result list would be this pane deciding his editing keys mean something else. */
export interface SearchListInput extends KeyInput {
  inField: boolean;
}

export function resolveSearchListKey(
  input: SearchListInput,
): SearchListAction | null {
  if (input.primaryModifier) return null;
  if (input.altKey === true) return null;
  switch (input.key) {
    case "ArrowDown":
      return { to: "next", type: "step" };
    case "ArrowUp":
      return { to: "previous", type: "step" };
    case "Home":
      return input.inField ? null : { to: "first", type: "step" };
    case "End":
      return input.inField ? null : { to: "last", type: "step" };
    case "Enter":
      return { type: "open" };
    default:
      return null;
  }
}
