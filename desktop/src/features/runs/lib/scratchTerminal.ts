// The scratch terminal: a shell that opens over the work surface, runs one
// thing, and leaves nothing behind
// (vingilot/docs/plans/2026-08-08-scratch-and-team-thread.md, Task 1).
//
// **Persistence is the defect here, not the feature.** A scratch terminal that
// survived anything would be a terminal tab, and the workspace already has
// those. There are exactly three places a terminal becomes persistent in this
// app, and this model's whole job is to be in none of them:
//
// 1. **A tmux session**, taken by `pty_open` at first open. Avoided on the
//    backend, by asking for the direct-spawn plan (`vingilot_pty/tmux.rs`'s
//    `Lifetime::Ephemeral`) — so there is no session for a crash or a quit that
//    skipped teardown to strand. Not avoided by closing one afterwards; cleanup
//    is a promise that holds until the one time it does not.
// 2. **The saved layout** (`terminalTabStore.ts`), written on every change of
//    `TabLayout`. Avoided by never entering `TabLayout`: a scratch is one
//    nullable value held beside it, and nothing here produces or consumes a
//    `WorktreeTabs`.
// 3. **The worktree's strip**, which `ensureWorktree` gives every visited
//    worktree. Same avoidance: not being in the layout is not being in the
//    strip, and `applyTabCommand`/`closeTab` — and therefore ⇧⌘W and the tab
//    bar — have no name for this session.
//
// **The id, and why it cannot collide with a tab's.** A tab's session id is
// `sessionIdFor(bindingId, n)` = `` `${bindingId}#${n}` `` — which always
// contains at least one `#`, whatever the binding id is. A scratch id contains
// none. That is the whole proof, it holds for every binding id the coordinator
// could ever produce, and it needs no reserved prefix and no lookup. The three
// alphabets a session id crosses are met as follows:
//
// - **tmux session names**: `tmux::session_name` passes `[A-Za-z0-9_]` and
//   escapes every other byte as `-<hex>`, so the derivation is injective for
//   any id at all. Distinctness there follows from distinctness here.
// - **Tauri event names**: not a constraint, because no id is ever put in one
//   — output rides the single `vingilot://pty` channel with the id in the
//   payload. A scratch id would be illegal as an event name (`.` is outside
//   `[A-Za-z0-9-/:_]`), exactly as a tab's is, and the Rust side pins that.
//   Nothing may add a per-session event.
// - **The coordinator**: binding ids come from coordinator rows and the
//   synthesised `main:<repo id>`. A scratch id is never derived from one, and
//   the no-`#` rule holds even for a binding id that itself contains `#`.
//
// Pure: no React, no Tauri, no storage. The host (`RunsScreen`) holds the one
// value this produces and calls `pty_close` for whatever `closed` names.

import { resolveColumnKey } from "./columnKeys.ts";
import { resolvePaneKey } from "./paneKeys.ts";
import { type KeyInput, resolveKey } from "./terminalKeys.ts";

/** What every scratch session id starts with.
 *
 * The `.` is deliberate and is doing two things: it keeps the id out of the
 * Tauri event alphabet (so a future per-session event fails loudly rather than
 * silently carrying nothing), and it reads as a namespace rather than as a
 * name a worktree could have. What actually guarantees non-collision is the
 * absence of `#`, not this prefix — see the header. */
const SCRATCH_PREFIX = "vingilot-scratch.";

/** The PTY session id for one scratch shell.
 *
 * `nonce` only ever rises, for the same reason a strip's `nextN` does: closing
 * kills the pty, and if that kill lost a race a reused id would attach the new
 * scratch to the old one's still-live shell. Rising costs one integer and makes
 * that unreachable.
 *
 * **It rises within a mount, and the caller owns the rest.** This once read
 * "an ephemeral session cannot survive an app run", which is true and was the
 * wrong bound: the session survived something far weaker — a remount of the
 * screen holding the counter, which happens on a route change or a reload.
 * The ordinals restarted at 1 while the shell was still registered, and
 * `pty_open` replayed it instead of spawning. What makes an id ephemeral is
 * that something ends the session, so `RunsScreen` closes it when it unmounts;
 * the rising nonce defends a race, not a lifetime. */
export function scratchSessionId(nonce: number): string {
  return `${SCRATCH_PREFIX}${nonce}`;
}

/** The one scratch shell, while there is one. */
export interface ScratchSession {
  sessionId: string;
  /** The worktree it was opened on. Held so a change of worktree can end it:
   * a shell whose header names a checkout the owner has left is a shell that
   * lies about where it is. */
  bindingId: string;
  /** Where the shell starts, and the path the overlay prints. Never null — a
   * scratch with no directory is refused before it is opened, not opened into
   * somewhere arbitrary. */
  cwd: string;
}

/** No scratch is open. Held as `null` rather than as a flag plus a session, so
 * "open" and "has a session" cannot come apart. */
export type Scratch = ScratchSession | null;

/** A scratch transition, with whatever it really ended.
 *
 * The two travel together for the reason `TabLayoutChange`'s do: a caller that
 * took the new value without closing what left it would leave a shell running
 * with nothing tracking it, for the life of the app. */
export interface ScratchChange {
  scratch: Scratch;
  /** Session ids whose pty must really be closed. */
  closed: readonly string[];
}

/** Why a scratch shell cannot be opened right now, or `null`.
 *
 * One function so the chord and the palette row give the same answer: two
 * readings of "can this open" is one too many, and the palette's rule is the
 * one the owner reads.
 *
 * `cwdPending` is the distinction that keeps this from telling the owner his
 * worktree has no checkout when all that has happened is that the home
 * directory lookup has not answered yet. */
export function scratchBlocked(
  worktreeId: string | null,
  cwd: string | null,
  cwdPending: boolean,
): string | null {
  if (worktreeId === null) {
    return "no worktree is open, so there is nowhere to open a shell.";
  }
  if (cwd === null) {
    return cwdPending
      ? "this worktree's directory has not been resolved yet."
      : "this worktree has no checkout on this machine, so there is nowhere to open a shell.";
  }
  return null;
}

/** Open a scratch shell on a worktree.
 *
 * Opening while one is already running in the same place is a no-op rather
 * than a second shell: the chord is a toggle at the host, and the palette row
 * is a second door to the same surface — neither may cost the owner whatever
 * is running in the one he already has. A different worktree is a different
 * place, so that one ends and a new shell starts. */
export function openScratch(
  current: Scratch,
  at: { bindingId: string; cwd: string; nonce: number },
): ScratchChange {
  if (
    current !== null &&
    current.bindingId === at.bindingId &&
    current.cwd === at.cwd
  ) {
    return { closed: [], scratch: current };
  }
  return {
    closed: current === null ? [] : [current.sessionId],
    scratch: {
      bindingId: at.bindingId,
      cwd: at.cwd,
      sessionId: scratchSessionId(at.nonce),
    },
  };
}

/** Close the scratch shell. The only meaning it has: closing it ends it. */
export function closeScratch(current: Scratch): ScratchChange {
  return {
    closed: current === null ? [] : [current.sessionId],
    scratch: null,
  };
}

/** The owner went somewhere else — another worktree, another project, or the
 * landing view (`null`).
 *
 * The scratch ends. It is scoped to one checkout and says so on screen, and a
 * shell kept alive behind a surface that no longer draws it is precisely the
 * residue this terminal exists not to leave. Staying put changes nothing, so a
 * caller can compare references and skip the write. */
export function scratchOnWorktree(
  current: Scratch,
  bindingId: string | null,
): ScratchChange {
  if (current === null || current.bindingId === bindingId) {
    return { closed: [], scratch: current };
  }
  return closeScratch(current);
}

/** What a keydown means while the scratch is open.
 *
 * `shield` is "the surface underneath must not act on this". While a modal
 * shell is over the work surface, ⇧⌘W closing a terminal tab, ⌘T stealing
 * focus into a terminal the owner cannot see, or ⌥⌘B rearranging the panes
 * behind it are all acts on something that is not in front of him.
 *
 * **Shielded, not swallowed wholesale.** Only the chords the surfaces
 * underneath actually resolve are stopped, so the app's own global keys — zoom,
 * settings, reload — still work, and everything else reaches the shell. In
 * particular **Escape is shielded, not a close**: a terminal owns Escape (vim,
 * less, every reader), and a modal that ate it would make the shell it opened
 * useless for the things a scratch shell is for. The way out is the chord that
 * opened it, the × in its header, or the scrim — all three on screen. */
export type ScratchKeyAction = { type: "close" } | { type: "shield" };

export function resolveScratchKey(input: KeyInput): ScratchKeyAction | null {
  const surface = resolveKey(input);
  // The same chord both ways: a key that opens a surface and then does nothing
  // is a key the owner presses twice looking for the way out.
  if (surface?.type === "open-scratch-terminal") return { type: "close" };
  if (surface !== null) return { type: "shield" };
  if (resolvePaneKey(input) !== null) return { type: "shield" };
  if (resolveColumnKey(input) !== null) return { type: "shield" };
  return null;
}
