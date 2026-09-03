// **The Vingilot top bar** (redesign P1; mockup `.top`,
// vingilot/design/mockup/Vingilot.html:66-75). 44px, transparent over the
// window's gradient ground, with: traffic-light clearance + sidebar toggle +
// back/forward on the left (testids unchanged), a centered "Search everything
// ⌘K" pill that opens the palette, and History / Copy-link on the right
// (the Appearance button and its tray were vetoed live — P1.1; Settings →
// Appearance owns those controls, and the palette carries the door). The
// whole strip stays a `data-tauri-drag-region`. Fork-shaped pieces (palette
// request, deep-link copy) live in their own modules so this upstream file
// stays mostly wiring.

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Link2,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react";

import { copyChannelDeepLink } from "@/app/copyShellLink";
import { useShellChords } from "@/app/useShellChords";
import { requestFeedbackOpen } from "@/features/runs/lib/feedbackRequest";
import { requestPaletteOpen } from "@/features/runs/lib/paletteRequest";
import { isMacPlatform } from "@/shared/lib/platform";
import { useIsFullscreen } from "@/shared/lib/useIsFullscreen";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import { topChromeBackdrop } from "@/shared/layout/chromeLayout";
import { useOptionalSidebar } from "@/shared/ui/sidebar";

type AppTopChromeProps = {
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  hasCommunityRail?: boolean;
  /** The active channel, when a channel view is up — the Copy-link target. */
  activeChannelId?: string | null;
  /** True on /workspace, where pane-solo owns ⌥⌘B (see `useShellChords`). */
  isWorkspaceView?: boolean;
};

// Fixed px on purpose (button box + glyph): these controls sit beside the
// native macOS traffic lights, which ignore the app's Cmd +/- text zoom, so
// the row must not grow or shrink with the rem scale. Deliberate exception
// to the rem-first rule.
const TOP_CHROME_ICON_BUTTON_CLASS =
  "h-[28px] w-[28px] rounded-[6px] text-foreground/60 hover:bg-foreground/10 hover:text-foreground/90 [&_svg]:size-[16px]";
const HISTORY_ICON_BUTTON_CLASS =
  "h-[28px] w-[24px] rounded-[6px] text-foreground/60 hover:bg-foreground/10 hover:text-foreground/90 [&_svg]:size-[16px]";

function preventTopChromeWheel(event: WheelEvent) {
  event.preventDefault();
}

function TopChromeSidebarTrigger() {
  const sidebar = useOptionalSidebar();

  return (
    <Button
      aria-label="Toggle Sidebar"
      className={TOP_CHROME_ICON_BUTTON_CLASS}
      data-sidebar="trigger"
      disabled={!sidebar}
      onClick={() => {
        sidebar?.toggleSidebar();
      }}
      size="icon"
      type="button"
      variant="ghost"
    >
      {sidebar?.open ? <PanelLeftClose /> : <PanelLeftOpen />}
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
}

export function AppTopChrome({
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  hasCommunityRail = false,
  activeChannelId = null,
  isWorkspaceView = false,
}: AppTopChromeProps) {
  const topChromeRef = React.useRef<HTMLDivElement>(null);
  const isFullscreen = useIsFullscreen();
  useShellChords({ zenOwnedByWorkspace: isWorkspaceView });
  // On macOS the traffic-light buttons overlay the chrome (see
  // `trafficLightPosition` in `tauri.conf.json`), so the nav row clears their
  // x-position. When the community rail is present it already occupies the far
  // left, so the nav row only needs to clear the lights past the rail edge
  // rather than the full offset. In fullscreen those buttons hide.
  //
  // Fixed px on purpose: the native traffic lights do not scale with the app's
  // Cmd +/- text zoom (rem), so rem-based clearance shrinks under them when
  // zoomed out. This is a deliberate exception to the rem-first rule.
  const macChrome = isMacPlatform() && !isFullscreen;
  const navRowPaddingClass = macChrome
    ? hasCommunityRail
      ? "pl-[32px]"
      : "pl-[80px]"
    : "pl-3";
  // The 44px bar centers its 28px controls at y=22; the native lights sit a
  // hair lower (Tauri's y:25 titlebar inset), so a 1px optical nudge keeps
  // the row and the lights reading as one line (was 3px on the 40px bar).
  const navRowAlignmentClass = macChrome ? "translate-y-[1px]" : null;

  React.useEffect(() => {
    const topChrome = topChromeRef.current;
    if (!topChrome) {
      return;
    }

    const options = { capture: true, passive: false };
    topChrome.addEventListener("wheel", preventTopChromeWheel, options);
    return () => {
      topChrome.removeEventListener("wheel", preventTopChromeWheel, options);
    };
  }, []);

  const openPalette = React.useCallback(() => {
    requestPaletteOpen("go");
  }, []);

  return (
    <div
      ref={topChromeRef}
      className={cn(
        "relative z-45 flex shrink-0 cursor-default select-none items-center bg-transparent pr-3 text-foreground",
        topChromeBackdrop.height,
        navRowPaddingClass,
      )}
      data-tauri-drag-region
      data-testid="app-top-chrome"
    >
      <div className={cn("flex items-center gap-0.5", navRowAlignmentClass)}>
        <TopChromeSidebarTrigger />
        <Button
          aria-label="Go back"
          className={HISTORY_ICON_BUTTON_CLASS}
          data-testid="global-back"
          disabled={!canGoBack}
          onClick={onGoBack}
          size="icon"
          variant="ghost"
        >
          <ChevronLeft />
        </Button>
        <Button
          aria-label="Go forward"
          className={HISTORY_ICON_BUTTON_CLASS}
          data-testid="global-forward"
          disabled={!canGoForward}
          onClick={onGoForward}
          size="icon"
          variant="ghost"
        >
          <ChevronRight />
        </Button>
      </div>
      {/* Centered over the bar, not flexed into it, so it stays centered on
       * the window whatever the two sides weigh (mockup `.topsearch`). */}
      <button
        className="absolute left-1/2 top-1/2 flex w-[28rem] max-w-[40vw] -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-lg bg-black/20 px-3 py-1.5 text-xs text-foreground/75 hover:bg-black/25"
        data-testid="top-search-pill"
        onClick={openPalette}
        type="button"
      >
        <Search aria-hidden="true" className="size-[13px] shrink-0" />
        <span className="truncate">Search everything</span>
        {/* /60, not the mockup's .35: alpha compounds on the gradient and
         * measured 2.6:1 — the P0 muted-ink lesson again. /60 matches the
         * Appearance label's measured 5.3:1 on the same ground. */}
        <kbd className="ml-auto font-sans text-2xs tracking-[0.02em] text-foreground/60">
          ⌘K
        </kbd>
      </button>
      <div
        className={cn("ml-auto flex items-center gap-1", navRowAlignmentClass)}
      >
        <Button
          aria-label="History"
          className={TOP_CHROME_ICON_BUTTON_CLASS}
          data-testid="top-chrome-history"
          onClick={openPalette}
          size="icon"
          title="History — recent places"
          variant="ghost"
        >
          <Clock />
        </Button>
        <Button
          aria-label="Copy link"
          className={TOP_CHROME_ICON_BUTTON_CLASS}
          data-testid="top-chrome-copy-link"
          disabled={activeChannelId === null}
          onClick={() => {
            if (activeChannelId !== null) {
              void copyChannelDeepLink(activeChannelId);
            }
          }}
          size="icon"
          title={
            activeChannelId === null
              ? "Open a channel to copy its link"
              : "Copy link to this channel"
          }
          variant="ghost"
        >
          <Link2 />
        </Button>
        <Button
          aria-label="Send feedback"
          className={TOP_CHROME_ICON_BUTTON_CLASS}
          data-testid="top-chrome-feedback"
          onClick={() => requestFeedbackOpen()}
          size="icon"
          title="Send feedback with a screenshot of this window"
          variant="ghost"
        >
          <MessageSquarePlus />
        </Button>
        {/* No Appearance button (P1.1, owner veto 2): the tray is gone and the
         * wash/accent controls live in Settings → Appearance, reachable
         * through the ⌘K palette's "Appearance" row. */}
      </div>
    </div>
  );
}
