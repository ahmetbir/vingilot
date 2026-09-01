// The two calls this feature makes outside the webview
// (desktop/src-tauri/src/vingilot_pulls/mod.rs).
//
// No logic lives here. `pullsAnswer.ts` decides what an answer means and has
// the tests; this file is the invoke and the catch.
//
// **The catch is the point.** `invoke` rejects when the command is not
// registered, when the IPC is not there at all, or when the island panics —
// and a rejection swallowed into `null` would reach the pane as "nothing",
// which the pane would have to render as an empty list. It becomes
// `call-failed` with the error's own text instead, which has a sentence.

import { invoke } from "@tauri-apps/api/core";

import {
  callFailed,
  type PullDetail,
  type PullList,
  type PullsAnswer,
  readDetailAnswer,
  readListAnswer,
} from "@/features/pulls/lib/pullsAnswer";

function reason(error: unknown): string {
  if (typeof error === "string" && error !== "") return error;
  if (error instanceof Error && error.message !== "") return error.message;
  return "the call did not come back.";
}

/** The open pull requests of the repository `worktree` is a checkout of. */
export async function listPulls(
  worktree: string,
): Promise<PullsAnswer<PullList>> {
  try {
    return readListAnswer(await invoke<unknown>("pulls_list", { worktree }));
  } catch (error) {
    return callFailed(reason(error));
  }
}

/** One pull request of that repository, read whole. */
export async function viewPull(
  worktree: string,
  number: number,
): Promise<PullsAnswer<PullDetail>> {
  try {
    return readDetailAnswer(
      await invoke<unknown>("pulls_view", { number, worktree }),
    );
  } catch (error) {
    return callFailed(reason(error));
  }
}
