import { MessageTimeline } from "@/features/messages/ui/MessageTimeline";
import { timelineFixture } from "./fixtures/timeline";

// One responsibility: render an upstream slice against fabricated props and
// nothing else. No providers are added here on purpose — if the component
// needs one, we want that to surface as a runtime error we can report, not as
// something we quietly supplied.
export function SpikeHarness() {
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <MessageTimeline {...timelineFixture} />
    </div>
  );
}
