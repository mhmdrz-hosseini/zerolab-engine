/** A cubic centimetre and a millilitre are the same volume. */
export function cm3ToMl(volumeCm3: number): number {
  if (!Number.isFinite(volumeCm3) || volumeCm3 < 0) throw new Error('material volume must be finite and nonnegative');
  return volumeCm3;
}
