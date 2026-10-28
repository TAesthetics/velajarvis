import type { Frame, Visual } from "./types";

/**
 * The Thronglets: many small glowing creatures with eyes. They multiply: when the
 * population grows, an existing creature visibly splits and a newborn pops out.
 */

type Creature = {
  a: number;
  r: number;
  speed: number;
  phase: number;
  size: number;
  tint: number;
  blinkAt: number;
  x: number;
  y: number;
  /** ms timestamp of birth (0 = existed from the start) */
  bornAt: number;
  /** ms timestamp of the last time this creature split */
  splitAt: number;
  splitAngle: number;
};

type Burst = { x: number; y: number; at: number };

const BIRTH_MS = 900;
const BIRTH_STAGGER_MS = 260;

const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

function makeCreature(now: number, parent?: Creature): Creature {
  const base: Creature = {
    a: Math.random() * Math.PI * 2,
    r: 0.22 + Math.pow(Math.random(), 0.7) * 1.25,
    speed: (0.15 + Math.random() * 0.35) * (Math.random() < 0.8 ? 1 : -1),
    phase: Math.random() * Math.PI * 2,
    size: 0.65 + Math.random() * 0.65,
    tint: (Math.random() - 0.5) * 60,
    blinkAt: now + Math.random() * 6000,
    x: 0,
    y: 0,
    bornAt: 0,
    splitAt: 0,
    splitAngle: 0,
  };
  if (parent) {
    base.a = parent.a + (Math.random() - 0.5) * 0.4;
    base.r = Math.max(0.2, Math.min(1.5, parent.r + (Math.random() - 0.5) * 0.25));
    base.x = parent.x;
    base.y = parent.y;
    base.tint = parent.tint + (Math.random() - 0.5) * 18; // tiny mutation per generation
    base.speed = parent.speed * (0.9 + Math.random() * 0.2);
    base.bornAt = now;
    base.size = Math.max(0.55, Math.min(1.35, parent.size + (Math.random() - 0.5) * 0.2));
    parent.splitAt = now;
    parent.splitAngle = Math.random() * Math.PI;
  }
  return base;
}

export type ThrongVisual = Visual & { setPopulation(n: number): void };

export function createThrongSwarm(initial: number): ThrongVisual {
  let target = initial;
  let lastBirth = 0;
  const creatures: Creature[] = [];
  const bursts: Burst[] = [];
  let sprite: HTMLCanvasElement | null = null;
  let spriteKey = "";

  const glowSprite = (f: Frame) => {
    const key = f.color.map((c) => Math.round(c / 8)).join(",");
    if (sprite && key === spriteKey) return sprite;
    spriteKey = key;
    sprite = sprite ?? document.createElement("canvas");
    sprite.width = sprite.height = 64;
    const c = sprite.getContext("2d")!;
    c.clearRect(0, 0, 64, 64);
    const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, f.rgba(0.55));
    gr.addColorStop(1, f.rgba(0));
    c.fillStyle = gr;
    c.fillRect(0, 0, 64, 64);
    return sprite;
  };

  return {
    setPopulation(n) {
      target = Math.max(0, Math.round(n));
    },
    draw(f) {
      const { ctx, cx, cy, R, t, dt, now, state, energy, rgba, reduced } = f;

      // initial fill without birth animation, later growth = visible births
      if (creatures.length === 0) for (let i = 0; i < target; i++) creatures.push(makeCreature(now));
      if (creatures.length < target && now - lastBirth > BIRTH_STAGGER_MS) {
        const adults = creatures.filter((c) => now - c.bornAt > BIRTH_MS);
        const parent = adults[Math.floor(Math.random() * adults.length)] ?? creatures[0];
        const child = makeCreature(now, parent);
        creatures.push(child);
        bursts.push({ x: parent.x, y: parent.y, at: now });
        lastBirth = now;
      }
      if (creatures.length > target) creatures.splice(target);

      const n = creatures.length;
      const crowd = Math.max(0.55, Math.min(1.15, Math.sqrt(48 / Math.max(1, n))));
      const spread = 1 + Math.min(0.35, n / 400);
      const swirl = state === "thinking" ? 3.2 : state === "listening" ? 0.6 : state === "speaking" ? 1.2 : 0.45;
      const gather = state === "listening" ? 0.82 : state === "thinking" ? 0.95 : 1;
      const breathe = 1 + Math.sin(t * 1.2) * 0.025;
      const unit = R / 120;

      // nest glow
      const nestR = R * (1 + energy * 0.4) * spread;
      const nest = ctx.createRadialGradient(cx, cy, 0, cx, cy, nestR);
      nest.addColorStop(0, rgba(0.32 + energy * 0.3, 40));
      nest.addColorStop(1, rgba(0));
      ctx.fillStyle = nest;
      ctx.beginPath();
      ctx.arc(cx, cy, nestR, 0, Math.PI * 2);
      ctx.fill();

      for (const c of creatures) {
        c.a += dt * c.speed * swirl;
        const wob = Math.sin(t * 1.7 + c.phase) * 0.08 + Math.sin(t * 0.6 + c.phase * 2) * 0.05;
        const bounce = state === "speaking" ? energy * 0.25 * Math.abs(Math.sin(t * 7 + c.phase)) : energy * 0.1;
        const rr = R * spread * gather * breathe * (c.r + wob + bounce);
        const tx = cx + Math.cos(c.a) * rr;
        const ty = cy + Math.sin(c.a) * rr * 0.86;
        if (c.x === 0 && c.y === 0) {
          c.x = tx;
          c.y = ty;
        }
        const follow = c.bornAt && now - c.bornAt < BIRTH_MS ? 1.6 : 5; // newborns drift away from the parent
        c.x += (tx - c.x) * Math.min(1, dt * follow);
        c.y += (ty - c.y) * Math.min(1, dt * follow);
      }

      // hive links (squared distance, cheap enough for the cap)
      ctx.lineWidth = 0.7;
      const linkD = R * 0.36;
      const linkD2 = linkD * linkD;
      for (let i = 0; i < n; i++) {
        const a = creatures[i];
        for (let j = i + 1; j < n; j++) {
          const b = creatures[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < linkD2) {
            ctx.strokeStyle = rgba((1 - Math.sqrt(d2) / linkD) * (0.1 + energy * 0.22), 30);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // birth bursts: expanding ring + sparkles
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        const k = (now - b.at) / BIRTH_MS;
        if (k >= 1) {
          bursts.splice(i, 1);
          continue;
        }
        ctx.strokeStyle = rgba(0.7 * (1 - k), 120);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(b.x, b.y, unit * (6 + k * 34), 0, Math.PI * 2);
        ctx.stroke();
        if (!reduced) {
          for (let s = 0; s < 6; s++) {
            const ang = (s / 6) * Math.PI * 2 + b.at;
            const d = unit * (8 + k * 28);
            ctx.fillStyle = rgba(0.9 * (1 - k), 150);
            ctx.beginPath();
            ctx.arc(b.x + Math.cos(ang) * d, b.y + Math.sin(ang) * d, unit * 1.6 * (1 - k), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // creatures
      const spr = glowSprite(f);
      for (const c of creatures) {
        const age = c.bornAt ? (now - c.bornAt) / BIRTH_MS : 1;
        const grow = age >= 1 ? 1 : reduced ? age : Math.max(0, easeOutBack(age));
        const s = unit * 7 * c.size * crowd * (1 + energy * 0.35) * grow;
        if (s <= 0.2) continue;
        const sk = (now - c.splitAt) / BIRTH_MS;
        const split = c.splitAt && sk < 1 && !reduced ? Math.sin(sk * Math.PI) * 0.45 : 0; // parent stretches while dividing
        const squish = 1 + Math.sin(t * 4 + c.phase) * 0.06;

        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(spr, c.x - s * 2.8, c.y - s * 2.8, s * 5.6, s * 5.6);
        ctx.globalCompositeOperation = "source-over";
        const r0 = Math.min(255, Math.max(0, f.color[0] + c.tint));
        const g0 = Math.min(255, Math.max(0, f.color[1] + c.tint * 0.5));
        ctx.fillStyle = `rgba(${r0 | 0},${g0 | 0},${f.color[2] | 0},0.95)`;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, s * squish * (1 + split), (s / squish) * (1 - split * 0.4), c.splitAngle * (split ? 1 : 0), 0, Math.PI * 2);
        ctx.fill();

        // eyes that look at you
        if (now > c.blinkAt + 160) c.blinkAt = now + 2500 + Math.random() * 7000;
        const blinking = now > c.blinkAt || age < 0.35; // newborns open their eyes a moment later
        const eh = blinking ? s * 0.05 : s * 0.22;
        const look = state === "listening" ? 0.25 : 0.12;
        ctx.fillStyle = "rgba(20,10,25,0.9)";
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(c.x + side * s * 0.36, c.y - s * 0.05 + s * look, s * 0.14, eh, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = "lighter";
    },
  };
}
