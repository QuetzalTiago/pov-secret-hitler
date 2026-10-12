import { describe, expect, it } from 'vitest';
import { COATS, SKINS, seatColors } from '../client/scene/palette';

describe('seatColors', () => {
  it('uses the seat coat and skin', () => {
    expect(seatColors(0, false)).toEqual({ coat: COATS[0], skin: SKINS[0] });
    expect(seatColors(3, false).skin).toBe(SKINS[9]);
  });
  it('wraps seats past the palette', () => {
    expect(seatColors(12, false).coat).toBe(COATS[2]);
  });
  it('gives Hitler the khaki coat and his skin', () => {
    expect(seatColors(4, true)).toEqual({ coat: 0x7a6844, skin: 0xe8c4a4 });
  });
});
