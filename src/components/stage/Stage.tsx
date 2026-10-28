"use client";

import { useEffect, useRef } from "react";
import { createJarvisFigure } from "./jarvisFigure";
import { createThrongSwarm, type ThrongVisual } from "./throngSwarm";
import { createPurpleSentinel, type PurpleVisual, type Threat } from "./purpleSentinel";
import type { RGB, StageState, Visual } from "./types";
import { companionCount } from "@/lib/population";

export type { StageState } from "./types";
export type { Threat } from "./purpleSentinel";
export type Variant = "jarvis" | "throng" | "purple";

const PALETTE: Record<Variant, Record<StageState, RGB>> = {
  jarvis: {
    idle: [0, 190, 255],
    listening: [0, 255, 230],
    thinking: [130, 110, 255],
    speaking: [40, 200, 255],
    error: [255, 70, 95],
  },
  throng: {
    idle: [255, 176, 84],
    listening: [255, 128, 172],
    thinking: [176, 120, 255],
    speaking: [255, 206, 96],
    error: [255, 70, 95],
  },
  purple: {
    idle: [168, 110, 255],
    listening: [210, 120, 255],
    thinking: [120, 120, 255],
    speaking: [190, 140, 255],
    error: [255, 70, 95],
  },
};

type Ripple = { at: number; strength: number };

/**
 * The animated centrepiece. One canvas, two visuals:
 * - jarvis: a single holographic presence (head & shoulders) with orbiting Thronglet companions
 * - throng: a multiplying swarm of Thronglets
 * Shared effects: breathing halo, listening ripples, speaking pulse, state-change flash.
 */
export default function Stage({
  state,
  variant,
  levelRef,
  population,
  threat,
}: {
  state: StageState;
  variant: Variant;
  threat?: Threat;
  /** 0..1 audio level, written by the mic analyser / speech envelope */
  levelRef: React.RefObject<number>;
  population: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const variantRef = useRef(variant);
  const swarmRef = useRef<ThrongVisual | null>(null);
  const companionsRef = useRef<ThrongVisual | null>(null);
  const popRef = useRef(population);
  const purpleRef = useRef<PurpleVisual | null>(null);
  const threatRef = useRef(threat);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    variantRef.current = variant;
  }, [variant]);
  useEffect(() => {
    popRef.current = population;
    swarmRef.current?.setPopulation(population);
    companionsRef.current?.setPopulation(companionCount(population));
  }, [population]);

  useEffect(() => {
    threatRef.current = threat;
    if (threat) purpleRef.current?.setThreat(threat);
  }, [threat]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motionQuery.matches;
    const onMotion = () => (reduced = motionQuery.matches);
    motionQuery.addEventListener("change", onMotion);

    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const swarm = createThrongSwarm(popRef.current);
    swarmRef.current = swarm;
    // JARVIS: one central figure, with a few Thronglet companions orbiting him
    const figure = createJarvisFigure();
    const companions = createThrongSwarm(companionCount(popRef.current), { layout: "orbit" });
    companionsRef.current = companions;
    const jarvis: Visual = {
      draw(f) {
        figure.draw(f);
        companions.draw(f);
      },
    };
    const purple = createPurpleSentinel();
    if (threatRef.current) purple.setThreat(threatRef.current);
    purpleRef.current = purple;
    const visuals: Record<Variant, Visual> = { jarvis, throng: swarm, purple };

    const color = [...PALETTE[variantRef.current].idle] as RGB;
    const rgba = (a: number, boost = 0) =>
      `rgba(${Math.min(255, color[0] + boost) | 0},${Math.min(255, color[1] + boost) | 0},${Math.min(255, color[2] + boost) | 0},${Math.max(0, Math.min(1, a))})`;
    let energy = 0;
    let last = performance.now();
    let t = 0;
    let prevState = stateRef.current;
    let prevVariant = variantRef.current;
    let transition = 0;
    let fade = 1; // cross-fade when switching persona
    const ripples: Ripple[] = [];
    let nextRipple = 0;
    let raf = 0;

    const frame = (now: number) => {
      const realDt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const speed = reduced ? 0.3 : 1;
      const dt = realDt * speed;
      t += dt;
      const st = stateRef.current;
      const variant = variantRef.current;

      if (st !== prevState) {
        prevState = st;
        transition = 1;
      }
      if (variant !== prevVariant) {
        prevVariant = variant;
        fade = 0;
        transition = 1;
      }
      transition = Math.max(0, transition - realDt * 1.6);
      fade = Math.min(1, fade + realDt * 1.8);

      const target = PALETTE[variant][st];
      for (let i = 0; i < 3; i++) color[i] += (target[i] - color[i]) * Math.min(1, realDt * 4);

      const raw = Math.max(0, Math.min(1, levelRef.current ?? 0));
      const base = st === "idle" ? 0.08 + 0.04 * Math.sin(t * 1.4) : st === "thinking" ? 0.35 + 0.15 * Math.sin(t * 6) : 0.12;
      const targetEnergy = Math.max(base, reduced ? raw * 0.5 : raw);
      energy += (targetEnergy - energy) * Math.min(1, realDt * (targetEnergy > energy ? 18 : 6));

      const cx = w / 2;
      const cy = h * 0.47;
      const R = Math.min(w, h * 0.92) * 0.25;

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      // breathing halo
      const haloR = Math.min(Math.min(w, h) * 0.5, R * (1.8 + energy * 0.4 + Math.sin(t * 1.1) * 0.05));
      const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, haloR);
      halo.addColorStop(0, rgba(0.22 + energy * 0.22));
      halo.addColorStop(0.5, rgba(0.06 + energy * 0.07));
      halo.addColorStop(1, rgba(0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      // listening ripples (sonar) and speaking pulses
      if (!reduced && (st === "listening" || st === "speaking") && now > nextRipple) {
        ripples.push({ at: now, strength: st === "listening" ? 0.5 + energy * 0.5 : 0.3 + energy * 0.4 });
        nextRipple = now + (st === "listening" ? 700 - energy * 300 : 420);
      }
      for (let i = ripples.length - 1; i >= 0; i--) {
        const k = (now - ripples[i].at) / 1800;
        if (k >= 1) {
          ripples.splice(i, 1);
          continue;
        }
        ctx.strokeStyle = rgba(ripples[i].strength * (1 - k) * 0.6, 40);
        ctx.lineWidth = 1.5 * (1 - k) + 0.5;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (0.9 + k * 1.3), 0, Math.PI * 2);
        ctx.stroke();
      }
      // state-change flash ring
      if (transition > 0) {
        ctx.strokeStyle = rgba(transition * 0.5, 80);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1.1 + (1 - transition) * 0.8), 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.globalAlpha = fade;
      visuals[variant].draw({ ctx, w, h, cx, cy, R, t, dt, now, state: st, energy, transition, color, rgba, reduced });
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      motionQuery.removeEventListener("change", onMotion);
      swarmRef.current = null;
      companionsRef.current = null;
      purpleRef.current = null;
    };
  }, [levelRef]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />;
}
