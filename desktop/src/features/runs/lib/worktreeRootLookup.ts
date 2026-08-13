// The worktree-root memo, pure: no React, no Tauri import, the lookup
// injected — which is what lets `worktreeRootLookup.test.mjs` run it under
// bare `node --test` (`useWorktreeRoot.ts` is the one caller and hands it
// `homeDir`).
//
// **Only a success is a fact about the machine.** A failure is an answer for
// the mount that asked — its `settled` goes true, its panes stop waiting —
// and it is deliberately not cached: `homeDir()` can fail transiently, and a
// memo that held the failure would leave every later surface broken until an
// app restart for a hiccup that lasted a frame. The concrete casualty was
// `workspace-close-request.spec.ts`, whose harness mounts once, installs its
// backend stub, and remounts — a failure-caching memo answered the remount
// from the pre-stub failure and the scratch shell could never resolve a cwd
// again. Cache the directory; retry the failure.

import { DEFAULT_WORKTREE_ROOT_SUFFIX } from "./projects.ts";

let asked: Promise<string | null> | null = null;

export function worktreeRootOnce(
  lookup: () => Promise<string>,
): Promise<string | null> {
  asked ??= lookup()
    .then((home) => {
      const base = home.endsWith("/") ? home.slice(0, -1) : home;
      return `${base}/${DEFAULT_WORKTREE_ROOT_SUFFIX}`;
    })
    .catch(() => {
      asked = null;
      return null;
    });
  return asked;
}

/** Forget the memoised lookup — tests only. */
export function resetWorktreeRootForTests() {
  asked = null;
}
