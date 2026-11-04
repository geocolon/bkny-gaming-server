import { readFileSync } from "node:fs";
import { request } from "node:https";

export interface Upstream {
  code: string;
  host: string;
  port: number;
}

export interface RoomBackend {
  create(): Promise<Upstream | null>;
  find(code: string): Promise<Upstream | null>;
}

/** Docker Compose: one long-lived game server, one room. */
export class StaticBackend implements RoomBackend {
  constructor(private host: string, private port: number) {}
  async create() {
    return { code: "local", host: this.host, port: this.port };
  }
  async find(code: string) {
    return code === "local" ? this.create() : null;
  }
}

export type KubeRequest = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;

const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";

export function inClusterRequest(): KubeRequest {
  const ca = readFileSync(`${SA_DIR}/ca.crt`);
  return (method, path, body) =>
    new Promise((resolve, reject) => {
      // Read per call: Kubernetes rotates projected service account tokens.
      const token = readFileSync(`${SA_DIR}/token`, "utf8");
      const req = request(
        {
          host: process.env.KUBERNETES_SERVICE_HOST,
          port: Number(process.env.KUBERNETES_SERVICE_PORT ?? 443),
          method, path, ca,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        },
        (res) => {
          let raw = "";
          res.on("data", (d) => (raw += d));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : {} }));
        },
      );
      req.on("error", reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
}

interface GameServerStatus {
  state?: string;
  address?: string;
  addresses?: { type: string; address: string }[];
  ports?: { name?: string; port: number }[];
}

/**
 * Agones-backed rooms. A room code is the GameServer's name, so any edge replica
 * can resolve it from the Kubernetes API and the edge itself stays stateless.
 */
export class AgonesBackend implements RoomBackend {
  constructor(private kube: KubeRequest, private namespace: string, private fleet: string, private containerPort: number) {}

  private upstream(name: string, status: GameServerStatus): Upstream | null {
    const podIp = status.addresses?.find((a) => a.type === "PodIP")?.address;
    if (podIp) return { code: name, host: podIp, port: this.containerPort };
    const hostPort = status.ports?.[0]?.port;
    return status.address && hostPort ? { code: name, host: status.address, port: hostPort } : null;
  }

  async create() {
    const { status, body } = await this.kube("POST", `/apis/allocation.agones.dev/v1/namespaces/${this.namespace}/gameserverallocations`, {
      apiVersion: "allocation.agones.dev/v1",
      kind: "GameServerAllocation",
      spec: { selectors: [{ matchLabels: { "agones.dev/fleet": this.fleet } }] },
    });
    if (status >= 300 || body.status?.state !== "Allocated") return null;
    return this.upstream(body.status.gameServerName, body.status);
  }

  async find(code: string) {
    if (!/^[a-z0-9-]{1,63}$/.test(code)) return null;
    const { status, body } = await this.kube("GET", `/apis/agones.dev/v1/namespaces/${this.namespace}/gameservers/${code}`);
    if (status !== 200 || body.status?.state !== "Allocated") return null;
    return this.upstream(code, body.status);
  }
}
