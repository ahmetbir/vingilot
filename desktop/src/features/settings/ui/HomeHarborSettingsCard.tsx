import * as React from "react";
import { AlertCircle, Check, Copy, LoaderCircle } from "lucide-react";

import {
  harborStart,
  harborStatus,
  harborStop,
  type HarborState,
  type HarborStatus,
} from "@/shared/api/tauriHarbor";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

type StatePresentation = {
  label: string;
  detail: string;
  dot: string;
};

/** One sentence per state — never "stopped" for a state a Start button can't fix. */
function present(status: HarborStatus): StatePresentation {
  switch (status.state) {
    case "running":
      return {
        label: "Running",
        detail: `The relay is answering on ${status.relayUrl}.`,
        dot: "bg-emerald-500",
      };
    case "starting":
      return {
        label: "Starting…",
        detail: "The containers are up; waiting for every healthcheck to pass.",
        dot: "bg-amber-500",
      };
    case "stopped":
      return {
        label: "Stopped",
        detail: `Installed and not running. Start it to reach ${status.relayUrl}.`,
        dot: "bg-muted-foreground/50",
      };
    case "unhealthy":
      return {
        label: "Unhealthy",
        detail:
          "A container is up but reporting itself unhealthy. Stop and start it, or check its logs.",
        dot: "bg-destructive",
      };
    case "not-installed":
      return {
        label: "Not installed",
        detail:
          "There is no harbor on this machine yet. Use “Run Vingilot on this Mac” on the welcome screen to install one.",
        dot: "bg-muted-foreground/40",
      };
    default:
      return {
        label: "Unknown",
        detail:
          status.message ??
          "Docker could not be asked about the harbor right now.",
        dot: "bg-amber-500",
      };
  }
}

const CAN_START: readonly HarborState[] = ["stopped", "unhealthy"];
const CAN_STOP: readonly HarborState[] = ["running", "starting", "unhealthy"];

/**
 * Settings → Home harbor. The lifecycle surface for the local relay
 * (vingilot/docs/plans/2026-08-13-home-harbor.md, Task 3). Start and Stop are
 * thin wrappers over `docker compose`; Uninstall is not a button — it prints the
 * two commands that would remove the owner's messages for him to run himself.
 */
export function HomeHarborSettingsCard() {
  const [status, setStatus] = React.useState<HarborStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [action, setAction] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<"down" | "volumes" | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      setStatus(await harborStatus());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    void harborStatus()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // A harbor that is still starting settles on its own — poll gently so the
  // card follows it to running/unhealthy without a manual Refresh.
  React.useEffect(() => {
    if (status?.state !== "starting" || action !== null) return;
    const handle = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(handle);
  }, [status?.state, action, refresh]);

  const run = async (label: string, operation: () => Promise<void>) => {
    setAction(label);
    setError(null);
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAction(null);
    }
  };

  const copy = (which: "down" | "volumes", value: string) => {
    void writeTextToClipboard(value).then(() => {
      setCopied(which);
      window.setTimeout(
        () => setCopied((current) => (current === which ? null : current)),
        1500,
      );
    });
  };

  const busy = action != null;

  return (
    <section className="min-w-0" data-testid="settings-home-harbor">
      <SettingsSectionHeader
        title="Home harbor"
        description="Run a whole Vingilot community on this Mac — the relay and its database as Docker containers, bound to loopback only. Repository and media features are off in the harbor; everything else stays on this machine."
      />

      {error ? (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}

      {loading || !status ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          Checking the harbor…
        </div>
      ) : (
        <>
          <SettingsOptionGroup>
            <SettingsOptionRow>
              <div className="min-w-0">
                <p
                  className="flex items-center gap-2 text-sm font-medium"
                  data-testid="harbor-status-label"
                  data-state={status.state}
                >
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      present(status).dot,
                    )}
                    aria-hidden="true"
                  />
                  {present(status).label}
                </p>
                <p className="mt-0.5 text-sm font-normal text-muted-foreground">
                  {present(status).detail}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {CAN_START.includes(status.state) ? (
                  <Button
                    data-testid="harbor-start"
                    disabled={busy}
                    onClick={() => void run("Starting…", () => harborStart())}
                    size="sm"
                    type="button"
                  >
                    {action === "Starting…" ? (
                      <LoaderCircle
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : null}
                    Start
                  </Button>
                ) : null}
                {CAN_STOP.includes(status.state) ? (
                  <Button
                    data-testid="harbor-stop"
                    disabled={busy}
                    onClick={() => void run("Stopping…", () => harborStop())}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {action === "Stopping…" ? (
                      <LoaderCircle
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : null}
                    Stop
                  </Button>
                ) : null}
                <Button
                  data-testid="harbor-refresh"
                  disabled={busy}
                  onClick={() => void run("Refreshing…", async () => {})}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Refresh
                </Button>
              </div>
            </SettingsOptionRow>
          </SettingsOptionGroup>

          {status.state !== "not-installed" ? (
            <div className="mt-6" data-testid="harbor-uninstall">
              <h3 className="text-sm font-medium">Remove the harbor</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Vingilot never deletes these on your behalf — the volumes are
                your messages. Run these yourself when you mean to. The second
                command is irreversible.
              </p>
              <div className="mt-3 space-y-2">
                <UninstallCommand
                  copied={copied === "down"}
                  label="Stop and remove the containers (volumes survive)"
                  onCopy={() => copy("down", status.uninstall.down)}
                  testId="harbor-uninstall-down"
                  value={status.uninstall.down}
                />
                <UninstallCommand
                  copied={copied === "volumes"}
                  label="Remove the volumes (messages, database, git store)"
                  onCopy={() => copy("volumes", status.uninstall.volumes)}
                  testId="harbor-uninstall-volumes"
                  value={status.uninstall.volumes}
                />
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function UninstallCommand({
  copied,
  label,
  onCopy,
  testId,
  value,
}: {
  copied: boolean;
  label: string;
  onCopy: () => void;
  testId: string;
  value: string;
}) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
        <code
          className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground/85"
          data-testid={testId}
        >
          {value}
        </code>
        <Button
          aria-label="Copy command"
          className="h-8 shrink-0 rounded-full px-2.5"
          onClick={onCopy}
          size="sm"
          type="button"
          variant="ghost"
        >
          {copied ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  );
}
