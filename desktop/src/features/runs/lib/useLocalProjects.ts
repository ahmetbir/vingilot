// The project list as the screen uses it: what to show, how to add and forget
// a project, and the two things that happen against a coordinator when there
// is one (vingilot/docs/plans/2026-08-10-coordinator-optional.md, Task 1).
//
// This hook owns only sequencing and the transient state a button needs. Every
// decision it makes is somebody else's: the picker and the probe are
// `repoClient.ts`, the file is `localProjectsClient.ts`, and what any of it
// means — the shape, the add, the remove, the seed-once condition, whether
// there is anything to push — is `localProjects.ts`, which has no React and no
// Tauri in it and therefore has the tests.
//
// **The local list is the authority.** It is read from the file, and it is
// what the workspace shows. The coordinator is written to and never read from
// — with exactly one exception, the seed-once import, which exists because on
// the owner's Mac mini his real projects live only in the coordinator and this
// build is the one that decides whether he still has them.
//
// **Nothing is written when the store could not be read.** A load that failed
// (an unparseable file, or no Tauri host at all — a browser preview, the E2E
// bridge) leaves `doc` null, and every path below is gated on it: no save, no
// seed, no push. What is shown instead is whatever the coordinator holds,
// which on a preview is the only list there is; adding is refused in words
// that say why. Guessing a list would be how the owner's file gets replaced by
// an empty one.
//
// It replaces `useProjectActions.ts` + `repoStore.ts`, whose add and remove
// were compare-and-set writes straight into the workspace document. That is
// the thing this plan removes: those two calls are the reason a machine with
// no coordinator could not hold a project at all.

import * as React from "react";

import type { WorkspaceSnapshot } from "@/features/runs/lib/coordinatorClient";
import { putRepos } from "@/features/runs/lib/coordinatorClient";
import {
  acknowledgeImport,
  addLocalProject,
  importNotice,
  LOCAL_PROJECTS_DISPLAY_PATH,
  type LocalProjects,
  pushDecision,
  readLocalProjects,
  removeLocalProject,
  seedOnceDecision,
  serializeLocalProjects,
  unreadableStoreNotice,
  unreconciledNotice,
} from "@/features/runs/lib/localProjects";
import {
  loadLocalProjectsFile,
  saveLocalProjectsFile,
} from "@/features/runs/lib/localProjectsClient";
import { readRepos, type Repo } from "@/features/runs/lib/projects";
import {
  pickProjectDirectory,
  probeRepo,
} from "@/features/runs/lib/repoClient";

export interface LocalProjectStore {
  /** What the workspace shows. */
  repos: Repo[];
  /** Opens the native folder picker and adds what it returns, if the folder
   * is one this workspace can hold. */
  addProject: () => void;
  /** Forgets a project's path. Touches nothing on disk. */
  removeProject: (repo: Repo) => void;
  /** True while an add or a remove is in flight — the buttons disable rather
   * than queue, since a second picker over the first is not something to
   * explain. */
  pending: boolean;
  /** The last refusal, in words the owner can act on, or `null`. */
  error: string | null;
  dismissError: () => void;
  /** The sentence about a seed-once import, or `null` when none happened (or
   * it has been read). A silent import is indistinguishable from a silent
   * loss when it goes wrong, which is why this is not optional. */
  importNotice: string | null;
  dismissImportNotice: () => void;
  /** The standoff sentence, or `null`: a coordinator holding a list this
   * machine has never taken, against a list that was started here. Not
   * dismissible — it describes a state, and it goes away when the state
   * does. */
  coordinatorNotice: string | null;
  /** The sentence for a local list that could not be read, or `null`. Also a
   * state rather than an event, and also not dismissible: while it holds,
   * what is on screen is not this machine's list and nothing may be written.
   * It is on screen before the add button is pressed rather than after,
   * because the state it describes is the one that reads as a fresh
   * install. */
  storeNotice: string | null;
}

interface Options {
  workspaceId: string;
  /** The last workspace document the coordinator answered with, or `null` if
   * it never has (`usePolling` holds the last good read). `null` is what the
   * seed reads as "no answer" — the condition that must never be mistaken for
   * "no projects". */
  snapshot: WorkspaceSnapshot | null;
  /** The repo that just left the list. Its worktrees' terminals are closed
   * from here rather than waiting for the next poll to notice. */
  onRemoved?: (repoId: string) => void;
}

export function useLocalProjects({
  onRemoved,
  snapshot,
  workspaceId,
}: Options): LocalProjectStore {
  // `usePolling` types its data `T | null`, but `coordinatorClient` answers a
  // 200 with an empty body as `undefined` (`coordinatorClient.ts` — the
  // coordinator's own endpoints are inconsistent about ack bodies). So the
  // value arriving here can be either, while the type says one. Normalised
  // once rather than guarded at each use: three places below ask "did the
  // coordinator answer", and two of them dereference the answer.
  const answer: WorkspaceSnapshot | null = snapshot ?? null;
  const [doc, setDoc] = React.useState<LocalProjects | null>(null);
  const [storeError, setStoreError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadLocalProjectsFile();
      if (cancelled) return;
      if (!loaded.ok) {
        setStoreError(loaded.reason);
        return;
      }
      const read = readLocalProjects(loaded.text);
      if (!read.ok) {
        setStoreError(`${LOCAL_PROJECTS_DISPLAY_PATH} ${read.reason}`);
        return;
      }
      setDoc(read.doc);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Take a new document as the truth and write it. The state moves first so
   * the screen never lags the click; a write that fails is reported beside the
   * button rather than rolled back, because the owner's next act is to fix the
   * disk, not to click again. */
  const persist = React.useCallback(async (next: LocalProjects) => {
    setDoc(next);
    const saved = await saveLocalProjectsFile(serializeLocalProjects(next));
    if (!saved.ok) setError(`could not save the project list: ${saved.reason}`);
  }, []);

  // The last workspace revision a push was sent at. Without it, a push that
  // has not yet come back around through the 2s poll would be sent again at
  // the same revision on every render the effect re-runs on — the second one
  // losing the CAS it just won.
  const pushedAt = React.useRef<number | null>(null);

  React.useEffect(() => {
    // No store: not read, so nothing may be written anywhere from it.
    if (doc === null) return;
    // The coordinator has never answered. Runs are unavailable and that is
    // all — there is nothing to seed from and nothing to push to.
    if (answer === null) return;

    // The whole document, not a list read out of it: which reader the seed
    // needs is `seedOnceDecision`'s to know, and the one that drops entries
    // this build cannot parse is the shorter name.
    const decision = seedOnceDecision(
      doc,
      { answered: true, state: answer.state },
      new Date().toISOString(),
    );
    if (decision.seed) {
      void persist(decision.doc);
      return;
    }

    const push = pushDecision(doc, answer.state);
    if (!push.push) return;
    if (pushedAt.current === answer.revision) return;
    pushedAt.current = answer.revision;
    // One direction: the local list is sent, and whatever comes back is not
    // applied to it. A lost CAS needs no retry here — the next poll reads the
    // winner's document and this runs again against it.
    void putRepos(workspaceId, answer.revision, push.repos);
  }, [doc, answer, persist, workspaceId]);

  const addProject = React.useCallback(() => {
    setError(null);
    if (doc === null) {
      setError(
        `cannot add a project: the local project list could not be read (${
          storeError ?? "no local store on this machine"
        }).`,
      );
      return;
    }
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

        const added = addLocalProject(doc, path, probe);
        if (!added.ok) {
          setError(added.reason);
          return;
        }
        await persist(added.doc);
      } catch (thrown) {
        // The picker and the probe are Tauri calls: outside a Tauri host
        // (a browser preview) they reject rather than answer.
        setError(`could not open the folder picker: ${String(thrown)}`);
      } finally {
        setPending(false);
      }
    })();
  }, [doc, persist, storeError]);

  const removeProject = React.useCallback(
    (repo: Repo) => {
      setError(null);
      if (doc === null) {
        // Same refusal as `addProject`, and said for the same reason: the rows
        // on screen in this state are the coordinator's, the × over each one
        // is live, and a click that returns silently reads as "forgotten" —
        // the project is still there at the next launch and nothing said why.
        setError(
          `cannot forget a project: the local project list could not be read (${
            storeError ?? "no local store on this machine"
          }).`,
        );
        return;
      }
      setPending(true);
      void (async () => {
        await persist(removeLocalProject(doc, repo.id));
        setPending(false);
        onRemoved?.(repo.id);
      })();
    },
    [doc, onRemoved, persist, storeError],
  );

  const dismissError = React.useCallback(() => setError(null), []);

  const dismissImportNotice = React.useCallback(() => {
    if (doc === null) return;
    void persist(acknowledgeImport(doc));
  }, [doc, persist]);

  // No local store: the coordinator's list is the only one there is, and it is
  // read-only from here. On an installed app this branch is unreachable — it
  // is the browser preview and the E2E bridge, where `invoke` rejects.
  const repos = React.useMemo(
    () => (doc === null ? readRepos(answer?.state ?? null) : doc.repos),
    [doc, answer],
  );

  return {
    addProject,
    coordinatorNotice:
      doc === null || answer === null
        ? null
        : unreconciledNotice(doc, answer.state),
    dismissError,
    dismissImportNotice,
    error,
    importNotice: doc === null ? null : importNotice(doc),
    pending,
    removeProject,
    repos,
    // `storeError` is null until the load has come back, so nothing is said
    // during it: an unread list and an unreadable one are a different
    // sentence, and only one of them is worth interrupting for.
    storeNotice: unreadableStoreNotice(
      doc === null ? storeError : null,
      repos.length,
    ),
  };
}
