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
  /** True while seated at a game: clicking the table captures the mouse. */
  lockable = false;
  /** True while you are choosing a card held in your hand: the mouse is freed to point at it. */
  cardMode: () => boolean = () => false;
  private releasedForCards = false;
  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2(-9, -9);
  private havePointer = false;
  private owners = new Map<THREE.Object3D, string>();
  private objs: THREE.Object3D[] = [];
  private hits: THREE.Intersection[] = [];
  private pickId = '';
  private collect = (c: THREE.Object3D) => {
    if ((c as THREE.Mesh).isMesh && c.visible) {
      this.owners.set(c, this.pickId);
      this.objs.push(c);
    }
  };

  constructor(private world: World, private tooltip: HTMLElement, private crosshair: HTMLElement, private hint: HTMLElement) {
    world.onLockChange = () => this.refreshChrome();
    const canvas = world.renderer.domElement;
    window.addEventListener('pointermove', (e) => {
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      if (this.world.locked) return;
      this.havePointer = true;
      this.tooltip.style.left = `${e.clientX + 16}px`;
      this.tooltip.style.top = `${e.clientY + 14}px`;
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.enabled) return;
      if (this.lockable && !this.cardMode() && this.world.lockAllowed && !this.world.locked) {
        // First click just takes control of the view; it never triggers an action by accident.
        this.world.requestLock();
        return;
      }
      if (!this.world.locked) {
        this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
        this.havePointer = true;
      }
      const id = this.pick(this.world.aimNdc());
      if (id) this.activate(id);
      // Card picked: take the mouse back (still inside the click gesture, so the browser allows it).
      if (this.releasedForCards && this.lockable && !this.cardMode()) {
        this.releasedForCards = false;
        this.world.requestLock();
      }
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
    const { owners, objs, hits } = this;
    owners.clear();
    objs.length = 0;
    hits.length = 0;
    for (const item of this.items.values()) {
      this.pickId = item.id;
      for (const o of item.objects) o.traverse(this.collect);
    }
    this.ray.intersectObjects(objs, false, hits);
    let hit: THREE.Intersection | undefined;
    for (const h of hits) {
      if (isVisible(h.object)) {
        hit = h;
        break;
      }
    }
    return hit ? owners.get(hit.object) ?? null : null;
  }

  /** Called every frame: the camera moves with the mouse, so re-pick continuously. */
  update() {
    const cards = this.lockable && this.cardMode();
    this.world.freezeLook = cards;
    if (cards && this.world.locked) {
      this.releasedForCards = true;
      this.world.releaseLock();
    }
    this.hint.classList.toggle('hidden', this.world.locked || cards || !this.lockable || !this.world.lockAllowed);
    const id = this.enabled && (this.havePointer || this.world.locked) ? this.pick(this.world.aimNdc()) : null;
    if (id !== this.hovered) this.setHovered(id);
  }

  private setHovered(id: string | null) {
    this.hovered = id;
    const item = id ? this.items.get(id) : null;
    this.tooltip.textContent = item?.label ?? '';
    this.tooltip.style.display = item ? 'block' : 'none';
    this.world.renderer.domElement.style.cursor = item ? 'pointer' : 'default';
    this.crosshair.classList.toggle('hot', !!item);
    if (item) sfx.hover();
  }

  /** Shows the crosshair while captured, or a hint inviting a click when not. */
  refreshChrome() {
    const locked = this.world.locked;
    this.crosshair.classList.toggle('hidden', !locked);
    this.hint.classList.toggle('hidden', locked || !this.lockable || !this.world.lockAllowed);
    if (locked) {
      this.tooltip.style.left = `calc(50% + 18px)`;
      this.tooltip.style.top = `calc(50% + 14px)`;
    }
  }

  setLockable(on: boolean) {
    if (this.lockable === on) return;
    this.lockable = on;
    if (!on) this.world.releaseLock();
    this.refreshChrome();
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
