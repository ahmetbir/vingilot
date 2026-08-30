// What the workspace's palette knows that `RunsScreen` did not already hold:
// the community's channels, the files he has opened, the selected worktree's
// listing, and the four wires that make ⌘K one gesture app-wide
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 2).
//
// **Split out of `RunsScreen.tsx` rather than added to it.** That screen is
// against the 1000-line ratchet and the house rule is to split; this is the
// cohesive piece — every field below is an *input to the palette* and nothing
// else on the screen reads any of them.
//
// The four wires, each one line at the call site:
//
// 1. **The claim** (`paletteClaim.ts`) — while this screen is mounted, the
//    shell's palette draws nothing and binds nothing, so one chord stays bound
//    once.
// 2. **The snapshot** (`paletteWorld.ts`) — the projects and worktrees are
//    published so ⌘K on a chat route has something to offer besides channels.
// 3. **The landing** (`workspaceLanding.ts`) — a project or worktree chosen
//    from a chat route is filed there and consumed here, after the navigation.
// 4. **The listing** (`useWorktreeFiles.ts`) — ⌘P's rows.
//
// **Why the file listing is read as soon as a worktree is selected**, rather
// than when the files door opens: the door's own state lives inside
// `usePalette`, which is constructed *from* this hook's answer, and a value
// that arrived a render after the chord would leave ⌘P showing an empty box for
// a frame. One `worktree_tree` call for the root per worktree is the same call
// the Files pane makes when it is opened, and it is the whole cost — the
// deepening is still driven by the query, and the query is allowed to arrive a
// render late because deepening is progressive by construction.

import * as React from "react";

import { useChannelsQuery } from "@/features/channels/hooks";
import { requestFile } from "@/features/runs/lib/filesTarget";
import { claimPalette } from "@/features/runs/lib/paletteClaim";
import type { PaletteSourceId } from "@/features/runs/lib/paletteDoors";
import type {
  PaletteChannel,
  PaletteFile,
} from "@/features/runs/lib/paletteSources";
import {
  publishPlaces,
  readWorld,
  rememberFile,
  subscribeWorld,
  type WorldProject,
  type WorldWorktree,
} from "@/features/runs/lib/paletteWorld";
import {
  type GroupedWorktrees,
  type Repo,
  worktreeSummary,
} from "@/features/runs/lib/projects";
import type { WorktreeStats } from "@/features/runs/lib/useWorktreeStats";
import { usableStat } from "@/features/runs/lib/worktreeStat";
import { useWorktreeFiles } from "@/features/runs/lib/useWorktreeFiles";
import {
  subscribeLanding,
  takeLanding,
} from "@/features/runs/lib/workspaceLanding";

/** Everything the workspace can answer for — the front door's full list, plus
 * the files door when there is a checkout under it. */
const WITH_FILES: readonly PaletteSourceId[] = [
  "projects",
  "worktrees",
  "channels",
  "recent-files",
  "panes",
  // The crew is a workspace source and only a workspace source: its rows carry
  // *this worktree* to an agent (`crewReach.ts`), and a host with no work
  // surface has nothing to carry. Listed unconditionally rather than gated on
  // whether a crew exists — an empty crew is an empty row list, which is the
  // source answering, not the host refusing to ask.
  "crew",
  "actions",
  // App-wide rows (the Appearance door, P1.1 veto 2) — both hosts offer them.
  "app",
  "worktree-files",
];
const WITHOUT_FILES: readonly PaletteSourceId[] = WITH_FILES.filter(
  (id) => id !== "worktree-files",
);

export interface WorkspacePaletteInputs {
  repos: readonly Repo[];
  /** EVERY project's worktrees, grouped under their repo — the same
   * derivation the nav's tree renders (P1.1 veto 4: the snapshot carries all
   * of them, with their repo relation, so the sidebar on a chat route can draw
   * each project's children under that project's row). */
  grouped: GroupedWorktrees;
  /** git's per-worktree stats, for the snapshot's `clean` copy. */
  stats: WorktreeStats;
  /** The selected checkout's directory, or `null`. */
  worktreeCwd: string | null;
  selectRepo: (repoId: string) => void;
  selectWorktree: (bindingId: string) => void;
  showFiles: () => void;
}

export interface WorkspacePalette {
  channels: readonly PaletteChannel[];
  recentFiles: readonly PaletteFile[];
  worktreeFiles: readonly PaletteFile[];
  offers: readonly PaletteSourceId[];
  /** Tell this hook what the palette's field currently says, so the listing can
   * deepen. Called from an effect on the other side of `usePalette` — which is
   * the one direction the data cannot flow in during render. */
  setQuery: (query: string) => void;
  /** Record that the viewer opened a file, so ⌘K's recent rows are what he
   * actually looked at. Called from the same `file-opened` report the place
   * switcher reads — one report, two readers, not two reports. */
  rememberOpenFile: (worktree: string, path: string) => void;
}

export function useWorkspacePalette({
  grouped,
  repos,
  selectRepo,
  selectWorktree,
  showFiles,
  stats,
  worktreeCwd,
}: WorkspacePaletteInputs): WorkspacePalette {
  // 1. The claim: mounted here means the shell's palette stands down.
  React.useEffect(() => claimPalette(), []);

  const channelsQuery = useChannelsQuery();
  const channels: readonly PaletteChannel[] = React.useMemo(
    () =>
      (channelsQuery.data ?? [])
        .filter((channel) => channel.isMember)
        .map((channel) => ({
          dm: channel.channelType === "dm",
          id: channel.id,
          name: channel.name,
          topic: channel.topic,
        })),
    [channelsQuery.data],
  );

  // 2. The snapshot. Published during an effect rather than a render, and
  // `publishPlaces` compares by content — this screen re-renders on a 2s poll
  // and both arrays are rebuilt every time.
  const places = React.useMemo(() => {
    const projects: WorldProject[] = repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      path: repo.path,
    }));
    // Every project's worktrees, in repo order — each row carries its repo id
    // and git's clean/dirty answer at publish time (P1.1 veto 4). `null`
    // stays `null`: a stat git never answered is not "clean".
    const rows: WorldWorktree[] = repos.flatMap((repo) =>
      (grouped.byRepo[repo.id] ?? []).map((worktree) => {
        const stat = usableStat(stats[worktree.binding_id]);
        return {
          bindingId: worktree.binding_id,
          clean: stat === null ? null : !stat.dirty,
          detail:
            worktree.role === "primary"
              ? "the project's checkout"
              : worktree.role,
          label: worktreeSummary(worktree).label,
          repoId: worktree.repo_id,
        };
      }),
    );
    return { projects, rows };
  }, [grouped, repos, stats]);
  React.useEffect(() => {
    publishPlaces(places.projects, places.rows);
  }, [places]);

  const world = React.useSyncExternalStore(subscribeWorld, () => readWorld());
  const recentFiles: readonly PaletteFile[] = world.recentFiles;

  // 3. The landing. Consumed on mount (the request is filed before this screen
  // exists, which is the whole point) and on every later one.
  const land = React.useRef({ selectRepo, selectWorktree, showFiles });
  land.current = { selectRepo, selectWorktree, showFiles };
  React.useEffect(() => {
    function consume() {
      const landing = takeLanding();
      if (landing === null) return;
      if (landing.repoId !== null) land.current.selectRepo(landing.repoId);
      if (landing.bindingId !== null) {
        land.current.selectWorktree(landing.bindingId);
      }
      if (landing.showFiles) land.current.showFiles();
    }
    consume();
    return subscribeLanding(consume);
  }, []);

  // 4. The listing. See this file's header for why `active` is the worktree
  // rather than the door — and `useWorktreeFiles.ts`'s, which says the same
  // thing from the other end so neither header can be read alone and believed.
  const [query, setQueryState] = React.useState("");
  const worktreeFiles = useWorktreeFiles(
    worktreeCwd,
    worktreeCwd !== null,
    query,
  );

  const setQuery = React.useCallback((next: string) => {
    setQueryState((prev) => (prev === next ? prev : next));
  }, []);

  const rememberOpenFile = React.useCallback(
    (worktree: string, path: string) => {
      rememberFile({ line: null, path, worktree });
    },
    [],
  );

  return {
    channels,
    offers: worktreeCwd === null ? WITHOUT_FILES : WITH_FILES,
    recentFiles,
    rememberOpenFile,
    setQuery,
    worktreeFiles,
  };
}

/** The workspace's own `open-file` command: the same `show-file` route every
 * other caller takes. Exported here rather than written into `RunsScreen` so
 * the ordering rule — file first, pane second — is stated once. */
export function openFileFromPalette(
  worktree: string,
  path: string,
  line: number | null,
  showFiles: () => void,
): void {
  requestFile({ line, path, worktree });
  showFiles();
}
