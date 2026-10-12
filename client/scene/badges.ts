// Name tag, speech bubble and night team-glow sprites shared by the procedural and the rigged patron.
import * as THREE from 'three';
import { COLORS, glowTexture, textSprite } from './textures';

export interface BadgeHeights {
  /** Local y of the name tag. */
  tag: number;
  /** Local y of the bottom of a speech bubble. */
  bubble: number;
  glow: THREE.Vector3;
  glowScale: number;
}

export class PatronBadges {
  readonly tag: THREE.Sprite;
  readonly glow: THREE.Sprite;
  /** 0..1, eased toward the target set by setGlow. */
  glowAmt = 0;
  private glowTarget = 0;
  private tagText = '';
  private bubble: THREE.Sprite | null = null;
  private bubbleUntil = 0;

  constructor(private parent: THREE.Object3D, private heights: BadgeHeights) {
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
    this.tag.position.y = heights.tag;
    this.tag.renderOrder = 10;
    parent.add(this.tag);

    // Fake night team glow: sprite aura plus emissive tint, no real light (lights force shader recompiles).
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,40,20'), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    this.glow.position.copy(heights.glow);
    this.glow.scale.setScalar(heights.glowScale);
    this.glow.renderOrder = 1;
    this.glow.visible = false;
    parent.add(this.glow);
  }

  setLabel(text: string, color: string = COLORS.line) {
    const key = text + color;
    if (key === this.tagText) return;
    this.tagText = key;
    const old = this.tag.material.map;
    const { texture, aspect } = textSprite(text, { color, bg: 'rgba(20,17,15,0.85)', size: 34, border: 'rgba(184,145,63,0.6)' });
    this.tag.material.map = texture;
    this.tag.material.needsUpdate = true;
    this.tag.scale.set(0.16 * aspect, 0.16, 1);
    old?.dispose();
  }

  say(text: string, now: number) {
    this.dropBubble();
    const { texture, aspect } = textSprite(text, { color: COLORS.line, bg: 'rgba(20,17,15,0.92)', size: 30, maxWidth: 440, border: 'rgba(184,145,63,0.6)' });
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    const h = 0.12 * (texture.image.height / 50);
    this.bubble.scale.set(h * aspect, h, 1);
    this.bubble.position.y = this.heights.bubble + h / 2;
    this.bubble.renderOrder = 11;
    this.parent.add(this.bubble);
    this.bubbleUntil = now + 5 + text.length * 0.04;
  }

  /** A bubble is up and not yet fading out (the mouth flaps meanwhile). */
  talking(now: number): boolean {
    return this.bubble !== null && this.bubbleUntil - now > 1;
  }

  setGlow(on: boolean) {
    this.glowTarget = on ? 1 : 0;
  }

  update(dt: number, now: number, dead: boolean) {
    this.glowAmt += (this.glowTarget - this.glowAmt) * (1 - Math.exp(-4 * dt));
    this.glow.material.opacity = this.glowAmt * 0.75;
    this.glow.visible = this.glow.material.opacity > 0.01;
    this.tag.material.opacity = dead ? 0.5 : 1;
    if (this.bubble) {
      const left = this.bubbleUntil - now;
      this.bubble.material.opacity = Math.max(0, Math.min(1, left));
      if (left <= 0) this.dropBubble();
    }
  }

  private dropBubble() {
    if (!this.bubble) return;
    this.parent.remove(this.bubble);
    this.bubble.material.map?.dispose();
    this.bubble.material.dispose();
    this.bubble = null;
  }
}
