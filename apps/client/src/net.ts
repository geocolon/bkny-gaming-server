import { PROTOCOL_VERSION } from "@bkny/netcode";
import type { ClientMsg, ServerMsg } from "@bkny/netcode";

const PING_MS = 1000;

export interface Connection {
  send(msg: ClientMsg): void;
  close(): void;
  rtt: () => number;
}

/** Plain Vite dev has no edge, so it talks to the game server on its own port. */
const directUrl = () =>
  new URLSearchParams(location.search).get("ws") ?? (import.meta.env.DEV ? `ws://${location.hostname}:7777` : null);

async function ticketUrl(code: string | null): Promise<{ url: string; code: string }> {
  const direct = directUrl();
  if (direct) return { url: direct, code: "dev" };
  const res = await fetch(code ? `/api/rooms/${encodeURIComponent(code)}/join` : "/api/rooms", { method: "POST" });
  if (!res.ok) throw new Error(code ? "Room not found" : "No game servers available");
  const body = (await res.json()) as { code: string; ticket: string };
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return { url: `${scheme}://${location.host}/play?ticket=${encodeURIComponent(body.ticket)}`, code: body.code };
}

export async function openConnection(
  code: string | null,
  onMessage: (msg: ServerMsg) => void,
  onClose: () => void,
): Promise<{ conn: Connection; code: string }> {
  const target = await ticketUrl(code);
  const socket = new WebSocket(target.url);
  let rtt = 0;
  const send = (msg: ClientMsg) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  };
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("Could not reach the game server"));
  });
  const pinger = setInterval(() => send({ t: "ping", c: performance.now() }), PING_MS);
  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data) as ServerMsg;
    if (msg.t === "pong") rtt = performance.now() - msg.c;
    else onMessage(msg);
  };
  socket.onclose = () => {
    clearInterval(pinger);
    onClose();
  };
  send({ t: "hello", v: PROTOCOL_VERSION });
  return { conn: { send, close: () => socket.close(), rtt: () => rtt }, code: target.code };
}
