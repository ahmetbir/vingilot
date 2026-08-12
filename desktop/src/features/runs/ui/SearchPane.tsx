// The Search pane: ⇧⌘F, a field, and results that are doors
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 2).
//
// > *"bugün işte ne için vscode açtım biliyor musun. projede cmd shift f yapıp
// > bir şey bulmak için."*
//
// **This component holds effects and layout, and no decisions.** What a refusal
// says, what "no matches" is allowed to be said about, how hits group into
// files, which part of a line is the match and what each key does are all in
// `lib/searchModel.ts`, where they are tested with no DOM. What is left here is
// the four things that genuinely need a browser: a field, a debounce, the one
// command, and putting the selected row in view.
//
// **A result is a door, and the door is the Files pane's.** Enter raises
// `onPaneAct({ type: "show-file", … })`, which `RunsScreen` answers by filing
// the target and choosing the Files pane — the route
// `vingilot/docs/plans/2026-08-12-files-pane-design.md` §6 built and named as
// the thing this task must not reimplement. There is no second viewer here and
// there must not be one.

import * as React from "react";

import type { PaneProps } from "@/features/runs/ui/paneRegistry";
import { humanCount } from "@/features/runs/lib/filesModel";
import { searchWorktree } from "@/features/runs/lib/searchClient";
import {
  emphasiser,
  hitFor,
  hitKey,
  resolveSearchListKey,
  type SearchHit,
  type SearchState,
  searchReading,
  stepHit,
} from "@/features/runs/lib/searchModel";
import { useSearchChord } from "@/features/runs/lib/useSearchChord";
import { labelParts } from "@/features/runs/lib/worktreeDiff";
import { OpenInEditor } from "@/features/runs/ui/OpenInEditor";
import { PaneEmpty } from "@/features/runs/ui/PaneEmpty";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

/** How long the field waits before asking git.
 *
 * **200 ms**, and it is a real bound rather than a nicety: every keystroke that
 * reached the backend would be a `git grep` over the whole checkout, and on his
 * monorepo that is seconds of work started and thrown away per character. It is
 * also short enough that a query typed at speed produces one search rather than
 * a pause he notices.
 *
 * **Kept honest by `workspace-search.spec.ts`, "a word typed at speed is ONE
 * search"** — which types the field rather than filling it and counts what the
 * backend was asked, because how many `git grep`s a word costs is not visible
 * on screen and every other spec here would draw the same results either way.
 * Set this to 0, or delete the timer, and that spec fails. */
const DEBOUNCE_MS = 200;

const NOTHING_ASKED: SearchState = { status: "idle" };

export function SearchPane({ cwd, onPaneAct }: PaneProps) {
  // `searchAvailability` has already refused a worktree with no directory, so
  // the frame is showing a sentence rather than this component. The guard is
  // for the type, and for the frames in between.
  if (cwd === null) return null;
  // **No `key` here, and that is deliberate.** A query and its results must not
  // outlive the worktree they are about — every path in an answer is relative
  // to *this* checkout, and carrying them across a switch would offer him
  // another worktree's `src/main.rs` under this one's name. That guarantee is
  // real and it belongs to `paneRegistry.tsx`, which declares this pane
  // `identity: ofWorktree` and remounts it per checkout for exactly this
  // reason. A second `key={cwd}` here looked like the guard and was not: with
  // the registry doing the work, nothing could tell a build that had it from
  // one that did not, so it was a defence no test could keep honest. One guard,
  // in the place that is tested.
  return <SearchBody cwd={cwd} onPaneAct={onPaneAct} />;
}

function SearchBody({
  cwd,
  onPaneAct,
}: {
  cwd: string;
  onPaneAct: PaneProps["onPaneAct"];
}) {
  const [query, setQuery] = React.useState("");
  const [regex, setRegex] = React.useState(false);
  const [state, setState] = React.useState<SearchState>(NOTHING_ASKED);
  const [selected, setSelected] = React.useState<string | null>(null);

  const field = React.useRef<HTMLInputElement | null>(null);
  // Focus the field when the pane arrives, which is the whole point of a chord
  // that opens it: ⇧⌘F and then typing has to work without a click.
  React.useEffect(() => {
    field.current?.focus();
  }, []);
  // **And again on every later ⇧⌘F.** The chord chooses this pane in
  // `RunsScreen`; when the pane is already up that is a no-op, and without this
  // the second press would do nothing while his hands were in the terminal.
  // Two listeners on one chord rather than a store to carry the request:
  // `stopPropagation` does not stop another listener on the same target in the
  // same phase, so both this one and the host's run.
  useSearchChord(
    React.useCallback(() => {
      field.current?.focus();
      field.current?.select();
    }, []),
  );

  // Which search is the current one, so an answer that arrives after he has
  // typed on is dropped rather than rendered under the query he is now looking
  // at. A counter rather than the pattern: retyping the same thing is a second
  // search and both answers are for a live question.
  const asked = React.useRef(0);

  React.useEffect(() => {
    const pattern = query;
    if (pattern === "") {
      asked.current += 1;
      setState(NOTHING_ASKED);
      setSelected(null);
      return;
    }
    // Not `setState({status:"searching"})` before the timer: a field he is
    // still typing into is not a search in progress, and saying so would put a
    // "searching for a…" under every first character.
    const timer = window.setTimeout(() => {
      asked.current += 1;
      const mine = asked.current;
      setState({ pattern, status: "searching" });
      void (async () => {
        const answered = await searchWorktree(cwd, pattern, regex);
        if (asked.current !== mine) return;
        if (!answered.ok) {
          setState({ error: answered.error, status: "refused" });
          setSelected(null);
          return;
        }
        setState({ answer: answered.value, status: "answered" });
        // The first hit is selected as the answer lands, so Enter straight
        // after typing opens something. A list with nothing selected is a list
        // that needs an arrow key before it is a keyboard at all.
        const first = answered.value.hits[0];
        setSelected(first === undefined ? null : hitKey(first));
      })();
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [cwd, query, regex]);

  const reading = searchReading(state);
  const hits: SearchHit[] = reading.show === "hits" ? reading.hits : [];

  const open = React.useCallback(
    (hit: SearchHit) => {
      // **The door, and it is the Files pane's** (files-pane design §6). The
      // pane does not read the file itself: one landing, reached from here the
      // same way the Diff pane's "show the whole file" button reaches it.
      onPaneAct({
        line: hit.line,
        path: hit.path,
        type: "show-file",
        worktree: cwd,
      });
    },
    [cwd, onPaneAct],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const action = resolveSearchListKey({
        altKey: event.altKey,
        inField: event.target === field.current,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event.nativeEvent),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action === null) return;
      if (hits.length === 0) return;
      event.preventDefault();
      if (action.type === "step") {
        setSelected(stepHit(hits, selected, action.to));
        return;
      }
      const hit = hitFor(hits, selected);
      if (hit !== null) open(hit);
    },
    [hits, open, selected],
  );

  return (
    // One handler for the field and the list together: he types, then walks
    // into the results with ↓ without tabbing anywhere. Which of the two has
    // focus is `inField`, and it decides exactly two keys (`searchModel.ts`).
    // `<search>` rather than a `<div role="search">`: it is the element for
    // exactly this — a field and the results it produces — and it is also what
    // lets the box carry a key handler at all, since a static element with an
    // `onKeyDown` and no role is what `noStaticElementInteractions` refuses.
    <search
      className="flex h-full min-h-0 flex-col"
      data-testid="pane-search"
      onKeyDown={onKeyDown}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-2 py-1">
        <input
          aria-label="search this worktree's checkout"
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          data-testid="search-input"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={regex ? "regular expression" : "text to find"}
          ref={field}
          spellCheck={false}
          type="text"
          value={query}
        />
        <button
          aria-pressed={regex}
          className={`shrink-0 rounded border px-1.5 py-0.5 text-2xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
            regex
              ? "border-foreground/40 bg-muted text-foreground"
              : "border-border/60 text-muted-foreground hover:text-foreground"
          }`}
          data-testid="search-regex-toggle"
          onClick={() => setRegex((on) => !on)}
          title="search as a POSIX extended regular expression instead of literal text"
          type="button"
        >
          .*
        </button>
      </div>

      {reading.show === "hits" ? (
        <>
          {reading.note === null ? null : (
            // **The cap, said out loud.** A search that silently truncates is a
            // search that lies about what is in the repository — Task 2's own
            // sentence, and the reason this is a paragraph rather than a
            // tooltip.
            <p
              className="shrink-0 border-b border-border/60 px-2 py-1 text-2xs text-foreground"
              data-testid="search-capped"
            >
              {reading.note}
            </p>
          )}
          <Results
            cwd={cwd}
            groups={reading.groups}
            onOpen={open}
            pattern={state.status === "answered" ? state.answer.pattern : ""}
            regex={state.status === "answered" && state.answer.regex}
            selected={selected}
          />
        </>
      ) : reading.show === "idle" ? (
        // Nothing asked yet is the pane's one designed moment (`PaneEmpty`) —
        // the sentence is the model's own (`IDLE_NOTE`), unchanged. The other
        // three readings below stay plain: `searching` is a wait, `refused`
        // and `empty` are answers to be read.
        <PaneEmpty
          glyph="⌕"
          hint="⇧⌘F from anywhere · ↓ walks the results"
          sentence={reading.note}
          testid="search-idle"
        />
      ) : (
        // One element for the other three readings, with the testid saying
        // which one it is — the distinction that matters is `searching` against
        // `empty`, and it is `searchModel.ts` that makes it: "no matches" is
        // only ever reachable from an answer git actually gave.
        <p
          className="p-3 text-xs text-muted-foreground"
          data-testid={`search-${reading.show}`}
        >
          {reading.note}
        </p>
      )}
    </search>
  );
}

function Results({
  cwd,
  groups,
  onOpen,
  pattern,
  regex,
  selected,
}: {
  /** The checkout every hit's path is relative to — the escape hatch's other
   * half of a target, and the reason this is threaded down rather than derived:
   * a result set survives no worktree switch (`SearchBody` re-runs), so the
   * `cwd` a row was drawn under is the one its path belongs to. */
  cwd: string;
  groups: { path: string; hits: SearchHit[] }[];
  onOpen: (hit: SearchHit) => void;
  pattern: string;
  regex: boolean;
  selected: string | null;
}) {
  // **One measurer per render pass, deliberately not memoised.** It carries the
  // time budget `searchModel.ts` bounds the second engine with, and that budget
  // has to be spent per *pass*: memoised across renders it would be exhausted
  // once and every later render of the same answer — every arrow key — would
  // silently draw the whole list plain.
  //
  // **Kept honest by `workspace-search.spec.ts`, "emphasis survives arrow keys
  // down a long answer"**: it serves an answer long enough to exhaust the
  // budget on the first draw and then walks it with ↓, so wrapping this line in
  // a `useMemo` — which looks like an obvious win — fails there rather than
  // shipping.
  const measure = emphasiser(pattern, regex);
  const box = React.useRef<HTMLDivElement | null>(null);
  // The selected row into view, which is what makes ↓ a way of reading a long
  // list rather than a way of moving something off screen. Queried out of the
  // DOM rather than held as a ref per row: there can be two thousand of them.
  React.useEffect(() => {
    if (selected === null) return;
    const found = box.current?.querySelector(
      `[data-hit="${CSS.escape(selected)}"]`,
    );
    found?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    // `role="listbox"` with a moving `aria-activedescendant` and no tab stop of
    // its own: focus stays in the field, which is where he is typing, and the
    // keys are handled by the pane above. A tab stop per row would cost two
    // thousand tabs to get past.
    <div
      aria-activedescendant={
        selected === null ? undefined : `search-hit-${selected}`
      }
      aria-label="search results"
      className="min-h-0 flex-1 overflow-auto py-1"
      data-testid="search-results"
      ref={box}
      role="listbox"
      // -1, not 0: the box has to be focusable for `aria-activedescendant` to
      // mean anything, and it must not be a Tab stop — focus stays in the
      // field, which is where he is typing.
      tabIndex={-1}
    >
      {groups.map((group) => {
        // The shared truncation rule, on the group header too: the directory
        // dims and gives way, the basename stays bright — a hundred hits under
        // `src/features/runs/` are told apart by exactly the half a tail
        // truncation eats.
        const parts = labelParts(group.path);
        return (
          <div key={group.path}>
            <p
              className="sticky top-0 flex items-baseline bg-background px-2 py-0.5 text-2xs"
              data-testid={`search-file-${group.path}`}
              title={group.path}
            >
              {parts.lead === "" ? null : (
                <span className="min-w-0 truncate text-muted-foreground">
                  {parts.lead}
                </span>
              )}
              <span className="max-w-full shrink-0 truncate text-foreground">
                {parts.name}
              </span>
              <span className="ml-1 shrink-0 tabular-nums text-muted-foreground">
                · {humanCount(group.hits.length)}
              </span>
            </p>
            {group.hits.map((hit) => {
              const key = hitKey(hit);
              const measured = measure(hit);
              return (
                // **A wrapper, because a button may not contain a button.** The
                // hit row stays exactly what it was — one full-width control
                // that lands in the viewer — and the escape hatch sits beside
                // it, revealed on hover the way `WorktreeRow`'s × is. Putting
                // it inside the row would be invalid HTML and would also make
                // Enter on a walked row ambiguous.
                <div className="group flex items-baseline" key={key}>
                  <button
                    aria-selected={key === selected}
                    className={`flex w-full items-baseline gap-2 px-2 py-0.5 text-left font-mono text-2xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
                      key === selected
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/60"
                    }`}
                    data-hit={key}
                    data-testid={`search-hit-${key}`}
                    id={`search-hit-${key}`}
                    onClick={() => onOpen(hit)}
                    role="option"
                    tabIndex={-1}
                    type="button"
                  >
                    <span className="w-10 shrink-0 text-right tabular-nums opacity-70">
                      {hit.line}
                    </span>
                    <span className="truncate">
                      {/* The clip is the backend's, and it is said rather than
                        left to look like the file: a minified bundle's line is
                        three megabytes and what is shown is a window on the
                        match. */}
                      {hit.clipped ? <span aria-hidden="true">…</span> : null}
                      {measured.before}
                      {measured.match === "" ? null : (
                        // The one hue every editor uses for a find match — the
                        // amber wash `badge.tsx`'s warning variant already
                        // speaks — on top of the weight the emphasis already
                        // had. Colour carrying information, not decoration.
                        <mark
                          className="rounded-sm bg-amber-500/25 font-semibold text-foreground"
                          data-testid="search-hit-match"
                        >
                          {measured.match}
                        </mark>
                      )}
                      {measured.after}
                    </span>
                  </button>
                  {/* file:line, straight out of the hit — which is the whole
                    point of the rung and the thing `open -a` cannot carry. */}
                  <OpenInEditor
                    line={hit.line}
                    path={hit.path}
                    reveal
                    testid={`search-open-in-editor-${key}`}
                    worktree={cwd}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
