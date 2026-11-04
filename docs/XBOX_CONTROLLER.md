# Xbox controllers in the browser

Browsers read controllers through the [Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API). No driver or plugin is needed in the page. The working code is in [`apps/client/src/input.ts`](../apps/client/src/input.ts).

## Connect it

1. Pair the controller with your computer over Bluetooth, or plug it in if your OS supports it.
2. Open the game in a visible tab.
3. **Press a button.** Browsers hide controllers from a page until one is used, so a pad that looks missing usually just needs a press.

## Read it

Poll every frame. Don't keep a `Gamepad` object from an event, because it can be a stale snapshot.

```js
addEventListener("gamepadconnected", (e) => console.log(e.gamepad.id));

function frame() {
  for (const pad of navigator.getGamepads()) {
    if (!pad) continue; // the array has empty slots
    const attack = pad.buttons[2].pressed; // X
    const moveX = pad.axes[0]; // -1 left, 1 right
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

When `pad.mapping === "standard"`, the indices below are fixed by the W3C spec.

| Index | Xbox | Index | Xbox |
|---|---|---|---|
| 0 | A | 9 | Menu |
| 1 | B | 10 | Left stick click |
| 2 | X | 11 | Right stick click |
| 3 | Y | 12 | D-pad up |
| 4 | LB | 13 | D-pad down |
| 5 | RB | 14 | D-pad left |
| 6 | LT (`value` 0 to 1) | 15 | D-pad right |
| 7 | RT (`value` 0 to 1) | 16 | Xbox button |
| 8 | View | | |

| Axis | Meaning |
|---|---|
| 0 | Left stick, negative is left |
| 1 | Left stick, negative is up |
| 2 | Right stick, negative is left |
| 3 | Right stick, negative is up |

## Handle the real-world problems

- **Stick drift:** a resting stick never reads exactly 0. Measure stick length against a deadzone, here 0.3, rather than checking each axis on its own.
- **Non-standard mapping:** if `mapping` is an empty string, indices aren't guaranteed. Offer a remap screen.
- **Index reuse:** disconnecting and reconnecting can reuse an index, so handle `gamepaddisconnected`.
- **Xbox button:** the OS or browser may capture it. Don't bind gameplay to it.

## Rumble

Rumble isn't Baseline, so always check for it and catch failures. The promise also rejects while the page is hidden.

```js
pad.vibrationActuator
  ?.playEffect("dual-rumble", { duration: 200, strongMagnitude: 0.9, weakMagnitude: 0.6 })
  .catch(() => {});
```

## Test without hardware

Paste this in the console, then press the fake pad with `fake.buttons[2].pressed = true`.

```js
const fake = { index: 0, id: "Fake Xbox", mapping: "standard", connected: true, axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
navigator.getGamepads = () => [fake, null, null, null];
dispatchEvent(new Event("gamepadconnected"));
```
