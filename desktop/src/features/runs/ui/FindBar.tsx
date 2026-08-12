// The find bar: VS Code's spot, VS Code's keys, this app's vocabulary
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 1).
//
// **Top-right, floating over the body.** That is where VS Code puts it and where
// his eye goes, and it is over the text rather than above it for the reason the
// Files pane exists to respect: at his 1728px the pane is ~435px wide and about
// 30 lines tall, and a bar that pushed the file down would cost him a line of
// the thing he is searching every time he searched it. The trade is stated: it
// covers the top-right corner of the first two lines. `top-1 right-1` rather than
// flush, so the border reads as a floating panel and not as a torn header.
//
// **It holds no state and decides nothing.** The match set, the walk, the label
// and the keys are `findInFile.ts` and `findKeys.ts`, reached through
// `useFindInFile`. What is here is the arrangement.

import * as React from "react";

import type { FindInFile } from "@/features/runs/lib/useFindInFile";

/** Said in the field's own title, which is where he is when the question comes
 * up. **Smart case is a rule he cannot see the effect of** — a lower-case query
 * matching a capital looks like a bug until you know the rule — and the plan asks
 * for it in a title rather than as a third control, because a case toggle is one
 * more thing to get into the wrong position. */
const SMART_CASE_TITLE =
  "Find in this file. Smart case: matches either case until you type a capital letter, then it matches exactly. Enter for the next match, ⇧Enter for the previous, Esc to close.";

/** The walk controls and the close, drawn as the island draws a small control:
 * `text-xs`, hover on the ground, focus visible as an inset ring so nothing
 * moves. */
const STEP_CLASS =
  "rounded-sm px-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-transparent";

export function FindBar({ find }: { find: FindInFile }) {
  const field = React.useRef<HTMLInputElement | null>(null);

  // Every ⌘F puts the caret in the field and selects what is already there —
  // including the press that opened it. `find.opened` counts presses rather than
  // being a boolean, so the second press is a change this effect can see; a
  // boolean would fire once and then never again, which is the "⌘F does nothing
  // the second time" defect every find bar has had.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `find.opened` is not read inside the effect — it IS the effect's trigger. It counts chord presses, and re-selecting the field on the second ⌘F is the whole reason it is a number rather than a boolean. Dropping it would run this once, on mount, and never again.
  React.useEffect(() => {
    const input = field.current;
    if (input === null) return;
    input.focus();
    input.select();
  }, [find.opened]);

  const empty = find.query === "";
  return (
    <div
      className="absolute right-1 top-1 z-20 flex items-center gap-1 rounded-md border border-border/60 bg-background px-1.5 py-1 shadow-lg"
      data-testid="files-find"
    >
      <input
        aria-label="find in this file"
        className="w-32 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
        data-testid="files-find-input"
        onChange={(event) => find.setQuery(event.target.value)}
        onKeyDown={find.onFieldKeyDown}
        placeholder="find"
        ref={field}
        spellCheck={false}
        title={SMART_CASE_TITLE}
        type="text"
        value={find.query}
      />
      {/* The count, in the meta voice every number in this pane speaks:
          `text-2xs tabular-nums`, so `9/10` and `10/10` do not shift the
          controls beside them. Nothing at all until he has typed — a bar that
          said "no results" before a query existed would be reporting on a search
          nobody ran. */}
      <span
        className="min-w-10 shrink-0 text-right text-2xs tabular-nums text-muted-foreground"
        data-testid="files-find-count"
      >
        {empty ? "" : find.label}
      </span>
      <button
        aria-label="previous match"
        className={STEP_CLASS}
        data-testid="files-find-previous"
        disabled={find.matches.length === 0}
        onClick={() => find.walk(-1)}
        title="previous match (⇧Enter)"
        type="button"
      >
        <span aria-hidden="true">↑</span>
      </button>
      <button
        aria-label="next match"
        className={STEP_CLASS}
        data-testid="files-find-next"
        disabled={find.matches.length === 0}
        onClick={() => find.walk(1)}
        title="next match (Enter)"
        type="button"
      >
        <span aria-hidden="true">↓</span>
      </button>
      <button
        aria-label="close find"
        className={STEP_CLASS}
        data-testid="files-find-close"
        onClick={find.close}
        title="close (Esc)"
        type="button"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
