import * as React from "react";
import { MessageComposer } from "@/features/messages/ui/MessageComposer";
import { MessageTimeline } from "@/features/messages/ui/MessageTimeline";
import { createSentMessage, timelineFixture } from "./fixtures/timeline";

// One responsibility: render upstream slices against fabricated props and
// nothing else. No providers are added here on purpose — if a component
// needs one, we want that to surface as a runtime error we can report, not as
// something we quietly supplied.
export function SpikeHarness() {
  const [messages, setMessages] = React.useState(timelineFixture.messages);

  // Appends to local state so typing in the composer has a visible effect,
  // without wiring any real send pipeline (no relay in this spike).
  const handleSend = React.useCallback(async (content: string) => {
    setMessages((current) => [
      ...current,
      createSentMessage(content, current.length),
    ]);
  }, []);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <MessageTimeline {...timelineFixture} messages={messages} />
      <MessageComposer channelName="workbench" onSend={handleSend} />
    </div>
  );
}
