import * as React from "react";
import { LoaderCircle } from "lucide-react";

import { useCommunities } from "@/features/communities/useCommunities";
import {
  harborStart,
  harborStatus,
  type HarborStatus,
  isHarborRelayUrl,
  readHarborAutoStart,
  writeHarborAutoStart,
} from "@/shared/api/tauriHarbor";
import { useSystemColorScheme } from "@/shared/theme/useSystemColorScheme";
import { Button } from "@/shared/ui/button";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import { Switch } from "@/shared/ui/switch";

type CommunityApplyErrorScreenProps = {
  error: string;
  onChangeCommunity: () => void;
  onRetry: () => void;
};

export function CommunityApplyErrorScreen({
  error,
  onChangeCommunity,
  onRetry,
}: CommunityApplyErrorScreenProps) {
  const systemColorScheme = useSystemColorScheme();
  const { activeCommunity } = useCommunities();
  const isHarbor = isHarborRelayUrl(activeCommunity?.relayUrl);

  return (
    <div
      className="buzz-onboarding-neutral-theme buzz-startup-shell flex items-center justify-center bg-background px-4 py-8 text-foreground"
      data-system-color-scheme={systemColorScheme}
      data-testid="community-apply-error"
    >
      <StartupWindowDragRegion />
      <div className="relative flex w-full max-w-[500px] flex-col items-center text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          Community connection failed
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{error}</p>
        {isHarbor ? <HarborStartOffer onStarted={onRetry} /> : null}
        <div className="mt-8 flex w-full max-w-[300px] flex-col gap-3">
          <Button
            className="h-10 w-full"
            data-testid="community-apply-error-retry"
            onClick={onRetry}
            type="button"
          >
            Retry
          </Button>
          <Button
            className="h-10 w-full"
            onClick={onChangeCommunity}
            type="button"
            variant="secondary"
          >
            Change community
          </Button>
        </div>
      </div>
    </div>
  );
}

const OFFERABLE = new Set<HarborStatus["state"]>([
  "stopped",
  "unhealthy",
  "unknown",
]);

/**
 * The app opened onto a configured-but-stopped home harbor. Offer to start it
 * in one click — and never start Docker on the owner's behalf until he has said
 * so once and it is remembered (vingilot/docs/plans/2026-08-13-home-harbor.md,
 * Task 3, last bullet). If he has turned on "start automatically", this fires
 * the start itself on mount; otherwise it waits for the button.
 */
function HarborStartOffer({ onStarted }: { onStarted: () => void }) {
  const [status, setStatus] = React.useState<HarborStatus | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [autoStart, setAutoStart] = React.useState(false);
  const autoAttempted = React.useRef(false);

  const start = React.useCallback(async () => {
    setStarting(true);
    setFailure(null);
    try {
      await harborStart();
      onStarted();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  }, [onStarted]);

  React.useEffect(() => {
    let active = true;
    setAutoStart(readHarborAutoStart());
    void harborStatus()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => {
        // No harbor to speak of — leave the ordinary Retry path in place.
      });
    return () => {
      active = false;
    };
  }, []);

  // Remembered consent: start once, on the first status that says we can.
  React.useEffect(() => {
    if (
      status &&
      OFFERABLE.has(status.state) &&
      readHarborAutoStart() &&
      !autoAttempted.current
    ) {
      autoAttempted.current = true;
      void start();
    }
  }, [status, start]);

  if (!status || !OFFERABLE.has(status.state)) return null;

  return (
    <div
      className="mt-6 w-full rounded-2xl border border-border/70 bg-background/40 p-5 text-left"
      data-testid="harbor-start-offer"
    >
      <h2 className="text-sm font-medium">Your home harbor isn’t running</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        Vingilot won’t start Docker on its own. Start the harbor to reconnect.
      </p>
      {failure ? (
        <p
          className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="harbor-start-offer-failure"
        >
          {failure}
        </p>
      ) : null}
      <Button
        className="mt-4 h-10 w-full"
        data-testid="harbor-start-offer-start"
        disabled={starting}
        onClick={() => void start()}
        type="button"
      >
        {starting ? (
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : null}
        {starting ? "Starting your home harbor…" : "Start home harbor"}
      </Button>
      <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <label htmlFor="harbor-auto-start-switch">
          Start automatically when Vingilot opens
        </label>
        <Switch
          checked={autoStart}
          data-testid="harbor-auto-start-toggle"
          id="harbor-auto-start-switch"
          onCheckedChange={(next) => {
            setAutoStart(next);
            writeHarborAutoStart(next);
          }}
        />
      </div>
    </div>
  );
}
