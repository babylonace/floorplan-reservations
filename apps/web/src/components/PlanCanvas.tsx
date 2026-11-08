import {
  boundingBox,
  normalizeSides,
  type Box,
  type PlanIssue,
} from "@floorplan-reservations/engine";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { Table } from "../api/types";
import { useI18n } from "../i18n/i18n";
import { tableColor, textOn } from "../plan/colors";
import {
  clamp,
  intersection,
  MAX_CM,
  NUDGE_CM,
  normalizeRotation,
  rotationFromHandle,
  sizeFromHandle,
  snap,
  SNAP_CM,
  TURN_STEP,
  type Point,
  chairLayout,
} from "../plan/geometry";

/**
 * The zone drawn to scale. One SVG unit is one centimetre, so the plan's own numbers are used
 * as they are. Tables are focusable: Tab walks through them, the arrow keys move the selected
 * one and R turns it. The pointer drags, turns (round handle) and resizes (square handle).
 * On a touch screen the handles grow, and a finger on the plan's free space scrolls the page:
 * only a finger that lands on a table moves it.
 */

export interface PlanCanvasProps {
  zone: { name: string; width: number; height: number };
  tables: readonly Table[];
  issues: readonly PlanIssue[];
  selectedId: string | null;
  editable: boolean;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<Table>) => void;
  onRemove: (id: string) => void;
  onAnnounce: (text: string) => void;
  /** Lets the editor move keyboard focus to a table, for example one just added. */
  tableRef: (id: string, element: SVGGElement | null) => void;
}

type Gesture =
  | { kind: "move"; id: string; pointerId: number; start: Table; offset: Point }
  | { kind: "resize" | "rotate"; id: string; pointerId: number; start: Table };

const SCALE_STEPS = [50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000];

/**
 * Handle sizes in screen pixels. The part you can grab is bigger than the part you see: at
 * least 24 px with a mouse (WCAG 2.2 target size) and 44 px for a finger.
 */
export const HANDLES = {
  fine: { stem: 22, rotate: 7, resize: 12, target: 24 },
  coarse: { stem: 34, rotate: 10, resize: 18, target: 44 },
} as const;

/** True on screens driven mainly by a finger, such as a tablet. */
function useCoarsePointer(): boolean {
  const query = "(pointer: coarse)";
  const [coarse, setCoarse] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const update = () => {
      setCoarse(list.matches);
    };
    list.addEventListener("change", update);
    return () => {
      list.removeEventListener("change", update);
    };
  }, []);
  return coarse;
}

export function PlanCanvas(props: PlanCanvasProps) {
  const { zone, tables, issues, selectedId, editable, onSelect, onChange, onRemove, onAnnounce } =
    props;
  const { t, format } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  /** A finger or pen pressed on the free space: it lets go of the table only if it was a tap. */
  const tap = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const ids = useId().replace(/:/g, "");
  const hatchId = `hatch-${ids}`;
  const gridId = `grid-${ids}`;
  const helpId = `help-${ids}`;
  const handles = useCoarsePointer() ? HANDLES.coarse : HANDLES.fine;

  // A finger that lands on a table drags it instead of scrolling the page; anywhere else on the
  // plan it scrolls as usual. Pointer events cannot stop scrolling, so this listens to touches.
  const editableRef = useRef(editable);
  useEffect(() => {
    editableRef.current = editable;
  }, [editable]);
  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const hold = (event: TouchEvent) => {
      if (editableRef.current && event.target instanceof Element) {
        if (event.target.closest(".plan-table")) event.preventDefault();
      }
    };
    element.addEventListener("touchstart", hold, { passive: false });
    return () => {
      element.removeEventListener("touchstart", hold);
    };
  }, []);

  // Labels, handles and lines keep the same size on screen however big the zone is: `unit` is
  // how many centimetres one screen pixel covers.
  const [screen, setScreen] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const element = svgRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScreen({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  const measured = screen !== null && screen.width > 0 && screen.height > 0 ? screen : null;
  const roughUnit = measured
    ? Math.max(zone.width / measured.width, zone.height / measured.height)
    : Math.max(zone.width, zone.height, 200) / 900;
  const pad = 70 * roughUnit;
  const unit = measured
    ? Math.max((zone.width + 2 * pad) / measured.width, (zone.height + 2 * pad) / measured.height)
    : roughUnit;
  const gridStep = zone.width > 4000 || zone.height > 4000 ? 100 : 50;

  const problems = new Map<string, number>();
  for (const issue of issues) {
    problems.set(issue.tableId, (problems.get(issue.tableId) ?? 0) + 1);
    if (issue.code === "overlap") {
      problems.set(issue.otherTableId, (problems.get(issue.otherTableId) ?? 0) + 1);
    }
  }
  const byId = new Map(tables.map((table) => [table.id, table]));
  const overlapAreas: { key: string; box: Box }[] = [];
  for (const issue of issues) {
    if (issue.code !== "overlap") continue;
    const a = byId.get(issue.tableId);
    const b = byId.get(issue.otherTableId);
    const box = a && b ? intersection(boundingBox(a), boundingBox(b)) : null;
    if (box) overlapAreas.push({ key: `${issue.tableId}-${issue.otherTableId}`, box });
  }

  function toPlan(event: PointerEvent): Point | null {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }

  function startGesture(event: PointerEvent, table: Table, kind: Gesture["kind"]) {
    event.stopPropagation();
    onSelect(table.id);
    // Holding the touch (see below) also stops the browser focusing the table, so do it here:
    // a tablet with a keyboard can then use the arrows straight away.
    if (event.pointerType !== "mouse" && event.currentTarget instanceof Element) {
      event.currentTarget.closest<SVGGElement>(".plan-table")?.focus({ preventScroll: true });
    }
    // One gesture at a time: a second finger does not take over the table being dragged.
    if (!editable || event.button !== 0 || gesture.current) return;
    const point = toPlan(event);
    if (!point) return;
    svgRef.current?.setPointerCapture(event.pointerId);
    gesture.current =
      kind === "move"
        ? {
            kind,
            id: table.id,
            pointerId: event.pointerId,
            start: table,
            offset: { x: point.x - table.x, y: point.y - table.y },
          }
        : { kind, id: table.id, pointerId: event.pointerId, start: table };
  }

  function onPointerMove(event: PointerEvent) {
    const active = gesture.current;
    if (active?.pointerId !== event.pointerId) return;
    const point = toPlan(event);
    if (!point) return;
    // Alt places freely, to the centimetre or degree.
    const step = event.altKey ? 1 : SNAP_CM;
    if (active.kind === "move") {
      onChange(active.id, {
        x: clamp(snap(point.x - active.offset.x, step), -MAX_CM, MAX_CM),
        y: clamp(snap(point.y - active.offset.y, step), -MAX_CM, MAX_CM),
      });
    } else if (active.kind === "resize") {
      onChange(active.id, sizeFromHandle(active.start, point, step));
    } else {
      onChange(active.id, {
        rotation: rotationFromHandle(active.start, point, event.altKey ? 1 : TURN_STEP),
      });
    }
  }

  function endGesture(event: PointerEvent) {
    const active = gesture.current;
    if (active?.pointerId !== event.pointerId) return;
    gesture.current = null;
    const table = byId.get(active.id);
    if (!table) return;
    if (active.kind === "move" && (table.x !== active.start.x || table.y !== active.start.y)) {
      onAnnounce(t.announce.moved(table.label, format.meters(table.x), format.meters(table.y)));
    } else if (active.kind === "rotate" && table.rotation !== active.start.rotation) {
      onAnnounce(t.announce.rotated(table.label, table.rotation));
    } else if (
      active.kind === "resize" &&
      (table.width !== active.start.width || table.height !== active.start.height)
    ) {
      onAnnounce(
        t.announce.resized(table.label, format.meters(table.width), format.meters(table.height)),
      );
    }
  }

  function cancelGesture(): boolean {
    const active = gesture.current;
    if (!active) return false;
    gesture.current = null;
    const { x, y, width, height, rotation } = active.start;
    onChange(active.id, { x, y, width, height, rotation });
    return true;
  }

  function onTableKeyDown(event: KeyboardEvent, table: Table) {
    if (event.key === "Escape") {
      if (!cancelGesture()) onSelect(null);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(table.id);
      return;
    }
    if (!editable) return;
    const distance = event.shiftKey ? NUDGE_CM * 10 : NUDGE_CM;
    const moves: Record<string, Point> = {
      ArrowLeft: { x: -distance, y: 0 },
      ArrowRight: { x: distance, y: 0 },
      ArrowUp: { x: 0, y: -distance },
      ArrowDown: { x: 0, y: distance },
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      const x = clamp(table.x + move.x, -MAX_CM, MAX_CM);
      const y = clamp(table.y + move.y, -MAX_CM, MAX_CM);
      onSelect(table.id);
      onChange(table.id, { x, y });
      onAnnounce(t.announce.moved(table.label, format.meters(x), format.meters(y)));
    } else if (event.key.toLowerCase() === "r" && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const rotation = normalizeRotation(
        table.rotation + (event.shiftKey ? -TURN_STEP : TURN_STEP),
      );
      onChange(table.id, { rotation });
      onAnnounce(t.announce.rotated(table.label, rotation));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onRemove(table.id);
    }
  }

  const scale = SCALE_STEPS.find((step) => step >= zone.width / 6) ?? zone.width;
  const dimensionY = -28 * unit;
  const dimensionX = -28 * unit;
  const tick = 6 * unit;

  return (
    <div className="plan-canvas">
      <p id={helpId} className="visually-hidden">
        {editable ? t.plan.help : t.plan.helpReadOnly}
      </p>
      <svg
        ref={svgRef}
        className={editable ? "plan-svg is-editable" : "plan-svg"}
        // Keyboard focus lands here when the focused table is removed.
        tabIndex={-1}
        data-plan-canvas=""
        viewBox={`${String(-pad)} ${String(-pad)} ${String(zone.width + 2 * pad)} ${String(zone.height + 2 * pad)}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={t.plan.label(zone.name, format.meters(zone.width), format.meters(zone.height))}
        aria-describedby={helpId}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => {
          endGesture(event);
          const pressed = tap.current;
          if (pressed?.pointerId !== event.pointerId) return;
          tap.current = null;
          if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 10) onSelect(null);
        }}
        onPointerCancel={(event) => {
          // The browser took the touch over to scroll: the table stays selected.
          if (tap.current?.pointerId === event.pointerId) tap.current = null;
          if (gesture.current?.pointerId === event.pointerId) cancelGesture();
        }}
        onPointerDown={(event) => {
          // A mouse lets go at once. A finger may be starting to scroll down to the panel, so it
          // waits to see whether this is a tap.
          if (event.pointerType === "mouse") onSelect(null);
          else tap.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        }}
      >
        <defs>
          <pattern
            id={hatchId}
            width={9 * unit}
            height={9 * unit}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width={4 * unit} height={9 * unit} className="hatch-stripe" />
          </pattern>
          <pattern
            id={gridId}
            width={gridStep * 2}
            height={gridStep * 2}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${String(gridStep)} 0 V ${String(gridStep * 2)} M 0 ${String(gridStep)} H ${String(gridStep * 2)}`}
              className="grid-minor"
            />
            <path
              d={`M 0 0 V ${String(gridStep * 2)} M 0 0 H ${String(gridStep * 2)}`}
              className="grid-major"
            />
          </pattern>
        </defs>

        <g aria-hidden="true" className="dimensions">
          <path
            d={`M 0 ${String(dimensionY - tick)} V ${String(dimensionY + tick)} M 0 ${String(dimensionY)} H ${String(zone.width)} M ${String(zone.width)} ${String(dimensionY - tick)} V ${String(dimensionY + tick)}`}
          />
          <text
            x={zone.width / 2}
            y={dimensionY - 6 * unit}
            fontSize={13 * unit}
            textAnchor="middle"
          >
            {format.meters(zone.width)}
          </text>
          <path
            d={`M ${String(dimensionX - tick)} 0 H ${String(dimensionX + tick)} M ${String(dimensionX)} 0 V ${String(zone.height)} M ${String(dimensionX - tick)} ${String(zone.height)} H ${String(dimensionX + tick)}`}
          />
          <text
            x={dimensionX - 6 * unit}
            y={zone.height / 2}
            fontSize={13 * unit}
            textAnchor="middle"
            transform={`rotate(-90 ${String(dimensionX - 6 * unit)} ${String(zone.height / 2)})`}
          >
            {format.meters(zone.height)}
          </text>
          <path
            className="scale-bar"
            d={`M 0 ${String(zone.height + 22 * unit)} h ${String(scale)}`}
            strokeWidth={5 * unit}
          />
          <text x={scale + 8 * unit} y={zone.height + 26 * unit} fontSize={12 * unit}>
            {format.meters(scale)}
          </text>
        </g>

        <rect
          className="zone-shadow"
          x={5 * unit}
          y={5 * unit}
          width={zone.width}
          height={zone.height}
          aria-hidden="true"
        />
        <rect className="zone-floor" width={zone.width} height={zone.height} aria-hidden="true" />
        <rect
          width={zone.width}
          height={zone.height}
          fill={`url(#${gridId})`}
          aria-hidden="true"
          pointerEvents="none"
        />
        <rect
          className="zone-walls"
          width={zone.width}
          height={zone.height}
          strokeWidth={3 * unit}
          aria-hidden="true"
          pointerEvents="none"
        />

        {tables.map((table) => (
          <TableShape
            key={table.id}
            table={table}
            unit={unit}
            selected={table.id === selectedId}
            problems={problems.get(table.id) ?? 0}
            hatchId={hatchId}
            editable={editable}
            handles={handles}
            label={t.plan.tableName({
              label: table.label,
              round: table.shape === "round",
              minSeats: table.minSeats,
              maxSeats: table.maxSeats,
              x: format.meters(table.x),
              y: format.meters(table.y),
              rotation: table.rotation,
              bookable: table.bookable,
              problems: problems.get(table.id) ?? 0,
              seatedSides:
                table.shape === "rect" && table.seatSides
                  ? normalizeSides(table.seatSides).length
                  : null,
            })}
            bindElement={(element) => {
              props.tableRef(table.id, element);
            }}
            onPointerDown={(event, kind) => {
              startGesture(event, table, kind);
            }}
            onKeyDown={(event) => {
              onTableKeyDown(event, table);
            }}
            onFocus={() => {
              onSelect(table.id);
            }}
          />
        ))}

        <g aria-hidden="true" pointerEvents="none">
          {overlapAreas.map(({ key, box }) => (
            <rect
              key={key}
              className="overlap-area"
              x={box.left}
              y={box.top}
              width={box.right - box.left}
              height={box.bottom - box.top}
              fill={`url(#${hatchId})`}
              strokeWidth={2 * unit}
            />
          ))}
        </g>

        {/* Labels sit apart from the table buttons: the buttons' names already say all this. */}
        <g aria-hidden="true" pointerEvents="none">
          {tables.map((table) => (
            <TableLabel
              key={table.id}
              table={table}
              unit={unit}
              seats={t.plan.seats(table.minSeats, table.maxSeats)}
              problems={problems.get(table.id) ?? 0}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

interface TableShapeProps {
  table: Table;
  unit: number;
  selected: boolean;
  problems: number;
  hatchId: string;
  editable: boolean;
  handles: (typeof HANDLES)[keyof typeof HANDLES];
  label: string;
  bindElement: (element: SVGGElement | null) => void;
  onPointerDown: (event: PointerEvent, kind: Gesture["kind"]) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onFocus: () => void;
}

function TableShape({
  table,
  unit,
  selected,
  problems,
  hatchId,
  editable,
  handles,
  label,
  bindElement,
  onPointerDown,
  onKeyDown,
  onFocus,
}: TableShapeProps) {
  const fill = tableColor(table.style);
  const { width: w, height: h } = table;
  const shape = (className: string, extra = 0, strokeWidth?: number) =>
    table.shape === "round" ? (
      <ellipse
        className={className}
        rx={w / 2 + extra}
        ry={h / 2 + extra}
        strokeWidth={strokeWidth}
      />
    ) : (
      <rect
        className={className}
        x={-w / 2 - extra}
        y={-h / 2 - extra}
        width={w + 2 * extra}
        height={h + 2 * extra}
        rx={Math.min(6 * unit + extra, w / 4, h / 4)}
        strokeWidth={strokeWidth}
      />
    );
  const classes = ["plan-table"];
  if (selected) classes.push("is-selected");
  if (problems > 0) classes.push("has-problem");
  if (!table.bookable) classes.push("not-bookable");

  return (
    <g
      ref={bindElement}
      className={classes.join(" ")}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={label}
      data-table-id={table.id}
      onPointerDown={(event) => {
        onPointerDown(event, "move");
      }}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      <g
        transform={`translate(${String(table.x)} ${String(table.y)}) rotate(${String(table.rotation)})`}
      >
        <Chairs table={table} unit={unit} />
        {shape("focus-ring", 9 * unit, 2 * unit)}
        {selected && shape("selection-ring", 5 * unit, 5 * unit)}
        {/* A thin ink edge keeps the yellow ring visible on the pale floor (3:1 or more). */}
        {selected && shape("selection-edge", 8 * unit, 1.5 * unit)}
        <g style={{ fill }}>{shape("table-top", 0, 1.5 * unit)}</g>
        {problems > 0 && <g fill={`url(#${hatchId})`}>{shape("problem-hatch", 0, 3 * unit)}</g>}
        {selected && editable && (
          <g className="handles">
            <line
              x1={0}
              y1={-h / 2}
              x2={0}
              y2={-h / 2 - handles.stem * unit}
              strokeWidth={1.5 * unit}
            />
            <circle
              className="handle handle-rotate"
              cy={-h / 2 - handles.stem * unit}
              r={handles.rotate * unit}
              strokeWidth={2 * unit}
            />
            <rect
              className="handle handle-resize"
              x={w / 2 - (handles.resize / 2) * unit}
              y={h / 2 - (handles.resize / 2) * unit}
              width={handles.resize * unit}
              height={handles.resize * unit}
              strokeWidth={2 * unit}
            />
            {/* What the pointer grabs: invisible, and bigger than what is drawn. */}
            <circle
              className="handle-target handle-target-rotate"
              cy={-h / 2 - handles.stem * unit}
              r={(handles.target / 2) * unit}
              onPointerDown={(event) => {
                onPointerDown(event, "rotate");
              }}
            />
            {/* It reaches outwards from the corner, so it covers little of a small table. */}
            <rect
              className="handle-target handle-target-resize"
              x={w / 2 - (handles.resize / 2 + 2) * unit}
              y={h / 2 - (handles.resize / 2 + 2) * unit}
              width={handles.target * unit}
              height={handles.target * unit}
              onPointerDown={(event) => {
                onPointerDown(event, "resize");
              }}
            />
          </g>
        )}
      </g>
    </g>
  );
}

/**
 * Chairs around the table, one per seat, as a drawing aid. They are not part of the checks.
 * They are all round, like bar stools, and shrink when they would touch each other.
 */
function Chairs({ table, unit }: { table: Table; unit: number }) {
  const { radius, chairs } = chairLayout(table);
  return (
    <g className="chairs" aria-hidden="true" strokeWidth={unit}>
      {chairs.map((c, index) => (
        <circle key={index} cx={c.x} cy={c.y} r={radius} />
      ))}
    </g>
  );
}

/** The table's name and seats, upright whatever its turn, and a mark when it has a problem. */
function TableLabel({
  table,
  unit,
  seats,
  problems,
}: {
  table: Table;
  unit: number;
  seats: string;
  problems: number;
}) {
  const ink = textOn(tableColor(table.style));
  // Seats are shown under the label when the table is big enough on screen to hold both.
  const longest = Math.max(table.label.length * 8.5, seats.length * 6.5);
  const twoLines = table.height / unit > 34 && table.width / unit > longest + 8;
  const box = boundingBox(table);
  return (
    <g>
      <text
        className="table-label"
        x={table.x}
        y={table.y}
        fontSize={14 * unit}
        textAnchor="middle"
        style={{ fill: ink }}
      >
        <tspan x={table.x} dy={twoLines ? -1 * unit : 5 * unit}>
          {table.label}
        </tspan>
        {twoLines && (
          <tspan x={table.x} dy={13 * unit} fontSize={10.5 * unit} className="table-seats">
            {seats}
          </tspan>
        )}
      </text>
      {problems > 0 && (
        <g className="problem-badge">
          <circle cx={box.right} cy={box.top} r={9 * unit} />
          <text x={box.right} y={box.top + 4 * unit} fontSize={12 * unit} textAnchor="middle">
            !
          </text>
        </g>
      )}
    </g>
  );
}
