import type { Visual } from "./types";

/**
 * J.A.R.V.I.S. as ONE presence: an elegant holographic head-and-shoulders bust,
 * built from glowing contour lines on a pseudo-3D surface. Eyes blink, the mouth
 * moves with the voice, the head turns toward you when listening.
 */

const ROWS = 28;
const COLS = 56;
const MERIDIANS = 14;

/** Half-width of the head at height y (-1 crown … 1 chin), in head units. */
function headRadius(y: number) {
  if (y <= -1 || y >= 1) return 0;
  const crown = Math.sqrt(1 - y * y);
  const jaw = y > 0.1 ? 1 - Math.pow((y - 0.1) / 0.9, 1.5) * 0.5 : 1;
  const temple = 1 - 0.06 * Math.exp(-(((y + 0.05) / 0.18) ** 2));
  return 0.74 * crown * jaw * temple;
}

const g = (x: number, s: number) => Math.exp(-((x / s) ** 2));

/** Point on the face surface. u: angle around the vertical axis (0 = facing viewer). */
function surface(u: number, y: number): [number, number, number] {
  const r = headRadius(y);
  let x = Math.sin(u) * r;
  let z = Math.cos(u) * r * 1.08;
  const front = Math.max(0, Math.cos(u));
  // facial relief (only on the front)
  let dz = 0;
  dz += 0.17 * g(u, 0.16) * g(y - 0.28, 0.2) * (y < 0.42 ? 1 : 0.3); // nose
  dz -= 0.07 * g(Math.abs(u) - 0.36, 0.13) * g(y + 0.02, 0.1); // eye sockets
  dz += 0.05 * g(y + 0.15, 0.06) * g(u, 0.6); // brow ridge
  dz += 0.045 * g(y - 0.58, 0.06) * g(u, 0.32); // lips
  dz += 0.05 * g(y - 0.86, 0.08) * g(u, 0.3); // chin
  dz += 0.035 * g(Math.abs(u) - 0.55, 0.12) * g(y - 0.3, 0.12); // cheekbones
  z += dz * front;
  x *= 1 + 0.04 * front * g(y - 0.3, 0.15);
  return [x, y, z];
}

type Proj = { x: number; y: number; z: number };

export function createJarvisFigure(): Visual {
  let yaw = 0;
  let pitch = 0;
  let blinkAt = 2500;
  let glitchAt = 4000;
  const orbit = Array.from({ length: 18 }, (_, i) => ({ a: (i / 18) * Math.PI * 2, r: 1.35 + (i % 3) * 0.12, s: 0.6 + (i % 5) * 0.15 }));

  return {
    draw(f) {
      const { ctx, cx, cy, R, t, dt, now, state, energy, rgba, reduced } = f;
      const unit = R * 0.98;
      const headCy = cy - unit * 0.42;

      // Pose: idle sway, face the viewer while listening, look up while thinking, nod while speaking
      const swayAmp = reduced ? 0.08 : 0.38;
      const targetYaw =
        state === "listening" ? Math.sin(t * 0.7) * 0.05 : state === "thinking" ? 0.3 + Math.sin(t * 0.5) * 0.15 : Math.sin(t * 0.33) * swayAmp;
      const targetPitch =
        state === "thinking" ? -0.14 : state === "listening" ? 0.06 : state === "speaking" ? Math.sin(t * 5.5) * 0.035 * (0.4 + energy) : Math.sin(t * 0.5) * 0.03;
      yaw += (targetYaw - yaw) * Math.min(1, dt * 2.2);
      pitch += (targetPitch - pitch) * Math.min(1, dt * 3);
      const breathe = 1 + Math.sin(t * 1.3) * 0.012 + energy * 0.02;

      const cyw = Math.cos(yaw);
      const syw = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const project = (x: number, y: number, z: number): Proj => {
        const x1 = x * cyw + z * syw;
        const z1 = -x * syw + z * cyw;
        const y2 = y * cp - z1 * sp;
        const z2 = y * sp + z1 * cp;
        const k = 3.4 / (3.4 - z2);
        return { x: cx + x1 * unit * k * breathe, y: headCy + y2 * unit * k * breathe, z: z2 };
      };

      // glitch band (hologram flicker)
      let glitchY = -1;
      if (!reduced) {
        if (now > glitchAt + 120) glitchAt = now + 3000 + Math.random() * 6000;
        if (now > glitchAt) glitchY = (Math.sin(glitchAt) * 0.5 + 0.5) * 2 - 1;
      }
      const scanY = ((t * (state === "thinking" ? 0.9 : 0.28)) % 1.6) * 2 - 1.3; // moving scan band

      // Presence glow behind the head
      const glow = ctx.createRadialGradient(cx, headCy, unit * 0.1, cx, headCy, unit * 1.5);
      glow.addColorStop(0, rgba(0.22 + energy * 0.2, 20));
      glow.addColorStop(1, rgba(0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, headCy, unit * 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Shoulders & neck (drawn first, behind the head)
      ctx.lineCap = "round";
      for (let k = 0; k < 4; k++) {
        const off = k * 0.07;
        ctx.strokeStyle = rgba(0.38 - k * 0.07, 30);
        ctx.lineWidth = 1.3 - k * 0.2;
        ctx.beginPath();
        for (const side of [-1, 1]) {
          const a = project(side * (0.3 + off * 0.3), 0.9 + off * 0.4, -0.1);
          const b = project(side * (0.34 + off * 0.5), 1.28 + off, -0.05);
          const c = project(side * (1.05 + off), 1.42 + off * 0.6, -0.2);
          const d = project(side * (1.5 + off * 0.5), 2.05, -0.25);
          ctx.moveTo(a.x, a.y);
          ctx.bezierCurveTo(b.x, b.y, c.x, c.y, d.x, d.y);
        }
        ctx.stroke();
      }
      // collar / chest lines
      ctx.strokeStyle = rgba(0.18, 30);
      ctx.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        const p0 = project(-0.95 + k * 0.1, 1.6 + k * 0.14, 0);
        const p1 = project(0, 1.75 + k * 0.14, 0.18);
        const p2 = project(0.95 - k * 0.1, 1.6 + k * 0.14, 0);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
        ctx.stroke();
      }

      // Horizontal contour rings of the head
      const back = new Path2D();
      ctx.lineWidth = 1;
      for (let i = 0; i < ROWS; i++) {
        const y = -0.97 + (i / (ROWS - 1)) * 1.94;
        const scanBoost = Math.max(0, 1 - Math.abs(y - scanY) / 0.18);
        const glitchOff = glitchY > -1 && Math.abs(y - glitchY) < 0.12 ? unit * 0.05 : 0;
        const front = new Path2D();
        let prev: Proj | null = null;
        for (let j = 0; j <= COLS; j++) {
          const u = -Math.PI + (j / COLS) * Math.PI * 2;
          const [x, yy, z] = surface(u, y);
          const p = project(x, yy, z);
          p.x += glitchOff;
          if (prev) {
            const target = (prev.z + p.z) / 2 > -0.05 ? front : back;
            target.moveTo(prev.x, prev.y);
            target.lineTo(p.x, p.y);
          }
          prev = p;
        }
        ctx.strokeStyle = rgba(0.42 + scanBoost * 0.5 + energy * 0.15, 60 + scanBoost * 80);
        ctx.stroke(front);
      }
      // Vertical meridians
      for (let m = 0; m < MERIDIANS; m++) {
        const u = -Math.PI + (m / MERIDIANS) * Math.PI * 2 + 0.11;
        const front = new Path2D();
        let prev: Proj | null = null;
        for (let i = 0; i <= 30; i++) {
          const y = -0.99 + (i / 30) * 1.98;
          const [x, yy, z] = surface(u, y);
          const p = project(x, yy, z);
          if (prev) {
            const target = (prev.z + p.z) / 2 > -0.05 ? front : back;
            target.moveTo(prev.x, prev.y);
            target.lineTo(p.x, p.y);
          }
          prev = p;
        }
        ctx.strokeStyle = rgba(0.16, 40);
        ctx.stroke(front);
      }
      ctx.strokeStyle = rgba(0.06);
      ctx.stroke(back);

      // Eyes
      if (now > blinkAt + 140) blinkAt = now + 2800 + Math.random() * 4200;
      const blink = now > blinkAt ? 0.1 : 1;
      const eyeBright = state === "listening" ? 1 : state === "thinking" ? 0.55 + 0.25 * Math.sin(t * 8) : 0.85;
      for (const side of [-1, 1]) {
        const u = side * 0.36;
        const [x, y, z] = surface(u, -0.03);
        const p = project(x, y, z + 0.02);
        if (p.z < -0.1) continue;
        const ew = unit * 0.085;
        const eh = unit * 0.026 * blink;
        const eg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, ew * 2.6);
        eg.addColorStop(0, rgba(0.75 * eyeBright, 140));
        eg.addColorStop(1, rgba(0));
        ctx.fillStyle = eg;
        ctx.beginPath();
        ctx.arc(p.x, p.y, ew * 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${0.9 * eyeBright})`;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, ew * Math.max(0.3, Math.cos(yaw + u)), Math.max(0.6, eh), 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Mouth: opens with the voice
      const open = state === "speaking" ? energy * 0.075 * (0.6 + 0.4 * Math.abs(Math.sin(t * 13))) : 0.004;
      const ml = project(...surface(-0.27, 0.58));
      const mr = project(...surface(0.27, 0.58));
      const mc = project(...surface(0, 0.58));
      ctx.strokeStyle = rgba(0.85, 120);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ml.x, ml.y);
      ctx.quadraticCurveTo(mc.x, mc.y - open * unit * 0.6, mr.x, mr.y);
      ctx.moveTo(ml.x, ml.y);
      ctx.quadraticCurveTo(mc.x, mc.y + open * unit * 2.2, mr.x, mr.y);
      ctx.stroke();

      // Thinking: data motes orbiting the head
      if (state === "thinking" || f.transition > 0) {
        const vis = state === "thinking" ? 1 : f.transition;
        for (const o of orbit) {
          o.a += dt * o.s * 1.8;
          const p = project(Math.cos(o.a) * o.r, -0.15 + Math.sin(o.a * 2) * 0.12, Math.sin(o.a) * o.r);
          ctx.fillStyle = rgba((p.z > 0 ? 0.9 : 0.3) * vis, 120);
          ctx.beginPath();
          ctx.arc(p.x, p.y, (p.z > 0 ? 2.2 : 1.2) * (unit / 100), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Thin HUD arcs around the presence (a nod to the classic J.A.R.V.I.S. look)
      ctx.save();
      ctx.translate(cx, headCy + unit * 0.35);
      const spin = t * (state === "thinking" ? 1.4 : 0.25);
      ctx.lineWidth = 1.2;
      for (const [rr, segs, gap, dir, a] of [
        [1.75, 3, 0.6, 1, 0.45],
        [1.92, 2, 1.8, -0.6, 0.25],
      ] as const) {
        ctx.strokeStyle = rgba(a + energy * 0.2, 40);
        const seg = (Math.PI * 2) / segs;
        for (let i = 0; i < segs; i++) {
          const s0 = spin * dir + i * seg;
          ctx.beginPath();
          ctx.arc(0, 0, rr * unit, s0, s0 + seg - gap);
          ctx.stroke();
        }
      }
      ctx.restore();
    },
  };
}
