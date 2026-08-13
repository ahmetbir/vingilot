// The one poll behind every surface that draws terminal liveness
// (vingilot/docs/plans/2026-08-12-hooks-and-the-dots.md, Task 3).
//
// **Why a shared poller rather than a hook with its own interval.** Two
// surfaces read this signal — `useWorktreeSignals` for the dots and
// `ProjectStatusBar` for the bottom bar's segment — and they are mounted in
// different subtrees with no prop path between them that does not run through
// `RunsScreen`. Two independent `setInterval`s would ask the same question
// twice a tick and, worse, at two different phases: the bar could say
// `claude · asking` for up to a poll after the dot had gone back to working,
// which is the surfaces disagreeing about one worktree — the failure
// `useWorktreeSignals`' own header exists to prevent one level down.
//
// So there is one timer, one answer, and every subscriber renders the same
// object. It is a module-level singleton and that is the thing this codebase is
// rightly suspicious of, so the two rules it is held to:
//
// 1. **It holds no community-scoped data**, so it is not in
//    `resetCommunityState()`'s set. Terminal liveness is a fact about
//    directories on this machine, keyed by worktree binding id; switching
//    communities does not make it stale, and clearing it would blank the dots
//    on a screen whose worktrees did not change.
// 2. **It is refcounted.** The interval starts with the first subscriber and is
//    cleared with the last, so a workspace nobody is looking at costs nothing —
//    and an app that unmounts the whole screen leaves no timer behind.
//
// `REFRESH_MS` matches the coordinator's 2s tick rather than git's 5s one: this
// answer costs a lock and a map walk (`hook_liveness` is a snapshot of an
// in-memory store, no subprocess), and it is the signal a permission prompt
// arrives on — a question the owner is being asked should not sit unseen for
// five seconds because git is expensive.

import * as React from "react";

import {
  type LiveAgents,
  liveAgents,
  NO_AGENTS,
} from "@/features/runs/lib/liveAgents";

/** The coordinator's own cadence — see this module's header for why not git's. */
const REFRESH_MS = 2_000;

let current: LiveAgents = NO_AGENTS;
let handle: ReturnType<typeof setInterval> | null = null;
let reading = false;
const listeners = new Set<() => void>();

async function tick() {
  // One read in flight at a time, for `useWorktreeStats`' reason: a poll slower
  // than the interval would otherwise queue behind itself.
  if (reading) return;
  reading = true;
  const next = await liveAgents();
  reading = false;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (handle === null) {
    void tick();
    handle = setInterval(() => void tick(), REFRESH_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || handle === null) return;
    clearInterval(handle);
    handle = null;
    // The last reading is deliberately kept. A surface remounting inside one
    // tick renders what was true a moment ago rather than flashing "no agent
    // anywhere" — and one tick later it is current either way.
  };
}

/** Every worktree's live agents. The same object for every caller in a tick. */
export function useLiveAgents(): LiveAgents {
  return React.useSyncExternalStore(subscribe, () => current);
}

/** Forget everything and stop the timer — tests only, so one test's answer is
 * not the next one's starting state. */
export function resetLiveAgentsForTests() {
  current = NO_AGENTS;
  reading = false;
  listeners.clear();
  if (handle !== null) clearInterval(handle);
  handle = null;
}
