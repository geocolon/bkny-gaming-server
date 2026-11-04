import { ABSENT, INPUT_MASK, MAX_PLAYERS, Phase, cloneState, createState, hashState, noInputs, step } from "@bkny/sim";
import type { Inputs, SimState } from "@bkny/sim";
import { FLUSH_TICKS, HASH_EVERY_TICKS } from "@bkny/netcode";
import type { ClientMsg, ServerMsg } from "@bkny/netcode";

export type Send = (msg: ServerMsg) => void;

interface Peer {
  send: Send;
  queued: Map<number, number>;
  last: number; // input held for ticks with nothing queued
  newest: number; // highest tick received, drives the client's clock nudging
}

/** Inputs more than this far ahead are dropped so a client cannot grow the queue. */
const MAX_INPUT_LEAD = 120;

/** One match. Knows nothing about sockets or Agones, so tests can drive it directly. */
export class GameRoom {
  state: SimState;
  private peers: (Peer | null)[] = new Array(MAX_PLAYERS).fill(null);
  private pending: Inputs[] = [];
  private pendingFrom = 0;
  private ended = false;
  onEnd: (phase: number) => void = () => {};

  constructor(private seed: number) {
    this.state = createState(seed);
  }

  get playerCount(): number {
    return this.peers.filter(Boolean).length;
  }

  private currentInputs(): Inputs {
    return this.peers.map((p) => (p ? p.last : ABSENT));
  }

  private welcome(slot: number, peer: Peer): void {
    this.flush();
    peer.send({ t: "welcome", slot, state: cloneState(this.state), inputs: this.currentInputs() });
  }

  join(send: Send): number {
    const slot = this.peers.indexOf(null);
    if (slot < 0) {
      send({ t: "full" });
      return -1;
    }
    this.flush();
    const peer: Peer = { send, queued: new Map(), last: 0, newest: this.state.tick };
    this.peers[slot] = peer;
    this.welcome(slot, peer);
    return slot;
  }

  leave(slot: number): void {
    this.peers[slot] = null;
  }

  onMessage(slot: number, msg: ClientMsg): void {
    const peer = this.peers[slot];
    if (!peer) return;
    switch (msg.t) {
      case "i":
        if (!Number.isInteger(msg.k) || msg.k <= this.state.tick || msg.k > this.state.tick + MAX_INPUT_LEAD) return;
        peer.queued.set(msg.k, msg.b & INPUT_MASK);
        peer.newest = Math.max(peer.newest, msg.k);
        break;
      case "ping":
        peer.send({ t: "pong", c: msg.c });
        break;
      case "resync":
        this.welcome(slot, peer);
        break;
    }
  }

  /** Runs one sim tick. Called at 60Hz by the host. Idle while the room is empty. */
  tick(): void {
    if (this.playerCount === 0) return;
    const target = this.state.tick + 1;
    const frame = noInputs();
    this.peers.forEach((peer, slot) => {
      if (!peer) return;
      peer.last = peer.queued.get(target) ?? peer.last;
      peer.queued.delete(target);
      frame[slot] = peer.last;
    });
    step(this.state, frame);
    if (this.pending.length === 0) this.pendingFrom = this.state.tick;
    this.pending.push(frame);
    if (this.pending.length >= FLUSH_TICKS) this.flush();

    if (this.state.phase !== Phase.Playing && !this.ended) {
      this.ended = true;
      this.flush();
      for (const peer of this.peers) peer?.send({ t: "over", phase: this.state.phase });
      this.onEnd(this.state.phase);
    }
  }

  private flush(): void {
    if (this.pending.length === 0) return;
    const tick = this.state.tick;
    const h: [number, number] | undefined = tick % HASH_EVERY_TICKS < this.pending.length ? [tick, hashState(this.state)] : undefined;
    for (const peer of this.peers) {
      if (!peer) continue;
      peer.send({ t: "f", from: this.pendingFrom, in: this.pending, m: peer.newest - tick, h });
    }
    this.pending = [];
  }

  /** Starts a fresh match in place for hosts that outlive one game (Docker Compose). */
  reset(seed: number): void {
    this.seed = seed;
    this.state = createState(seed);
    this.pending = [];
    this.ended = false;
    this.peers.forEach((peer, slot) => {
      if (!peer) return;
      peer.queued.clear();
      peer.last = 0;
      peer.newest = 0;
      this.welcome(slot, peer);
    });
  }
}
