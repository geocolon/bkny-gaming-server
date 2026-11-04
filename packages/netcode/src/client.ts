import { TICK_RATE, cloneState, hashState, step } from "@bkny/sim";
import type { Inputs, SimState } from "@bkny/sim";
import type { ServerMsg } from "./protocol";

export const TICK_MS = 1000 / TICK_RATE;
/** Stop predicting past this many ticks instead of drifting further from the truth. */
export const MAX_PREDICTION = 30;
const INITIAL_LEAD = 8;
const MARGIN_LOW = 2;
const MARGIN_HIGH = 4;

/**
 * Client half of the netcode.
 *
 * `confirmed` only ever advances with server-ordered inputs, so it is identical
 * on every peer. `predicted` is `confirmed` plus this player's unacknowledged
 * inputs, and is what the player sees. When confirmed inputs arrive we discard
 * the prediction and replay from `confirmed`: a rollback with no snapshot ring
 * to manage, which is cheap because a beat 'em up has few entities.
 */
export class PredictionClient {
  confirmed: SimState;
  predicted: SimState;
  readonly slot: number;
  /** Latest confirmed inputs; used as the guess for remote players. */
  lastInputs: Inputs;
  /** Ticks of slack the server reports between our input arriving and being used. */
  margin = 3;
  desyncs = 0;
  rollbacks = 0;
  private local = new Map<number, number>();
  private dirty = false;
  private targetHash: [number, number] | null = null;

  constructor(slot: number, state: SimState, inputs: Inputs) {
    this.slot = slot;
    this.confirmed = cloneState(state);
    this.predicted = cloneState(state);
    this.lastInputs = inputs.slice();
    this.predictTo(state.tick + INITIAL_LEAD);
  }

  private inputsFor(tick: number): Inputs {
    const frame = this.lastInputs.slice();
    frame[this.slot] = this.local.get(tick) ?? 0;
    return frame;
  }

  private predictTo(tick: number): void {
    const s = cloneState(this.confirmed);
    for (let t = s.tick + 1; t <= tick; t++) step(s, this.inputsFor(t));
    this.predicted = s;
  }

  /** Records this tick's input and advances the prediction. Returns the input to send, or null when stalled. */
  advance(bits: number): { tick: number; bits: number } | null {
    if (this.dirty) {
      this.dirty = false;
      this.rollbacks++;
      const target = Math.max(this.predicted.tick, this.confirmed.tick + 1);
      this.predictTo(target);
    }
    if (this.predicted.tick - this.confirmed.tick >= MAX_PREDICTION) return null;
    const tick = this.predicted.tick + 1;
    this.local.set(tick, bits);
    step(this.predicted, this.inputsFor(tick));
    return { tick, bits };
  }

  onFrames(msg: Extract<ServerMsg, { t: "f" }>): void {
    if (msg.from !== this.confirmed.tick + 1) return;
    for (const frame of msg.in) {
      step(this.confirmed, frame);
      this.lastInputs = frame;
      this.local.delete(this.confirmed.tick);
    }
    this.margin = msg.m;
    this.dirty = true;
    if (msg.h) this.targetHash = msg.h;
  }

  /** True when the server's hash for a tick we have reached disagrees with ours. */
  checkDesync(): boolean {
    if (!this.targetHash || this.targetHash[0] !== this.confirmed.tick) return false;
    const mismatch = hashState(this.confirmed) !== this.targetHash[1];
    this.targetHash = null;
    if (mismatch) this.desyncs++;
    return mismatch;
  }

  /** Nudges the local tick rate so our inputs reach the server just in time. */
  tickInterval(): number {
    if (this.margin < MARGIN_LOW) return TICK_MS * 0.96;
    if (this.margin > MARGIN_HIGH) return TICK_MS * 1.04;
    return TICK_MS;
  }

  get predictionDepth(): number {
    return this.predicted.tick - this.confirmed.tick;
  }
}
