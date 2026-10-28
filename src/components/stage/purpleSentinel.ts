import type { Visual } from "./types";

/**
 * PURPLE: one watchful sentinel. A hexagonal shield lattice around a single iris,
 * a radar sweep over the monitored perimeter and blips for live SIEM alerts.
 */

export type Threat = { critical: number; high: number; medium: number; low: number };

const hexPath = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) => {
  ctx.beginPath();
  for (let i = 0; i <= 6; i++) {
    const a = rot + (i / 6) * Math.PI * 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
};

// deterministic pseudo-random so blips don't jump around between frames
const rand = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export type PurpleVisual = Visual & { setThreat(t: Threat): void };

export function createPurpleSentinel(): PurpleVisual {
  let threat: Threat = { critical: 0, high: 0, medium: 0, low: 0 };
  let sweep = 0;
  let blinkAt = 3000;
  let irisSpin = 0;
  return {
    setThreat(t) {
      threat = t;
    },
    draw(f) {
      const { ctx, cx, cy, R, t, dt, now, state, energy, rgba, reduced } = f;
      const danger = threat.critical > 0 ? 1 : threat.high > 0 ? 0.6 : 0;
      const sweepSpeed = state === "thinking" ? 3.2 : state === "listening" ? 1.6 : 0.9;
      sweep += dt * sweepSpeed;
      irisSpin += dt * (state === "thinking" ? 2.5 : 0.4);
      const breathe = 1 + Math.sin(t * 1.2) * 0.015 + energy * 0.03;

      // perimeter rings
      ctx.lineWidth = 1;
      for (let k = 1; k <= 3; k++) {
        ctx.strokeStyle = rgba(0.16, 30);
        ctx.beginPath();
        ctx.arc(cx, cy, R * (0.6 * k) * breathe, 0, Math.PI * 2);
        ctx.stroke();
      }

      // radar sweep (stacked thin wedges = soft trailing gradient)
      const sweepR = R * 1.8 * breathe;
      for (let i = 0; i < 18; i++) {
        const a0 = sweep - i * 0.045;
        ctx.fillStyle = rgba(0.13 * (1 - i / 18), 50);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, sweepR, a0 - 0.045, a0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = rgba(0.6, 90);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sweep) * sweepR, cy + Math.sin(sweep) * sweepR);
      ctx.stroke();

      // hexagonal shield lattice
      for (let k = 0; k < 3; k++) {
        const r = R * (0.95 + k * 0.28) * breathe;
        const rot = (k % 2 ? -1 : 1) * t * (0.12 + k * 0.05) + Math.PI / 6;
        ctx.strokeStyle = rgba(0.5 - k * 0.12 + energy * 0.2, 60);
        ctx.lineWidth = 1.6 - k * 0.4;
        hexPath(ctx, cx, cy, r, rot);
        ctx.stroke();
        // vertex nodes = monitored assets
        for (let i = 0; i < 6; i++) {
          const a = rot + (i / 6) * Math.PI * 2;
          ctx.fillStyle = rgba(0.85 - k * 0.2, 120);
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, (2.4 - k * 0.5) * (R / 100), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // alert blips
      const blips: { sev: number }[] = [];
      for (let i = 0; i < Math.min(4, threat.critical); i++) blips.push({ sev: 3 });
      for (let i = 0; i < Math.min(4, threat.high); i++) blips.push({ sev: 2 });
      for (let i = 0; i < Math.min(4, threat.medium); i++) blips.push({ sev: 1 });
      for (let i = 0; i < Math.min(2, threat.low); i++) blips.push({ sev: 0 });
      blips.forEach((b, i) => {
        const a = rand(i + 1) * Math.PI * 2;
        const d = R * (0.55 + rand(i + 7) * 1.1);
        const x = cx + Math.cos(a) * d;
        const y = cy + Math.sin(a) * d;
        const since = ((((sweep - a) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2); // 0 right after the sweep passed
        const lit = Math.max(0.25, 1 - since * 1.4);
        const col = b.sev >= 2 ? "255,70,95" : b.sev === 1 ? "255,190,80" : "180,180,255";
        const pulse = reduced ? 1 : 1 + Math.sin(t * 6 + i) * 0.25;
        ctx.fillStyle = `rgba(${col},${0.25 * lit})`;
        ctx.beginPath();
        ctx.arc(x, y, R * 0.09 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${col},${0.95 * lit})`;
        ctx.beginPath();
        ctx.arc(x, y, R * 0.028, 0, Math.PI * 2);
        ctx.fill();
      });

      // the iris: a single watching eye in the core
      const irisR = R * 0.42 * breathe;
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, irisR * 1.6);
      core.addColorStop(0, rgba(0.55 + energy * 0.3, 90));
      core.addColorStop(1, rgba(0));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, irisR * 1.6, 0, Math.PI * 2);
      ctx.fill();
      // segmented iris ring
      ctx.lineWidth = R * 0.05;
      for (let i = 0; i < 12; i++) {
        const a0 = irisSpin + (i / 12) * Math.PI * 2;
        ctx.strokeStyle = rgba(i % 3 === 0 ? 0.9 : 0.45, 80);
        ctx.beginPath();
        ctx.arc(cx, cy, irisR * 0.78, a0, a0 + 0.36);
        ctx.stroke();
      }
      // eyelid / blink
      if (now > blinkAt + 160) blinkAt = now + 3500 + Math.random() * 5000;
      const lid = now > blinkAt ? 0.12 : 1;
      const pupil = irisR * (0.22 + energy * 0.22 + (state === "listening" ? 0.08 : 0));
      ctx.fillStyle = danger ? `rgba(255,${120 - danger * 60},${150 - danger * 60},0.95)` : "rgba(255,255,255,0.92)";
      ctx.beginPath();
      ctx.ellipse(cx, cy, pupil, pupil * lid, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(0.8, 120);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, irisR * 1.15, irisR * 0.62 * lid + 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();

      // speaking: the shield pulses outward
      if (state === "speaking") {
        ctx.strokeStyle = rgba(0.35 * energy, 80);
        ctx.lineWidth = 2;
        hexPath(ctx, cx, cy, R * (1.1 + energy * 0.5), t * 0.3);
        ctx.stroke();
      }
    },
  };
}
