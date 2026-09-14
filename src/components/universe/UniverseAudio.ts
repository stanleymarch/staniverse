import type { GraphNode } from "../../lib/graph";

/**
 * Smoothed snapshot of the generative score, ready for a HUD visualiser.
 * The object is reused by every `update` call: read the fields in place and never keep
 * the reference, because the next frame mutates it.
 */
export interface AudioVisualState {
  /** 0..1 loudness the graph is heading for, paced for a meter rather than a waveform. */
  energy: number;
  /** Stable theme token of the selected node, e.g. `ember`; styled through `data-theme`. */
  theme: string;
  /** Whether the visitor opted into sound. */
  enabled: boolean;
}

interface ThemeSpec {
  /** Stable token handed to the HUD. */
  id: string;
  /** Semitone offsets from the theme root: one octave plus the colour tones above it. */
  scale: number[];
  /** Root frequency of the theme in Hz. */
  root: number;
  /** Oscillator shape per voice, low voice first. */
  waves: OscillatorType[];
  /** Relative low-pass openness, 0..1. */
  brightness: number;
  /** Peak micro-detune depth in cents. */
  drift: number;
  /** Relative amount of filtered noise air, 0..1. */
  air: number;
  /** Relative tremolo depth, 0..1. */
  pulse: number;
}

interface Voice {
  oscillator: OscillatorNode;
  gain: GainNode;
  /** Depth, in cents, of the shared drift LFO. */
  drift: GainNode;
  /** Base level before the proximity gate is applied. */
  level: number;
  /** Detail at which the voice becomes audible; the lowest voice always sounds. */
  gate: number;
  octave: number;
  /** Index into the current chord shape. */
  slot: number;
}

type AudioContextConstructor = new () => AudioContext;

/** Five voices, one low pedal and four chord tones: theme changes retune, never rebuild. */
const VOICE_LEVELS = [0.26, 0.23, 0.19, 0.14, 0.1];
const VOICE_GATES = [0, 0.04, 0.3, 0.52, 0.74];
const VOICE_OCTAVES = [-12, 0, 0, 12, 12];
const VOICE_SLOTS = [0, 0, 1, 2, 3];
const VOICE_DRIFT = [0.45, 0.7, 1, 1.05, 1.25];

/**
 * Chord shapes as scale-degree indices. Walking the list is the progression: the first
 * degree carries the bass, the rest is stacked above it, always inside the theme scale.
 */
const CHORD_SHAPES = [
  [0, 2, 4, 6],
  [2, 4, 6, 1],
  [4, 6, 1, 3],
  [1, 3, 5, 0],
  [3, 5, 0, 2],
];

const THEME_SPECS = {
  aurora: {
    id: "aurora",
    scale: [0, 2, 4, 7, 9, 12, 14],
    root: 130.81,
    waves: ["sine", "triangle", "sine", "triangle", "sine"],
    brightness: 0.86,
    drift: 10,
    air: 0.85,
    pulse: 0.48,
  },
  ember: {
    id: "ember",
    scale: [0, 2, 3, 5, 7, 10, 12],
    root: 116.54,
    waves: ["sine", "triangle", "triangle", "sine", "triangle"],
    brightness: 0.52,
    drift: 14,
    air: 0.42,
    pulse: 0.72,
  },
  tide: {
    id: "tide",
    scale: [0, 2, 3, 5, 7, 9, 12],
    root: 146.83,
    waves: ["sine", "sine", "triangle", "sine", "sine"],
    brightness: 0.66,
    drift: 9,
    air: 0.72,
    pulse: 0.6,
  },
  lattice: {
    id: "lattice",
    scale: [0, 2, 4, 6, 7, 9, 11],
    root: 123.47,
    waves: ["sine", "sine", "sine", "triangle", "sine"],
    brightness: 0.92,
    drift: 12,
    air: 0.9,
    pulse: 0.4,
  },
  veil: {
    id: "veil",
    scale: [0, 1, 3, 5, 7, 8, 10],
    root: 110.0,
    waves: ["sine", "triangle", "sine", "sine", "triangle"],
    brightness: 0.44,
    drift: 16,
    air: 0.5,
    pulse: 0.66,
  },
  quarry: {
    id: "quarry",
    scale: [0, 2, 4, 5, 7, 9, 10],
    root: 98.0,
    waves: ["sine", "triangle", "triangle", "triangle", "sine"],
    brightness: 0.6,
    drift: 11,
    air: 0.55,
    pulse: 0.58,
  },
} satisfies Record<string, ThemeSpec>;

/** Node kinds orbit a small deterministic family of themes; topics pick the exact one. */
const KIND_THEMES: Record<string, ThemeSpec[]> = {
  work: [THEME_SPECS.ember, THEME_SPECS.quarry, THEME_SPECS.tide],
  project: [THEME_SPECS.aurora, THEME_SPECS.lattice],
  article: [THEME_SPECS.veil, THEME_SPECS.tide],
  topic: [THEME_SPECS.lattice, THEME_SPECS.aurora],
  "telegram-post": [THEME_SPECS.veil, THEME_SPECS.quarry],
  "telegram-article": [THEME_SPECS.veil, THEME_SPECS.tide],
  "youtube-video": [THEME_SPECS.ember, THEME_SPECS.lattice],
  video: [THEME_SPECS.ember, THEME_SPECS.aurora],
};
const ALL_THEMES: ThemeSpec[] = [
  THEME_SPECS.aurora,
  THEME_SPECS.ember,
  THEME_SPECS.tide,
  THEME_SPECS.lattice,
  THEME_SPECS.veil,
  THEME_SPECS.quarry,
];

function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value;
}

/** Eased 0..1 ramp between two detail thresholds: the shape voice fades use. */
function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** FNV-1a, the world's seed shape, so content and sound always pick the same way. */
function hash(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** Automation only: an abrupt `value` assignment would click. */
function ramp(param: AudioParam, value: number, timeConstant: number, now: number) {
  if (!Number.isFinite(value)) return;
  param.setTargetAtTime(value, now, timeConstant);
}

function prefersCalm() {
  const query = typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia("(prefers-reduced-motion: reduce)")
    : undefined;
  return query?.matches ?? false;
}

/** Deterministic noise for the air layer: generated once, never fetched. */
function noiseBuffer(context: AudioContext, seconds: number, seed: number) {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[index] = state / 2147483648 - 1;
  }
  return buffer;
}

/**
 * Generative score for the universe route: a fixed, small Web Audio graph that is retuned
 * and re-filtered instead of re-populated. Selecting a node picks a deterministic scale,
 * root and timbre from its kind and topics; proximity opens the chord, the low-pass, the
 * stereo width and the tremolo, so approaching a node becomes denser while retreating thins
 * out to a bare pedal. The context is only built after the visitor opts in, and every
 * lifecycle call is safe to repeat.
 */
export class GenerativeUniverseAudio {
  private context?: AudioContext;
  private gate?: GainNode;
  private tone?: BiquadFilterNode;
  private pulse?: GainNode;
  private pulseDepth?: GainNode;
  private pulseLfo?: OscillatorNode;
  private noiseGain?: GainNode;
  private noiseFilter?: BiquadFilterNode;
  private wet: GainNode[] = [];
  private pan: Array<StereoPannerNode | undefined> = [];
  private feedback: GainNode[] = [];
  private voices: Voice[] = [];
  private sources: Array<OscillatorNode | AudioBufferSourceNode> = [];

  private spec: ThemeSpec = THEME_SPECS.aurora;
  private root = THEME_SPECS.aurora.root;
  private themeKey = "";
  private shapeIndex = 0;
  private nextBarAt = 0;
  private detail = 0;
  private motion = 0;
  private energy = 0;
  private lastFrame = 0;
  private calm = false;
  private enabled = false;
  private disposed = false;
  private swapping = false;
  private appliedDetail = -1;
  private appliedMotion = -1;
  private swapTimer: number | undefined;
  private suspendTimer: number | undefined;
  private queue: Promise<void> = Promise.resolve();
  private readonly state: AudioVisualState = { energy: 0, theme: THEME_SPECS.aurora.id, enabled: false };

  /**
   * Opt in or out of sound. Only this call may build the graph, so nothing sounds before
   * the visitor asks for it. Resolves with the resulting enabled state.
   */
  async toggle(): Promise<boolean> {
    if (this.disposed) return false;
    return this.enqueue(async () => {
      if (this.disposed) return false;
      if (!this.ensure()) return false;
      if (!this.enabled) {
        if (!(await this.start())) return false;
        this.enabled = true;
        return true;
      }
      this.enabled = false;
      this.stop();
      return false;
    });
  }

  /**
   * Point the score at a node. Kind and topics choose the theme deterministically, so the
   * same node always sounds the same while a different selection glides to a new harmony.
   */
  select(node: GraphNode) {
    if (this.disposed) return;
    const topics = [...(node.topics ?? [])].sort().join(",");
    const kind = node.kind ?? "";
    const family = KIND_THEMES[kind] ?? ALL_THEMES;
    const spec = family[hash(`${kind}|${topics}`) % family.length];
    // Topics nudge the root by up to two semitones: same theme, different register.
    const shift = (hash(`root|${topics}`) % 5) - 2;
    const key = `${spec.id}|${shift}`;
    if (key === this.themeKey) return;
    this.themeKey = key;
    this.spec = spec;
    this.root = spec.root * Math.pow(2, shift / 12);
    this.shapeIndex = hash(`${spec.id}|${topics}`) % CHORD_SHAPES.length;

    const context = this.context;
    if (!context) return;
    const now = context.currentTime;
    // Harmony glides straight away; the oscillator shapes swap under a short fade.
    this.glide(now, 1.1);
    if (this.enabled) {
      this.swapTimbre(now);
      this.nextBarAt = now + this.barSeconds();
    }
  }

  /**
   * Per-frame driver. `distance` is the distance to the selected node, 0 at the node itself;
   * values above 1 are compressed, so metric callers stay monotone. `motion` is travel intent
   * 0..1. Returns the shared smoothed snapshot for the HUD.
   */
  update(distance: number, motion: number): AudioVisualState {
    const now = performance.now() / 1000;
    const step = clamp(now - this.lastFrame, 0, 0.25);
    this.lastFrame = now;

    const raw = Number.isFinite(distance) ? Math.max(0, distance) : 1;
    const proximity = 1 - clamp(raw <= 1 ? raw : 1 - 1 / (1 + raw), 0, 1);
    const pace = clamp(Number.isFinite(motion) ? motion : 0, 0, 1);

    // Frame-rate independent smoothing: the ear should not hear the frame budget.
    this.detail += (proximity - this.detail) * (1 - Math.exp(-step / 0.22));
    this.motion += (pace - this.motion) * (1 - Math.exp(-step / 0.3));

    const detail = this.detail;
    const target = this.enabled ? clamp(0.6 * detail + 0.4 * detail * this.motion, 0, 1) : 0;
    this.energy += (target - this.energy) * (1 - Math.exp(-step / (target > this.energy ? 0.35 : 0.7)));

    const context = this.context;
    if (context && this.enabled) {
      this.advance(context.currentTime);
      this.apply(context.currentTime);
    }

    this.state.energy = this.energy;
    this.state.theme = this.spec.id;
    this.state.enabled = this.enabled;
    return this.state;
  }

  /** Tab hidden or XR session blurred: sounding stops, the visitor's intent is preserved. */
  async interrupt(): Promise<void> {
    if (this.disposed) return;
    const context = this.context;
    if (!context || context.state !== "running") return;
    try {
      await context.suspend();
    } catch {
      /* the browser keeps the context suspended on its own terms */
    }
  }

  /** Resume only after an interruption, and only when sound was explicitly asked for. */
  async resumeIfEnabled(): Promise<void> {
    if (this.disposed || !this.enabled) return;
    const context = this.context;
    if (!context || context.state === "running") return;
    try {
      await context.resume();
    } catch {
      return; // stays suspended until the next user gesture
    }
    if (this.disposed || !this.enabled || this.context !== context) return;
    this.nextBarAt = context.currentTime + this.barSeconds();
    this.appliedDetail = -1;
    this.apply(context.currentTime);
  }

  /** Stop every source, drop the timers and close the context. Safe to call repeatedly. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.clearTimers();
    this.sources.forEach((source) => {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      source.disconnect();
    });
    this.sources = [];
    this.voices = [];
    this.wet = [];
    this.pan = [];
    this.feedback = [];
    this.gate = undefined;
    this.tone = undefined;
    this.pulse = undefined;
    this.pulseDepth = undefined;
    this.pulseLfo = undefined;
    this.noiseGain = undefined;
    this.noiseFilter = undefined;
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private clearTimers() {
    window.clearTimeout(this.swapTimer);
    this.swapTimer = undefined;
    window.clearTimeout(this.suspendTimer);
    this.suspendTimer = undefined;
  }

  /** Builds the whole graph once. Every later change is automation on these nodes. */
  private ensure() {
    if (this.context) return true;
    const scope = globalThis as {
      AudioContext?: AudioContextConstructor;
      webkitAudioContext?: AudioContextConstructor;
    };
    const Constructor = scope.AudioContext ?? scope.webkitAudioContext;
    if (!Constructor) return false;
    let context: AudioContext;
    try {
      context = new Constructor();
    } catch {
      return false;
    }
    this.calm = prefersCalm();
    this.context = context;

    // Voice input. Nothing here is ever created again: the graph is tuned, not rebuilt.
    const bus = context.createGain();
    bus.gain.value = 1;

    // Rhythm: a tremolo instead of scheduled notes, so the node count stays fixed.
    const pulse = context.createGain();
    pulse.gain.value = 0.9;
    const pulseDepth = context.createGain();
    pulseDepth.gain.value = 0.1;
    const pulseLfo = context.createOscillator();
    pulseLfo.type = "sine";
    pulseLfo.frequency.value = 0.3;
    pulseLfo.connect(pulseDepth).connect(pulse.gain);

    const tone = context.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 700;
    tone.Q.value = 0.9;

    bus.connect(pulse).connect(tone);

    // Air: one looping noise source through a band-pass, the only non-oscillator voice.
    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer(context, 0.75, hash("universe-air"));
    noise.loop = true;
    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 1400;
    noiseFilter.Q.value = 0.7;
    const noiseGain = context.createGain();
    noiseGain.gain.value = 0;
    noise.connect(noiseFilter).connect(noiseGain).connect(bus);

    // Width: two damped delays panned apart in proportion to proximity. They feed the sum
    // directly, so the only loop in the graph is each delay's own feedback.
    const sum = context.createGain();
    sum.gain.value = 1;
    tone.connect(sum);
    for (const [index, seconds] of [0.17, 0.235].entries()) {
      const delay = context.createDelay(0.6);
      delay.delayTime.value = seconds;
      const feedback = context.createGain();
      feedback.gain.value = 0.3;
      const wet = context.createGain();
      wet.gain.value = 0;
      const pan = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : undefined;
      if (pan) pan.pan.value = index === 0 ? -0.2 : 0.2;
      tone.connect(delay);
      delay.connect(feedback).connect(delay);
      if (pan) delay.connect(pan).connect(wet).connect(sum);
      else delay.connect(wet).connect(sum);
      this.feedback.push(feedback);
      this.wet.push(wet);
      this.pan.push(pan);
    }

    const master = context.createGain();
    master.gain.value = 0.18;
    const gate = context.createGain();
    gate.gain.value = 0;
    // Safety net: five voices plus air can stack, the listener should never hear clipping.
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -16;
    limiter.knee.value = 12;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.01;
    limiter.release.value = 0.32;
    sum.connect(master).connect(gate).connect(limiter).connect(context.destination);

    // Harmony: one shared drift LFO with per-voice depths, plus a static detune spread so
    // the partials beat slowly against each other instead of sitting still.
    const driftLfo = context.createOscillator();
    driftLfo.type = "sine";
    driftLfo.frequency.value = 0.043;

    this.voices = VOICE_LEVELS.map((level, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = this.spec.waves[index];
      oscillator.detune.value = this.spec.drift * (index - 2) * 0.6;
      const drift = context.createGain();
      drift.gain.value = 0;
      driftLfo.connect(drift).connect(oscillator.detune);
      const gain = context.createGain();
      gain.gain.value = 0;
      oscillator.connect(gain).connect(bus);
      return {
        oscillator,
        gain,
        drift,
        level,
        gate: VOICE_GATES[index],
        octave: VOICE_OCTAVES[index],
        slot: VOICE_SLOTS[index],
      };
    });

    this.gate = gate;
    this.tone = tone;
    this.pulse = pulse;
    this.pulseDepth = pulseDepth;
    this.pulseLfo = pulseLfo;
    this.noiseGain = noiseGain;
    this.noiseFilter = noiseFilter;
    this.sources = [pulseLfo, driftLfo, noise, ...this.voices.map((voice) => voice.oscillator)];
    this.sources.forEach((source) => source.start());

    // Still silent here, so the opening chord needs no glide and no fade.
    this.glide(context.currentTime, 0.06);
    this.appliedDetail = -1;
    this.apply(context.currentTime);
    return true;
  }

  /** Opens the gate after a successful resume. */
  private async start(): Promise<boolean> {
    const context = this.context;
    if (!context) return false;
    this.calm = prefersCalm();
    try {
      if (context.state !== "running") await context.resume();
    } catch {
      return false;
    }
    if (this.disposed || this.context !== context || context.state === "closed") return false;

    window.clearTimeout(this.suspendTimer);
    this.suspendTimer = undefined;
    const now = context.currentTime;
    this.nextBarAt = now + this.barSeconds();
    this.glide(now, 0.06);
    this.swapTimbre(now);
    this.appliedDetail = -1;
    this.apply(now);
    const gate = this.gate;
    if (gate) {
      gate.gain.cancelScheduledValues(now);
      gate.gain.setValueAtTime(gate.gain.value, now);
      gate.gain.linearRampToValueAtTime(1, now + 0.6);
    }
    return true;
  }

  /** Closes the gate, then parks the context to keep idle tabs cheap. */
  private stop() {
    const context = this.context;
    if (!context) return;
    this.swapping = false;
    this.clearTimers();
    const now = context.currentTime;
    const gate = this.gate;
    if (gate) {
      gate.gain.cancelScheduledValues(now);
      gate.gain.setValueAtTime(gate.gain.value, now);
      gate.gain.linearRampToValueAtTime(0, now + 0.22);
    }
    // Suspend only after the fade: cutting a running graph would click.
    this.suspendTimer = window.setTimeout(() => {
      this.suspendTimer = undefined;
      const parked = this.context;
      if (!parked || this.enabled || parked.state !== "running") return;
      void parked.suspend().catch(() => undefined);
    }, 300);
  }

  /** Harmonic detail spread across the voices: retreating thins the chord to one pedal. */
  private apply(now: number) {
    const detailStep = Math.round(this.detail * 96);
    const motionStep = Math.round(this.motion * 48);
    if (detailStep === this.appliedDetail && motionStep === this.appliedMotion) return;
    this.appliedDetail = detailStep;
    this.appliedMotion = motionStep;

    const detail = detailStep / 96;
    const motion = motionStep / 48;
    const spec = this.spec;
    const calm = this.calm;

    if (this.tone) {
      const openness = 0.7 + 0.3 * spec.brightness;
      ramp(this.tone.frequency, clamp(600 + 3400 * Math.pow(detail, 1.25) * openness, 420, 6200), 0.35, now);
    }

    if (this.pulseLfo && this.pulseDepth && this.pulse) {
      const depth = clamp(
        (0.05 + 0.3 * detail) * spec.pulse * (calm ? 0.35 : 1) * (0.85 + 0.15 * motion),
        0,
        0.42,
      );
      ramp(this.pulseLfo.frequency, clamp(0.24 + detail + 0.5 * motion, 0.2, 2.2), 0.5, now);
      ramp(this.pulseDepth.gain, depth, 0.4, now);
      ramp(this.pulse.gain, 1 - depth * 0.85, 0.4, now);
    }

    if (this.noiseGain && this.noiseFilter) {
      const air = spec.air * (0.03 + 0.13 * Math.pow(detail, 1.6)) * (calm ? 0.6 : 1);
      ramp(this.noiseGain.gain, air, 0.4, now);
      ramp(this.noiseFilter.frequency, 900 + 4200 * detail, 0.5, now);
    }

    const width = detail * (calm ? 0.6 : 1);
    for (let index = 0; index < this.wet.length; index += 1) {
      const first = index === 0;
      ramp(this.wet[index].gain, first ? 0.06 + 0.26 * width : 0.07 + 0.28 * width, 0.5, now);
      ramp(this.feedback[index].gain, first ? 0.24 + 0.16 * width : 0.22 + 0.16 * width, 0.6, now);
      const pan = this.pan[index];
      if (pan) ramp(pan.pan, first ? -(0.18 + 0.62 * width) : 0.18 + 0.62 * width, 0.6, now);
    }

    if (this.swapping) return; // the timbre swap owns the voice gains for a moment
    for (let index = 0; index < this.voices.length; index += 1) {
      const voice = this.voices[index];
      const gate = index === 0 ? 1 : smoothstep(voice.gate, voice.gate + 0.22, detail);
      const lift = 1 + (index === 0 ? 0.04 : 0.12) * motion * detail;
      ramp(voice.gain.gain, voice.level * gate * lift, index === 0 ? 0.5 : 0.3, now);
      ramp(voice.drift.gain, detail * spec.drift * VOICE_DRIFT[index] * (calm ? 0.5 : 1), 0.5, now);
    }
  }

  /** Walks the chord progression in context time; closer nodes move a little faster. */
  private advance(now: number) {
    const bar = this.barSeconds();
    // A bar scheduled at the far edge shrinks as the visitor arrives, but never stretches.
    if (this.nextBarAt === 0 || this.nextBarAt > now + bar) this.nextBarAt = now + bar;
    if (now < this.nextBarAt) return;
    this.shapeIndex = (this.shapeIndex + 1) % CHORD_SHAPES.length;
    this.glide(now, 0.55);
    this.nextBarAt = now + bar;
  }

  private barSeconds() {
    return clamp((9.5 - 5 * this.detail) * (1 - 0.18 * this.motion), 3.5, 9.5);
  }

  /** Retunes every voice to the current chord shape inside the theme scale. */
  private glide(now: number, timeConstant: number) {
    const shape = CHORD_SHAPES[this.shapeIndex % CHORD_SHAPES.length];
    const scale = this.spec.scale;
    this.voices.forEach((voice) => {
      const degree = shape[voice.slot % shape.length];
      const semitone = scale[((degree % scale.length) + scale.length) % scale.length];
      const frequency = this.root * Math.pow(2, (semitone + voice.octave) / 12);
      ramp(voice.oscillator.frequency, clamp(frequency, 20, 12000), timeConstant, now);
    });
  }

  /**
   * An oscillator switches waveform at its current phase, so the swap has to happen while
   * the voice is silent: fade out, change shape, let the next `apply` bring levels back.
   */
  private swapTimbre(now: number) {
    if (this.swapping) return;
    const waves = this.spec.waves;
    if (this.voices.every((voice, index) => voice.oscillator.type === waves[index])) return;
    this.swapping = true;
    this.voices.forEach((voice) => {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, 0.045);
    });
    window.clearTimeout(this.swapTimer);
    this.swapTimer = window.setTimeout(() => {
      this.swapTimer = undefined;
      const context = this.context;
      if (this.disposed || !context) return;
      // Read the live spec: a selection during the fade must win, not the stale one.
      this.voices.forEach((voice, index) => {
        voice.oscillator.type = this.spec.waves[index];
      });
      this.swapping = false;
      this.appliedDetail = -1;
      this.apply(context.currentTime);
    }, 220);
  }
}
