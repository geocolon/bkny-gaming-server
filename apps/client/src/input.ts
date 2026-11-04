import { Btn } from "@bkny/sim";

/** W3C Standard Gamepad button indices, with their Xbox labels. */
export const Pad = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, View: 8, Menu: 9,
  LS: 10, RS: 11, Up: 12, Down: 13, Left: 14, Right: 15, Guide: 16,
} as const;

const DEADZONE = 0.3;

/** The subset of the browser's Gamepad we read; a plain object satisfies it in tests. */
export interface PadLike {
  index: number;
  id: string;
  mapping: string;
  buttons: readonly { pressed: boolean; value: number }[];
  axes: readonly number[];
  vibrationActuator?: GamepadHapticActuator | null;
}

/** Converts a pad to game input bits, using a radial deadzone so diagonals feel right. */
export function readPad(pad: PadLike): number {
  const held = (i: number) => pad.buttons[i]?.pressed ?? false;
  const [ax = 0, ay = 0] = pad.axes;
  const stick = Math.hypot(ax, ay) > DEADZONE;
  // sin(22.5 deg): each direction spans 135 degrees, so diagonals engage both bits.
  const axis = 0.38;
  let bits = 0;
  if (held(Pad.Left) || (stick && ax < -axis)) bits |= Btn.Left;
  if (held(Pad.Right) || (stick && ax > axis)) bits |= Btn.Right;
  if (held(Pad.Up) || (stick && ay < -axis)) bits |= Btn.Up;
  if (held(Pad.Down) || (stick && ay > axis)) bits |= Btn.Down;
  if (held(Pad.X) || held(Pad.Y)) bits |= Btn.Attack;
  if (held(Pad.A)) bits |= Btn.Jump;
  if (held(Pad.B) || held(Pad.RB) || held(Pad.RT)) bits |= Btn.Special;
  return bits;
}

const KEYS: Record<string, number> = {
  ArrowLeft: Btn.Left, KeyA: Btn.Left, ArrowRight: Btn.Right, KeyD: Btn.Right,
  ArrowUp: Btn.Up, KeyW: Btn.Up, ArrowDown: Btn.Down, KeyS: Btn.Down,
  KeyJ: Btn.Attack, KeyK: Btn.Jump, KeyL: Btn.Special,
};

/** One input source: the keyboard, or a pad identified by its browser index. */
export type DeviceId = "keyboard" | number;

export class Input {
  private keys = new Set<string>();
  private pads: PadLike[] = [];
  private pressedLast = new Map<string, boolean>();
  onPadsChanged: (names: string[]) => void = () => {};

  constructor() {
    addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code in KEYS) e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => this.keys.clear());
    const changed = () => {
      this.poll();
      this.onPadsChanged(this.pads.map((p) => p.id));
    };
    addEventListener("gamepadconnected", changed);
    addEventListener("gamepaddisconnected", changed);
  }

  /**
   * Call once per frame. Gamepad objects can be stale snapshots, so never keep
   * one across frames: re-read navigator.getGamepads() every time.
   */
  poll(): void {
    this.pads = (navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => p !== null && p.connected);
  }

  get devices(): DeviceId[] {
    return ["keyboard", ...this.pads.map((p) => p.index)];
  }

  bits(device: DeviceId): number {
    if (device === "keyboard") {
      let bits = 0;
      for (const code of this.keys) bits |= KEYS[code] ?? 0;
      return bits;
    }
    const pad = this.pads.find((p) => p.index === device);
    return pad ? readPad(pad) : 0;
  }

  /** Every device combined, for online play where this browser is one player. */
  allBits(): number {
    let bits = 0;
    for (const device of this.devices) bits |= this.bits(device);
    return bits;
  }

  private edge(key: string, down: boolean): boolean {
    const was = this.pressedLast.get(key) ?? false;
    this.pressedLast.set(key, down);
    return down && !was;
  }

  /** Rising edge of a device's join or confirm control. */
  joinPressed(device: DeviceId): boolean {
    if (device === "keyboard") return this.edge("kb-join", this.keys.has("Enter"));
    const pad = this.pads.find((p) => p.index === device);
    return this.edge(`pad-${device}-join`, !!pad?.buttons[Pad.Menu]?.pressed);
  }

  /** Lets a controller drive the DOM menu: D-pad or stick moves, A confirms. */
  menuInput(): { move: number; confirm: boolean } {
    let up = false;
    let down = false;
    let confirm = false;
    for (const pad of this.pads) {
      const bits = readPad(pad);
      up ||= (bits & Btn.Up) !== 0;
      down ||= (bits & Btn.Down) !== 0;
      confirm ||= pad.buttons[Pad.A]?.pressed ?? false;
    }
    const move = this.edge("menu-up", up) ? -1 : this.edge("menu-down", down) ? 1 : 0;
    return { move, confirm: this.edge("menu-confirm", confirm) };
  }

  /** Rumble is best effort: Firefox and Safari may lack it, and hidden tabs reject it. */
  rumble(device: DeviceId, durationMs: number, strong: number, weak: number): void {
    if (device === "keyboard") return;
    const actuator = this.pads.find((p) => p.index === device)?.vibrationActuator;
    actuator
      ?.playEffect?.("dual-rumble", { duration: durationMs, strongMagnitude: strong, weakMagnitude: weak })
      .catch(() => {});
  }

  rumbleAll(durationMs: number, strong: number, weak: number): void {
    for (const pad of this.pads) this.rumble(pad.index, durationMs, strong, weak);
  }
}
