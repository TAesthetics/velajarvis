"use client";

import { useEffect, useRef } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "error";

const PALETTE: Record<OrbState, [number, number, number]> = {
  idle: [0, 190, 255],
  listening: [0, 255, 230],
  thinking: [130, 110, 255],
  speaking: [40, 200, 255],
  error: [255, 70, 95],
};

type Particle = { r: number; theta: number; phi: number; speed: number; size: number; tilt: number };

export default function Orb({
  state,
  levelRef,
}: {
  state: OrbState;
  /** 0..1 audio level, written by mic analyser / speech simulation */
  levelRef: React.RefObject<number>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<OrbState>(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const particles: Particle[] = Array.from({ length: 220 }, () => ({
      r: 0.55 + Math.random() * 0.5,
      theta: Math.random() * Math.PI * 2,
      phi: Math.acos(2 * Math.random() - 1),
      speed: (0.15 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1),
      size: 0.4 + Math.random() * 1.6,
      tilt: (Math.random() - 0.5) * 0.6,
    }));

    const color = [...PALETTE.idle] as [number, number, number];
    let energy = 0;
    let spin = 0;
    let last = performance.now();

    const rgba = (a: number, boost = 0) =>
      `rgba(${Math.min(255, color[0] + boost)},${Math.min(255, color[1] + boost)},${Math.min(
        255,
        color[2] + boost,
      )},${a})`;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const st = stateRef.current;
      const target = PALETTE[st];
      for (let i = 0; i < 3; i++) color[i] += (target[i] - color[i]) * Math.min(1, dt * 4);

      const raw = Math.max(0, Math.min(1, levelRef.current ?? 0));
      const base =
        st === "idle" ? 0.08 + 0.04 * Math.sin(t * 1.4) : st === "thinking" ? 0.35 + 0.15 * Math.sin(t * 6) : 0.12;
      const targetEnergy = Math.max(base, raw);
      energy += (targetEnergy - energy) * Math.min(1, dt * (targetEnergy > energy ? 18 : 6));

      const spinSpeed = st === "thinking" ? 2.6 : st === "listening" ? 0.9 : st === "speaking" ? 1.1 : 0.35;
      spin += dt * spinSpeed;

      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * 0.25;
      const maxR = Math.min(w, h) * 0.5;

      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      // Outer halo
      const haloR = Math.min(maxR, R * (1.8 + energy * 0.4));
      const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, haloR);
      halo.addColorStop(0, rgba(0.28 + energy * 0.25));
      halo.addColorStop(0.45, rgba(0.08 + energy * 0.08));
      halo.addColorStop(1, rgba(0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      // Particles (pseudo-3D sphere shell)
      const pr = R * (1.25 + energy * 0.5);
      for (const p of particles) {
        p.theta += dt * p.speed * (0.4 + spinSpeed * 0.6 + energy);
        const sinPhi = Math.sin(p.phi);
        let x = Math.cos(p.theta) * sinPhi;
        let y = Math.cos(p.phi);
        let z = Math.sin(p.theta) * sinPhi;
        // tilt around x
        const ct = Math.cos(p.tilt + 0.35);
        const s = Math.sin(p.tilt + 0.35);
        const y2 = y * ct - z * s;
        z = y * s + z * ct;
        y = y2;
        const depth = (z + 1.6) / 2.6;
        const rr = pr * p.r * (1 + Math.sin(t * 2 + p.theta * 3) * 0.03 * (1 + energy * 4));
        x = cx + x * rr;
        const py = cy + y * rr;
        ctx.fillStyle = rgba(0.15 + depth * 0.7, 60);
        ctx.beginPath();
        ctx.arc(x, py, p.size * depth * (1 + energy * 0.8), 0, Math.PI * 2);
        ctx.fill();
      }

      // HUD tick ring
      const tickR = R * 1.72;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-spin * 0.15);
      for (let i = 0; i < 90; i++) {
        const a = (i / 90) * Math.PI * 2;
        const long = i % 5 === 0;
        const len = long ? 10 : 4;
        ctx.strokeStyle = rgba(long ? 0.55 : 0.25);
        ctx.lineWidth = long ? 1.4 : 1;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * tickR, Math.sin(a) * tickR);
        ctx.lineTo(Math.cos(a) * (tickR - len), Math.sin(a) * (tickR - len));
        ctx.stroke();
      }
      ctx.restore();

      // Rotating segmented arcs
      const rings = [
        { r: 1.52, w: 2, speed: 0.6, segs: 3, gap: 0.5, a: 0.75 },
        { r: 1.42, w: 6, speed: -0.35, segs: 5, gap: 0.35, a: 0.35 },
        { r: 1.34, w: 1.2, speed: 1.1, segs: 1, gap: 1.2, a: 0.9 },
        { r: 1.9, w: 1.5, speed: -0.2, segs: 2, gap: 2.2, a: 0.5 },
      ];
      for (const ring of rings) {
        const rr = R * ring.r * (1 + energy * 0.08);
        ctx.strokeStyle = rgba(ring.a, 40);
        ctx.lineWidth = ring.w;
        ctx.shadowBlur = 12;
        ctx.shadowColor = rgba(0.9);
        const segLen = (Math.PI * 2) / ring.segs;
        for (let i = 0; i < ring.segs; i++) {
          const start = spin * ring.speed + i * segLen;
          ctx.beginPath();
          ctx.arc(cx, cy, rr, start, start + segLen - ring.gap);
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;

      // Audio-reactive waveform ring
      const waveR = R * 1.08;
      for (let layer = 0; layer < 3; layer++) {
        ctx.beginPath();
        const pts = 160;
        for (let i = 0; i <= pts; i++) {
          const a = (i / pts) * Math.PI * 2;
          const n =
            Math.sin(a * 6 + t * (2.2 + layer) + layer) * 0.5 +
            Math.sin(a * 11 - t * 3.1 + layer * 2) * 0.3 +
            Math.sin(a * 3 + t * 1.3) * 0.2;
          const amp = R * (0.02 + energy * 0.22) * (1 - layer * 0.25);
          const r = waveR + n * amp;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = rgba(0.55 - layer * 0.15, 80);
        ctx.lineWidth = 1.6 - layer * 0.4;
        ctx.shadowBlur = 18;
        ctx.shadowColor = rgba(1);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // Core
      const coreR = R * (0.62 + energy * 0.28 + Math.sin(t * 2.4) * 0.015);
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      core.addColorStop(0, `rgba(255,255,255,${0.85})`);
      core.addColorStop(0.18, rgba(0.9, 120));
      core.addColorStop(0.55, rgba(0.35));
      core.addColorStop(1, rgba(0));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      // Inner arc reactor lines
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(spin * 0.5);
      ctx.strokeStyle = rgba(0.35, 100);
      ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * coreR * 0.35, Math.sin(a) * coreR * 0.35);
        ctx.lineTo(Math.cos(a) * coreR * 0.8, Math.sin(a) * coreR * 0.8);
        ctx.stroke();
      }
      ctx.restore();

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [levelRef]);

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden />;
}
