import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POP_CAP,
  POP_MIN,
  GROW_EVERY_MS,
  MAX_TIME_BIRTHS,
  birthsFor,
  generation,
  grow,
  initialPopulation,
  parsePopulation,
  timeGrowth,
} from "./population";

test("starts small", () => {
  const p = initialPopulation(1000);
  assert.equal(p.count, POP_MIN);
  assert.equal(generation(p), 1);
});

test("interactions spawn newborns", () => {
  assert.equal(birthsFor({ turn: 1 }), 1);
  assert.equal(birthsFor({ turn: 1, idea: 1, draft: 1, learned: 2 }), 1 + 3 + 2 + 2);
  const p = grow(initialPopulation(0), birthsFor({ idea: 2 }));
  assert.equal(p.count, POP_MIN + 6);
  assert.equal(p.born, 6);
});

test("population is capped for performance but births are counted", () => {
  let p = initialPopulation(0);
  for (let i = 0; i < 100; i++) p = grow(p, 5);
  assert.equal(p.count, POP_CAP);
  assert.equal(p.born, 500);
  assert.ok(generation(p) >= 4);
});

test("grows over time, bounded after a long absence", () => {
  const p0 = initialPopulation(0);
  assert.equal(timeGrowth(p0, GROW_EVERY_MS - 1).count, POP_MIN);
  const p1 = timeGrowth(p0, GROW_EVERY_MS * 2 + 5);
  assert.equal(p1.count, POP_MIN + 2);
  assert.equal(p1.lastGrowth, GROW_EVERY_MS * 2);
  const p2 = timeGrowth(p0, GROW_EVERY_MS * 1000);
  assert.equal(p2.count, POP_MIN + MAX_TIME_BIRTHS);
});

test("parses persisted state defensively", () => {
  assert.equal(parsePopulation(null, 5).count, POP_MIN);
  assert.equal(parsePopulation("{broken", 5).count, POP_MIN);
  assert.equal(parsePopulation(JSON.stringify({ count: 99999, born: 3, lastGrowth: 1 }), 5).count, POP_CAP);
  assert.equal(parsePopulation(JSON.stringify({ count: 40, born: 28, lastGrowth: 99 }), 5).lastGrowth, 5);
  assert.deepEqual(parsePopulation(JSON.stringify({ count: 40, born: 28, lastGrowth: 2 }), 5), { count: 40, born: 28, lastGrowth: 2 });
});
