// Pure ordering for a session's output events, so a view attaching to a live
// shell renders each byte exactly once, in the order the shell wrote it.
//
// The problem it solves. A view must subscribe *before* calling `pty_open` —
// the reattach replay is emitted from inside that command, so a listener
// attached afterwards misses the screen it exists to render. But subscribing
// first opens a window: the reader thread can emit a live chunk between the
// subscribe and `pty_open`'s snapshot of the retained screen, and that chunk
// is then in the replay too. Written straight through, the pane shows the
// tail of a running build twice, out of order — the live chunk first, then a
// replay that ends before it.
//
// The fix is a per-session sequence number
// (desktop/src-tauri/src/vingilot_pty/mod.rs): every live chunk carries its
// own position in the stream, and the replay carries the position it stops
// short of. Everything below that mark is already on screen; everything at or
// above it is not. Chunks that arrive before the replay are held, because
// until the mark is known there is no way to tell which of them the replay
// will repeat.

/** The one Tauri event every session's output arrives on, named here rather
 * than in `ptyClient.ts` so the name and the payload it carries are one
 * contract — and so this side of it is testable without importing Tauri.
 *
 * **One name for all sessions, with the id in the payload.** A Tauri event
 * name is not a free string: `EventName::new` (tauri 2.11.5,
 * `src/event/event_name.rs`) admits only `[A-Za-z0-9]`, `-`, `/`, `:` and
 * `_`. An illegal name is rejected at *both* ends — `emit` fails on the Rust
 * side and `listen` rejects on this one — so it does not degrade a terminal,
 * it deletes it: no output, no error line, no retry.
 *
 * Session ids cannot meet that alphabet by construction (a binding id joined
 * to a tab ordinal by `terminalTabs.ts`, over ids this app does not author),
 * so the id travels in the payload and the name is a constant. Must stay
 * byte-identical to `PTY_OUTPUT_EVENT` in
 * desktop/src-tauri/src/vingilot_pty/mod.rs. */
export const PTY_OUTPUT_EVENT = "vingilot://pty";

/** One `PTY_OUTPUT_EVENT` event. `replay: true` marks the reattach snapshot,
 * whose `seq` is the exclusive upper bound of the stream positions its `data`
 * already contains — not a position of its own. */
export interface PtyChunk {
  data: string;
  replay: boolean;
  seq: number;
}

/** A chunk as it arrives on the wire: which session it belongs to is the only
 * thing separating one terminal's output from another's on the shared event,
 * so every view filters on it before folding the chunk into its own stream. */
export interface PtyOutputEvent extends PtyChunk {
  session: string;
}

/** Held chunks, capped. `pty_open` always emits a replay (empty, `seq: 0`,
 * for a shell it just spawned), so the buffer normally drains within a tick
 * of the first chunk. It only keeps growing if that command failed outright,
 * and in that case the session does not exist and the output is not going to
 * be rendered by anyone — bounding it keeps a broken open from retaining the
 * whole of a shell's output. */
const MAX_HELD_CHUNKS = 256;

export interface PtyStreamState {
  /** Chunks that arrived before the replay did, oldest first. */
  readonly held: readonly PtyChunk[];
  /** Exclusive upper bound of the stream positions the replay already
   * carried; `null` until the replay lands. */
  readonly replayThrough: number | null;
}

export function initialPtyStreamState(): PtyStreamState {
  return { held: [], replayThrough: null };
}

/** Fold one event into the stream. Returns the next state and the strings to
 * write to the terminal, in order — empty when the event is held or dropped. */
export function acceptPtyChunk(
  state: PtyStreamState,
  chunk: PtyChunk,
): { state: PtyStreamState; write: string[] } {
  if (chunk.replay) {
    // A second replay would mean a second `pty_open` against a session this
    // view is already streaming; its snapshot is a strict prefix of what has
    // already been written, so re-writing it would duplicate the screen.
    if (state.replayThrough !== null) return { state, write: [] };

    const write = [chunk.data, ...released(state.held, chunk.seq)].filter(
      (text) => text.length > 0,
    );
    return { state: { held: [], replayThrough: chunk.seq }, write };
  }

  if (state.replayThrough === null) {
    return { state: { ...state, held: hold(state.held, chunk) }, write: [] };
  }

  // Emitted before the snapshot was taken, so the replay already carried it.
  if (chunk.seq < state.replayThrough) return { state, write: [] };
  return { state, write: [chunk.data] };
}

/** Retain a chunk that arrived before the mark, dropping the **lowest**
 * position first if that runs past the cap.
 *
 * Which end to evict from is the whole question here, and the code cannot
 * show the answer. Held chunks are the ones whose fate is not yet decided:
 * everything below the mark the replay already carries, everything at or
 * above it the replay does not. The mark only ever rises, so the held chunk
 * with the lowest position is the one most likely to fall below it and be
 * redundant — the safest to lose. Evicting the newest would drop precisely
 * the chunks no earlier mark can cover, which is backwards.
 *
 * The overflow is not reachable from either path the backend takes, which is
 * why the cap is a backstop rather than a policy: a freshly spawned shell has
 * its replay emitted *before* the reader thread starts (vingilot_pty/mod.rs),
 * so no live chunk can precede it; and a reattach takes its mark at or above
 * every position already emitted, so a chunk the replay does not cover must
 * have been emitted after the replay was. Overflowing needs 256 of those to
 * overtake the replay across the one channel both cross. */
function hold(held: readonly PtyChunk[], chunk: PtyChunk): readonly PtyChunk[] {
  const next = [...held, chunk];
  return next.length > MAX_HELD_CHUNKS
    ? next.slice(next.length - MAX_HELD_CHUNKS)
    : next;
}

/** The held chunks the replay did not already cover, in stream order. The two
 * emitters (the reader thread and the `pty_open` command) run on different
 * threads, so arrival order is not send order — sort rather than assume. */
function released(held: readonly PtyChunk[], replayThrough: number): string[] {
  return [...held]
    .filter((chunk) => chunk.seq >= replayThrough)
    .sort((a, b) => a.seq - b.seq)
    .map((chunk) => chunk.data);
}
