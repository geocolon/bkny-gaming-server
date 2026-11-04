import { Kind, MAX_PLAYERS, Phase, createState, noInputs, step } from "@bkny/sim";
import type { SimState } from "@bkny/sim";
import { PredictionClient, TICK_MS } from "@bkny/netcode";
import type { ServerMsg } from "@bkny/netcode";
import { Input } from "./input";
import type { DeviceId } from "./input";
import { openConnection } from "./net";
import type { Connection } from "./net";
import { Renderer } from "./render";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const menu = $("menu");
const statusLine = $("status");
const padsLine = $("pads");
const codeInput = $<HTMLInputElement>("code");
const menuButtons = () => [...menu.querySelectorAll<HTMLElement>("button, input")];

const input = new Input();
const renderer = new Renderer($<HTMLCanvasElement>("game"));

interface Local {
  kind: "local";
  state: SimState;
  devices: (DeviceId | null)[];
}
interface Online {
  kind: "online";
  conn: Connection;
  client: PredictionClient | null;
  code: string;
}
let mode: Local | Online | null = null;
let idle = createState(1);

function rumbleHits(s: SimState, slotDevice: (slot: number) => DeviceId | null): void {
  for (const hit of renderer.collectHits(s)) {
    for (const f of s.fighters) {
      if (f.kind !== Kind.Player) continue;
      const device = slotDevice(f.slot);
      if (device === null) continue;
      if (f.id === hit.target) input.rumble(device, 220, 0.9, 0.6);
      else if (f.id === hit.attacker) input.rumble(device, hit.heavy ? 120 : 50, hit.heavy ? 0.6 : 0.2, 0.5);
    }
  }
}

function startLocal(): void {
  const devices = new Array<DeviceId | null>(MAX_PLAYERS).fill(null);
  devices[0] = input.devices[input.devices.length - 1];
  mode = { kind: "local", state: createState(Date.now() | 1), devices };
  menu.hidden = true;
}

function tickLocal(m: Local): void {
  for (const device of input.devices) {
    if (!input.joinPressed(device) || m.devices.includes(device)) continue;
    const slot = m.devices.indexOf(null);
    if (slot >= 0) m.devices[slot] = device;
  }
  const frame = noInputs();
  m.devices.forEach((device, slot) => {
    if (device !== null) frame[slot] = input.bits(device);
  });
  step(m.state, frame);
  rumbleHits(m.state, (slot) => m.devices[slot]);
}

function backToMenu(message: string): void {
  mode = null;
  idle = createState(1);
  menu.hidden = false;
  statusLine.textContent = message;
  menuButtons()[0]?.focus();
}

function onServerMessage(msg: ServerMsg): void {
  if (mode?.kind !== "online") return;
  const m = mode;
  switch (msg.t) {
    case "welcome":
      m.client = new PredictionClient(msg.slot, msg.state, msg.inputs);
      menu.hidden = true;
      break;
    case "f":
      m.client?.onFrames(msg);
      if (m.client?.checkDesync()) m.conn.send({ t: "resync" });
      break;
    case "full":
      statusLine.textContent = "Room is full";
      break;
  }
}

async function startOnline(code: string | null): Promise<void> {
  statusLine.textContent = code ? "Joining…" : "Finding a server…";
  try {
    const pending: Online = { kind: "online", conn: null as unknown as Connection, client: null, code: code ?? "" };
    mode = pending;
    const opened = await openConnection(code, onServerMessage, () => {
      if (mode === pending) backToMenu("Disconnected");
    });
    pending.conn = opened.conn;
    pending.code = opened.code;
  } catch (err) {
    backToMenu(err instanceof Error ? err.message : "Connection failed");
  }
}

$("local").addEventListener("click", startLocal);
$("create").addEventListener("click", () => void startOnline(null));
$("join").addEventListener("click", () => {
  const code = codeInput.value.trim();
  if (code) void startOnline(code);
  else statusLine.textContent = "Enter a room code first";
});

/** The static demo has no edge or game server to connect to. */
if (import.meta.env.VITE_DEMO) {
  $("create").remove();
  $("join-row").remove();
  $("demo-note").hidden = false;
}

input.onPadsChanged = (names) => {
  padsLine.textContent = names.length ? `Controllers: ${names.map((n) => n.split("(")[0].trim()).join(", ")}` : "Plug in an Xbox controller and press any button.";
};

addEventListener("keydown", (e) => {
  if (e.code === "F3") {
    e.preventDefault();
    renderer.debug = !renderer.debug;
  }
});

function menuFrame(): void {
  const { move, confirm } = input.menuInput();
  const items = menuButtons();
  if (move !== 0) {
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + move + items.length) % items.length]?.focus();
  } else if (confirm) {
    const focused = document.activeElement as HTMLElement;
    (items.includes(focused) ? focused : items[0])?.click();
  }
}

let last = performance.now();
let budget = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  input.poll();
  if (!menu.hidden) menuFrame();

  budget = Math.min(budget + (now - last), 250);
  last = now;
  const online = mode?.kind === "online" ? mode : null;
  const interval = online?.client?.tickInterval() ?? TICK_MS;
  while (budget >= interval) {
    budget -= interval;
    if (mode?.kind === "local") tickLocal(mode);
    else if (online?.client) {
      const sent = online.client.advance(input.allBits());
      if (sent) online.conn.send({ t: "i", k: sent.tick, b: sent.bits });
      const slot = online.client.slot;
      rumbleHits(online.client.predicted, (s) => (s === slot ? primaryDevice() : null));
    }
  }

  if (mode?.kind === "local") {
    renderer.draw(mode.state, null, [`tick ${mode.state.tick}`, `phase ${mode.state.phase}`]);
    if (mode.state.phase !== Phase.Playing && input.devices.some((d) => input.joinPressed(d))) backToMenu("");
  } else if (online?.client) {
    const c = online.client;
    renderer.draw(c.predicted, c.slot, [
      `room ${online.code}`,
      `rtt ${online.conn.rtt().toFixed(0)}ms`,
      `tick ${c.predicted.tick} confirmed ${c.confirmed.tick}`,
      `predicting ${c.predictionDepth} margin ${c.margin}`,
      `rollbacks ${c.rollbacks} desyncs ${c.desyncs}`,
    ], online.code);
  } else {
    renderer.draw(idle, null, []);
  }
}

/** Online play has one player per browser; rumble the pad they are actually using. */
function primaryDevice(): DeviceId | null {
  return input.devices.find((d) => d !== "keyboard" && input.bits(d) !== 0) ?? input.devices.find((d) => d !== "keyboard") ?? null;
}

requestAnimationFrame(frame);
