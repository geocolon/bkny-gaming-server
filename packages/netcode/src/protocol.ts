import type { Inputs, SimState } from "@bkny/sim";

export const PROTOCOL_VERSION = 1;
/** Server sends confirmed inputs every this many ticks. 60Hz sim, 30Hz network. */
export const FLUSH_TICKS = 2;
export const HASH_EVERY_TICKS = 60;

export type ClientMsg =
  | { t: "hello"; v: number }
  | { t: "i"; k: number; b: number } // input bits `b` for tick `k`
  | { t: "ping"; c: number }
  | { t: "resync" };

export type ServerMsg =
  | { t: "welcome"; slot: number; state: SimState; inputs: Inputs }
  | { t: "f"; from: number; in: Inputs[]; m: number; h?: [number, number] } // frames starting at tick `from`
  | { t: "pong"; c: number }
  | { t: "full" }
  | { t: "over"; phase: number };

export interface Transport {
  send(msg: ClientMsg): void;
  close(): void;
}
