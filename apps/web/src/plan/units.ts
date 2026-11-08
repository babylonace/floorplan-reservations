/**
 * Lengths as people type them. The API keeps whole centimetres; the editor shows and takes
 * metres, written the way the language writes decimals (1,2 in Spanish, 1.2 in English).
 */

/**
 * What someone typed in a metre field, in whole centimetres, or null when it is not a number.
 * Both a comma and a point work as the decimal mark, whatever the language, so "1,2" and "1.2"
 * are both 120 cm. A trailing "m" is fine. Thousands separators are not accepted: nobody types
 * a thousand metres, and "1.200" would otherwise be ambiguous.
 */
export function parseMetres(text: string): number | null {
  const match = /^\s*([-−]?)\s*(\d*)(?:[.,](\d*))?\s*m?\s*$/i.exec(text);
  if (!match) return null;
  const [, sign = "", whole = "", fraction = ""] = match;
  if (whole === "" && fraction === "") return null;
  if (whole.length > 9) return null;
  // Worked out on the digits, so 1,005 m is 101 cm and not 100 because of binary fractions.
  const digits = `${fraction}000`;
  const cm =
    Number(whole || "0") * 100 + Number(digits.slice(0, 2)) + (Number(digits[2]) >= 5 ? 1 : 0);
  return sign && cm !== 0 ? -cm : cm;
}
