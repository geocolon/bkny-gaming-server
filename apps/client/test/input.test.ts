import { describe, expect, it } from "vitest";
import { Btn } from "@bkny/sim";
import { Pad, readPad } from "../src/input";
import type { PadLike } from "../src/input";

function pad(pressed: number[] = [], axes = [0, 0, 0, 0]): PadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 }));
  return { index: 0, id: "Xbox Wireless Controller", mapping: "standard", buttons, axes };
}

describe("Xbox pad mapping", () => {
  it("maps face buttons", () => {
    expect(readPad(pad([Pad.X]))).toBe(Btn.Attack);
    expect(readPad(pad([Pad.A]))).toBe(Btn.Jump);
    expect(readPad(pad([Pad.B]))).toBe(Btn.Special);
  });
  it("maps the D-pad", () => {
    expect(readPad(pad([Pad.Up, Pad.Right]))).toBe(Btn.Up | Btn.Right);
  });
  it("ignores stick drift inside the deadzone", () => {
    expect(readPad(pad([], [0.2, -0.15, 0, 0]))).toBe(0);
  });
  it("reads a stick diagonal as two directions", () => {
    expect(readPad(pad([], [0.7, 0.7, 0, 0]))).toBe(Btn.Right | Btn.Down);
  });
  it("reads a mostly horizontal stick as one direction", () => {
    expect(readPad(pad([], [0.95, 0.2, 0, 0]))).toBe(Btn.Right);
  });
  it("does not crash on a pad with few buttons", () => {
    expect(readPad({ ...pad(), buttons: [], axes: [] })).toBe(0);
  });
});
