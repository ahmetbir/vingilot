// The plumbing between the workspace's own signals and the OS notification
// channel (vingilot/docs/plans/2026-08-09-signals-and-dashboards.md, Task 2).
//
// The decisions are all in `attentionNotice.ts`; this gathers the two readings
// each of them compares, and hands what comes out to the channel three live
// call sites already use (feed mentions, DM replies, reminders — all through
// `notifications/lib/desktop.ts`). Nothing here decides whether to speak.
//
// **What this hook can and cannot see.** It is mounted by `RunsScreen`, which
// is the only place the coordinator is polled from and the only place a
// worktree can be selected — so:
//
//   - Nothing is sent while the owner is on another screen: that screen
//     unmounts this one, and with it the poll the transitions are read from.
//     The workspace does not watch itself from the channel list, and this hook
//     does not pretend otherwise by replaying a backlog when it comes back —
//     the first reading after a remount primes (`attentionNotice.ts`).
//   - A click lands exactly while this screen is still mounted, because
//     selecting a worktree is this screen's own state. A notification clicked
//     after the owner has moved on reveals the window and changes nothing,
//     which is the honest half-answer; sending him to the workspace's *last*
//     state would be the answer the plan rules out.
//
// **Why it reads the notification settings a second time.** `AppShell` holds an
// instance for its own call sites, and the settings screen it lives beside
// replaces the router outlet wholesale — so that surface and this hook can
// never be mounted at the same time, and each mount re-reads the one place the
// values actually live (localStorage, per pubkey). The alternative was threading
// a shell-level object down through a route that exists to be independent of it.

import * as React from "react";

import {
  answeredNotice,
  type AttentionNotice,
  needsYouNotices,
  suppressed,
} from "@/features/runs/lib/attentionNotice";
import type { AttentionMark } from "@/features/runs/lib/attentionSignal";
import { worktreeCwd, worktreeSummary } from "@/features/runs/lib/projects";
import type { IndexedWorktree } from "@/features/runs/lib/terminalSessions";
import { useAskPending } from "@/features/runs/lib/useAskPending";
import { useNotificationSettings } from "@/features/notifications/hooks";
import {
  DESKTOP_NOTIFICATION_ACTION_EVENT,
  type DesktopNotificationTarget,
  requestDockBounce,
  sendDesktopNotification,
} from "@/features/notifications/lib/desktop";
import {
  playNotificationSound,
  resolveSlotSound,
} from "@/features/notifications/lib/sound";
import { useIdentityQuery } from "@/shared/api/hooks";

const EMPTY_MARKS: ReadonlyMap<string, AttentionMark> = new Map();

/** The turn this app has out, and where it was started. Remembered because the
 * settling is what has to be announced, and by then the store has dropped both
 * facts (`askStore.ts`'s `settleAsk`). */
interface AskOrigin {
  id: string;
  worktreeId: string | null;
}

export function useAttentionNotices({
  index,
  marks,
  onOpen,
  selectedWorktreeId,
  worktreeRoot,
}: {
  /** Every worktree this app knows about, by binding id — the map `RunsScreen`
   * already builds for terminals, reused because it carries the repo beside the
   * worktree and both are needed to name a place. */
  index: ReadonlyMap<string, IndexedWorktree>;
  /** Task 1's dots, by binding id. The same derivation the rows draw. */
  marks: ReadonlyMap<string, AttentionMark>;
  /** Stand where the notification pointed. */
  onOpen: (repoId: string, worktreeId: string) => void;
  /** The worktree on screen — what the suppression rule compares against. */
  selectedWorktreeId: string | null;
  worktreeRoot: string | null;
}): void {
  const identity = useIdentityQuery();
  const { settings } = useNotificationSettings(identity.data?.pubkey);

  const place = React.useCallback(
    (worktreeId: string): string | null => {
      const entry = index.get(worktreeId);
      if (entry === undefined) return null;
      return `${entry.repo.name} · ${worktreeSummary(entry.worktree).label}`;
    },
    [index],
  );

  const send = React.useEffectEvent((notice: AttentionNotice) => {
    if (!settings.desktopEnabled || !settings.slotAlertsEnabled.workspace) {
      return;
    }
    if (
      suppressed(notice, {
        focused: document.hasFocus(),
        worktreeId: selectedWorktreeId,
      })
    ) {
      return;
    }
    void sendDesktopNotification({
      body: notice.body,
      target: {
        channelId: null,
        eventId: null,
        kind: null,
        worktreeId: notice.worktreeId,
      },
      title: notice.title,
    }).then((didSend) => {
      if (!didSend) return;
      playNotificationSound(resolveSlotSound(settings, "workspace"));
      void requestDockBounce();
    });
  });

  // Reading n-1, kept so the derivation has a pair to compare. A ref rather
  // than state: it is never rendered, and setting it must not schedule the
  // render that would produce the next reading.
  const seen = React.useRef<ReadonlyMap<string, AttentionMark>>(EMPTY_MARKS);
  React.useEffect(() => {
    const previous = seen.current;
    seen.current = marks;
    for (const notice of needsYouNotices(previous, marks, place)) send(notice);
  }, [marks, place]);

  // The ask store holds a directory, not a binding id (`askStore.ts`: the guard
  // is one adapter for the whole app, so the turn is named by where it runs).
  // Every worktree's cwd is derived from the same rule the terminals use, so
  // this is a lookup rather than a second convention.
  const worktreeAt = React.useCallback(
    (cwd: string): string | null => {
      if (worktreeRoot === null) return null;
      for (const [worktreeId, entry] of index) {
        if (worktreeCwd(entry.repo, entry.worktree, worktreeRoot) === cwd) {
          return worktreeId;
        }
      }
      return null;
    },
    [index, worktreeRoot],
  );

  const pending = useAskPending();
  const asked = React.useRef<AskOrigin | null>(null);
  React.useEffect(() => {
    const previous = asked.current;
    if (pending !== null) {
      // The same turn on a later render keeps the worktree it was matched to
      // once — the directory is what the store holds, and re-deriving it every
      // poll would lose the origin the moment its row left the listing.
      asked.current =
        previous?.id === pending.id
          ? previous
          : { id: pending.id, worktreeId: worktreeAt(pending.cwd) };
      return;
    }
    asked.current = null;
    if (previous === null || previous.worktreeId === null) return;
    const notice = answeredNotice(
      previous.worktreeId,
      place(previous.worktreeId),
    );
    if (notice !== null) send(notice);
  }, [pending, place, worktreeAt]);

  const open = React.useEffectEvent((worktreeId: string) => {
    const entry = index.get(worktreeId);
    if (entry === undefined) return;
    onOpen(entry.repo.id, worktreeId);
  });

  // The shell owns the one plugin listener and re-broadcasts every click as a
  // window event (`notifications/lib/desktop.ts`); this listens to that rather
  // than registering a second one, which would be a second claim on the same
  // OS callback for the sake of the same information.
  React.useEffect(() => {
    function land(event: Event) {
      const target = (event as CustomEvent<DesktopNotificationTarget>).detail;
      const worktreeId = target.worktreeId ?? null;
      if (worktreeId === null) return;
      open(worktreeId);
    }
    window.addEventListener(DESKTOP_NOTIFICATION_ACTION_EVENT, land);
    return () => {
      window.removeEventListener(DESKTOP_NOTIFICATION_ACTION_EVENT, land);
    };
  }, []);
}
