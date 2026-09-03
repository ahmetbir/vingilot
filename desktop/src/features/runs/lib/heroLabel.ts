// What a hero chip is called (2026-09-03, his first report through the drop:
// "isimlendirmeler igrenc. hicbirsey anlasilmiyor ... grup isimleri de
// repo/worktree gibi olabilir").
//
// The first cut drew the branch when it had one and the BINDING ID when it
// did not — and a worktree git listed has no branch on the coordinator's row,
// so his strip read `local:2f55736572732f61686d6…`: a hex-encoded path. What
// he asked for is the name he already uses for the checkout: `repo/worktree`.
// Every checkout has a directory, and the directory says exactly that —
// `~/.vingilot/worktrees/ai/dev` is `ai/dev`, and the repo's own checkout is
// the repo's directory. So the label is read off the cwd, which every open
// session already carries, and never off the binding id.

import { localWorktreePath } from "./projects.ts";

/** In order of what he would call it: `repo/worktree` for a checkout under a
 * `worktrees/` root; the branch, for a checkout the coordinator provisioned
 * (its directory is a run id, which names nothing to him); the directory's
 * own name otherwise; and the binding id with its scheme stripped only when
 * there is nothing else to read. */
export function heroChipLabel(
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
