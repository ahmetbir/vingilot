// What a worktree is called where one name has to do (2026-09-03, his first
// report through the drop: "isimlendirmeler igrenc ... grup isimleri de
// repo/worktree gibi olabilir").
//
// The name he already uses for a checkout is its directory:
// `~/.vingilot/worktrees/ai/dev` is `ai/dev`, and the repo's own checkout is
// the repo's directory. A checkout the coordinator provisioned lives under a
// run id, which names nothing to him, so that one is called by its branch.
// Never the binding id — a hex-encoded path is what the first cut showed him.

import { localWorktreePath } from "./projects.ts";

/** In order of what he would call it: `repo/worktree` for a checkout under a
 * `worktrees/` root; the branch, for a checkout the coordinator provisioned;
 * the directory's own name otherwise; and the binding id with its scheme
 * stripped only when there is nothing else to read. */
export function worktreeLabel(
  bindingId: string,
  cwd: string | null,
  branch: string | null = null,
): string {
  const path = cwd ?? localWorktreePath(bindingId);
  const parts = (path ?? "").split("/").filter((p) => p !== "");
  const at = parts.lastIndexOf("worktrees");
  if (at !== -1 && at + 2 < parts.length) {
    return `${parts[at + 1]}/${parts[at + 2]}`;
  }
  if (branch !== null && branch !== "") return branch;
  if (parts.length > 0) return parts[parts.length - 1];
  const colon = bindingId.indexOf(":");
  return colon === -1 ? bindingId : bindingId.slice(colon + 1);
}
