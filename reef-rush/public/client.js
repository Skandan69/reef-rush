/* ============================================================================
   REEF RUSH
   A hand-drawn-feeling coral reef rendered entirely with canvas paths:
   spine-driven fish that actually undulate, caustic light, drifting plankton.
   Simulation is local and frame-rate independent; the room keeps the board.
   ========================================================================== */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const angDelta = (a, b) => ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

const WORLD = { w: 16800, h: 6200 };  /* replaced at boot by the chosen tank */
let MAX_FISH = 22;
let MAX_FOOD = 150;
const PLAYER_START_MASS = 48;
/* Deep Strike: everyone in the water is this size, you included. The board
   showed ninety-nine fish at 260 and you at 48, in ninety-fifth place, before
   a shot was fired. */
const SK_MASS = 260;
const GROWTH = 0.34;          /* fraction of a meal that becomes your own mass */
const AI_MAX_MASS = 6500;      /* bots stop growing here */
/* The hard ceiling on a player. Past this the camera cannot pull back far
   enough to frame the fish and it swallows the screen, so growth stops and
   everything after it is scored instead of eaten. */
const PLAYER_MAX_MASS = 16000;
const EAT_RATIO = 1.25;       /* radius advantage needed to swallow anything */
const PREY_RATIO = 1 / EAT_RATIO;
const SAFE_SPAWN_SECONDS = 14; /* no predators seeded near a fresh fish */
const AI_SAFE_SECONDS = 2.5;   /* a fish that just arrived cannot eat or be eaten */
/* The sand, the coral and the kelp roots live in the bottom of the world.
   Nothing swims down there — the swimmable floor sits above all of it. */
const SEABED_CLEAR = 240;
const swimFloor = () => WORLD.h - SEABED_CLEAR;
const BOT_NAMES = [
  "Aditya", "Mira", "Kenji", "Sofia", "Omar", "Lena", "Diego", "Priya",
  "Noah", "Yuki", "Amara", "Tomas", "Zara", "Ivan", "Chloe", "Rahul",
  "Ines", "Kofi", "Elena", "Marco", "Aisha", "Bruno", "Hana", "Luca",
  "Nadia", "Felix", "Rosa", "Emeka", "Anya", "Mateo", "Leila", "Jonas",
  "Sana", "Pablo", "Freya", "Arjun", "Nora", "Dmitri", "Isla", "Tariq",
];

/* ---------------------------------------------------------------- audio --- */
const Snd = (() => {
  let ctx = null, bus = null, noiseBuf = null, started = false;
  let muted = false;
  try { muted = localStorage.getItem("rr_mute") === "1"; } catch (e) {}

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    bus = ctx.createGain();
    bus.gain.value = muted ? 0 : 0.5;
    bus.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const ok = (v, fb) => (Number.isFinite(v) ? v : fb);
  function tone(f0, f1, dur, gain, type) {
    if (!ctx || muted) return;
    /* Math.max(20, NaN) is NaN, so a bad frequency sailed into WebAudio and
       threw. A sound effect must never be able to take the game down. */
    f0 = ok(f0, 220); f1 = ok(f1, 220); dur = Math.max(0.01, ok(dur, 0.1)); gain = ok(gain, 0.2);
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type || "sine";
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, type, f0, f1, gain) {
    if (!ctx || muted) return;
    dur = Math.max(0.01, ok(dur, 0.1)); f0 = ok(f0, 600); f1 = ok(f1, 600); gain = ok(gain, 0.2);
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = type; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.linearRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp); bp.connect(g); g.connect(bus);
    s.start(t); s.stop(t + dur + 0.03);
  }
  return {
    unlock() {
      init();
      if (ctx && ctx.state === "suspended") ctx.resume();
      if (!ctx || started) return;
      started = true;
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf; s.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 300;
      const g = ctx.createGain(); g.gain.value = 0.055;
      s.connect(lp); lp.connect(g); g.connect(bus); s.start();
      const o = ctx.createOscillator();
      o.type = "sine"; o.frequency.value = 55;
      const og = ctx.createGain(); og.gain.value = 0.05;
      o.connect(og); og.connect(bus); o.start();
    },
    toggle() {
      muted = !muted;
      try { localStorage.setItem("rr_mute", muted ? "1" : "0"); } catch (e) {}
      if (bus) bus.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    get muted() { return muted; },
    food() { tone(760, 1240, 0.055, 0.05, "triangle"); },
    eat(p) { tone(420 + p * 220, 880 + p * 380, 0.11, 0.14); noise(0.09, "highpass", 900, 2600, 0.05); },
    dash() { noise(0.28, "bandpass", 300, 1500, 0.075); },
    grow() { tone(360, 700, 0.3, 0.1, "triangle"); },
    die() { tone(230, 46, 0.95, 0.2, "sawtooth"); noise(0.75, "lowpass", 1000, 110, 0.13); },
    spit() { noise(0.16, "bandpass", 1500, 400, 0.09); tone(300, 140, 0.14, 0.07, "square"); },
    hit() { tone(200, 90, 0.16, 0.13, "square"); noise(0.12, "highpass", 1400, 600, 0.07); },
    net() { noise(0.3, "highpass", 2600, 900, 0.06); },
    pickup() { tone(620, 1320, 0.18, 0.11, "triangle"); tone(940, 1560, 0.14, 0.06); },
    warp() { tone(180, 1400, 0.42, 0.12, "sine"); noise(0.42, "bandpass", 300, 2600, 0.08); },
  };
})();

/* --------------------------------------------------------------- canvas --- */
const cv = document.getElementById("game");
const ctx = cv.getContext("2d", { alpha: false });
const mapCv = document.getElementById("map");
const mapCtx = mapCv.getContext("2d");
let VW = 0, VH = 0, DPR = 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  VW = window.innerWidth;
  VH = window.innerHeight;
  cv.width = Math.floor(VW * DPR);
  cv.height = Math.floor(VH * DPR);
  cv.style.width = VW + "px";
  cv.style.height = VH + "px";
}
window.addEventListener("resize", resize);
resize();

const cam = { x: WORLD.w / 2, y: WORLD.h / 2, z: 1, tz: 1, shake: 0 };

/* ---------------------------------------------------------------- input --- */
const IN = {
  px: 0, py: 0, has: false, dash: false, spit: false, net: false, keys: Object.create(null),
  touch: matchMedia("(pointer: coarse)").matches,
};
if (IN.touch) document.body.classList.add("touch");

function setPointer(x, y) { IN.px = x; IN.py = y; IN.has = true; }

let lastMX = 0, lastMY = 0;
cv.addEventListener("mousemove", (e) => {
  setPointer(e.clientX, e.clientY);
  if (MODE === "tank") {
    TANKV.moved += Math.hypot(e.clientX - lastMX, e.clientY - lastMY);
    if (TANKV.drag >= 0) tankDragMove(e.clientX, e.clientY);
    else if (TANKV.panning && (e.buttons & 1)) tankPan(e.clientX - lastMX, e.clientY - lastMY);
  }
  lastMX = e.clientX; lastMY = e.clientY;
});
window.addEventListener("mouseup", (e) => {
  if (MODE !== "tank") return;
  const slid = Math.hypot(e.clientX - TANKV.downX, e.clientY - TANKV.downY);
  /* a press that did not travel is a click, and a click places a piece */
  if (TANKV.drag < 0 && TANKV.panning && slid < 6) tankClick(e.clientX, e.clientY);
  TANKV.panning = false;
  tankDragEnd();
});
cv.addEventListener("wheel", (e) => {
  if (MODE !== "tank") return;
  e.preventDefault();
  tankZoom(e.deltaY < 0 ? 1.16 : 1 / 1.16, e.clientX, e.clientY);
}, { passive: false });
cv.addEventListener("mousedown", (e) => {
  Snd.unlock();
  if (MODE === "tank") {
    if (e.button !== 0) return;
    TANKV.downX = e.clientX; TANKV.downY = e.clientY; TANKV.moved = 0;
    TANKV.panning = !tankDragStart(e.clientX, e.clientY);
    return;
  }
  if (e.button === 0) IN.spit = true;
  if (e.button === 2 || e.button === 1) { IN.net = true; e.preventDefault(); }
});
window.addEventListener("mouseup", (e) => { if (e.button === 0) IN.spit = false; });
cv.addEventListener("contextmenu", (e) => e.preventDefault());
cv.addEventListener("touchstart", (e) => {
  Snd.unlock();
  const t = e.touches[0];
  if (t) setPointer(t.clientX, t.clientY);
  if (MODE === "tank" && t) {
    TANKV.downX = t.clientX; TANKV.downY = t.clientY;
    TANKV.panning = !tankDragStart(t.clientX, t.clientY);
    lastMX = t.clientX; lastMY = t.clientY;
    if (e.touches.length === 2) TANKV.pinch = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  }
}, { passive: true });
cv.addEventListener("touchmove", (e) => {
  const t = e.touches[0];
  if (t) setPointer(t.clientX, t.clientY);
  if (MODE === "tank" && t) {
    if (e.touches.length === 2 && TANKV.pinch) {
      const d2 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      tankZoom(d2 / TANKV.pinch, (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
      TANKV.pinch = d2;
    } else if (TANKV.drag >= 0) tankDragMove(t.clientX, t.clientY);
    else if (TANKV.panning) tankPan(t.clientX - lastMX, t.clientY - lastMY);
    lastMX = t.clientX; lastMY = t.clientY;
  }
}, { passive: true });
cv.addEventListener("touchend", (e) => {
  if (MODE !== "tank") return;
  TANKV.pinch = 0;
  const slid = Math.hypot(lastMX - TANKV.downX, lastMY - TANKV.downY);
  if (TANKV.drag < 0 && TANKV.panning && slid < 8) tankClick(lastMX, lastMY);
  TANKV.panning = false;
  tankDragEnd();
});

window.addEventListener("keydown", (e) => {
  IN.keys[e.code] = true;
  if (e.code === "KeyF") IN.spit = true;
  if (e.code === "KeyQ") IN.net = true;
  if (e.code === "Space" || e.code === "ShiftLeft" || e.code === "ShiftRight") {
    IN.dash = true;
    if (e.code === "Space") e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  IN.keys[e.code] = false;
  if (e.code === "KeyF") IN.spit = false;
  if (e.code === "Space" || e.code === "ShiftLeft" || e.code === "ShiftRight") IN.dash = false;
});
window.addEventListener("blur", () => { IN.keys = Object.create(null); IN.dash = false; });

const boostBtn = document.getElementById("boost");
const holdOn = (e) => { e.preventDefault(); IN.dash = true; };
const holdOff = () => { IN.dash = false; };
boostBtn.addEventListener("touchstart", holdOn, { passive: false });
boostBtn.addEventListener("touchend", holdOff);
boostBtn.addEventListener("touchcancel", holdOff);
boostBtn.addEventListener("mousedown", holdOn);
window.addEventListener("mouseup", holdOff);

/* -------------------------------------------------------------- species --- */
/* back = dorsal colour, belly = ventral, fin, glow = rim tint */
const SPECIES = [
  { id: "tang",     back: "#2f7de0", belly: "#8fd8ff", fin: "#ffd45e", stripe: null,      len: 1.7, fat: 0.62 },
  { id: "clown",    back: "#f4802a", belly: "#ffd9a8", fin: "#ffe9c4", stripe: "#fff6e8", len: 1.75, fat: 0.6 },
  { id: "emerald",  back: "#17997a", belly: "#a8f2cf", fin: "#ffe07a", stripe: null,      len: 1.9, fat: 0.5 },
  { id: "rose",     back: "#d94f76", belly: "#ffc7d8", fin: "#ffd9e6", stripe: null,      len: 1.8, fat: 0.55 },
  { id: "silver",   back: "#5d7b91", belly: "#e2f1fb", fin: "#cfe6f3", stripe: null,      len: 2.1, fat: 0.44 },
  { id: "violet",   back: "#6b52c9", belly: "#cbbcff", fin: "#9be8ff", stripe: null,      len: 1.85, fat: 0.56 },
  { id: "butter",   back: "#e0a11c", belly: "#fff0b8", fin: "#fff4cd", stripe: "#7a4b06", len: 1.65, fat: 0.66 },
  { id: "teal",     back: "#118c9e", belly: "#a9ecf5", fin: "#ffb36b", stripe: null,      len: 1.8, fat: 0.58 },
];
const PREDATORS = [
  { id: "barra",    back: "#4a6072", belly: "#dfeef7", fin: "#b7cddb", stripe: null,      len: 2.55, fat: 0.36 },
  { id: "grouper",  back: "#6b4a3a", belly: "#e6c9a8", fin: "#caa27c", stripe: "#3d2618", len: 1.95, fat: 0.68 },
  { id: "shark",    back: "#4b5b68", belly: "#e8f1f6", fin: "#8ea4b3", stripe: null,      len: 2.5, fat: 0.42 },
  { id: "tuna",     back: "#2b5f8a", belly: "#dff0fb", fin: "#ffd45e", stripe: null,      len: 2.3, fat: 0.48 },
];
let PLAYER_SKIN = { id: "you", back: "#ff8a2b", belly: "#ffe3b4", fin: "#ffd05e", stripe: "#fff8ec", len: 1.8, fat: 0.6 };

/* Every fish — yours and every bot — is one of these, chosen purely by size.
   `fat` reshapes the body, `tail` and `fin` resize the fins, so a shark reads
   as a shark at a glance and a wall of same-sized fish becomes a food chain. */
const STAGES = [
  { r: 62,   name: "Tadpole",   fat: 1.22, tail: 0.55, fin: 1.5 },
  { r: 96,   name: "Fry",       fat: 1.12, tail: 0.7,  fin: 1.9 },
  { r: 150,  name: "Minnow",    fat: 1.05, tail: 0.85, fin: 2.1 },
  { r: 230,  name: "Reef Fish", fat: 1.0,  tail: 1.0,  fin: 2.25 },
  { r: 330,  name: "Snapper",   fat: 0.94, tail: 1.05, fin: 2.2 },
  { r: 440,  name: "Barracuda", fat: 0.74, tail: 1.15, fin: 1.9 },
  { r: 560,  name: "Marlin",    fat: 0.7,  tail: 1.35, fin: 2.5 },
  { r: 690,  name: "Shark",     fat: 0.76, tail: 1.3,  fin: 3.0 },
  { r: 1e9,  name: "Whale",     fat: 1.25, tail: 1.0,  fin: 1.5 },
];
const tierFor = (r) => { for (const s of STAGES) if (r < s.r) return s; return STAGES[STAGES.length - 1]; };
const stageFor = (r) => tierFor(r).name;
const radiusOf = (mass) => Math.sqrt(mass) * 6;

/* ------------------------------------------------------------- entities --- */
const SEGS = 9;
let fishes = [];
let food = [];
let bits = [];      /* bubbles, sparks, rings */
let texts = [];     /* floating +score */
let kelp = [];
let rocks = [];
let corals = [];
let motes = [];
let T = 0;

function layoutSpine(f) {
  f.segLen = (f.r * 2) / (SEGS - 1);
  if (f.seg.length !== SEGS) {
    f.seg = [];
    for (let i = 0; i < SEGS; i++) f.seg.push({ x: f.x, y: f.y });
  }
  const cx = Math.cos(f.a), cy = Math.sin(f.a);
  for (let i = 0; i < SEGS; i++) {
    f.seg[i].x = f.x - cx * f.segLen * i;
    f.seg[i].y = f.y - cy * f.segLen * i;
  }
}

function makeFish(kind, mass, x, y, skin) {
  const f = {
    kind, mass, r: radiusOf(mass), x, y,
    a: rnd(0, TAU), sp: 0, tsp: 0, ta: 0,
    skin: skin || pick(SPECIES),
    seg: [], segLen: 1,
    phase: rnd(0, TAU), wob: rnd(0.86, 1.16),
    side: 1, sideT: 1, flip: 1,
    noiseT: rnd(0, 400), think: rnd(0, 0.5),
    panic: 0, boost: 0, dead: false, munch: 0, pop: 0, warp: 0, netted: 0, spitCd: rnd(2, 8), safe: 0,
    grad: null, gradR: -1, gradFlip: null,
  };
  f.ta = f.a;
  layoutSpine(f);
  return f;
}

/* Speed grows with size so that, once the camera zoom is folded in, everything
   moves at a readable pace on screen. Big fish win a straight line; small fish
   win the corner — that trade is the whole game. */
function speedOf(f) {
  const base = (86 + f.r * 0.52) * f.wob;
  return f.kind === "player" ? base * 1.22 : base;
}

/* ---- the reef backdrop is generated once, deterministically per session --- */
function buildScenery() {
  /* density, not quantity: a tank twice the size needs twice the reef in it */
  const area = clamp((WORLD.w * WORLD.h) / (16800 * 6200), 0.45, 2.2);
  const N = (base) => Math.round(base * area);
  kelp = [];
  corals = [];
  motes = [];
  for (let i = 0; i < N(290); i++) {
    kelp.push({
      x: rnd(0, WORLD.w), h: rnd(340, 1150), w: rnd(14, 40),
      hue: rnd(120, 168), depth: rnd(0.35, 1), sway: rnd(0.5, 1.5), ph: rnd(0, TAU),
      blades: 3 + ((Math.random() * 4) | 0),
    });
  }
  for (let i = 0; i < N(290); i++) {
    corals.push({
      x: rnd(0, WORLD.w), s: rnd(45, 380) * (Math.random() < 0.25 ? 1.5 : 1), depth: rnd(0.35, 1),
      hue: pick([12, 22, 300, 330, 190, 45]), arms: 4 + ((Math.random() * 5) | 0), ph: rnd(0, TAU),
    });
  }
  rocks = [];
  for (let i = 0; i < N(50); i++) {
    rocks.push({ x: rnd(0, WORLD.w), y: rnd(WORLD.h * 0.3, WORLD.h * 0.9), w: rnd(120, 340), h: rnd(420, 1100), depth: rnd(0.2, 0.55), hue: rnd(176, 206), lean: rnd(-0.22, 0.22) });
  }
  for (let i = 0; i < N(920); i++) {
    motes.push({ x: rnd(0, WORLD.w), y: rnd(0, WORLD.h), r: rnd(0.7, 2.6), ph: rnd(0, TAU), d: rnd(0.3, 1) });
  }
}

function sprinkleFood(n, px, py, ring) {
  for (let i = 0; i < n && food.length < MAX_FOOD; i++) spawnFoodNear(px, py, ring);
}

function spawnFoodNear(px, py, ring) {
  const a = rnd(0, TAU), d = rnd(ring * 0.15, ring * 1.15);
  food.push({
    x: clamp(px + Math.cos(a) * d, 20, WORLD.w - 20),
    y: clamp(py + Math.sin(a) * d, 20, swimFloor() - 30),
    ph: rnd(0, TAU), hue: rnd(150, 210),
  });
}

function spawnFish(px, py, ring, pm) {
  const a = rnd(0, TAU);
  const d = rnd(ring * 1.05, ring * 1.45) * (Math.random() < 0.3 ? 1.25 : 1);
  let x = clamp(px + Math.cos(a) * d, 60, WORLD.w - 60);
  let y = clamp(py + Math.sin(a) * d, 60, swimFloor() - 80);
  /* Agar's rule: everything arrives small and has to earn its size. Most of
     the reef is fry; a slice is scaled to you so there is always a fair meal
     and a fair threat, and the genuinely big ones are rare and spawn far out. */
  /* Agar's rule, properly this time: a fish that arrives is ALWAYS a small
     fish. Nothing spawns scaled to you, ever. Every big fish in this ocean
     got big the same way you did — by eating — which is why the shoal is
     recycled below rather than deleted, so it has the time to. */
  /* Deep Strike has no size ladder: every fish is identical. */
  const mass = (typeof SK_ON === "function" && SK_ON())
    ? 260 : clamp(Math.exp(rnd(Math.log(10), Math.log(120))), 9, AI_MAX_MASS);
  const far = 1;
  const big = false;   /* nobody arrives as a predator */
  if (far > 1) {
    x = clamp(px + Math.cos(a) * d * far, 60, WORLD.w - 60);
    y = clamp(py + Math.sin(a) * d * far, 60, WORLD.h - 60);
  }
  /* last guard: anything that could swallow the player never appears nearby */
  if (radiusOf(mass) >= radiusOf(pm) * EAT_RATIO && Math.hypot(x - px, y - py) < ring * 1.4) return;
  const born = makeFish("ai", mass, x, y, big ? pick(PREDATORS) : pick(SPECIES));
  born.safe = AI_SAFE_SECONDS;
  born.poison = Math.random() < POISON_CHANCE;
  born.kills = 0;
  born.pname = BOT_NAMES[(Math.random() * BOT_NAMES.length) | 0];
  fishes.push(born);
}

/* ------------------------------------------------------------ particles --- */
function bubble(x, y, r, n, vx, vy) {
  for (let i = 0; i < n; i++) {
    bits.push({
      k: 0, x: x + rnd(-r, r), y: y + rnd(-r, r),
      vx: (vx || 0) * rnd(0.1, 0.5) + rnd(-16, 16),
      vy: (vy || 0) * rnd(0.1, 0.5) + rnd(-46, -14),
      r: rnd(1.2, 3.4) + r * 0.05, life: rnd(0.6, 1.6), max: 1.6,
    });
  }
}
function spark(x, y, r, col) {
  for (let i = 0; i < 12; i++) {
    const a = rnd(0, TAU), s = rnd(30, 150);
    bits.push({
      k: 1, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      r: rnd(1, 2.6) + r * 0.04, life: rnd(0.25, 0.55), max: 0.55, col,
    });
  }
  bits.push({ k: 2, x, y, r: r * 0.6, R: r * 3.2, life: 0.42, max: 0.42 });
}
function floatText(x, y, txt, col) {
  texts.push({ x, y, txt, col: col || "#ffe6a8", life: 1.0 });
}

/* ------------------------------------------------------------ AI + step --- */
function steerAI(f, dt) {
  f.think -= dt;
  if (f.think > 0) return;
  f.think = rnd(0.09, 0.2);

  let threat = null, tD = 1e9, prey = null, pD = 1e9;
  const sense = 300 + f.r * 1.6;
  const s2 = sense * sense;
  for (let i = 0; i < fishes.length; i++) {
    const o = fishes[i];
    if (o === f || o.dead) continue;
    if (o.kind === "player" && (G.grace > 0 || !G.running)) continue;
    const dx = o.x - f.x, dy = o.y - f.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > s2) continue;
    const ratio = o.r / f.r;
    if (ratio > EAT_RATIO) { if (d2 < tD) { tD = d2; threat = o; } }
    else if (ratio < PREY_RATIO) { if (d2 < pD) { pD = d2; prey = o; } }
  }

  f.noiseT += 0.16;
  const drift = Math.sin(f.noiseT * 0.7) * 0.9 + Math.sin(f.noiseT * 0.23 + 1.7) * 0.6;

  if (threat) {
    f.ta = Math.atan2(f.y - threat.y, f.x - threat.x) + drift * 0.12;
    f.panic = 1;
    f.boost = Math.sqrt(tD) < 260 ? 1 : 0.4;
  } else if (prey && Math.sqrt(pD) < 280 + f.r * 1.8 && Math.random() < 0.72) {
    f.ta = Math.atan2(prey.y - f.y, prey.x - f.x) + drift * 0.08;
    f.panic = 0.25;
    f.boost = Math.sqrt(pD) < 180 + f.r ? 1.35 : 0.5;   /* the lunge */
  } else {
    f.ta += drift * 0.28;
    f.panic *= 0.7;
    f.boost = 0.06;
  }

  /* the small ones are not helpless: they pepper anything far bigger than
     them with pea-shots, which sting your score rather than your body */
  if (threat && f.mass < 400 && f.spitCd <= 0 && Math.sqrt(tD) < 520) {
    const aim = Math.atan2(threat.y - f.y, threat.x - f.x);
    globs.push({
      x: f.x, y: f.y, vx: Math.cos(aim) * 420, vy: Math.sin(aim) * 420,
      mass: 1, r: Math.max(3, f.r * 0.16), owner: f, life: 1.1,
      col: "#bff7ff", pea: 1,
    });
    f.spitCd = rnd(2.2, 5.5);
  }

  /* big fish spit too — that is what makes them frightening */
  if (prey && f.mass > SPIT_MIN_MASS * 2.4) {
    f.spitCd -= 0.15;
    if (f.spitCd <= 0 && Math.sqrt(pD) < 420 + f.r * 2) {
      const aim = Math.atan2(prey.y - f.y, prey.x - f.x);
      if (Math.abs(angDelta(f.a, aim)) < 0.4) { spit(f); f.spitCd = rnd(3.5, 9); }
    }
    if (f.spitCd < -30) f.spitCd = rnd(3, 8);
  }

  /* A fish that has not actually moved for a couple of seconds is wedged in
     a corner. Point it at open water and make it swim. */
  f.stuckT = (f.stuckT || 0) + 0.15;
  if (f.stuckT > 2) {
    const moved = Math.hypot(f.x - (f.lastX || 0), f.y - (f.lastY || 0));
    f.lastX = f.x; f.lastY = f.y; f.stuckT = 0;
    if (moved < f.r * 1.2) {
      f.ta = Math.atan2(WORLD.h / 2 - f.y, WORLD.w / 2 - f.x) + rnd(-0.5, 0.5);
      f.a = f.ta;
      f.boost = 1.2;
      f.panic = 0.5;
    }
  }

  /* keep off the walls */
  const m = 300 + f.r;
  if (f.x < m) f.ta = lerp(f.ta, 0, 0.5);
  else if (f.x > WORLD.w - m) f.ta = lerp(f.ta, Math.PI, 0.5);
  if (f.y < m) f.ta = lerp(f.ta, Math.PI / 2, 0.4);
  else if (f.y > swimFloor() - m) f.ta = lerp(f.ta, -Math.PI / 2, 0.45);
}

function moveFish(f, dt) {
  if (f.netted > 0) {
    f.netted -= dt;
    f.sp *= 1 - 3.2 * dt;
    f.phase += dt * 9;
    f.x += Math.cos(f.a) * f.sp * dt;
    f.y += Math.sin(f.a) * f.sp * dt;
    f.r = radiusOf(f.mass);
    layoutFollow(f);
    return;
  }
  const turn = (2.6 + 90 / (f.r + 40)) * dt;
  f.a += clamp(angDelta(f.a, f.ta), -turn, turn);

  const target = speedOf(f) * (0.5 + f.boost * 0.42) * (1 + f.panic * 0.12) * (f === player && PU.boost > 0 ? 1.35 : 1);
  f.sp = lerp(f.sp, target, 1 - Math.pow(0.0016, dt));
  f.x += Math.cos(f.a) * f.sp * dt;
  f.y += Math.sin(f.a) * f.sp * dt;

  const pad = f.r + 8;
  if (f === player && ARENA.on && GAME === "volley") {
    const netX = WORLD.w / 2;
    f.x = mySide() === 0 ? clamp(f.x, pad, netX - 70) : clamp(f.x, netX + 70, WORLD.w - pad);
  } else {
    f.x = clamp(f.x, pad, WORLD.w - pad);
  }
  f.y = clamp(f.y, pad, swimFloor() - f.r * 0.35);

  f.phase += dt * (5.2 + f.sp / (f.r * 0.55 + 14)) * f.wob;
  f.panic = Math.max(0, f.panic - dt * 0.55);
  f.munch = Math.max(0, f.munch - dt * 3);
  if (f.safe > 0) f.safe -= dt;
  f.pop = Math.max(0, f.pop - dt * 2.4);
  f.r = radiusOf(f.mass);
  layoutFollow(f);

  const want = Math.cos(f.a) >= 0 ? 1 : -1;
  if (want !== f.side && Math.abs(Math.cos(f.a)) > 0.18) f.side = want;
  f.flip = lerp(f.flip, f.side, 1 - Math.pow(0.001, dt));
}

/* head leads, the rest of the spine follows — this is what makes the body bend */
function layoutFollow(f) {
  const L = (f.r * 2) / (SEGS - 1);
  f.segLen = L;
  const s = f.seg;
  s[0].x = f.x; s[0].y = f.y;
  let prev = f.a + Math.PI;
  const MAXBEND = 0.5;
  for (let i = 1; i < SEGS; i++) {
    const dx = s[i].x - s[i - 1].x, dy = s[i].y - s[i - 1].y;
    let ang = dx * dx + dy * dy < 1e-6 ? prev : Math.atan2(dy, dx);
    const d = angDelta(prev, ang);
    if (d > MAXBEND) ang = prev + MAXBEND;
    else if (d < -MAXBEND) ang = prev - MAXBEND;
    s[i].x = s[i - 1].x + Math.cos(ang) * L;
    s[i].y = s[i - 1].y + Math.sin(ang) * L;
    prev = ang;
  }
}

/* ================================ RENDER ================================== */
let viewL = 0, viewT = 0, viewR = 0, viewB = 0;

function applyCamera() {
  const k = cam.z * DPR;
  const sx = (VW / 2 - cam.x * cam.z) * DPR;
  const sy = (VH / 2 - cam.y * cam.z) * DPR;
  ctx.setTransform(k, 0, 0, k, sx, sy);
  const hw = VW / 2 / cam.z, hh = VH / 2 / cam.z;
  viewL = cam.x - hw; viewR = cam.x + hw;
  viewT = cam.y - hh; viewB = cam.y + hh;
}

/* ---- water column, light shafts, drifting silt ---- */
function drawWater() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const depth = clamp(cam.y / WORLD.h, 0, 1);
  const g = ctx.createLinearGradient(0, 0, 0, VH);
  const topL = lerp(0.62, 0.16, depth);
  g.addColorStop(0, `rgb(${(10 + topL * 44) | 0},${(88 + topL * 128) | 0},${(122 + topL * 118) | 0})`);
  g.addColorStop(0.5, `rgb(${(7 + topL * 28) | 0},${(62 + topL * 86) | 0},${(94 + topL * 92) | 0})`);
  g.addColorStop(1, "#031a28");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VW, VH);

  /* god rays — wide, soft, slowly breathing */
  ctx.globalCompositeOperation = "lighter";
  const rayTop = -cam.y * cam.z * 0.25;
  for (let i = 0; i < 7; i++) {
    const seed = i * 1.9;
    const x = ((i / 7) * 1.5 - 0.15) * VW + Math.sin(T * 0.09 + seed) * 90 - cam.x * cam.z * 0.06;
    const w = 70 + Math.sin(T * 0.13 + seed * 2) * 26 + i * 9;
    const lean = 130 + Math.sin(T * 0.07 + seed) * 60;
    const alpha = (0.045 + Math.sin(T * 0.21 + seed) * 0.02) * (1 - depth * 0.75);
    const rg = ctx.createLinearGradient(x, rayTop, x + lean, VH);
    rg.addColorStop(0, `rgba(190,244,255,${Math.max(0, alpha)})`);
    rg.addColorStop(0.65, `rgba(150,225,255,${Math.max(0, alpha * 0.35)})`);
    rg.addColorStop(1, "rgba(120,200,255,0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.5, rayTop);
    ctx.lineTo(x + w * 0.5, rayTop);
    ctx.lineTo(x + lean + w * 1.5, VH);
    ctx.lineTo(x + lean - w * 1.1, VH);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

function drawSeabed() {
  const floorY = WORLD.h - 40;
  if (viewB < floorY - 700) return;

  /* far reef silhouette */
  ctx.fillStyle = "rgba(4,42,60,0.55)";
  ctx.beginPath();
  ctx.moveTo(viewL, floorY + 60);
  const step = 180;
  for (let x = Math.floor(viewL / step) * step; x < viewR + step; x += step) {
    const h = 210 + Math.sin(x * 0.0031) * 120 + Math.sin(x * 0.0009 + 2) * 90;
    ctx.lineTo(x, floorY - h * 0.75);
  }
  ctx.lineTo(viewR, floorY + 60);
  ctx.closePath();
  ctx.fill();

  const sceneStride = cam.z < 0.26 ? 5 : cam.z < 0.42 ? 2 : 1;
  for (let ci = 0; ci < corals.length; ci += sceneStride) {
    const c = corals[ci];
    const cx = c.x + (1 - c.depth) * 140;
    if (cx < viewL - 200 || cx > viewR + 200) continue;
    const base = floorY - 6 + Math.sin(c.x * 0.004) * 30;
    const a = 0.18 + c.depth * 0.55;
    ctx.strokeStyle = `hsla(${c.hue},62%,${28 + c.depth * 24}%,${a})`;
    ctx.lineWidth = c.s * 0.14;
    ctx.lineCap = "round";
    const arms = cam.z < 0.26 ? 2 : cam.z < 0.4 ? 3 : c.arms;
    ctx.beginPath();
    for (let i = 0; i < arms; i++) {
      const ang = -Math.PI / 2 + (i - (arms - 1) / 2) * 0.34 + Math.sin(T * 0.4 + c.ph + i) * 0.03;
      ctx.moveTo(cx, base);
      ctx.quadraticCurveTo(
        cx + Math.cos(ang) * c.s * 0.5, base + Math.sin(ang) * c.s * 0.6,
        cx + Math.cos(ang) * c.s, base + Math.sin(ang) * c.s
      );
    }
    ctx.stroke();
  }

  for (let ki = 0; ki < kelp.length; ki += sceneStride) {
    const k = kelp[ki];
    const kx = k.x + (1 - k.depth) * 220;
    if (kx < viewL - 200 || kx > viewR + 200) continue;
    const sway = Math.sin(T * 0.6 * k.sway + k.ph) * (26 + k.h * 0.06);
    const w = k.w * (0.35 + k.depth * 0.65);
    const sat = 26 + k.depth * 26;
    const lig = 11 + k.depth * 19;
    const a = 0.3 + k.depth * 0.5;

    /* sample the stalk, then wrap it in a tapered silhouette */
    const N = cam.z < 0.3 ? 4 : 7, sx = [], sy = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, mt = 1 - t;
      const bx = mt * mt * mt * kx + 3 * mt * mt * t * (kx + sway * 0.2) + 3 * mt * t * t * (kx + sway * 0.8) + t * t * t * (kx + sway);
      const by = mt * mt * mt * floorY + 3 * mt * mt * t * (floorY - k.h * 0.4) + 3 * mt * t * t * (floorY - k.h * 0.75) + t * t * t * (floorY - k.h);
      sx.push(bx); sy.push(by);
    }
    ctx.fillStyle = `hsla(${k.hue},${sat}%,${lig}%,${a})`;
    ctx.beginPath();
    ctx.moveTo(sx[0] - w * 0.5, sy[0]);
    for (let i = 1; i <= N; i++) ctx.lineTo(sx[i] - w * 0.5 * (1 - i / N) - w * 0.08, sy[i]);
    for (let i = N; i >= 0; i--) ctx.lineTo(sx[i] + w * 0.5 * (1 - i / N) + w * 0.08, sy[i]);
    ctx.closePath();
    ctx.fill();

    /* blades */
    if (cam.z < 0.42) continue;
    ctx.fillStyle = `hsla(${k.hue + 8},${sat + 8}%,${lig + 6}%,${a * 0.85})`;
    for (let bI = 1; bI <= k.blades; bI++) {
      const i = Math.min(N - 1, Math.round((bI / (k.blades + 1)) * N));
      const dir = bI % 2 ? 1 : -1;
      const bl = k.h * 0.16 * (1 - i / (N + 2));
      ctx.beginPath();
      ctx.moveTo(sx[i], sy[i]);
      ctx.quadraticCurveTo(sx[i] + dir * bl * 0.9, sy[i] - bl * 0.35, sx[i] + dir * bl * 1.25, sy[i] - bl * 0.95);
      ctx.quadraticCurveTo(sx[i] + dir * bl * 0.35, sy[i] - bl * 0.4, sx[i], sy[i]);
      ctx.closePath();
      ctx.fill();
    }
  }

  const sg = ctx.createLinearGradient(0, floorY - 90, 0, WORLD.h + 60);
  sg.addColorStop(0, "rgba(24,64,78,0)");
  sg.addColorStop(0.45, "rgba(48,86,86,0.85)");
  sg.addColorStop(1, "#1d3a3e");
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.moveTo(viewL, WORLD.h + 80);
  for (let x = Math.floor(viewL / 140) * 140; x < viewR + 140; x += 140) {
    ctx.lineTo(x, floorY - 26 + Math.sin(x * 0.006) * 16 + Math.sin(x * 0.0017) * 22);
  }
  ctx.lineTo(viewR, WORLD.h + 80);
  ctx.closePath();
  ctx.fill();
}

function drawRocks() {
  for (let i = 0; i < rocks.length; i++) {
    const k = rocks[i];
    const x = k.x + (1 - k.depth) * (cam.x * 0.12);
    if (x + k.w < viewL || x - k.w > viewR) continue;
    const tip = x + k.lean * k.h;
    ctx.fillStyle = `hsla(${k.hue},40%,${8 + k.depth * 9}%,${0.22 + k.depth * 0.3})`;
    ctx.beginPath();
    ctx.moveTo(x - k.w * 0.5, k.y + k.h);
    ctx.quadraticCurveTo(x - k.w * 0.34, k.y + k.h * 0.42, tip - k.w * 0.12, k.y + k.h * 0.06);
    ctx.quadraticCurveTo(tip - k.w * 0.05, k.y - k.h * 0.04, tip + k.w * 0.04, k.y + k.h * 0.02);
    ctx.quadraticCurveTo(x + k.w * 0.26, k.y + k.h * 0.4, x + k.w * 0.5, k.y + k.h);
    ctx.closePath();
    ctx.fill();
  }
}

function drawMotes() {
  ctx.fillStyle = "rgba(198,240,255,0.5)";
  const stepN = cam.z < 0.26 ? 8 : cam.z < 0.4 ? 3 : cam.z < 0.7 ? 2 : 1;
  if (cam.z < 0.45) {
    /* far out these are specks: one path, one fill, no per-speck alpha */
    ctx.fillStyle = "rgba(198,240,255,0.3)";
    ctx.beginPath();
    for (let i = 0; i < motes.length; i += stepN) {
      const m = motes[i];
      const x = m.x + Math.sin(T * 0.25 + m.ph) * 22;
      const y = m.y + Math.cos(T * 0.19 + m.ph * 1.7) * 16;
      if (x < viewL || x > viewR || y < viewT || y > viewB) continue;
      const rr = m.r * (0.6 + m.d * 0.8);
      ctx.moveTo(x + rr, y);
      ctx.arc(x, y, rr, 0, TAU);
    }
    ctx.fill();
    return;
  }
  for (let i = 0; i < motes.length; i += stepN) {
    const m = motes[i];
    const x = m.x + Math.sin(T * 0.25 + m.ph) * 22;
    const y = m.y + Math.cos(T * 0.19 + m.ph * 1.7) * 16;
    if (x < viewL || x > viewR || y < viewT || y > viewB) continue;
    ctx.globalAlpha = 0.1 + m.d * 0.3 + Math.sin(T * 1.4 + m.ph) * 0.08;
    ctx.beginPath();
    ctx.arc(x, y, m.r * (0.6 + m.d * 0.8), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawFood() {
  if (cam.z < 0.5) {
    /* two paths for the whole shoal of plankton instead of two per pellet */
    ctx.fillStyle = "rgba(140,238,226,0.5)";
    ctx.beginPath();
    for (let i = 0; i < food.length; i++) {
      const p = food[i];
      if (p.x < viewL - 20 || p.x > viewR + 20 || p.y < viewT - 20 || p.y > viewB + 20) continue;
      const rr = 7 * (0.72 + Math.sin(T * 3 + p.ph) * 0.28);
      ctx.moveTo(p.x + rr, p.y);
      ctx.arc(p.x, p.y, rr, 0, TAU);
    }
    ctx.fill();
    ctx.fillStyle = "rgba(240,255,255,0.95)";
    ctx.beginPath();
    for (let i = 0; i < food.length; i++) {
      const p = food[i];
      if (p.x < viewL - 20 || p.x > viewR + 20 || p.y < viewT - 20 || p.y > viewB + 20) continue;
      const rr = 3 * (0.72 + Math.sin(T * 3 + p.ph) * 0.28);
      ctx.moveTo(p.x + rr, p.y);
      ctx.arc(p.x, p.y, rr, 0, TAU);
    }
    ctx.fill();
    return;
  }
  for (let i = 0; i < food.length; i++) {
    const p = food[i];
    if (p.x < viewL - 20 || p.x > viewR + 20 || p.y < viewT - 20 || p.y > viewB + 20) continue;
    const pulse = 0.72 + Math.sin(T * 3 + p.ph) * 0.28;
    const x = p.x + Math.sin(T * 0.8 + p.ph) * 3;
    const y = p.y + Math.cos(T * 0.66 + p.ph) * 3;
    if (cam.z < 0.5) {
      ctx.fillStyle = `hsla(${p.hue},95%,74%,0.85)`;
      ctx.beginPath(); ctx.arc(x, y, 7 * pulse, 0, TAU); ctx.fill();
      continue;
    }
    const g = ctx.createRadialGradient(x, y, 0, x, y, 16 * pulse);
    g.addColorStop(0, `hsla(${p.hue},100%,86%,0.95)`);
    g.addColorStop(0.35, `hsla(${p.hue},95%,68%,0.45)`);
    g.addColorStop(1, `hsla(${p.hue},95%,60%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 16 * pulse, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(240,255,255,0.95)";
    ctx.beginPath();
    ctx.arc(x, y, 3.2 * pulse, 0, TAU);
    ctx.fill();
  }
}

function drawBits() {
  for (let i = 0; i < bits.length; i++) {
    const b = bits[i];
    const t = clamp(b.life / b.max, 0, 1);
    if (b.k === 0) {
      ctx.strokeStyle = `rgba(210,246,255,${0.34 * t})`;
      ctx.lineWidth = Math.max(0.6, b.r * 0.28);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${0.1 * t})`;
      ctx.fill();
    } else if (b.k === 1) {
      ctx.fillStyle = b.col || `rgba(255,222,150,${t})`;
      ctx.globalAlpha = t;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * (0.4 + t * 0.9), 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      const rr = lerp(b.r, b.R, 1 - t);
      ctx.strokeStyle = `rgba(190,255,240,${0.5 * t})`;
      ctx.lineWidth = 2 + 4 * t;
      ctx.beginPath();
      ctx.arc(b.x, b.y, rr, 0, TAU);
      ctx.stroke();
    }
  }
  for (let i = 0; i < texts.length; i++) {
    const s = texts[i];
    ctx.globalAlpha = clamp(s.life, 0, 1);
    ctx.fillStyle = s.col;
    ctx.font = `700 ${Math.round(15 / cam.z)}px "Avenir Next", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(s.txt, s.x, s.y);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "left";
}

/* ------------------------------------------------------------ the fish --- */
/* Body plans. `prof` is the half-height down the spine, so it IS the
   silhouette; the rest shapes the fins. A tadpole is all head and no tail
   fin, an eel is a tube, a ray is a wing, a shark is a wedge with a forked
   tail. Species picks the plan; size can override it, because a tadpole is a
   tadpole whatever it is going to grow into. */
const SHAPES = {
  fish:   { prof: [0.42, 0.80, 0.95, 1.00, 0.97, 0.86, 0.66, 0.42, 0.16], tl: 1.00, tw: 1.00, notch: 0.22, dorsal: 1.0,  pect: 1.0,  spikes: 0 },
  shark:  { prof: [0.34, 0.66, 0.88, 1.00, 0.95, 0.80, 0.56, 0.32, 0.11], tl: 1.15, tw: 1.10, notch: 0.08, dorsal: 1.25, pect: 1.2,  spikes: 0 },
  eel:    { prof: [0.50, 0.72, 0.84, 0.90, 0.92, 0.90, 0.84, 0.66, 0.34], tl: 0.50, tw: 0.34, notch: 0.85, dorsal: 0.35, pect: 0.3,  spikes: 0 },
  ray:    { prof: [0.55, 1.00, 1.30, 1.32, 1.05, 0.66, 0.36, 0.19, 0.08], tl: 2.00, tw: 0.14, notch: 0.92, dorsal: 0.12, pect: 0,    spikes: 0 },
  puffer: { prof: [0.80, 1.05, 1.18, 1.18, 1.02, 0.76, 0.50, 0.28, 0.11], tl: 0.60, tw: 0.70, notch: 0.60, dorsal: 0.5,  pect: 0.9,  spikes: 1 },
  whale:  { prof: [0.62, 0.92, 1.08, 1.10, 1.04, 0.92, 0.68, 0.40, 0.15], tl: 0.90, tw: 1.55, notch: 0.35, dorsal: 0.45, pect: 1.4,  spikes: 0 },
  tad:    { prof: [0.98, 1.02, 0.84, 0.58, 0.40, 0.28, 0.20, 0.14, 0.08], tl: 0.80, tw: 0.50, notch: 0.95, dorsal: 0,    pect: 0,    spikes: 0 },
};
const SHAPE_BY_ID = {
  eel: "eel", ray: "ray", puffer: "puffer", angler: "puffer",
  hammer: "shark", tiger2: "shark", greatwh: "shark", megalo: "shark",
  sword: "shark", silver: "shark", barra: "shark", shark: "shark",
  orca: "whale", trident: "whale",
};
const PROF = SHAPES.fish.prof;
const LP = [];
for (let i = 0; i < SEGS; i++) LP.push({ x: 0, y: 0 });
const OUT = [];
for (let i = 0; i < SEGS * 2 + 2; i++) OUT.push({ x: 0, y: 0 });

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) + amt, 0, 255);
  const g = clamp(((n >> 8) & 255) + amt, 0, 255);
  const b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}

function bodyGrad(f) {
  const key = Math.round(f.r * 4);
  if (f.gradR !== key) {
    const h = f.r * f.skin.fat * tierFor(f.r).fat * 1.1;
    const mk = (a, b) => {
      const g = ctx.createLinearGradient(0, a, 0, b);
      g.addColorStop(0, shade(f.skin.back, -34));
      g.addColorStop(0.5, f.skin.back);
      g.addColorStop(0.88, f.skin.belly);
      g.addColorStop(1, "#fffdf8");
      return g;
    };
    f.grad = mk(-h, h);
    f.gradFlip = mk(h, -h);
    f.gradR = key;
  }
  return f.side > 0 ? f.grad : f.gradFlip;
}

function localSpine(f) {
  const ca = Math.cos(-f.a), sa = Math.sin(-f.a);
  const swim = clamp(f.sp / (speedOf(f) * 1.25), 0, 1.5);
  for (let i = 0; i < SEGS; i++) {
    const dx = f.seg[i].x - f.x, dy = f.seg[i].y - f.y;
    const t = i / (SEGS - 1);
    LP[i].x = dx * ca - dy * sa;
    LP[i].y = dx * sa + dy * ca + Math.sin(f.phase - i * 0.78) * f.r * 0.17 * Math.pow(t, 1.35) * (0.3 + swim);
  }
}

function smoothClosed(p, n) {
  ctx.beginPath();
  ctx.moveTo((p[n - 1].x + p[0].x) / 2, (p[n - 1].y + p[0].y) / 2);
  for (let i = 0; i < n; i++) {
    const c = p[i], q = p[(i + 1) % n];
    ctx.quadraticCurveTo(c.x, c.y, (c.x + q.x) / 2, (c.y + q.y) / 2);
  }
  ctx.closePath();
}

function drawFish(f, isPlayer, threatLevel) {
  const r = f.r;
  const px = r * cam.z;
  const skin = f.skin;
  const side = f.side;
  localSpine(f);

  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(f.a);
  if (f.pop > 0) ctx.scale(1 + f.pop * 0.1, 1 + f.pop * 0.1);

  /* tiny fish far away: keep it cheap but still fish-shaped */
  if (px < 5) {
    ctx.fillStyle = skin.back;
    ctx.beginPath();
    ctx.ellipse(-r * 0.7, LP[3].y * 0.4, r, r * skin.fat, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 1.7, 0);
    ctx.lineTo(-r * 2.3, -r * 0.5);
    ctx.lineTo(-r * 2.3, r * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return;
  }

  const tier = tierFor(r);
  const plan = SHAPES[tier.name === "Tadpole" ? "tad" : skin.shape || "fish"] || SHAPES.fish;
  const prof = plan.prof;
  const fatness = skin.fat * tier.fat;
  const hD = [], hV = [];
  for (let i = 0; i < SEGS; i++) {
    hD.push(r * fatness * prof[i] * 0.9);
    hV.push(r * fatness * prof[i]);
  }

  /* ---- caudal fin (behind the body) ---- */
  const tx = LP[SEGS - 1].x - LP[SEGS - 2].x;
  const ty = LP[SEGS - 1].y - LP[SEGS - 2].y;
  const tl = Math.hypot(tx, ty) || 1;
  const ux = tx / tl, uy = ty / tl;
  const nx = -uy, ny = ux;
  const bx = LP[SEGS - 1].x, by = LP[SEGS - 1].y;
  const fl = r * 0.62 * tier.tail * plan.tl;
  const fw = r * 0.52 * (fatness + 0.25) * tier.tail * plan.tw;
  const notch = plan.notch;
  ctx.fillStyle = skin.fin;
  ctx.globalAlpha = 0.88;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.quadraticCurveTo(bx + ux * fl * 0.5 + nx * fw * 0.7, by + uy * fl * 0.5 + ny * fw * 0.7,
                       bx + ux * fl + nx * fw, by + uy * fl + ny * fw);
  ctx.quadraticCurveTo(bx + ux * fl * 0.45, by + uy * fl * 0.45, bx + ux * fl * notch, by + uy * fl * notch);
  ctx.quadraticCurveTo(bx + ux * fl * 0.45, by + uy * fl * 0.45,
                       bx + ux * fl - nx * fw, by + uy * fl - ny * fw);
  ctx.quadraticCurveTo(bx + ux * fl * 0.5 - nx * fw * 0.7, by + uy * fl * 0.5 - ny * fw * 0.7, bx, by);
  ctx.closePath();
  ctx.fill();

  /* ---- dorsal + anal fins ---- */
  const finPath = (i0, i1, hArr, dir, scale) => {
    const a = LP[i0], b = LP[i1];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y + dir * hArr[i0] * 0.6);
    ctx.quadraticCurveTo(mx + r * 0.1, my + dir * hArr[i0] * scale, b.x, b.y + dir * hArr[i1] * 0.6);
    ctx.quadraticCurveTo(mx, my + dir * hArr[i0] * 0.4, a.x, a.y + dir * hArr[i0] * 0.6);
    ctx.closePath();
    ctx.fill();
  };
  if (plan.dorsal > 0) {
    ctx.globalAlpha = 0.82;
    finPath(2, 5, hD, -side, Math.min(3.0, tier.fin * plan.dorsal));
    ctx.globalAlpha = 0.7;
    finPath(5, 7, hV, side, 1.7 * plan.dorsal);
  }
  ctx.globalAlpha = 1;

  /* ---- body ---- */
  let n = 0;
  OUT[n].x = LP[0].x + r * 0.2; OUT[n].y = LP[0].y; n++;
  for (let i = 0; i < SEGS; i++) { OUT[n].x = LP[i].x; OUT[n].y = LP[i].y - side * hD[i]; n++; }
  OUT[n].x = bx - ux * r * 0.05; OUT[n].y = by - uy * r * 0.05; n++;
  for (let i = SEGS - 1; i >= 0; i--) { OUT[n].x = LP[i].x; OUT[n].y = LP[i].y + side * hV[i]; n++; }
  smoothClosed(OUT, n);
  ctx.fillStyle = bodyGrad(f);
  ctx.fill();
  if (f.poison) {
    /* a sickly wash over the whole body — you should never have to squint */
    ctx.fillStyle = `rgba(126,255,90,${0.34 + Math.sin(T * 4 + f.phase) * 0.1})`;
    ctx.fill();
  }
  ctx.lineWidth = Math.max(0.5, r * 0.035);
  ctx.strokeStyle = "rgba(2,22,32,0.32)";
  ctx.stroke();

  /* stripes, clipped inside the silhouette */
  if (skin.stripe && px > 11) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = skin.stripe;
    ctx.globalAlpha = 0.75;
    const hh = r * skin.fat * 1.3;
    for (let k = 0; k < 3; k++) {
      const cxp = -r * (0.2 + k * 0.5);
      ctx.beginPath();
      ctx.moveTo(cxp + r * 0.12, -hh); ctx.lineTo(cxp - r * 0.02, -hh);
      ctx.lineTo(cxp - r * 0.12, hh); ctx.lineTo(cxp + r * 0.02, hh);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  if (plan.spikes && px > 10) {
    ctx.strokeStyle = skin.fin;
    ctx.lineWidth = Math.max(0.8, r * 0.035);
    ctx.beginPath();
    for (let i = 1; i < SEGS - 2; i++) {
      for (let d = -1; d <= 1; d += 2) {
        const hx = LP[i].x, hy = LP[i].y + d * side * hV[i];
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx - r * 0.05, hy + d * side * r * 0.17);
      }
    }
    ctx.stroke();
  }

  /* ---- pectoral fin ---- */
  if (px > 8 && plan.pect > 0) {
    const flap = Math.sin(f.phase * 1.25) * 0.45;
    ctx.save();
    ctx.translate(LP[2].x, LP[2].y + side * hV[2] * 0.42);
    ctx.rotate(0.5 * side + flap * side);
    ctx.fillStyle = skin.fin;
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    ctx.ellipse(-r * 0.16, 0, r * 0.3 * plan.pect, r * 0.13 * plan.pect, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ---- face ---- */
  const ex = LP[0].x - r * 0.02;
  const ey = LP[0].y - side * hD[0] * 0.42;
  const er = Math.max(1.1, r * 0.115);
  ctx.fillStyle = "#fdfdff";
  ctx.beginPath(); ctx.arc(ex, ey, er, 0, TAU); ctx.fill();
  ctx.fillStyle = "#08202c";
  ctx.beginPath(); ctx.arc(ex + er * 0.3, ey, er * 0.58, 0, TAU); ctx.fill();
  if (px > 12) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath(); ctx.arc(ex + er * 0.55, ey - er * 0.35, er * 0.2, 0, TAU); ctx.fill();
  }
  const gape = r * (0.07 + f.munch * 0.16);
  ctx.strokeStyle = "rgba(6,26,36,0.55)";
  ctx.lineWidth = Math.max(0.6, r * 0.055);
  ctx.beginPath();
  ctx.moveTo(LP[0].x + r * 0.18, LP[0].y + side * gape * 0.4);
  ctx.quadraticCurveTo(LP[0].x + r * 0.05, LP[0].y + side * gape, LP[0].x - r * 0.08, LP[0].y + side * gape * 0.7);
  ctx.stroke();

  /* gill line */
  if (px > 14) {
    ctx.strokeStyle = "rgba(6,32,44,0.22)";
    ctx.lineWidth = Math.max(0.5, r * 0.045);
    ctx.beginPath();
    ctx.moveTo(LP[1].x - r * 0.02, LP[1].y - side * hD[1] * 0.7);
    ctx.quadraticCurveTo(LP[1].x - r * 0.22, LP[1].y, LP[1].x - r * 0.02, LP[1].y + side * hV[1] * 0.7);
    ctx.stroke();
  }

  ctx.restore();

  if (f.poison && px > 9) {
    ctx.fillStyle = `rgba(150,255,110,${0.5 + Math.sin(T * 5 + f.phase) * 0.2})`;
    for (let k = 0; k < 3; k++) {
      const t2 = (T * 0.6 + k * 0.33 + f.phase) % 1;
      ctx.beginPath();
      ctx.arc(f.x - Math.cos(f.a) * r * 0.4 + Math.sin(t2 * 6 + k) * r * 0.2,
              f.y - Math.sin(f.a) * r * 0.4 - t2 * r * 1.5,
              Math.max(1.5, r * 0.09 * (1 - t2)), 0, TAU);
      ctx.fill();
    }
  }
  if (!isPlayer && f.poison && px > 5) {
    ctx.strokeStyle = `rgba(150,255,110,${0.3 + Math.sin(T * 4 + f.phase) * 0.16})`;
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.beginPath();
    ctx.ellipse(f.x - Math.cos(f.a) * r * 0.7, f.y - Math.sin(f.a) * r * 0.7, r * 1.5, r * 0.95, f.a, 0, TAU);
    ctx.stroke();
  }
  if (!isPlayer && f.safe > 0) {
    ctx.strokeStyle = `rgba(190,255,240,${0.1 + Math.sin(T * 8) * 0.06})`;
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.beginPath();
    ctx.arc(f.x - Math.cos(f.a) * r * 0.7, f.y - Math.sin(f.a) * r * 0.7, r * 1.7, 0, TAU);
    ctx.stroke();
    return;
  }

  /* ---- relationship rings, drawn in world space ---- */
  if (!isPlayer && threatLevel === 1) {
    if (Math.hypot(f.x - player.x, f.y - player.y) > 760 + player.r * 3) return;
    const pulse = 0.35 + Math.sin(T * 5 + f.phase) * 0.18;
    ctx.strokeStyle = `rgba(255,96,84,${pulse})`;
    ctx.lineWidth = Math.max(1.2, r * 0.06);
    ctx.beginPath();
    ctx.ellipse(f.x - Math.cos(f.a) * r * 0.75, f.y - Math.sin(f.a) * r * 0.75, r * 1.5, r * 0.95, f.a, 0, TAU);
    ctx.stroke();
  } else if (!isPlayer && threatLevel === -1 && px > 6) {
    const near = Math.hypot(f.x - player.x, f.y - player.y) < 460 + player.r * 2.5;
    if (!near) return;
    ctx.strokeStyle = "rgba(126,255,214,0.17)";
    ctx.lineWidth = Math.max(0.8, r * 0.06);
    ctx.beginPath();
    ctx.ellipse(f.x - Math.cos(f.a) * r * 0.7, f.y - Math.sin(f.a) * r * 0.7, r * 1.45, r * 0.9, f.a, 0, TAU);
    ctx.stroke();
  }
}

/* ------------------------------------------------------------ minimap ---- */
function drawMap(player) {
  const w = mapCv.width, h = mapCv.height;
  mapCtx.clearRect(0, 0, w, h);
  mapCtx.fillStyle = "rgba(3,28,42,0.66)";
  mapCtx.fillRect(0, 0, w, h);
  mapCtx.strokeStyle = "rgba(140,220,255,0.18)";
  mapCtx.strokeRect(0.5, 0.5, w - 1, h - 1);
  const sx = w / WORLD.w, sy = h / WORLD.h;
  for (let i = 0; i < fishes.length; i++) {
    const f = fishes[i];
    if (f === player) continue;
    const big = f.r > player.r * 1.14;
    mapCtx.fillStyle = big ? "rgba(255,110,96,0.85)" : "rgba(110,236,208,0.6)";
    const rr = clamp(f.r * sx * 1.6, 1, 4);
    mapCtx.beginPath();
    mapCtx.arc(f.x * sx, f.y * sy, rr, 0, TAU);
    mapCtx.fill();
  }
  /* the safe water, on the one view that shows the whole arena at once */
  if (typeof SK_ON === "function" && SK_ON() && RING0.r > 0) {
    mapCtx.save();
    mapCtx.beginPath();
    mapCtx.rect(0, 0, w, h);
    mapCtx.arc(RING0.x * sx, RING0.y * sy, RING0.r * sx, 0, TAU, true);
    mapCtx.fillStyle = "rgba(120,0,26,0.34)";
    mapCtx.fill("evenodd");
    mapCtx.strokeStyle = `rgba(255,120,110,${0.65 + Math.sin(T * 3) * 0.2})`;
    mapCtx.lineWidth = 1.6;
    mapCtx.beginPath();
    mapCtx.arc(RING0.x * sx, RING0.y * sy, RING0.r * sx, 0, TAU);
    mapCtx.stroke();
    mapCtx.restore();
  }

  mapCtx.fillStyle = "#ffd05e";
  mapCtx.beginPath();
  mapCtx.arc(player.x * sx, player.y * sy, 3.2, 0, TAU);
  mapCtx.fill();
  mapCtx.strokeStyle = "rgba(255,208,94,0.5)";
  mapCtx.lineWidth = 1;
  mapCtx.beginPath();
  mapCtx.arc(player.x * sx, player.y * sy, 6 + Math.sin(T * 3) * 1.5, 0, TAU);
  mapCtx.stroke();
}

/* ================================= GAME =================================== */
const el = (id) => document.getElementById(id);
const UI = {
  hud: el("hud"), score: el("score"), stage: el("stage"), fill: el("sizefill"),
  ranks: el("ranks"), stam: el("stamfill"), banner: el("banner"),
  start: el("start"), over: el("over"), name: el("name"), play: el("play"),
  again: el("again"), sound: el("sound"), fscore: el("fscore"), fbest: el("fbest"),
  fsize: el("fsize"), deathline: el("deathline"), link: el("link"),
  pups: el("pups"), purseTop: el("purseTop"), purse: el("purse"), purseStart: el("purseStart"),
  shop: el("shop"), grid: el("shopgrid"), fkills: el("fkills"), fpearls: el("fpearls"),
  teamPick: el("teamPick"), teamHud: el("teamHud"), teamBar: el("teamBar"), arena: el("arena"),
  rankSheet: el("rankSheet"), rlist: el("rlist"), rwhen: el("rwhen"), rnote: document.querySelector("#rankSheet .note"),
  gemTop: el("gemTop"), gemPurse: el("gemPurse"), fgems: el("fgems"),
  cont: el("continue"), contcost: el("contcost"), clock: el("clock"), modePick: el("modePick"),
  quit: el("quit"),
};

/* Endpoints are overridable so the same file can be hosted anywhere:
   set window.REEF_API / window.REEF_WS before loading this script. */
const API_BASE = typeof window.REEF_API === "string" ? window.REEF_API.replace(/\/$/, "") : "";

const VIP = { on: false, reason: "", days: 0 };

/* Gems are the reward for placing, not for playing: hold a spot in a top ten
   and you can collect once a day. Nothing to grind toward — you either made
   the board or you did not. */
async function claimGems() {
  const now = Date.now();
  if (now - (Wallet.lastGem || 0) < 20 * 60 * 60 * 1000) return;
  try {
    const res = await fetch(`${API_BASE}/api/vip?pid=${encodeURIComponent(pid)}`);
    if (!res.ok) throw new Error("no rankings server");
    const d = await res.json();
    if (!d || !d.vip) return;
    const award = d.days >= 7 ? 10 : 3;
    Wallet.gems += award;
    Wallet.lastGem = now;
    Wallet.save();
    G.gemsEarned = award;
    if (UI.fgems) UI.fgems.textContent = ` and ${award} 💎 for ${d.reason}`;
    banner("for placing", `+${award} gems`);
    Snd.pickup();
  } catch (e) {}
}

async function refreshVip() {
  try {
    const res = await fetch(`${API_BASE}/api/vip?pid=${encodeURIComponent(pid)}`);
    const d = await res.json();
    VIP.on = !!(d && d.vip) || Wallet.vipUntil > Date.now();
    VIP.reason = (d && d.reason) || "";
    VIP.days = (d && d.days) || 0;
  } catch (e) {
    /* Offline build: there is no board to place on, so gating VIP behind one
       would hide half the game with no way ever to earn it. */
    VIP.on = true;
    VIP.reason = "open in this build";
  }
  renderTankPick();
}

function renderTankPick() {
  const box = el("tankPick");
  if (!box) return;
  box.innerHTML = Object.keys(TANKS).map((id) => {
    const t = TANKS[id];
    const locked = t.vip && !VIP.on;
    return `<div class="tk ${id === TANK ? "on" : ""} ${locked ? "locked" : ""}" data-tank="${id}">
      ${t.vip ? "<em>VIP</em>" : ""}<b>${t.name}</b><span>${t.blurb}</span></div>`;
  }).join("");
  for (const card of box.querySelectorAll(".tk")) {
    card.addEventListener("click", () => {
      const id = card.dataset.tank;
      if (TANKS[id].vip && !VIP.on) {
        banner("vip water", "finish in a top ten");
        el("vipLine").textContent = "Deep Trench and Sunlit Lagoon open up when you place in a top ten — a day for today's board, a week for all time.";
        return;
      }
      if (id === TANK) return;
      const q = new URLSearchParams(location.search);
      q.set("tank", id);
      location.search = q.toString();
    });
  }
  const line = el("vipLine");
  if (line) {
    line.textContent = VIP.on
      ? `VIP — ${VIP.reason || "active"}${VIP.days ? ` · ${VIP.days} day${VIP.days > 1 ? "s" : ""}` : ""}. All three waters are open.`
      : "Two waters are VIP. Finish in a top ten to earn it — a day for today's board, a week for all time.";
  }
}

let rankWindow = "day";
let rankBusy = false;

async function loadRanks() {
  if (rankBusy) return;
  rankBusy = true;
  UI.rlist.innerHTML = `<div class="rk2"><span></span><span></span><span class="nm">loading…</span><span></span><span></span></div>`;
  try {
    const arena = rankWindow === "arena";
    const url = arena
      ? `${API_BASE}/api/ladder?w=week&g=${encodeURIComponent(ARENA.on ? GAME : "")}&pid=${encodeURIComponent(pid)}`
      : `${API_BASE}/api/ranks?w=${encodeURIComponent(rankWindow)}&pid=${encodeURIComponent(pid)}`;
    const res = await fetch(url);
    const data = await res.json();
    const rows = (data && data.rows) || [];
    const line = (r) => {
      const chip = r.flag && flagByCode(r.flag) ? `<img src="${flagURL(r.flag)}" alt="">` : "<span></span>";
      const right = arena ? Number(r.size).toLocaleString() : Number(r.score).toLocaleString();
      const mid = arena ? `${r.wins || 0}🏆 ${r.kills || 0}☠` : `${r.kills || 0}☠`;
      return `<div class="rk2 ${r.you ? "me2" : ""}"><span style="color:${teamCol(r.team)}">${r.rank || "—"}</span>${chip}
        <span class="nm">${String(r.name).replace(/[<>&]/g, "")}</span>
        <span class="k">${mid}</span><span class="p">${right}</span></div>`;
    };
    let html = rows.map(line).join("");
    if (data && data.mine && !rows.some((r) => r.you)) html += `<div style="height:6px"></div>` + line(data.mine);
    UI.rlist.innerHTML = html || `<div class="rk2"><span></span><span></span><span class="nm">Nobody has finished a run in this window yet. Be first.</span><span></span><span></span></div>`;
  } catch (e) {
    UI.rlist.innerHTML = `<div class="rk2"><span></span><span></span><span class="nm">Rankings are offline — no server attached to this build.</span><span></span><span></span></div>`;
  }
  rankBusy = false;
}

function openRanks() {
  UI.rankSheet.classList.remove("hide");
  UI.rwhen.textContent = { day: "today", week: "this week", month: "this month", all: "all time", arena: "arena · this week" }[rankWindow];
  loadRanks();
}

function submitRun() {
  if (!G.score) return Promise.resolve();
  try {
    return fetch(`${API_BASE}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pid, name: G.rawName || G.name, flag: Wallet.flag, team: myTeam,
        score: G.score, kills: G.kills, mass: Math.round(G.peakMass || player.mass), room,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch (e) {}
  return Promise.resolve();
}

const G = {
  running: false, dead: false, deadAt: 0, score: 0, best: 0, kills: 0, earned: 0, startedAt: 0,
  stage: "Fry", stam: 1, grace: 0, name: "", peakR: 0, wasDash: false,
};
let player = null;
let bannerTimer = 0;

/** Nothing that can eat you starts the run inside your neighbourhood. */
function clearPredatorsNear(px, py, pr, radius) {
  for (let i = 0; i < fishes.length; i++) {
    const f = fishes[i];
    if (f === player || f.kind === "ghost") continue;
    if (f.r < pr * EAT_RATIO) continue;
    if (Math.hypot(f.x - px, f.y - py) > radius) continue;
    const a = rnd(0, TAU);
    const d = radius * rnd(1.15, 1.7);
    f.x = clamp(px + Math.cos(a) * d, 60, WORLD.w - 60);
    f.y = clamp(py + Math.sin(a) * d, 60, WORLD.h - 60);
    layoutSpine(f);
  }
}

function populate(px, py, ring, pm) {
  let guard = 0;
  /* Deep Strike opens nearly empty on purpose. The room fills during the
     muster, where the player can watch the count climb - a lobby that is
     already full the moment you arrive reads as scenery, not as people. */
  const cap = (typeof SK_ON === "function" && SK_ON()) ? 9 : MAX_FISH;
  while (fishes.length < cap && guard++ < 500) {
    const before = fishes.length;
    spawnFish(px, py, ring, pm);
    const f = fishes[fishes.length - 1];
    if (fishes.length > before) {
      /* Deep Strike fills the ARENA, not a ring around the player. */
      if (SK_ON()) {
        f.x = rnd(200, WORLD.w - 200);
        f.y = rnd(200, swimFloor() - 200);
        if (Math.hypot(f.x - px, f.y - py) < 700) {
          const a2 = rnd(0, TAU);
          f.x = clamp(px + Math.cos(a2) * 900, 200, WORLD.w - 200);
          f.y = clamp(py + Math.sin(a2) * 900, 200, swimFloor() - 200);
        }
        layoutSpine(f);
        continue;
      }
      /* scatter the opening cast across the whole visible disc, not its rim */
      const a = rnd(0, TAU), d = ring * Math.sqrt(rnd(0.05, 2.4));
      f.x = clamp(px + Math.cos(a) * d, 60, WORLD.w - 60);
      f.y = clamp(py + Math.sin(a) * d, 60, WORLD.h - 60);
      if (Math.hypot(f.x - px, f.y - py) < 260) { f.x += 300; }
      layoutSpine(f);
    }
  }
  clearPredatorsNear(px, py, radiusOf(pm), ring * 1.5);
}

function newRun(hard) {
  fishes = []; food = []; bits = []; texts = []; globs = []; drops = []; netsIn = [];
  for (const [, g] of ghosts) fishes.push(g);   /* other players do not vanish because you respawned */
  PU.boost = PU.shield = PU.magnet = PU.spitCd = PU.shieldLock = 0; PU.nets = 0;
  junk = [];
  buildHoles();
  resetBoss();
  PLAYER_SKIN = Wallet.skinDef();
  player = makeFish("player", SK_ON() ? SK_MASS : PLAYER_START_MASS,
    rnd(WORLD.w * 0.25, WORLD.w * 0.75), rnd(WORLD.h * 0.3, WORLD.h * 0.62), PLAYER_SKIN);
  player.wob = 1;
  fishes.push(player);
  sprinkleFood(MAX_FOOD, player.x, player.y, Math.hypot(VW, VH) / 2 / zoomFor(player.r));
  cam.x = player.x; cam.y = player.y;
  cam.z = cam.tz = zoomFor(player.r);
  populate(player.x, player.y, ringSize(), player.mass);
  G.score = 0; G.kills = 0; G.peakMass = 0; G.continues = 0; G.stam = 1; G.dead = false; G.stage = "Fry"; G.peakR = player.r;
  G.grace = hard ? SHIELD_TIME : 0;
  G.startedAt = T;
}

const ringSize = () => Math.hypot(VW, VH) / 2 / cam.z;
/* Zoom out slower than the fish grows, so growing up actually feels like it. */
function zoomFor(r) {
  const base = clamp(Math.min(VW, VH) / 780, 0.72, 1.3);
  /* Deep Strike never changes size, so the mass-driven zoom has nothing to say
     here. A fixed, wider frame instead: you cannot fight what you cannot see
     coming, and at the reef zoom the fish filled half the screen. */
  if (typeof SK_ON === "function" && SK_ON()) return clamp(base * 0.34, 0.22, 0.42);
  return clamp((base * 15.2) / Math.pow(Math.max(20, r), 0.72), 0.2, 1.2);
}

function banner(sub, big) {
  UI.banner.firstElementChild.textContent = sub;
  UI.banner.lastElementChild.textContent = big;
  UI.banner.classList.add("show");
  bannerTimer = 2.2;
}

/** Each rescue in the same run costs more, so pearls buy a second wind, not immortality. */
function continueCost() {
  return Math.min(2000, 50 * Math.pow(2, G.continues || 0));
}

/** Pick up where you fell: same score, smaller fish, a longer shield. */
function carryOn() {
  const cost = continueCost();
  if (Wallet.pearls < cost || !G.dead) return;
  Wallet.pearls -= cost;
  Wallet.save();
  G.continues = (G.continues || 0) + 1;

  player.dead = false;
  player.mass = Math.max(PLAYER_START_MASS, (G.deathMass || player.mass) * 0.55);
  player.r = radiusOf(player.mass);
  const a = rnd(0, TAU);
  player.x = clamp(player.x + Math.cos(a) * 900, 80, WORLD.w - 80);
  player.y = clamp(player.y + Math.sin(a) * 900, 80, WORLD.h - 80);
  layoutSpine(player);
  if (fishes.indexOf(player) < 0) fishes.push(player);

  G.dead = false;
  G.running = true;
  G.grace = SHIELD_TIME + 1.5;
  G.startedAt = T;
  cam.x = player.x; cam.y = player.y;
  clearPredatorsNear(player.x, player.y, player.r, ringSize() * 1.5);
  bits = []; globs = [];
  spark(player.x, player.y, player.r * 2, "rgba(182,255,216,1)");
  Snd.grow();
  banner("back from the brink", "carry on");
  UI.over.classList.add("hide");
  UI.hud.classList.add("on");
  push(false);
}

function gameOver(killer) {
  if (G.dead) return;
  G.dead = true;
  G.running = false;
  G.deadAt = T;
  cam.shake = 1;
  Snd.die();
  if (ARENA.on && ARENA.live) {
    spark(player.x, player.y, player.r * 1.4, "rgba(255,150,120,1)");
    if (GAME === "lastfish") {
      /* one life — that is the entire point of the mode */
      ARENA.joined = false;
      G.running = false;
      banner("you are out", "eliminated");
      return;
    }
    ARENA.lives = (ARENA.lives || 0) + 1;
    if (ARENA.lives > 3) {
      ARENA.joined = false;
      G.running = false;
      banner("out of lives", "wait for the whistle");
      return;
    }
    /* three ways back, then you sit the rest of the match out */
    ARENA.respawnAt = performance.now() + 2500;
    return;
  }
  spark(player.x, player.y, player.r * 1.4, "rgba(255,150,120,1)");
  bubble(player.x, player.y, player.r, 22, 0, 0);
  if (G.score > G.best) { G.best = G.score; try { localStorage.setItem("rr_best", String(G.best)); } catch (e) {} }
  G.deathMass = player.mass;
  G.earned = G.score >= 60 ? Math.floor(G.score / 25) + G.kills * 2 : 0;
  /* Deep Strike pays no pearls on purpose: what you carry is only what you
     found on the sea floor during the match. */
  if (SK_ON()) G.earned = 0;
  /* The cold start: a first run pays 8-20 pearls, which buys nothing worth
     placing. One grant, once ever, so the first visit to the tank is a
     shopping trip rather than a locked door. */
  if (!Wallet.firstHaul && G.score >= 60) { Wallet.firstHaul = 1; G.earned += 150; G.firstHaulPaid = true; }
  G.gemsEarned = 0;          /* gems are a placing reward — see claimGems() */
  Wallet.pearls += G.earned;
  Wallet.save();
  UI.fscore.textContent = G.score.toLocaleString();
  UI.fkills.textContent = String(G.kills);
  UI.fbest.textContent = G.best.toLocaleString();
  UI.fsize.textContent = stageFor(G.peakR);
  UI.fpearls.textContent = G.earned.toLocaleString();
  if (G.firstHaulPaid) { G.firstHaulPaid = false; setTimeout(() => banner("enough to furnish your tank", "+150 first haul"), 900); }
  UI.fgems.textContent = G.gemsEarned ? ` and ${G.gemsEarned} 💎` : "";
  const cost = continueCost();
  UI.contcost.textContent = cost.toLocaleString();
  UI.cont.style.display = !ARENA.on && Wallet.pearls >= cost ? "" : "none";
  UI.deathline.textContent = killer
    ? `Swallowed by something ${Math.round((killer.r / player.r) * 10) / 10}× your size.`
    : "The reef got the better of you.";
  push(true);
  /* Submit the run, THEN ask where it left you standing. Asking first answers
     about the player you were before this run, so the run that actually earns
     a top-ten place awarded neither the gems nor the VIP tanks. */
  submitRun().then(() => { refreshVip(); claimGems(); });
  setTimeout(() => { UI.over.classList.remove("hide"); UI.hud.classList.remove("on"); }, 1000);
}

/* ------------------------------------------------------------- stepping --- */
function control(dt) {
  let ax = 0, ay = 0, keyed = false;
  const k = IN.keys;
  if (k.KeyW || k.ArrowUp) { ay -= 1; keyed = true; }
  if (k.KeyS || k.ArrowDown) { ay += 1; keyed = true; }
  if (k.KeyA || k.ArrowLeft) { ax -= 1; keyed = true; }
  if (k.KeyD || k.ArrowRight) { ax += 1; keyed = true; }

  let ang = player.a, throttle = 0;
  if (keyed) {
    ang = Math.atan2(ay, ax);
    throttle = 1;
  } else if (IN.has) {
    const psx = VW / 2 + (player.x - cam.x) * cam.z;
    const psy = VH / 2 + (player.y - cam.y) * cam.z;
    const dx = IN.px - psx, dy = IN.py - psy;
    const d = Math.hypot(dx, dy);
    if (d > 6) { ang = Math.atan2(dy, dx); throttle = clamp(d / 150, 0.16, 1); }
  }

  const wantDash = IN.dash && G.stam > 0.04 && throttle > 0.2;
  if (wantDash) {
    G.stam = Math.max(0, G.stam - dt * 0.46);
    if (!G.wasDash) { Snd.dash(); bubble(player.x, player.y, player.r * 0.8, 6, -Math.cos(player.a) * 90, -Math.sin(player.a) * 90); }
  } else {
    G.stam = Math.min(1, G.stam + dt * (throttle < 0.3 ? 0.42 : 0.24));
  }
  G.wasDash = wantDash;

  const mult = throttle * (wantDash ? 2.05 : 1.08);
  player.ta = ang;
  player.boost = (mult - 0.5) / 0.42;
  player.panic = 0;

  /* WHY THE PLAYER WAS SHRINKING. The reef's spit is bound to the same button
     as the gun, and spit() pays for every glob out of your own mass - 8.5% a
     shot. In Deep Strike, pulling the trigger fired a bullet AND spat a lump
     of yourself: you were shooting yourself smaller. */
  if (!SK_ON() && IN.spit && PU.spitCd <= 0 && spit(player)) { PU.spitCd = SPIT_COOLDOWN; Snd.spit(); }
  if (IN.net) { IN.net = false; throwNet(player); }

  if (wantDash && Math.random() < dt * 34) {
    bubble(player.x - Math.cos(player.a) * player.r, player.y - Math.sin(player.a) * player.r, player.r * 0.3, 1, 0, 0);
  }
}

function collide() {
  for (let i = 0; i < fishes.length; i++) {
    const a = fishes[i];
    if (a.dead) continue;
    for (let j = i + 1; j < fishes.length; j++) {
      const b = fishes[j];
      if (b.dead) continue;
      if (a.kind === "ghost" || b.kind === "ghost") continue;
      const big = a.r >= b.r ? a : b;
      const small = big === a ? b : a;
      if (big.r < small.r * EAT_RATIO) continue;
      if (!G.running && (big === player || small === player)) continue;
      /* protection is mutual and applies to whoever is wearing it: a fish that
         just arrived can neither eat nor be eaten, and neither can you */
      if (a.safe > 0 || b.safe > 0) continue;
      if ((small === player || big === player) && G.grace > 0) continue;
      const dx = big.x - small.x, dy = big.y - small.y;
      const reach = big.r * 0.5 + small.r * 1.15;
      if (dx * dx + dy * dy > reach * reach) continue;

      small.dead = true;
      big.mass = Math.min(big === player ? PLAYER_MAX_MASS : AI_MAX_MASS, big.mass + small.mass * GROWTH);
      big.munch = 1;
      big.pop = 1;
      big.kills = (big.kills || 0) + 1;
      spark(small.x, small.y, small.r * 1.1, "rgba(255,214,150,1)");
      bubble(small.x, small.y, small.r * 0.8, 5, 0, 0);

      if (big === player && small.poison) {
        const loss = Math.round(16 * Math.sqrt(small.mass)) + 20;
        G.score = Math.max(0, G.score - loss);
        big.mass = Math.max(PLAYER_START_MASS, big.mass * 0.88);
        big.r = radiusOf(big.mass);
        cam.shake = Math.min(1, cam.shake + 0.7);
        floatText(small.x, small.y - small.r, "-" + loss + " POISON", "#b6ff7a");
        spark(small.x, small.y, small.r * 1.4, "rgba(150,255,110,1)");
        Snd.hit();
      } else if (big === player) {
        /* sublinear on purpose — linear scoring made an endgame run worth
           millions and a beginner's worth tens, which ruins any ranking */
        const gain = Math.round(12 * Math.sqrt(small.mass)) + 3;
        G.score += gain;
        G.kills++;
        floatText(small.x, small.y - small.r, "+" + gain);
        Snd.eat(clamp(small.r / 60, 0, 1));
        cam.shake = Math.min(1, cam.shake + clamp(small.r / 120, 0.05, 0.5));
      } else if (small === player) {
        if (PU.shield > 0) {
          PU.shield = 0;
          PU.shieldLock = 12;
          small.dead = false;
          G.grace = 1.4;
          player.mass = Math.max(PLAYER_START_MASS, player.mass * 0.7);
          player.r = radiusOf(player.mass);
          const away = Math.atan2(player.y - big.y, player.x - big.x);
          player.x += Math.cos(away) * (big.r + player.r) * 1.1;
          player.y += Math.sin(away) * (big.r + player.r) * 1.1;
          layoutSpine(player);
          cam.shake = 1;
          spark(player.x, player.y, player.r * 2, "rgba(182,255,216,1)");
          floatText(player.x, player.y - player.r * 1.6, "SHIELD BROKEN", "#b6ffd8");
          Snd.hit();
          continue;
        }
        gameOver(big);
      }
      if (small === a) break;
    }
  }
  if (fishes.some((f) => f.dead)) fishes = fishes.filter((f) => !f.dead || f === player);
}

/* A few fish per frame, round-robin: cheap, and over a minute everyone in
   the shoal gets a turn at the plankton. This is what lets a small fish
   become a big one without ever having spawned big. */
let grazeAt = 0;
function botsGraze(dt) {
  if (!food.length) return;
  for (let n = 0; n < 4; n++) {
    grazeAt = (grazeAt + 1) % Math.max(1, fishes.length);
    const f = fishes[grazeAt];
    if (!f || f.kind !== "ai") continue;
    const reach = f.r * 0.9 + 14;
    for (let i = food.length - 1; i >= 0; i--) {
      const q = food[i];
      const dx = q.x - f.x, dy = q.y - f.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      food.splice(i, 1);
      f.mass = Math.min(AI_MAX_MASS, f.mass + 1.7);
      f.r = radiusOf(f.mass);
      break;
    }
  }
}

function eatFood() {
  const reach = player.r * 0.8 + 16;
  const r2 = reach * reach;
  for (let i = food.length - 1; i >= 0; i--) {
    const p = food[i];
    const dx = p.x - player.x, dy = p.y - player.y;
    if (dx * dx + dy * dy > r2) continue;
    food.splice(i, 1);
    player.mass += 2.4;
    G.score += 2;
    player.munch = 0.7;
    Snd.food();
    spark(p.x, p.y, 6, "rgba(180,255,240,1)");
  }
}

function step(dt) {
  T += dt;
  stepArena();
  stepStrike(dt);
  stepBall(dt);
  stepCritters(dt);
  stepBoss(dt);
  if (G.grace > 0) {
    G.grace -= dt;
    /* dying the instant your shield lapses is not a fair death: if something
       that can eat you is already on top of you, shove it clear first */
    if (G.grace <= 0 && G.running && !G.dead) {
      clearPredatorsNear(player.x, player.y, player.r, player.r * 4 + 220);
    }
  }

  /* Being out has to mean out. skDown() sets SK.out and puts YOU ARE OUT on
     the screen, but nothing ever stopped the controls, so an eliminated fish
     carried on steering around the match. */
  if (SK_ON() && SK.out) {
    player.sp *= 1 - Math.min(1, 2.4 * dt);          /* coast to a halt */
    player.boost = 0;
  } else if (G.running && !G.dead) control(dt);
  else if (!G.dead) steerAI(player, dt);

  for (let i = 0; i < fishes.length; i++) {
    const f = fishes[i];
    if (f.kind === "ghost") continue;
    if (f !== player || !G.running || G.dead) steerAI(f, dt);
    moveFish(f, dt);
  }
  stepGhosts(dt);

  /* Deep Strike is the one mode where size is not the argument, so the eating
     rules are switched off wholesale rather than special-cased inside them. */
  if (!G.dead) { if (!SK_ON()) collide(); collidePlayers(); if (G.running && !SK_ON()) eatFood(); }
  botsGraze(dt);
  stepGlobs(dt);
  stepNets(dt);
  stepHoles(dt);
  applyDecay(dt);

  /* keep the reef stocked around wherever the camera is */
  const ring = ringSize();
  const far = Math.min(ring * 1.85, 3400);
  for (let i = fishes.length - 1; i >= 0; i--) {
    const f = fishes[i];
    if (f === player || f.kind === "ghost") continue;
    /* THE bug behind "they are all in one place" and "they are all shooting at
       me". The reef teleports any fish that drifts far away back beside you, so
       the ocean always feels busy as you swim through it. Right for a scrolling
       reef, badly wrong for a fixed arena: however well the hundred were
       scattered at the whistle, seconds later every one of them had been
       dragged onto your position, and every one was in range to shoot. */
    if (SK_ON()) continue;
    if (Math.hypot(f.x - player.x, f.y - player.y) <= far) continue;
    /* Deleting a fish that swam off screen threw away everything it had
       eaten, which is why the ocean never developed any big ones. Move it
       round to the far side instead — same fish, same size, new position. */
    const a2 = rnd(0, TAU);
    const d2 = ring * rnd(1.05, 1.4);
    f.x = clamp(player.x + Math.cos(a2) * d2, 60, WORLD.w - 60);
    f.y = clamp(player.y + Math.sin(a2) * d2, 60, swimFloor() - 80);
    f.a = f.ta = a2 + Math.PI;
    layoutSpine(f);
  }
  const foodFar = ring * 2.2;
  for (let i = food.length - 1; i >= 0; i--) {
    const q = food[i];
    if (Math.hypot(q.x - player.x, q.y - player.y) > foodFar) food.splice(i, 1);
  }
  if (!SK_ON() && fishes.length < MAX_FISH && Math.random() < dt * 30) spawnFish(player.x, player.y, ring, player.mass);
  /* retire bots that have topped out and drifted off-screen, so the shoal keeps
     turning over instead of settling into one giant size class */
  if (Math.random() < dt * 2) {
    for (let i = fishes.length - 1; i >= 0; i--) {
      const f = fishes[i];
      if (f === player || f.kind === "ghost") continue;
      if (f.mass < AI_MAX_MASS * 0.92) continue;
      if (Math.hypot(f.x - player.x, f.y - player.y) < ring * 1.15) continue;
      fishes.splice(i, 1);
      break;
    }
  }
  if (food.length < MAX_FOOD && Math.random() < dt * 60) spawnFoodNear(player.x, player.y, ring);
  stepDrops(dt, ring);
  stepJunk(dt, ring);

  /* particles */
  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i];
    b.life -= dt;
    if (b.life <= 0) { bits.splice(i, 1); continue; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.k === 0) { b.vy -= 26 * dt; b.vx *= 0.985; b.x += Math.sin(T * 4 + b.y * 0.05) * 8 * dt; }
    else if (b.k === 1) { b.vx *= 0.9; b.vy *= 0.9; }
  }
  for (let i = texts.length - 1; i >= 0; i--) {
    const s = texts[i];
    s.life -= dt * 1.1;
    s.y -= 26 * dt;
    if (s.life <= 0) texts.splice(i, 1);
  }

  /* stage progression */
  if (G.running) {
    if (player.r > G.peakR) G.peakR = player.r;
    if (player.mass > (G.peakMass || 0)) G.peakMass = player.mass;
    const st = stageFor(player.r);
    if (st !== G.stage) {
      G.stage = st;
      banner("you are now a", st);
      Snd.grow();
      spark(player.x, player.y, player.r * 1.2, "rgba(255,232,160,1)");
    }
  }
  if (bannerTimer > 0) { bannerTimer -= dt; if (bannerTimer <= 0) UI.banner.classList.remove("show"); }

  /* camera */
  cam.tz = zoomFor(player.r) * (G.dead ? 1.12 : 1);
  cam.z = lerp(cam.z, cam.tz, 1 - Math.pow(0.12, dt));
  const lead = G.running ? 90 : 40;
  const tx = player.x + Math.cos(player.a) * lead * clamp(player.sp / 200, 0, 1);
  const ty = player.y + Math.sin(player.a) * lead * clamp(player.sp / 200, 0, 1);
  const f = 1 - Math.pow(0.0015, dt);
  cam.x = lerp(cam.x, tx, f);
  cam.y = lerp(cam.y, ty, f);
  /* keep the frame mostly full of ocean — half a screen of empty black below
     the sea floor is wasted space */
  const hw = VW / 2 / cam.z, hh = VH / 2 / cam.z;
  const lox = Math.min(WORLD.w / 2, hw * 0.85), hix = Math.max(WORLD.w / 2, WORLD.w - hw * 0.85);
  const floorY2 = swimFloor() + 120;
  const loy = Math.min(floorY2 / 2, hh * 0.85), hiy = Math.max(floorY2 / 2, floorY2 - hh * 0.6);
  cam.x = clamp(cam.x, lox, hix);
  cam.y = clamp(cam.y, loy, hiy);
  cam.shake = Math.max(0, cam.shake - dt * 2.4);
}

/* --------------------------------------------------------------- frame --- */
function drawBounds() {
  const pad = 6000, fade = 520;
  ctx.save();
  const wall = (x0, y0, x1, y1, gx0, gy0, gx1, gy1) => {
    const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, "rgba(1,12,20,0)");
    g.addColorStop(0.55, "rgba(1,12,20,0.55)");
    g.addColorStop(1, "rgba(1,10,17,0.94)");
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  };
  if (viewL < fade) wall(-pad, -pad, fade, WORLD.h + pad, fade, 0, -pad, 0);
  if (viewR > WORLD.w - fade) wall(WORLD.w - fade, -pad, WORLD.w + pad, WORLD.h + pad, WORLD.w - fade, 0, WORLD.w + pad, 0);
  if (viewT < fade) wall(-pad, -pad, WORLD.w + pad, fade, 0, fade, 0, -pad);
  if (viewB > WORLD.h - fade * 0.4) wall(-pad, WORLD.h - fade * 0.4, WORLD.w + pad, WORLD.h + pad, 0, WORLD.h - fade * 0.4, 0, WORLD.h + pad);
  ctx.strokeStyle = "rgba(140,232,255,0.2)";
  ctx.lineWidth = Math.max(3, 7 / cam.z);
  ctx.setLineDash([90 / cam.z, 70 / cam.z]);
  ctx.strokeRect(0, 0, WORLD.w, WORLD.h);
  ctx.restore();
}

function drawGrace() {
  if (G.grace <= 0) return;
  const a = clamp(G.grace / SHIELD_TIME, 0, 1);
  ctx.save();
  ctx.setLineDash([player.r * 0.35, player.r * 0.3]);
  ctx.strokeStyle = `rgba(150,246,225,${0.1 + 0.16 * a + Math.sin(T * 6) * 0.05})`;
  ctx.lineWidth = Math.max(1.5, player.r * 0.06);
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.r * 1.9 + Math.sin(T * 3) * player.r * 0.06, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawArrows() {
  if (!G.running || G.dead) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const cx = VW / 2, cy = VH / 2;
  const mx = cx - 34, my = cy - 34;
  for (let i = 0; i < fishes.length; i++) {
    const f = fishes[i];
    if (f === player || f.r < player.r * 1.3) continue;
    const dx = f.x - player.x, dy = f.y - player.y;
    const d = Math.hypot(dx, dy);
    if (d < 60 || d > 1500) continue;
    const sx = cx + dx * cam.z, sy = cy + dy * cam.z;
    if (sx > 40 && sx < VW - 40 && sy > 40 && sy < VH - 40) continue;
    const a = Math.atan2(dy, dx);
    const ca = Math.cos(a), sa = Math.sin(a);
    const scale = Math.min(mx / Math.max(0.0001, Math.abs(ca)), my / Math.max(0.0001, Math.abs(sa)));
    const px = cx + ca * scale, py = cy + sa * scale;
    const alpha = clamp(1 - d / 1500, 0.12, 0.6);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a);
    ctx.fillStyle = `rgba(255,98,86,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(11, 0); ctx.lineTo(-7, -7); ctx.lineTo(-4, 0); ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function render() {
  drawWater();
  if (cam.shake > 0.001) {
    const s = cam.shake * 9;
    cam.x += rnd(-s, s) / cam.z * 0.3;
    cam.y += rnd(-s, s) / cam.z * 0.3;
  }
  applyCamera();
  drawBounds();
  drawRocks();
  drawSeabed();
  drawMotes();
  drawHoles();
  drawFood();
  drawDrops();
  drawJunk();

  /* far fish first so the big ones read as closer */
  fishes.sort((a, b) => a.r - b.r);
  for (let i = 0; i < fishes.length; i++) {
    const f = fishes[i];
    if (f.x + f.r * 3 < viewL || f.x - f.r * 3 > viewR || f.y + f.r * 3 < viewT || f.y - f.r * 3 > viewB) continue;
    const isP = f === player;
    let level = 0;
    if (!isP && G.running && !G.dead) {
      if (f.r > player.r * EAT_RATIO) level = 1;
      else if (f.r < player.r * PREY_RATIO) level = -1;
    }
    drawFish(f, isP, level);
  }
  drawCritters();
  drawBoss();
  drawBall();
  drawTide();
  drawSafeWater();
  drawGhostTags();
  drawGrace();
  if (Wallet.flag && G.running && !G.dead) {
    const fw = Math.max(22, player.r * 0.55), fh = fw * 0.66;
    paintFlag(ctx, flagByCode(Wallet.flag), player.x - fw / 2, player.y - player.r * 1.15 - fh, fw, fh);
  }
  drawGlobs();
  drawNets();
  drawStrike();
  drawBits();
  drawArrows();

  /* vignette */
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const vg = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.32, VW / 2, VH / 2, Math.max(VW, VH) * 0.78);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,10,18,0.5)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, VW, VH);
  if (G.dead) {
    ctx.fillStyle = `rgba(40,0,10,${clamp((T - G.deadAt) * 0.35, 0, 0.3)})`;
    ctx.fillRect(0, 0, VW, VH);
  }
}

/* ------------------------------------------------------------------ hud --- */
let hudTick = 0;
let boardTick = 0;
function syncHud() {
  UI.score.textContent = G.score.toLocaleString();
  UI.stage.textContent = G.stage;
  const idx = STAGES.findIndex((s) => player.r < s.r);
  const lo = idx <= 0 ? 0 : STAGES[idx - 1].r;
  const hi = STAGES[Math.max(0, idx)].r;
  UI.fill.style.width = clamp(((player.r - lo) / (hi - lo)) * 100, 3, 100) + "%";
  UI.stam.style.width = (G.stam * 100).toFixed(0) + "%";
  UI.stam.style.opacity = G.stam < 0.2 ? "0.45" : "1";
  UI.purseTop.textContent = Wallet.pearls.toLocaleString();
  UI.gemTop.textContent = Wallet.gems.toLocaleString();

  const chips = [];
  if (G.grace > 0) chips.push(`<div class="pup" style="border-color:rgba(150,246,225,.5)"><i style="background:#96f6e1">◉</i>SAFE <s>${G.grace.toFixed(1)}s</s></div>`);
  if (PU.shield > 0) chips.push(`<div class="pup"><i style="background:#b6ffd8">◈</i>SHIELD <s>${Math.ceil(PU.shield)}s</s></div>`);
  if (PU.boost > 0) chips.push(`<div class="pup"><i style="background:#7be0ff">»</i>SURGE <s>${Math.ceil(PU.boost)}s</s></div>`);
  if (PU.magnet > 0) chips.push(`<div class="pup"><i style="background:#ffd76b">◎</i>MAGNET <s>${Math.ceil(PU.magnet)}s</s></div>`);
  if (PU.nets > 0) chips.push(`<div class="pup"><i style="background:#ff9ecb">#</i>NETS <s>x${PU.nets}</s></div>`);
  const html = chips.join("");
  if (html !== UI.pups.dataset.h) { UI.pups.dataset.h = html; UI.pups.innerHTML = html; }
}

/* ---- the shop ---- */
let shopTab = "skins";

function previewFish(cv2, skin) {
  const c = cv2.getContext("2d");
  const w = cv2.width, h = cv2.height;
  c.clearRect(0, 0, w, h);
  const cx = w * 0.56, cy = h * 0.5, R = w * 0.3;
  c.fillStyle = skin.fin;
  c.beginPath();
  c.moveTo(cx - R * 0.95, cy);
  c.lineTo(cx - R * 1.75, cy - R * 0.62);
  c.quadraticCurveTo(cx - R * 1.3, cy, cx - R * 1.75, cy + R * 0.62);
  c.closePath(); c.fill();
  const g = c.createLinearGradient(0, cy - R * skin.fat * 1.6, 0, cy + R * skin.fat * 1.6);
  g.addColorStop(0, skin.back);
  g.addColorStop(0.55, skin.belly);
  g.addColorStop(1, "#fffdf8");
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(cx - R * 0.15, cy, R * 1.05, R * skin.fat * 1.55, 0, 0, TAU);
  c.fill();
  if (skin.stripe) {
    c.save(); c.clip(); c.fillStyle = skin.stripe; c.globalAlpha = 0.8;
    for (let i = 0; i < 3; i++) c.fillRect(cx - R * (0.1 + i * 0.5), cy - R, R * 0.16, R * 2);
    c.restore();
  }
  c.fillStyle = "#fdfdff";
  c.beginPath(); c.arc(cx + R * 0.6, cy - R * 0.18, R * 0.18, 0, TAU); c.fill();
  c.fillStyle = "#08202c";
  c.beginPath(); c.arc(cx + R * 0.65, cy - R * 0.18, R * 0.1, 0, TAU); c.fill();
}

function renderShop() {
  UI.purse.textContent = Wallet.pearls.toLocaleString();
  UI.purseTop.textContent = Wallet.pearls.toLocaleString();
  UI.gemPurse.textContent = Wallet.gems.toLocaleString();
  UI.gemTop.textContent = Wallet.gems.toLocaleString();
  UI.purseStart.textContent = Wallet.pearls.toLocaleString();
  UI.grid.innerHTML = "";
  if (shopTab === "skins") {
    for (const sk of SKINS) {
      const owned = !!Wallet.owned[sk.id];
      const on = Wallet.skin === sk.id;
      const can = owned || Wallet.pearls >= sk.price;
      const d = document.createElement("div");
      d.className = "item" + (owned ? " owned" : "") + (on ? " on2" : "") + (can ? "" : " cant");
      d.innerHTML = `<canvas width="118" height="58"></canvas><div class="nm2">${sk.name}</div>
        <div class="pr">${on ? "Equipped" : owned ? "Tap to equip" : "🫧 " + sk.price.toLocaleString()}</div>
        ${sk.prem ? '<span class="crown">PREMIUM</span>' : ""}`;
      previewFish(d.querySelector("canvas"), sk);
      d.onclick = () => {
        if (owned) { Wallet.skin = sk.id; }
        else if (Wallet.pearls >= sk.price) { Wallet.pearls -= sk.price; Wallet.owned[sk.id] = 1; Wallet.skin = sk.id; Snd.pickup(); }
        else { return; }
        Wallet.save(); renderShop();
      };
      UI.grid.appendChild(d);
    }
  } else {
    const none = document.createElement("div");
    none.className = "item" + (Wallet.flag === "" ? " on2" : "");
    none.innerHTML = `<div class="fl">—</div><div class="nm2">No flag</div><div class="pr">${Wallet.flag === "" ? "Equipped" : "Free"}</div>`;
    none.onclick = () => { Wallet.flag = ""; Wallet.save(); renderShop(); };
    UI.grid.appendChild(none);
    for (const fg of FLAGS) {
      const on = Wallet.flag === fg.c;
      const d = document.createElement("div");
      d.className = "item" + (on ? " on2" : "");
      d.innerHTML = `<canvas width="72" height="48"></canvas><div class="nm2">${fg.n}</div><div class="pr">${on ? "Equipped" : "Free"}</div>`;
      paintFlag(d.querySelector("canvas").getContext("2d"), fg, 0, 0, 72, 48);
      d.onclick = () => { Wallet.flag = fg.c; Wallet.save(); renderShop(); };
      UI.grid.appendChild(d);
    }
  }
}

function renderGamePick() {
  const box = el("gamePick");
  if (!box) return;
  box.innerHTML = Object.keys(GAMES).map((id) => {
    const g = GAMES[id];
    return `<div class="gm ${id === GAME ? "on" : ""} ${g.soon ? "soon" : ""}" data-game="${id}">
      <i>${g.icon}</i><div><b>${g.name}</b><span>${g.blurb}</span></div>
      ${g.soon ? '<em style="margin-left:auto">soon</em>' : ""}</div>`;
  }).join("");
  for (const card of box.querySelectorAll(".gm")) {
    if (card.classList.contains("soon")) continue;
    card.addEventListener("click", () => {
      if (card.dataset.game === GAME) return;
      const q = new URLSearchParams(location.search);
      q.set("mode", "arena");
      q.set("game", card.dataset.game);
      location.search = q.toString();
    });
  }
}

function paintTeamUI() {
  for (const b of UI.teamPick.querySelectorAll(".tm")) {
    const t = Number(b.dataset.team);
    const on = t === myTeam;
    b.classList.toggle("on", on);
    b.style.borderColor = on ? teamCol(t) : "";
    b.style.color = on ? teamCol(t) : "";
  }
  UI.teamHud.textContent = TEAMS[myTeam].name;
  UI.teamHud.style.color = teamCol(myTeam);
}

function openShop() { renderShop(); UI.shop.classList.remove("hide"); }
function closeShop() { UI.shop.classList.add("hide"); if (player && !G.running) { PLAYER_SKIN = Wallet.skinDef(); player.skin = PLAYER_SKIN; player.gradR = -1; } }

/* The in-game board answers "who is the biggest thing in this water right
   now", so the bots belong on it — they are most of the reef. Size is the
   ranking, because that is the only number a bot and a player share.
   The persistent day/week/month rankings stay human-only. */
let lastRows = null;

function renderBoard(rows) {
  lastRows = rows && rows.length ? rows : null;
  refreshBoard();
}

function refreshBoard() {
  const entries = [];
  if (lastRows) {
    for (const r of lastRows) {
      entries.push({ name: String(r.name), team: r.team || 0, mass: r.mass || 0, kills: r.kills || 0, you: !!r.you, bot: false });
    }
  }
  if (!entries.some((e) => e.you)) {
    entries.push({ name: (Wallet.flag ? Wallet.flag + " " : "") + (G.rawName || "you"), team: myTeam, mass: 0, kills: G.kills, you: true, bot: false });
  }
  if (player) {
    const me = entries.find((e) => e.you);
    if (me) { me.mass = Math.round(player.mass); me.kills = G.kills; }
  }
  for (let i = 0; i < fishes.length; i++) {
    const f = fishes[i];
    if (f.kind !== "ai") continue;
    entries.push({ name: f.pname || "reef fish", team: -1, mass: Math.round(f.mass), kills: f.kills || 0, you: false, bot: true });
  }
  /* Deep Strike is ranked on kills, because size means nothing in it. */
  if (SK_ON()) entries.sort((a, b) => (b.kills || 0) - (a.kills || 0) || b.mass - a.mass);
  else entries.sort((a, b) => b.mass - a.mass);

  /* you always get a line, even when the whole reef is bigger than you */
  const top = entries.slice(0, 7);
  const myIndex = entries.findIndex((e) => e.you);
  if (myIndex >= 7) top.push(entries[myIndex]);

  if (SK_ON()) {
    const t = el("boardTitle");
    if (t) t.textContent = `Still swimming ${SK.left} · kills`;
  }
  UI.ranks.innerHTML = top.map((e) => {
    const i = entries.indexOf(e);
    let nm = e.name.replace(/[<>&]/g, "");
    let chip = "";
    const m = /^([A-Z]{2}) (.+)$/.exec(nm);
    if (m && flagByCode(m[1])) { chip = `<img class="fchip" src="${flagURL(m[1])}" alt="${m[1]}">`; nm = m[2]; }
    const col = e.bot ? "#6f8fa0" : teamCol(e.team);
    const tag = "";
    const kd = e.kills ? `<span class="sc" style="color:#ff9b8c">${e.kills}☠</span>` : "";
    /* In Deep Strike the number that matters is kills, so it is the number
       shown. Printing size beside it was noise: every fish is the same size. */
    if (SK_ON()) {
      return `<li class="${e.you ? "me" : ""}"><span class="rk" style="color:${col}">${i + 1}</span>${chip}<span class="nm">${nm}</span><span class="sc" style="color:#ff9b8c">${e.kills || 0}</span></li>`;
    }
    return `<li class="${e.you ? "me" : ""}"><span class="rk" style="color:${col}">${i + 1}</span>${chip}<span class="nm">${nm}${tag}</span>${kd}<span class="sc">${e.mass.toLocaleString()}</span></li>`;
  }).join("");
}

/* ------------------------------------------------------------------ net --- */
const params = new URLSearchParams(location.search);
const MODE = params.get("mode") === "arena" ? "arena" : params.get("mode") === "tank" ? "tank" : "reef";

/* Every arena game is its own game: its own rooms, its own ladder, its own
   rules. Teams exist in exactly one of them. */
const GAMES = {
  survival: { name: "Survival",      icon: "◎", blurb: "Biggest fish at the whistle takes it.", teams: false },
  lastfish: { name: "Last Fish Out", icon: "◉", blurb: "The safe water closes in. Be the last one in it.", teams: false },
  teamwars: { name: "Team Wars",     icon: "⚑", blurb: "Three teams. The side that eats most, wins.", teams: true },
  tidepool: { name: "Closing Waves", icon: "≋", blurb: "Rings of surf push inward. Stay inside or lose everything.", teams: false },
  football: { name: "Fish Football", icon: "⬤", blurb: "Shove the pearl into their goal.", teams: true },
  volley:   { name: "Fish Volleyball", icon: "⬡", blurb: "Keep the pearl off your own sea floor.", teams: true },
  deepstrike: { name: "Deep Strike", icon: "✦", blurb: "A hundred fish, no food, every one the same size. Last one swimming wins.", teams: false },
};
/* Three bodies of water. One is open to everyone; the other two are the
   reward for finishing near the top of a board, or for buying in. */
const TANKS = {
  reef:   { name: "Coral Reef",  blurb: "warm, busy, forgiving", w: 16800, h: 6200, vip: false, hue: 0 },
  trench: { name: "Deep Trench", blurb: "dark, sparse, unkind",  w: 21000, h: 8200, vip: true,  hue: -26 },
  lagoon: { name: "Sunlit Lagoon", blurb: "bright, tight, frantic", w: 9800, h: 4400, vip: true, hue: 18 },
  throne: { name: "Poseidon's Court", blurb: "he is sitting right there", w: 12000, h: 5200, vip: true, hue: 6 },
};
let TANK = TANKS[params.get("tank")] ? params.get("tank") : "reef";

const GAME = GAMES[params.get("game")] && !GAMES[params.get("game")].soon ? params.get("game") : "survival";
const GAMEDEF = GAMES[GAME];
/* Every tab landed in the same room, which is why the board showed four of
   you - they were all you. An arena room now gets a shard per browser tab, so
   opening the game twice puts you in two different matches. ?room=whatever
   still overrides it, so a link shared with a friend works as before. */
let arenaShard = "";
/* Football and volleyball need two people in one room to exist at all, and a
   random 1-in-6 shard is a poor way to arrange that. The self-collision this
   sharding was added for is already handled elsewhere: seats dedupe by
   playerId, the live channel drops any ghost whose id is our own, and the
   persistent board groups by pid. So the ball games share one room. */
const SHARDED = MODE === "arena" && GAME !== "football" && GAME !== "volley";
if (SHARDED && !params.get("room")) {
  try {
    arenaShard = sessionStorage.getItem("rr_shard") || "";
    if (!arenaShard) {
      arenaShard = String(1 + Math.floor(Math.random() * 6));
      sessionStorage.setItem("rr_shard", arenaShard);
    }
  } catch (e) { arenaShard = "1"; }
}
const baseRoom = (params.get("room") || (arenaShard ? "r" + arenaShard : "main")).slice(0, 30);
/* arenas and reefs never share a room, so their fish never share a screen */
const room = (MODE === "arena" ? "a-" + GAME + "-" + baseRoom : baseRoom).slice(0, 40);
let pid = "";
try {
  pid = localStorage.getItem("rr_pid") || "";
  if (!pid) { pid = "f" + Math.random().toString(36).slice(2, 10); localStorage.setItem("rr_pid", pid); }
} catch (e) { pid = "f" + Math.random().toString(36).slice(2, 10); }

let ws = null, wsReady = false, retry = 0;
function connect() {
  try {
    const base = typeof window.REEF_WS === "string" && window.REEF_WS
      ? window.REEF_WS.replace(/\/$/, "")
      : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
    ws = new WebSocket(`${base}/ws/${encodeURIComponent(room)}`);
  } catch (e) { return; }
  ws.onopen = () => {
    wsReady = true; retry = 0;
    ws.send(JSON.stringify({ type: "join", playerId: pid }));
    if (G.name) ws.send(JSON.stringify({ type: "action", action: { t: "name", name: G.name } }));
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg && msg.t === "L") { handleLive(msg); return; }
    if (msg && msg.type === "state" && msg.view && msg.view.board) {
      renderBoard(msg.view.board);
      if (msg.view.you && msg.view.you.best > G.best) G.best = msg.view.you.best;
      if (msg.view.teams) {
        UI.teamBar.innerHTML = msg.view.teams.map((t) =>
          `<div style="flex:1;text-align:center;padding:3px 0;border-radius:6px;font-size:10.5px;font-weight:800;background:${teamCol(t.id)}22;color:${teamCol(t.id)}">${TEAMS[t.id].name}<br>${t.score.toLocaleString()}</div>`
        ).join("");
      }
      if (ballGame()) {
        UI.teamBar.innerHTML = [0, 1].map((t) =>
          `<div style="flex:1;text-align:center;padding:3px 0;border-radius:6px;font-size:13px;font-weight:800;background:${teamCol(t)}22;color:${teamCol(t)}">${TEAMS[t].name}<br>${BALL.s[t]}</div>`
        ).join("");
      }
      const n = ghosts.size + 1;
      /* An empty pitch reads as broken rather than as waiting, so say which it is.
         Count from the room roster rather than from ghosts: a ghost only appears
         once that player broadcasts a position, and a backgrounded tab broadcasts
         slowly, which would call two people on a pitch "waiting". A ball game has
         no AI fish, so every row on the roster is a person. */
      const here = ballGame() && Array.isArray(msg.view.board) ? Math.max(n, msg.view.board.length) : n;
      UI.arena.textContent = ballGame() && here < 2
        ? `waiting for a second fish · share this link to start`
        : here > 1 ? `${here} fish in this reef · room “${room}”` : `solo reef · share ?room=${room}`;
    }
  };
  ws.onclose = () => {
    wsReady = false;
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 900 * retry);
  };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}

function push(newRunFlag) {
  if (!wsReady || !ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify({
      type: "action",
      action: {
        t: "sync", name: G.name, score: G.score, team: myTeam,
        mass: Math.round(player ? player.mass : 0),
        alive: G.running && !G.dead, newRun: newRunFlag === true, kills: G.kills,
      },
    }));
  } catch (e) {}
}
let pushAt = 0;

/* ==========================================================================
   COMBAT, WORMHOLES, POWERUPS, COSMETICS
   ========================================================================== */

const SHIELD_TIME = 3.5;
const SPIT_COST = 0.085;      /* fraction of your own mass per shot */
const SPIT_MIN_MASS = 70;     /* below this you are too small to spit */
const SPIT_COOLDOWN = 0.42;

let globs = [];   /* spat mass */
let holes = [];   /* wormholes, in pairs */
let drops = [];   /* powerup pickups */
let netsIn = [];  /* nets in flight */
let junk = [];    /* plastic — eating the ocean's rubbish costs you */
const POISON_CHANCE = 0.09;

const PU = { boost: 0, shield: 0, magnet: 0, nets: 0, spitCd: 0, shieldLock: 0 };

const DROP_KINDS = [
  { k: "boost",  col: "#7be0ff", icon: "»", label: "Sprint surge" },
  { k: "shield", col: "#b6ffd8", icon: "◈", label: "Bubble shield" },
  { k: "magnet", col: "#ffd76b", icon: "◎", label: "Plankton magnet" },
  { k: "nets",   col: "#ff9ecb", icon: "#", label: "Net x2" },
];

/* ---- cosmetics ------------------------------------------------------- */
const SKINS = [
  { id: "clown",   name: "Clownfish",   price: 0,    prem: 0, back: "#ff8a2b", belly: "#ffe3b4", fin: "#ffd05e", stripe: "#fff8ec", len: 1.8,  fat: 0.60 },
  { id: "tang",    name: "Blue Tang",   price: 250,  prem: 0, back: "#2f7de0", belly: "#8fd8ff", fin: "#ffd45e", stripe: null,      len: 1.7,  fat: 0.62 },
  { id: "emerald", name: "Emerald",     price: 250,  prem: 0, back: "#17997a", belly: "#a8f2cf", fin: "#ffe07a", stripe: null,      len: 1.9,  fat: 0.50 },
  { id: "rose",    name: "Rosefish",    price: 400,  prem: 0, back: "#d94f76", belly: "#ffc7d8", fin: "#ffd9e6", stripe: null,      len: 1.8,  fat: 0.55 },
  { id: "butter",  name: "Butterfly",   price: 400,  prem: 0, back: "#e0a11c", belly: "#fff0b8", fin: "#fff4cd", stripe: "#7a4b06", len: 1.65, fat: 0.66 },
  { id: "violet",  name: "Violet Ray",  price: 700,  prem: 0, back: "#6b52c9", belly: "#cbbcff", fin: "#9be8ff", stripe: null,      len: 1.85, fat: 0.56 },
  { id: "silver",  name: "Silverside",  price: 700,  prem: 0, back: "#5d7b91", belly: "#e2f1fb", fin: "#cfe6f3", stripe: null,      len: 2.1,  fat: 0.44 },
  { id: "teal",    name: "Reef Teal",   price: 1100, prem: 0, back: "#118c9e", belly: "#a9ecf5", fin: "#ffb36b", stripe: null,      len: 1.8,  fat: 0.58 },
  { id: "tiger",   name: "Tiger Reef",  price: 1800, prem: 0, back: "#c2410c", belly: "#ffdca8", fin: "#ffb347", stripe: "#2a1206", len: 1.9,  fat: 0.58 },
  { id: "abyss",   name: "Abyss Lamp",  price: 2600, prem: 1, back: "#0f2b47", belly: "#37e0ff", fin: "#8ef6ff", stripe: "#0affe0", len: 2.0,  fat: 0.52 },
  { id: "koi",     name: "Reef Koi",    price: 3400, prem: 1, back: "#f4f4f6", belly: "#ffffff", fin: "#ff5a3c", stripe: "#ff3b1f", len: 1.85, fat: 0.62 },
  { id: "gold",    name: "Gilded",      price: 5000, prem: 1, back: "#b8860b", belly: "#ffef9f", fin: "#ffd700", stripe: "#fff6c9", len: 1.9,  fat: 0.58 },
  { id: "orca",    name: "Little Orca", price: 6500, prem: 1, back: "#12181f", belly: "#ffffff", fin: "#e9f4fb", stripe: null,      len: 2.3,  fat: 0.5  },
  { id: "spectre", name: "Spectre",     price: 9000, prem: 1, back: "#2a0f4d", belly: "#e0b3ff", fin: "#b47bff", stripe: "#f0d6ff", len: 2.2,  fat: 0.48 },

  /* the wider reef — shapes as well as colours, so the roster reads as a
     whole ecosystem rather than one fish in fifteen paint jobs */
  { id: "angel",    name: "Angelfish",   price: 500,  prem: 0, back: "#f0c419", belly: "#fff6cf", fin: "#ffffff", stripe: "#1c1c22", len: 1.5,  fat: 0.86 },
  { id: "puffer",   name: "Pufferfish",  price: 600,  prem: 0, back: "#c98a2e", belly: "#ffe9bd", fin: "#ffd98a", stripe: "#5a3a12", len: 1.35, fat: 0.98 },
  { id: "parrot",   name: "Parrotfish",  price: 850,  prem: 0, back: "#12a8a0", belly: "#a9f7d8", fin: "#ff7ab5", stripe: "#ffd166", len: 1.7,  fat: 0.72 },
  { id: "trigger",  name: "Triggerfish", price: 900,  prem: 0, back: "#2f4858", belly: "#cfe8f0", fin: "#f6c453", stripe: "#0f2027", len: 1.6,  fat: 0.8  },
  { id: "piranha",  name: "Piranha",     price: 1200, prem: 0, back: "#4a4e57", belly: "#ff8f6b", fin: "#d64545", stripe: null,      len: 1.6,  fat: 0.74 },
  { id: "mahi",     name: "Mahi-Mahi",   price: 1500, prem: 0, back: "#1f8fd6", belly: "#f7e26b", fin: "#3ad6a0", stripe: null,      len: 2.0,  fat: 0.6  },
  { id: "lion",     name: "Lionfish",    price: 2000, prem: 0, back: "#b3341f", belly: "#ffe2cf", fin: "#ffb066", stripe: "#3a0f06", len: 1.7,  fat: 0.78 },
  { id: "catfish",  name: "Catfish",     price: 2200, prem: 0, back: "#6b5a4a", belly: "#e8d6bd", fin: "#a08b73", stripe: null,      len: 2.0,  fat: 0.66 },
  { id: "eel",      name: "Moray Eel",   price: 2800, prem: 0, back: "#3c6b3a", belly: "#d7e8a8", fin: "#8fbf6a", stripe: "#22401f", len: 2.6,  fat: 0.34 },
  { id: "sword",    name: "Swordfish",   price: 3200, prem: 0, back: "#26547c", belly: "#e8f4fb", fin: "#9ec9e2", stripe: null,      len: 2.5,  fat: 0.4  },
  { id: "ray",      name: "Manta Ray",   price: 3800, prem: 0, back: "#1b2a3a", belly: "#f2f7fa", fin: "#4a6a86", stripe: null,      len: 1.5,  fat: 0.94 },
  { id: "hammer",   name: "Hammerhead",  price: 5200, prem: 1, back: "#7d8b95", belly: "#f0f5f8", fin: "#aebfc9", stripe: null,      len: 2.4,  fat: 0.46 },
  { id: "tiger2",   name: "Tiger Shark", price: 7000, prem: 1, back: "#5d6b62", belly: "#eef3ee", fin: "#93a89a", stripe: "#2b352f", len: 2.5,  fat: 0.48 },
  { id: "angler",   name: "Anglerfish",  price: 8000, prem: 1, back: "#1a1030", belly: "#6a4fa8", fin: "#5ef2ff", stripe: "#9df9ff", len: 1.5,  fat: 0.92 },
  { id: "greatwh",  name: "Great White", price: 11000, prem: 1, back: "#5a6a72", belly: "#ffffff", fin: "#c3d2da", stripe: null,      len: 2.6,  fat: 0.5  },
  { id: "megalo",   name: "Megalodon",   price: 16000, prem: 1, back: "#2e3b44", belly: "#dce8ee", fin: "#7d939f", stripe: null,      len: 2.8,  fat: 0.56 },
  { id: "trident",  name: "Poseidon's Guard", price: 24000, prem: 1, back: "#0d3b66", belly: "#ffd166", fin: "#f4d35e", stripe: "#ffe9a8", len: 2.2, fat: 0.62 },
];

/* Flags are drawn, never typed: Windows ships no flag glyphs, so emoji flags
   degrade to bare letter pairs. These are simplified but recognisable. */
const FLAGS = [
  { c: "IN", n: "India",        t: "h3", k: ["#FF9933", "#FFFFFF", "#138808"], dot: "#000080" },
  { c: "US", n: "USA",          t: "us", k: ["#B22234", "#FFFFFF", "#3C3B6E"] },
  { c: "GB", n: "UK",           t: "cx", k: ["#012169", "#FFFFFF", "#C8102E"] },
  { c: "JP", n: "Japan",        t: "sl", k: ["#FFFFFF"], dot: "#BC002D" },
  { c: "BR", n: "Brazil",       t: "sl", k: ["#009C3B"], dot: "#FFDF00", dot2: "#002776" },
  { c: "DE", n: "Germany",      t: "h3", k: ["#000000", "#DD0000", "#FFCE00"] },
  { c: "FR", n: "France",       t: "v3", k: ["#002395", "#FFFFFF", "#ED2939"] },
  { c: "IT", n: "Italy",        t: "v3", k: ["#008C45", "#F4F5F0", "#CD212A"] },
  { c: "ES", n: "Spain",        t: "h3", k: ["#AA151B", "#F1BF00", "#AA151B"] },
  { c: "MX", n: "Mexico",       t: "v3", k: ["#006847", "#FFFFFF", "#CE1126"] },
  { c: "CA", n: "Canada",       t: "v3", k: ["#D80621", "#FFFFFF", "#D80621"], dot: "#D80621" },
  { c: "AU", n: "Australia",    t: "sl", k: ["#00247D"], dot: "#FFFFFF" },
  { c: "KR", n: "Korea",        t: "sl", k: ["#FFFFFF"], dot: "#CD2E3A", dot2: "#0047A0" },
  { c: "CN", n: "China",        t: "sl", k: ["#EE1C25"], dot: "#FFFF00" },
  { c: "RU", n: "Russia",       t: "h3", k: ["#FFFFFF", "#0039A6", "#D52B1E"] },
  { c: "NG", n: "Nigeria",      t: "v3", k: ["#008751", "#FFFFFF", "#008751"] },
  { c: "ZA", n: "South Africa", t: "h3", k: ["#007A4D", "#FFFFFF", "#002395"] },
  { c: "EG", n: "Egypt",        t: "h3", k: ["#CE1126", "#FFFFFF", "#000000"] },
  { c: "AR", n: "Argentina",    t: "h3", k: ["#74ACDF", "#FFFFFF", "#74ACDF"], dot: "#F6B40E" },
  { c: "SE", n: "Sweden",       t: "nd", k: ["#006AA7", "#FECC02"] },
  { c: "NO", n: "Norway",       t: "nd", k: ["#BA0C2F", "#FFFFFF"] },
  { c: "NL", n: "Netherlands",  t: "h3", k: ["#AE1C28", "#FFFFFF", "#21468B"] },
  { c: "TR", n: "Türkiye",      t: "sl", k: ["#E30A17"], dot: "#FFFFFF" },
  { c: "ID", n: "Indonesia",    t: "h2", k: ["#CE1126", "#FFFFFF"] },
  { c: "PH", n: "Philippines",  t: "h2", k: ["#0038A8", "#CE1126"], dot: "#FCD116" },
  { c: "VN", n: "Vietnam",      t: "sl", k: ["#DA251D"], dot: "#FFFF00" },
  { c: "TH", n: "Thailand",     t: "h3", k: ["#A51931", "#F4F5F8", "#2D2A4A"] },
  { c: "PK", n: "Pakistan",     t: "v2", k: ["#FFFFFF", "#01411C"], dot: "#FFFFFF" },
  { c: "BD", n: "Bangladesh",   t: "sl", k: ["#006A4E"], dot: "#F42A41" },
  { c: "UA", n: "Ukraine",      t: "h2", k: ["#0057B7", "#FFD700"] },
  { c: "PL", n: "Poland",       t: "h2", k: ["#FFFFFF", "#DC143C"] },
  { c: "PT", n: "Portugal",     t: "v2", k: ["#046A38", "#DA291C"], dot: "#FFE900" },
  { c: "SA", n: "Saudi Arabia", t: "sl", k: ["#006C35"], dot: "#FFFFFF" },
  { c: "AE", n: "UAE",          t: "h3", k: ["#00732F", "#FFFFFF", "#000000"] },
  { c: "NZ", n: "New Zealand",  t: "sl", k: ["#00247D"], dot: "#CC142B" },
  { c: "IE", n: "Ireland",      t: "v3", k: ["#169B62", "#FFFFFF", "#FF883E"] },
  { c: "KE", n: "Kenya",        t: "h3", k: ["#000000", "#FFFFFF", "#006600"], dot: "#BB0000" },
  { c: "MY", n: "Malaysia",     t: "h3", k: ["#CC0001", "#FFFFFF", "#CC0001"], dot: "#FFCC00" },
];
for (const sk of SKINS) sk.shape = SHAPE_BY_ID[sk.id] || "fish";
for (const sk of SPECIES) sk.shape = SHAPE_BY_ID[sk.id] || "fish";
for (const sk of PREDATORS) sk.shape = SHAPE_BY_ID[sk.id] || "shark";

const flagByCode = (c) => FLAGS.find((f) => f.c === c) || null;
const flagURLs = Object.create(null);
function flagURL(code) {
  if (flagURLs[code]) return flagURLs[code];
  const f = flagByCode(code);
  if (!f) return "";
  const c2 = document.createElement("canvas");
  c2.width = 36; c2.height = 24;
  paintFlag(c2.getContext("2d"), f, 0, 0, 36, 24);
  return (flagURLs[code] = c2.toDataURL());
}

/* paint a flag into any 2d context inside the box x,y,w,h */
function paintFlag(c, f, x, y, w, h) {
  if (!f) return;
  const k = f.k;
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  if (f.t === "h3") { for (let i = 0; i < 3; i++) { c.fillStyle = k[i]; c.fillRect(x, y + (h / 3) * i, w, h / 3 + 1); } }
  else if (f.t === "v3") { for (let i = 0; i < 3; i++) { c.fillStyle = k[i]; c.fillRect(x + (w / 3) * i, y, w / 3 + 1, h); } }
  else if (f.t === "h2") { c.fillStyle = k[0]; c.fillRect(x, y, w, h / 2 + 1); c.fillStyle = k[1]; c.fillRect(x, y + h / 2, w, h / 2); }
  else if (f.t === "v2") { c.fillStyle = k[0]; c.fillRect(x, y, w / 2 + 1, h); c.fillStyle = k[1]; c.fillRect(x + w / 2, y, w / 2, h); }
  else if (f.t === "us") {
    c.fillStyle = k[1]; c.fillRect(x, y, w, h);
    c.fillStyle = k[0];
    for (let i = 0; i < 7; i++) c.fillRect(x, y + (h / 13) * i * 2, w, h / 13);
    c.fillStyle = k[2]; c.fillRect(x, y, w * 0.42, h * 0.54);
  } else if (f.t === "cx") {
    c.fillStyle = k[0]; c.fillRect(x, y, w, h);
    c.strokeStyle = k[1]; c.lineWidth = h * 0.3;
    c.beginPath(); c.moveTo(x, y + h / 2); c.lineTo(x + w, y + h / 2); c.moveTo(x + w / 2, y); c.lineTo(x + w / 2, y + h); c.stroke();
    c.strokeStyle = k[2]; c.lineWidth = h * 0.16;
    c.beginPath(); c.moveTo(x, y + h / 2); c.lineTo(x + w, y + h / 2); c.moveTo(x + w / 2, y); c.lineTo(x + w / 2, y + h); c.stroke();
  } else if (f.t === "nd") {
    c.fillStyle = k[0]; c.fillRect(x, y, w, h);
    c.strokeStyle = k[1]; c.lineWidth = h * 0.22;
    c.beginPath(); c.moveTo(x, y + h / 2); c.lineTo(x + w, y + h / 2); c.moveTo(x + w * 0.36, y); c.lineTo(x + w * 0.36, y + h); c.stroke();
  } else { c.fillStyle = k[0]; c.fillRect(x, y, w, h); }
  if (f.dot) {
    c.fillStyle = f.dot;
    c.beginPath(); c.arc(x + w / 2, y + h / 2, h * 0.24, 0, TAU); c.fill();
    if (f.dot2) { c.fillStyle = f.dot2; c.beginPath(); c.arc(x + w / 2, y + h / 2, h * 0.12, 0, TAU); c.fill(); }
  }
  c.restore();
  c.strokeStyle = "rgba(0,0,0,0.35)";
  c.lineWidth = Math.max(0.7, h * 0.05);
  c.strokeRect(x, y, w, h);
}

const Wallet = {
  pearls: 0, gems: 0, vipUntil: 0, lastGem: 0, lastTend: 0, firstHaul: 0, owned: { clown: 1 }, skin: "clown", flag: "", team: -1,
  load() {
    try {
      const raw = JSON.parse(localStorage.getItem("rr_wallet") || "{}");
      this.pearls = Number(raw.pearls) || 0;
      this.gems = Number(raw.gems) || 0;
      this.vipUntil = Number(raw.vipUntil) || 0;
      this.lastGem = Number(raw.lastGem) || 0;
      this.owned = Object.assign({ clown: 1 }, raw.owned || {});
      this.skin = SKINS.some((s) => s.id === raw.skin) && this.owned[raw.skin] ? raw.skin : "clown";
      this.flag = typeof raw.flag === "string" ? raw.flag : "";
      this.team = Number.isInteger(raw.team) ? raw.team : -1;
    } catch (e) {}
  },
  save() {
    try {
      localStorage.setItem("rr_wallet", JSON.stringify({ pearls: this.pearls, gems: this.gems, vipUntil: this.vipUntil, lastGem: this.lastGem, owned: this.owned, skin: this.skin, flag: this.flag, team: this.team }));
    } catch (e) {}
  },
  skinDef() { return SKINS.find((s) => s.id === this.skin) || SKINS[0]; },
};
Wallet.load();

/* ---- wormholes ------------------------------------------------------- */
function buildHoles() {
  holes = [];
  const pairs = Math.max(4, Math.round(7 * clamp((WORLD.w * WORLD.h) / (16800 * 6200), 0.5, 2)));
  for (let i = 0; i < pairs; i++) {
    const a = { x: rnd(WORLD.w * 0.08, WORLD.w * 0.92), y: rnd(WORLD.h * 0.16, WORLD.h * 0.86), r: 92, hue: 175 + i * 34, spin: rnd(0.6, 1.4) * (i % 2 ? 1 : -1) };
    let b;
    let tries = 0;
    do {
      b = { x: rnd(WORLD.w * 0.08, WORLD.w * 0.92), y: rnd(WORLD.h * 0.16, WORLD.h * 0.86), r: 92, hue: a.hue, spin: -a.spin };
    } while (Math.hypot(b.x - a.x, b.y - a.y) < WORLD.w * 0.3 && tries++ < 40);
    a.pair = b; b.pair = a;
    holes.push(a, b);
  }
}

function stepHoles(dt) {
  for (let i = 0; i < fishes.length; i++) {
    const f = fishes[i];
    if (f.warp > 0) { f.warp -= dt; continue; }
    if (f.kind === "ghost") continue;
    for (let h = 0; h < holes.length; h++) {
      const o = holes[h];
      const d = Math.hypot(f.x - o.x, f.y - o.y);
      if (d > o.r * 0.55) continue;
      const isP = f === player;
      spark(f.x, f.y, o.r * 0.5, `hsla(${o.hue},95%,72%,1)`);
      f.x = o.pair.x + rnd(-30, 30);
      f.y = o.pair.y + rnd(-30, 30);
      f.warp = 2.2;
      layoutSpine(f);
      spark(f.x, f.y, o.r * 0.5, `hsla(${o.hue},95%,72%,1)`);
      bubble(f.x, f.y, f.r * 0.8, 10, 0, 0);
      if (isP) {
        cam.x = f.x; cam.y = f.y;
        cam.shake = Math.min(1, cam.shake + 0.5);
        Snd.warp();
        floatText(f.x, f.y - f.r * 1.6, "WARP", "#9ff4ff");
      }
      break;
    }
  }
}

function drawHoles() {
  for (let i = 0; i < holes.length; i++) {
    const o = holes[i];
    if (o.x + o.r * 2 < viewL || o.x - o.r * 2 > viewR || o.y + o.r * 2 < viewT || o.y - o.r * 2 > viewB) continue;
    const t = T * o.spin;
    const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r * 1.5);
    g.addColorStop(0, `hsla(${o.hue},100%,88%,0.95)`);
    g.addColorStop(0.22, `hsla(${o.hue},96%,60%,0.5)`);
    g.addColorStop(0.6, `hsla(${o.hue},90%,45%,0.16)`);
    g.addColorStop(1, `hsla(${o.hue},90%,40%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 1.5, 0, TAU); ctx.fill();

    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(t);
    ctx.lineCap = "round";
    const arms = cam.z < 0.45 ? 3 : 5;
    for (let a = 0; a < arms; a++) {
      ctx.strokeStyle = `hsla(${o.hue + a * 8},100%,${70 - a * 5}%,${0.5 - a * 0.07})`;
      ctx.lineWidth = 7 - a;
      ctx.beginPath();
      const segs = cam.z < 0.45 ? 14 : 26;
      for (let k = 0; k <= segs; k++) {
        const th = (k / segs) * 3.4 + (a * TAU) / arms;
        const rr = o.r * (0.12 + (k / segs) * 0.95);
        const px = Math.cos(th) * rr, py = Math.sin(th) * rr * 0.82;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(6,20,32,0.85)";
    ctx.beginPath(); ctx.ellipse(0, 0, o.r * 0.2, o.r * 0.17, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

/* ---- spitting -------------------------------------------------------- */
function spit(f) {
  if (f.mass < SPIT_MIN_MASS) return false;
  const cost = Math.max(6, f.mass * SPIT_COST);
  f.mass -= cost;
  f.r = radiusOf(f.mass);
  f.munch = 1;
  const sp = speedOf(f) * 2.4 + 240;
  const nx = Math.cos(f.a), ny = Math.sin(f.a);
  globs.push({
    x: f.x + nx * f.r * 0.9, y: f.y + ny * f.r * 0.9,
    vx: nx * sp + f.sp * nx * 0.4, vy: ny * sp + f.sp * ny * 0.4,
    mass: cost, r: radiusOf(cost) * 0.55, owner: f, life: 1.25,
    col: f.skin.back, hue: 0,
  });
  bubble(f.x + nx * f.r, f.y + ny * f.r, f.r * 0.2, 3, -nx * 60, -ny * 60);
  if (f === player) {
    const gl = globs[globs.length - 1];
    sendEvent({ k: "G", i: pid, x: Math.round(gl.x), y: Math.round(gl.y), vx: Math.round(gl.vx), vy: Math.round(gl.vy), m: Math.round(gl.mass) });
  }
  return true;
}

function stepGlobs(dt) {
  for (let i = globs.length - 1; i >= 0; i--) {
    const g = globs[i];
    g.life -= dt;
    g.x += g.vx * dt; g.y += g.vy * dt;
    g.vx *= 1 - 1.4 * dt; g.vy *= 1 - 1.4 * dt;
    if (Math.random() < dt * 26) bubble(g.x, g.y, g.r, 1, 0, 0);
    if (g.life <= 0) { globs.splice(i, 1); continue; }

    /* The sea king takes spit wherever he is, with or without a shoal in
       the way. This test used to sit inside the fish loop below, so in an
       empty stretch of court a glob sailed straight through him. */
    if (BOSS.on && !BOSS.dead && g.owner === player &&
        Math.hypot(BOSS.x - g.x, BOSS.y - g.y) < 460) {
      const bd = bossDamageFrom(G.score, SPIT_BOSS_DMG * g.mass);
      hurtBoss(bd);
      if (bd > 0) floatText(g.x, g.y - 20, "-" + Math.round(bd), "#ffd98a");
      spark(g.x, g.y, 40, "rgba(255,220,150,1)");
      globs.splice(i, 1);
      continue;
    }

    for (let j = 0; j < fishes.length; j++) {
      const f = fishes[j];
      if (f === g.owner || f.dead) continue;
      if (f.kind === "ghost") continue;               /* their client owns their fish */
      if (f === player && (G.grace > 0 || !G.running)) continue;
      const reach = f.r * 0.75 + g.r + 6;
      if (Math.hypot(f.x - g.x, f.y - g.y) > reach) continue;

      if (g.pea) {
        if (f === player) {
          const loss = Math.max(8, Math.round(G.score * 0.012));
          G.score = Math.max(0, G.score - loss);
          floatText(f.x, f.y - f.r, "-" + loss, "#bff7ff");
          cam.shake = Math.min(0.5, cam.shake + 0.18);
          Snd.hit();
        }
        spark(g.x, g.y, 8, "rgba(190,247,255,1)");
        globs.splice(i, 1);
        break;
      }
      const lethal = f.mass <= g.mass * 1.7;
      spark(g.x, g.y, Math.max(10, g.r * 2.4), lethal ? "rgba(255,150,120,1)" : "rgba(190,240,255,1)");
      if (lethal && f === player && g.remote) {
        spark(g.x, g.y, g.r * 2.4, "rgba(255,150,120,1)");
        Snd.hit();
        globs.splice(i, 1);
        sendEvent({ k: "K", by: g.from, sc: Math.round(G.score * 0.35), m: Math.round(player.mass), n: "SPIT KILL" });
        gameOver(g.owner);
        break;
      }
      if (lethal) {
        f.dead = true;
        if (g.owner === player) {
          const gain = Math.round(18 * Math.sqrt(f.mass)) + 6;
          G.score += gain; G.kills++;
          floatText(f.x, f.y - f.r, "+" + gain + " KILL", "#ffb0a0");
          Snd.eat(0.8);
        } else if (f === player) {
          gameOver(g.owner);
        }
      } else {
        const bite = Math.min(f.mass * 0.36, g.mass * 1.15);
        f.mass -= bite;
        f.r = radiusOf(f.mass);
        f.panic = 1;
        f.pop = 1;
        if (g.owner === player) {
          G.score += Math.round(bite);
          floatText(f.x, f.y - f.r, "-" + Math.round(bite), "#ffd9a8");
        }
        if (f === player) cam.shake = Math.min(1, cam.shake + 0.55);
      }
      Snd.hit();
      globs.splice(i, 1);
      break;
    }
  }
  if (fishes.some((f) => f.dead)) fishes = fishes.filter((f) => !f.dead || f === player);
}

function drawGlobs() {
  for (let i = 0; i < globs.length; i++) {
    const g = globs[i];
    const gr = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r * 2.6);
    gr.addColorStop(0, "rgba(255,255,255,0.95)");
    gr.addColorStop(0.35, g.col);
    gr.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(g.x, g.y, g.r * 2.6, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath(); ctx.arc(g.x - g.vx * 0.004, g.y - g.vy * 0.004, g.r * 0.7, 0, TAU); ctx.fill();
  }
}

/* ---- nets ------------------------------------------------------------ */
function throwNet(f) {
  if (PU.nets <= 0) return false;
  PU.nets--;
  const nx = Math.cos(f.a), ny = Math.sin(f.a);
  netsIn.push({ x: f.x + nx * f.r, y: f.y + ny * f.r, vx: nx * 520, vy: ny * 520, r: f.r * 0.9, life: 1.1, spin: 0 });
  Snd.net();
  return true;
}

function stepNets(dt) {
  for (let i = netsIn.length - 1; i >= 0; i--) {
    const n = netsIn[i];
    n.life -= dt; n.spin += dt * 5;
    n.x += n.vx * dt; n.y += n.vy * dt;
    n.vx *= 1 - 1.1 * dt; n.vy *= 1 - 1.1 * dt;
    if (n.life <= 0) { netsIn.splice(i, 1); continue; }
    for (let j = 0; j < fishes.length; j++) {
      const f = fishes[j];
      if (f === player || f.dead) continue;
      if (Math.hypot(f.x - n.x, f.y - n.y) > f.r + n.r) continue;
      f.netted = 5;
      floatText(f.x, f.y - f.r, "TANGLED", "#ff9ecb");
      netsIn.splice(i, 1);
      break;
    }
  }
}

function drawNets() {
  for (let i = 0; i < netsIn.length; i++) {
    const n = netsIn[i];
    ctx.save();
    ctx.translate(n.x, n.y);
    ctx.rotate(n.spin);
    ctx.strokeStyle = "rgba(255,190,225,0.85)";
    ctx.lineWidth = 2.4;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath(); ctx.moveTo(k * n.r * 0.4, -n.r); ctx.lineTo(k * n.r * 0.4, n.r); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-n.r, k * n.r * 0.4); ctx.lineTo(n.r, k * n.r * 0.4); ctx.stroke();
    }
    ctx.restore();
  }
  for (let i = 0; i < fishes.length; i++) {
    const f = fishes[i];
    if (!f.netted || f.netted <= 0) continue;
    ctx.save();
    ctx.translate(f.x - Math.cos(f.a) * f.r * 0.6, f.y - Math.sin(f.a) * f.r * 0.6);
    ctx.rotate(f.a);
    ctx.strokeStyle = `rgba(255,190,225,${0.4 + Math.sin(T * 12) * 0.15})`;
    ctx.lineWidth = Math.max(1, f.r * 0.05);
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath(); ctx.moveTo(k * f.r * 0.42, -f.r * 0.75); ctx.lineTo(k * f.r * 0.42, f.r * 0.75); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-f.r * 1.05, k * f.r * 0.32); ctx.lineTo(f.r * 1.05, k * f.r * 0.32); ctx.stroke();
    }
    ctx.restore();
  }
}

/* ---- powerup drops --------------------------------------------------- */
/* Plastic drifts where the plankton drifts, and looks nothing like it. */
function spawnJunk(px, py, ring) {
  const a = rnd(0, TAU), d = rnd(ring * 0.25, ring * 1.25);
  junk.push({
    x: clamp(px + Math.cos(a) * d, 60, WORLD.w - 60),
    y: clamp(py + Math.sin(a) * d, 60, swimFloor() - 50),
    ph: rnd(0, TAU), kind: (Math.random() * 3) | 0, spin: rnd(-0.5, 0.5),
  });
}

function stepJunk(dt, ring) {
  for (let i = junk.length - 1; i >= 0; i--) {
    const j = junk[i];
    if (Math.hypot(j.x - player.x, j.y - player.y) > ring * 2.4) { junk.splice(i, 1); continue; }
    if (!G.running || G.dead) continue;
    if (Math.hypot(j.x - player.x, j.y - player.y) > player.r * 0.85 + 26) continue;
    junk.splice(i, 1);
    const loss = Math.max(20, Math.round(G.score * 0.04));
    G.score = Math.max(0, G.score - loss);
    player.mass = Math.max(PLAYER_START_MASS, player.mass * 0.94);
    player.r = radiusOf(player.mass);
    cam.shake = Math.min(1, cam.shake + 0.4);
    floatText(player.x, player.y - player.r, "-" + loss + " PLASTIC", "#c9d6de");
    Snd.hit();
  }
  if (junk.length < 16 && Math.random() < dt * 2.2) spawnJunk(player.x, player.y, ring);
}

function drawJunk() {
  for (let i = 0; i < junk.length; i++) {
    const j = junk[i];
    if (j.x < viewL - 60 || j.x > viewR + 60 || j.y < viewT - 60 || j.y > viewB + 60) continue;
    const wob = Math.sin(T * 0.9 + j.ph) * 6;
    ctx.save();
    ctx.translate(j.x, j.y + wob);
    ctx.rotate(Math.sin(T * 0.4 + j.ph) * 0.4 + j.spin);
    ctx.fillStyle = "rgba(214,228,236,0.5)";
    ctx.strokeStyle = "rgba(160,185,200,0.75)";
    ctx.lineWidth = 2;
    if (j.kind === 0) {
      ctx.beginPath();
      ctx.moveTo(-16, -12); ctx.quadraticCurveTo(0, -22, 16, -12);
      ctx.quadraticCurveTo(20, 8, 0, 18); ctx.quadraticCurveTo(-20, 8, -16, -12);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (j.kind === 1) {
      ctx.beginPath();
      ctx.moveTo(-7, -12); ctx.lineTo(7, -12); ctx.lineTo(7, 16); ctx.lineTo(-7, 16); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(120,160,180,0.7)";
      ctx.fillRect(-4, -18, 8, 6);
    } else {
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
}

function spawnDrop(px, py, ring) {
  const kind = pick(DROP_KINDS);
  const a = rnd(0, TAU), d = rnd(ring * 0.3, ring * 1.3);
  drops.push({
    k: kind.k, col: kind.col, icon: kind.icon, label: kind.label,
    x: clamp(px + Math.cos(a) * d, 80, WORLD.w - 80),
    y: clamp(py + Math.sin(a) * d, 80, swimFloor() - 60),
    ph: rnd(0, TAU),
  });
}

function stepDrops(dt, ring) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    if (Math.hypot(d.x - player.x, d.y - player.y) > ring * 2.4) { drops.splice(i, 1); continue; }
    if (!G.running || G.dead) continue;
    if (Math.hypot(d.x - player.x, d.y - player.y) > Math.min(player.r * 0.9, 95) + 34) continue;
    if (d.k === "shield" && PU.shieldLock > 0) continue;
    drops.splice(i, 1);
    if (d.k === "nets") PU.nets = Math.min(6, PU.nets + 2);
    else PU[d.k] = Math.max(PU[d.k], d.k === "shield" ? 14 : d.k === "boost" ? 9 : 11);
    floatText(player.x, player.y - player.r * 1.4, d.label.toUpperCase(), d.col);
    spark(player.x, player.y, player.r, d.col);
    Snd.pickup();
  }
  if (drops.length < 7 && Math.random() < dt * 0.7) spawnDrop(player.x, player.y, ring);
  PU.boost = Math.max(0, PU.boost - dt);
  PU.shield = Math.max(0, PU.shield - dt);
  PU.magnet = Math.max(0, PU.magnet - dt);
  PU.spitCd = Math.max(0, PU.spitCd - dt);
  PU.shieldLock = Math.max(0, PU.shieldLock - dt);

  if (PU.magnet > 0) {
    for (let i = 0; i < food.length; i++) {
      const q = food[i];
      const dx = player.x - q.x, dy = player.y - q.y;
      const dd = Math.hypot(dx, dy);
      if (dd > 420 || dd < 1) continue;
      const pull = (1 - dd / 420) * 460 * dt;
      q.x += (dx / dd) * pull; q.y += (dy / dd) * pull;
    }
  }
}

function drawDrops() {
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    if (d.x < viewL - 60 || d.x > viewR + 60 || d.y < viewT - 60 || d.y > viewB + 60) continue;
    const bob = Math.sin(T * 2 + d.ph) * 7;
    const y = d.y + bob;
    if (cam.z > 0.4) {
      const g = ctx.createRadialGradient(d.x, y, 0, d.x, y, 46);
      g.addColorStop(0, d.col + "cc");
      g.addColorStop(0.4, d.col + "55");
      g.addColorStop(1, d.col + "00");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(d.x, y, 46, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = d.col;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(d.x, y, 20 + Math.sin(T * 3 + d.ph) * 2, 0, TAU); ctx.stroke();
    ctx.fillStyle = "#04222f";
    ctx.beginPath(); ctx.arc(d.x, y, 16, 0, TAU); ctx.fill();
    ctx.fillStyle = d.col;
    ctx.font = "700 20px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(d.icon, d.x, y + 1);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }
}

/* ---- the reef takes its cut: nobody snowballs forever ----------------- */
function applyDecay(dt) {
  for (let i = 0; i < fishes.length; i++) {
    const f = fishes[i];
    if (f.kind === "ghost" || f.mass <= 900) continue;
    const rate = 0.0045 * Math.pow(f.mass / 900, 0.45);
    f.mass -= f.mass * Math.min(0.06, rate) * dt;
    f.r = radiusOf(f.mass);
  }
}

/* ==========================================================================
   THE SHARED ARENA
   Everyone on a room link swims in one ocean. Presence rides an ephemeral
   "live" channel the room relays without ever persisting it, so 12 Hz costs
   nothing. Each client is authoritative over ITS OWN fish only: you decide
   when you died and tell your killer, which removes every disagreement about
   who ate whom. The plankton and the AI shoal stay local to each player.
   ========================================================================== */

const TEAMS = [
  { id: 0, name: "Coral", col: "#ff6b5c" },
  { id: 1, name: "Kelp",  col: "#57d98a" },
  { id: 2, name: "Tide",  col: "#59b6ff" },
];
const teamCol = (t) => (TEAMS[t] ? TEAMS[t].col : "#cfe6f3");

function autoTeam(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % TEAMS.length;
}

const ghosts = new Map();      /* id -> fish-shaped object for a remote player */
const LIVE_HZ = 12;
let liveAt = 0;
let myTeam = 0;

function sendRaw(str) {
  if (!ws || ws.readyState !== 1) return;
  try { ws.send(str); } catch (e) {}
}

/* the frame must START with {"t":"L" — that prefix is how the room routes it */
function sendLive() {
  if (!player) return;
  const body = {
    i: pid,
    n: G.name || "fish",
    k: Wallet.skin,
    f: Wallet.flag,
    m: myTeam,
    x: Math.round(player.x), y: Math.round(player.y),
    a: Math.round(player.a * 100) / 100,
    r: Math.round(player.r),
    d: G.running && !G.dead ? 0 : 1,
    g: G.grace > 0 ? 1 : 0,
  };
  sendRaw('{"t":"L","d":' + JSON.stringify(body) + "}");
}

function sendEvent(obj) {
  sendRaw('{"t":"L","e":' + JSON.stringify(obj) + "}");
}

function ghostFor(d) {
  let g = ghosts.get(d.i);
  if (!g) {
    const skin = SKINS.find((s) => s.id === d.k) || SKINS[0];
    g = makeFish("ghost", Math.max(1, (d.r / 6) * (d.r / 6)), d.x, d.y, skin);
    g.remoteId = d.i;
    g.tx = d.x; g.ty = d.y; g.ta = d.a;
    ghosts.set(d.i, g);
    fishes.push(g);
  }
  return g;
}

function handleLive(msg) {
  if (msg.e) return handleLiveEvent(msg.e);
  const d = msg.d;
  if (!d || typeof d.i !== "string" || d.i === pid) return;
  if (!Number.isFinite(d.x) || !Number.isFinite(d.y) || !Number.isFinite(d.r)) return;

  const g = ghostFor(d);
  g.seen = T;
  g.pname = String(d.n || "fish").slice(0, 28);
  g.pflag = typeof d.f === "string" ? d.f : "";
  g.team = typeof d.m === "number" ? d.m : 0;
  g.gdead = d.d === 1;
  g.gsafe = d.g === 1;
  const skin = SKINS.find((s) => s.id === d.k);
  if (skin && skin !== g.skin) { g.skin = skin; g.gradR = -1; }
  const nr = clamp(d.r, 4, 4000);
  g.mass = (nr / 6) * (nr / 6);
  g.tx = d.x; g.ty = d.y; g.ta = d.a;
}

function handleLiveEvent(e) {
  if (e.k === "G") {
    /* somebody spat: simulate their glob locally so it can hit us */
    const owner = ghosts.get(e.i) || null;
    globs.push({
      x: e.x, y: e.y, vx: e.vx, vy: e.vy, mass: e.m,
      r: radiusOf(e.m) * 0.55, owner, life: 1.25,
      col: (owner && owner.skin.back) || "#8fd8ff", remote: 1, from: e.i,
    });
  } else if (e.k === "P") {
    BOSS.power = e.p;
    BOSS.seen = T;
    BOSS.host = false;
    if (e.dead && !BOSS.dead) { BOSS.dead = true; banner("the sea king falls", "POSEIDON DEFEATED"); }
  } else if (e.k === "D") {
    if (BOSS.host && !BOSS.dead) {
      BOSS.power = Math.max(0, BOSS.power - (Number(e.d) || 0));
      BOSS.hit = 1;
      if (BOSS.power <= 0) bossFalls();
    }
  } else if (e.k === "B") {
    BALL.tx = e.x; BALL.ty = e.y;
    BALL.vx = e.vx; BALL.vy = e.vy;
    if (e.a !== BALL.s[0] || e.b !== BALL.s[1]) BALL.flash = 1;
    BALL.s[0] = e.a; BALL.s[1] = e.b;
    BALL.seen = T;
    BALL.host = false;
  } else if (e.k === "K" && e.by === pid) {
    /* we ate somebody: they told us so */
    const gain = Math.round(e.sc) + 40;
    G.score += gain;
    G.kills++;
    player.mass = Math.min(PLAYER_MAX_MASS, player.mass + e.m * GROWTH);
    player.r = radiusOf(player.mass);
    player.pop = 1;
    floatText(player.x, player.y - player.r * 1.5, "+" + gain + " " + (e.n || "KILL"), "#ffb0a0");
    Snd.eat(1);
    cam.shake = Math.min(1, cam.shake + 0.6);
  }
}

function stepGhosts(dt) {
  const f = 1 - Math.pow(0.0000004, dt);
  for (const [id, g] of ghosts) {
    if (T - g.seen > 6) {
      ghosts.delete(id);
      const i = fishes.indexOf(g);
      if (i >= 0) fishes.splice(i, 1);
      continue;
    }
    const dx = g.tx - g.x, dy = g.ty - g.y;
    g.sp = Math.hypot(dx, dy) / Math.max(dt, 0.001) * 0.35;
    g.x = lerp(g.x, g.tx, f);
    g.y = lerp(g.y, g.ty, f);
    g.a += angDelta(g.a, g.ta) * f;
    g.r = radiusOf(g.mass);
    g.phase += dt * (5 + g.sp / (g.r * 0.5 + 14));
    const want = Math.cos(g.a) >= 0 ? 1 : -1;
    if (want !== g.side && Math.abs(Math.cos(g.a)) > 0.18) g.side = want;
    layoutFollow(g);
  }
}

/* players eat players — but only the victim ever says so */
function collidePlayers() {
  if (!G.running || G.dead || G.grace > 0) return;
  for (const [id, g] of ghosts) {
    if (g.gdead || g.gsafe) continue;
    if (g.team === myTeam) continue;                 /* no friendly fire */
    if (g.r < player.r * EAT_RATIO) continue;        /* they are not big enough */
    const reach = g.r * 0.5 + player.r * 1.15;
    if (Math.hypot(g.x - player.x, g.y - player.y) > reach) continue;
    reportDeath(g, id);
    return;
  }
}

function reportDeath(killer, killerId) {
  sendEvent({ k: "K", by: killerId, sc: Math.round(G.score * 0.35), m: Math.round(player.mass), n: "KILL" });
  gameOver(killer);
}

function drawGhostTags() {
  for (const [, g] of ghosts) {
    if (g.gdead) continue;
    if (g.x < viewL - 200 || g.x > viewR + 200 || g.y < viewT - 200 || g.y > viewB + 200) continue;
    const y = g.y - g.r * 1.15;
    const size = Math.max(12, Math.min(30, g.r * 0.4));
    if (g.pflag) {
      const fw = size * 1.5, fh = fw * 0.66;
      paintFlag(ctx, flagByCode(g.pflag), g.x - fw / 2, y - fh - size * 0.9, fw, fh);
    }
    ctx.font = `700 ${Math.round(size)}px "Avenir Next", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = size * 0.28;
    ctx.strokeStyle = "rgba(2,18,28,0.65)";
    ctx.strokeText(g.pname, g.x, y);
    ctx.fillStyle = teamCol(g.team);
    ctx.fillText(g.pname, g.x, y);
    ctx.textAlign = "left";
  }
}


/* ==========================================================================
   THE ARENA
   A match is five minutes of wall clock — the same five minutes for everyone,
   because match_id is just floor(now / 5min). Nothing has to be started by a
   server and no lobby has to agree on when to begin; every client works it out
   from its own clock and arrives together. Four and a half minutes of play,
   thirty seconds to read the result and breathe.
   ========================================================================== */

const MATCH_MS = 5 * 60 * 1000;
const PLAY_MS = 4.5 * 60 * 1000;

const ARENA = { on: false, entered: false, matchId: -1, live: false, left: 0, joined: false, submitted: false, respawnAt: 0 };

function arenaClock() {
  const now = Date.now();
  const into = now % MATCH_MS;
  return {
    matchId: Math.floor(now / MATCH_MS),
    live: into < PLAY_MS,
    left: Math.ceil((into < PLAY_MS ? PLAY_MS - into : MATCH_MS - into) / 1000),
  };
}

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.max(0, sec % 60)).padStart(2, "0")}`;

function startArenaRound() {
  newRun(true);
  resetSafeWater();
  BALL.s[0] = 0; BALL.s[1] = 0; BALL.seen = -99; BALL.host = false;
  resetBall();
  G.running = true;
  G.startedAt = T;
  clearPredatorsNear(player.x, player.y, player.r, ringSize() * 1.5);
  ARENA.joined = true;
  if (SK_ON()) skReset();
  ARENA.submitted = false;
  ARENA.respawnAt = 0;
  ARENA.lives = 0;
  UI.start.classList.add("hide");
  UI.over.classList.add("hide");
  UI.hud.classList.add("on");
  banner("the whistle goes", "SWIM");
  Snd.grow();
}

function arenaRespawn() {
  player.dead = false;
  player.mass = SK_ON() ? SK_MASS : PLAYER_START_MASS;
  player.r = radiusOf(player.mass);
  if (SK_ON() && RING0.r > 0) {
    /* Back inside the safe water, never outside it. Arena deaths come through
       here, and this was dropping you anywhere in the world - including into
       the closing tide, which starts killing you the moment you arrive. */
    const a = rnd(0, TAU), d = RING0.r * Math.sqrt(rnd(0.05, 0.62));
    player.x = clamp(RING0.x + Math.cos(a) * d, 160, WORLD.w - 160);
    player.y = clamp(RING0.y + Math.sin(a) * d, 160, swimFloor() - 160);
  } else {
    player.x = rnd(WORLD.w * 0.15, WORLD.w * 0.85);
    player.y = rnd(WORLD.h * 0.25, WORLD.h * 0.8);
  }
  layoutSpine(player);
  if (fishes.indexOf(player) < 0) fishes.push(player);
  G.dead = false;
  G.running = true;
  G.grace = SHIELD_TIME;
  G.startedAt = T;
  cam.x = player.x; cam.y = player.y;
  clearPredatorsNear(player.x, player.y, player.r, ringSize() * 1.5);
  UI.over.classList.add("hide");
  UI.hud.classList.add("on");
  floatText(player.x, player.y - 60, "BACK IN", "#b6ffd8");
}

function endArenaRound() {
  ARENA.joined = false;
  G.running = false;
  const size = ballGame() ? BALL.s[mySide()] : Math.round(G.dead ? 0 : player.mass);

  if (!ARENA.submitted) {
    ARENA.submitted = true;
    try {
      fetch(`${API_BASE}/api/arena`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pid, name: G.rawName || G.name, flag: Wallet.flag,
          matchId: ARENA.matchId, room, game: GAME, size, kills: G.kills,
        }),
        keepalive: true,
      }).catch(() => {});
    } catch (e) {}
  }

  /* placement among everyone actually in this arena, bots excluded */
  const humans = [{ size, you: true }];
  for (const [, g] of ghosts) humans.push({ size: Math.round(g.mass), you: false });
  humans.sort((a, b) => b.size - a.size);
  const place = humans.findIndex((h) => h.you) + 1;

  G.earned = 0;
  G.gemsEarned = 0;
  UI.fscore.textContent = size.toLocaleString();
  UI.fkills.textContent = String(G.kills);
  UI.fbest.textContent = String(place);
  UI.fsize.textContent = stageFor(radiusOf(Math.max(1, size)));
  UI.fpearls.textContent = "0";
  UI.fgems.textContent = "";
  UI.deathline.textContent = ballGame()
    ? `Full time — ${TEAMS[0].name} ${BALL.s[0]} · ${TEAMS[1].name} ${BALL.s[1]}. You played for ${TEAMS[mySide()].name}.`
    : G.dead
      ? "You didn't make it to the whistle."
      : `Final size ${size.toLocaleString()} — ${place} of ${humans.length} in this arena.`;
  document.querySelector("#over .dead").textContent = "MATCH OVER";
  UI.cont.style.display = "none";
  UI.over.classList.remove("hide");
  UI.hud.classList.remove("on");
  Snd.die();
}

/* The shrinking safe water. Nothing about it is subtle — it is a wall of dark
   water that eats you slowly, and it exists to stop anyone farming a corner. */
const RING0 = { x: 0, y: 0, r: 0, tr: 0 };

function resetSafeWater() {
  RING0.x = WORLD.w / 2;
  RING0.y = WORLD.h / 2;
  RING0.r = Math.max(WORLD.w, WORLD.h) * 0.62;
  RING0.tr = RING0.r;
}

/* The beach comes up to meet everyone. No damage rule is needed: the water
   simply runs out, and a fish that will not fight ends up shoulder to
   shoulder with one that will. */
/* Closing Waves: the same safe circle as Last Fish Out, but gentler and
   forgiving — it closes slower, it drains you instead of ending you, and you
   can always swim back in. */
function stepTide() {}

function drawTide() {
  if (!ARENA.on || GAME !== "tidepool" || !ARENA.live) return;
  /* three rings of surf rolling inward ahead of the boundary */
  for (let k = 0; k < 3; k++) {
    const rr = RING0.r + 150 + k * 320 - ((T * 90 + k * 110) % 430);
    if (rr < RING0.r) continue;
    ctx.strokeStyle = `rgba(180,240,255,${0.24 - k * 0.06})`;
    ctx.lineWidth = Math.max(3, 14 / cam.z);
    ctx.beginPath();
    ctx.arc(RING0.x, RING0.y, rr, 0, TAU);
    ctx.stroke();
  }
  return;
  const y = swimFloor();
  const g = ctx.createLinearGradient(0, y - 60, 0, y + 400);
  g.addColorStop(0, "rgba(255,236,190,0)");
  g.addColorStop(0.18, "rgba(238,214,166,0.92)");
  g.addColorStop(1, "rgba(206,178,132,0.98)");
  ctx.fillStyle = g;
  ctx.fillRect(viewL - 100, y - 40, viewR - viewL + 200, viewB - y + 500);
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = Math.max(2, 6 / cam.z);
  ctx.beginPath();
  const step = 90;
  for (let x = Math.floor(viewL / step) * step; x < viewR + step; x += step) {
    ctx.lineTo(x, y - 20 + Math.sin(x * 0.004 + T * 1.6) * 16 + Math.sin(x * 0.011 + T * 2.4) * 7);
  }
  ctx.stroke();
}

function stepSafeWater(dt) {
  const circling = ARENA.on && (GAME === "lastfish" || GAME === "tidepool" || GAME === "deepstrike");
  if (!circling || !ARENA.live) return;
  let into = 1 - ARENA.left / (PLAY_MS / 1000);
  /* the circle holds wide open through the muster, then starts closing */
  if (SK_ON()) {
    const el2 = PLAY_MS / 1000 - ARENA.left;
    into = el2 < SK_MUSTER ? 0 : clamp((el2 - SK_MUSTER) / (PLAY_MS / 1000 - SK_MUSTER), 0, 1);
  }
  /* Deep Strike wants a circle you can SEE from the first minute. At 0.62 of
     a 9,600-wide arena the ring was 5,952 across - wider than the water, so it
     never showed and never appeared to close. */
  /* Big enough to hold the entire arena at the whistle - half the diagonal
     plus a margin - so nobody starts outside it. It opened at 3,400 in water
     17,600 across, which put most of the hundred in the red before a shot was
     fired: harmless while the tide only hurt the player, fatal now that it
     kills everything. */
  const wide = SK_ON()
    ? Math.hypot(WORLD.w, WORLD.h) / 2 + 400
    : Math.max(WORLD.w, WORLD.h) * 0.62;
  /* Closing Waves keeps a bigger pocket and closes more slowly */
  const end = GAME === "tidepool" ? 1600 : SK_ON() ? 620 : 700;
  const pace = GAME === "tidepool" ? clamp(into * 0.82, 0, 1) : clamp(into, 0, 1);
  RING0.r = lerp(wide, end, pace);
  if (!G.running || G.dead) return;
  const d = Math.hypot(player.x - RING0.x, player.y - RING0.y);
  if (d < RING0.r) return;
  if (SK_ON()) {
    /* out here it is the water that kills you, not a fish */
    SK.hp -= 17 * dt;
    cam.shake = Math.min(0.6, cam.shake + dt);
    if (SK.hp <= 0) skDown();
    return;
  }
  /* outside: bleeding mass, and a nudge back toward the light */
  player.mass = Math.max(1, player.mass * (1 - 1.1 * dt));
  player.r = radiusOf(player.mass);
  G.score = Math.max(0, G.score - Math.round(60 * dt));
  cam.shake = Math.min(0.6, cam.shake + dt);
  if (GAME === "tidepool") return;                 /* waves drain, they do not kill outright */
  if (player.mass <= PLAYER_START_MASS * 0.5) gameOver(null);
}

function drawSafeWater() {
  if (!ARENA.on || (GAME !== "lastfish" && GAME !== "tidepool" && GAME !== "deepstrike") || !ARENA.live) return;
  ctx.save();
  ctx.fillStyle = "rgba(80,0,20,0.32)";
  ctx.beginPath();
  ctx.rect(viewL - 200, viewT - 200, (viewR - viewL) + 400, (viewB - viewT) + 400);
  ctx.arc(RING0.x, RING0.y, RING0.r, 0, TAU, true);
  ctx.fill("evenodd");
  ctx.strokeStyle = `rgba(255,120,110,${0.5 + Math.sin(T * 3) * 0.2})`;
  ctx.lineWidth = Math.max(4, 10 / cam.z);
  ctx.beginPath();
  ctx.arc(RING0.x, RING0.y, RING0.r, 0, TAU);
  ctx.stroke();
  ctx.restore();
}


/* ==========================================================================
   DEEP STRIKE — the shooting arena
   ==========================================================================
   A hundred fish in one body of water and nothing to eat. Nobody grows here
   and nobody shrinks; every fish is the same size and the only thing that
   separates two of them is aim. Health means one hit never ends anyone, so
   this is a fight rather than an ambush. Nets are the counterweight to raw
   shooting: a tangled fish is held and shocked, and the only way out is to
   burn boost before the current drains you. Last one swimming wins.
   ========================================================================== */

const SK_ON = () => ARENA.on && GAME === "deepstrike";
const SK_MAX_HP = 100;
const SK_FIELD = 100;
const SK_SHOCK_DPS = 24;
const SK_NET_BREAK = 0.9;
const SK_RESPAWNS = 2;
const SK_RESPAWN_GEMS = 1;
/* Every match opens with a muster. The room fills where you can watch it,
   nobody can shoot, and a countdown runs. It reads the same wall clock every
   client already shares, so all of them start on the same second with no
   lobby server to coordinate. */
const SK_MUSTER = 25;

const SK_GUNS = {
  spine:   { name: "Spine",   dmg: 11, cd: 0.26, n: 1, spread: 0,    col: "#bff4ff", sp: 1150, blast: 0,   life: 0.85 },
  scatter: { name: "Scatter", dmg: 7,  cd: 0.42, n: 4, spread: 0.30, col: "#ffd98a", sp: 1000, blast: 0,   life: 0.55 },
  lance:   { name: "Lance",   dmg: 26, cd: 0.62, n: 1, spread: 0,    col: "#ff9ecb", sp: 1500, blast: 0,   life: 1.10 },
  /* the heavy end: slower, but they do not have to touch you to hurt */
  rocket:  { name: "Rocket",  dmg: 30, cd: 1.10, n: 1, spread: 0,    col: "#ff8a5c", sp: 760,  blast: 210, life: 1.60, trail: 1 },
  bomb:    { name: "Bomb",    dmg: 42, cd: 1.35, n: 1, spread: 0,    col: "#ffe08a", sp: 520,  blast: 300, life: 1.25, lob: 1 },
  fire:    { name: "Fire",    dmg: 5,  cd: 0.07, n: 1, spread: 0.16, col: "#ff7a3c", sp: 620,  blast: 0,   life: 0.28 },
};
const SK_LOOT = ["scatter", "lance", "rocket", "bomb", "fire"];

const SK = {
  hp: SK_MAX_HP, kills: 0, cd: 0, gun: "spine", gunT: 0,
  respawns: SK_RESPAWNS, out: false, downT: 0, won: false,
  muster: SK_MUSTER, lastCount: 0, joined: 0,
  bullets: [], drops: [], dropT: 3, shockT: 0, breakT: 0,
  heat: 0, left: SK_FIELD,
};

function skArm(f) {
  if (f.hp === undefined) { f.hp = SK_MAX_HP; f.maxHp = SK_MAX_HP; f.kills = f.kills || 0; }
}
function skReset() {
  SK.hp = SK_MAX_HP; SK.kills = 0; SK.cd = 0; SK.gun = "spine"; SK.gunT = 0;
  SK.respawns = SK_RESPAWNS; SK.out = false; SK.downT = 0; SK.won = false;
  SK.muster = SK_MUSTER; SK.lastCount = 0; SK.joined = 0;
  SK.bullets.length = 0; SK.drops.length = 0; SK.dropT = 2; SK.shockT = 0; SK.breakT = 0;
  SK.heat = 0; SK.left = SK_FIELD;
}
function skStanding() {
  let n = SK.out ? 0 : 1;
  for (const f of fishes) if (f !== player && f.kind !== "ghost" && !f.dead) n++;
  return n;
}
function skFire(f, ang) {
  const g = SK_GUNS[f === player ? SK.gun : "spine"];
  for (let i = 0; i < g.n; i++) {
    const a = ang + (g.n > 1 ? (i - (g.n - 1) / 2) * g.spread : rnd(-g.spread, g.spread));
    SK.bullets.push({
      x: f.x + Math.cos(a) * f.r * 0.9, y: f.y + Math.sin(a) * f.r * 0.9,
      vx: Math.cos(a) * g.sp, vy: Math.sin(a) * g.sp,
      life: g.life, dmg: g.dmg, col: g.col, mine: f === player, owner: f,
      blast: g.blast || 0, lob: g.lob || 0, trail: g.trail || 0,
    });
  }
  bubble(f.x + Math.cos(ang) * f.r, f.y + Math.sin(ang) * f.r, f.r * 0.16, 2, 0, 0);
  if (f === player) Snd.spit();
}
/** One place where damage lands, so nothing can bleed out twice. */
function skHurt(f, dmg, byPlayer) {
  if (f.dead) return;
  skArm(f);
  f.hp -= dmg; f.hurt = 0.35;
  if (f.hp > 0) return;
  f.dead = true; f.hp = 0;
  spark(f.x, f.y, f.r * 1.3, "rgba(255,150,120,1)");
  bubble(f.x, f.y, f.r, 14, 0, 0);
  if (byPlayer) {
    SK.kills++; G.kills = SK.kills; G.score += 100;
    floatText(f.x, f.y - f.r, "+1", "#ff9b8c"); Snd.eat();
  }
}
function skDown() {
  if (SK.out || SK.downT > 0) return;
  SK.downT = 3.2;
  spark(player.x, player.y, player.r * 1.5, "rgba(255,150,120,1)");
  cam.shake = 1; Snd.die();
  if (SK.respawns > 0 && Wallet.gems >= SK_RESPAWN_GEMS) {
    SK.respawns--; Wallet.gems -= SK_RESPAWN_GEMS; Wallet.save();
    banner(`${SK.respawns} left · ${SK_RESPAWN_GEMS} gem`, "BACK IN THE WATER");
  } else {
    SK.out = true;
    banner(SK.respawns > 0 ? "no gems left to spend" : "no respawns left", "YOU ARE OUT");
  }
}
function skRespawn() {
  SK.hp = SK_MAX_HP; SK.gun = "spine"; SK.gunT = 0;
  const a = rnd(0, TAU), d = rnd(400, Math.max(500, RING0.r * 0.7));
  player.x = clamp(RING0.x + Math.cos(a) * d, 120, WORLD.w - 120);
  player.y = clamp(RING0.y + Math.sin(a) * d, 120, swimFloor() - 120);
  player.netted = 0; G.grace = 2.5;
}
const SK_DROPS = { heart: { col: "#ff6f8b" }, ammo: { col: "#9ee7ff" }, gun: { col: "#ffd98a" } };
function skSpawnDrop() {
  /* The water gets meaner as the field thins: with a handful left there is
     almost nothing to pick up and no way to heal out of a bad fight. */
  const plenty = clamp((skStanding() - 8) / (SK_FIELD - 8), 0.12, 1);
  const roll = Math.random();
  const kind = roll < 0.45 ? "heart" : roll < 0.7 ? "ammo" : "gun";
  const a = rnd(0, TAU), d = rnd(0, RING0.r * 0.86);
  SK.drops.push({
    kind, x: clamp(RING0.x + Math.cos(a) * d, 140, WORLD.w - 140),
    y: clamp(RING0.y + Math.sin(a) * d, 140, swimFloor() - 140),
    ph: rnd(0, TAU), life: 26, gun: SK_LOOT[(Math.random() * SK_LOOT.length) | 0],
  });
  SK.dropT = lerp(6.5, 1.6, plenty);
}
function skTakeDrop(d, i) {
  if (d.kind === "heart") { SK.hp = Math.min(SK_MAX_HP, SK.hp + 30); floatText(player.x, player.y - player.r, "+30 LIFE", "#ff6f8b"); }
  else if (d.kind === "ammo") { PU.nets += 2; floatText(player.x, player.y - player.r, "+2 NETS", "#9ee7ff"); }
  else { SK.gun = d.gun; SK.gunT = 15; floatText(player.x, player.y - player.r, SK_GUNS[d.gun].name.toUpperCase() + " 15s", "#ffd98a"); }
  SK.drops.splice(i, 1); Snd.pickup();
}

function stepStrike(dt) {
  if (!SK_ON()) return;
  if (!ARENA.live) { if (SK.bullets.length) SK.bullets.length = 0; return; }
  skArm(player);
  if (SK.gunT > 0 && (SK.gunT -= dt) <= 0) { SK.gun = "spine"; banner("back to the spine", "borrowed time is up"); }
  SK.cd = Math.max(0, SK.cd - dt);
  if (SK.downT > 0) { SK.downT -= dt; if (SK.downT <= 0 && !SK.out) skRespawn(); }

  /* seconds since this match began, from the shared clock */
  const elapsed = PLAY_MS / 1000 - ARENA.left;
  SK.muster = Math.max(0, Math.ceil(SK_MUSTER - elapsed));
  const mustering = SK.muster > 0;
  if (mustering) {
    /* They arrive in waves rather than at a machine-steady tick, each with a
       puff of bubbles, so it reads like people joining rather than a number. */
    const inFor = clamp(1 - SK.muster / SK_MUSTER, 0, 1);
    const surge = 0.5 + 0.5 * Math.sin(inFor * 11);
    const want = Math.round(lerp(9, SK_FIELD, Math.pow(inFor, 0.72)));
    if (fishes.length < Math.min(want, SK_FIELD) && Math.random() < dt * (14 + surge * 26)) {
      const a = rnd(0, TAU), d = RING0.r * Math.sqrt(rnd(0.05, 0.92));
      spawnFish(RING0.x + Math.cos(a) * d, RING0.y + Math.sin(a) * d, 60, SK_MASS);
      const nf = fishes[fishes.length - 1];
      if (nf) {
        nf.x = clamp(RING0.x + Math.cos(a) * d, 200, WORLD.w - 200);
        nf.y = clamp(RING0.y + Math.sin(a) * d, 200, swimFloor() - 200);
        layoutSpine(nf);
        bubble(nf.x, nf.y, nf.r * 0.8, 6, 0, 0);
      }
    }
    SK.bullets.length = 0;
    SK.hp = SK_MAX_HP;
    SK.joined = Math.min(SK_FIELD, fishes.length);
    if (SK.muster !== SK.lastCount) {
      SK.lastCount = SK.muster;
      if (SK.muster <= 5) banner(`${SK.joined} of ${SK_FIELD} in the water`, String(SK.muster));
      else if (SK.muster === SK_MUSTER - 1) banner("hold fire · the room is still filling", "GATHERING");
    }
  } else if (SK.lastCount !== -1) {
    SK.lastCount = -1;
    SK.joined = Math.min(SK_FIELD, fishes.length);
    banner(`${SK.joined} fish · last one swimming wins`, "GO");
    Snd.grow();
  }

  const playing = G.running && !SK.out && SK.downT <= 0 && !mustering;
  SK.heat = 0;
  for (const f of fishes) if (f.onYou > 0) { f.onYou -= dt; if (f.onYou > 0) SK.heat++; }

  if (playing && IN.spit && SK.cd <= 0) { SK.cd = SK_GUNS[SK.gun].cd; skFire(player, player.a); }

  if (playing && player.netted > 0) {
    SK.shockT += dt; SK.hp -= SK_SHOCK_DPS * dt;
    cam.shake = Math.min(0.5, cam.shake + dt * 0.8);
    if (IN.dash && G.stam > 0.02) {
      SK.breakT += dt;
      if (SK.breakT >= SK_NET_BREAK) { player.netted = 0; SK.breakT = 0; floatText(player.x, player.y - player.r, "FREE", "#9effc9"); }
    } else SK.breakT = Math.max(0, SK.breakT - dt * 0.6);
    if (SK.hp <= 0) skDown();
  } else { SK.shockT = 0; SK.breakT = 0; }

  for (const f of fishes) {
    if (f === player || f.kind === "ghost" || f.dead) continue;
    skArm(f);
    f.hurt = Math.max(0, (f.hurt || 0) - dt * 2);
    /* the closing water kills everything, not just you */
    if (RING0.r > 0) {
      const dr = Math.hypot(f.x - RING0.x, f.y - RING0.y);
      if (dr > RING0.r) {
        skHurt(f, 17 * dt, false);
        if (f.dead) continue;
        /* and it drives them back in, rather than drowning them stupidly */
        f.ta = Math.atan2(RING0.y - f.y, RING0.x - f.x);
      }
    }
    if (f.netted > 0) { skHurt(f, SK_SHOCK_DPS * dt, false); continue; }
    if (mustering) continue;
    f.skCd = (f.skCd === undefined ? rnd(0.8, 4.0) : f.skCd) - dt;
    if (f.skCd > 0) continue;
    f.skCd = rnd(3.4, 9.0);
    /* Most of them are busy with each other. Without this cap all ninety-nine
       picked the nearest target — always you — and you died in six seconds. */
    let tx = 0, ty = 0, td = 1e9;
    for (let k = 0; k < 3; k++) {
      const o = fishes[(Math.random() * fishes.length) | 0];
      if (!o || o === f || o.dead || o.kind === "ghost") continue;
      const d2 = Math.hypot(o.x - f.x, o.y - f.y);
      if (d2 < td) { td = d2; tx = o.x; ty = o.y; }
    }
    const pd = playing ? Math.hypot(player.x - f.x, player.y - f.y) : 1e9;
    if (pd < 700 && SK.heat < 3 && Math.random() < 0.16) { SK.heat++; f.onYou = 1.6; td = pd; tx = player.x; ty = player.y; }
    /* Measured over a real match: flat at 97 for forty-five seconds, then
       97 -> 44 in the next sixty. The cause was the bigger arena - at 1,150
       units of range, in water where the median gap between fish is 4,600,
       almost nobody could see anybody. Then the circle squeezed them all into
       range at once and it became a massacre. */
    if (td > 2600) continue;
    skFire(f, Math.atan2(ty - f.y, tx - f.x) + rnd(-0.2, 0.2));
  }

  for (let i = SK.bullets.length - 1; i >= 0; i--) {
    const b = SK.bullets[i];
    b.life -= dt;
    if (b.lob) b.vy += 420 * dt;                 /* a bomb is thrown, not fired */
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.trail && Math.random() < dt * 30) bubble(b.x, b.y, 7, 1, 0, 0);
    let gone = false;
    if (b.life <= 0) {
      if (b.blast > 0) gone = true;              /* the fuse counts as a hit */
      else { SK.bullets.splice(i, 1); continue; }
    }
    if (!gone && playing && !b.mine && G.grace <= 0 && Math.hypot(player.x - b.x, player.y - b.y) < player.r) {
      SK.hp -= b.dmg; cam.shake = Math.min(0.5, cam.shake + 0.16);
      floatText(player.x, player.y - player.r, "-" + b.dmg, "#ff8a8a");
      if (SK.hp <= 0) skDown();
      gone = true;
    }
    if (!gone) {
      for (const f of fishes) {
        if (f === player || f.dead || f.kind === "ghost" || f === b.owner) continue;
        if (Math.hypot(f.x - b.x, f.y - b.y) > f.r) continue;
        skHurt(f, b.dmg, b.mine); gone = true; break;
      }
    }
    if (gone) {
      if (b.blast > 0) {
        /* a blast does not care what it was aimed at */
        spark(b.x, b.y, b.blast * 0.5, "rgba(255,190,120,1)");
        bubble(b.x, b.y, b.blast * 0.3, 12, 0, 0);
        cam.shake = Math.min(0.7, cam.shake + 0.3);
        for (const f of fishes) {
          if (f === player || f.dead || f.kind === "ghost") continue;
          const d2 = Math.hypot(f.x - b.x, f.y - b.y);
          if (d2 < b.blast) skHurt(f, b.dmg * (1 - d2 / b.blast), b.mine);
        }
        const pd = Math.hypot(player.x - b.x, player.y - b.y);
        if (playing && G.grace <= 0 && pd < b.blast) {
          SK.hp -= b.dmg * (1 - pd / b.blast) * (b.mine ? 0.35 : 1);   /* your own blast still stings */
          if (SK.hp <= 0) skDown();
        }
      } else spark(b.x, b.y, 22, "rgba(255,220,170,1)");
      SK.bullets.splice(i, 1);
    }
  }

  if ((SK.dropT -= dt) <= 0) skSpawnDrop();
  for (let i = SK.drops.length - 1; i >= 0; i--) {
    const d = SK.drops[i];
    d.ph += dt; d.life -= dt;
    if (d.life <= 0) { SK.drops.splice(i, 1); continue; }
    if (playing && Math.hypot(player.x - d.x, player.y - d.y) < player.r + 90) skTakeDrop(d, i);
  }

  for (let i = fishes.length - 1; i >= 0; i--) {
    const f = fishes[i];
    if (f !== player && f.dead) fishes.splice(i, 1);
  }

  /* Left alone the shoal wiped itself out in about eighty seconds and the rest
     of the match was an empty ocean. The population is steered rather than
     merely drained. Reinforcements stop once the field is genuinely thin, or
     "last one standing" would mean nothing. */
  /* Nobody is replaced once the fight starts. The count only ever falls -
     anything else is not last one standing, it is a treadmill. */
  /* Nothing should ever read a negative health bar. This was fixed once and
     then lost when a later build was taken from the repo without it. */
  SK.hp = clamp(SK.hp, 0, SK_MAX_HP);
  SK.left = skStanding();
  if (!SK.won && !SK.out && SK.left <= 1 && G.running) {
    SK.won = true; G.score += 2000;
    banner("nothing left out there", "LAST ONE STANDING"); Snd.grow();
  }
}

function drawStrike() {
  if (!SK_ON() || !ARENA.live) return;
  for (const d of SK.drops) {
    ctx.save();
    ctx.translate(d.x, d.y + Math.sin(d.ph * 2) * 8);
    ctx.globalAlpha = d.life < 4 ? 0.35 + Math.sin(d.ph * 12) * 0.3 : 1;
    ctx.fillStyle = SK_DROPS[d.kind].col;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 3;
    if (d.kind === "heart") {
      ctx.beginPath(); ctx.moveTo(0, 18);
      ctx.bezierCurveTo(-26, -2, -14, -24, 0, -10);
      ctx.bezierCurveTo(14, -24, 26, -2, 0, 18); ctx.fill();
    } else if (d.kind === "ammo") {
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); ctx.stroke();
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath(); ctx.moveTo(k * 8, -14); ctx.lineTo(k * 8, 14); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-14, k * 8); ctx.lineTo(14, k * 8); ctx.stroke();
      }
    } else {
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k * TAU) / 5;
        k ? ctx.lineTo(Math.cos(a) * 17, Math.sin(a) * 17) : ctx.moveTo(Math.cos(a) * 17, Math.sin(a) * 17);
      }
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  for (const b of SK.bullets) {
    ctx.strokeStyle = b.col;
    ctx.lineWidth = b.blast ? 7 : b.mine ? 4 : 3;
    ctx.beginPath(); ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx * 0.016, b.y - b.vy * 0.016); ctx.stroke();
  }
  /* Every fish wears its health all the time. Flashing a bar up only after a
     hit meant you never knew which of them was nearly finished. */
  for (const f of fishes) {
    if (f.kind === "ghost" || f.dead || f.hp === undefined) continue;
    if (f.r * cam.z < 9) continue;
    const w = Math.max(46, f.r * 1.6), h = 7, y = f.y - f.r - 26;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(f.x - w / 2, y, w, h);
    const frac = f === player ? clamp(SK.hp / SK_MAX_HP, 0, 1) : clamp(f.hp / SK_MAX_HP, 0, 1);
    ctx.fillStyle = frac > 0.5 ? "#8ff0b0" : frac > 0.25 ? "#ffd98a" : "#ff8a8a";
    ctx.fillRect(f.x - w / 2, y, w * frac, h);
  }
  if (player.netted > 0 && SK.breakT > 0) {
    ctx.strokeStyle = "rgba(160,240,255,0.9)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r + 26, -Math.PI / 2, -Math.PI / 2 + TAU * (SK.breakT / SK_NET_BREAK));
    ctx.stroke();
  }
}

function stepArena() {
  if (!ARENA.on) return;
  const c = arenaClock();
  ARENA.left = c.left;
  ARENA.live = c.live;
  const musterLeft = SK_ON() && c.live ? Math.max(0, Math.ceil(SK_MUSTER - (PLAY_MS / 1000 - c.left))) : 0;
  /* the count is what makes a room read as real rather than merely open */
  UI.clock.textContent = musterLeft > 0
    ? `${SK.joined}/${SK_FIELD} JOINING · ${musterLeft}`
    : c.live ? `MATCH ${mmss(c.left)}` : `NEXT MATCH ${mmss(c.left)}`;
  UI.clock.style.color = c.live && c.left <= 30 ? "#ff8a7a" : "";
  /* nothing happens until the player has actually walked into the arena */
  if (!ARENA.entered) return;

  if (c.matchId !== ARENA.matchId) {
    ARENA.matchId = c.matchId;
    ARENA.submitted = false;
  }
  if (c.live && !ARENA.joined) startArenaRound();
  else if (!c.live && ARENA.joined) endArenaRound();

  stepTide();
  stepSafeWater(1 / 60);

  if (ARENA.respawnAt && performance.now() > ARENA.respawnAt) {
    ARENA.respawnAt = 0;
    if (ARENA.live && ARENA.joined) arenaRespawn();
  }

  if (!c.live) {
    const btn = document.querySelector("#over .btn");
    if (btn) btn.textContent = `Next match in ${mmss(c.left)}`;
  }
}


/* ==========================================================================
   THE BALL
   A shared object needs one owner, or every screen tells a different story.
   The lowest player id in the room simulates the ball and broadcasts it; the
   rest interpolate what they are told. If the owner leaves, the next lowest
   id notices the silence and takes over, so the ball never freezes.
   Everyone still owns their own fish — only the ball changes hands.
   ========================================================================== */

const BALL_R = 62;
const BALL = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, host: false, seen: -99, s: [0, 0], sendAt: 0, flash: 0 };

const ballGame = () => ARENA.on && (GAME === "football" || GAME === "volley");
/** Which half you defend. Three reef teams collapse to two sides on a pitch. */
const mySide = () => myTeam % 2;

function amBallHost() {
  /* the owner has simply gone quiet — take it */
  if (T - BALL.seen > 1.5) {
    let best = pid;
    for (const [id, g] of ghosts) if (!g.gdead && id < best) best = id;
    return best === pid;
  }
  return BALL.host;
}

function resetBall(toSide) {
  BALL.x = WORLD.w / 2 + (toSide === 0 ? -400 : toSide === 1 ? 400 : 0);
  BALL.y = swimFloor() * 0.55;
  BALL.vx = 0;
  BALL.vy = 0;
  BALL.flash = 1;
}

function goalMouth() {
  const f = swimFloor();
  return { w: Math.min(560, WORLD.w * 0.1), top: f * 0.3, bot: f * 0.78 };
}

function stepBall(dt) {
  if (!ballGame()) return;
  BALL.flash = Math.max(0, BALL.flash - dt);
  if (!ARENA.live || !G.running) return;

  BALL.host = amBallHost();
  if (!BALL.host) {
    const k = 1 - Math.pow(0.000002, dt);
    BALL.x = lerp(BALL.x, BALL.tx, k);
    BALL.y = lerp(BALL.y, BALL.ty, k);
    return;
  }

  /* ---- the owner's simulation ---- */
  const floor = swimFloor();
  BALL.vx *= 1 - 0.55 * dt;
  BALL.vy *= 1 - 0.55 * dt;
  if (GAME === "volley") BALL.vy -= 150 * dt;          /* buoyant: it wants the surface */
  BALL.x += BALL.vx * dt;
  BALL.y += BALL.vy * dt;

  /* every fish in the water can shove it, weight for weight */
  for (const f of fishes) {
    if (f.kind === "ai") continue;
    const dx = BALL.x - f.x, dy = BALL.y - f.y;
    const d = Math.hypot(dx, dy);
    const reach = f.r * 0.9 + BALL_R;
    if (d > reach || d < 0.001) continue;
    const push = clamp(60 + f.r * 2.2, 80, 900);
    BALL.vx += (dx / d) * push;
    BALL.vy += (dy / d) * push;
    BALL.x = f.x + (dx / d) * reach;
    BALL.y = f.y + (dy / d) * reach;
  }

  const sp = Math.hypot(BALL.vx, BALL.vy);
  if (sp > 1400) { BALL.vx *= 1400 / sp; BALL.vy *= 1400 / sp; }

  BALL.y = clamp(BALL.y, BALL_R, floor - BALL_R);
  if (BALL.y <= BALL_R + 1 && BALL.vy < 0) BALL.vy *= -0.5;

  if (GAME === "volley") {
    /* the net, and the floor that concedes the point */
    const netX = WORLD.w / 2;
    if (Math.abs(BALL.x - netX) < 30 + BALL_R && BALL.y > floor * 0.35) {
      BALL.x = netX + Math.sign(BALL.x - netX || 1) * (30 + BALL_R);
      BALL.vx *= -0.6;
    }
    BALL.x = clamp(BALL.x, BALL_R, WORLD.w - BALL_R);
    if (BALL.y >= floor - BALL_R - 2) {
      const scorer = BALL.x < netX ? 1 : 0;
      BALL.s[scorer]++;
      banner(TEAMS[scorer].name + " score", `${BALL.s[0]} — ${BALL.s[1]}`);
      Snd.grow();
      resetBall(scorer === 0 ? 1 : 0);
    }
  } else {
    const m = goalMouth();
    const inMouth = BALL.y > m.top && BALL.y < m.bot;
    if (BALL.x < m.w && inMouth) {
      BALL.s[1]++;
      banner(TEAMS[1].name + " score", `${BALL.s[0]} — ${BALL.s[1]}`);
      Snd.grow();
      resetBall(0);
    } else if (BALL.x > WORLD.w - m.w && inMouth) {
      BALL.s[0]++;
      banner(TEAMS[0].name + " score", `${BALL.s[0]} — ${BALL.s[1]}`);
      Snd.grow();
      resetBall(1);
    } else {
      BALL.x = clamp(BALL.x, BALL_R, WORLD.w - BALL_R);
      if (BALL.x <= BALL_R + 1 || BALL.x >= WORLD.w - BALL_R - 1) BALL.vx *= -0.6;
    }
  }

  BALL.sendAt += dt;
  if (BALL.sendAt > 1 / 12) {
    BALL.sendAt = 0;
    sendEvent({ k: "B", x: Math.round(BALL.x), y: Math.round(BALL.y),
      vx: Math.round(BALL.vx), vy: Math.round(BALL.vy), a: BALL.s[0], b: BALL.s[1] });
  }
}

function drawPitch() {
  if (!ballGame()) return;
  const floor = swimFloor();
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = Math.max(2, 7 / cam.z);
  /* touchlines */
  ctx.strokeRect(60, 60, WORLD.w - 120, floor - 120);
  /* halfway line and centre circle */
  ctx.beginPath();
  ctx.moveTo(WORLD.w / 2, 60);
  ctx.lineTo(WORLD.w / 2, floor - 60);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(WORLD.w / 2, floor / 2, Math.min(WORLD.w, floor) * 0.16, 0, TAU);
  ctx.stroke();
  if (GAME === "football") {
    const m = goalMouth();
    for (const side of [0, 1]) {
      const x = side === 0 ? 60 : WORLD.w - 60 - m.w * 0.7;
      ctx.strokeRect(x, m.top - 90, m.w * 0.7, m.bot - m.top + 180);
    }
  }
  ctx.restore();
}

function drawBall() {
  if (!ballGame()) return;
  drawPitch();
  const floor = swimFloor();

  if (GAME === "volley") {
    const netX = WORLD.w / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = Math.max(3, 8 / cam.z);
    ctx.beginPath();
    ctx.moveTo(netX, floor);
    ctx.lineTo(netX, floor * 0.3);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, 3 / cam.z);
    for (let y = floor * 0.32; y < floor; y += 90) {
      ctx.beginPath(); ctx.moveTo(netX - 26, y); ctx.lineTo(netX + 26, y); ctx.stroke();
    }
  } else {
    const m = goalMouth();
    for (const side of [0, 1]) {
      const x = side === 0 ? m.w : WORLD.w - m.w;
      ctx.strokeStyle = teamCol(side) + "cc";
      ctx.lineWidth = Math.max(4, 12 / cam.z);
      ctx.beginPath();
      ctx.moveTo(x, m.top);
      ctx.lineTo(x, m.bot);
      ctx.stroke();
      ctx.fillStyle = teamCol(side) + "22";
      ctx.fillRect(side === 0 ? 0 : WORLD.w - m.w, m.top, m.w, m.bot - m.top);
    }
  }

  const pulse = 1 + BALL.flash * 0.5;
  const g = ctx.createRadialGradient(BALL.x, BALL.y, 0, BALL.x, BALL.y, BALL_R * 1.9 * pulse);
  g.addColorStop(0, "rgba(255,255,255,0.98)");
  g.addColorStop(0.4, "rgba(186,244,255,0.9)");
  g.addColorStop(1, "rgba(140,220,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(BALL.x, BALL.y, BALL_R * 1.9 * pulse, 0, TAU); ctx.fill();
  ctx.fillStyle = "rgba(250,253,255,0.95)";
  ctx.beginPath(); ctx.arc(BALL.x, BALL.y, BALL_R, 0, TAU); ctx.fill();
  ctx.strokeStyle = "rgba(120,190,220,0.8)";
  ctx.lineWidth = Math.max(2, 5 / cam.z);
  ctx.stroke();
}


/* ==========================================================================
   THE VIP WATERS
   Mermaids, octopuses, crabs, prawns and seahorses. None of them are in the
   `fishes` array, which is the whole point: nothing can eat them and they can
   eat nothing. They are there to make the water feel inhabited rather than
   stocked, and they only appear in water you had to earn.
   ========================================================================== */

let critters = [];

/* Painted characters. The drawn-by-hand versions stay as the fallback, so a
   slow connection or a missing file degrades to something rather than nothing. */
const ART = {};
for (const [key, file] of [["poseidon", "poseidon.png"], ["mermaid", "mermaid.png"]]) {
  const img = new Image();
  img.src = `art/${file}`;
  img.onload = () => { ART[key] = img; };
}

/* Painted pose sets. Each is optional: a missing file just falls back to
   the single painted image, and a missing pose set falls back to the
   code-drawn character, so the game never breaks on a 404. */
const POSE = { poseidon: {}, mermaid: {}, crab: {}, prawn: {}, seahorse: {}, octopus: {} };
for (const [who, name] of [
  ["poseidon", "idle"], ["poseidon", "windup"], ["poseidon", "strike"], ["poseidon", "recoil"],
  ["mermaid", "idle"], ["mermaid", "swim"], ["mermaid", "turn"], ["mermaid", "rest"],
  ["crab", "idle"], ["crab", "move"], ["prawn", "idle"], ["prawn", "move"],
  ["seahorse", "idle"], ["seahorse", "move"], ["octopus", "idle"], ["octopus", "move"],
]) {
  const img = new Image();
  img.src = `art/${who}_${name}.png`;
  img.onload = () => { POSE[who][name] = img; };
}
const poseOf = (who, name) => POSE[who][name] || POSE[who].idle || ART[who] || null;

/** Draw a painted sprite with the same idle life the drawn ones had. */
/* `grow` exists because 3.4 was chosen for Poseidon, who is a landmark. A crab
   drawn at the same multiple would be the size of a shipwreck. */
function drawSprite(img, k, ph, bob, tilt, grow) {
  const h = k * (grow || 3.4);
  const w = h * (img.width / img.height);
  ctx.save();
  ctx.rotate(Math.sin(ph * 0.55) * tilt);
  ctx.translate(0, Math.sin(ph * 0.9) * bob * k);
  /* breathing: a hair under 2%, enough to read as alive and not as a pulse */
  const br = 1 + Math.sin(ph * 0.75) * 0.018;
  ctx.drawImage(img, -w / 2, -h * 0.38, w * br, h * br);
  ctx.restore();
}

function buildCritters() {
  critters = [];
  if (!TANKS[TANK] || !TANKS[TANK].vip) return;
  const floor = swimFloor();
  const area = (WORLD.w * WORLD.h) / (16800 * 6200);
  const n = (k) => Math.max(2, Math.round(k * clamp(area, 0.5, 2)));
  const add = (kind, count, lowY, highY, scale) => {
    for (let i = 0; i < count; i++) {
      critters.push({
        kind, x: rnd(200, WORLD.w - 200), y: rnd(lowY, highY),
        ph: rnd(0, TAU), s: rnd(scale * 0.8, scale * 1.25), dir: Math.random() < 0.5 ? -1 : 1,
        drift: rnd(6, 22),
      });
    }
  };
  add("mermaid", n(5), floor * 0.3, floor * 0.78, 2.6);
  add("octopus", n(6), floor * 0.55, floor - 140, 1.7);
  add("seahorse", n(10), floor * 0.4, floor - 180, 1.15);
  add("crab", n(12), floor - 110, floor - 50, 1.15);
  add("prawn", n(14), floor * 0.6, floor - 80, 0.85);
}

const CRITTER_SPEED = { mermaid: 74, octopus: 26, seahorse: 20, crab: 34, prawn: 52 };

function stepCritters(dt) {
  const floor = swimFloor();
  for (let i = 0; i < critters.length; i++) {
    const c = critters[i];
    c.ph += dt * (c.kind === "mermaid" ? 1.15 : 0.85);

    /* mermaids change what they are doing every few seconds, so a court
       full of them does not read as one image repeated */
    /* The little ones alternate between resting and moving on their own clocks,
       so a tank full of crabs never looks like one crab stamped four times. */
    if (c.kind === "crab" || c.kind === "prawn" || c.kind === "seahorse" || c.kind === "octopus") {
      c.beat = (c.beat === undefined ? rnd(1.2, 4.5) : c.beat) - dt;
      if (c.beat <= 0) {
        c.beat = rnd(2.2, 5.5);
        c.prev = c.pose || "idle";
        c.pose = c.pose === "move" ? "idle" : "move";
        c.fade = 0;
      }
      if (c.fade !== undefined && c.fade < 1) c.fade = Math.min(1, c.fade + dt / POSE_BLEND);
    }
    if (c.kind === "mermaid") {
      c.poseT = (c.poseT === undefined ? rnd(2, 10) : c.poseT) - dt;
      if (c.poseT <= 0) {
        c.poseT = rnd(6, 14);
        const nx = ["idle", "swim", "turn", "rest"][(Math.random() * 4) | 0];
        if (nx !== c.pose) { c.prev = c.pose || "idle"; c.pose = nx; c.fade = 0; }
      }
      if (c.fade !== undefined && c.fade < 1) c.fade = Math.min(1, c.fade + dt / POSE_BLEND);
    }

    /* they go somewhere, rather than jittering on the spot */
    const sp = CRITTER_SPEED[c.kind] || 30;
    c.x += c.dir * sp * dt;
    if (c.x < 260) c.dir = 1;
    else if (c.x > WORLD.w - 260) c.dir = -1;
    else if (Math.random() < dt * 0.06) c.dir *= -1;

    if (c.kind === "crab") {
      c.y = floor - 60 - Math.abs(Math.sin(c.ph * 3)) * 14;   /* scuttle */
    } else {
      c.y += Math.sin(c.ph * 0.6 + c.x * 0.0004) * 26 * dt;
      c.y = clamp(c.y, floor * 0.22, floor - 90);
    }
  }
}

function drawCritters() {
  if (!critters.length) return;
  for (let i = 0; i < critters.length; i++) {
    const c = critters[i];
    if (c.x < viewL - 200 || c.x > viewR + 200 || c.y < viewT - 200 || c.y > viewB + 200) continue;
    const k = 46 * c.s;
    if (k * cam.z < 6) continue;
    ctx.save();
    ctx.translate(c.x, c.y + Math.sin(c.ph) * 8);
    ctx.scale(c.dir, 1);

    const isArt = POSE[c.kind] !== undefined;
    const small = c.kind === "crab" || c.kind === "prawn" || c.kind === "seahorse" || c.kind === "octopus";
    const bob = c.kind === "mermaid" ? 0.07 : c.kind === "crab" ? 0.02 : small ? 0.06 : 0.05;
    const tilt = c.kind === "mermaid" ? 0.05 : c.kind === "crab" ? 0.01 : small ? 0.04 : 0.03;
    const cmix = (c.kind === "mermaid" || small) && c.prev && c.prev !== c.pose && c.fade < 1;
    /* matched by eye to the footprints the code-drawn versions had */
    const grow = c.kind === "crab" ? 1.5 : c.kind === "prawn" ? 1.6
      : c.kind === "seahorse" ? 2.0 : c.kind === "octopus" ? 1.8 : 3.4;
    let cimg = null;
    if (isArt) {
      if (cmix) {
        const a = poseOf(c.kind, c.prev);
        if (a) { ctx.save(); ctx.globalAlpha *= 1 - c.fade; drawSprite(a, k, c.ph, bob, tilt, grow); ctx.restore(); }
      }
      cimg = poseOf(c.kind, (c.kind === "mermaid" || small) ? (c.pose || "idle") : "idle");
    }
    if (cimg) {
      if (cmix) { ctx.save(); ctx.globalAlpha *= c.fade; drawSprite(cimg, k, c.ph, bob, tilt, grow); ctx.restore(); }
      else drawSprite(cimg, k, c.ph, bob, tilt, grow);
    } else if (c.kind === "poseidon") {
      const sway = Math.sin(c.ph * 0.8);
      const pg = ctx.createLinearGradient(0, 0, 0, k * 1.8);
      pg.addColorStop(0, "#176f63");
      pg.addColorStop(1, "#7fe3c8");
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.moveTo(-k * 0.3, 0);
      ctx.quadraticCurveTo(k * 0.16, k * 0.8, -k * 0.08 + sway * k * 0.3, k * 1.4);
      ctx.quadraticCurveTo(-k * 0.7, k * 1.6, -k * 0.6, k * 1.05);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(150,245,220,0.75)";
      ctx.beginPath();
      ctx.ellipse(-k * 0.24 + sway * k * 0.3, k * 1.5, k * 0.55, k * 0.18, sway * 0.3, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#e8c39e";
      ctx.beginPath(); ctx.ellipse(0, -k * 0.2, k * 0.3, k * 0.44, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#e8c39e"; ctx.lineWidth = k * 0.15; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-k * 0.2, -k * 0.4); ctx.lineTo(-k * 0.6, -k * 0.05); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(k * 0.2, -k * 0.4); ctx.lineTo(k * 0.6, -k * 0.7); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -k * 0.78, k * 0.22, 0, TAU); ctx.fill();
      ctx.fillStyle = "#f2f7fa";
      ctx.beginPath();
      ctx.moveTo(-k * 0.22, -k * 0.72);
      ctx.quadraticCurveTo(0, k * 0.3 + sway * k * 0.05, k * 0.22, -k * 0.72);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#ffd166";
      ctx.beginPath();
      ctx.moveTo(-k * 0.26, -k * 0.94);
      for (let i = 0; i < 4; i++) {
        ctx.lineTo(-k * 0.26 + (i + 0.5) * k * 0.17, -k * 1.14);
        ctx.lineTo(-k * 0.26 + (i + 1) * k * 0.17, -k * 0.94);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#ffd166"; ctx.lineWidth = k * 0.07;
      ctx.beginPath(); ctx.moveTo(k * 0.6, -k * 0.7); ctx.lineTo(k * 0.7, k * 1.1); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(k * 0.44, -k * 0.76); ctx.lineTo(k * 0.42, -k * 1.3);
      ctx.moveTo(k * 0.6, -k * 0.78);  ctx.lineTo(k * 0.6, -k * 1.45);
      ctx.moveTo(k * 0.76, -k * 0.8);  ctx.lineTo(k * 0.78, -k * 1.3);
      ctx.moveTo(k * 0.42, -k * 0.9);  ctx.lineTo(k * 0.78, -k * 0.94);
      ctx.stroke();
    } else if (c.kind === "mermaid") {
      const sway = Math.sin(c.ph * 1.1);
      const swirl = Math.sin(c.ph * 0.7);
      ctx.rotate(swirl * 0.12);

      /* --- tail: upper haunch, lower tail, then the fluke --- */
      const tg = ctx.createLinearGradient(0, 0, 0, k * 1.9);
      tg.addColorStop(0, "#1f8f8a");
      tg.addColorStop(0.45, "#2fc9ab");
      tg.addColorStop(1, "#8ff2d8");
      ctx.fillStyle = tg;
      const bend = sway * k * 0.34;
      ctx.beginPath();
      ctx.moveTo(-k * 0.3, k * 0.05);
      ctx.quadraticCurveTo(-k * 0.42, k * 0.7, -k * 0.16 + bend, k * 1.15);
      ctx.quadraticCurveTo(-k * 0.02 + bend * 1.3, k * 1.5, -k * 0.12 + bend * 1.5, k * 1.62);
      ctx.quadraticCurveTo(k * 0.16 + bend * 1.3, k * 1.4, k * 0.24 + bend, k * 1.0);
      ctx.quadraticCurveTo(k * 0.36, k * 0.55, k * 0.28, k * 0.02);
      ctx.closePath();
      ctx.fill();

      /* scale hints */
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = k * 0.022;
      for (let row = 0; row < 5; row++) {
        const yy = k * (0.3 + row * 0.24);
        const off = bend * (row / 5);
        ctx.beginPath();
        ctx.arc(off, yy, k * (0.24 - row * 0.03), 0.25 * Math.PI, 0.75 * Math.PI);
        ctx.stroke();
      }

      /* fluke — two soft lobes with a translucent membrane */
      const fx = -k * 0.12 + bend * 1.5, fy = k * 1.62;
      const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, k * 0.85);
      fg.addColorStop(0, "rgba(160,250,225,0.95)");
      fg.addColorStop(1, "rgba(90,220,200,0.35)");
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(fx, fy - k * 0.1);
      ctx.quadraticCurveTo(fx - k * 0.9, fy + k * 0.05 + sway * k * 0.16, fx - k * 0.62, fy + k * 0.52);
      ctx.quadraticCurveTo(fx - k * 0.2, fy + k * 0.28, fx, fy + k * 0.1);
      ctx.quadraticCurveTo(fx + k * 0.2, fy + k * 0.3, fx + k * 0.6, fy + k * 0.5);
      ctx.quadraticCurveTo(fx + k * 0.86, fy - k * 0.02 - sway * k * 0.16, fx, fy - k * 0.1);
      ctx.closePath();
      ctx.fill();

      /* --- torso --- */
      const sg = ctx.createLinearGradient(-k * 0.3, -k * 0.9, k * 0.3, k * 0.2);
      sg.addColorStop(0, "#ffe0c2");
      sg.addColorStop(1, "#e0ab84");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.moveTo(-k * 0.26, -k * 0.52);
      ctx.quadraticCurveTo(-k * 0.34, -k * 0.1, -k * 0.2, k * 0.1);
      ctx.quadraticCurveTo(0, k * 0.2, k * 0.2, k * 0.08);
      ctx.quadraticCurveTo(k * 0.32, -k * 0.12, k * 0.24, -k * 0.54);
      ctx.quadraticCurveTo(0, -k * 0.72, -k * 0.26, -k * 0.52);
      ctx.closePath();
      ctx.fill();

      /* arms, one reaching, one trailing */
      ctx.strokeStyle = sg;
      ctx.lineWidth = k * 0.14;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-k * 0.22, -k * 0.42);
      ctx.quadraticCurveTo(-k * 0.6, -k * 0.3 + sway * k * 0.12, -k * 0.74, -k * 0.62 + sway * k * 0.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(k * 0.22, -k * 0.42);
      ctx.quadraticCurveTo(k * 0.56, -k * 0.12 - sway * k * 0.1, k * 0.44, k * 0.3);
      ctx.stroke();

      /* shell top */
      ctx.fillStyle = "#ff8fb1";
      for (const sx2 of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(sx2 * k * 0.14, -k * 0.4, k * 0.15, k * 0.12, sx2 * 0.3, 0, TAU);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = k * 0.015;
      for (const sx2 of [-1, 1]) {
        for (let f2 = -1; f2 <= 1; f2++) {
          ctx.beginPath();
          ctx.moveTo(sx2 * k * 0.14, -k * 0.4);
          ctx.lineTo(sx2 * k * 0.14 + f2 * k * 0.08, -k * 0.29);
          ctx.stroke();
        }
      }

      /* head */
      ctx.fillStyle = "#ffe0c2";
      ctx.beginPath();
      ctx.ellipse(0, -k * 0.82, k * 0.2, k * 0.24, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#3a2318";
      ctx.beginPath(); ctx.ellipse(k * 0.07, -k * 0.85, k * 0.028, k * 0.04, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-k * 0.07, -k * 0.85, k * 0.028, k * 0.04, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(190,90,90,0.7)";
      ctx.lineWidth = k * 0.02;
      ctx.beginPath(); ctx.arc(0, -k * 0.74, k * 0.06, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();

      /* hair: several ribbons, each with its own drift */
      for (let h = 0; h < 6; h++) {
        const hp = c.ph * 0.9 + h * 0.7;
        const spread = (h - 2.5) * k * 0.09;
        const hg = ctx.createLinearGradient(0, -k, spread, k * 0.6);
        hg.addColorStop(0, "#b3391f");
        hg.addColorStop(1, "#e26a3a");
        ctx.strokeStyle = hg;
        ctx.lineWidth = k * 0.12;
        ctx.beginPath();
        ctx.moveTo(spread * 0.4, -k * 1.0);
        ctx.quadraticCurveTo(
          spread - k * 0.5 + Math.sin(hp) * k * 0.18, -k * 0.5,
          spread - k * 0.42 + Math.sin(hp + 1) * k * 0.28, k * 0.34,
        );
        ctx.stroke();
      }
      ctx.fillStyle = "#c2461f";
      ctx.beginPath();
      ctx.ellipse(0, -k * 0.95, k * 0.24, k * 0.2, 0, Math.PI, TAU);
      ctx.fill();

      /* a few bubbles, because she is breathing */
      ctx.fillStyle = "rgba(220,250,255,0.5)";
      for (let bI = 0; bI < 3; bI++) {
        const bt = (c.ph * 0.4 + bI * 0.33) % 1;
        ctx.beginPath();
        ctx.arc(k * 0.2 + Math.sin(bt * 5) * k * 0.1, -k * 0.95 - bt * k * 1.1, k * 0.05 * (1 - bt), 0, TAU);
        ctx.fill();
      }
    } else if (c.kind === "octopus") {
      ctx.fillStyle = "#a4508b";
      for (let t = 0; t < 6; t++) {
        const a0 = -0.5 + t * 0.42;
        ctx.strokeStyle = "#a4508b";
        ctx.lineWidth = k * 0.12;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(0, k * 0.12);
        ctx.quadraticCurveTo(
          Math.cos(a0) * k * 0.5, k * 0.6 + Math.sin(c.ph * 1.6 + t) * k * 0.14,
          Math.cos(a0) * k * 0.85, k * 1.0 + Math.sin(c.ph * 1.6 + t) * k * 0.22,
        );
        ctx.stroke();
      }
      ctx.fillStyle = "#c471a5";
      ctx.beginPath(); ctx.ellipse(0, -k * 0.16, k * 0.44, k * 0.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#1c0f22";
      ctx.beginPath(); ctx.arc(-k * 0.16, -k * 0.2, k * 0.08, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(k * 0.16, -k * 0.2, k * 0.08, 0, TAU); ctx.fill();
    } else if (c.kind === "seahorse") {
      ctx.strokeStyle = "#f6b93b";
      ctx.lineWidth = k * 0.26;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, -k * 0.5);
      ctx.quadraticCurveTo(k * 0.3, 0, 0, k * 0.4);
      ctx.quadraticCurveTo(-k * 0.3, k * 0.7, k * 0.05, k * 0.85);
      ctx.stroke();
      ctx.fillStyle = "#f6b93b";
      ctx.beginPath(); ctx.ellipse(-k * 0.06, -k * 0.62, k * 0.2, k * 0.16, -0.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-k * 0.2, -k * 0.66); ctx.lineTo(-k * 0.5, -k * 0.62); ctx.lineTo(-k * 0.2, -k * 0.52); ctx.fill();
      ctx.fillStyle = "#2d1b06";
      ctx.beginPath(); ctx.arc(-k * 0.02, -k * 0.66, k * 0.05, 0, TAU); ctx.fill();
    } else if (c.kind === "crab") {
      ctx.fillStyle = "#e8503a";
      ctx.beginPath(); ctx.ellipse(0, 0, k * 0.42, k * 0.28, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#e8503a";
      ctx.lineWidth = k * 0.09;
      for (let l = -1; l <= 1; l += 2) {
        for (let j = 0; j < 3; j++) {
          ctx.beginPath();
          ctx.moveTo(l * k * 0.28, k * 0.06);
          ctx.lineTo(l * k * (0.5 + j * 0.12), k * (0.3 + Math.sin(c.ph * 2 + j) * 0.05));
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(l * k * 0.34, -k * 0.1);
        ctx.lineTo(l * k * 0.6, -k * 0.3);
        ctx.stroke();
        ctx.fillStyle = "#ff6f52";
        ctx.beginPath(); ctx.arc(l * k * 0.64, -k * 0.34, k * 0.13, 0, TAU); ctx.fill();
        ctx.fillStyle = "#e8503a";
      }
      ctx.fillStyle = "#2a0d06";
      ctx.beginPath(); ctx.arc(-k * 0.12, -k * 0.2, k * 0.06, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(k * 0.12, -k * 0.2, k * 0.06, 0, TAU); ctx.fill();
    } else {
      /* prawn */
      ctx.strokeStyle = "rgba(255,170,150,0.9)";
      ctx.lineWidth = k * 0.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(k * 0.3, -k * 0.1);
      ctx.quadraticCurveTo(-k * 0.1, k * 0.15 + Math.sin(c.ph * 2) * k * 0.06, -k * 0.35, -k * 0.15);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,200,180,0.7)";
      ctx.lineWidth = k * 0.05;
      ctx.beginPath();
      ctx.moveTo(k * 0.32, -k * 0.12); ctx.lineTo(k * 0.7, -k * 0.34);
      ctx.moveTo(k * 0.32, -k * 0.12); ctx.lineTo(k * 0.68, -k * 0.02);
      ctx.stroke();
    }
    ctx.restore();
  }
}


/* ==========================================================================
   POSEIDON
   He does not hunt, he does not grow, and he is not made of mass — he has
   POWER, and it only comes off when someone strong enough hits him. A single
   fish under 40,000 points is a nuisance; five working together are a
   problem. Like the ball, one client owns him and broadcasts, so everyone in
   the court sees the same health bar and the same death.
   ========================================================================== */

const BOSS = {
  on: false, x: 0, y: 0, power: 30000, max: 30000,
  atkCd: 3, wave: 0, waveR: 0, hit: 0, dead: false, ph: 0, host: false, seen: -99, sendAt: 0,
  tick: 0, tickT: 0, pose: "idle", prev: "", fade: 1,
};
const BOSS_GATE = 10000;      /* points needed before he even notices you */
const BOSS_SOLO = 40000;      /* points at which one fish can realistically do it */
const BOSS_SOLO_MASS = 9000;  /* the size that hits for full weight */
const POSE_BLEND = 0.16;      /* seconds to cross-fade one pose into the next */
const RAM_BOSS_DMG = 620;     /* per second of contact, at full weight */
const SPIT_BOSS_DMG = 1.15;   /* per unit of mass in the glob, at full weight */

const bossHere = () => TANK === "throne" && !ARENA.on;

function resetBoss() {
  BOSS.on = bossHere();
  BOSS.x = WORLD.w / 2;
  BOSS.y = swimFloor() - 520;
  BOSS.power = BOSS.max;
  BOSS.dead = false;
  BOSS.wave = 0;
  BOSS.atkCd = 4;
  BOSS.seen = -99;
}

/** Your damage scales with how much fish you are actually bringing.
    Points buy you the right to swing at him; MASS is the swing. Scoring
    off score meant he could grind you to a minnow and still take full
    damage, which made the whole fight a formality. */
function bossDamageFrom(pts, base) {
  if (pts < BOSS_GATE) return 0;
  return base * clamp(player.mass / BOSS_SOLO_MASS, 0.06, 1.7);
}

function hurtBoss(amount) {
  if (!BOSS.on || BOSS.dead || amount <= 0) return;
  BOSS.power = Math.max(0, BOSS.power - amount);
  BOSS.hit = 1;
  if (!BOSS.host) sendEvent({ k: "D", d: Math.round(amount) });
  if (BOSS.power <= 0 && !BOSS.dead) bossFalls();
}

function bossFalls() {
  BOSS.dead = true;
  BOSS.power = 0;
  banner("the sea king falls", "POSEIDON DEFEATED");
  for (let i = 0; i < 6; i++) spark(BOSS.x + rnd(-200, 200), BOSS.y + rnd(-200, 200), 220, "rgba(255,225,140,1)");
  Wallet.gems += 5;
  Wallet.pearls += 2500;
  Wallet.save();
  G.score += 5000;
  floatText(BOSS.x, BOSS.y - 200, "+5000 · +5 GEMS", "#ffe08a");
  Snd.grow();
  if (BOSS.host) sendEvent({ k: "P", p: 0, dead: 1 });
}

function stepBoss(dt) {
  if (!BOSS.on || !G.running || G.dead) return;
  BOSS.ph += dt;
  BOSS.hit = Math.max(0, BOSS.hit - dt * 2);

  /* Pick the pose here rather than in the draw, because this is where dt
     is, and a blend needs a clock. Snapping between frames read as a jolt;
     a sixth of a second of cross-fade reads as the swing itself. */
  const want = BOSS.dead ? "recoil"
    : BOSS.wave > 0 && BOSS.waveR < 1000 ? "strike"
    : BOSS.hit > 0.45 ? "recoil"
    : BOSS.atkCd < 1.1 ? "windup"
    : "idle";
  if (want !== BOSS.pose) { BOSS.prev = BOSS.pose; BOSS.pose = want; BOSS.fade = 0; }
  if (BOSS.fade < 1) BOSS.fade = Math.min(1, BOSS.fade + dt / POSE_BLEND);

  if (BOSS.dead) return;

  BOSS.host = T - BOSS.seen > 1.5 ? (() => {
    let best = pid;
    for (const [id, g] of ghosts) if (!g.gdead && id < best) best = id;
    return best === pid;
  })() : BOSS.host;

  const d = Math.hypot(player.x - BOSS.x, player.y - BOSS.y);

  /* ramming him: costs you, hurts him, and only if you are big enough */
  if (d < 420 + player.r) {
    const dmg = bossDamageFrom(G.score, RAM_BOSS_DMG * dt);
    if (dmg > 0) {
      hurtBoss(dmg);
      /* show the damage, or you cannot tell you are winning */
      BOSS.tick += dmg;
      BOSS.tickT -= dt;
      if (BOSS.tickT <= 0) {
        BOSS.tickT = 0.5;
        floatText(player.x, player.y - player.r - 30, "-" + Math.round(BOSS.tick), "#ffd98a");
        BOSS.tick = 0;
      }
      player.mass = Math.max(PLAYER_START_MASS, player.mass * (1 - 0.16 * dt));
      player.r = radiusOf(player.mass);
    }
  }

  /* his trident sweep: only ever aimed at someone who has actually
     challenged him. Below the gate he does not stir, so the rest of the
     court is an ordinary reef you can grow up in. */
  const challenger = G.score >= BOSS_GATE;
  BOSS.atkCd -= challenger ? dt : 0;
  if (BOSS.wave > 0) {
    BOSS.wave -= dt;
    BOSS.waveR += 1500 * dt;
    if (challenger && d > BOSS.waveR - 120 && d < BOSS.waveR + 120) {
      const away = Math.atan2(player.y - BOSS.y, player.x - BOSS.x);
      player.x += Math.cos(away) * 900 * dt;
      player.y += Math.sin(away) * 900 * dt;
      player.mass = Math.max(1, player.mass * (1 - 0.9 * dt));
      player.r = radiusOf(player.mass);
      G.score = Math.max(0, G.score - Math.round(220 * dt));
      cam.shake = 1;
      if (player.mass <= PLAYER_START_MASS * 0.4) gameOver(null);
    }
  } else if (challenger && BOSS.atkCd <= 0 && d < 1500) {
    BOSS.wave = 2.2;
    BOSS.waveR = 200;
    BOSS.atkCd = rnd(4.5, 7);
    Snd.die();
  }

  if (BOSS.host) {
    BOSS.sendAt += dt;
    if (BOSS.sendAt > 0.4) {
      BOSS.sendAt = 0;
      sendEvent({ k: "P", p: Math.round(BOSS.power), dead: BOSS.dead ? 1 : 0 });
    }
  }
}

function drawBoss() {
  if (!BOSS.on || BOSS.dead) return;
  const k = 230;
  if (BOSS.x + k * 3 < viewL || BOSS.x - k * 3 > viewR) return;

  /* the sweep */
  if (BOSS.wave > 0) {
    ctx.strokeStyle = `rgba(120,220,255,${clamp(BOSS.wave / 2.2, 0, 1) * 0.8})`;
    ctx.lineWidth = 40;
    ctx.beginPath();
    ctx.arc(BOSS.x, BOSS.y, BOSS.waveR, 0, TAU);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(BOSS.x, BOSS.y + Math.sin(BOSS.ph * 0.6) * 22);
  /* He hauls the trident up as the cooldown runs out, drives it forward on
     the sweep, and reels when hit. During a blend both frames are drawn,
     the outgoing one fading, which reads as the movement between them. */
  const layPose = (name, alpha) => {
    const im = poseOf("poseidon", name);
    if (!im || alpha <= 0.01) return false;
    const h = k * 3.6, w = h * (im.width / im.height);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.rotate(Math.sin(BOSS.ph * 0.4) * 0.02);
    if (BOSS.hit > 0) ctx.filter = `brightness(${1 + BOSS.hit * 0.6})`;
    ctx.drawImage(im, -w / 2, -h * 0.42, w, h);
    ctx.filter = "none";
    ctx.restore();
    return true;
  };
  const blending = BOSS.prev && BOSS.prev !== BOSS.pose && BOSS.fade < 1;
  let bimg = false;
  if (blending) bimg = layPose(BOSS.prev, 1 - BOSS.fade) || bimg;
  bimg = layPose(BOSS.pose, blending ? BOSS.fade : 1) || bimg;
  if (bimg) {
    const charge2 = BOSS.wave > 0 ? 1 : clamp(1 - BOSS.atkCd / 3, 0, 1);
    if (charge2 > 0.05) {
      const glow2 = ctx.createRadialGradient(k * 0.5, -k * 1.15, 0, k * 0.5, -k * 1.15, k * 0.8 * charge2);
      glow2.addColorStop(0, `rgba(180,240,255,${0.8 * charge2})`);
      glow2.addColorStop(1, "rgba(120,220,255,0)");
      ctx.fillStyle = glow2;
      ctx.beginPath(); ctx.arc(k * 0.5, -k * 1.15, k * 0.8 * charge2, 0, TAU); ctx.fill();
    }
    ctx.restore();
    drawBossBar(k);
    return;
  }
  const br = Math.sin(BOSS.ph * 0.9);          /* breathing */
  const drift = Math.sin(BOSS.ph * 0.55);      /* hair and beard in the current */

  /* an aura of moving water, so he reads as a force and not a statue */
  for (let a = 0; a < 3; a++) {
    const rr = k * (1.5 + a * 0.35) + Math.sin(BOSS.ph * 1.1 + a) * k * 0.08;
    ctx.strokeStyle = `rgba(110,220,255,${0.16 - a * 0.045})`;
    ctx.lineWidth = k * 0.05;
    ctx.beginPath();
    ctx.ellipse(0, k * 0.3, rr, rr * 0.72, Math.sin(BOSS.ph * 0.3 + a) * 0.2, 0, TAU);
    ctx.stroke();
  }

  /* throne of coral and stone */
  const thr = ctx.createLinearGradient(0, -k * 0.6, 0, k * 1.7);
  thr.addColorStop(0, "rgba(38,78,104,0.95)");
  thr.addColorStop(1, "rgba(14,34,50,0.95)");
  ctx.fillStyle = thr;
  ctx.beginPath();
  ctx.moveTo(-k * 1.0, k * 1.7);
  ctx.lineTo(-k * 0.78, -k * 0.5);
  ctx.quadraticCurveTo(-k * 0.5, -k * 1.15, 0, -k * 1.2);
  ctx.quadraticCurveTo(k * 0.5, -k * 1.15, k * 0.78, -k * 0.5);
  ctx.lineTo(k * 1.0, k * 1.7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(120,200,230,0.25)";
  ctx.lineWidth = k * 0.03;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(i * k * 0.24, -k * 0.5);
    ctx.lineTo(i * k * 0.28, k * 1.6);
    ctx.stroke();
  }

  /* merman tail, coiled under the throne */
  const tg = ctx.createLinearGradient(0, k * 0.3, 0, k * 1.9);
  tg.addColorStop(0, "#176f63");
  tg.addColorStop(0.6, "#2aa88f");
  tg.addColorStop(1, "#7fe3c8");
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(-k * 0.42, k * 0.5);
  ctx.quadraticCurveTo(k * 0.3, k * 1.0, -k * 0.05 + drift * k * 0.2, k * 1.62);
  ctx.quadraticCurveTo(-k * 0.95, k * 1.85, -k * 0.82, k * 1.25);
  ctx.quadraticCurveTo(-k * 0.66, k * 0.85, -k * 0.42, k * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(150,245,220,0.7)";
  ctx.beginPath();
  ctx.ellipse(-k * 0.3 + drift * k * 0.2, k * 1.72, k * 0.6, k * 0.2, drift * 0.3, 0, TAU);
  ctx.fill();

  /* torso — shaded, with a chest and shoulders rather than an egg */
  const skin = ctx.createLinearGradient(-k * 0.5, -k * 0.9, k * 0.5, k * 0.5);
  skin.addColorStop(0, BOSS.hit > 0 ? "#fff0e2" : "#f0cfae");
  skin.addColorStop(0.55, BOSS.hit > 0 ? "#ffd8bd" : "#d9a97f");
  skin.addColorStop(1, "#b8845d");
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.moveTo(-k * 0.5, -k * 0.42);
  ctx.quadraticCurveTo(-k * 0.58, k * 0.05, -k * 0.34, k * 0.46);
  ctx.quadraticCurveTo(0, k * 0.62, k * 0.34, k * 0.46);
  ctx.quadraticCurveTo(k * 0.58, k * 0.05, k * 0.5, -k * 0.42);
  ctx.quadraticCurveTo(k * 0.2, -k * 0.62, 0, -k * 0.6);
  ctx.quadraticCurveTo(-k * 0.2, -k * 0.62, -k * 0.5, -k * 0.42);
  ctx.closePath();
  ctx.fill();
  /* chest and abdomen shading */
  ctx.strokeStyle = "rgba(120,70,40,0.3)";
  ctx.lineWidth = k * 0.025;
  ctx.beginPath(); ctx.moveTo(0, -k * 0.3); ctx.lineTo(0, k * 0.4); ctx.stroke();
  ctx.beginPath(); ctx.arc(-k * 0.2, -k * 0.22, k * 0.17, 0, Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.arc(k * 0.2, -k * 0.22, k * 0.17, 0, Math.PI); ctx.stroke();

  /* arms — one on the throne, one holding the trident */
  ctx.strokeStyle = skin;
  ctx.lineWidth = k * 0.2 + br * k * 0.006;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-k * 0.42, -k * 0.34);
  ctx.quadraticCurveTo(-k * 0.82, -k * 0.05, -k * 0.86, k * 0.42);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(k * 0.42, -k * 0.34);
  ctx.quadraticCurveTo(k * 0.78, -k * 0.4, k * 0.74, -k * 0.72);
  ctx.stroke();

  /* head */
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(0, -k * 0.82, k * 0.26, k * 0.3, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(30,60,80,0.9)";
  ctx.beginPath(); ctx.ellipse(-k * 0.1, -k * 0.88, k * 0.04, k * 0.05, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(k * 0.1, -k * 0.88, k * 0.04, k * 0.05, 0, 0, TAU); ctx.fill();

  /* hair and beard as flowing ribbons */
  for (let h = 0; h < 7; h++) {
    const hp = BOSS.ph * 0.8 + h * 0.6;
    const spread = (h - 3) * k * 0.09;
    ctx.strokeStyle = `rgba(238,246,250,${0.9 - Math.abs(h - 3) * 0.09})`;
    ctx.lineWidth = k * 0.09;
    ctx.beginPath();
    ctx.moveTo(spread * 0.5, -k * 1.02);
    ctx.quadraticCurveTo(spread * 1.6 - k * 0.1, -k * 0.5 + Math.sin(hp) * k * 0.1,
                         spread * 2.1 + Math.sin(hp + 1) * k * 0.16, k * 0.15);
    ctx.stroke();
  }
  ctx.fillStyle = "#f2f7fa";
  ctx.beginPath();
  ctx.moveTo(-k * 0.26, -k * 0.76);
  ctx.quadraticCurveTo(-k * 0.16, k * 0.28 + drift * k * 0.06, 0, k * 0.4 + drift * k * 0.08);
  ctx.quadraticCurveTo(k * 0.16, k * 0.28 - drift * k * 0.06, k * 0.26, -k * 0.76);
  ctx.quadraticCurveTo(0, -k * 0.5, -k * 0.26, -k * 0.76);
  ctx.closePath();
  ctx.fill();

  /* crown */
  const cg = ctx.createLinearGradient(0, -k * 1.25, 0, -k * 0.98);
  cg.addColorStop(0, "#fff0b8");
  cg.addColorStop(1, "#e0a416");
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.moveTo(-k * 0.3, -k * 1.0);
  for (let i = 0; i < 5; i++) {
    ctx.lineTo(-k * 0.3 + (i + 0.5) * k * 0.15, -k * (1.2 + (i === 2 ? 0.12 : 0)));
    ctx.lineTo(-k * 0.3 + (i + 1) * k * 0.15, -k * 1.0);
  }
  ctx.closePath();
  ctx.fill();

  /* trident, with a charge that brightens before he sweeps */
  const charge = BOSS.wave > 0 ? 1 : clamp(1 - BOSS.atkCd / 3, 0, 1);
  ctx.strokeStyle = "#f0c249";
  ctx.lineWidth = k * 0.075;
  ctx.beginPath(); ctx.moveTo(k * 0.74, -k * 0.72); ctx.lineTo(k * 0.9, k * 1.35); ctx.stroke();
  ctx.strokeStyle = "#ffd873";
  ctx.lineWidth = k * 0.07;
  ctx.beginPath();
  ctx.moveTo(k * 0.55, -k * 0.78); ctx.lineTo(k * 0.52, -k * 1.42);
  ctx.moveTo(k * 0.74, -k * 0.8);  ctx.lineTo(k * 0.74, -k * 1.62);
  ctx.moveTo(k * 0.93, -k * 0.82); ctx.lineTo(k * 0.96, -k * 1.42);
  ctx.moveTo(k * 0.52, -k * 0.92); ctx.lineTo(k * 0.96, -k * 0.96);
  ctx.stroke();
  if (charge > 0.05) {
    const glow = ctx.createRadialGradient(k * 0.74, -k * 1.5, 0, k * 0.74, -k * 1.5, k * 0.75 * charge);
    glow.addColorStop(0, `rgba(180,240,255,${0.85 * charge})`);
    glow.addColorStop(1, "rgba(120,220,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(k * 0.74, -k * 1.5, k * 0.75 * charge, 0, TAU); ctx.fill();
  }
  ctx.restore();

  drawBossBar(k);
}

function drawBossBar(k) {
  const w = 900, h = 26;
  ctx.fillStyle = "rgba(4,20,30,0.7)";
  ctx.fillRect(BOSS.x - w / 2, BOSS.y - k * 1.7, w, h);
  ctx.fillStyle = "#5fe8d0";
  ctx.fillRect(BOSS.x - w / 2, BOSS.y - k * 1.7, w * (BOSS.power / BOSS.max), h);
  ctx.fillStyle = "#eaf7ff";
  ctx.font = `700 ${Math.round(30)}px "Avenir Next", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(`POSEIDON  ${Math.round(BOSS.power).toLocaleString()}`, BOSS.x, BOSS.y - k * 1.78);
  if (G.score < BOSS_GATE) {
    ctx.fillStyle = "#ff9b8c";
    ctx.font = `700 24px "Avenir Next", system-ui, sans-serif`;
    ctx.fillText(`reach ${BOSS_GATE.toLocaleString()} points to challenge him`, BOSS.x, BOSS.y - k * 1.95);
  }
  ctx.textAlign = "left";
}


/* ==========================================================================
   YOUR TANK
   The one part of this game that exists while you are logged out. It is not
   a round: there is no timer, nothing hunts you, and nothing you place is
   lost. Pieces are bought with the pearls you earned in the reef, which is
   what finally gives a reef run a point beyond its own scoreline.
   ========================================================================== */

const TANK_W = 4000, TANK_H = 2400;

/* Nothing is unlimited. `cap` is how many you may own at tank level 1 and it
   grows as the tank does; `lvl` is the level the piece unlocks at. That is
   what makes levelling mean something rather than just being a number. */
const PIECES = {
  pebbles:  { name: "Pebbles",   price: 10,   gem: 0,  kind: "decor",    cap: 10, lvl: 1 },
  shell:    { name: "Shell",     price: 12,   gem: 0,  kind: "decor",    cap: 8, lvl: 1 },
  seagrass: { name: "Seagrass",  price: 15,   gem: 0,  kind: "decor",    cap: 10, lvl: 1 },
  starfish: { name: "Starfish",  price: 18,   gem: 0,  kind: "decor",    cap: 6, lvl: 1 },
  rock:     { name: "Rock",      price: 25,   gem: 0,  kind: "decor",    cap: 6, lvl: 1 },
  kelp:     { name: "Kelp",      price: 30,   gem: 0,  kind: "decor",    cap: 8, lvl: 1 },
  coral:    { name: "Coral",     price: 45,   gem: 0,  kind: "decor",    cap: 6, lvl: 1 },
  /* 70, and at level one: the first day's tending reward on a starter tank is
     80, and the whole promise of level one is that something ALIVE is within
     reach the moment you open the lid. */
  crab:     { name: "Crab",      price: 70,   gem: 0,  kind: "resident", cap: 4, lvl: 1 },
  prawn:    { name: "Prawn",     price: 120,  gem: 0,  kind: "resident", cap: 6, lvl: 3 },
  anemone:  { name: "Anemone",   price: 120,  gem: 0,  kind: "decor",    cap: 4, lvl: 3 },
  seahorse: { name: "Seahorse",  price: 300,  gem: 0,  kind: "resident", cap: 3, lvl: 4 },
  wreck:    { name: "Wreck",     price: 400,  gem: 0,  kind: "decor",    cap: 1, lvl: 5 },
  octopus:  { name: "Octopus",   price: 900,  gem: 0,  kind: "resident", cap: 2, lvl: 6 },
  mermaid:  { name: "Mermaid",   price: 0,    gem: 2,  kind: "resident", cap: 1, lvl: 8 },
  poseidon: { name: "Poseidon",  price: 0,    gem: 40, kind: "resident", cap: 1, lvl: 10 },
};

/** The tank levels on what you have actually built into it. */
function tankValue() {
  let v = 0;
  for (const it of TANKV.items) {
    const P = PIECES[it.t];
    if (P) v += P.price + P.gem * 250;
  }
  return v;
}
/* Retuned with the cheaper catalogue: filling every level-1 slot lands you
   around level 5, which opens prawn, anemone, seahorse and the wreck. */
const tankLevel = () => Math.max(1, Math.min(12, 1 + Math.floor(Math.sqrt(tankValue() / 60))));
const capFor = (id) => {
  const P = PIECES[id];
  if (!P) return 0;
  return P.cap <= 1 ? P.cap : P.cap + Math.floor((tankLevel() - 1) / 2);
};
const ownedOf = (id) => TANKV.items.reduce((n, it) => n + (it.t === id ? 1 : 0), 0);

/* Nobody should open this and find an empty rectangle. A new tank arrives
   furnished, free: something to look at, and something to drag around before
   you can afford to buy anything. */
const STARTER_TANK = [
  { t: "rock",     x: 1500, y: 2115, s: 130 },
  { t: "rock",     x: 2600, y: 2135, s: 105 },
  { t: "seagrass", x: 1120, y: 2100, s: 120 },
  { t: "seagrass", x: 1760, y: 2095, s: 110 },
  { t: "seagrass", x: 2380, y: 2105, s: 100 },
  { t: "seagrass", x: 2950, y: 2100, s: 115 },
  { t: "kelp",     x: 1330, y: 2060, s: 115 },
  { t: "kelp",     x: 2760, y: 2065, s: 105 },
  { t: "shell",    x: 1950, y: 2175, s: 100 },
  { t: "shell",    x: 2500, y: 2180, s: 88 },
  { t: "starfish", x: 1650, y: 2170, s: 100 },
  { t: "pebbles",  x: 2150, y: 2185, s: 100 },
  { t: "pebbles",  x: 2880, y: 2190, s: 92 },
];

const TANKV = {
  items: [], pick: "pebbles", removing: false, dirty: false, saveAt: 0, drag: -1,
  /* Open looking AT the furniture, not at the ceiling: the floor is where
     everything lives, so start low and close enough to read it. */
  zoom: 1.45, panning: false, downX: 0, downY: 0, moved: 0,
  camX: TANK_W / 2, camY: TANK_H - 620,
  viewing: "", viewName: "", loaded: false,
};

/** A brand new tank is furnished, not empty. Once only, ever. */
function seedStarterTank() {
  if (TANKV.items.length) return false;
  try { if (localStorage.getItem("rr_seeded") === "1") return false; } catch (e) {}
  TANKV.items = STARTER_TANK.map((it) => ({ ...it }));
  try { localStorage.setItem("rr_seeded", "1"); } catch (e) {}
  TANKV.dirty = true;
  return true;
}

async function loadTank(who) {
  try {
    const res = await fetch(`${API_BASE}/api/tank?pid=${encodeURIComponent(who || pid)}`);
    const d = await res.json();
    TANKV.items = Array.isArray(d.items) ? d.items : [];
    TANKV.viewName = d.name || "";
  } catch (e) {
    TANKV.items = [];
  }
  if (!TANKV.viewing && seedStarterTank()) banner("your tank is set up", "drag a piece to move it");
  TANKV.loaded = true;
  syncTankCritters();
  paintPalette();
  tankDailyReward();
}

/* The reason to come back tomorrow. Tending pays, and it pays more the more
   you have built, so the tank feeds the reef and the reef feeds the tank. */
function tankDailyReward() {
  if (TANKV.viewing) return;
  const now = Date.now();
  if (now - Number(Wallet.lastTend || 0) < 20 * 60 * 60 * 1000) return;
  const lvl = tankLevel();
  const award = 40 + lvl * 20;
  Wallet.pearls += award;
  Wallet.lastTend = now;
  Wallet.save();
  paintPalette();
  banner(`for tending a level ${lvl} tank`, `+${award} pearls`);
  Snd.pickup();
}

function saveTank() {
  if (TANKV.viewing) return;                    /* never write to someone else's */
  try {
    fetch(`${API_BASE}/api/tank`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pid, name: G.rawName || Wallet.lastName || "A fish", flag: Wallet.flag, items: TANKV.items }),
      keepalive: true,
    }).catch(() => {});
  } catch (e) {}
  TANKV.dirty = false;
}

/** Residents are drawn by the same code that animates the VIP waters. */
function syncTankCritters() {
  critters = [];
  for (const it of TANKV.items) {
    if (!PIECES[it.t] || PIECES[it.t].kind !== "resident") continue;
    critters.push({
      kind: it.t, x: it.x, y: it.y, ph: rnd(0, TAU),
      s: (it.s || 100) / 100 * (it.t === "poseidon" ? 5.2 : it.t === "mermaid" ? 2.6 : it.t === "octopus" ? 1.7 : 1.15),
      dir: Math.random() < 0.5 ? -1 : 1, drift: rnd(6, 22),
    });
  }
}

function paintPalette() {
  const box = el("palette");
  if (!box) return;
  const lvl = tankLevel();
  box.innerHTML = Object.keys(PIECES).map((id) => {
    const p2 = PIECES[id];
    const locked = lvl < p2.lvl;
    const have = ownedOf(id), cap = capFor(id);
    const poor = p2.gem ? Wallet.gems < p2.gem : Wallet.pearls < p2.price;
    const full = have >= cap;
    const cant = locked || poor || full;
    const cost = locked ? `level ${p2.lvl}` : p2.gem ? `💎 ${p2.gem}` : `🫧 ${p2.price}`;
    return `<div class="pal ${id === TANKV.pick && !TANKV.removing ? "on" : ""} ${locked ? "lockd" : full ? "full" : poor ? "cant" : ""}" data-piece="${id}">
      <b>${p2.name}</b><span>${cost}</span><span style="color:var(--dim)">${full ? "full" : have + "/" + cap}</span></div>`;
  }).join("");
  for (const c of box.querySelectorAll(".pal")) {
    c.addEventListener("click", () => {
      TANKV.pick = c.dataset.piece;
      TANKV.removing = false;
      el("tankSell").classList.remove("on");
      paintPalette();
    });
  }
  el("tankPurse").textContent = `🫧 ${Wallet.pearls.toLocaleString()}  💎 ${Wallet.gems}`;
  el("tankTitle").textContent = TANKV.viewing ? `${TANKV.viewName}'s tank` : `Your Tank · level ${tankLevel()}`;
  el("tankHint").textContent = TANKV.viewing
    ? "You are visiting someone else's tank. Press “Back to mine” to return and build."
    : "Click water to place · drag a piece to move it · drag the water to pan · scroll or pinch to zoom.";
  el("tankVisit").textContent = TANKV.viewing ? "Back to mine" : "Visit others";
  el("palette").style.opacity = TANKV.viewing ? "0.4" : "1";
}

/** Index of the placed piece nearest a world point, if anything is close. */
function pieceAt(wx, wy) {
  let bi = -1, bd = 1e9;
  for (let i = 0; i < TANKV.items.length; i++) {
    const d = Math.hypot(TANKV.items[i].x - wx, TANKV.items[i].y - wy);
    if (d < bd) { bd = d; bi = i; }
  }
  return bd < 190 ? bi : -1;
}

function tankZoom(mult, sx, sy) {
  const before = { x: cam.x + (sx - VW / 2) / cam.z, y: cam.y + (sy - VH / 2) / cam.z };
  TANKV.zoom = clamp(TANKV.zoom * mult, 1, 4);
  const z2 = tankFit() * TANKV.zoom;
  TANKV.camX = before.x - (sx - VW / 2) / z2;
  TANKV.camY = before.y - (sy - VH / 2) / z2;
}

function tankPan(dx, dy) {
  TANKV.camX -= dx / cam.z;
  TANKV.camY -= dy / cam.z;
}

function tankDragStart(sx, sy) {
  if (MODE !== "tank" || TANKV.viewing || TANKV.removing) return false;
  const wx = cam.x + (sx - VW / 2) / cam.z;
  const wy = cam.y + (sy - VH / 2) / cam.z;
  const i = pieceAt(wx, wy);
  if (i < 0) return false;
  TANKV.drag = i;
  return true;                       /* picked something up, so do not place */
}

function tankDragMove(sx, sy) {
  if (TANKV.drag < 0) return;
  const it = TANKV.items[TANKV.drag];
  if (!it) { TANKV.drag = -1; return; }
  it.x = Math.round(clamp(cam.x + (sx - VW / 2) / cam.z, 40, TANK_W - 40));
  it.y = Math.round(clamp(cam.y + (sy - VH / 2) / cam.z, 40, TANK_H - 40));
  syncTankCritters();
  TANKV.dirty = true;
}

function tankDragEnd() {
  if (TANKV.drag >= 0) { TANKV.drag = -1; TANKV.dirty = true; }
}

function tankClick(sx, sy) {
  if (MODE !== "tank") return;
  if (TANKV.viewing) { banner("this is not your tank", "press Back to mine"); return; }
  if (!TANKV.loaded) { banner("still loading", "one moment"); return; }
  const wx = cam.x + (sx - VW / 2) / cam.z;
  const wy = cam.y + (sy - VH / 2) / cam.z;
  if (wx < 40 || wx > TANK_W - 40 || wy < 40 || wy > TANK_H - 40) {
    banner("outside the glass", "click inside the tank");
    return;
  }

  if (TANKV.removing) {
    let bi = -1, bd = 1e9;
    for (let i = 0; i < TANKV.items.length; i++) {
      const d = Math.hypot(TANKV.items[i].x - wx, TANKV.items[i].y - wy);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi >= 0 && bd < 220) {
      const back = PIECES[TANKV.items[bi].t];
      if (back && !back.gem) Wallet.pearls += Math.round(back.price * 0.5);
      TANKV.items.splice(bi, 1);
      Wallet.save();
      syncTankCritters();
      paintPalette();
      TANKV.dirty = true;
      Snd.pickup();
    }
    return;
  }

  const piece = PIECES[TANKV.pick];
  if (!piece) return;
  if (tankLevel() < piece.lvl) { banner("locked", `needs tank level ${piece.lvl}`); return; }
  if (ownedOf(TANKV.pick) >= capFor(TANKV.pick)) {
    banner("you have enough of those", `${capFor(TANKV.pick)} is the limit for now`);
    return;
  }
  if (piece.gem ? Wallet.gems < piece.gem : Wallet.pearls < piece.price) {
    banner("not enough", piece.gem ? "gems" : "pearls");
    return;
  }
  if (TANKV.items.length >= 120) { banner("tank is full", "120 pieces"); return; }
  if (piece.gem) Wallet.gems -= piece.gem; else Wallet.pearls -= piece.price;
  Wallet.save();
  TANKV.items.push({ t: TANKV.pick, x: Math.round(wx), y: Math.round(wy), s: 100 });
  syncTankCritters();
  paintPalette();
  TANKV.dirty = true;
  Snd.food();
}

const tankFit = () => clamp(Math.min(VW / (TANK_W * 1.02), VH / (TANK_H * 1.02)), 0.05, 1);

function stepTank(dt) {
  if (MODE !== "tank") return;
  T += dt;
  stepCritters(dt);

  cam.tz = tankFit() * TANKV.zoom;
  cam.z = lerp(cam.z, cam.tz, 1 - Math.pow(0.002, dt));
  /* keep the glass in frame: pan freely, but never past the walls */
  const hw = VW / 2 / cam.z, hh = VH / 2 / cam.z;
  /* The palette sheet covers the bottom of the screen. Without this the camera
     cannot drop far enough to lift the sand clear of it, so the row of pieces
     you just bought stays hidden under the buttons. */
  const sheet = 200 / cam.z;
  const lox = Math.min(TANK_W / 2, hw), hix = Math.max(TANK_W / 2, TANK_W - hw);
  const loy = Math.min(TANK_H / 2, hh), hiy = Math.max(TANK_H / 2, TANK_H - hh + sheet);
  TANKV.camX = clamp(TANKV.camX, lox, hix);
  TANKV.camY = clamp(TANKV.camY, loy, hiy);
  cam.x = lerp(cam.x, TANKV.camX, 1 - Math.pow(0.002, dt));
  cam.y = lerp(cam.y, TANKV.camY, 1 - Math.pow(0.002, dt));
  if (TANKV.dirty) {
    TANKV.saveAt += dt;
    if (TANKV.saveAt > 1.2) { TANKV.saveAt = 0; saveTank(); }
  }
}

function drawTank() {
  drawWater();
  applyCamera();

  /* the glass box */
  const g = ctx.createLinearGradient(0, 0, 0, TANK_H);
  g.addColorStop(0, "rgba(90,190,225,0.20)");
  g.addColorStop(1, "rgba(20,80,110,0.34)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TANK_W, TANK_H);
  ctx.fillStyle = "#d9c9a2";
  ctx.fillRect(0, TANK_H - 130, TANK_W, 130);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(0, TANK_H - 130, TANK_W, 16);
  ctx.strokeStyle = "rgba(200,240,255,0.5)";
  ctx.lineWidth = 16;
  ctx.strokeRect(0, 0, TANK_W, TANK_H);

  for (const it of TANKV.items) {
    const P = PIECES[it.t];
    if (!P || P.kind !== "decor") continue;
    const k = (it.s || 100) * 1.1;
    ctx.save();
    ctx.translate(it.x, it.y);
    if (it.t === "rock") {
      ctx.fillStyle = "#4a5a63";
      ctx.beginPath();
      ctx.moveTo(-k * 0.6, k * 0.4);
      ctx.quadraticCurveTo(-k * 0.5, -k * 0.4, 0, -k * 0.45);
      ctx.quadraticCurveTo(k * 0.55, -k * 0.35, k * 0.6, k * 0.4);
      ctx.closePath(); ctx.fill();
    } else if (it.t === "coral") {
      ctx.strokeStyle = "#ff7b6b";
      ctx.lineWidth = k * 0.16; ctx.lineCap = "round";
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(0, k * 0.45);
        ctx.quadraticCurveTo(i * k * 0.3, 0, i * k * 0.42, -k * 0.55);
        ctx.stroke();
      }
    } else if (it.t === "kelp") {
      ctx.strokeStyle = "#2f7d4f";
      ctx.lineWidth = k * 0.16; ctx.lineCap = "round";
      const sw = Math.sin(T * 0.8 + it.x) * k * 0.3;
      ctx.beginPath();
      ctx.moveTo(0, k * 0.6);
      ctx.quadraticCurveTo(sw * 0.5, -k * 0.2, sw, -k * 1.1);
      ctx.stroke();
    } else if (it.t === "anemone") {
      ctx.strokeStyle = "#c86bd6";
      ctx.lineWidth = k * 0.1; ctx.lineCap = "round";
      for (let i = 0; i < 9; i++) {
        const a2 = -Math.PI / 2 + (i - 4) * 0.28 + Math.sin(T * 1.4 + i) * 0.08;
        ctx.beginPath();
        ctx.moveTo(0, k * 0.3);
        ctx.lineTo(Math.cos(a2) * k * 0.6, k * 0.3 + Math.sin(a2) * k * 0.6);
        ctx.stroke();
      }
      ctx.fillStyle = "#8e3fa0";
      ctx.beginPath(); ctx.ellipse(0, k * 0.34, k * 0.3, k * 0.16, 0, 0, TAU); ctx.fill();
    } else if (it.t === "pebbles") {
      const seed = (it.x * 13 + it.y * 7) % 1000;
      for (let i = 0; i < 5; i++) {
        const a2 = seed + i * 137.5;
        const r2 = k * (0.1 + ((a2 * 7) % 10) / 90);
        ctx.fillStyle = i % 2 ? "#6d7c86" : "#55636c";
        ctx.beginPath();
        ctx.ellipse(Math.cos(a2) * k * 0.45, Math.sin(a2 * 1.7) * k * 0.16 + k * 0.3, r2, r2 * 0.72, a2, 0, TAU);
        ctx.fill();
      }
    } else if (it.t === "shell") {
      const sg = ctx.createLinearGradient(0, -k * 0.4, 0, k * 0.4);
      sg.addColorStop(0, "#ffe8d6"); sg.addColorStop(1, "#e2a887");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.moveTo(0, k * 0.42);
      ctx.quadraticCurveTo(-k * 0.62, k * 0.1, -k * 0.34, -k * 0.34);
      ctx.quadraticCurveTo(0, -k * 0.56, k * 0.34, -k * 0.34);
      ctx.quadraticCurveTo(k * 0.62, k * 0.1, 0, k * 0.42);
      ctx.fill();
      ctx.strokeStyle = "rgba(150,95,70,0.55)"; ctx.lineWidth = k * 0.035;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(0, k * 0.4);
        ctx.quadraticCurveTo(i * k * 0.16, -k * 0.05, i * k * 0.26, -k * 0.36); ctx.stroke();
      }
    } else if (it.t === "seagrass") {
      ctx.strokeStyle = "#6fbf6a"; ctx.lineCap = "round";
      for (let i = -2; i <= 2; i++) {
        const sw = Math.sin(T * 1.1 + it.x * 0.01 + i) * k * 0.22;
        ctx.lineWidth = k * 0.07;
        ctx.beginPath(); ctx.moveTo(i * k * 0.13, k * 0.5);
        ctx.quadraticCurveTo(i * k * 0.16 + sw * 0.5, 0, i * k * 0.2 + sw, -k * 0.62); ctx.stroke();
      }
    } else if (it.t === "starfish") {
      ctx.fillStyle = "#ff9a4d";
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a2 = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? k * 0.2 : k * 0.52;
        const px = Math.cos(a2) * rr, py = Math.sin(a2) * rr * 0.85 + k * 0.2;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,220,160,0.7)";
      ctx.beginPath(); ctx.ellipse(0, k * 0.2, k * 0.13, k * 0.11, 0, 0, TAU); ctx.fill();
    } else {
      /* wreck */
      ctx.fillStyle = "#6b5a45";
      ctx.beginPath();
      ctx.moveTo(-k * 1.1, k * 0.35);
      ctx.quadraticCurveTo(0, k * 0.75, k * 1.1, k * 0.2);
      ctx.lineTo(k * 0.8, -k * 0.25);
      ctx.quadraticCurveTo(0, -k * 0.05, -k * 0.95, -k * 0.1);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#8a7358";
      ctx.lineWidth = k * 0.09;
      ctx.beginPath(); ctx.moveTo(-k * 0.2, -k * 0.15); ctx.lineTo(-k * 0.35, -k * 1.0); ctx.stroke();
    }
    ctx.restore();
  }

  drawCritters();
  drawBits();

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const vg = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.35, VW / 2, VH / 2, Math.max(VW, VH) * 0.8);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,10,18,0.45)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, VW, VH);
}

async function openVisitList() {
  const box = el("visitList");
  box.innerHTML = `<div class="rk2"><span></span><span></span><span class="nm">loading…</span><span></span><span></span></div>`;
  el("visitSheet").classList.remove("hide");
  try {
    const res = await fetch(`${API_BASE}/api/tanks?pid=${encodeURIComponent(pid)}`);
    const d = await res.json();
    const rows = (d && d.rows) || [];
    box.innerHTML = rows.length
      ? rows.map((r) => {
          const chip = r.flag && flagByCode(r.flag) ? `<img src="${flagURL(r.flag)}" alt="">` : "<span></span>";
          return `<div class="rk2" data-pid="${r.pid}" style="cursor:pointer"><span>${r.you ? "★" : "·"}</span>${chip}
            <span class="nm">${String(r.name).replace(/[<>&]/g, "")}</span>
            <span class="k">${r.items}</span><span class="p">visit</span></div>`;
        }).join("")
      : `<div class="rk2"><span></span><span></span><span class="nm">Nobody has built one yet. Be first.</span><span></span><span></span></div>`;
    for (const row of box.querySelectorAll("[data-pid]")) {
      row.addEventListener("click", async () => {
        const who = row.dataset.pid;
        el("visitSheet").classList.add("hide");
        TANKV.viewing = who === pid ? "" : who;
        await loadTank(who);
      });
    }
  } catch (e) {
    box.innerHTML = `<div class="rk2"><span></span><span></span><span class="nm">Tanks are offline in this build.</span><span></span><span></span></div>`;
  }
}

/* a small handle for tuning and automated checks */
window.RR = {
  G, cam, IN,
  get food() { return food; },
  get player() { return player; },
  get fishes() { return fishes; },
  get holes() { return holes; },
  get drops() { return drops; },
  get globs() { return globs; },
  PU, Wallet, ghosts, BALL, TANKS, VIP, BOSS,
  ARENA, SK, RING0, GAME, WORLD, skReset, skDown,
  get critters() { return critters; },
  get tank() { return TANK; },
  get game() { return GAME; },
  get team() { return myTeam; },
  shop: () => renderShop(),
  set mass(m) { player.mass = m; player.r = radiusOf(m); layoutSpine(player); },
};

/* ----------------------------------------------------------------- boot --- */
function begin() {
  Snd.unlock();
  const raw = (UI.name.value || "").trim().slice(0, 14) || "Little fish";
  G.rawName = raw;
  G.name = (Wallet.flag ? Wallet.flag + " " : "") + raw;
  PLAYER_SKIN = Wallet.skinDef();
  try { localStorage.setItem("rr_name", G.rawName); } catch (e) {}
  if (ARENA.on) {
    ARENA.entered = true;
    UI.start.classList.add("hide");
    UI.over.classList.add("hide");
    UI.hud.classList.add("on");
    const c = arenaClock();
    if (!c.live) banner("waiting for the whistle", mmss(c.left));
    ARENA.matchId = -1;   /* let stepArena drop us into the live match */
    ARENA.joined = false;
  } else {
    newRun(true);
    G.running = true;
    G.startedAt = T;
    clearPredatorsNear(player.x, player.y, player.r, ringSize() * 1.5);
    UI.start.classList.add("hide");
    UI.over.classList.add("hide");
    UI.hud.classList.add("on");
    banner("welcome to the reef", G.name);
  }
  if (wsReady) { try { ws.send(JSON.stringify({ type: "action", action: { t: "name", name: G.name } })); } catch (e) {} }
  push(true);
  renderBoard(null);
}

for (const b of document.querySelectorAll("#modePick .md")) {
  b.classList.toggle("on", b.dataset.mode === MODE);
  b.addEventListener("click", () => {
    if (b.dataset.mode === MODE) return;
    const q = new URLSearchParams(location.search);
    if (b.dataset.mode === "reef") q.delete("mode"); else q.set("mode", b.dataset.mode);
    location.search = q.toString();
  });
}
for (const b of document.querySelectorAll("#teamPick .tm")) {
  b.addEventListener("click", () => {
    myTeam = Number(b.dataset.team);
    Wallet.team = myTeam;
    Wallet.save();
    paintTeamUI();
  });
}
/** Leave whatever is going on and come back to the front door. */
function quitToMenu() {
  if (G.running && !G.dead && !ARENA.on) submitRun();
  G.running = false;
  G.dead = false;
  ARENA.entered = false;
  ARENA.joined = false;
  UI.over.classList.add("hide");
  UI.shop.classList.add("hide");
  UI.rankSheet.classList.add("hide");
  UI.hud.classList.remove("on");
  UI.start.classList.remove("hide");
  renderShop();
}
UI.quit.addEventListener("click", quitToMenu);
window.addEventListener("keydown", (e) => { if (e.code === "Escape") quitToMenu(); });
UI.cont.addEventListener("click", carryOn);
el("trade").addEventListener("click", () => {
  if (Wallet.gems < 1) return;
  Wallet.gems -= 1;
  Wallet.pearls += 250;
  Wallet.save();
  Snd.pickup();
  renderShop();
});
el("openranks").addEventListener("click", openRanks);
el("openranks2").addEventListener("click", openRanks);
el("ranksclose").addEventListener("click", () => UI.rankSheet.classList.add("hide"));
for (const t of document.querySelectorAll("#rtabs .tab")) {
  t.addEventListener("click", () => {
    for (const o of document.querySelectorAll("#rtabs .tab")) o.classList.remove("on");
    t.classList.add("on");
    rankWindow = t.dataset.w;
    UI.rwhen.textContent = { day: "today", week: "this week", month: "this month", all: "all time", arena: "arena · this week" }[rankWindow];
    UI.rnote.textContent = rankWindow === "arena"
      ? `${ARENA.on ? GAMEDEF.name : "Arena"} ladder — wins first, then best size, with kills alongside. Every game keeps its own ladder. The season closes and resets every Monday.`
      : "Best single run per player — humans only, the reef bots don't get a place here. Boards roll over at midnight UTC, Monday, and the 1st; nothing is deleted, the window just moves.";
    loadRanks();
  });
}
el("openshop").addEventListener("click", openShop);
el("openshop2").addEventListener("click", openShop);
el("shopclose").addEventListener("click", closeShop);
for (const t of document.querySelectorAll(".tab")) {
  t.addEventListener("click", () => {
    for (const o of document.querySelectorAll(".tab")) o.classList.remove("on");
    t.classList.add("on");
    shopTab = t.dataset.tab;
    renderShop();
  });
}
const hold = (id, on, off) => {
  const b = el(id);
  if (!b) return;
  const d = (e) => { e.preventDefault(); Snd.unlock(); on(); };
  b.addEventListener("touchstart", d, { passive: false });
  b.addEventListener("mousedown", d);
  if (off) { b.addEventListener("touchend", off); b.addEventListener("touchcancel", off); window.addEventListener("mouseup", off); }
};
hold("spitBtn", () => { IN.spit = true; }, () => { IN.spit = false; });
hold("netBtn", () => { IN.net = true; });
renderShop();

UI.play.addEventListener("click", begin);
UI.again.addEventListener("click", begin);
UI.name.addEventListener("keydown", (e) => { if (e.key === "Enter") begin(); });
UI.sound.addEventListener("click", () => {
  Snd.unlock();
  const m = Snd.toggle();
  UI.sound.textContent = m ? "✕" : "♪";
  UI.sound.style.opacity = m ? "0.45" : "1";
});
window.addEventListener("pointerdown", () => Snd.unlock(), { once: true });

try {
  let n = localStorage.getItem("rr_name");
  if (n) {
    /* repair names saved before the flag prefix was split out */
    let m = /^([A-Z]{2}) (.+)$/.exec(n);
    while (m && flagByCode(m[1])) { n = m[2]; m = /^([A-Z]{2}) (.+)$/.exec(n); }
    UI.name.value = n.slice(0, 14);
  }
  G.best = Number(localStorage.getItem("rr_best") || 0) || 0;
  if (G.best > 300000) { G.best = 0; localStorage.setItem("rr_best", "0"); }
} catch (e) {}
if (room !== "main") UI.link.textContent = `Reef “${room}” — anyone with this link shares your leaderboard.`;
if (Snd.muted) { UI.sound.textContent = "✕"; UI.sound.style.opacity = "0.45"; }

if (MODE === "tank") {
  document.body.classList.add("tank");
  UI.start.classList.add("hide");
  el("tankUI").classList.remove("hide");
  paintPalette();
  TANKV.viewing = params.get("visit") && params.get("visit") !== pid ? params.get("visit") : "";
  loadTank(TANKV.viewing || pid);
  el("tankSell").addEventListener("click", () => {
    TANKV.removing = !TANKV.removing;
    el("tankSell").classList.toggle("on", TANKV.removing);
    paintPalette();
  });
  el("zoomIn").addEventListener("click", () => tankZoom(1.35, VW / 2, VH / 2));
  el("zoomOut").addEventListener("click", () => tankZoom(1 / 1.35, VW / 2, VH / 2));
  el("zoomFit").addEventListener("click", () => {
    TANKV.zoom = 1; TANKV.camX = TANK_W / 2; TANKV.camY = TANK_H / 2;
  });
  el("tankFold").addEventListener("click", () => {
    const f = document.body.classList.toggle("folded");
    el("tankFold").textContent = f ? "▴" : "▾";
  });
  el("tankVisit").addEventListener("click", () => {
    if (TANKV.viewing) { TANKV.viewing = ""; loadTank(pid); return; }   /* first press: come home */
    openVisitList();
  });
  el("visitClose").addEventListener("click", () => {
    el("visitSheet").classList.add("hide");
    if (TANKV.viewing) { TANKV.viewing = ""; loadTank(pid); }
  });
  el("tankLeave").addEventListener("click", () => {
    if (TANKV.dirty) saveTank();
    const q = new URLSearchParams(location.search);
    q.delete("mode"); q.delete("visit");
    location.search = q.toString();
  });
  window.addEventListener("beforeunload", () => { if (TANKV.dirty) saveTank(); });
}
ARENA.on = MODE === "arena";
if (ARENA.on) {
  document.body.classList.add("arena");
  if (GAMEDEF.teams) {
    document.body.classList.add("hasteams");
    UI.teamPick.style.display = "";
  }
  renderGamePick();
  UI.play.textContent = "Enter the arena";
  const link = el("link");
  if (link) link.textContent = "Matches run every 5 minutes on the clock — everyone starts as a tadpole together.";
}
myTeam = Wallet.team >= 0 && Wallet.team <= 2 ? Wallet.team : autoTeam(pid);
paintTeamUI();
/* Settle VIP before the world is built, because the tank is chosen from the
   URL and a locked tank must not open just because someone typed its name.
   Raced against a short timeout so an unreachable API delays nobody. */
try {
  await Promise.race([refreshVip(), new Promise((r) => setTimeout(r, 2500))]);
} catch (e) {}
if (TANKS[TANK].vip && !VIP.on) TANK = "reef";
WORLD.w = TANKS[TANK].w;
WORLD.h = TANKS[TANK].h;
/* A sport is played on a pitch: small, empty of wildlife, and legible. */
if (ARENA.on && GAME === "football") { WORLD.w = 6400; WORLD.h = 3400; MAX_FISH = 0; MAX_FOOD = 26; }
if (ARENA.on && GAME === "volley")   { WORLD.w = 4600; WORLD.h = 3000; MAX_FISH = 0; MAX_FOOD = 18; }
/* A hundred fish, no plankton: nothing in this water is food. */
/* Three times the water. A hundred fish in 9,600 x 4,400 left barely a body
   length between them; this gives each roughly four times the room. */
if (ARENA.on && GAME === "deepstrike") { WORLD.w = 17600; WORLD.h = 7600; MAX_FISH = SK_FIELD - 1; MAX_FOOD = 0; }
renderTankPick();
buildScenery();
buildCritters();
resetBoss();
newRun(false);
connect();
renderBoard(null);

let last = performance.now();
let frameFailed = false;
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;
  try {
  if (dt > 0) {
    if (MODE === "tank") {
      stepTank(dt);
      drawTank();
      requestAnimationFrame(frame);
      return;
    }
    step(dt);
    render();
    hudTick += dt;
    if (hudTick > 0.1) {
      hudTick = 0;
      if (G.running || G.dead) syncHud();
      drawMap(player);
      boardTick += 0.1;
      if (boardTick > 0.5) { boardTick = 0; refreshBoard(); }
    }
    pushAt += dt;
    if (pushAt > 1.4) { pushAt = 0; if (G.running) push(false); }
    liveAt += dt;
    if (liveAt > 1 / LIVE_HZ) { liveAt = 0; sendLive(); }
  }
  } catch (e) {
    /* Any throw in a frame used to end the animation loop for good: the game
       froze with no way back but a reload. Report the first, keep going. */
    if (!frameFailed) { frameFailed = true; console.error("frame error (game continues):", e); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.addEventListener("visibilitychange", () => { last = performance.now(); });
