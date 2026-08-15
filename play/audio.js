// The browser head's audio graph, reached from C# through [JSImport].
//
// This is the half of web/js/audio.js that had to stay in JavaScript: the AudioContext, the
// nodes, and the shared noise buffer. Every frequency, envelope and time constant that used to
// sit alongside them now lives in EliteQuest.Core.Audio — so what is left here is a node
// factory and nothing that decides how anything sounds.
//
// Nodes are handed to C# as integer handles into `nodes`. An AudioNode cannot cross the
// boundary cheaply and does not need to: the game only ever names one to connect or automate
// it, and a laser shot is five nodes and about twenty calls.

let ctx = null;
let master = null;
let noiseBuf = null;

// Indices 0 and 1 are reserved for the master gain and the side bus, which exist for the whole
// session and are the two handles C# holds without being told them.
const nodes = [null, null];
const free = [];

function put(node) {
  const i = free.length ? free.pop() : nodes.length;
  nodes[i] = node;
  if (voice) voice.handles.push(i);
  return i;
}

// ---- context ----

export function unlock() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;                       // no Web Audio: the game simply runs silent
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    nodes[0] = master;

    // The side bus. Web Audio has a StereoPanner but no middle-and-side encoder, and a panner is
    // per-node where this is one bus every positioned voice shares — so it is built from what
    // there is: the same signal into two gains of +1 and -1, merged as left and right. Anything
    // sent here is added to one channel and taken from the other, which is what a side signal is.
    const side = ctx.createGain();
    const seats = ctx.createChannelMerger(2);
    for (const [channel, sign] of [[0, 1], [1, -1]]) {
      const arm = ctx.createGain();
      arm.gain.value = sign;
      side.connect(arm);
      arm.connect(seats, 0, channel);
    }
    seats.connect(master);
    nodes[1] = side;

    // One second of white noise, generated once and reused by every effect that needs it.
    // Looping a single buffer is far cheaper than building a fresh one per laser shot.
    const n = Math.floor(ctx.sampleRate);
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume();
}

export function created() { return ctx !== null; }

export function running() { return ctx !== null && ctx.state === "running"; }

export function now() { return ctx ? ctx.currentTime : 0; }

// A meter on the master, so the head can say whether it is making a sound rather than whether it
// believes it should be.
//
// "Is there audio in the browser build" is not answered by created() and running(). A context can
// be running with every node correctly wired and still emit silence — a gain left at zero, an
// envelope that never fired, a bus that reaches nothing. Those are exactly the faults worth
// catching, and the only way to tell them from a working mix is to read the output back.
//
// An AnalyserNode is the one node that measures without changing what is heard: it passes its
// input through, and here its output is left unconnected, so this is a tap on the master rather
// than a link in the chain. Made on first use, because a build nobody meters should not pay for it.
//
// Returns RMS over the last 2048 samples — about 43 ms, long enough not to land inside a single
// zero crossing and short enough to still be current. -1 means there is no context to measure.
let meter = null, meterFrame = null;

export function level() {
    if (!ctx) return -1;

    if (!meter) {
        meter = ctx.createAnalyser();
        meter.fftSize = 2048;
        meterFrame = new Float32Array(meter.fftSize);
        master.connect(meter);
    }

    meter.getFloatTimeDomainData(meterFrame);

    let sum = 0;
    for (let i = 0; i < meterFrame.length; i++) sum += meterFrame[i] * meterFrame[i];
    return Math.sqrt(sum / meterFrame.length);
}

// One-shot effects stop on their own, but the ambient beds run continuously — so a backgrounded
// tab would keep droning. Suspend the whole context instead, which also saves the wakeups.
// `autoSuspended` makes sure we never resume a context the game itself paused.
let autoSuspended = false;
globalThis.document?.addEventListener("visibilitychange", () => {
  if (!ctx) return;
  if (globalThis.document.hidden && ctx.state === "running") {
    autoSuspended = true;
    ctx.suspend();
  } else if (!globalThis.document.hidden && autoSuspended) {
    autoSuspended = false;
    ctx.resume();
  }
});

// ---- nodes ----

export function osc(wave) {
  if (!ctx) return -1;
  const n = ctx.createOscillator();
  n.type = wave;
  return put(n);
}

export function gain() {
  return ctx ? put(ctx.createGain()) : -1;
}

export function biquad(kind) {
  if (!ctx) return -1;
  const n = ctx.createBiquadFilter();
  n.type = kind;
  return put(n);
}

export function noise() {
  if (!ctx) return -1;
  const n = ctx.createBufferSource();
  n.buffer = noiseBuf;
  n.loop = true;
  return put(n);
}

// ---- parameters ----
//
// `which` is the AudioParam's own property name — "frequency", "detune", "gain" or "Q" — so
// there is no lookup table here to fall out of step with the one in C#.

const param = (handle, which) => {
  const n = nodes[handle];
  return n ? n[which] : null;
};

export function set(handle, which, value) {
  const p = param(handle, which);
  if (p) p.value = value;
}

export function setAt(handle, which, value, when) {
  const p = param(handle, which);
  if (p) p.setValueAtTime(value, when);
}

export function expTo(handle, which, value, when) {
  const p = param(handle, which);
  if (p) p.exponentialRampToValueAtTime(value, when);
}

export function linTo(handle, which, value, when) {
  const p = param(handle, which);
  if (p) p.linearRampToValueAtTime(value, when);
}

export function target(handle, which, value, when, tau) {
  const p = param(handle, which);
  if (p) p.setTargetAtTime(value, when, tau);
}

// ---- wiring ----

export function connect(from, to) {
  const a = nodes[from], b = nodes[to];
  if (a && b) a.connect(b);
}

export function connectParam(from, to, which) {
  const a = nodes[from], p = param(to, which);
  if (a && p) a.connect(p);
}

export function start(handle, when) {
  const n = nodes[handle];
  if (!n) return;
  n.start(when);
  if (voice) voice.sources.push(n);
}

export function stop(handle, when) {
  const n = nodes[handle];
  if (n) n.stop(when);
}

// ---- voices ----
//
// The original needs none of this: a laser's five nodes are unreachable the moment the function
// that made them returns, and the graph holds them alive until the sources end. A handle table
// has no such moment — `nodes` would grow by five per shot forever — so C# brackets each
// one-shot and the handles inside it are recycled once every source in it has ended.
//
// The ambient beds are built outside a voice and so are never recycled, which is correct: C#
// holds their gain handles for the life of the session and ramps them on every mood change.

let voice = null;

export function beginVoice() {
  voice = { handles: [], sources: [] };
}

export function endVoice() {
  const v = voice;
  voice = null;
  if (!v || v.handles.length === 0) return;

  const release = () => {
    for (const i of v.handles) {
      nodes[i] = null;
      free.push(i);
    }
  };

  // A voice with no source cannot end, so there would be nothing to wait for. That does not
  // happen — every effect starts something — but leaking on it would be silent and cumulative.
  let pending = v.sources.length;
  if (pending === 0) return release();
  for (const src of v.sources) {
    src.onended = () => { if (--pending === 0) release(); };
  }
}
