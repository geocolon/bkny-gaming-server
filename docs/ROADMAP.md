# Roadmap

Each milestone should end with something playable.

## Milestone 1: Make it fun

- [ ] Commission or draw one playable character and two enemies
- [ ] Add a sprite atlas and animation data, driven by `action` and `actionTick`
- [ ] Add hit sounds and music with Web Audio
- [ ] Add a grab and throw
- [ ] Add pickups: health and one weapon
- [ ] Playtest until a single wave feels good with a controller

## Milestone 2: Make it a game

- [ ] Add data-driven levels instead of the `WAVES` table
- [ ] Build three stages and one boss with phases
- [ ] Add 3 to 4 distinct characters with their own move lists
- [ ] Scale enemy count and health with player count
- [ ] Add a remappable controls screen

## Milestone 3: Harden online play

- [ ] Let players reconnect to their slot after a dropped socket
- [ ] Swap JSON for a binary protocol
- [ ] Interpolate remote players when replays correct them
- [ ] Test with injected latency and packet loss
- [ ] Record inputs per match, so a desync can be replayed exactly
- [ ] Authenticate players and rate-limit room creation

## Milestone 4: Run it for real

- [x] Add CI: tests, image builds
- [ ] Add image scanning to CI
- [ ] Scrape `/metrics` into Prometheus, and alert on tick overruns
- [ ] Run regional clusters, and pick the closest with a latency probe
- [ ] Add quick-play matchmaking with Open Match 2 or Nakama
- [ ] Add accounts and progression
- [ ] Try WebTransport for players on lossy connections

## Before you ship

- Replace all placeholders with art and audio you have rights to.
- Pick an original name and check it for trademark conflicts.
- Add credits and license notices for every third-party asset.
