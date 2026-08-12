// The `vingilot_search` Tauri command (desktop/src-tauri/src/vingilot_search/).
// No logic lives here: `searchModel.ts` decides what an answer means, what each
// refusal says and how hits become rows, and it is tested without a backend.
//
// The call answers rather than throws. A refusal is an ordinary outcome of this
// command — an empty field, a regex git will not compile, a search that ran too
// long — so it is a value the pane renders, never an exception something has to
// remember to catch. The same shape `filesClient.ts` and `worktreeClient.ts`
// use, for the same reason.

import { invoke } from "@tauri-apps/api/core";

import {
  readSearchError,
  type SearchAnswer,
  type SearchError,
} from "@/features/runs/lib/searchModel";

export type SearchResult =
  | { ok: true; value: SearchAnswer }
  | { ok: false; error: SearchError };

/** Whatever came back from a rejected `invoke`, as a refusal. A shape this
 * build cannot read still has to reach the owner as words, so it is reported as
 * what it is — the backend, or the bridge to it, failing in a way this client
 * has no name for. Deliberately not folded into one of the named refusals:
 * "this is not a repository" would be a claim nothing made. */
function asError(thrown: unknown): SearchError {
  return (
    readSearchError(thrown) ?? {
      command: "vingilot_search",
      kind: "git-failed",
      stderr: String(thrown),
    }
  );
}

/** Every matching line in one worktree's checkout, or the sentence saying why
 * not. `regex` false is a literal search, which is the default. */
export async function searchWorktree(
  worktree: string,
  pattern: string,
  regex: boolean,
): Promise<SearchResult> {
  try {
    const answer = await invoke<SearchAnswer>("worktree_search", {
      pattern,
      regex,
      worktree,
    });
    return { ok: true, value: answer };
  } catch (thrown) {
    return { error: asError(thrown), ok: false };
  }
}
