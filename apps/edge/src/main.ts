import { AgonesBackend, StaticBackend, inClusterRequest } from "./backends";
import type { RoomBackend } from "./backends";
import { createEdge } from "./server";

const env = process.env;
const secret = env.EDGE_SECRET;
if (!secret) throw new Error("EDGE_SECRET is required");

const backend: RoomBackend =
  env.BACKEND === "agones"
    ? new AgonesBackend(inClusterRequest(), env.POD_NAMESPACE ?? "bkny", env.FLEET ?? "bkny-game", Number(env.GAME_PORT ?? 7777))
    : new StaticBackend(env.GAME_HOST ?? "server", Number(env.GAME_PORT ?? 7777));

const port = Number(env.PORT ?? 8080);
createEdge(backend, secret).listen(port, () => console.log(`edge on :${port}`));
