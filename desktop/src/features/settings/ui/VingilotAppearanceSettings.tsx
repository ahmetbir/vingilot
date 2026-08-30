// **The Vingilot shell's appearance controls, as a Settings card** (P1.1,
// owner veto 2). The top bar's Appearance tray was vetoed live; Settings →
// Appearance is the surface that owns these now, and the ⌘K palette's
// "Appearance" row is the door to it. Same three controls, same pipeline:
//
// - **Sidebar** — five wash swatches. Live: a click calls the theme context's
//   `setVingilotAppearance`, which stamps `data-vingilot-wash` on the root and
//   persists (`vingilot-appearance.ts`); the gradient consumers follow via the
//   CSS token layer.
// - **Accent** — five accent swatches, same pipeline (`data-vingilot-accent`
//   plus the `--primary` family through the accent hex map).
// - **Crew panel** — Right / Drawer / Float. Persisted choice only
//   (`vingilot-crew-position.ts`); the dock that reads it is P3's, and the
//   subline says so rather than letting three buttons pretend to move a panel
//   that is not on screen yet.
//
// Fork-owned; `SettingsPanels.tsx` mounts it with one line so that upstream
// file's edit stays a mount. Testids carried over from the tray verbatim —
// the controls moved, their vocabulary did not.

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
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";

const CREW_POSITION_LABELS: Record<VingilotCrewPosition, string> = {
  drawer: "Drawer",
  float: "Float",
  right: "Right",
};

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

function VingilotRow({
  children,
  subcopy,
  title,
}: {
  children: React.ReactNode;
  subcopy: string;
  title: string;
}) {
  return (
    <SettingsOptionRow>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p
          className="text-sm font-normal text-muted-foreground/70"
          data-settings-subcopy
        >
          {subcopy}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </SettingsOptionRow>
  );
}

export function VingilotAppearanceSettings() {
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
    <SettingsOptionGroup
      data-testid="vingilot-appearance-card"
      title="Vingilot shell"
    >
      <VingilotRow
        subcopy="The gradient behind the sidebar — applies live."
        title="Sidebar"
      >
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
      </VingilotRow>
      <VingilotRow
        subcopy="The shell's accent color — applies live."
        title="Accent"
      >
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
      </VingilotRow>
      <VingilotRow
        subcopy="Arrives with the dock — your choice is saved."
        title="Crew panel"
      >
        <div className="flex gap-0.5 rounded-lg bg-muted/60 p-0.5">
          {VINGILOT_CREW_POSITIONS.map((position) => (
            <button
              aria-pressed={crewPosition === position}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium text-muted-foreground",
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
      </VingilotRow>
    </SettingsOptionGroup>
  );
}
