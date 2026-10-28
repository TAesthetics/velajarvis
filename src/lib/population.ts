/**
 * Thronglet population: the swarm multiplies over time and with every interaction.
 * Pure functions so the rules are unit-testable; persistence lives in the UI.
 */

export const POP_KEY = "throng.population.v1";
export const POP_MIN = 12;
/** Hard cap for rendering performance on phones. */
export const POP_CAP = 144;
/** One newborn per GROW_EVERY_MS of time (also counts while the app was closed). */
export const GROW_EVERY_MS = 3 * 60_000;
/** Max newborns from elapsed time in one go (so a long absence doesn't explode the swarm). */
export const MAX_TIME_BIRTHS = 8;

export const BIRTHS = {
  /** a conversation turn */
  turn: 1,
  /** a saved idea */
  idea: 3,
  /** a drafted post */
  draft: 2,
  /** something learned via a tool (repo status, weather, …) */
  learned: 1,
} as const;
export type BirthReason = keyof typeof BIRTHS;

export type Population = {
  count: number;
  /** total newborns ever (keeps growing even at the cap) */
  born: number;
  /** epoch ms of the last time-based growth tick */
  lastGrowth: number;
};

export function initialPopulation(now: number): Population {
  return { count: POP_MIN, born: 0, lastGrowth: now };
}

export function generation(p: Population): number {
  return 1 + Math.floor(Math.log2(Math.max(1, p.count / POP_MIN)));
}

export function grow(p: Population, n: number): Population {
  const add = Math.max(0, Math.floor(n));
  if (!add) return p;
  return { ...p, count: Math.min(POP_CAP, p.count + add), born: p.born + add };
}

export function birthsFor(events: Partial<Record<BirthReason, number>>): number {
  let n = 0;
  for (const k of Object.keys(events) as BirthReason[]) n += (events[k] ?? 0) * BIRTHS[k];
  return n;
}

/** Growth from elapsed time since lastGrowth. */
export function timeGrowth(p: Population, now: number): Population {
  const elapsed = now - p.lastGrowth;
  if (elapsed < GROW_EVERY_MS) return elapsed < 0 ? { ...p, lastGrowth: now } : p;
  const steps = Math.floor(elapsed / GROW_EVERY_MS);
  const grown = grow(p, Math.min(MAX_TIME_BIRTHS, steps));
  return { ...grown, lastGrowth: p.lastGrowth + steps * GROW_EVERY_MS };
}

export function parsePopulation(raw: string | null, now: number): Population {
  if (!raw) return initialPopulation(now);
  try {
    const v = JSON.parse(raw) as Partial<Population>;
    const count = Number(v.count);
    const born = Number(v.born);
    const lastGrowth = Number(v.lastGrowth);
    if (!Number.isFinite(count)) return initialPopulation(now);
    return {
      count: Math.min(POP_CAP, Math.max(POP_MIN, Math.round(count))),
      born: Number.isFinite(born) && born >= 0 ? Math.round(born) : 0,
      lastGrowth: Number.isFinite(lastGrowth) && lastGrowth <= now ? lastGrowth : now,
    };
  } catch {
    return initialPopulation(now);
  }
}

/** JARVIS-mode companions: a small entourage that grows with the swarm, capped lower. */
export const COMPANION_MIN = 12;
export const COMPANION_MAX = 24;
export function companionCount(population: number): number {
  return Math.max(COMPANION_MIN, Math.min(COMPANION_MAX, Math.round(8 + population / 3)));
}
