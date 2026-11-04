import { Action, Kind, LANE_BOTTOM, LANE_TOP, MOVES, Phase, SCREEN_H, SCREEN_W, SUB, isHitActive } from "@bkny/sim";
import type { Fighter, SimState } from "@bkny/sim";

const SLOT_COLORS = ["#ffb000", "#39c5bb", "#ff5c8a", "#9ad14b"];
const ENEMY_COLORS: Record<number, string> = { [Kind.Thug]: "#b45f4d", [Kind.Brute]: "#7a4fa3" };
const SKIN = "#e0ac7e";

interface Spark {
  x: number;
  y: number;
  life: number;
  heavy: boolean;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private sparks: Spark[] = [];
  private seen = new Set<string>();
  private shake = 0;
  debug = false;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
  }

  /**
   * Prediction replays ticks, so one hit can appear in several frames of `hits`.
   * Effects fire once per (tick, attacker, target). Returns the hits that are new.
   */
  collectHits(s: SimState): SimState["hits"] {
    const fresh = s.hits.filter((h) => {
      const key = `${s.tick}:${h.attacker}:${h.target}`;
      if (this.seen.has(key)) return false;
      this.seen.add(key);
      return true;
    });
    if (this.seen.size > 512) this.seen.clear();
    for (const h of fresh) {
      this.sparks.push({ x: h.x / SUB, y: (h.y - h.z) / SUB, life: h.heavy ? 10 : 6, heavy: h.heavy });
      this.shake = Math.max(this.shake, h.heavy ? 4 : 2);
    }
    return fresh;
  }

  private background(cam: number): void {
    const c = this.ctx;
    c.fillStyle = "#1c2233";
    c.fillRect(0, 0, SCREEN_W, SCREEN_H);
    c.fillStyle = "#c9663f";
    c.fillRect(0, 118, SCREEN_W, 12);
    // Far skyline, then rowhouses, at different scroll speeds for parallax.
    c.fillStyle = "#2a3148";
    for (let i = -1; i < 16; i++) {
      const x = i * 44 - (cam * 0.2) % 44;
      c.fillRect(x, 48 + ((i * 37) & 31), 38, 100);
    }
    const near = cam * 0.6;
    for (let i = Math.floor(near / 72) - 1; i < near / 72 + 9; i++) {
      const x = i * 72 - near;
      c.fillStyle = i % 2 ? "#6d3b2e" : "#5a3128";
      c.fillRect(x, 74, 72, 92);
      c.fillStyle = "#f4c95d";
      for (let w = 0; w < 3; w++) for (let h = 0; h < 2; h++) {
        if (((i * 7 + w * 3 + h) & 3) !== 0) c.fillRect(x + 10 + w * 20, 84 + h * 26, 10, 14);
      }
    }
    c.fillStyle = "#4a4d57";
    c.fillRect(0, 166, SCREEN_W, 14);
    c.fillStyle = "#30323a";
    c.fillRect(0, 180, SCREEN_W, 90);
    c.fillStyle = "#e6c84f";
    for (let i = Math.floor(cam / 60) - 1; i < cam / 60 + 10; i++) c.fillRect(i * 60 - cam, 222, 30, 3);
  }

  private fighter(f: Fighter, cam: number): void {
    const c = this.ctx;
    const x = Math.round(f.x / SUB - cam);
    const y = Math.round(f.y / SUB);
    const z = Math.round(f.z / SUB);
    const big = f.kind === Kind.Brute;
    const w = big ? 26 : 16;
    const h = big ? 42 : 34;
    const color = f.kind === Kind.Player ? SLOT_COLORS[f.slot] : ENEMY_COLORS[f.kind];

    c.fillStyle = "rgb(0 0 0 / 0.35)";
    c.beginPath();
    c.ellipse(x, y, w * 0.7, 4, 0, 0, Math.PI * 2);
    c.fill();

    if (f.invuln > 0 && f.action !== Action.Rise && (f.actionTick >> 2) & 1) return;

    const down = f.action === Action.Down || f.action === Action.Dead;
    if (down) {
      c.fillStyle = color;
      c.fillRect(x - h / 2, y - 8, h - 8, 8);
      c.fillStyle = SKIN;
      c.fillRect(x + (f.facing > 0 ? -h / 2 - 8 : h / 2 - 8), y - 8, 8, 8);
      return;
    }

    const top = y - z - h;
    const walk = f.action === Action.Walk ? Math.sin(f.actionTick * 0.4) * 4 : 0;
    c.fillStyle = "#23262f";
    c.fillRect(x - w / 2 + 1, y - z - 12, w / 2 - 2, 12 + (walk > 0 ? -2 : 0));
    c.fillRect(x + 1, y - z - 12, w / 2 - 2, 12 + (walk < 0 ? -2 : 0));
    c.fillStyle = f.action === Action.Hurt ? "#ffffff" : color;
    c.fillRect(x - w / 2, top + 10, w, h - 22);
    c.fillStyle = SKIN;
    c.fillRect(x - 6, top, 12, 11);
    c.fillStyle = "#111";
    c.fillRect(x + f.facing * 2 - 1, top + 3, 3, 2);

    let reach = 4;
    if (f.action === Action.Attack) {
      const m = MOVES[f.move];
      reach = isHitActive(f) ? m.offset + m.reach - 4 : f.actionTick < m.startup ? -4 : 6;
      if (m.aoe && isHitActive(f)) {
        c.fillStyle = SKIN;
        c.fillRect(x - w / 2 - 22, top + 13, 22, 5);
        c.fillRect(x + w / 2, top + 13, 22, 5);
      }
    }
    c.fillStyle = SKIN;
    const armX = f.facing > 0 ? x + w / 2 - 2 : x - w / 2 + 2 - reach;
    c.fillRect(armX, top + 13, reach, 5);
    if (f.kind === Kind.Player) {
      c.fillStyle = color;
      c.font = "8px monospace";
      c.textAlign = "center";
      c.fillText(`P${f.slot + 1}`, x, top - 3);
    }
  }

  private debugOverlay(s: SimState, cam: number): void {
    const c = this.ctx;
    c.strokeStyle = "#39ff14";
    c.strokeRect(0, LANE_TOP, SCREEN_W, LANE_BOTTOM - LANE_TOP);
    c.strokeStyle = "#ff3b3b";
    for (const f of s.fighters) {
      if (!isHitActive(f)) continue;
      const m = MOVES[f.move];
      const a = f.x / SUB + f.facing * m.offset - cam;
      const b = f.x / SUB + f.facing * (m.offset + m.reach) - cam;
      c.strokeRect(Math.min(a, b), f.y / SUB - m.depth - 20, Math.abs(b - a), m.depth * 2);
    }
  }

  private hud(s: SimState, local: number | null, lines: string[], room: string): void {
    const c = this.ctx;
    c.textAlign = "left";
    c.font = "8px monospace";
    if (room) {
      c.fillStyle = "#f1eee6";
      c.fillText(`ROOM ${room}`, 8, SCREEN_H - 6);
    }
    for (const p of s.fighters) {
      if (p.kind !== Kind.Player) continue;
      const x = 8 + p.slot * 118;
      c.fillStyle = "#000a";
      c.fillRect(x, 6, 106, 16);
      c.fillStyle = SLOT_COLORS[p.slot];
      c.fillText(`P${p.slot + 1}${p.slot === local ? "*" : ""} x${p.lives}  ${p.score}`, x + 3, 13);
      c.fillStyle = "#511";
      c.fillRect(x + 3, 16, 100, 4);
      c.fillStyle = p.hp < 30 ? "#ff4d4d" : "#4dff88";
      c.fillRect(x + 3, 16, p.hp / 1.2, 4);
    }
    if (s.lockX < 0 && s.phase === Phase.Playing && s.fighters.length > 0) {
      c.fillStyle = "#ffb000";
      c.textAlign = "right";
      if ((s.tick >> 5) & 1) c.fillText("GO >>", SCREEN_W - 10, 60);
    }
    if (s.phase !== Phase.Playing) {
      c.fillStyle = "#000b";
      c.fillRect(0, 110, SCREEN_W, 44);
      c.fillStyle = "#ffb000";
      c.textAlign = "center";
      c.font = "20px monospace";
      c.fillText(s.phase === Phase.Victory ? "STREET CLEARED" : "GAME OVER", SCREEN_W / 2, 139);
    }
    if (this.debug) {
      c.fillStyle = "#39ff14";
      c.textAlign = "left";
      c.font = "8px monospace";
      lines.forEach((line, i) => c.fillText(line, 8, 34 + i * 9));
    }
  }

  draw(s: SimState, local: number | null, debugLines: string[], room = ""): void {
    const c = this.ctx;
    const cam = s.camX / SUB;
    c.save();
    if (this.shake > 0) {
      c.translate(this.shake & 1 ? this.shake : -this.shake, 0);
      this.shake--;
    }
    this.background(cam);
    const ordered = [...s.fighters].sort((a, b) => a.y - b.y || a.id - b.id);
    for (const f of ordered) this.fighter(f, cam);
    this.sparks = this.sparks.filter((p) => p.life > 0);
    for (const p of this.sparks) {
      c.fillStyle = p.life & 1 ? "#fff" : "#ffd447";
      const size = p.life * (p.heavy ? 2 : 1.4);
      c.fillRect(p.x - cam - size / 2, p.y - size / 2, size, size);
      p.life--;
    }
    if (this.debug) this.debugOverlay(s, cam);
    c.restore();
    this.hud(s, local, debugLines, room);
  }
}
