/**
 * Two comment lines above, plus this one.
 */
export const a = 1; // trailing comment: this line is code
export const s = "// not a comment";

/* block */ export function f(x: number) {
  return x > 1 ? f(x - 1) : x;
}
