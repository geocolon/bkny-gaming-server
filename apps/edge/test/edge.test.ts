import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { AgonesBackend, StaticBackend } from "../src/backends";
import type { KubeRequest } from "../src/backends";
import { createEdge } from "../src/server";
import { signTicket, verifyTicket } from "../src/token";

describe("tickets", () => {
  const ticket = { host: "10.0.0.1", port: 7777, exp: 1000 };
  it("round-trips", () => expect(verifyTicket(signTicket(ticket, "s"), "s", 999)).toEqual(ticket));
  it("rejects expiry", () => expect(verifyTicket(signTicket(ticket, "s"), "s", 1001)).toBeNull());
  it("rejects the wrong secret", () => expect(verifyTicket(signTicket(ticket, "s"), "x", 999)).toBeNull());
  it("rejects a changed destination", () => {
    const [, sig] = signTicket(ticket, "s").split(".");
    const forged = Buffer.from(JSON.stringify({ ...ticket, host: "169.254.169.254" })).toString("base64url");
    expect(verifyTicket(`${forged}.${sig}`, "s", 999)).toBeNull();
  });
  it("rejects garbage", () => expect(verifyTicket("nope", "s")).toBeNull());
});

describe("AgonesBackend", () => {
  const allocated = {
    state: "Allocated", gameServerName: "bkny-game-abc-xyz", address: "203.0.113.5",
    addresses: [{ type: "ExternalIP", address: "203.0.113.5" }, { type: "PodIP", address: "10.1.2.3" }],
    ports: [{ name: "game", port: 7123 }],
  };
  it("prefers the pod address and sends a GameServerAllocation", async () => {
    let path = ""; let sent: any;
    const kube: KubeRequest = async (_m, p, b) => { path = p; sent = b; return { status: 201, body: { status: allocated } }; };
    const room = await new AgonesBackend(kube, "bkny", "bkny-game", 7777).create();
    expect(room).toEqual({ code: "bkny-game-abc-xyz", host: "10.1.2.3", port: 7777 });
    expect(path).toBe("/apis/allocation.agones.dev/v1/namespaces/bkny/gameserverallocations");
    expect(sent.spec.selectors[0].matchLabels["agones.dev/fleet"]).toBe("bkny-game");
  });
  it("falls back to the host port when no pod address is reported", async () => {
    const kube: KubeRequest = async () => ({ status: 201, body: { status: { ...allocated, addresses: [] } } });
    expect(await new AgonesBackend(kube, "bkny", "f", 7777).create()).toMatchObject({ host: "203.0.113.5", port: 7123 });
  });
  it("returns null when the fleet is exhausted", async () => {
    const kube: KubeRequest = async () => ({ status: 201, body: { status: { state: "UnAllocated" } } });
    expect(await new AgonesBackend(kube, "bkny", "f", 7777).create()).toBeNull();
  });
  it("refuses a code that could change the API path", async () => {
    let called = false;
    const kube: KubeRequest = async () => { called = true; return { status: 200, body: {} }; };
    expect(await new AgonesBackend(kube, "bkny", "f", 7777).find("../../secrets/x")).toBeNull();
    expect(called).toBe(false);
  });
  it("only joins Allocated servers", async () => {
    const kube: KubeRequest = async () => ({ status: 200, body: { status: { ...allocated, state: "Shutdown" } } });
    expect(await new AgonesBackend(kube, "bkny", "f", 7777).find("abc")).toBeNull();
  });
});

describe("edge proxy", () => {
  const closers: (() => void)[] = [];
  afterEach(() => closers.splice(0).forEach((c) => c()));

  async function start() {
    const gameHttp = createServer();
    const game = new WebSocketServer({ server: gameHttp });
    game.on("connection", (s) => s.on("message", (d) => s.send(`echo:${d}`)));
    gameHttp.listen(0, "127.0.0.1");
    await once(gameHttp, "listening");
    const gamePort = (gameHttp.address() as AddressInfo).port;
    const edge = createEdge(new StaticBackend("127.0.0.1", gamePort), "secret");
    edge.listen(0, "127.0.0.1");
    await once(edge, "listening");
    const port = (edge.address() as AddressInfo).port;
    closers.push(() => { edge.closeAllConnections(); edge.close(); game.close(); gameHttp.closeAllConnections(); gameHttp.close(); });
    return port;
  }

  it("issues a ticket and carries WebSocket frames through to the game server", async () => {
    const port = await start();
    const res = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: "POST" });
    const { ticket, code } = (await res.json()) as { ticket: string; code: string };
    expect(code).toBe("local");
    const ws = new WebSocket(`ws://127.0.0.1:${port}/play?ticket=${encodeURIComponent(ticket)}`);
    await once(ws, "open");
    ws.send("hi");
    const [data] = await once(ws, "message");
    expect(String(data)).toBe("echo:hi");
    ws.close();
  });

  it("refuses an upgrade without a valid ticket", async () => {
    const port = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/play?ticket=forged.sig`);
    const [err] = await once(ws, "error");
    expect(String(err)).toContain("401");
  });

  it("returns 404 for an unknown room", async () => {
    const port = await start();
    const res = await fetch(`http://127.0.0.1:${port}/api/rooms/nope/join`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});
