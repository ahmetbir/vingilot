import type * as React from "react";
import * as BuzzTheme from "@/app/BuzzThemeSurfaces";
import { HuddleRoomHeader, HuddleStartingView } from "@/features/huddle";
import { MainInsetProvider } from "@/shared/layout/MainInsetContext";
import { chromeCssVarDefaults } from "@/shared/layout/chromeLayout";
import { cn } from "@/shared/lib/cn";
import { SidebarInset } from "@/shared/ui/sidebar";

type AppShellChannelSurfaceProps = {
  children: React.ReactNode;
  isHuddleRoom: boolean;
  isHuddleRoomStarting: boolean;
  mainInsetRef: React.RefObject<HTMLElement | null>;
  terminal?: React.ReactNode;
  /** The route draws its own cards on the gradient (the workspace's stage +
   * dock, mockup `.card`), so the single stage card stands down and only
   * its gutters remain. */
  ownCards?: boolean;
};

export function AppShellChannelSurface({
  children,
  isHuddleRoom,
  isHuddleRoomStarting,
  mainInsetRef,
  ownCards = false,
  terminal,
}: AppShellChannelSurfaceProps) {
  return (
    <MainInsetProvider mainInsetRef={mainInsetRef}>
      <SidebarInset
        ref={mainInsetRef}
        className={cn(
          "isolate z-0 min-h-0 min-w-0 overflow-hidden",
          // Vingilot redesign P1: transparent, so the window's gradient
          // ground shows through the stage card's gutters (the card itself
          // is `BuzzTheme.ContentSurface`). Huddle rooms keep their solid.
          isHuddleRoom ? "bg-background" : "bg-transparent",
        )}
        data-buzz-content-surface={isHuddleRoom ? true : undefined}
        data-buzz-content-unframed={isHuddleRoom ? true : undefined}
        data-buzz-glass-inset
        data-buzz-shadow-viewport
        style={chromeCssVarDefaults as React.CSSProperties}
      >
        {isHuddleRoom && !isHuddleRoomStarting ? <HuddleRoomHeader /> : null}
        <BuzzTheme.ContentSurface
          ownCards={ownCards}
          terminal={terminal}
          unframed={isHuddleRoom}
        >
          {isHuddleRoomStarting ? <HuddleStartingView /> : children}
        </BuzzTheme.ContentSurface>
      </SidebarInset>
    </MainInsetProvider>
  );
}
