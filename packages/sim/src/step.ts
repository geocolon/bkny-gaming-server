import {
  Action, Btn, Kind, LANE_BOTTOM, LANE_TOP, MAX_PLAYERS, Phase, SCREEN_W, STAGE_W, ABSENT, px,
} from "./constants";
import { MAX_ATTACKERS, MOVES, MoveId, PLAYER_LIVES, PROFILES, SPECIAL_COST, WAVES } from "./content";
import type { Move } from "./content";
import { createFighter } from "./state";
import type { Fighter, Inputs, SimState } from "./state";

const GRAVITY = 42;
const JUMP_SPEED = 620;
const FRICTION_NUM = 7; // velocity * 7/8 per tick on the ground
const BUFFER_TICKS = 10;
const CANCEL_WINDOW = 12;
const DOWN_TICKS = 40;
const RISE_TICKS = 24;
const CORPSE_TICKS = 45;
const RESPAWN_INVULN = 120;
const EDGE = px(14);

/** xorshift32. All randomness must flow through here so peers stay in lockstep. */
function random(s: SimState, range: number): number {
  let x = s.rng;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rng = x | 0;
  return (x >>> 0) % range;
}

const moveFrames = (m: Move) => m.startup + m.active + m.recovery;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function setAction(f: Fighter, action: number): void {
  f.action = action;
  f.actionTick = 0;
}

function startMove(f: Fighter, id: number): void {
  f.move = id;
  f.landed = 0;
  f.hitIds = [];
  setAction(f, Action.Attack);
}

/** True while the fighter's current attack can connect. */
export function isHitActive(f: Fighter): boolean {
  if (f.action !== Action.Attack) return false;
  const m = MOVES[f.move];
  return f.actionTick >= m.startup && f.actionTick < m.startup + m.active;
}

function syncPlayers(s: SimState, inputs: Inputs): void {
  for (let slot = 0; slot < MAX_PLAYERS; slot++) {
    const i = s.fighters.findIndex((f) => f.slot === slot);
    if (inputs[slot] === ABSENT) {
      if (i >= 0) s.fighters.splice(i, 1);
    } else if (i < 0) {
      const x = s.camX + px(60 + slot * 24);
      const y = px(LANE_TOP + 16 + slot * 16);
      s.fighters.push(createFighter(s.nextId++, Kind.Player, slot, x, y, PROFILES[Kind.Player].hp, PLAYER_LIVES));
      s.fighters.sort((a, b) => a.id - b.id);
    }
  }
}

function groundMove(f: Fighter, input: number, speed: number): void {
  const dx = (input & Btn.Right ? 1 : 0) - (input & Btn.Left ? 1 : 0);
  const dy = (input & Btn.Down ? 1 : 0) - (input & Btn.Up ? 1 : 0);
  f.x += dx * speed;
  f.y += Math.trunc((dy * speed * 3) / 5); // depth moves slower, it reads as distance
  if (dx !== 0) f.facing = dx;
  const moving = dx !== 0 || dy !== 0;
  if (moving && f.action === Action.Idle) setAction(f, Action.Walk);
  if (!moving && f.action === Action.Walk) setAction(f, Action.Idle);
}

function updatePlayer(s: SimState, f: Fighter, input: number): void {
  const pressed = input & ~f.prevInput;
  f.prevInput = input;
  if (pressed & Btn.Attack) f.attackBuffer = BUFFER_TICKS;
  else if (f.attackBuffer > 0) f.attackBuffer--;
  const free = f.action === Action.Idle || f.action === Action.Walk;

  if (free) {
    if (pressed & Btn.Jump) {
      f.vz = JUMP_SPEED;
      f.z = 1;
      const dx = (input & Btn.Right ? 1 : 0) - (input & Btn.Left ? 1 : 0);
      f.vx = dx * PROFILES[Kind.Player].speed;
      setAction(f, Action.Jump);
    } else if (pressed & Btn.Special && f.hp > SPECIAL_COST) {
      f.hp -= SPECIAL_COST;
      startMove(f, MoveId.Special);
    } else if (f.attackBuffer > 0) {
      f.attackBuffer = 0;
      startMove(f, MoveId.Jab);
    } else {
      groundMove(f, input, PROFILES[Kind.Player].speed);
    }
  } else if (f.action === Action.Jump && pressed & Btn.Attack) {
    f.attackBuffer = 0;
    startMove(f, MoveId.AirKick);
  } else if (f.action === Action.Attack) {
    const m = MOVES[f.move];
    if (m.next >= 0 && f.landed > 0 && f.landed <= CANCEL_WINDOW && f.attackBuffer > 0) {
      f.attackBuffer = 0;
      startMove(f, m.next);
    }
  }
}

function pickTarget(s: SimState, e: Fighter): Fighter | undefined {
  let best: Fighter | undefined;
  let bestDist = Infinity;
  for (const p of s.fighters) {
    if (p.kind !== Kind.Player || p.action === Action.Dead) continue;
    const d = Math.abs(p.x - e.x) + Math.abs(p.y - e.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function updateEnemy(s: SimState, e: Fighter): void {
  if (e.action !== Action.Idle && e.action !== Action.Walk) return;
  const target = pickTarget(s, e);
  if (!target) return;
  if (e.aiTimer > 0) e.aiTimer--;

  const profile = PROFILES[e.kind];
  const m = MOVES[profile.attack];
  const attackers = s.fighters.filter((o) => o.kind !== Kind.Player && o.action === Action.Attack).length;
  const canAttack = e.aiTimer === 0 && attackers < MAX_ATTACKERS * Math.max(1, countPlayers(s));

  // Queue at a distance until an attack token is free, which is what stops a
  // crowd from stunlocking one player.
  const side = e.x < target.x ? -1 : 1;
  const standOff = canAttack ? px(m.offset + m.reach - 6) : px(64 + (e.id % 3) * 16);
  // Never hold a position off-screen: the camera cannot scroll back to reach it.
  const goalX = clamp(target.x + side * standOff, s.camX + EDGE, s.camX + px(SCREEN_W) - EDGE);
  const goalY = target.y + (canAttack ? 0 : px(((e.id % 3) - 1) * 12));
  const dx = goalX - e.x;
  const dy = goalY - e.y;
  const step = profile.speed;

  e.facing = target.x >= e.x ? 1 : -1;
  const inRange = Math.abs(target.x - e.x) <= px(m.offset + m.reach) && Math.abs(target.y - e.y) <= px(m.depth - 2);
  if (canAttack && inRange) {
    e.aiTimer = 40 + random(s, 50);
    startMove(e, profile.attack);
    return;
  }
  const near = Math.abs(dx) <= step && Math.abs(dy) <= step;
  if (near) {
    if (e.action === Action.Walk) setAction(e, Action.Idle);
    return;
  }
  e.x += clamp(dx, -step, step);
  e.y += clamp(dy, -step, step);
  if (e.action === Action.Idle) setAction(e, Action.Walk);
}

const countPlayers = (s: SimState) => s.fighters.reduce((n, f) => n + (f.kind === Kind.Player ? 1 : 0), 0);

function advanceAction(f: Fighter): void {
  f.actionTick++;
  if (f.invuln > 0) f.invuln--;

  switch (f.action) {
    case Action.Attack: {
      const m = MOVES[f.move];
      if (f.landed > 0) f.landed++;
      if (isHitActive(f) && m.lunge) f.x += f.facing * m.lunge;
      // Air attacks last until landing, whatever their frame count.
      if (f.z === 0 && f.actionTick >= moveFrames(m)) setAction(f, Action.Idle);
      break;
    }
    case Action.Hurt:
      if (--f.stun <= 0) setAction(f, Action.Idle);
      break;
    case Action.Down:
      if (f.actionTick >= DOWN_TICKS) {
        if (f.hp > 0) {
          setAction(f, Action.Rise);
          f.invuln = RISE_TICKS;
        } else if (f.kind === Kind.Player && f.lives > 1) {
          f.lives--;
          f.hp = PROFILES[Kind.Player].hp;
          f.invuln = RESPAWN_INVULN;
          setAction(f, Action.Rise);
        } else {
          f.lives = 0;
          setAction(f, Action.Dead);
        }
      }
      break;
    case Action.Rise:
      if (f.actionTick >= RISE_TICKS) setAction(f, Action.Idle);
      break;
  }
}

function integrate(f: Fighter): void {
  f.x += f.vx;
  if (f.z > 0 || f.vz > 0) {
    f.vz -= GRAVITY;
    f.z = Math.max(0, f.z + f.vz);
    if (f.z === 0) {
      f.vz = 0;
      f.vx = 0;
      if (f.action === Action.Jump) setAction(f, Action.Idle);
      else if (f.action === Action.Launched) setAction(f, Action.Down);
    }
  } else if (f.vx !== 0) {
    f.vx = Math.trunc((f.vx * FRICTION_NUM) / 8);
  }
  f.y = clamp(f.y, px(LANE_TOP), px(LANE_BOTTOM));
}

function isVulnerable(f: Fighter): boolean {
  if (f.invuln > 0) return false;
  if (f.action === Action.Attack && MOVES[f.move].invulnerable) return false;
  return f.action !== Action.Launched && f.action !== Action.Down && f.action !== Action.Rise && f.action !== Action.Dead;
}

function resolveHits(s: SimState): void {
  // Collect first, then apply, so that two fighters trading blows both land
  // regardless of their order in the array.
  const landed: [Fighter, Fighter][] = [];
  for (const a of s.fighters) {
    if (!isHitActive(a)) continue;
    const m = MOVES[a.move];
    const near = a.x + a.facing * px(m.offset);
    const far = a.x + a.facing * px(m.offset + m.reach);
    const lo = Math.min(near, far);
    const hi = Math.max(near, far);
    for (const t of s.fighters) {
      if (t === a || (a.kind === Kind.Player) === (t.kind === Kind.Player)) continue;
      if (a.hitIds.includes(t.id) || !isVulnerable(t)) continue;
      const w = px(PROFILES[t.kind].width);
      if (t.x + w < lo || t.x - w > hi) continue;
      if (Math.abs(t.y - a.y) > px(m.depth)) continue;
      if (Math.abs(t.z - a.z) > px(36)) continue;
      landed.push([a, t]);
    }
  }
  for (const [a, t] of landed) {
    const m = MOVES[a.move];
    a.hitIds.push(t.id);
    if (a.landed === 0) a.landed = 1;
    a.hitstop = Math.max(a.hitstop, m.hitstop);
    a.score += m.damage;
    t.hp = Math.max(0, t.hp - m.damage);
    t.hitstop = m.hitstop;
    t.facing = a.x <= t.x ? -1 : 1;
    t.hitIds = [];
    const away = m.aoe ? (t.x >= a.x ? 1 : -1) : a.facing;
    if (m.launch || t.hp === 0 || t.z > 0) {
      setAction(t, Action.Launched);
      t.vx = away * m.knockback;
      t.vz = 380;
      t.z = Math.max(t.z, 1);
    } else {
      setAction(t, Action.Hurt);
      t.stun = m.hitstun;
      t.vx = away * m.knockback;
    }
    s.hits.push({ attacker: a.id, target: t.id, damage: m.damage, x: t.x, y: t.y, z: t.z + px(24), heavy: m.launch });
  }
}

function spawnEnemy(s: SimState, kind: number): void {
  const fromRight = random(s, 4) !== 0;
  const offset = px(24 + random(s, 40));
  const x = fromRight ? s.camX + px(SCREEN_W) + offset : s.camX - offset;
  const y = px(LANE_TOP + random(s, LANE_BOTTOM - LANE_TOP));
  const f = createFighter(s.nextId++, kind, -1, x, y, PROFILES[kind].hp, 0);
  f.aiTimer = 30 + random(s, 60);
  s.fighters.push(f);
}

function updateDirector(s: SimState): void {
  s.fighters = s.fighters.filter(
    (f) => f.kind === Kind.Player || f.action !== Action.Dead || f.actionTick < CORPSE_TICKS,
  );

  let front = -1;
  let total = 0;
  let count = 0;
  for (const f of s.fighters) {
    if (f.kind !== Kind.Player || f.action === Action.Dead) continue;
    front = Math.max(front, f.x);
    total += f.x;
    count++;
  }
  const players = countPlayers(s);
  if (players > 0 && count === 0) {
    s.phase = Phase.Defeat;
    return;
  }
  if (count === 0) return;

  const enemiesLeft = s.fighters.some((f) => f.kind !== Kind.Player);
  if (s.lockX >= 0 && !enemiesLeft) s.lockX = -1;
  if (s.lockX < 0 && s.wave < WAVES.length && front >= px(WAVES[s.wave].triggerX)) {
    const w = WAVES[s.wave++];
    s.lockX = Math.min(px(w.triggerX), px(STAGE_W - SCREEN_W));
    for (const kind of w.spawns) spawnEnemy(s, kind);
  } else if (s.lockX < 0 && s.wave >= WAVES.length) {
    s.phase = Phase.Victory;
    return;
  }

  // The camera only moves forward. That is the core rule of the genre's pacing.
  const ideal = Math.trunc(total / count) - px(SCREEN_W / 2);
  const limit = s.lockX >= 0 ? s.lockX : px(STAGE_W - SCREEN_W);
  s.camX = clamp(Math.max(s.camX, ideal), 0, limit);

  for (const f of s.fighters) {
    if (f.kind === Kind.Player) f.x = clamp(f.x, s.camX + EDGE, s.camX + px(SCREEN_W) - EDGE);
  }
}

/**
 * Advances the world one tick. This is the single source of game truth: the
 * server, offline play and client prediction all call it, so it must depend on
 * nothing but `s` and `inputs`. No Date, Math.random, or Map iteration here.
 */
export function step(s: SimState, inputs: Inputs): void {
  s.tick++;
  s.hits = [];
  if (s.phase !== Phase.Playing) return;

  syncPlayers(s, inputs);
  for (const f of s.fighters) {
    if (f.hitstop > 0) {
      f.hitstop--;
      continue;
    }
    if (f.kind === Kind.Player) updatePlayer(s, f, inputs[f.slot]);
    else updateEnemy(s, f);
    advanceAction(f);
    integrate(f);
  }
  resolveHits(s);
  updateDirector(s);
}
