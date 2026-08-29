// **The Appearance tray** (vingilot redesign P1; mockup `#tray`,
// vingilot/design/mockup/Vingilot.html:378-399).
//
// A popover under the top bar's Appearance button with three controls:
//
// - **Sidebar** — five wash swatches. Live: a click calls the theme context's
//   `setVingilotAppearance`, which stamps `data-vingilot-wash` on the root and
//   persists (`vingilot-appearance.ts`); the gradient consumers follow via
//   the CSS token layer with no re-render of anything below.
// - **Accent** — five accent swatches, same pipeline (`data-vingilot-accent`
//   plus the `--primary` family through the accent hex map).
// - **Crew panel** — Right / Drawer / Float. P1 persists the choice only
//   (`vingilot-crew-position.ts`); the dock that reads it is P3's, and the
//   subline under the control says so rather than letting three buttons
//   pretend to move a panel that is not on screen yet.
//
// Fork-owned, new — mounted by `AppTopChrome` so that upstream file's edit
// stays a button and a mount.

import * as React from "react";

import { useTheme } from "@/shared/theme/ThemeProvider";
import {
  VINGILOT_ACCENT_HEX,
  VINGILOT_ACCENTS,
  VINGILOT_WASH_GRADIENTS,
  VINGILOT_WASHES,
  type VingilotAccent,
  type VingilotWash,
} from "@/shared/theme/vingilot-appearance";
import {
  persistVingilotCrewPosition,
  readVingilotCrewPosition,
  VINGILOT_CREW_POSITIONS,
  type VingilotCrewPosition,
} from "@/shared/theme/vingilot-crew-position";
import { cn } from "@/shared/lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

const CREW_POSITION_LABELS: Record<VingilotCrewPosition, string> = {
  drawer: "Drawer",
  float: "Float",
  right: "Right",
};

function TrayLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-3 select-none text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground first:mt-0">
      {children}
    </p>
  );
}

function Swatch({
  isOn,
  label,
  onClick,
  style,
  testId,
}: {
  isOn: boolean;
  label: string;
  onClick: () => void;
  style: React.CSSProperties;
  testId: string;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={isOn}
      className={cn(
        "h-8 w-8 rounded-lg border-2 border-transparent",
        isOn && "border-foreground",
      )}
      data-testid={testId}
      onClick={onClick}
      style={style}
      title={label}
      type="button"
    />
  );
}

export function VingilotAppearanceTray({
  children,
}: {
  /** The Appearance button — rendered by `AppTopChrome`, triggered here. */
  children: React.ReactNode;
}) {
  const { setVingilotAppearance, vingilotAppearance } = useTheme();
  const [crewPosition, setCrewPosition] = React.useState(
    readVingilotCrewPosition,
  );

  const selectCrewPosition = React.useCallback(
    (position: VingilotCrewPosition) => {
      setCrewPosition(position);
      persistVingilotCrewPosition(position);
    },
    [],
  );

  const selectWash = React.useCallback(
    (wash: VingilotWash) => setVingilotAppearance({ wash }),
    [setVingilotAppearance],
  );
  const selectAccent = React.useCallback(
    (accent: VingilotAccent) => setVingilotAppearance({ accent }),
    [setVingilotAppearance],
  );

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 p-4"
        data-testid="vingilot-appearance-tray"
        sideOffset={6}
      >
        <TrayLabel>Sidebar</TrayLabel>
        <div className="flex gap-2">
          {VINGILOT_WASHES.map((wash) => {
            const gradient = VINGILOT_WASH_GRADIENTS[wash];
            return (
              <Swatch
                isOn={vingilotAppearance.wash === wash}
                key={wash}
                label={`${wash} wash`}
                onClick={() => selectWash(wash)}
                style={{
                  background: `linear-gradient(to bottom, ${gradient.top}, ${gradient.bottom})`,
                }}
                testId={`vingilot-wash-${wash}`}
              />
            );
          })}
        </div>
        <TrayLabel>Accent</TrayLabel>
        <div className="flex gap-2">
          {VINGILOT_ACCENTS.map((accent) => (
            <Swatch
              isOn={vingilotAppearance.accent === accent}
              key={accent}
              label={`${accent} accent`}
              onClick={() => selectAccent(accent)}
              style={{ background: VINGILOT_ACCENT_HEX[accent] }}
              testId={`vingilot-accent-${accent}`}
            />
          ))}
        </div>
        <TrayLabel>Crew panel</TrayLabel>
        <div className="flex gap-0.5 rounded-lg bg-muted/60 p-0.5">
          {VINGILOT_CREW_POSITIONS.map((position) => (
            <button
              aria-pressed={crewPosition === position}
              className={cn(
                "flex-1 rounded-md py-1 text-xs font-medium text-muted-foreground",
                crewPosition === position &&
                  "bg-background text-foreground shadow-xs",
              )}
              data-testid={`vingilot-crew-${position}`}
              key={position}
              onClick={() => selectCrewPosition(position)}
              type="button"
            >
              {CREW_POSITION_LABELS[position]}
            </button>
          ))}
        </div>
        <p className="mt-2 select-none text-2xs text-muted-foreground">
          Arrives with the dock — your choice is saved.
        </p>
      </PopoverContent>
    </Popover>
  );
}
