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
  /** Pendant lamp spot over the table. */
  lamp: { intensity: 60, distance: 6, angle: Math.PI / 3.8, penumbra: 0.55, decay: 1.6 },
  /** Point light under the bar sign. */
  neon: 0.4,
  /** Spot on the waiter. */
  waiterSpot: 5,
  /** Post-process vignette darkness. */
  vignette: 0.7,
  /**
   * Patrons only: a warm Fresnel rim on their silhouettes and a small self-lift of their own colours, so the
   * figures read against the dark room without brightening the room itself.
   */
  patronRim: { color: 0xffb47a, strength: 0.22, power: 2.6 },
  patronLift: 0.05,
} as const;

/** Material colour multiplied over printed art (cards, placards, board) so bright official paper reads as aged stock under the lamp, not glowing white. */
export const PRINT_TINT = 0xc4baa8;
/** Wall posters sit far from the lamp: aged paper in shadow. */
export const POSTER_TINT = 0x8a8070;
