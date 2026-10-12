// Private suspicion marks for the current game: client-only, kept in sessionStorage per room code.
import type { Mark } from './hudmodel';

const key = (code: string) => `sh-marks:${code}`;

export function loadMarks(code: string): Record<number, Mark> {
  const out: Record<number, Mark> = {};
  try {
    const raw = JSON.parse(sessionStorage.getItem(key(code)) ?? '{}');
    if (raw && typeof raw === 'object') {
      for (const [seat, m] of Object.entries(raw)) {
        if (m === '?' || m === 'L' || m === 'F') out[Number(seat)] = m;
      }
    }
  } catch {
    /* storage unavailable */
  }
  return out;
}

export function saveMarks(code: string, marks: Record<number, Mark>): void {
  try {
    const clean: Record<number, Mark> = {};
    for (const [seat, m] of Object.entries(marks)) if (m) clean[Number(seat)] = m;
    sessionStorage.setItem(key(code), JSON.stringify(clean));
  } catch {
    /* storage unavailable */
  }
}
