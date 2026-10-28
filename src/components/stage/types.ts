export type StageState = "idle" | "listening" | "thinking" | "speaking" | "error";
export type RGB = [number, number, number];

/** Everything a visual needs to draw one frame. */
export type Frame = {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  cx: number;
  cy: number;
  /** base radius of the visual, ~quarter of the shorter side */
  R: number;
  /** seconds (already scaled for reduced motion) */
  t: number;
  /** delta seconds (scaled) */
  dt: number;
  /** performance.now() ms (real time) */
  now: number;
  state: StageState;
  /** 0..1 smoothed audio/activity energy */
  energy: number;
  /** 1 → 0 right after a state change */
  transition: number;
  color: RGB;
  rgba: (a: number, boost?: number) => string;
  reduced: boolean;
};

export interface Visual {
  draw(f: Frame): void;
}
