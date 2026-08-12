// "Open in editor" — the one control, drawn wherever a file is shown
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 1; ADR-005 rung 3).
//
// > *"Sending the owner to VS Code deliberately beats losing him to it."*
//
// **One component and four callers**, which is the point rather than tidiness:
// the Files viewer's header, a search hit, a diff file row and a history patch
// row all mean exactly the same thing by this gesture, and four near-copies is
// how the four would stop meaning the same thing. The callers differ in one
// prop — `reveal`, for rows where the control fades in on hover — and in
// nothing else.
//
// **There is no chord, and that is a decision with a check behind it.** The
// plan proposed ⌘⇧O; the claimant check refuses it and nothing was substituted:
//
// - **⇧⌘O is upstream's** — `app/AppShell.tsx`'s window handler claims it
//   (`key === "o" && event.shiftKey`), alongside ⌘K, ⇧⌘K, ⇧⌘N and ⇧⌘A. Taking
//   it would be the second deliberate replacement of an upstream gesture, and
//   ADR-005 spends that budget on ⌘K, once, with a seam.
// - **⌥⌘O looks free and is not checkable from here.** It is not in muda's
//   default macOS table, it is not an ⌥-variant AppKit synthesizes (that rule
//   applies to Window-menu items, and ⌘O is not one), and no map in this island
//   holds it. But the last two chords this island lost — ⌘W and ⌥⌘M — were both
//   lost to claimants a *reading* could not see, found only by pressing the key
//   in the running app. This task may not launch the app, so the empirical half
//   of the check cannot be run, and shipping a chord on the documentary half
//   alone is precisely the mistake `scratchMarkdownKeys.ts`'s header was
//   written about.
// - **The gesture does not want a global chord anyway.** It acts on *the file
//   under this row*, and a window-level key would have to guess which of four
//   surfaces is the subject — the Files viewer's open file, the search hit the
//   cursor is on, or the diff row the mouse is over. A button on the row cannot
//   be wrong about its own subject.
//
// So it ships as buttons plus a ⌘K row ("Open the current file in an editor"),
// which is what `paletteSources.ts` adds and what the cheatsheet does not,
// because there is no chord to teach.
//
// **Vocabulary** (`2026-08-12-polish-the-right-side.md` §"The vocabulary"):
// `text-2xs` meta, `text-muted-foreground hover:bg-muted/60`,
// `transition-colors`, upstream's `focus-visible:ring-1 focus-visible:ring-ring`
// drawn inset, and the hover-reveal fade rows already use for the × on a
// worktree. No new hue: this is a control, and gray is the ground.

import * as React from "react";

import { openInEditor } from "@/features/runs/lib/editorClient";
import {
  type EditorId,
  editorButtonLabel,
  editorLabel,
  setChosenEditor,
} from "@/features/runs/lib/editors";
import { useEditorAction } from "@/features/runs/lib/useEditors";

/** The glyph. An arrow leaving the box — the one shape every app uses for
 * "this opens somewhere else", and a glyph rather than an icon import for the
 * reason the file tree's kind dots are dots. */
const AWAY = "↗";

const BUTTON_CLASS =
  "inline-flex shrink-0 items-center gap-1 rounded-sm px-1 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent";

/** Rows fade the control in on hover; a header keeps it. The row form needs the
 * caller to be a `group`, which is how `WorktreeRow`'s × already works.
 *
 * **`reveal` also means glyph-only, and that is a width promise rather than a
 * taste.** A row is a fixed budget shared with the thing it is a row *about*:
 * `workspace-diff-fits.spec.ts` asserts every changed file's basename is shown
 * in full at his 1728px width, and a labelled control beside it took 85px of
 * the name's box and ellipsised `WorktreeDiffPanel.tsx`. So in a row the label
 * moves into the tooltip and the glyph stays — which is also what
 * `WorktreeRow`'s × does, for the same reason. */
const REVEAL_CLASS =
  "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100";

export function OpenInEditor({
  line,
  path,
  reveal = false,
  testid = "open-in-editor",
  worktree,
}: {
  /** 1-based, or `null` for the top of the file — `FileTarget.line`'s meaning,
   * unchanged, so a caller that has no interesting line does not invent one. */
  line: number | null;
  /** Worktree-relative, as every other file-taking command in this island. */
  path: string;
  reveal?: boolean;
  testid?: string;
  worktree: string;
}) {
  const action = useEditorAction();
  const [menu, setMenu] = React.useState(false);
  // The backend's refusal, held so it can be read rather than logged. Cleared
  // on the next attempt: a sentence about the last click is not a sentence
  // about this one.
  const [refusal, setRefusal] = React.useState<string | null>(null);

  const open = React.useCallback(
    async (editor: EditorId) => {
      setRefusal(null);
      setRefusal(await openInEditor(editor, worktree, path, line));
    },
    [line, path, worktree],
  );

  const choose = React.useCallback(
    (editor: EditorId) => {
      // The pick is recorded *and* acted on: he clicked a row called "Cursor"
      // and the file has to open, or the menu would be a settings screen
      // wearing a menu's clothes.
      setChosenEditor(editor);
      setMenu(false);
      void open(editor);
    },
    [open],
  );

  if (action.type === "none") {
    // **Disabled, present, and carrying the reason.** Not hidden: a control
    // that vanishes looks like a control that never existed, which is
    // `paletteSources.ts`'s rule for a blocked row and the same argument here.
    return (
      <button
        aria-label={editorButtonLabel(action)}
        className={`${BUTTON_CLASS} ${reveal ? REVEAL_CLASS : ""}`}
        data-testid={`${testid}-none`}
        disabled
        title={action.refusal}
        type="button"
      >
        <span aria-hidden>{AWAY}</span>
        {reveal ? null : editorButtonLabel(action)}
      </button>
    );
  }

  const installed = action.installed;
  const label = editorButtonLabel(action);
  return (
    <span className="relative inline-flex shrink-0 items-center">
      <button
        aria-label={label}
        className={`${BUTTON_CLASS} ${reveal ? REVEAL_CLASS : ""}`}
        data-testid={testid}
        onClick={() => {
          if (action.type === "ask") {
            setMenu(true);
            return;
          }
          void open(action.editor);
        }}
        title={
          refusal ?? `${label} — ${path}${line === null ? "" : `:${line}`}`
        }
        type="button"
      >
        <span aria-hidden>{AWAY}</span>
        {reveal ? null : label}
      </button>
      {installed.length > 1 && action.type === "open" && !reveal ? (
        // The way back to the menu once a pick has been made. A caret rather
        // than a second labelled button: the choice is rare and the label is
        // already saying where the click lands. Not drawn in a row — the row
        // form has no label to disagree with, and a second glyph there would be
        // the width this control was just made narrow to give back.
        <button
          aria-label="Choose a different editor"
          className={`${BUTTON_CLASS} ${reveal ? REVEAL_CLASS : ""} px-0.5`}
          data-testid={`${testid}-more`}
          onClick={() => setMenu((was) => !was)}
          type="button"
        >
          <span aria-hidden>▾</span>
        </button>
      ) : null}
      {menu ? (
        <EditorMenu
          installed={installed}
          onChoose={choose}
          onDismiss={() => setMenu(false)}
          testid={testid}
        />
      ) : null}
      {refusal === null ? null : (
        // The refusal is a sentence, next to the thing that refused — the
        // island's rule for every other bounded call. Not a toast: he is
        // reading a file, and the answer belongs where he is looking.
        //
        // **In a row it is `sr-only` rather than absent.** The row's width is
        // a promise other tests hold (see `REVEAL_CLASS`), and a two-line
        // sentence in a file list would break it — so in that form the words
        // are on the button as its `title` (which is where the pointer already
        // is) and here for a screen reader, and nowhere as a layout.
        <span
          className={`ml-1 truncate text-2xs text-muted-foreground ${reveal ? "sr-only" : ""}`}
          data-testid={`${testid}-refusal`}
          title={refusal}
        >
          {refusal}
        </span>
      )}
    </span>
  );
}

/** The pick-once menu. Small, absolutely positioned, and closed by Escape or by
 * losing focus — the shape the workspace's other tiny menus keep, with no
 * portal because it never leaves the pane it is drawn in. */
function EditorMenu({
  installed,
  onChoose,
  onDismiss,
  testid,
}: {
  installed: readonly EditorId[];
  onChoose: (editor: EditorId) => void;
  onDismiss: () => void;
  testid: string;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    // Focus lands on the first row so the menu is answerable from the keyboard
    // the moment it opens — the palette's own rule.
    ref.current?.querySelector("button")?.focus();
  }, []);
  return (
    // `role="menu"` and not a bare `div`: the box carries the two handlers, and
    // an element with an `onKeyDown` and no role is what
    // `noStaticElementInteractions` refuses — for the right reason, since a
    // screen reader would otherwise be told nothing about what just appeared.
    // The rows are `menuitem`s for the same reason, and `tabIndex={-1}` keeps
    // the box itself out of the Tab order: focus belongs on a row.
    <div
      className="absolute right-0 top-full z-20 mt-1 min-w-32 rounded-sm border border-border/60 bg-popover py-0.5 shadow-lg"
      data-testid={`${testid}-menu`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onDismiss();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onDismiss();
        }
      }}
      ref={ref}
      role="menu"
      tabIndex={-1}
    >
      {installed.map((editor) => (
        <button
          className="block w-full px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          data-testid={`${testid}-choose-${editor}`}
          key={editor}
          onClick={() => onChoose(editor)}
          role="menuitem"
          type="button"
        >
          {editorLabel(editor)}
        </button>
      ))}
    </div>
  );
}
