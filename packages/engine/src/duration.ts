/**
 * How long a table stays taken. Bigger groups stay longer, so the time depends on party size.
 */

export interface DurationRule {
  /** Largest party this rule covers. */
  upToPartySize: number;
  minutes: number;
}

/** Sample values for a sit-down dinner. Each venue sets its own. */
export const DEFAULT_DURATION_RULES: readonly DurationRule[] = [
  { upToPartySize: 2, minutes: 90 },
  { upToPartySize: 4, minutes: 105 },
  { upToPartySize: 6, minutes: 120 },
  { upToPartySize: 12, minutes: 150 },
];

/**
 * Minutes a party of `partySize` keeps its table, or `null` when no rule covers a party that big
 * (the venue has to handle it by hand, for example as a group booking).
 */
export function durationFor(
  partySize: number,
  rules: readonly DurationRule[] = DEFAULT_DURATION_RULES,
): number | null {
  if (!Number.isInteger(partySize) || partySize < 1) {
    throw new RangeError(`Party size must be a whole number of at least 1, got ${partySize}`);
  }

  const sorted = [...rules].sort((a, b) => a.upToPartySize - b.upToPartySize);
  const rule = sorted.find((candidate) => partySize <= candidate.upToPartySize);
  return rule ? rule.minutes : null;
}

/** The biggest party that can book online: the one the last rule covers. */
export function largestParty(rules: readonly DurationRule[] = DEFAULT_DURATION_RULES): number {
  return Math.max(0, ...rules.map((rule) => rule.upToPartySize));
}
