// Seat colours shared by the patrons and your own first-person arms.
export const COATS = [0x6b2f2a, 0x2f4a6b, 0x4a5a2a, 0x5a3a6b, 0x7a5a2a, 0x2a5a55, 0x6b4a3a, 0x3a3a46, 0x803a50, 0x55602f];
export const SKINS = [0xe0b090, 0xb07a55, 0x8a5a3a, 0xd9a07a, 0x6b4430, 0xf0c8a8, 0xc08860, 0x9a6a48, 0xe6b898, 0x7a4e36];

/** Coat and skin colour for the patron in `seat` (Hitler wears khaki). */
export function seatColors(seat: number, hitler: boolean): { coat: number; skin: number } {
  if (hitler) return { coat: 0x7a6844, skin: 0xe8c4a4 };
  return { coat: COATS[seat % COATS.length], skin: SKINS[(seat * 3) % SKINS.length] };
}
