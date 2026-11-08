import { describe, expect, it } from "vitest";
import {
  clampView,
  fitView,
  isInView,
  maxZoom,
  viewBox,
  zoomAround,
  type PlanFrame,
} from "../src/plan/view";

// A 12 × 8 m zone with a 1 m margin all round, as the plan draws it at zoom 1.
const frame: PlanFrame = { x: -100, y: -100, width: 1400, height: 1000 };

describe("plan view", () => {
  it("shows the whole zone at zoom 1", () => {
    const view = fitView(frame);
    expect(view).toEqual({ zoom: 1, center: { x: 600, y: 400 } });
    expect(viewBox(view, frame)).toEqual(frame);
  });

  it("zooms in around a point that stays where it was on screen", () => {
    // 2 cm per pixel at zoom 1; the pointer is 100 px right of and 50 px above the middle.
    const fitUnit = 2;
    const start = fitView(frame);
    const offset = { x: 100, y: -50 };
    const anchor = {
      x: start.center.x + offset.x * fitUnit,
      y: start.center.y + offset.y * fitUnit,
    };
    const zoomed = zoomAround(anchor, offset, 2, fitUnit);
    expect(zoomed.zoom).toBe(2);
    // The same point of the plan is still 100 px right and 50 px up from the middle.
    expect((anchor.x - zoomed.center.x) / (fitUnit / 2)).toBeCloseTo(100);
    expect((anchor.y - zoomed.center.y) / (fitUnit / 2)).toBeCloseTo(-50);
    expect(viewBox(zoomed, frame)).toEqual({ x: 350, y: 100, width: 700, height: 500 });
  });

  it("never zooms out past the whole zone, nor in past the finest step", () => {
    expect(clampView({ zoom: 0.4, center: { x: 0, y: 0 } }, frame, 8)).toEqual(fitView(frame));
    expect(clampView({ zoom: 50, center: { x: 600, y: 400 } }, frame, 8).zoom).toBe(8);
    expect(maxZoom(2)).toBe(8);
    // A small zone still zooms in at least twice.
    expect(maxZoom(0.3)).toBe(2);
  });

  it("keeps the plan in sight when panning far away", () => {
    const far = clampView({ zoom: 2, center: { x: 99_999, y: -99_999 } }, frame, 8);
    const box = viewBox(far, frame);
    expect(box.x + box.width).toBe(frame.x + frame.width);
    expect(box.y).toBe(frame.y);
  });

  it("says whether a point is in sight", () => {
    const box = viewBox({ zoom: 2, center: { x: 600, y: 400 } }, frame);
    expect(isInView({ x: 600, y: 400 }, box)).toBe(true);
    expect(isInView({ x: 1200, y: 400 }, box)).toBe(false);
    expect(isInView({ x: 940, y: 400 }, box, 30)).toBe(false);
  });
});
