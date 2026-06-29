// The original simulator authors everything in inches and converts via these
// constants. We keep the same convention so positions, sizes and tuning
// numbers translate one-to-one.

export const INCH = 0.0254;
export const FOOT = 0.3048;

/** Detect mobile UA the same way the original does. */
export function isMobileUA(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mobi|Android|iPhone/i.test(navigator.userAgent);
}

/**
 * Smooth value noise (-1..1) used to drive camera wobble and gobo wave. Same
 * formula the source uses, two random samples lerp'd with smoothstep.
 */
export function smoothNoise(t: number, seed: number): number {
  const n = Math.floor(t);
  const r = t - n;
  const hash = (e: number): number => {
    const v = Math.sin((e + seed) * 127.1 + seed * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const a = hash(n) * 2 - 1;
  const b = hash(n + 1) * 2 - 1;
  const s = r * r * (3 - 2 * r);
  return a + (b - a) * s;
}

/**
 * Three-octave hashed sine — used by the procedural log to push verts in/out
 * around the cylinder.
 */
export function woodNoise(theta: number, seed: number): number {
  return (
    Math.sin(theta * 127.1 + seed * 311.7) * 0.5 +
    Math.sin(theta * 269.5 + seed * 183.3) * 0.3 +
    Math.sin(theta * 419.2 + seed * 77.9) * 0.2
  );
}
