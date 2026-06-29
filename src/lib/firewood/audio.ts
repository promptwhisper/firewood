// Lightweight audio pool layered on top of HTMLAudioElement.
// Three pools (split, splitb, stack) plus single-shot drop and looping bg.

import { ASSETS } from "./assets";

type Pool = HTMLAudioElement[];

function clonePool(srcs: readonly string[], voicesPerSrc = 2): Pool {
  const out: Pool = [];
  for (const src of srcs) {
    for (let i = 0; i < voicesPerSrc; i++) {
      const a = new Audio(src);
      a.preload = "auto";
      a.crossOrigin = "anonymous";
      out.push(a);
    }
  }
  return out;
}

export class AudioBus {
  private bg: HTMLAudioElement;
  private drop: Pool;
  private split: Pool;
  private splitb: Pool;
  private stack: Pool;
  private campfire: HTMLAudioElement;
  private unlocked = false;
  private masterGain = 0.85;

  constructor() {
    this.bg = new Audio(ASSETS.sounds.bg);
    this.bg.loop = true;
    this.bg.preload = "auto";
    this.bg.volume = 0.18;

    this.drop = clonePool([ASSETS.sounds.drop], 4);
    this.split = clonePool(ASSETS.sounds.split, 2);
    this.splitb = clonePool(ASSETS.sounds.splitb, 2);
    this.stack = clonePool(ASSETS.sounds.stack, 2);
    this.campfire = new Audio(ASSETS.sounds.campfire);
    this.campfire.loop = true;
    this.campfire.preload = "auto";
    this.campfire.volume = 0;
  }

  /** Resume / start the background music after the first user gesture. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    void this.bg.play().catch(() => {
      // Autoplay still blocked — try again on next gesture.
      this.unlocked = false;
    });
    void this.campfire.play().catch(() => undefined);
  }

  setMaster(volume: number): void {
    this.masterGain = Math.max(0, Math.min(1, volume));
  }

  /** Pick a free voice in the pool (or recycle the oldest). */
  private grab(pool: Pool): HTMLAudioElement {
    for (const a of pool) {
      if (a.paused || a.ended) return a;
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private play(pool: Pool, volume: number, pitchJitter = 0): void {
    const a = this.grab(pool);
    try {
      a.currentTime = 0;
    } catch {
      /* some browsers throw if not yet loaded */
    }
    a.volume = Math.max(0, Math.min(1, volume * this.masterGain));
    if (pitchJitter !== 0 && "playbackRate" in a) {
      a.playbackRate = 1 + (Math.random() * 2 - 1) * pitchJitter;
    }
    void a.play().catch(() => undefined);
  }

  playDrop(volume = 0.7): void {
    this.play(this.drop, volume, 0.04);
  }

  playSplit(sharpCrack = false, volume = 0.85): void {
    this.play(sharpCrack ? this.splitb : this.split, volume, 0.05);
  }

  playStack(volume = 0.6): void {
    this.play(this.stack, volume, 0.06);
  }

  setCampfireLevel(level: number): void {
    const heat = Math.max(0, Math.min(1, level));
    this.campfire.volume = (heat > 0.02 ? 0.08 + heat * 0.46 : 0) * this.masterGain;
    if ("playbackRate" in this.campfire) {
      this.campfire.playbackRate = 0.92 + heat * 0.18;
    }
  }

  dispose(): void {
    this.bg.pause();
    this.bg.src = "";
    this.campfire.pause();
    this.campfire.src = "";
    for (const pool of [this.drop, this.split, this.splitb, this.stack]) {
      for (const a of pool) {
        a.pause();
        a.src = "";
      }
    }
  }
}
