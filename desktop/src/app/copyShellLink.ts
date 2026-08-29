// **The top bar's Copy-link button, made of parts that already exist**
// (vingilot redesign P1; mockup: "Copied link to this worktree").
//
// The only deep-link vocabulary this app answers today is
// `buzz://message?channel=…&id=…` — the Rust handler requires both halves
// (`deep_link.rs`, `parse_message_deep_link`), so there is no id-less
// "channel link" to copy. Rather than invent a scheme nothing opens, the
// button links the channel through its most recent message: one bounded relay
// query for the newest human-visible event (the same kind set the unread
// machinery counts), then `buildMessageLink` — the exact link the message
// action bar's own Copy link produces, which every consumer (Rust handler,
// markdown interception, `messages thread` in the CLI) already resolves.
//
// A channel with no messages yet has nothing to link, and the toast says so
// instead of copying a lie. Worktree links wait for a scheme that exists
// (P3's dock / P6); until then the button is enabled only where a channel is.

import { buildMessageLink } from "@/features/messages/lib/messageLink";
import { relayClient } from "@/shared/api/relayClient";
import { CHANNEL_MESSAGE_EVENT_KINDS } from "@/shared/constants/kinds";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { toast } from "sonner";

/** Copy a `buzz://message` deep link to the channel's latest message. */
export async function copyChannelDeepLink(channelId: string): Promise<void> {
  let latestId: string | null = null;
  try {
    const events = await relayClient.fetchEvents({
      kinds: [...CHANNEL_MESSAGE_EVENT_KINDS],
      "#h": [channelId],
      limit: 1,
    });
    latestId = events[0]?.id ?? null;
  } catch {
    toast.error("Could not reach the relay to build the link");
    return;
  }
  if (latestId === null) {
    toast.error("Nothing in this channel to link yet");
    return;
  }
  copyTextToClipboard(
    buildMessageLink({ channelId, messageId: latestId }),
    "Copied link to this channel",
  );
}
