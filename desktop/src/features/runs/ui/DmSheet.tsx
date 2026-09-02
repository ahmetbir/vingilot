// **The DM sheet and its pill** — redesign P6, the mockup's `#dmsheet` and
// `#dmpill` (Vingilot.html:496-510, `vingilot.css:295-305`,
// `vingilot.js:31-34`), drawn birebir: bottom-right of the work surface,
// 360×470 capped at 70vh, the header's avatar / name / presence line, the three
// controls, and a pill that keeps the conversation's identity.
//
// **The conversation inside it is upstream's, whole.** `TeamThreadPane.tsx`
// already paid for the alternative and wrote down the receipt: a surface that
// draws "its own list and its own textarea" loses mention autocomplete, loses
// the `p` tags on send, and becomes a second messaging stack to keep in step
// with the first. So the body is `ChannelRouteScreen` on the DM's own channel
// id — the same component `/channels/$channelId` renders — under the same two
// providers that make a hosted channel surface safe (`HostedChannelProvider`
// for the per-app slots, `MainInsetProvider` so the measured header variable
// lands on this sheet instead of the app's `<main>`). Real messages, the real
// composer, the real drafts, the real send, and the real failure line, because
// they are literally the app's.
//
// Two pieces of that surface are hidden here rather than forked. Its header
// would be a second copy of the name already in `.dmh`, three rows above it, in
// 360px; and its statusline's connection word is the one this sheet puts in the
// presence slot (`dmSheet.ts` says why the socket outranks presence there). The
// hiding is scoped to this subtree by descendant selectors — no upstream file
// is edited, and nothing here changes what those components do on the route.
//
// **Minimizing hides; it does not unmount.** That is the whole of requirement
// "what was typed is still there when it comes back" — the composer keeps its
// own state because it is never taken down. Closing unmounts, and is a
// different button.
//
// **No Esc.** The mockup gives the sheet none, and the app already has two Esc
// claimants that a third would race (`DockFloat.tsx` docks the float back;
// upstream's composer cancels a reply/edit). A sheet is not a modal: it takes
// no focus trap, so the surface underneath keeps every chord it had, and the
// strips' chords stay refused while the caret is in the composer by
// `typingTarget.ts`'s existing predicate — nothing new claims a key here.

import { Minus, PanelRight, X } from "lucide-react";
import * as React from "react";

import { ChannelRouteScreen } from "@/app/routes/ChannelRouteScreen";
import { useChannelsQuery } from "@/features/channels/hooks";
import {
  dmPresenceSentence,
  isDmPillShowing,
  isDmSheetShowing,
} from "@/features/runs/lib/dmSheet";
import type { DmSheetController } from "@/features/runs/lib/useDmSheet";
import { useProfileQuery } from "@/features/profile/hooks";
import {
  ProfileAvatarWithStatus,
  scaleProfileAvatarStatusGeometry,
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
} from "@/features/profile/ui/ProfileAvatarWithStatus";
import { useDmSidebarMetadata } from "@/features/sidebar/useDmSidebarMetadata";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useRelayConnection } from "@/shared/api/useRelayConnection";
import type { Channel } from "@/shared/api/types";
import { HostedChannelProvider } from "@/shared/context/HostedChannelContext";
import { MainInsetProvider } from "@/shared/layout/MainInsetContext";
import { cn } from "@/shared/lib/cn";

/** The mockup's `.dmh .av` is 30px; the pill's is 24px. */
const SHEET_AVATAR_SIZE = 30;
const PILL_AVATAR_SIZE = 24;

export function DmSheet({
  controller,
  onOpenFullView,
  unreadCount,
}: {
  controller: DmSheetController;
  /** Hands the conversation back to `/channels/$id`, where the rest of it is. */
  onOpenFullView: (channelId: string) => unknown;
  /** Real unread messages in this conversation, or 0. Never a placeholder. */
  unreadCount: number;
}) {
  const { state } = controller;
  // The same three stores the channel route reads for itself — React Query
  // caches, so asking here is asking the same copy the sidebar was built from,
  // not a second fetch.
  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const profileQuery = useProfileQuery();
  const currentPubkey = identityQuery.data?.pubkey;
  const channel =
    channelsQuery.data?.find((candidate) => candidate.id === state.channelId) ??
    null;
  // The metadata hook is the sidebar's own — same labels, same avatars, same
  // presence reading, so the sheet cannot name a conversation differently from
  // the row that opened it.
  const { dmChannelLabels, dmParticipantsByChannelId, dmPresenceByChannelId } =
    useDmSidebarMetadata({
      currentPubkey,
      directMessages: channel ? [channel] : [],
      fallbackDisplayName: identityQuery.data?.displayName,
      profileDisplayName: profileQuery.data?.displayName,
    });
  const connection = useRelayConnection();

  if (channel === null) return null;

  const label = dmChannelLabels[channel.id] ?? channel.name;
  const participant = dmParticipantsByChannelId[channel.id]?.[0] ?? null;
  const presence = dmPresenceSentence({
    connection,
    presence:
      channel.participantPubkeys.length === 2
        ? dmPresenceByChannelId[channel.id]
        : undefined,
  });

  return (
    <>
      <DmSheetSurface
        channel={channel}
        label={label}
        onClose={controller.close}
        onMinimize={controller.minimize}
        onOpenFullView={(channelId) => {
          // The full view is the route, so the sheet has nothing left to
          // stand for — this is a close, not a minimize.
          controller.close();
          void onOpenFullView(channelId);
        }}
        participantAvatarUrl={participant?.avatarUrl ?? null}
        presence={presence}
        showing={isDmSheetShowing(state)}
      />
      {isDmPillShowing(state) ? (
        <button
          aria-label={`Restore the conversation with ${label}`}
          className="absolute bottom-[58px] right-[14px] z-[55] flex items-center gap-2 rounded-[20px] border border-foreground/15 bg-popover py-1.5 pl-2 pr-3.5 text-xs font-medium text-foreground shadow-2xl"
          data-testid="dm-pill"
          onClick={controller.restore}
          type="button"
        >
          <ProfileAvatarWithStatus
            avatarUrl={participant?.avatarUrl ?? null}
            className="h-6 w-6"
            label={label}
            size={PILL_AVATAR_SIZE}
          />
          <span data-testid="dm-pill-name">{label}</span>
          {unreadCount > 0 ? (
            <span
              className="rounded-lg bg-primary px-1.5 py-px text-2xs font-bold leading-tight text-primary-foreground"
              data-testid="dm-pill-unread"
            >
              {unreadCount}
            </span>
          ) : null}
        </button>
      ) : null}
    </>
  );
}

/** The sheet itself. Kept mounted while minimized — see the file header. */
function DmSheetSurface({
  channel,
  label,
  onClose,
  onMinimize,
  onOpenFullView,
  participantAvatarUrl,
  presence,
  showing,
}: {
  channel: Channel;
  label: string;
  onClose: () => void;
  onMinimize: () => void;
  onOpenFullView: (channelId: string) => void;
  participantAvatarUrl: string | null;
  presence: { connected: boolean; text: string };
  showing: boolean;
}) {
  // The channel screen measures its own header and writes the height as a CSS
  // variable on whatever this points at. On the route that is the app's
  // `<main>`; a sheet that left it there would push the app's chrome around
  // from inside a 360px card.
  const insetRef = React.useRef<HTMLDivElement>(null);

  return (
    <section
      aria-label={`Direct message with ${label}`}
      className={cn(
        "absolute bottom-[58px] right-[14px] z-[55] h-[470px] max-h-[70vh] w-[360px] flex-col overflow-hidden rounded-[14px] border border-foreground/10 bg-popover shadow-2xl",
        showing ? "flex" : "hidden",
      )}
      data-testid="dm-sheet"
    >
      <header className="flex flex-none items-center gap-2.5 border-b border-border/60 px-3.5 py-3">
        <ProfileAvatarWithStatus
          avatarUrl={participantAvatarUrl}
          className="h-[30px] w-[30px]"
          geometry={scaleProfileAvatarStatusGeometry(
            DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
            SHEET_AVATAR_SIZE,
          )}
          label={label}
          size={SHEET_AVATAR_SIZE}
        />
        <div className="min-w-0">
          <p
            className="truncate text-sm font-semibold text-foreground"
            data-testid="dm-sheet-name"
          >
            {label}
          </p>
          {/* /70 rather than muted, for `DockFloat.tsx`'s measured reason: the
              popover ground is a step lighter than the stage and the muted seed
              lands within a hair of 4.5:1 on it. */}
          <p
            className="flex items-center gap-1 text-2xs text-foreground/70"
            data-testid="dm-sheet-presence"
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                presence.connected ? "bg-emerald-500" : "bg-destructive",
              )}
            />
            {presence.text}
          </p>
        </div>
        <div className="ml-auto flex gap-0.5">
          <DmSheetControl
            label="Open full view"
            onClick={() => onOpenFullView(channel.id)}
            testId="dm-open-full"
          >
            <PanelRight className="h-3 w-3" />
          </DmSheetControl>
          <DmSheetControl
            label="Minimize"
            onClick={onMinimize}
            testId="dm-minimize"
          >
            <Minus className="h-3 w-3" />
          </DmSheetControl>
          <DmSheetControl label="Close" onClick={onClose} testId="dm-close">
            <X className="h-3 w-3" />
          </DmSheetControl>
        </div>
      </header>
      <MainInsetProvider mainInsetRef={insetRef}>
        <HostedChannelProvider>
          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden [&_[data-testid=chat-header]]:hidden [&_[data-testid=chat-status-bar]]:hidden"
            data-testid="dm-sheet-body"
            ref={insetRef}
          >
            {/* Every prop but the channel id is a route target a sheet has none
                of: nothing deep-links into it, and a DM is never a forum. */}
            <ChannelRouteScreen
              autoSendDraftKey={null}
              searchHighlight={null}
              channelId={channel.id}
              selectedPostId={null}
              targetMessageId={null}
              targetReplyId={null}
              targetThreadRootId={null}
            />
          </div>
        </HostedChannelProvider>
      </MainInsetProvider>
    </section>
  );
}

/** The mockup's `.dc`: a 24px square that says what it does out loud, because
 * three unlabelled glyphs in a corner is where "minimize" and "close" get
 * confused for each other. */
function DmSheetControl({
  children,
  label,
  onClick,
  testId,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      aria-label={label}
      className="flex h-6 w-6 items-center justify-center rounded-[5px] text-foreground/70 hover:bg-foreground/10 hover:text-foreground"
      data-testid={testId}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
