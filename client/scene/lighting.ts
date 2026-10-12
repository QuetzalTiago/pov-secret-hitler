/** Every light level for the night bar in one place, so the darkness is tuned here (todo #248). */
export const LIGHTING = {
  /** ACES tone mapping exposure. */
  exposure: 0.62,
  /** HDRI image-based light (scene.environmentIntensity): kept faint so the pendant lamp is the key light. */
  env: 0.04,
  /** Hemisphere ambient before the night dimming. */
  ambient: 0.08,
  /** Warm fill point light before the lit factor. */
  fill: 1.0,
  /**
   * Pendant lamp spot over the table, and the light the patrons are seen by. From 2.55 m up, seated heads sit
   * 53-63 degrees off its axis (chests ~57), so the cone is wide with a short penumbra to keep them inside the
   * bright part; the 4.5 m reach stops it there, so the walls and far floor stay dark.
   */
  lamp: { intensity: 90, distance: 4.5, angle: Math.PI / 2.5, penumbra: 0.3, decay: 1.6 },
  /** Point light under the bar sign. */
  neon: 0.4,
  /** Spot on the waiter. */
  waiterSpot: 5,
  /** Post-process vignette darkness. */
  vignette: 0.7,
} as const;

/** Material colour multiplied over printed art (cards, placards, board) so bright official paper reads as aged stock under the lamp, not glowing white. */
export const PRINT_TINT = 0xc4baa8;
/** Wall posters sit far from the lamp: aged paper in shadow. */
export const POSTER_TINT = 0x8a8070;
