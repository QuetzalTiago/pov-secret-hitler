// Raycast hover + click on registered objects, with a tooltip near the cursor.
import * as THREE from 'three';
import { sfx } from './audio';
import type { World } from './scene/world';

export interface Interactable {
  id: string;
  objects: THREE.Object3D[];
  label: string;
  onClick: () => void;
  /** True when clicking sends a game action (used by tests to find moves). */
  action: boolean;
}

export class Interactor {
  items = new Map<string, Interactable>();
  hovered: string | null = null;
  enabled = true;
  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2(-9, -9);
  private havePointer = false;

  constructor(private world: World, private tooltip: HTMLElement) {
    const canvas = world.renderer.domElement;
    window.addEventListener('pointermove', (e) => {
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.havePointer = true;
      this.tooltip.style.left = `${e.clientX + 16}px`;
      this.tooltip.style.top = `${e.clientY + 14}px`;
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.enabled) return;
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.havePointer = true;
      const id = this.pick();
      if (id) this.activate(id);
    });
  }

  set(list: Interactable[]) {
    this.items = new Map(list.map((i) => [i.id, i]));
    if (this.hovered && !this.items.has(this.hovered)) this.setHovered(null);
  }

  activate(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    sfx.click();
    item.onClick();
    return true;
  }

  pick(at: THREE.Vector2 = this.pointer): string | null {
    if (this.items.size === 0) return null;
    this.world.camera.updateMatrixWorld();
    this.ray.setFromCamera(at, this.world.camera);
    const owners = new Map<THREE.Object3D, string>();
    const objs: THREE.Object3D[] = [];
    for (const item of this.items.values()) {
      for (const o of item.objects) {
        o.traverse((c) => {
          if ((c as THREE.Mesh).isMesh && c.visible) {
            owners.set(c, item.id);
            objs.push(c);
          }
        });
      }
    }
    const hit = this.ray.intersectObjects(objs, false).find((h) => isVisible(h.object));
    return hit ? owners.get(hit.object) ?? null : null;
  }

  /** Called every frame: the camera moves with the mouse, so re-pick continuously. */
  update() {
    const id = this.enabled && this.havePointer ? this.pick() : null;
    if (id !== this.hovered) this.setHovered(id);
  }

  private setHovered(id: string | null) {
    this.hovered = id;
    const item = id ? this.items.get(id) : null;
    this.tooltip.textContent = item?.label ?? '';
    this.tooltip.style.display = item ? 'block' : 'none';
    this.world.renderer.domElement.style.cursor = item ? 'pointer' : 'default';
    if (item) sfx.hover();
  }

  /** Screen-space pixel position of an interactable's centre (for tests). */
  screenPos(id: string): { x: number; y: number } | null {
    const item = this.items.get(id);
    if (!item) return null;
    const box = new THREE.Box3();
    for (const o of item.objects) box.expandByObject(o);
    if (box.isEmpty()) return null;
    const c = box.getCenter(new THREE.Vector3()).project(this.world.camera);
    if (c.z > 1 || Math.abs(c.x) > 1 || Math.abs(c.y) > 1) return null;
    return { x: ((c.x + 1) / 2) * window.innerWidth, y: ((1 - c.y) / 2) * window.innerHeight };
  }
}

function isVisible(o: THREE.Object3D | null): boolean {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
