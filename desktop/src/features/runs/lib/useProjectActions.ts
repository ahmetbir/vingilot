// Adding and forgetting a project, as the two callbacks the sidebar needs.
//
// The hook owns only sequencing and the transient state a button needs
// (in flight, last refusal). Every decision it makes is somebody else's: the
// picker and the probe are `repoClient.ts`, what a probe means is
// `repoChoice.ts`, and the CAS write with its single retry is `repoStore.ts`
// — all three of which are testable without React, which is the point of the
// split. What is left here is short enough to read in one go.
//
// A refusal is state, not a throw: "no .git here" and "the coordinator is not
// answering" are things the owner is shown and acts on, so they end up in
// `error` beside the button that caused them.

import * as React from "react";

import { getWorkspace, putRepos } from "@/features/runs/lib/coordinatorClient";
import type { Repo } from "@/features/runs/lib/projects";
import {
  pickProjectDirectory,
  probeRepo,
} from "@/features/runs/lib/repoClient";
import {
  addRepoPlan,
  commitRepos,
  removeRepoPlan,
  type WorkspaceRepoIo,
} from "@/features/runs/lib/repoStore";

export interface ProjectActions {
  /** Opens the native folder picker and adds what it returns, if the folder
   * is one this workspace can hold. */
  addProject: () => void;
  /** Forgets a project's path. Touches nothing on disk. */
  removeProject: (repo: Repo) => void;
  /** True while either is in flight — the buttons disable rather than queue,
   * since a second picker over the first is not something to explain. */
  pending: boolean;
  /** The last refusal, in words the owner can act on, or `null`. */
  error: string | null;
  dismissError: () => void;
}

interface ProjectActionsOptions {
  workspaceId: string;
  /** The repo that just left the workspace. Its worktrees' terminals are
   * closed from here rather than waiting for the next poll to notice. */
  onRemoved?: (repoId: string) => void;
}

export function useProjectActions({
  onRemoved,
  workspaceId,
}: ProjectActionsOptions): ProjectActions {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const io = React.useMemo<WorkspaceRepoIo>(
    () => ({
      read: () => getWorkspace(workspaceId),
      write: (expectedRevision, repos) =>
        putRepos(workspaceId, expectedRevision, repos),
    }),
    [workspaceId],
  );

  const addProject = React.useCallback(() => {
    setError(null);
    setPending(true);
    void (async () => {
      try {
        const path = await pickProjectDirectory();
        // Cancelled. Not a refusal, and nothing to say about it.
        if (path === null) return;

        const probe = await probeRepo(path);
        if (probe === null) {
          setError(`could not read ${path}.`);
          return;
        }

        const result = await commitRepos(io, addRepoPlan(path, probe));
        if (!result.ok) setError(result.reason);
      } catch (thrown) {
        // The picker and the probe are Tauri calls: outside a Tauri host
        // (a browser preview) they reject rather than answer.
        setError(`could not open the folder picker: ${String(thrown)}`);
      } finally {
        setPending(false);
      }
    })();
  }, [io]);

  const removeProject = React.useCallback(
    (repo: Repo) => {
      setError(null);
      setPending(true);
      void (async () => {
        const result = await commitRepos(io, removeRepoPlan(repo.id));
        setPending(false);
        if (!result.ok) {
          setError(result.reason);
          return;
        }
        onRemoved?.(repo.id);
      })();
    },
    [io, onRemoved],
  );

  const dismissError = React.useCallback(() => setError(null), []);

  return { addProject, dismissError, error, pending, removeProject };
}
