import { Kind } from "./constants";

/** Frame data for one attack. Tune feel here, not in the state machine. */
export interface Move {
  startup: number;
  active: number;
  recovery: number;
  /** Hitbox: `offset` to `offset + reach` pixels in front, `depth` pixels either side. */
  offset: number;
  reach: number;
  depth: number;
  damage: number;
  knockback: number; // subpixels per tick
  hitstun: number;
  hitstop: number;
  launch: boolean;
  next: number; // move chained on hit, or -1
  aoe: boolean; // hits both directions
  invulnerable: boolean;
  lunge: number; // forward speed during active frames, subpixels per tick
}

const move = (m: Partial<Move> & Pick<Move, "startup" | "active" | "recovery">): Move => ({
  offset: 6, reach: 26, depth: 10, damage: 6, knockback: 180, hitstun: 18, hitstop: 4,
  launch: false, next: -1, aoe: false, invulnerable: false, lunge: 0, ...m,
});

export const MoveId = {
  Jab: 0, Cross: 1, Uppercut: 2, AirKick: 3, Special: 4, ThugPunch: 5, BruteSlam: 6,
} as const;

export const MOVES: Move[] = [
  move({ startup: 3, active: 3, recovery: 9, next: MoveId.Cross }),
  move({ startup: 4, active: 3, recovery: 11, damage: 7, next: MoveId.Uppercut }),
  move({ startup: 7, active: 4, recovery: 20, reach: 30, damage: 12, knockback: 420, hitstop: 8, launch: true, lunge: 120 }),
  move({ startup: 3, active: 12, recovery: 0, reach: 28, depth: 12, damage: 10, knockback: 360, hitstop: 6, launch: true }),
  move({ startup: 4, active: 10, recovery: 16, offset: -34, reach: 68, depth: 18, damage: 14, knockback: 520, hitstop: 8, launch: true, aoe: true, invulnerable: true }),
  move({ startup: 16, active: 3, recovery: 26, reach: 22, damage: 7, hitstop: 5 }),
  move({ startup: 30, active: 5, recovery: 40, reach: 34, depth: 14, damage: 16, knockback: 460, hitstop: 8, launch: true, lunge: 150 }),
];

export interface Profile {
  hp: number;
  speed: number; // subpixels per tick
  attack: number;
  /** Body half-width in pixels. */
  width: number;
}

export const PROFILES: Record<number, Profile> = {
  [Kind.Player]: { hp: 120, speed: 300, attack: MoveId.Jab, width: 10 },
  [Kind.Thug]: { hp: 30, speed: 170, attack: MoveId.ThugPunch, width: 10 },
  [Kind.Brute]: { hp: 90, speed: 110, attack: MoveId.BruteSlam, width: 15 },
};

export interface Wave {
  triggerX: number; // pixels; the camera locks when a player passes this
  spawns: number[];
}

// Replace this table with your own level data. It is the only level format so far.
export const WAVES: Wave[] = [
  { triggerX: 300, spawns: [Kind.Thug, Kind.Thug] },
  { triggerX: 620, spawns: [Kind.Thug, Kind.Thug, Kind.Thug] },
  { triggerX: 940, spawns: [Kind.Brute, Kind.Thug, Kind.Thug] },
  { triggerX: 1300, spawns: [Kind.Brute, Kind.Brute, Kind.Thug, Kind.Thug] },
];

export const SPECIAL_COST = 8;
export const PLAYER_LIVES = 3;
export const MAX_ATTACKERS = 2; // enemies allowed to swing at one player at a time
