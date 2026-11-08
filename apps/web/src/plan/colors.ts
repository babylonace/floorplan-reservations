/**
 * Table colours. The API keeps them in the table's `style` as `{ color: "#rrggbb" }`; the booking
 * engine ignores them. Any other key in `style` is kept as it is.
 */

export const TABLE_COLORS = [
  { id: "linen", hex: "#e6dcc6" },
  { id: "oak", hex: "#c9a46b" },
  { id: "walnut", hex: "#8a5a3b" },
  { id: "sage", hex: "#93a98f" },
  { id: "slate", hex: "#66757c" },
] as const;

export type TableColorId = (typeof TABLE_COLORS)[number]["id"];

export const DEFAULT_TABLE_COLOR = TABLE_COLORS[0].hex;

const HEX = /^#[0-9a-f]{6}$/i;

/** The table's colour when it has a valid one, otherwise the default. */
export function tableColor(style: Record<string, unknown>): string {
  const color = style.color;
  return typeof color === "string" && HEX.test(color) ? color.toLowerCase() : DEFAULT_TABLE_COLOR;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

export const INK = "#17211e";
export const WHITE = "#ffffff";

/** Ink or white, whichever reads better on `background`. */
export function textOn(background: string): string {
  return contrastRatio(background, INK) >= contrastRatio(background, WHITE) ? INK : WHITE;
}
