import type { TimelineMessage } from "@/features/messages/types";

// Fabricated TimelineMessage[] exercising the fields MessageTimeline actually
// reads: id, author, time, body, depth, createdAt are the required shape;
// at least three rows so list rendering (not just an empty-state branch) runs.
const messages: TimelineMessage[] = [
  {
    id: "workbench-msg-1",
    createdAt: 1_722_600_000,
    author: "alice",
    time: "10:00 AM",
    body: "First message rendered by the workbench spike.",
    depth: 0,
  },
  {
    id: "workbench-msg-2",
    createdAt: 1_722_600_060,
    author: "bob",
    time: "10:01 AM",
    body: "Second message — a reply.",
    parentId: "workbench-msg-1",
    rootId: "workbench-msg-1",
    depth: 1,
  },
  {
    id: "workbench-msg-3",
    createdAt: 1_722_600_120,
    author: "alice",
    time: "10:02 AM",
    body: "Third message, back at the root.",
    depth: 0,
  },
];

export const timelineFixture = {
  messages,
};

// Builds a TimelineMessage from composer `onSend` content so typing has a
// visible effect in the harness — same required shape as the fixture rows
// above, timestamped at call time rather than fabricated.
export function createSentMessage(
  body: string,
  index: number,
): TimelineMessage {
  const now = new Date();
  return {
    id: `workbench-sent-${index}`,
    createdAt: now.getTime(),
    author: "you",
    time: now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    body,
    depth: 0,
  };
}
