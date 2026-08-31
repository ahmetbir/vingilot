// ⌃Tab, wired (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 3).
//
// Every decision that can be made without React is somewhere else — what a
// place is and how the list is ordered, capped and walked is `placeMru.ts`;
// what the chord means and which claimants were checked for it is
// `placeKeys.ts`; and each of the three acts a landing performs already exists
// and is called rather than reimplemented (`onSelectWorktree` is the host's own
// selection, `requestFile` is `filesTarget.ts`'s one landing into the viewer,
// `showPane` is `useShowPane.ts`'s two moves). What is left here is the three
// things that cannot be tested without React: holding the list, hearing the key
// *up*, and the order those two happen in.
//
// It takes primitives rather than an assembled `Place` because the assembly is
// the same three lines every time and `RunsScreen` is at the file-size ceiling;
// what it must not take is a second idea of where he is, which is why the file
// arrives as the pane's own report and not as a reading of anything here. It is
// still the pane's only reading after this file is done with it — what is added
// is an **expiry**, because a copy of somebody else's answer has to know when the
// surface that gave it went away (`placeMru.ts`'s `readFileReport`), and a
// workspace that kept it would draw a row naming a file that is not on screen.
//
// **Capture phase, on `window`, exactly as `usePalette.ts` binds ⌘K.** Two
// calls make the claim and neither is redundant: `preventDefault()` suppresses
// the browser's own sequential-focus walk (a webview has no tab strip to cycle,
// so that is all Ctrl+Tab's default action is here), and `stopPropagation()` at
// the window-capture stage keeps the event out of the target phase entirely.
//
// **That second one is the whole reason a focused terminal does not eat this.**
// xterm registers its keydown listener on its own textarea, and @xterm/xterm
// 5.5.0 resolves ⌃⇥ to a literal tab it writes to the pty and then cancels
// (`common/input/Keyboard.ts` case 9 never looks at `ctrlKey`;
// `browser/Terminal.ts` `_keyDown` → `cancel` calls `preventDefault` and
// `stopPropagation`). A window-capture listener runs before any listener on any
// element, so the event never reaches that textarea. The alternative —
// `attachCustomKeyEventHandler` on every xterm instance — would be the same
// claim written once per terminal, in the one component in this island that
// must not grow a keyboard opinion (`Terminal.tsx`'s header: what it owns is an
// attachment, not a key map).
//
// **The keyup is the commit, and it is bound on `window` too**, for the same
// reason: with the keyboard in a shell, the ⌃ that comes back up is delivered to
// xterm's textarea and nowhere else unless something is listening above it.
//
// **`blocked` is how a modal surface keeps the keyboard.** The palette's own
// capture listener stops propagation for every key while it is open, but it is
// registered when the palette opens — *after* this one, which is bound for the
// life of the screen — so on a straight reading of the DOM this handler would
// win and open a switcher over an open palette. It does not, because the host
// tells it when something is stacked. Said as a rule rather than as a list of
// components: a surface that is a question the owner has not answered yet keeps
// the keyboard, and a switcher that took him somewhere else while it was up
// would be answering the question by walking away from it.

import * as React from "react";

import { pendingFile, requestFile } from "@/features/runs/lib/filesTarget";
import type { PaneId } from "@/features/runs/lib/paneModel";
import {
  resolvePlaceKey,
  resolvePlaceListKey,
} from "@/features/runs/lib/placeKeys";
import {
  type FileReport,
  type Place,
  placeKey,
  rememberPlace,
  stepSwitcher,
  switcherLanding,
} from "@/features/runs/lib/placeMru";
import { worktreeCwd as worktreeCwdOf } from "@/features/runs/lib/projects";
import type { IndexedWorktree } from "@/features/runs/lib/terminalSessions";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

export interface PlaceSwitcher {
  /** Where he has been, most recent first. `places[0]` is where he is now, so
   * the overlay draws it as the row he is standing on rather than as a
   * destination. */
  places: readonly Place[];
  /** The row the overlay highlights and a release lands on, or `null` while the
   * switcher is closed. */
  index: number | null;
}

interface Options {
  /** True while a surface above the workspace owns the keyboard. See the
   * header. */
  blocked: boolean;
  /** The selected worktree's binding id, or `null` on the landing view. A
   * `null` records nothing; it does not clear what was recorded, because
   * passing through the landing view on the way somewhere is not forgetting
   * where he has been. */
  worktreeId: string | null;
  /** The selected worktree's own directory, used only to decide whether
   * `file` belongs to *this* checkout. */
  worktreeCwd: string | null;
  /** Which pane is in the right slot. */
  pane: PaneId;
  /** Which file the workspace has open, whichever worktree it belongs to, or
   * `null` for a workspace standing in no checkout. A `path` of `null` is an
   * answer of emptiness and not the absence of one.
   *
   * **Since P4.1 this is DERIVED, not reported** (`viewTabs.ts`'s
   * `openFileReport`): a file is a tab beside the shells, so "what is open" is
   * visible from outside the pane rather than something a mounted pane has to
   * say. That is what retired the expiry machinery below. */
  file: FileReport | null;
  /** Every worktree the workspace knows about, for turning a place's binding id
   * back into a directory on landing. */
  worktreeIndex: ReadonlyMap<string, IndexedWorktree>;
  /** Where task worktrees live, or `null` before the lookup has answered. */
  worktreeRoot: string | null;
  /** Select a worktree — the host's, because the selection is. */
  onSelectWorktree: (bindingId: string) => void;
  /** Put a pane on screen, giving the right slot back if the terminal has the
   * whole surface (`useShowPane.ts`). */
  showPane: (pane: PaneId) => void;
}

export function usePlaceSwitcher({
  blocked,
  file,
  onSelectWorktree,
  pane,
  showPane,
  worktreeCwd,
  worktreeId,
  worktreeIndex,
  worktreeRoot,
}: Options): PlaceSwitcher {
  // **The answer no longer expires, because it is no longer a report.** Until
  // P4.1 the open file was something the Files pane told the workspace, which
  // meant it could only speak while mounted: `readFileReport` existed to expire
  // that answer when the pane it came from was remounted by a pane or worktree
  // switch. A file is a TAB now (`viewTabs.ts`) — it belongs to the worktree,
  // outlives every pane switch, and the workspace derives it for itself — so
  // there is nothing left that can go stale, and an expiry here would blank a
  // file that is visibly still on screen.
  const reported = file;

  // **The address, assembled in one place.** Two of the three fields are the
  // workspace's own state and the third is the pane's report, and a file
  // belongs to the address only when the pane showing files is the one in the
  // slot AND it is this checkout's — two checkouts of one project both have
  // `src/main.rs`, so a report from the other one names a file this place does
  // not have open.
  const here: Place | null =
    worktreeId === null
      ? null
      : {
          file:
            pane === "files" &&
            reported !== null &&
            reported.worktree === worktreeCwd
              ? reported.path
              : null,
          pane,
          worktreeId,
        };

  // **Nothing is written down until the pane that owns the answer has given it.**
  // A landing files its target and selects the worktree in one commit, so for one
  // render the Files pane in the slot has not mounted; recording then would put a
  // fileless row *above* the place he is landing on, and the tap back would go to
  // that row instead of to where he came from. The pane speaks one commit later —
  // on mount, whether or not it has anything open (`FilesPane`) — so this wait is
  // one render long and it ends either way.
  //
  // Only while there is a pane that can speak: a worktree with no directory is
  // refused by `filesAvailability` and the pane is never constructed, so waiting
  // for it would be waiting for ever and "this worktree · Files" would never be a
  // place at all. `worktreeCwd` is the same reading that refusal is made on.
  // What is still worth waiting for is the LANDING, and only that: `onGo`
  // files a target and selects the worktree in one commit, and the tree opens
  // the tab a render or two later. Recording in between would put a fileless
  // row above the place he is landing on, and the tap back would go to that
  // row instead of to where he came from. `pendingFile()` is the mailbox's own
  // reading of "a landing is in flight", and it clears the moment the tree
  // takes it — which is the same commit that opens the tab, so this settles in
  // one render either way and can never wait for ever.
  const awaiting =
    pane === "files" && worktreeCwd !== null && pendingFile() !== null;

  // Landing: three acts, in the order `show-file` already established. The
  // target is filed BEFORE the pane is brought forward, because the pane reads
  // what is pending on mount and a request made after it mounted would be
  // dropped by the remount the worktree selection above causes.
  const latestGo = React.useRef({
    onSelectWorktree,
    showPane,
    worktreeIndex,
    worktreeRoot,
  });
  latestGo.current = {
    onSelectWorktree,
    showPane,
    worktreeIndex,
    worktreeRoot,
  };
  const onGo = React.useCallback((place: Place) => {
    const { worktreeIndex: known, worktreeRoot: root } = latestGo.current;
    latestGo.current.onSelectWorktree(place.worktreeId);
    const entry = known.get(place.worktreeId);
    // A worktree that has left the workspace since he was there still lands on
    // its pane, without the file: there is no directory to name any more, and
    // `requestFile` with a guessed one would open another checkout's file of
    // the same name.
    const cwd =
      place.file === null || entry === undefined || root === null
        ? null
        : worktreeCwdOf(entry.repo, entry.worktree, root);
    if (cwd !== null && place.file !== null) {
      requestFile({ line: null, path: place.file, worktree: cwd });
    }
    latestGo.current.showPane(place.pane);
  }, []);

  const [places, setPlaces] = React.useState<readonly Place[]>([]);
  const [index, setIndex] = React.useState<number | null>(null);

  // Recorded on the *key*, not on the object: `here` is rebuilt every render of
  // a screen that re-renders on a 2s poll, and an effect that depended on the
  // object would run on every tick. `rememberPlace` would return the same list
  // by identity anyway — this is the cheaper half of the same guarantee.
  //
  // `null` while he is nowhere (the landing view) and while the wait above is on,
  // and it is a *value* rather than a skipped effect so that the render after the
  // wait is a change this effect can see: the place he arrives at can be the one
  // that was pending when the wait began, and a dependency that had not moved in
  // between would never fire for it.
  const recordKey = here === null || awaiting ? null : placeKey(here);
  const latestHere = React.useRef(here);
  latestHere.current = here;
  // `recordKey` IS the identity of `latestHere.current`, which the body reads
  // fresh: the dependency is the trigger, not a value.
  React.useEffect(() => {
    const at = latestHere.current;
    if (recordKey === null || at === null) return;
    setPlaces((prev) => rememberPlace(prev, at));
  }, [recordKey]);

  // Read by listeners bound once for the life of the screen. Bound once matters
  // twice here: this screen re-renders on a 2s poll, so a rebound pair would be
  // an add/remove twice a second with the chord unclaimed in between — and the
  // keyup listener in particular must be the *same* listener that saw the
  // keydown, or a ⌃ released across a re-render commits nothing.
  const latest = React.useRef({ blocked, index, onGo, places });
  latest.current = { blocked, index, onGo, places };

  React.useEffect(() => {
    function input(event: KeyboardEvent) {
      return {
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        key: event.key,
        // Both raw modifiers, because this is the one chord in the island that
        // is named after a physical key on every platform (`placeKeys.ts`'s
        // header). `primaryModifier` is passed for the shape's sake and is the
        // one field that map does not read: off-mac it is `ctrlKey` again.
        metaKey: event.metaKey,
        primaryModifier: hasPrimaryShortcutModifier(event),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      };
    }

    function handleKeyDown(event: KeyboardEvent) {
      const open = latest.current.index !== null;
      if (open && resolvePlaceListKey(input(event)) !== null) {
        // Esc, and only while this is up: a closed switcher has no claim on the
        // key and the terminal's own "leave the terminal" answer for it is the
        // one that should run.
        event.preventDefault();
        event.stopPropagation();
        setIndex(null);
        return;
      }
      const action = resolvePlaceKey(input(event));
      if (action === null) return;
      // Not while something is stacked over the workspace — see the header.
      // Checked after the map so the chord is refused rather than half-claimed:
      // nothing is prevented, so the surface above gets the key it would have
      // got if this hook did not exist.
      if (latest.current.blocked) return;
      event.preventDefault();
      event.stopPropagation();
      setIndex(
        (prev) =>
          stepSwitcher(
            { index: prev },
            latest.current.places.length,
            action.delta,
          ).index,
      );
    }

    function handleKeyUp(event: KeyboardEvent) {
      // The modifier the gesture is named after, going back up. Not `ctrlKey`
      // on the event — on a keyup for Control that flag is already false.
      if (event.key !== "Control") return;
      const held = latest.current.index;
      if (held === null) return;
      // Neither `preventDefault` nor `stopPropagation` here, unlike the keydown.
      // A modifier's keyup has no default action to suppress and no other
      // claimant to beat, and swallowing it would leave xterm's own
      // keydown/keyup bookkeeping (`_keyDownSeen`, the cursor style) mid-press
      // for a key it did see go down.
      setIndex(null);
      const target = switcherLanding({ index: held }, latest.current.places);
      // A list that shrank under an open switcher lands nowhere rather than on
      // whatever moved into that slot.
      if (target !== null) latest.current.onGo(target);
    }

    // **The window going away is not a release.** ⌘Tab out mid-gesture never
    // delivers the keyup, so without this the overlay would still be up on the
    // way back with a modifier nobody is holding. It closes rather than lands:
    // the commit is letting go of ⌃, and a window that lost focus did not do
    // that — moving him somewhere while he is looking at another app would be
    // navigating on a guess.
    function handleBlur() {
      setIndex(null);
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  // Clamped rather than corrected in an effect, for `usePalette`'s reason: an
  // index past the end of a list that just shrank must never be the one the
  // overlay draws, and an effect would leave one render in which it is.
  const safeIndex =
    index !== null && index < places.length && places.length > 1 ? index : null;
  return { index: safeIndex, places };
}
