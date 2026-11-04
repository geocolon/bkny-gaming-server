import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { connect } from "node:net";
import type { Socket } from "node:net";
import type { RoomBackend, Upstream } from "./backends";
import { signTicket, verifyTicket } from "./token";

const TICKET_SECONDS = 60;
const ROOM_CODE = /^\/api\/rooms\/([^/]+)\/join$/;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

export function createEdge(backend: RoomBackend, secret: string): Server {
  const issue = (room: Upstream | null, res: ServerResponse) => {
    if (!room) return json(res, 404, { error: "room unavailable" });
    const exp = Math.floor(Date.now() / 1000) + TICKET_SECONDS;
    json(res, 200, { code: room.code, ticket: signTicket({ host: room.host, port: room.port, exp }, secret) });
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/healthz") return void res.writeHead(200).end("ok");
    if (req.method === "POST" && path === "/api/rooms") return issue(await backend.create(), res);
    const join = req.method === "POST" ? ROOM_CODE.exec(path) : null;
    if (join) return issue(await backend.find(join[1]), res);
    json(res, 404, { error: "not found" });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      json(res, 502, { error: "backend failure" });
    });
  });

  // Byte-level proxy: replays the upgrade request upstream, then pipes frames both ways.
  server.on("upgrade", (req: IncomingMessage, client: Socket, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://edge");
    const ticket = url.pathname === "/play" ? verifyTicket(url.searchParams.get("ticket") ?? "", secret) : null;
    if (!ticket) {
      client.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = connect(ticket.port, ticket.host, () => {
      const lines = [`GET / HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(lines.join("\r\n") + "\r\n\r\n");
      upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.setNoDelay(true);
    client.setNoDelay(true);
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
    client.on("close", () => upstream.destroy());
  });
  return server;
}
