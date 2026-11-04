import { describe, expect, it } from "vitest";
import { Action, ABSENT, Btn, Kind, MOVES, MoveId, Phase, PROFILES, cloneState, createFighter, createState, hashState, px, step } from "@bkny/sim";
import type { Inputs, SimState } from "@bkny/sim";

/** Reproducible scripted input, independent of the sim's own RNG. */
function script(seed: number, length: number): Inputs[] {
  let x = seed;
  const next = () => (x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff) >>> 8;
  const frames: Inputs[] = [];
  let held = [0, 0, ABSENT, ABSENT];
  for (let i = 0; i < length; i++) {
    if (i % 7 === 0) held = [next() & 0x7f | Btn.Right, next() & 0x7f, i > 300 ? next() & 0x7f : ABSENT, ABSENT];
    frames.push(held.slice());
  }
  return frames;
}

const run = (seed: number, frames: Inputs[]): SimState => {
  const s = createState(seed);
  for (const f of frames) step(s, f);
  return s;
};

describe("determinism", () => {
  it("produces identical hashes for identical input", () => {
    const frames = script(42, 8000);
    expect(hashState(run(7, frames))).toBe(hashState(run(7, frames)));
  });

  it("diverges when a single input changes", () => {
    const frames = script(42, 2000);
    const altered = frames.map((f) => f.slice());
    altered[100][0] ^= Btn.Attack;
    expect(hashState(run(7, altered))).not.toBe(hashState(run(7, frames)));
  });

  it("resumes identically from a cloned state", () => {
    const frames = script(9, 3000);
    const s = createState(3);
    for (const f of frames.slice(0, 1500)) step(s, f);
    const copy = cloneState(s);
    for (const f of frames.slice(1500)) { step(s, f); step(copy, f); }
    expect(hashState(copy)).toBe(hashState(s));
  });

  it("keeps every position an integer", () => {
    const s = createState(5);
    for (const f of script(11, 4000)) {
      step(s, f);
      for (const fighter of s.fighters) {
        for (const v of [fighter.x, fighter.y, fighter.z, fighter.vx, fighter.vz]) expect(Number.isInteger(v)).toBe(true);
      }
    }
  });
});

function arena(): { s: SimState; player: SimState["fighters"][0]; enemy: SimState["fighters"][0] } {
  const s = createState(1);
  step(s, [0, ABSENT, ABSENT, ABSENT]);
  const player = s.fighters[0];
  const enemy = createFighter(s.nextId++, Kind.Thug, -1, player.x + px(24), player.y, 500, 0);
  enemy.aiTimer = 10_000;
  s.fighters.push(enemy);
  return { s, player, enemy };
}

const press = (s: SimState, bits: number, ticks = 1) => {
  for (let i = 0; i < ticks; i++) step(s, [bits, ABSENT, ABSENT, ABSENT]);
};

describe("combat", () => {
  it("chains jab, cross and uppercut only on connecting hits", () => {
    const { s, player, enemy } = arena();
    const seen = new Set<number>();
    for (let i = 0; i < 90; i++) {
      press(s, i % 6 === 0 ? Btn.Attack : 0);
      if (player.action === Action.Attack) seen.add(player.move);
    }
    expect([...seen]).toEqual([MoveId.Jab, MoveId.Cross, MoveId.Uppercut]);
    expect(enemy.hp).toBeLessThan(500);
  });

  it("does not chain on a whiff", () => {
    const { s, player, enemy } = arena();
    enemy.x = player.x + px(300);
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) {
      press(s, i % 6 === 0 ? Btn.Attack : 0);
      if (player.action === Action.Attack) seen.add(player.move);
    }
    expect([...seen]).toEqual([MoveId.Jab]);
  });

  it("misses a target outside the depth band", () => {
    const { s, player, enemy } = arena();
    enemy.y = player.y + px(MOVES[MoveId.Jab].depth + 4);
    enemy.x = player.x + px(24);
    press(s, Btn.Attack);
    press(s, 0, 8);
    expect(enemy.hp).toBe(500);
  });

  it("hits only once per swing", () => {
    const { s, enemy } = arena();
    press(s, Btn.Attack);
    press(s, 0, 20);
    expect(enemy.hp).toBe(500 - MOVES[MoveId.Jab].damage);
  });

  it("special costs health and strikes both sides", () => {
    const { s, player, enemy } = arena();
    const other = createFighter(s.nextId++, Kind.Thug, -1, player.x - px(24), player.y, 500, 0);
    other.aiTimer = 10_000;
    s.fighters.push(other);
    const hp = player.hp;
    press(s, Btn.Special);
    press(s, 0, 12);
    expect(player.hp).toBe(hp - 8);
    expect(enemy.hp).toBeLessThan(500);
    expect(other.hp).toBeLessThan(500);
  });

  it("player respawns while lives remain, then the match is lost", () => {
    const { s, player } = arena();
    s.fighters = s.fighters.filter((f) => f === player);
    const enemy = createFighter(s.nextId++, Kind.Thug, -1, player.x + px(16), player.y, 500, 0);
    s.fighters.push(enemy);
    for (let i = 0; i < 40_000 && s.phase === Phase.Playing; i++) press(s, 0);
    expect(s.phase).toBe(Phase.Defeat);
    expect(player.lives).toBe(0);
  });
});

describe("stage flow", () => {
  it("can be cleared by a simple bot", () => {
    const s = createState(123);
    for (let i = 0; i < 40_000 && s.phase === Phase.Playing; i++) {
      const me = s.fighters.find((f) => f.kind === Kind.Player);
      const foe = s.fighters.find((f) => f.kind !== Kind.Player && f.action !== Action.Dead);
      let bits = 0;
      if (me && foe) {
        bits |= foe.x > me.x ? Btn.Right : Btn.Left;
        if (Math.abs(foe.y - me.y) > px(5)) bits |= foe.y > me.y ? Btn.Down : Btn.Up;
        if (Math.abs(foe.x - me.x) < px(30) && Math.abs(foe.y - me.y) < px(8)) bits = (bits & (Btn.Left | Btn.Right)) | (i % 8 === 0 ? Btn.Attack : 0);
      } else bits = Btn.Right;
      step(s, [bits, ABSENT, ABSENT, ABSENT]);
      if (me) me.hp = PROFILES[Kind.Player].hp; // the bot tests pacing, not skill
    }
    expect(s.phase).toBe(Phase.Victory);
  });

  it("camera never moves backwards", () => {
    const s = createState(8);
    let cam = 0;
    for (const f of script(21, 5000)) {
      step(s, f);
      expect(s.camX).toBeGreaterThanOrEqual(cam);
      cam = s.camX;
    }
  });
});
