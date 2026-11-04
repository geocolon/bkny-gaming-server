import { describe, expect, it } from "vitest";
import { ABSENT, Btn, hashState } from "@bkny/sim";
import { PredictionClient } from "@bkny/netcode";
import type { ClientMsg, ServerMsg } from "@bkny/netcode";
import { GameRoom } from "../../../apps/server/src/room";

/** Delivers messages in order after a jittered delay, as TCP does on a real link. */
class Link<T> {
  private queue: { at: number; msg: T }[] = [];
  private lastAt = 0;
  constructor(private latency: number, private jitter: number, private rand: () => number) {}
  push(now: number, msg: T) {
    this.lastAt = Math.max(this.lastAt, now + this.latency + Math.floor(this.rand() * this.jitter));
    this.queue.push({ at: this.lastAt, msg });
  }
  drain(now: number): T[] {
    const out: T[] = [];
    while (this.queue.length && this.queue[0].at <= now) out.push(this.queue.shift()!.msg);
    return out;
  }
}

function makeRand(seed: number) {
  let x = seed;
  return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

interface Peer {
  up: Link<ClientMsg>;
  down: Link<ServerMsg>;
  client: PredictionClient | null;
  slot: number;
  bits: (tick: number) => number;
  clockAt: number;
}

/** Runs a room and clients against each other on a shared virtual clock, in ms. */
function simulate(latencies: [number, number][], durationMs: number) {
  const rand = makeRand(99);
  const room = new GameRoom(77);
  const peers: Peer[] = latencies.map(([lat, jit], i) => {
    const peer: Peer = {
      up: new Link(lat, jit, rand), down: new Link(lat, jit, rand), client: null, slot: -1, clockAt: 0,
      bits: (t) => (i === 0 ? Btn.Right : 0) | (t % (17 + i) === 0 ? Btn.Attack : 0),
    };
    return peer;
  });
  let now = 0;
  peers.forEach((p) => {
    p.slot = room.join((m) => p.down.push(now, m));
  });
  const serverStep = 1000 / 60;
  let serverAt = 0;
  for (now = 0; now < durationMs; now++) {
    while (serverAt <= now) {
      for (const p of peers) for (const m of p.up.drain(now)) room.onMessage(p.slot, m);
      room.tick();
      serverAt += serverStep;
    }
    for (const p of peers) {
      for (const m of p.down.drain(now)) {
        if (m.t === "welcome") {
          p.client = new PredictionClient(m.slot, m.state, m.inputs);
          p.clockAt = now;
        } else if (m.t === "f") {
          p.client?.onFrames(m);
          expect(p.client?.checkDesync() ?? false).toBe(false);
        }
      }
      while (p.client && p.clockAt <= now) {
        p.clockAt += p.client.tickInterval();
        const tick = p.client.predicted.tick + 1;
        const sent = p.client.advance(p.bits(tick));
        if (sent) p.up.push(now, { t: "i", k: sent.tick, b: sent.bits });
      }
    }
  }
  return { room, peers };
}

describe("prediction against a server", () => {
  it("keeps all clients converged across uneven latency", () => {
    const { room, peers } = simulate([[20, 5], [80, 30], [140, 40]], 20_000);
    for (const p of peers) {
      const c = p.client!;
      expect(c.desyncs).toBe(0);
      expect(room.state.tick - c.confirmed.tick).toBeLessThan(40);
      expect(c.rollbacks).toBeGreaterThan(100);
    }
  });

  it("settles each client's clock so inputs arrive just in time", () => {
    const { peers } = simulate([[50, 10]], 15_000);
    const c = peers[0].client!;
    expect(c.margin).toBeGreaterThanOrEqual(0);
    expect(c.margin).toBeLessThanOrEqual(9);
  });

  it("shows local input immediately, before the server has seen it", () => {
    const state = new GameRoom(5);
    let welcome: Extract<ServerMsg, { t: "welcome" }> | undefined;
    state.join((m) => { if (m.t === "welcome") welcome = m; });
    const c = new PredictionClient(welcome!.slot, welcome!.state, welcome!.inputs);
    const startX = c.predicted.fighters[0].x;
    c.advance(Btn.Right);
    expect(c.predicted.fighters[0].x).toBeGreaterThan(startX);
    expect(c.confirmed.tick).toBe(0);
  });

  it("stalls instead of predicting without limit when the server goes quiet", () => {
    const room = new GameRoom(5);
    let welcome: Extract<ServerMsg, { t: "welcome" }> | undefined;
    room.join((m) => { if (m.t === "welcome") welcome = m; });
    const c = new PredictionClient(0, welcome!.state, welcome!.inputs);
    let stalled = false;
    for (let i = 0; i < 100; i++) stalled = c.advance(0) === null || stalled;
    expect(stalled).toBe(true);
  });

  it("flags a desync when hashes differ", () => {
    const room = new GameRoom(5);
    let welcome: Extract<ServerMsg, { t: "welcome" }> | undefined;
    room.join((m) => { if (m.t === "welcome") welcome = m; });
    const c = new PredictionClient(0, welcome!.state, welcome!.inputs);
    const frame = [0, ABSENT, ABSENT, ABSENT];
    c.onFrames({ t: "f", from: 1, in: [frame], m: 0, h: [1, 12345] });
    expect(c.checkDesync()).toBe(true);
    expect(c.desyncs).toBe(1);
  });

  it("lets a late joiner reach the same state from a snapshot", () => {
    const room = new GameRoom(5);
    room.join(() => {});
    for (let i = 0; i < 301; i++) room.tick();
    let late: PredictionClient | null = null;
    room.join((m) => {
      if (m.t === "welcome") late = new PredictionClient(m.slot, m.state, m.inputs);
      else if (m.t === "f") late?.onFrames(m);
    });
    for (let i = 0; i < 200; i++) room.tick();
    room.tick();
    room.tick();
    const c = late as unknown as PredictionClient;
    expect(c.confirmed.tick).toBeGreaterThan(room.state.tick - 3);
    if (c.confirmed.tick === room.state.tick) expect(hashState(c.confirmed)).toBe(hashState(room.state));
  });

  it("rejects inputs far in the future and strips unknown bits", () => {
    const room = new GameRoom(5);
    const slot = room.join(() => {});
    room.onMessage(slot, { t: "i", k: 100_000, b: 1 });
    room.onMessage(slot, { t: "i", k: 1, b: 0xffff });
    room.tick();
    expect(room.state.fighters[0].prevInput).toBe(0x7f);
  });
});
