import { clamp, type Point } from "./geometry";

/**
 * How the plan is looked at: how far it is zoomed in (1 shows the whole zone, the "fit") and
 * which point of the plan, in centimetres, is in the middle of the screen.
 */
export interface PlanView {
  zoom: number;
  center: Point;
}

/** The part of the plan that the whole zone, with its margin, takes up at zoom 1. */
export interface PlanFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Each step of the buttons and the + and − keys zooms by this much. */
export const ZOOM_STEP = 1.5;
/** Zoomed in as far as it goes, one screen pixel covers this many centimetres. */
export const FINEST_CM_PER_PIXEL = 0.25;

export function fitView(frame: PlanFrame): PlanView {
  return { zoom: 1, center: { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 } };
}

/** The most the plan zooms in, given how many centimetres a pixel covers at zoom 1. */
export function maxZoom(fitUnit: number): number {
  return Math.max(2, fitUnit / FINEST_CM_PER_PIXEL);
}

/**
 * The view kept inside the zone's frame: the zoom between 1 and `max`, and the middle of the
 * screen never so far out that the plan slides out of sight.
 */
export function clampView(view: PlanView, frame: PlanFrame, max: number): PlanView {
  const zoom = clamp(view.zoom, 1, max);
  const halfWidth = frame.width / zoom / 2;
  const halfHeight = frame.height / zoom / 2;
  return {
    zoom,
    center: {
      x: clamp(view.center.x, frame.x + halfWidth, frame.x + frame.width - halfWidth),
      y: clamp(view.center.y, frame.y + halfHeight, frame.y + frame.height - halfHeight),
    },
  };
}

/** The SVG viewBox for a view: the frame shrunk by the zoom, around the view's middle. */
export function viewBox(view: PlanView, frame: PlanFrame): PlanFrame {
  const width = frame.width / view.zoom;
  const height = frame.height / view.zoom;
  return { x: view.center.x - width / 2, y: view.center.y - height / 2, width, height };
}

/**
 * The view at `zoom` that keeps the plan point `anchor` under the same place on screen.
 * `offset` is how far, in screen pixels, that place is from the middle of the plan's box, and
 * `fitUnit` is how many centimetres a pixel covers at zoom 1. Used for the mouse wheel and the
 * pinch (anchor under the pointer or between the fingers) and the buttons (anchor in the middle).
 */
export function zoomAround(anchor: Point, offset: Point, zoom: number, fitUnit: number): PlanView {
  const unit = fitUnit / zoom;
  return { zoom, center: { x: anchor.x - offset.x * unit, y: anchor.y - offset.y * unit } };
}

/** True when `point` lies inside the visible part of the plan, `margin` centimetres in. */
export function isInView(point: Point, box: PlanFrame, margin = 0): boolean {
  return (
    point.x >= box.x + margin &&
    point.x <= box.x + box.width - margin &&
    point.y >= box.y + margin &&
    point.y <= box.y + box.height - margin
  );
}
