import { createServer } from "node:http";
import { randomInt } from "node:crypto";
import { WebSocketServer } from "ws";
import { TICK_RATE } from "@bkny/sim";
import { PROTOCOL_VERSION } from "@bkny/netcode";
import type { ClientMsg } from "@bkny/netcode";
import { createLifecycle } from "./agones";
import { GameRoom } from "./room";

const PORT = Number(process.env.PORT ?? 7777);
const MATCH_END_MS = 8000;
const EMPTY_TIMEOUT_MS = 60_000;
const TICK_MS = 1000 / TICK_RATE;
const MAX_CATCH_UP_TICKS = 10;

const newSeed = () => randomInt(1, 0x7fffffff);
const room = new GameRoom(newSeed());
const lifecycle = await createLifecycle();
let lastTickMs = 0;
let overruns = 0;

const http = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200).end("ok");
  } else if (req.url === "/metrics") {
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4" }).end(
      [
        `bkny_players ${room.playerCount}`,
        `bkny_tick ${room.state.tick}`,
        `bkny_tick_duration_ms ${lastTickMs}`,
        `bkny_tick_overruns_total ${overruns}`,
      ].join("\n") + "\n",
    );
  } else {
    res.writeHead(404).end();
  }
});

// Inputs are tiny. A low cap stops a client from making the sim thread parse a big message.
const wss = new WebSocketServer({ server: http, maxPayload: 1024 });

wss.on("connection", (socket) => {
  let slot = -1;
  socket.on("message", (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return socket.close(1007);
    }
    if (slot < 0) {
      if (msg.t !== "hello" || msg.v !== PROTOCOL_VERSION) return socket.close(4000, "bad protocol");
      slot = room.join((m) => socket.send(JSON.stringify(m)));
      if (slot < 0) socket.close(4001, "full");
      return;
    }
    room.onMessage(slot, msg);
  });
  socket.on("error", () => socket.terminate());
  socket.on("close", () => {
    if (slot >= 0) room.leave(slot);
  });
});

async function stop(): Promise<void> {
  wss.close();
  await lifecycle.shutdown();
  process.exit(0);
}

room.onEnd = () => {
  setTimeout(() => {
    if (lifecycle.singleMatch) void stop();
    else room.reset(newSeed());
  }, MATCH_END_MS);
};

// setInterval alone drifts, so run however many ticks wall-clock time says are due.
let next = performance.now();
let emptySince = performance.now();
let everJoined = false;
setInterval(() => {
  const now = performance.now();
  if (now - next > MAX_CATCH_UP_TICKS * TICK_MS) {
    overruns++;
    next = now - TICK_MS;
  }
  while (next <= now) {
    const start = performance.now();
    room.tick();
    lastTickMs = performance.now() - start;
    next += TICK_MS;
  }
  if (room.playerCount > 0) {
    everJoined = true;
    emptySince = now;
  } else if (lifecycle.singleMatch && everJoined && now - emptySince > EMPTY_TIMEOUT_MS) {
    void stop();
  }
}, TICK_MS / 2);

process.on("SIGTERM", () => void stop());

http.listen(PORT, async () => {
  await lifecycle.ready();
  console.log(`game server on :${PORT}`);
});
