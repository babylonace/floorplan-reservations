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
  type ReactNode,
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
import {
  clampView,
  fitView,
  isInView,
  maxZoom,
  viewBox,
  zoomAround,
  ZOOM_STEP,
  type PlanFrame,
  type PlanView,
} from "../plan/view";

/**
 * The zone drawn to scale. One SVG unit is one centimetre, so the plan's own numbers are used
 * as they are. Tables are focusable: Tab walks through them, the arrow keys move the selected
 * one and R turns it. The pointer drags, turns (round handle) and resizes (square handle).
 * On a touch screen the handles grow, and a finger on the plan's free space scrolls the page:
 * only a finger that lands on a table moves it.
 *
 * The plan zooms in and out with the buttons in its corner, + and - (0 shows it all again),
 * Ctrl and the mouse wheel, or two fingers. Zoomed in, dragging the free space (or the wheel on
 * its own) moves around the plan. Labels, lines and handles keep their size on screen.
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
  /** More buttons for the plan's corner, after the zoom buttons. */
  tools?: ReactNode;
}

type Gesture =
  | { kind: "move"; id: string; pointerId: number; start: Table; offset: Point }
  | { kind: "resize" | "rotate"; id: string; pointerId: number; start: Table };

/** Dragging the free space of a zoomed-in plan. */
interface Pan {
  pointerId: number;
  x: number;
  y: number;
  center: Point;
  unit: number;
}

/** Two fingers on the plan: the plan point between them stays between them. */
interface Pinch {
  distance: number;
  zoom: number;
  anchor: Point;
}

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
  const pan = useRef<Pan | null>(null);
  /** Set by the keyboard (and focus not caused by a pointer): bring the selected table into view. */
  const follow = useRef(false);
  /** A pointer is pressed on the plan. */
  const pressing = useRef(false);
  const pinch = useRef<Pinch | null>(null);
  /** Fingers on the plan, by pointer id, for the pinch. */
  const fingers = useRef(new Map<number, Point>());

  // A finger that lands on a table drags it instead of scrolling the page; anywhere else on the
  // plan it scrolls as usual. Pointer events cannot stop scrolling, so this listens to touches.
  const editableRef = useRef(editable);
  useEffect(() => {
    editableRef.current = editable;
  }, [editable]);
  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const onPlan = (event: TouchEvent) =>
      [...event.touches].filter(
        (touch) => touch.target instanceof Node && element.contains(touch.target),
      ).length;
    const hold = (event: TouchEvent) => {
      // Two fingers on the plan zoom it, never the page.
      if (onPlan(event) > 1) {
        event.preventDefault();
        return;
      }
      if (editableRef.current && event.target instanceof Element) {
        if (event.target.closest(".plan-table")) event.preventDefault();
      }
    };
    const twoFingers = (event: TouchEvent) => {
      if (onPlan(event) > 1 && event.cancelable) event.preventDefault();
    };
    element.addEventListener("touchstart", hold, { passive: false });
    element.addEventListener("touchmove", twoFingers, { passive: false });
    return () => {
      element.removeEventListener("touchstart", hold);
      element.removeEventListener("touchmove", twoFingers);
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
  const fitUnit = measured
    ? Math.max((zone.width + 2 * pad) / measured.width, (zone.height + 2 * pad) / measured.height)
    : roughUnit;
  const frame: PlanFrame = {
    x: -pad,
    y: -pad,
    width: zone.width + 2 * pad,
    height: zone.height + 2 * pad,
  };
  const mostZoom = maxZoom(fitUnit);
  const [view, setView] = useState<PlanView>(() => fitView(frame));
  const shown = clampView(view, frame, mostZoom);
  const box = viewBox(shown, frame);
  const unit = fitUnit / shown.zoom;
  const zoomed = shown.zoom > 1;

  // What the wheel, the keys and the fingers need, kept fresh for the listeners.
  const latest = useRef({ frame, fitUnit, mostZoom, zoom: shown.zoom, center: shown.center });
  useLayoutEffect(() => {
    latest.current = { frame, fitUnit, mostZoom, zoom: shown.zoom, center: shown.center };
  });

  /** How far `client` is from the middle of the plan's box, in screen pixels. */
  function fromMiddle(client: Point): Point {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: client.x - (rect.left + rect.width / 2),
      y: client.y - (rect.top + rect.height / 2),
    };
  }

  /** Zooms to `zoom` keeping the plan under `client` (the middle when not given) in place. */
  function zoomTo(zoom: number | ((current: number) => number), client?: Point) {
    const offset = client ? fromMiddle(client) : { x: 0, y: 0 };
    const { frame: f, fitUnit: fit, mostZoom: most } = latest.current;
    setView((previous) => {
      const now = clampView(previous, f, most);
      const target = clamp(typeof zoom === "function" ? zoom(now.zoom) : zoom, 1, most);
      const anchor = {
        x: now.center.x + (offset.x * fit) / now.zoom,
        y: now.center.y + (offset.y * fit) / now.zoom,
      };
      return clampView(zoomAround(anchor, offset, target, fit), f, most);
    });
  }

  /**
   * Moves the plan by this many screen pixels (positive: the plan goes left and up). False when
   * it is already at the edge that way, so the wheel can scroll the page instead.
   */
  function panBy(dx: number, dy: number): boolean {
    const { frame: f, fitUnit: fit, mostZoom: most, center } = latest.current;
    const step = fit / latest.current.zoom;
    const next = clampView(
      {
        zoom: latest.current.zoom,
        center: { x: center.x + dx * step, y: center.y + dy * step },
      },
      f,
      most,
    );
    if (Math.abs(next.center.x - center.x) < 0.01 && Math.abs(next.center.y - center.y) < 0.01) {
      return false;
    }
    setView((previous) => {
      const now = clampView(previous, f, most);
      return clampView(
        { ...now, center: { x: now.center.x + dx * step, y: now.center.y + dy * step } },
        f,
        most,
      );
    });
    return true;
  }

  const actions = useRef({ zoomTo, panBy });
  useLayoutEffect(() => {
    actions.current = { zoomTo, panBy };
  });

  // Ctrl (or Cmd) and the wheel zoom around the pointer, as does a pinch on a touchpad. Zoomed
  // in, the wheel on its own moves around the plan; zoomed out, it scrolls the page as usual.
  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const factor = Math.exp(-event.deltaY * scale * 0.002);
        actions.current.zoomTo((zoom) => zoom * factor, { x: event.clientX, y: event.clientY });
      } else if (latest.current.zoom > 1) {
        if (actions.current.panBy(event.deltaX * scale, event.deltaY * scale)) {
          event.preventDefault();
        }
      }
    };
    // Safari sends a touchpad pinch as its own gesture events instead of Ctrl and the wheel.
    type Gesture = Event & { scale: number; clientX: number; clientY: number };
    let startZoom = 1;
    const gestureStart = (event: Event) => {
      event.preventDefault();
      startZoom = latest.current.zoom;
    };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Gesture;
      actions.current.zoomTo(startZoom * gesture.scale, { x: gesture.clientX, y: gesture.clientY });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("gesturestart", gestureStart);
    element.addEventListener("gesturechange", gestureChange);
    return () => {
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("gesturestart", gestureStart);
      element.removeEventListener("gesturechange", gestureChange);
    };
  }, []);

  // Zoomed in, the selected table stays in sight when the keyboard moves or chooses it, or the
  // editor focuses it (a new table, a problem in the list). Never while a pointer holds the
  // plan: the view would slide away under a table being dragged.
  const selectedTable = tables.find((table) => table.id === selectedId);
  const followX = selectedTable?.x;
  const followY = selectedTable?.y;
  useEffect(() => {
    if (!follow.current) return;
    follow.current = false;
    if (followX === undefined || followY === undefined) return;
    const { frame: f, fitUnit: fit, mostZoom: most } = latest.current;
    setView((previous) => {
      const now = clampView(previous, f, most);
      if (now.zoom <= 1) return previous;
      const seen = viewBox(now, f);
      if (isInView({ x: followX, y: followY }, seen, (40 * fit) / now.zoom)) return previous;
      return clampView({ ...now, center: { x: followX, y: followY } }, f, most);
    });
  }, [selectedId, followX, followY]);

  /** Two fingers down: the pinch starts, and whatever one finger was doing stops. */
  function startPinch() {
    const [a, b] = [...fingers.current.values()];
    if (!a || !b) {
      pinch.current = null;
      return;
    }
    cancelGesture();
    pan.current = null;
    tap.current = null;
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const offset = fromMiddle(middle);
    pinch.current = {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      zoom: shown.zoom,
      anchor: { x: shown.center.x + offset.x * unit, y: shown.center.y + offset.y * unit },
    };
  }

  function movePinch() {
    const active = pinch.current;
    const [a, b] = [...fingers.current.values()];
    if (!active || !a || !b) return;
    const zoom = clamp(
      (active.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / active.distance,
      1,
      mostZoom,
    );
    const offset = fromMiddle({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    setView(clampView(zoomAround(active.anchor, offset, zoom, fitUnit), frame, mostZoom));
  }

  /** Any pointer let go (a mouse button too). */
  function liftFinger(pointerId: number) {
    fingers.current.delete(pointerId);
    pressing.current = fingers.current.size > 0;
    // A third finger may take over from the one lifted: the pinch starts again from here.
    if (pinch.current) {
      if (fingers.current.size >= 2) startPinch();
      else pinch.current = null;
    }
  }

  /** A step of the buttons or the keys, said out loud for screen readers. */
  function zoomStep(target: number) {
    const zoom = clamp(target, 1, mostZoom);
    if (Math.abs(zoom - shown.zoom) < 1e-6) return;
    zoomTo(zoom);
    onAnnounce(t.announce.zoom(Math.round(zoom * 100)));
  }

  function onPlanKeyDown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "+" || event.key === "=") zoomStep(shown.zoom * ZOOM_STEP);
    else if (event.key === "-" || event.key === "_") zoomStep(shown.zoom / ZOOM_STEP);
    else if (event.key === "0") zoomStep(1);
    else return;
    event.preventDefault();
  }
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
    onSelect(table.id);
    // Read-only and zoomed in, the press carries on to the plan, which moves around.
    if (!editable && zoomed) return;
    event.stopPropagation();
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
    const panning = pan.current;
    if (panning?.pointerId === event.pointerId) {
      const center = {
        x: panning.center.x - (event.clientX - panning.x) * panning.unit,
        y: panning.center.y - (event.clientY - panning.y) * panning.unit,
      };
      setView(clampView({ zoom: shown.zoom, center }, frame, mostZoom));
      return;
    }
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
      follow.current = true;
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
    <div className="plan-canvas" onKeyDown={onPlanKeyDown}>
      <p id={helpId} className="visually-hidden">
        {editable ? t.plan.help : t.plan.helpReadOnly}
      </p>
      <svg
        ref={svgRef}
        className={["plan-svg", editable && "is-editable", zoomed && "is-zoomed"]
          .filter(Boolean)
          .join(" ")}
        // Keyboard focus lands here when the focused table is removed.
        tabIndex={-1}
        data-plan-canvas=""
        viewBox={`${String(box.x)} ${String(box.y)} ${String(box.width)} ${String(box.height)}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={t.plan.label(zone.name, format.meters(zone.width), format.meters(zone.height))}
        aria-describedby={helpId}
        // Every finger is counted first, before a table takes it, so that two make a pinch.
        onPointerDownCapture={(event) => {
          pressing.current = true;
          follow.current = false;
          if (event.pointerType !== "touch") return;
          // The first finger of a new touch: any finger whose lifting was missed is gone.
          if (event.isPrimary) {
            fingers.current.clear();
            pinch.current = null;
          }
          fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (fingers.current.size === 2) startPinch();
          if (fingers.current.size > 1) event.stopPropagation();
        }}
        onPointerMoveCapture={(event) => {
          if (!fingers.current.has(event.pointerId)) return;
          fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pinch.current) {
            event.stopPropagation();
            movePinch();
          }
        }}
        onPointerUpCapture={(event) => {
          liftFinger(event.pointerId);
        }}
        onPointerCancelCapture={(event) => {
          liftFinger(event.pointerId);
        }}
        onLostPointerCapture={(event) => {
          if (pan.current?.pointerId === event.pointerId) pan.current = null;
        }}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => {
          if (pan.current?.pointerId === event.pointerId) pan.current = null;
          endGesture(event);
          const pressed = tap.current;
          if (pressed?.pointerId !== event.pointerId) return;
          tap.current = null;
          if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 10) onSelect(null);
        }}
        onPointerCancel={(event) => {
          if (pan.current?.pointerId === event.pointerId) pan.current = null;
          // The browser took the touch over to scroll: the table stays selected.
          if (tap.current?.pointerId === event.pointerId) tap.current = null;
          if (gesture.current?.pointerId === event.pointerId) cancelGesture();
        }}
        onPointerDown={(event) => {
          if (pinch.current) return;
          // Zoomed in, dragging the free space moves around the plan; letting go without moving
          // is still a tap that lets go of the table.
          if (zoomed && (event.pointerType !== "mouse" || event.button === 0)) {
            pan.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              center: shown.center,
              unit,
            };
            svgRef.current?.setPointerCapture(event.pointerId);
            // A tap on a table (read-only) keeps it chosen; a tap on the floor lets go.
            const onTable = event.target instanceof Element && event.target.closest(".plan-table");
            tap.current = onTable
              ? null
              : { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
            return;
          }
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
              // Focus from the keyboard or the editor, not from a press on the plan.
              if (!pressing.current) follow.current = true;
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
              seats={t.plan.seats(table.maxSeats)}
              problems={problems.get(table.id) ?? 0}
            />
          ))}
        </g>
      </svg>
      <div className="plan-tools">
        <div className="zoom-controls" role="group" aria-label={t.plan.zoom}>
          <button
            type="button"
            className="button zoom-button"
            aria-label={t.plan.zoomOut}
            title={t.plan.zoomOut}
            // Not `disabled`, so the keyboard focus stays on the button at the end of the range.
            aria-disabled={!zoomed}
            onClick={() => {
              if (zoomed) zoomStep(shown.zoom / ZOOM_STEP);
            }}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M5 10h10" />
            </svg>
          </button>
          <button
            type="button"
            className="button zoom-button"
            aria-label={t.plan.zoomFit}
            title={t.plan.zoomFit}
            aria-disabled={!zoomed}
            onClick={() => {
              if (zoomed) zoomStep(1);
            }}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M3 7.5V3h4.5M12.5 3H17v4.5M17 12.5V17h-4.5M7.5 17H3v-4.5" />
            </svg>
          </button>
          <button
            type="button"
            className="button zoom-button"
            aria-label={t.plan.zoomIn}
            title={t.plan.zoomIn}
            aria-disabled={shown.zoom >= mostZoom}
            onClick={() => {
              if (shown.zoom < mostZoom) zoomStep(shown.zoom * ZOOM_STEP);
            }}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M5 10h10M10 5v10" />
            </svg>
          </button>
        </div>
        {props.tools}
      </div>
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
