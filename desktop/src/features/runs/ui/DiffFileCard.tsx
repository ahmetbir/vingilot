// One file of a diff, as the mockup's `.fcard` (DIFF-TAB-BRIEF §3).
//
// > "Each file is its own rounded elevated card — `border-radius:11px`,
// > `#17171a`, hairline border, soft shadow. **`flex:none`** so cards keep
// > intrinsic height and the scroller scrolls."
//
// The `flex:none` is called out in the brief because it bit the mockup, and it
// is the reason this component exists as a component: a card is a flex CHILD of
// `.dvscroll`, and a flex child's default `min-height:auto` plus `flex:1` is
// the squash-and-clip the brief warns about. `shrink-0` is the Tailwind
// spelling and it is on the outermost box below, where nothing can take it off.
//
// **The header is a row containing a button, not a button containing icons.**
// The brief's "icon buttons must not trigger the collapse" is a structural
// requirement, not a `stopPropagation` one: HTML forbids a button inside a
// button, and the mockup's own JS has to special-case `.ficon` for exactly
// this reason. Here the collapse control is one child of the row and the two
// icon buttons are siblings of it, so a click on either was never a click on
// the collapse.
//
// **The testids are P4.4's, kept.** `history-file-row-*`, `history-file-note-*`
// and `history-patch-*` named the commit patch's per-file rows before this
// round and name the same three things after it — a card IS what that row was
// growing into. Renaming them would have cost every spec that reads a commit's
// files for nothing.

import * as React from "react";
import { toast } from "sonner";

import { ratioBlocks } from "@/features/runs/lib/diffTab";
import type { WordMarkup } from "@/features/runs/lib/diffTab";
import { fileIconId } from "@/features/runs/lib/fileIcons";
import type { DiffRow } from "@/features/runs/lib/unifiedDiff";
import {
  changeLabel,
  type DiffFile,
  type DiffLimits,
  fileNote,
  labelParts,
} from "@/features/runs/lib/worktreeDiff";
import { FileIcon } from "@/features/runs/ui/FileIcon";
import { OpenInEditor } from "@/features/runs/ui/OpenInEditor";
import type { LineRowData } from "@/features/runs/ui/PatchUnified";
import { PatchView } from "@/features/runs/ui/PatchView";
import { RatioBar } from "@/features/runs/ui/RatioBar";
import type { DiffMode } from "@/features/runs/lib/diffMode";

/** Every card is windowed against the same scroller, so the numbers it needs
 * are the scroller's — measured once by `DiffTab` and handed down rather than
 * read from the DOM by each card on every scroll frame. The element comes with
 * them because "where does this card start inside the scrolled content" is a
 * question only the card and the scroller together can answer. */
export interface ScrollView {
  el: HTMLElement | null;
  scrollTop: number;
  viewport: number;
}

export function DiffFileCard({
  cwd,
  file,
  focused,
  limits,
  markup,
  mode,
  onComment,
  onToggle,
  open,
  renderAfter,
  rows,
  scroll,
  wraps,
}: {
  /** The checkout this path is relative to, or `null` before one resolves —
   * then the card draws no editor door, the same rule `WorktreeDiffPanel`'s
   * file list keeps. */
  cwd: string | null;
  file: DiffFile;
  /** The row the keyboard is on, or `null` when it is on another card's. */
  focused: number | null;
  limits: DiffLimits;
  markup: WordMarkup;
  mode: DiffMode;
  onComment: ((row: number) => void) | undefined;
  onToggle: () => void;
  open: boolean;
  renderAfter: (row: LineRowData, index: number) => React.ReactNode;
  rows: readonly DiffRow[];
  scroll: ScrollView | null;
  wraps: boolean;
}) {
  const parts = labelParts(file.path);
  const note = fileNote(file, limits);
  // Where this card's patch starts inside the scroller's content, for the
  // windowing arithmetic. Measured in a layout effect rather than read during
  // render, and re-measured whenever anything that could move it changes — the
  // card opening or closing, its row count, or the scroller resizing.
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const [top, setTop] = React.useState(0);
  const scroller = scroll?.el ?? null;
  const rowCount = rows.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `open` and `rowCount` are what MOVE this card inside the scroller; the effect re-measures because they changed, it does not read them
  React.useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body === null || scroller === null) return;
    // Distance from the top of the SCROLLED CONTENT, which is what the window
    // arithmetic is in. `offsetTop` would be relative to whichever ancestor
    // happens to be positioned; two rects and the current scroll offset are
    // relative to the one box that matters.
    const measure = () =>
      setTop(
        body.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(body);
    return () => observer.disconnect();
  }, [open, rowCount, scroller]);

  return (
    <div
      // `shrink-0` IS the brief's `flex:none`. `overflow-hidden` so the header's
      // ground is clipped by the 11px radius rather than squaring its corners.
      className="shrink-0 overflow-hidden rounded-[11px] border border-border/60 bg-[#17171a] shadow-[0_6px_20px_rgba(0,0,0,.25)]"
      data-diff-card={file.path}
    >
      <div className="flex items-center gap-2 border-b border-border/60 bg-foreground/[.028] px-3 py-2">
        <button
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          data-testid={`history-file-row-${file.path}`}
          onClick={onToggle}
          type="button"
        >
          <span
            aria-hidden="true"
            className={`w-2.5 shrink-0 text-2xs text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
          >
            ▾
          </span>
          {/* P4.1's language icon set, not the mockup's lettered chip — the
              owner overruled the mockup there in as many words and
              `fileIcons.ts`'s header carries the licence. */}
          <FileIcon id={fileIconId(file.path)} />
          {/* The shared truncation rule: the directory dims and gives way, the
              basename stays bright (`labelParts`). */}
          <span
            className="flex min-w-0 items-baseline font-mono text-xs"
            title={file.path}
          >
            {parts.lead === "" ? null : (
              <span className="min-w-0 truncate text-muted-foreground">
                {parts.lead}
              </span>
            )}
            <span className="max-w-full shrink-0 truncate font-semibold text-foreground">
              {parts.name}
            </span>
          </span>
          {/* The mockup's status label. Drawn only where git said something
              beyond "modified", which every card in a diff already is — a
              badge on every row is a badge that says nothing. */}
          {file.change === "modified" ? null : (
            <span
              className="shrink-0 rounded-[9px] bg-foreground/10 px-2 text-badge font-semibold text-foreground/80"
              data-diff-change={file.change}
            >
              {changeLabel(file.change)}
            </span>
          )}
          <span className="ml-auto shrink-0 font-mono text-2xs tabular-nums">
            {file.binary ? (
              <span className="text-muted-foreground">bin</span>
            ) : (
              <>
                <span className="text-status-added">+{file.additions}</span>{" "}
                <span className="vingilot-numstat-del">−{file.deletions}</span>
              </>
            )}
          </span>
          <RatioBar
            blocks={ratioBlocks(file.additions, file.deletions, 3)}
            title={`${file.additions} added, ${file.deletions} removed`}
          />
        </button>
        <button
          aria-label={`copy the path of ${file.path}`}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-testid={`diff-copy-path-${file.path}`}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(file.path)
              .then(() => toast.success("Path copied"))
              .catch(() => toast.error("This machine refused the clipboard."));
          }}
          title="Copy path"
          type="button"
        >
          <svg
            aria-hidden="true"
            fill="none"
            height="13"
            stroke="currentColor"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
            width="13"
          >
            <rect height="11" rx="2" width="11" x="9" y="9" />
            <path d="M5 15V5a2 2 0 0 1 2-2h8" />
          </svg>
        </button>
        {cwd === null || file.change === "deleted" ? null : (
          // The mockup's open-in-editor icon, and it is this app's existing
          // one: the editor list, the refusal sentence and the "reveal" verb
          // are all `OpenInEditor`'s, so a card offers exactly what every other
          // file row in the workspace offers.
          <OpenInEditor
            line={null}
            path={file.path}
            reveal
            testid={`diff-open-in-editor-${file.path}`}
            worktree={cwd}
          />
        )}
      </div>
      {open ? (
        <div ref={bodyRef}>
          {note === null ? null : (
            <p
              className="border-b border-border/60 bg-muted/40 px-3 py-1 text-2xs text-muted-foreground"
              data-testid={`history-file-note-${file.path}`}
            >
              {note}
            </p>
          )}
          {file.patch === "" ? null : (
            <PatchView
              focused={focused}
              markup={markup}
              mode={mode}
              onComment={onComment}
              patch={file.patch}
              path={file.path}
              renderAfter={renderAfter}
              rows={rows}
              testid={`history-patch-${file.path}`}
              window={
                scroll === null
                  ? undefined
                  : {
                      scrollTop: scroll.scrollTop,
                      top,
                      viewport: scroll.viewport,
                    }
              }
              wraps={wraps}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
