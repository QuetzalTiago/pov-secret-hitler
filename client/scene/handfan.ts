/** Gap between neighbouring held cards along their own normal (twice the 0.003 card thickness). */
export const HAND_LAYER = 0.006;

/** Signed offset of card i of k along its normal, centred on the hand; higher index sits nearer the viewer. */
export function fanLayer(i: number, k: number): number {
  return (i - (k - 1) / 2) * HAND_LAYER;
}
