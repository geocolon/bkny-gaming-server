// All world units are integer subpixels. Keeping the sim integer-only makes it
// trivially portable to a Rust or Go server later without changing its results.
export const SUB = 256;
export const px = (n: number): number => n * SUB;

export const TICK_RATE = 60;
export const MAX_PLAYERS = 4;
export const SCREEN_W = 480;
export const SCREEN_H = 270;
export const STAGE_W = 1600;
export const LANE_TOP = 176; // furthest walkable depth, in pixels
export const LANE_BOTTOM = 250; // nearest walkable depth, in pixels

export const Btn = {
  Left: 1 << 0,
  Right: 1 << 1,
  Up: 1 << 2,
  Down: 1 << 3,
  Attack: 1 << 4,
  Jump: 1 << 5,
  Special: 1 << 6,
} as const;
export const INPUT_MASK = 0x7f;
/** Input value meaning "nobody is in this slot". */
export const ABSENT = -1;

export const Kind = { Player: 0, Thug: 1, Brute: 2 } as const;
export const Action = {
  Idle: 0,
  Walk: 1,
  Jump: 2,
  Attack: 3,
  Hurt: 4,
  Launched: 5,
  Down: 6,
  Rise: 7,
  Dead: 8,
} as const;
export const Phase = { Playing: 0, Victory: 1, Defeat: 2 } as const;
