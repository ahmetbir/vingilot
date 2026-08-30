// The floating dock (redesign P3, mockup `.float` — Vingilot.html:366-377):
// a centered 640px panel over the stage, shown while the position is
// `float`, with the mockup's own hint line and its own Esc.
//
// **Designed fresh, and said so.** The mockup's float is a frozen demo — a
// static Crew shot its own `setChat` never toggles, with a "drag header to
// reposition" hint no code backs (recon confirmed `.float` has no JS at
// all). So this host makes the two honest choices: it floats the WHOLE dock
// (tabs, switcher, panel — whatever tab the owner was on), and it drops the
// drag claim rather than print a promise it does not keep. ⌘\ toggles
// float↔right (the mockup's own binding, vingilot.js:50) and Esc docks back
// right (vingilot.js:51) — both stated on the hint line, truthfully.

import * as React from "react";

import type { VingilotCrewPosition } from "@/shared/theme/vingilot-crew-position";

export function DockFloat({
  children,
  onDockBack,
}: {
  children: React.ReactNode;
  /** Esc's act — back to the right card, the mockup's own reading. */
  onDockBack: (position: VingilotCrewPosition) => void;
}) {
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // A surface above this one (palette, dialog) that already answered the
      // Esc keeps it; the float only takes what nothing else claimed.
      if (event.defaultPrevented) return;
      event.preventDefault();
      onDockBack("right");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDockBack]);

  return (
    <div
      className="absolute left-1/2 top-1/2 z-30 flex max-h-[76%] w-[640px] max-w-[92%] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[15px] border border-foreground/10 bg-popover shadow-2xl"
      data-testid="dock-float"
    >
      {children}
      {/* /70 rather than muted: the popover ground is a step lighter than
       * the stage and the muted seed measured 4.53:1 there — legal by a
       * hair, which is the margin four phases died on. */}
      <p className="shrink-0 border-t border-border/60 py-2 text-center text-2xs text-foreground/70">
        ⌘\ toggles · esc docks back
      </p>
    </div>
  );
}
