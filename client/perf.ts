import type * as THREE from 'three';

export interface PerfStats {
  fps: number;
  frameMs: number;
  worstMs: number;
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  programs: number;
  geometries: number;
  textures: number;
}

const WINDOW_MS = 500;

/** `?perf` overlay: rolling fps/frame time plus renderer.info counters. tick() runs once per frame after render. */
export function createPerfHud(renderer: THREE.WebGLRenderer) {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;top:8px;right:8px;z-index:1000;pointer-events:none;padding:4px 8px;' +
    'font:11px monospace;white-space:pre;color:#fff;background:rgba(0,0,0,0.6);border-radius:4px';
  document.body.appendChild(el);

  let stats: PerfStats = { fps: 0, frameMs: 0, worstMs: 0, calls: 0, triangles: 0, points: 0, lines: 0, programs: 0, geometries: 0, textures: 0 };
  let prev = 0;
  let windowStart = 0;
  let frames = 0;
  let worst = 0;

  function tick(now: number) {
    if (prev) {
      frames++;
      worst = Math.max(worst, now - prev);
    }
    prev = now;
    if (!windowStart) windowStart = now;
    const elapsed = now - windowStart;
    if (elapsed < WINDOW_MS || !frames) return;
    const info = renderer.info;
    stats = {
      fps: (frames * 1000) / elapsed,
      frameMs: elapsed / frames,
      worstMs: worst,
      calls: info.render.calls,
      triangles: info.render.triangles,
      points: info.render.points,
      lines: info.render.lines,
      programs: info.programs?.length ?? 0,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
    windowStart = now;
    frames = 0;
    worst = 0;
    el.textContent =
      `${stats.fps.toFixed(0)} fps  ${stats.frameMs.toFixed(1)} ms (worst ${stats.worstMs.toFixed(1)})\n` +
      `calls ${stats.calls}  tris ${(stats.triangles / 1000).toFixed(0)}k\n` +
      `prog ${stats.programs}  geo ${stats.geometries}  tex ${stats.textures}`;
  }

  return { tick, stats: () => stats };
}
