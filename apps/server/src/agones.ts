/** Lifecycle hooks a host needs. `AGONES=1` selects the real SDK; otherwise these are no-ops. */
export interface Lifecycle {
  ready(): Promise<void>;
  shutdown(): Promise<void>;
  /** True when one match means one process, so the host should exit after it. */
  singleMatch: boolean;
}

const noop: Lifecycle = { ready: async () => {}, shutdown: async () => {}, singleMatch: false };

const HEALTH_MS = 2000;

export async function createLifecycle(): Promise<Lifecycle> {
  if (process.env.AGONES !== "1") return noop;
  // Loaded lazily: the SDK pulls in gRPC, which plain Docker runs never need.
  const { default: AgonesSDK } = await import("@google-cloud/agones-sdk");
  const sdk = new AgonesSDK();
  await sdk.connect();
  const health = setInterval(() => sdk.health(() => {}), HEALTH_MS);
  return {
    singleMatch: true,
    ready: async () => {
      await sdk.ready();
    },
    shutdown: async () => {
      clearInterval(health);
      await sdk.shutdown();
    },
  };
}
