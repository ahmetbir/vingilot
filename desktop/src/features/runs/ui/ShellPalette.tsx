// **⌘K on every screen that is not the workspace**
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 2; ADR-005's last
// paragraph).
//
// The owner's report: *"cmd k buzz kısmında farklı deck kısmında farklı
// çalışıyor."* On a chat route ⌘K opened upstream's message-search dialog and
// on /workspace it opened this fork's palette — one chord, two surfaces, two
// row vocabularies. This component is the half of the fix that lives outside
// the workspace: the same palette, the same engine, the same rows, mounted at
// the root route beside `AppShell`.
//
// **Hosting, not rewriting** (ADR-001). Upstream's dialog is untouched —
// not forked, not edited, not deleted. What this reads is their *data*:
// `useChannelsQuery` is the store `AppShell` hands its sidebar, its switcher
// and `TopbarSearch`, and a channel row navigates through `useAppNavigation`'s
// `goChannel`, which is where their switcher would have gone. Their surface is
// still one click away on the sidebar's "Search everything" button, on every
// screen, unchanged.
//
// **What it can offer here, and what it deliberately cannot.** Channels are
// live. Projects, worktrees and recent files come from `paletteWorld.ts` — the
// snapshot the workspace publishes — because `RunsScreen` is the /workspace
// route's own chunk and is not mounted here; selecting one navigates and lands
// through `workspaceLanding.ts`. Panes and actions are **not offered**: there
// is no work surface on a chat route to put a pane in, and a row that ran
// nothing would be worse than no row. That is `offers`, and the same field is
// what makes ⌘P fall through untouched here (`usePalette.ts`).
//
// **It never draws while the workspace's palette is mounted**
// (`paletteClaim.ts`), which is what keeps one chord bound once. The two mount
// points exist because the workspace's palette is positioned inside its work
// surface on purpose and this one has no work surface to sit in — the argument
// is in `paletteClaim.ts`'s header.

import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { requestSearchOpen } from "@/features/search/lib/searchRequest";
import { requestFile } from "@/features/runs/lib/filesTarget";
import { subscribePaletteClaim } from "@/features/runs/lib/paletteClaim";
import { paletteClaimed } from "@/features/runs/lib/paletteClaim";
import type { PaletteSourceId } from "@/features/runs/lib/paletteDoors";
import type { PaletteCommand } from "@/features/runs/lib/paletteModel";
import type {
  PaletteChannel,
  PaletteContext,
} from "@/features/runs/lib/paletteSources";
import { readWorld, subscribeWorld } from "@/features/runs/lib/paletteWorld";
import { usePalette } from "@/features/runs/lib/usePalette";
import { requestLanding } from "@/features/runs/lib/workspaceLanding";
import { CommandPalette } from "@/features/runs/ui/CommandPalette";

/** The four sources a screen with no work surface can honestly answer for. */
const SHELL_OFFERS: readonly PaletteSourceId[] = [
  "channels",
  "projects",
  "worktrees",
  "recent-files",
  // App-wide rows (the Appearance door) — Settings exists on every screen, so
  // a host with no work surface can still answer for these (P1.1, veto 2).
  "app",
];

/** Whether the workspace's own palette is mounted. Subscribed rather than
 * polled: the answer changes exactly twice per visit to /workspace. */
function useWorkspaceClaim(): boolean {
  return React.useSyncExternalStore(subscribePaletteClaim, paletteClaimed);
}

function useWorld() {
  return React.useSyncExternalStore(subscribeWorld, () => readWorld());
}

export function ShellPalette() {
  const claimed = useWorkspaceClaim();
  if (claimed) return null;
  return <ShellPaletteHost />;
}

/** Split from the component above so that **no hook runs while the workspace
 * owns the palette** — in particular `useChannelsQuery`, which would otherwise
 * be a second subscriber to the channel list on a screen that is not showing
 * one. An early `return null` after the hooks would have kept them all
 * running. */
function ShellPaletteHost() {
  const channelsQuery = useChannelsQuery();
  const world = useWorld();
  const { goChannel, goSettings, goWorkspace } = useAppNavigation();

  const channels: readonly PaletteChannel[] = React.useMemo(
    () =>
      (channelsQuery.data ?? [])
        // Only what he is in. Upstream's own sidebar makes the same cut, and a
        // palette offering to "go to" a channel he is not a member of would be
        // offering a navigation the relay answers with an empty room.
        .filter((channel) => channel.isMember)
        .map((channel) => ({
          dm: channel.channelType === "dm",
          id: channel.id,
          name: channel.name,
          topic: channel.topic,
        })),
    [channelsQuery.data],
  );

  const context: PaletteContext = {
    channels,
    openFile: null,
    paneChoices: [],
    prunable: 0,
    recentFiles: world.recentFiles,
    repos: world.projects.map((project) => ({
      id: project.id,
      name: project.name,
      path: project.path,
    })),
    selectedRepoId: null,
    selectedWorktreeId: null,
    shim: null,
    sidebarCollapsed: false,
    solo: null,
    worktreeCwd: null,
    worktreeCwdPending: false,
    // The snapshot's worktrees, given the shape `worktreeSource` reads. It is
    // a copy and says so: the live list is the workspace's, and landing there
    // is what actually opens one.
    worktrees: world.worktrees.map((worktree) => ({
      added: null,
      base_commit: "",
      binding_id: worktree.bindingId,
      branch: worktree.label,
      commit_sha: null,
      lifecycle: "ready",
      owner_run_id: null,
      owner_run_objective: null,
      owner_run_status: null,
      removed: null,
      repo_id: worktree.repoId,
      role: "task",
    })),
  };

  const onCommand = React.useCallback(
    (command: PaletteCommand) => {
      switch (command.type) {
        case "open-channel":
          void goChannel(command.channelId);
          return;
        case "open-appearance":
          // Upstream's own settings deep link — the same door the workspace
          // host takes (P1.1, veto 2).
          void goSettings("appearance");
          return;
        case "open-message-search":
          // The mailbox to the hidden search mount (P1.1, veto 1).
          requestSearchOpen();
          return;
        case "open-landing":
          void goWorkspace();
          return;
        case "open-project":
          requestLanding({
            bindingId: null,
            repoId: command.repoId,
            showFiles: false,
          });
          void goWorkspace();
          return;
        case "open-worktree":
          requestLanding({
            bindingId: command.bindingId,
            repoId: null,
            showFiles: false,
          });
          void goWorkspace();
          return;
        case "open-file":
          // The target first, then the landing that brings its pane forward,
          // then the navigation — the order `RunsScreen`'s own show-file act
          // uses, and the reason a request made before the pane exists works
          // at all (`filesTarget.ts`).
          requestFile({
            line: command.line,
            path: command.path,
            worktree: command.worktree,
          });
          requestLanding({
            bindingId: null,
            repoId: null,
            showFiles: true,
          });
          void goWorkspace();
          return;
        default:
          // Every other command needs a work surface, and `SHELL_OFFERS` is why
          // no row here can produce one. Silence rather than a throw: a palette
          // that crashed the shell on an unreachable row would be a worse
          // answer than a row that does nothing, and the row does not exist.
          return;
      }
    },
    [goChannel, goSettings, goWorkspace],
  );

  const palette = usePalette({
    // No worktree, so nowhere to run one: ask mode is the workspace's, and here
    // it refuses with `askMode.ts`'s own sentence rather than with a missing
    // surface. `unknown` is the honest reading for a probe nobody ran on this
    // screen — it is not `no`, which would be a claim about the machine.
    ask: {
      cwd: null,
      cwdPending: false,
      harness: { answer: "unknown", detail: null },
      inFlight: null,
    },
    context,
    offers: SHELL_OFFERS,
    onCommand,
  });

  if (!palette.open) return null;
  // Fixed over the window rather than absolute inside a box: this screen has no
  // work surface to sit in, which is the whole reason there are two hosts.
  return (
    <div className="fixed inset-0 z-50" data-testid="shell-palette">
      <CommandPalette palette={palette} />
    </div>
  );
}
