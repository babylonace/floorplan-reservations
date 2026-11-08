import { describe, expect, it } from "vitest";
import { durationFor, largestParty } from "../src/index.js";

describe("durationFor", () => {
  it("uses the smallest rule that fits the party", () => {
    expect(durationFor(1)).toBe(90);
    expect(durationFor(2)).toBe(90);
    expect(durationFor(3)).toBe(105);
    expect(durationFor(12)).toBe(150);
  });

  it("returns null when no rule covers the party", () => {
    expect(durationFor(13)).toBeNull();
  });

  it("does not depend on the order of the rules", () => {
    const rules = [
      { upToPartySize: 8, minutes: 120 },
      { upToPartySize: 2, minutes: 60 },
    ];
    expect(durationFor(2, rules)).toBe(60);
    expect(durationFor(5, rules)).toBe(120);
  });

  it("rejects party sizes that make no sense", () => {
    expect(() => durationFor(0)).toThrow(RangeError);
    expect(() => durationFor(2.5)).toThrow(RangeError);
  });
});

describe("largestParty", () => {
  it("is the party size the last rule covers", () => {
    expect(largestParty()).toBe(12);
    expect(largestParty([{ upToPartySize: 3, minutes: 60 }])).toBe(3);
    expect(largestParty([])).toBe(0);
  });
});
