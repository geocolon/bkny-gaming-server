# BKNY Brawler

[![CI](https://github.com/geocolon/bkny-gaming-server/actions/workflows/ci.yml/badge.svg)](https://github.com/geocolon/bkny-gaming-server/actions/workflows/ci.yml)

An open source template for an online co-op beat 'em up that runs in the browser. It has a deterministic combat simulation, server-authoritative netcode with client prediction, Xbox controller support, and deployment files for Docker, Kubernetes and Agones.

The characters and city are placeholder shapes drawn in code. Swap in your own art, music and story. This is a genre template, so don't add anything copied from an existing game.

## Quick start

Needs Node 22 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. **Local co-op** runs in the page. **Create online room** connects to the dev server on port 7777.

| | Xbox controller | Keyboard |
|---|---|---|
| Move | Left stick or D-pad | Arrows or WASD |
| Attack | X or Y | J |
| Jump | A | K |
| Special (costs health) | B, RB or RT | L |
| Join local play | Menu | Enter |
| Debug overlay | | F3 |

## Run the full stack in Docker

```bash
docker compose up --build
```

Open http://localhost:8088. Set `CLIENT_PORT` to use a different port.

## Layout

| Path | What it is |
|---|---|
| `packages/sim` | The game rules: pure, integer-only, no browser or Node APIs |
| `packages/netcode` | Wire protocol and client prediction |
| `apps/client` | Canvas renderer, input, menus |
| `apps/server` | Authoritative match host, one match per process under Agones |
| `apps/edge` | Room API and WebSocket gateway |
| `deploy/k8s` | Kustomize manifests for Agones and the supporting services |

## Change the game

- **Attacks:** frame data in `packages/sim/src/content.ts`
- **Waves and enemies:** `WAVES` and `PROFILES` in the same file
- **Rules:** `packages/sim/src/step.ts`
- **Look:** `apps/client/src/render.ts`. Nothing in the sim depends on it, so Phaser or PixiJS can replace it.

Keep `step()` deterministic: no `Date`, `Math.random`, or other outside state. The tests fail if the same inputs stop producing the same hash.

```bash
npm test
```

## Docs

- [Architecture](docs/ARCHITECTURE.md): netcode, Docker, Kubernetes and Agones
- [Deploying to Kubernetes](docs/DEPLOY.md)
- [Xbox controllers in the browser](docs/XBOX_CONTROLLER.md)
- [Roadmap](docs/ROADMAP.md)
- [Tutorials and references](docs/TUTORIALS.md)

## License

MIT
