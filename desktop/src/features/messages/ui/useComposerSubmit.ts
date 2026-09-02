import * as React from "react";

import type { UseChannelLinksResult } from "@/features/messages/lib/useChannelLinks";
import type { UseEmojiAutocompleteResult } from "@/features/messages/lib/useEmojiAutocomplete";
import type { UseMentionsResult } from "@/features/messages/lib/useMentions";
import type { MediaUploadController } from "@/features/messages/lib/useMediaUpload";
import type { UseDraftsResult } from "@/features/messages/lib/useDrafts";
import type { UseRichTextEditorResult } from "@/features/messages/lib/useRichTextEditor";
import type { CustomEmoji } from "@/shared/lib/remarkCustomEmoji";
import type { Dictation } from "@/features/dictation/lib/useDictation";
import { resolveSentDraftKey } from "@/features/messages/ui/draftSubmitKey";
import { submitMessageEdit } from "./submitMessageEdit";
import type { MessageComposerEditTarget } from "./MessageComposer.types";
import type { SendMessageWithMentionFlowInput } from "./useMentionSendFlow.helpers";

/** Everything the submit path (edit-save and normal-send branches, plus the
 * form's `onSubmit`) needs, pulled out of `MessageComposer.tsx` so that
 * already-oversized file doesn't grow with every submit-path tweak — the
 * same ratchet pressure `useComposerDictation.ts`'s header describes. Options
 * object, not positional: this is a superset of what `useMentionSendFlow`
 * already takes, and that hook sets the object-options precedent for a
 * submit-adjacent call this wide. */
export interface UseComposerSubmitOptions {
  /** Truthy iff this composer is scoped to a persistent-agent audience — the
   * normal-send branch only reads it for that. */
  audienceScope: unknown;
  channelId: string | null;
  channelLinks: Pick<UseChannelLinksResult, "clearChannels">;
  customEmoji: CustomEmoji[];
  dictation: Pick<Dictation, "stop">;
  disabledRef: React.RefObject<boolean>;
  drafts: Pick<UseDraftsResult, "loadDraft">;
  editTargetRef: React.RefObject<MessageComposerEditTarget | null>;
  effectiveDraftKey: string | null;
  effectiveDraftKeyRef: React.RefObject<string | null>;
  emojiAutocomplete: Pick<UseEmojiAutocompleteResult, "clearEmojis">;
  extractMentionPubkeysRef: React.RefObject<(content: string) => string[]>;
  getReadyLinkPreviewTags: () => string[][];
  hasPendingLinkPreviewSnapshotsRef: React.RefObject<boolean>;
  isEditSubmissionLocked: boolean;
  isSendingRef: React.RefObject<boolean>;
  isUploadingRef: React.RefObject<boolean>;
  media: Pick<
    MediaUploadController,
    | "pendingImetaRef"
    | "queuedAttachmentsRef"
    | "setPendingImeta"
    | "clearQueuedAttachments"
    | "restoreQueuedAttachments"
    | "setUploadState"
  >;
  mentions: Pick<
    UseMentionsResult,
    // `revalidateMentionPubkeys` joined this list with the upstream sync, which
    // made it required on `submitMessageEdit`. The Pick is deliberately narrow,
    // so a new dependency has to be declared here rather than arriving by
    // widening the whole result type.
    | "clearMentions"
    | "getDraftMentionRefs"
    | "restoreDraftMentionRefs"
    | "revalidateMentionPubkeys"
  >;
  mentionSendFlow: {
    isPreparingMentionSend: boolean;
    sendMessageWithMentionFlow: (
      input: SendMessageWithMentionFlowInput,
    ) => Promise<void>;
  };
  onCaptureSendContext?: () => {
    parentEventId: string | null;
    threadHeadId: string | null;
  } | null;
  onEditSaveRef: React.RefObject<
    | ((
        content: string,
        mediaTags?: string[][],
        mentionPubkeys?: string[],
        eventId?: string,
      ) => Promise<void>)
    | undefined
  >;
  onPreparingMentionSendChange?: (isPreparing: boolean) => void;
  ownerPubkeyRef: React.RefObject<string | null>;
  persistentAudience: { generation: number; revision: number | null };
  persistentMentionHydration: {
    beginSubmit: () => void;
    endSubmit: () => void;
  };
  canRestoreEditDraftRef: React.RefObject<boolean>;
  richText: Pick<UseRichTextEditorResult, "clearContent" | "setContent">;
  setComposerContent: (content: string) => void;
  setDeferredEditPending: (isPending: boolean) => void;
  setIsEmojiPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSpoileredAttachmentUrls: React.Dispatch<React.SetStateAction<Set<string>>>;
  spoileredAttachmentUrls: Set<string>;
  syncComposerContentFromEditor: () => string;
}

/** The submit path: edit-save when `editTarget` is set, otherwise the normal
 * mention-send flow — plus the form's `onSubmit` wrapper. Pulled out of
 * `MessageComposer.tsx` verbatim; see this file's header. */
export function useComposerSubmit({
  audienceScope,
  channelId,
  channelLinks,
  customEmoji,
  dictation,
  disabledRef,
  drafts,
  editTargetRef,
  effectiveDraftKey,
  effectiveDraftKeyRef,
  emojiAutocomplete,
  extractMentionPubkeysRef,
  getReadyLinkPreviewTags,
  hasPendingLinkPreviewSnapshotsRef,
  isEditSubmissionLocked,
  isSendingRef,
  isUploadingRef,
  media,
  mentions,
  mentionSendFlow,
  onCaptureSendContext,
  onEditSaveRef,
  onPreparingMentionSendChange,
  ownerPubkeyRef,
  persistentAudience,
  persistentMentionHydration,
  canRestoreEditDraftRef,
  richText,
  setComposerContent,
  setDeferredEditPending,
  setIsEmojiPickerOpen,
  setSpoileredAttachmentUrls,
  spoileredAttachmentUrls,
  syncComposerContentFromEditor,
}: UseComposerSubmitOptions) {
  // Sync lock: taken before any async send so rapid Enter can't double-submit.
  const isSubmitLockedRef = React.useRef(false);

  // Every "missing dependency" this rule would otherwise report below is a
  // ref's `.current` (created by `useRef` in MessageComposer.tsx, threaded
  // through as a `UseComposerSubmitOptions` field) or a `useState` dispatcher
  // (same origin) — both stable by construction, and reading `.current`
  // fresh on every call (rather than freezing it at the moment this callback
  // was created) is the entire point of passing a ref instead of a value.
  // Biome recognizes that exemption for a `useRef`/`useState` call it can see
  // in the same scope; it cannot see across this function's parameter
  // boundary, so every one of those otherwise-correctly-excluded reads would
  // be flagged here that was not flagged inline in MessageComposer.tsx
  // before this file existed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs/setState dispatchers threaded through as parameters — see comment above.
  const submitMessage = React.useCallback(async () => {
    // Synchronous, not reactive to an `isSending` prop: that prop can flip
    // true and false within one React batch on a fast (or mocked) send,
    // never actually observed by an effect. Calling stop() here, before any
    // await, is the only point guaranteed to run exactly once per send.
    dictation.stop();
    const trimmed = syncComposerContentFromEditor().trim();
    // Edit mode
    if (editTargetRef.current && onEditSaveRef.current) {
      if (isEditSubmissionLocked) return;
      // No empty-edit guard here: clearing an edit to empty (no text, no
      // attachments) flows through to onEditSave as empty content, which
      // deletes the message instead of publishing it (see handleEditSave).
      await submitMessageEdit({
        content: trimmed,
        editTargetId: editTargetRef.current.id,
        customEmoji,
        originalContent: editTargetRef.current.body,
        ownerPubkey: ownerPubkeyRef.current,
        editTarget: editTargetRef.current,
        getMentionRefs: mentions.getDraftMentionRefs,
        // Required by `submitMessageEdit` since the upstream sync: an edit
        // re-checks that the pubkeys it is about to keep are still the agents
        // they were. `useMentions` already exposes it.
        revalidateMentionPubkeys: mentions.revalidateMentionPubkeys,
        pendingImeta: media.pendingImetaRef.current,
        queuedAttachments: media.queuedAttachmentsRef.current,
        spoileredAttachmentUrls,
        extractMentionPubkeys: extractMentionPubkeysRef.current,
        save: onEditSaveRef.current,
        clearComposer: () => {
          setComposerContent("");
          richText.clearContent();
          media.setPendingImeta([]);
          media.clearQueuedAttachments();
          setSpoileredAttachmentUrls(new Set());
          mentions.clearMentions();
          channelLinks.clearChannels();
          emojiAutocomplete.clearEmojis();
          setIsEmojiPickerOpen(false);
        },
        restoreComposer: (draft) => {
          setComposerContent(draft.content);
          richText.setContent(draft.content);
          media.setPendingImeta(draft.pendingImeta);
          media.restoreQueuedAttachments(draft.queuedAttachments);
          setSpoileredAttachmentUrls(draft.spoileredAttachmentUrls);
        },
        restoreMentionRefs: mentions.restoreDraftMentionRefs,
        shouldRestoreComposer: () => canRestoreEditDraftRef.current,
        setDeferredUploadPending: setDeferredEditPending,
        setUploadError: (message) =>
          media.setUploadState({ status: "error", message }),
      });
      return;
    }
    // Normal send
    const currentPendingImeta = media.pendingImetaRef.current;
    const currentQueuedAttachments = media.queuedAttachmentsRef.current;
    const hasMedia =
      currentPendingImeta.length > 0 || currentQueuedAttachments.length > 0;
    if (
      (!trimmed && !hasMedia) ||
      disabledRef.current ||
      isSendingRef.current ||
      isSubmitLockedRef.current ||
      isUploadingRef.current ||
      hasPendingLinkPreviewSnapshotsRef.current ||
      mentionSendFlow.isPreparingMentionSend
    ) {
      return;
    }
    const capturedThreadContext = onCaptureSendContext?.() ?? null;
    if (
      capturedThreadContext !== null &&
      !capturedThreadContext.parentEventId
    ) {
      return;
    }
    isSubmitLockedRef.current = true;
    onPreparingMentionSendChange?.(true);
    persistentMentionHydration.beginSubmit();
    try {
      await mentionSendFlow.sendMessageWithMentionFlow({
        capturedChannelId: channelId,
        capturedThreadContext,
        pendingImeta: currentPendingImeta,
        queuedAttachments: currentQueuedAttachments,
        linkPreviewTags: getReadyLinkPreviewTags(),
        sentDraftKey: resolveSentDraftKey(
          effectiveDraftKeyRef.current,
          drafts.loadDraft,
        ),
        recoveryDraftKey: effectiveDraftKey,
        spoileredAttachmentUrls,
        trimmed,
        // `audienceGeneration`/`audienceRevision` are gone from this input.
        // The persistent audience itself is not — upstream still has it, and
        // still uses it in the composer; the sync moved where it is applied,
        // so passing it here is no longer the way to carry it.
      });
    } finally {
      isSubmitLockedRef.current = false;
      persistentMentionHydration.endSubmit();
      onPreparingMentionSendChange?.(false);
    }
  }, [
    channelId,
    channelLinks.clearChannels,
    customEmoji,
    dictation.stop,
    drafts.loadDraft,
    emojiAutocomplete.clearEmojis,
    getReadyLinkPreviewTags,
    hasPendingLinkPreviewSnapshotsRef,
    media.clearQueuedAttachments,
    media.pendingImetaRef,
    media.queuedAttachmentsRef,
    media.restoreQueuedAttachments,
    media.setPendingImeta,
    media.setUploadState,
    mentionSendFlow.isPreparingMentionSend,
    mentionSendFlow.sendMessageWithMentionFlow,
    mentions.clearMentions,
    richText.clearContent,
    richText.setContent,
    setComposerContent,
    spoileredAttachmentUrls,
    syncComposerContentFromEditor,
    onCaptureSendContext,
    onPreparingMentionSendChange,
    audienceScope,
    persistentMentionHydration,
    persistentAudience.generation,
    persistentAudience.revision,
    isEditSubmissionLocked,
    effectiveDraftKey,
    mentions.getDraftMentionRefs,
    mentions.restoreDraftMentionRefs,
  ]);

  const handleSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void submitMessage();
    },
    [submitMessage],
  );

  return { submitMessage, handleSubmit };
}
