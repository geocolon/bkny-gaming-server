import { Action, ABSENT, MAX_PLAYERS, Phase, SUB } from "./constants";

export interface Fighter {
  id: number;
  kind: number;
  slot: number; // player slot, or -1 for enemies
  x: number; // along the street
  y: number; // depth into the screen
  z: number; // height off the ground
  vx: number;
  vz: number;
  facing: number; // 1 or -1
  action: number;
  actionTick: number;
  move: number;
  hp: number;
  lives: number;
  score: number;
  stun: number;
  hitstop: number;
  invuln: number;
  attackBuffer: number;
  landed: number; // ticks of the current move since it connected, 0 if it has not
  prevInput: number;
  aiTimer: number;
  hitIds: number[]; // targets already struck by the current move
}

export interface HitEvent {
  attacker: number;
  target: number;
  damage: number;
  x: number;
  y: number;
  z: number;
  heavy: boolean;
}

export interface SimState {
  tick: number;
  rng: number;
  nextId: number;
  phase: number;
  camX: number;
  lockX: number; // camera cannot pass this while a wave is alive, -1 when free
  wave: number;
  fighters: Fighter[];
  hits: HitEvent[]; // events from the latest step only, for rumble and sparks
}

export type Inputs = number[];

export const noInputs = (): Inputs => new Array<number>(MAX_PLAYERS).fill(ABSENT);

export function createState(seed: number): SimState {
  return {
    tick: 0,
    rng: seed | 1,
    nextId: 1,
    phase: Phase.Playing,
    camX: 0,
    lockX: -1,
    wave: 0,
    fighters: [],
    hits: [],
  };
}

export function createFighter(id: number, kind: number, slot: number, x: number, y: number, hp: number, lives: number): Fighter {
  return {
    id, kind, slot, x, y, z: 0, vx: 0, vz: 0, facing: 1,
    action: Action.Idle, actionTick: 0, move: 0, hp, lives, score: 0,
    stun: 0, hitstop: 0, invuln: 0, attackBuffer: 0, landed: 0, prevInput: 0,
    aiTimer: 0, hitIds: [],
  };
}

export function cloneState(s: SimState): SimState {
  return {
    ...s,
    fighters: s.fighters.map((f) => ({ ...f, hitIds: [...f.hitIds] })),
    hits: s.hits.slice(),
  };
}

const FNV_PRIME = 16777619;

/** FNV-1a over every gameplay field. Compared between peers to detect desyncs. */
export function hashState(s: SimState): number {
  let h = 2166136261;
  const mix = (n: number) => {
    h = Math.imul(h ^ (n | 0), FNV_PRIME);
  };
  mix(s.tick); mix(s.rng); mix(s.nextId); mix(s.phase); mix(s.camX); mix(s.lockX); mix(s.wave);
  for (const f of s.fighters) {
    mix(f.id); mix(f.kind); mix(f.slot); mix(f.x); mix(f.y); mix(f.z); mix(f.vx); mix(f.vz);
    mix(f.facing); mix(f.action); mix(f.actionTick); mix(f.move); mix(f.hp); mix(f.lives);
    mix(f.score); mix(f.stun); mix(f.hitstop); mix(f.invuln); mix(f.attackBuffer); mix(f.landed);
    mix(f.prevInput); mix(f.aiTimer);
    for (const id of f.hitIds) mix(id);
  }
  return h >>> 0;
}

export const pixels = (subpixels: number): number => subpixels / SUB;
