// The inline editor both strips rename in (2026-08-29 redesign, P4.5).
//
// **In place, not in a dialog.** The thing being named is a two-word label on
// a 46px strip; a modal over it would dim the window, move the focus twice and
// put the name further from the chip than the chip is from the terminal it
// names. So the label becomes a field where it sits, the strip does not
// reflow, and the gesture is over in a keystroke.
//
// **Enter commits, Escape reverts, blur commits.** The third is the one worth
// arguing: a rename with no visible OK button has to resolve somehow when the
// owner clicks away, and "keep what I typed" is the answer every renameable
// label he uses gives (Finder, VS Code's explorer, a browser bookmark). Escape
// is the door out, and it is a real revert rather than a commit of the seed —
// `settled` is what keeps the blur that FOLLOWS an Escape from committing the
// text the Escape just discarded.
//
// **While the caret is here, the keyboard is.** Every keydown stops
// propagating, which is what keeps ⌘T, ⇧⌘W and ⇧⌘\ from opening a task,
// closing a tab or splitting the stage out from under a half-typed name: the
// strip's chords are answered by a BUBBLE-phase window listener
// (`WorkSurface.tsx`), so an event stopped at the target never reaches them.
// The capture-phase claimants above it are unaffected and stay correct
// independently — ⌘W defers to any text field (`typingTarget.ts`), and ⌘K
// opening the palette over an editor merely blurs it, which commits. The
// window listener ALSO refuses the strip's acts over a text field, on purpose:
// two independent guards, because losing a tab to a keystroke meant for a name
// is not a class of bug worth being clever about.

import * as React from "react";

import { STRIP_NAME_MAX } from "@/features/runs/lib/stripName";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

export function StripNameEditor({
  className,
  label,
  onCancel,
  onCommit,
  seed,
  testid,
}: {
  /** Sizing and chrome, so each strip can hand its own row's measurements in
   * — this component owns the behaviour, the strip owns the box. */
  className: string;
  label: string;
  onCancel: () => void;
  onCommit: (name: string) => void;
  /** The current name, which the field opens holding and fully selected: the
   * common rename is a replacement, and the uncommon one is one keystroke
   * away from being an edit. */
  seed: string;
  testid: string;
}) {
  const ref = React.useRef<HTMLInputElement | null>(null);
  // Set by whichever of the three exits ran first. Without it, Escape's own
  // blur — which arrives after the parent has already reverted — would commit
  // the discarded text a moment later.
  const settled = React.useRef(false);

  // **Claiming the caret takes more than one try.** Two of the four doors onto
  // this field are overlays that are still tearing down when it mounts — the
  // tab's context menu and ⌘K's palette both hold focus inside a scope that
  // makes the strip behind them unfocusable until they unmount, so a single
  // `focus()` on mount is simply refused and the owner's first keystroke goes
  // to the shell. So ask on every frame for a short window instead of once,
  // and re-assert if the closing overlay puts focus back where it found it.
  // The window is short enough that a deliberate click away is not fought:
  // any blur commits and unmounts this field, and unmounting cancels the loop.
  React.useEffect(() => {
    const field = ref.current;
    if (field === null) return;
    let frame = 0;
    let framesLeft = 12;
    let selected = false;
    const claim = () => {
      if (document.activeElement !== field) {
        field.focus();
        if (!selected && document.activeElement === field) {
          // The seed opens selected: the common rename is a replacement, and
          // the uncommon one is one keystroke away from being an edit.
          field.select();
          selected = true;
        }
      }
      framesLeft -= 1;
      if (framesLeft > 0) frame = requestAnimationFrame(claim);
    };
    claim();
    return () => {
      cancelAnimationFrame(frame);
      // **A fourth exit: taken off screen without being blurred.** React fires
      // no blur on unmount, so a field removed by something happening
      // elsewhere — the owner pressing ⌘2 for another worktree while a name is
      // half typed — would take the name down with it. Silent loss, and it
      // looks exactly like a rename that did not work. What he typed was about
      // THIS strip and belongs to it, so it is committed on the way out; the
      // editor still closes rather than following him, which is the separate
      // thing the parent's worktree effect is for. `settled` keeps the three
      // deliberate exits ahead of this one, so Escape still discards.
      if (settled.current) return;
      settled.current = true;
      onCommit(field.value);
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: the commit is an
    // unmount handler; re-running it whenever the callback identity changed
    // would commit a name in the middle of an edit.
  }, []);

  return (
    <input
      aria-label={label}
      className={className}
      data-testid={testid}
      defaultValue={seed}
      maxLength={STRIP_NAME_MAX}
      onBlur={(event) => {
        if (settled.current) return;
        settled.current = true;
        onCommit(event.currentTarget.value);
      }}
      // A double-click on a tab opens this field; a click INSIDE it must not
      // travel back up to the tab that is still listening for one.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // **Only the field's own keys stop here.** A chord with the primary
        // modifier travels, because the window listener in `WorkSurface` is
        // the one that knows the difference: `actsOnStrip` refuses the chords
        // that would CHANGE the strip under a half-typed name — ⇧⌘W, ⌘T, ⇧⌘\,
        // ⌥⌘←→ — while the ones that merely move the owner somewhere else are
        // let through on purpose. Swallowing everything looked like the safe
        // reading and was not: it made that predicate unreachable from here,
        // so the rule the app states about ⌘1…9, ⌘` and ⌥⌘T was not the rule
        // it had. Editing keys (⌘A, ⌘C, ⌘Z…) travel too and cost nothing —
        // `resolveKey` answers null for them, which the listener returns on.
        if (!hasPrimaryShortcutModifier(event.nativeEvent)) {
          event.stopPropagation();
        }
        if (event.key === "Enter") {
          event.preventDefault();
          settled.current = true;
          onCommit(event.currentTarget.value);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          settled.current = true;
          onCancel();
        }
      }}
      onMouseDown={(event) => event.stopPropagation()}
      // The field is opened by a gesture somewhere else — a double-click on the
      // tab, a menu row, a palette row — so it has to take the caret itself the
      // moment it exists. Without this the effect above holds a null and the
      // owner's first keystroke goes to whatever had focus before.
      ref={ref}
      spellCheck={false}
      type="text"
    />
  );
}
