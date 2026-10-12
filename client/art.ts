import roleLiberalUrl from './art/role-liberal.webp?url';
import roleFascistUrl from './art/role-fascist.webp?url';
import roleHitlerUrl from './art/role-hitler.webp?url';
import sealLiberalUrl from './art/seal-liberal.webp?url';
import sealFascistUrl from './art/seal-fascist.webp?url';

// HUD <img> sources: the official art files.
const ROLE_URLS = { liberal: roleLiberalUrl, fascist: roleFascistUrl, hitler: roleHitlerUrl };

export function portraitUrl(kind: 'liberal' | 'fascist' | 'hitler'): string {
  return ROLE_URLS[kind];
}

export function sealUrl(party: 'L' | 'F'): string {
  return party === 'L' ? sealLiberalUrl : sealFascistUrl;
}
