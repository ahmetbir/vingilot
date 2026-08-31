// Dragging a tab — inside the strip to reorder it, onto a half of the stage to
// move it there, onto the stage's edge to start a TAB SPLIT (2026-08-29
// redesign, P4.7, item 3: "vscodedaki seyler lazim shortcut ve drag").
//
// **@dnd-kit, because HTML5 drag does not work in this app's window.** The
// brief for this round said to reuse "the app's existing HTML5 drag
// vocabulary"; the app has none. `SidebarDndContext` — the channel-section
// reorder — is @dnd-kit with a `PointerSensor`, and so is `CommunityRail`, and
// that is not an accident of taste: `tauri.conf.json` sets
// `"dragDropEnabled": true`, which the terminal's path-drop requires (only the
// native layer knows a dropped file's real filesystem path; WebKit never fills
// `File.path`). With it on, macOS WKWebView takes the drag session at the
// NSView level and the HTML5 `dragstart`/`dragover`/`drop` path goes dark —
// `lib/nativeDrop.ts`'s header is the fork's own record of finding that out,
// and `Terminal.tsx` says the same thing from the other side ("never true for
// the app's own @dnd-kit drags — a sidebar reorder is pointer events"). A tab
// strip built on `dataTransfer` would pass every test in a plain Chromium and
// do nothing whatsoever in the app the owner runs.
//
// So this is the sidebar's vocabulary, applied to a row instead of a column:
// one `DndContext` around the strip AND the stage (both must be inside it, or
// a tab dragged out of the row has nothing to land on), a 6px activation
// distance so a click is still a click, and a `DragOverlay` ghost.
//
// **The drop zones over the stage are drawn only while a drag is live, and
// they never take a pointer event** (`pointer-events-none`). They exist to be
// *measured* — `pointerWithin` asks where the pointer is against a droppable's
// rectangle, not what the DOM would hit — so covering a live terminal with them
// costs the terminal nothing: no capture, no focus change, no resize, and the
// xterm underneath does not learn that any of this happened.

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDndContext,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import * as React from "react";

import type { TabSplitHalf } from "@/features/runs/lib/tabSplit";

/** What a dragged tab carries: the key that names it in both models, and the
 * label the ghost wears. */
export interface TabDragData {
  type: "tab";
  key: string;
  label: string;
}

/** Where a tab can land. */
export type TabDropData =
  /** Another tab in the strip — a reorder, this one taking that one's place. */
  | { type: "tab-slot"; key: string }
  /** A half of a stage that is already split. */
  | { type: "stage-half"; half: TabSplitHalf }
  /** The stage's own edge, with no split yet — the door that starts one. */
  | { type: "stage-edge" };

export interface TabDrop {
  key: string;
  over: TabDropData | null;
}

/** The strip's own dragging vocabulary, around both the strip and the stage. */
export function TabDndProvider({
  children,
  onDrop,
}: {
  children: React.ReactNode;
  onDrop: (drop: TabDrop) => void;
}) {
  const [dragging, setDragging] = React.useState<TabDragData | null>(null);
  // 6px, the same activation distance the sidebar's reorder uses: a tab is a
  // button first, and a click that moved three pixels is still a click.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleStart = React.useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as TabDragData | undefined;
    setDragging(data?.type === "tab" ? data : null);
  }, []);

  const handleEnd = React.useCallback(
    (event: DragEndEvent) => {
      setDragging(null);
      const data = event.active.data.current as TabDragData | undefined;
      if (data?.type !== "tab") return;
      const over =
        (event.over?.data.current as TabDropData | undefined) ?? null;
      onDrop({ key: data.key, over });
    },
    [onDrop],
  );

  return (
    <DndContext
      collisionDetection={pointerWithin}
      onDragCancel={() => setDragging(null)}
      onDragEnd={handleEnd}
      onDragStart={handleStart}
      sensors={sensors}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {dragging === null ? null : (
          <div
            className="flex cursor-grabbing items-center rounded-md bg-popover px-2.5 py-1.5 text-xs text-foreground shadow-lg ring-1 ring-border"
            data-buzz-flat
            data-testid="tab-drag-overlay"
          >
            {dragging.label}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** One tab: a drag source and a drop target at once, which is what makes a row
 * reorderable without a second set of gaps between the tabs. */
export function DraggableTab({
  boxRef,
  children,
  className,
  dataTestid,
  half,
  isActive,
  label,
  stageKey,
}: {
  /** The strip's own handle on the tab's box, for scrolling the focused one
   * into view — the same node the drag and the drop use, so there is one box
   * and one measurement of it. */
  boxRef: React.RefObject<HTMLDivElement | null> | null;
  children: React.ReactNode;
  className: string;
  dataTestid: string;
  /** Which half of the stage draws this tab, or `undefined` when it is not on
   * the stage at all. */
  half: string | undefined;
  isActive: boolean;
  label: string;
  stageKey: string;
}) {
  const drag = useDraggable({
    data: { key: stageKey, label, type: "tab" } satisfies TabDragData,
    id: `tab:${stageKey}`,
  });
  const drop = useDroppable({
    data: { key: stageKey, type: "tab-slot" } satisfies TabDropData,
    id: `slot:${stageKey}`,
  });
  const ref = React.useCallback(
    (node: HTMLDivElement | null) => {
      drag.setNodeRef(node);
      drop.setNodeRef(node);
      if (boxRef !== null) boxRef.current = node;
    },
    [drag.setNodeRef, drop.setNodeRef, boxRef],
  );

  return (
    <div
      {...drag.attributes}
      {...drag.listeners}
      // An outline rather than a second ring: the tab's ring is already
      // carrying its stage state, and two `ring-*` utilities on one element is
      // a coin toss decided by Tailwind's own ordering.
      className={`${className} touch-none ${drag.isDragging ? "opacity-40" : ""} ${
        drop.isOver && !drag.isDragging
          ? "outline outline-2 outline-offset-1 outline-[var(--vingilot-accent)]"
          : ""
      }`}
      data-active={isActive}
      data-drag-over={drop.isOver && !drag.isDragging ? "true" : undefined}
      data-dragging={drag.isDragging ? "true" : undefined}
      data-half={half}
      data-testid={dataTestid}
      ref={ref}
    >
      {children}
    </div>
  );
}

/** The stage's drop regions, drawn only while a tab is in flight.
 *
 * Two shapes, because the stage has two states. Already split: the two halves,
 * each its own target, so a tab can be dropped into either. Not split yet: the
 * body is "put it here" and a band down the trailing edge is "start a split" —
 * the owner's own "out over the stage's edge", and the reason it is a band
 * rather than the whole right half is that a stage with one tab on it has no
 * halves yet to aim at. */
export function StageDropZones({ split }: { split: boolean }) {
  const { active } = useDndContext();
  const data = active?.data.current as TabDragData | undefined;
  if (data?.type !== "tab") return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 flex"
      data-testid="stage-drop-zones"
    >
      {split ? (
        <>
          <StageZone
            data={{ half: "left", type: "stage-half" }}
            id="stage-left"
            label="Draw it here"
          />
          <StageZone
            data={{ half: "right", type: "stage-half" }}
            id="stage-right"
            label="Draw it here"
          />
        </>
      ) : (
        <>
          <StageZone
            className="basis-3/4"
            data={{ half: "left", type: "stage-half" }}
            id="stage-left"
            label="Draw it here"
          />
          <StageZone
            className="basis-1/4"
            data={{ type: "stage-edge" }}
            id="stage-edge"
            label="Split the stage"
          />
        </>
      )}
    </div>
  );
}

function StageZone({
  className = "flex-1",
  data,
  id,
  label,
}: {
  className?: string;
  data: TabDropData;
  id: string;
  label: string;
}) {
  const { isOver, setNodeRef } = useDroppable({ data, id });
  return (
    <div
      className={`${className} m-1 flex min-w-0 items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
        isOver
          ? "border-[var(--vingilot-accent)] bg-[var(--vingilot-accent)]/10"
          : "border-border/50"
      }`}
      data-over={isOver ? "true" : undefined}
      data-testid={`drop-${id}`}
      ref={setNodeRef}
    >
      {/* **Measured, not assumed.** The label sits on its own opaque chip
       * (`bg-popover`, #2c2c2c on the dark shell) rather than on whatever the
       * zone is drawn over, so the ground is the chip and that is what the
       * ratio is taken against. `text-muted-foreground` on it measures 4.53:1
       * — over the AA floor by three hundredths, which is not a margin — so
       * the resting label is `foreground/85` (8.8:1) and the armed one is
       * full strength (13.8:1). A control may whisper; it may not sit on the
       * line. */}
      <span
        className={`rounded bg-popover px-2 py-1 text-xs ${
          isOver ? "text-foreground" : "text-foreground/85"
        }`}
      >
        {label}
      </span>
    </div>
  );
}
