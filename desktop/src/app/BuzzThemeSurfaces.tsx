import type { ReactNode } from "react";

export function GradientLayer() {
  return (
    <div
      aria-hidden="true"
      className="buzz-theme-gradient-layer pointer-events-none absolute inset-0 -z-10"
      data-buzz-gradient-layer
    >
      <div className="buzz-theme-gradient-underlay absolute inset-0" />
      <div
        className="buzz-theme-gradient-layer-light absolute inset-0 opacity-0"
        data-buzz-gradient="light"
      />
      <div
        className="buzz-theme-gradient-layer-dark absolute inset-0 opacity-0"
        data-buzz-gradient="dark"
      />
    </div>
  );
}

export function ContentSurface({
  children,
  unframed = false,
  terminal,
}: {
  children: ReactNode;
  terminal?: ReactNode;
  /** Used by dedicated huddle windows, which should not resemble app cards. */
  unframed?: boolean;
}) {
  return (
    <div
      className={
        unframed
          ? "relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
          : // Vingilot redesign P1: the stage card floats on the gradient
            // ground with the mockup's ~10px gutters on every open side (the
            // 44px top bar is the top gutter; the transparent sidebar's own
            // padding meets the left one). rounded-xl == the mockup's 12px.
            "relative z-10 mb-2.5 ml-2.5 mr-2.5 mt-0 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-background shadow-content-edge"
      }
      data-buzz-content-surface
      data-buzz-content-unframed={unframed ? true : undefined}
    >
      <div className="buzz-content-primary flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
      <div className="buzz-terminal-dock-host" data-terminal-dock>
        {terminal}
      </div>
    </div>
  );
}
