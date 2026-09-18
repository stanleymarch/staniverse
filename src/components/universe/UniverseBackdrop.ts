import type { BufferGeometry, Group, Object3D, ShaderMaterial } from "three";
import type { ThreeModule } from "./UniverseWorld";

/**
 * FNV-1a + mulberry32: the same content hash the graph layout uses, so every
 * seeded value in the universe is reproducible from text alone.
 */
export function seeded(seedText: string) {
  let seed = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed += 0x6d2b79f5;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pixel footprint of one world-space unit at one world-space unit of depth. */
export interface PointViewport {
  pixelRatio: number;
  scale: number;
}

export function pointViewport(): PointViewport {
  if (typeof window === "undefined") return { pixelRatio: 1, scale: 360 };
  return {
    pixelRatio: window.devicePixelRatio || 1,
    scale: Math.max(window.innerHeight, 320) * .5,
  };
}

/**
 * Photospheric tints, cool to hot. Every star keeps the hue of what it stands for and
 * borrows a temperature from this ramp, so a field of stars reads as a real sky instead
 * of one repeated white dot.
 */
export const SPECTRAL_TINTS = [0xffc9a0, 0xffe0b8, 0xfff6e4, 0xe8f0ff, 0xc2d8ff, 0x9fc0ff] as const;

export interface PointCloudAttributes {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  phases: Float32Array;
  twinkles: Float32Array;
  /** Per-star diffraction strength: 0 keeps dust and nebulae soft, 1 gives a star its flares. */
  spikes: Float32Array;
}

/** Buffers for one point cloud: position, colour, world size, twinkle phase, depth and flares. */
export function pointCloudAttributes(count: number): PointCloudAttributes {
  return {
    positions: new Float32Array(count * 3),
    colors: new Float32Array(count * 3),
    sizes: new Float32Array(count),
    phases: new Float32Array(count),
    twinkles: new Float32Array(count),
    spikes: new Float32Array(count),
  };
}

export function pointCloudGeometry(THREE: ThreeModule, attributes: PointCloudAttributes): BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(attributes.positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(attributes.colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(attributes.sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(attributes.phases, 1));
  geometry.setAttribute("aTwinkle", new THREE.BufferAttribute(attributes.twinkles, 1));
  geometry.setAttribute("aSpikes", new THREE.BufferAttribute(attributes.spikes, 1));
  return geometry;
}

export interface PointCloudStyle {
  /** Corona falloff exponent: larger values hold the halo closer to the core. */
  softness: number;
  /** Core falloff exponent: larger values make a tighter, hotter centre. */
  core: number;
  opacity: number;
  additive: boolean;
  /** Device-pixel cap for one sprite: stars stay specks, nebulae are allowed to spread. */
  maxSize?: number;
  /** Broad irregular gas profile instead of a point-source diffraction profile. */
  nebula?: boolean;
}

/**
 * Point-source shader with two deliberate profiles. Stars use a compact Airy core and narrow
 * diffraction rays, never a filled disc; nebulae use a warped low-frequency envelope so their
 * large quads read as gas rather than oversized stars.
 */
const POINT_VERTEX_SHADER = `
  attribute vec3 color;
  attribute float aSize;
  attribute float aPhase;
  attribute float aTwinkle;
  attribute float aSpikes;
  uniform float uPixelRatio;
  uniform float uScale;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uMaxSize;
  varying vec3 vColor;
  varying float vBrightness;
  varying float vSpikes;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float twinkle = 1.0 + aTwinkle * 0.26 * sin(uTime * (0.55 + aPhase) + aPhase * 39.4784) * step(0.0001, uTime);
    float pulse = uEnergy * (0.6 + 0.4 * sin(uTime * 2.7 + aPhase * 6.2832));
    vColor = color;
    vSpikes = aSpikes;
    vBrightness = twinkle * (1.0 + 0.7 * pulse);
    float depth = max(-mvPosition.z, 0.02);
    gl_PointSize = clamp(aSize * uPixelRatio * uScale / depth * (1.0 + 0.5 * pulse), 1.25, uMaxSize);
    #include <fog_vertex>
  }
`;

const POINT_FRAGMENT_SHADER = `
  uniform float uOpacity;
  uniform float uSoftness;
  uniform float uCore;
  uniform float uNebula;
  varying vec3 vColor;
  varying float vBrightness;
  varying float vSpikes;
  #include <fog_pars_fragment>
  void main() {
    vec2 offset = gl_PointCoord - vec2(0.5);
    float radius = length(offset) * 2.0;
    float angle = atan(offset.y, offset.x);
    float alpha;
    vec3 colour;
    if (uNebula > 0.5) {
      float contour = 1.0 + 0.11 * sin(angle * 3.0 + 1.7) + 0.065 * sin(angle * 7.0 - 0.8);
      float cloud = pow(max(0.0, 1.0 - radius / contour), uSoftness);
      float filament = 0.72 + 0.28 * sin(offset.x * 15.0 + sin(offset.y * 11.0) * 1.8);
      alpha = cloud * filament * uOpacity;
      colour = vColor * (0.42 + cloud * 0.72) * vBrightness;
    } else {
      if (radius > 1.0) discard;
      float photosphere = exp(-radius * radius * uCore * 3.2);
      float halo = exp(-radius * 8.5) * 0.16;
      float airy = exp(-pow((radius - 0.27) * 19.0, 2.0)) * 0.075;
      vec2 arms = abs(offset);
      float cross = exp(-min(arms.x, arms.y) * 115.0) * exp(-max(arms.x, arms.y) * 4.2);
      float diagonal = exp(-abs(arms.x - arms.y) * 92.0) * exp(-(arms.x + arms.y) * 5.5);
      float flares = (cross + diagonal * 0.18) * vSpikes;
      alpha = clamp(photosphere + halo + airy * vSpikes + flares, 0.0, 1.0) * uOpacity;
      colour = vColor * (0.42 + 1.18 * photosphere + 0.42 * flares) * vBrightness;
    }
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(colour, alpha);
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Star/nebula material: one program, one uniform set per cloud, fog integrated. */
export function createPointCloudMaterial(THREE: ThreeModule, style: PointCloudStyle, viewport: PointViewport): ShaderMaterial {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uPixelRatio: { value: viewport.pixelRatio },
      uScale: { value: viewport.scale },
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uOpacity: { value: style.opacity },
      uSoftness: { value: style.softness },
      uCore: { value: style.core },
      uMaxSize: { value: style.maxSize ?? 64 },
      uNebula: { value: style.nebula ? 1 : 0 },
    },
  ]);
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: POINT_VERTEX_SHADER,
    fragmentShader: POINT_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: style.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: true,
  });
}

export interface UniverseBackdropHost {
  THREE: ThreeModule;
  /** Parent that owns the backdrop: it moves and dies with the content it surrounds. */
  parent: Object3D;
  compact: boolean;
}

/** Optical density of each cloud per presentation: a bright sky on screen, a readable one over a camera. */
interface BackdropTone {
  dustOpacity: number;
  dustMaxSize: number;
  depthOpacity: number;
  nebulaOpacity: number;
  nebulaMaxSize: number;
}

const TONES: Record<BackdropPresentation, BackdropTone> = {
  screen: { dustOpacity: .5, dustMaxSize: 64, depthOpacity: .34, nebulaOpacity: .34, nebulaMaxSize: 240 },
  // WebGL points are clipped by their centre before the sprite quad is expanded. A 240px nebula
  // near an eye's frustum edge can therefore exist in one eye and disappear in the other. VR keeps
  // the colour atmosphere, but caps it below the size where that monocular rivalry dominates.
  vr: { dustOpacity: .46, dustMaxSize: 52, depthOpacity: .3, nebulaOpacity: .2, nebulaMaxSize: 68 },
  // Over a camera feed, hundreds of additive background points become glare and compete with the
  // tracked constellation. AR keeps only a trace of dust for motion; the semantic stars and their
  // links remain opaque/readable in UniverseWorld.
  ar: { dustOpacity: .035, dustMaxSize: 10, depthOpacity: 0, nebulaOpacity: 0, nebulaMaxSize: 48 },
};

export type BackdropPresentation = "screen" | "ar" | "vr";

/**
 * Deep-space dressing for the graph: a near dust field, a far field for depth and a handful of
 * procedural nebulae, all drawn as round shader points. Three draw calls at every device tier,
 * deterministic from the dust offset alone, never a texture or remote asset.
 */
export class UniverseBackdrop {
  readonly group: Group;

  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: ShaderMaterial[] = [];
  private readonly motionQuery = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : undefined;
  private readonly materialsByTone: { dust: ShaderMaterial; depth: ShaderMaterial; nebula: ShaderMaterial };
  private presentation: BackdropPresentation = "screen";
  private disposed = false;

  private constructor(THREE: ThreeModule, parent: Object3D, compact: boolean) {
    this.group = new THREE.Group();
    this.group.name = "universe-backdrop";
    parent.add(this.group);

    // Near field: fewer, brighter, larger grains, some of them flaring like real stars.
    const dustCount = compact ? 300 : 700;
    const dust = pointCloudAttributes(dustCount);
    const dustRng = seeded("universe-backdrop-dust");
    for (let index = 0; index < dustCount; index += 1) {
      const azimuth = dustRng() * Math.PI * 2;
      const polar = Math.acos(1 - 2 * dustRng());
      const radius = 26 + 62 * Math.pow(dustRng(), .62);
      const planar = Math.sin(polar);
      dust.positions[index * 3] = radius * planar * Math.cos(azimuth);
      dust.positions[index * 3 + 1] = radius * Math.cos(polar) * .78;
      dust.positions[index * 3 + 2] = radius * planar * Math.sin(azimuth);
      const tint = new THREE.Color(SPECTRAL_TINTS[Math.floor(dustRng() * SPECTRAL_TINTS.length)]);
      dust.colors[index * 3] = tint.r;
      dust.colors[index * 3 + 1] = tint.g;
      dust.colors[index * 3 + 2] = tint.b;
      const bright = dustRng();
      dust.sizes[index] = (compact ? .07 : .08) + bright * bright * .3;
      dust.phases[index] = dustRng();
      dust.twinkles[index] = .35 + dustRng() * .5;
      dust.spikes[index] = bright > .9 ? .85 : bright > .78 ? .4 : 0;
    }
    const dustMaterial = this.addPoints(THREE, dust, { softness: 2.4, core: 4.5, opacity: TONES.screen.dustOpacity, additive: true });

    // Far field: many small, dim stars out to a wide radius. Depth reads as scale, not as brightness.
    const depthCount = compact ? 260 : 620;
    const depth = pointCloudAttributes(depthCount);
    const depthRng = seeded("universe-backdrop-depth");
    for (let index = 0; index < depthCount; index += 1) {
      const azimuth = depthRng() * Math.PI * 2;
      const polar = Math.acos(1 - 2 * depthRng());
      const radius = 110 + 240 * Math.pow(depthRng(), .5);
      const planar = Math.sin(polar);
      depth.positions[index * 3] = radius * planar * Math.cos(azimuth);
      depth.positions[index * 3 + 1] = radius * Math.cos(polar) * .82;
      depth.positions[index * 3 + 2] = radius * planar * Math.sin(azimuth);
      const tint = new THREE.Color(SPECTRAL_TINTS[Math.floor(depthRng() * SPECTRAL_TINTS.length)]);
      const warmth = .55 + depthRng() * .45;
      depth.colors[index * 3] = tint.r * warmth;
      depth.colors[index * 3 + 1] = tint.g * warmth;
      depth.colors[index * 3 + 2] = tint.b * warmth;
      depth.sizes[index] = .34 + depthRng() * .8;
      depth.phases[index] = depthRng();
      depth.twinkles[index] = .28 + depthRng() * .44;
      depth.spikes[index] = 0;
    }
    const depthMaterial = this.addPoints(THREE, depth, { softness: 2.6, core: 5.5, opacity: TONES.screen.depthOpacity, additive: true, maxSize: 12 });

    // Nebulae are the same point cloud at a different scale: broad, almost flat discs of colour.
    const nebulaCount = compact ? 5 : 8;
    const nebulae = pointCloudAttributes(nebulaCount);
    const nebulaPalette = [0x8a5cff, 0x39b4ff, 0xff5aa8, 0x35d9b0, 0xb066ff, 0x4a7bff, 0xff9a4d, 0xff6ad5];
    const nebulaRng = seeded("universe-backdrop-nebulae");
    for (let index = 0; index < nebulaCount; index += 1) {
      const azimuth = nebulaRng() * Math.PI * 2;
      const polar = Math.acos(1 - 2 * nebulaRng());
      const radius = 44 + 96 * nebulaRng();
      const planar = Math.sin(polar);
      nebulae.positions[index * 3] = radius * planar * Math.cos(azimuth);
      nebulae.positions[index * 3 + 1] = radius * Math.cos(polar) * .7;
      nebulae.positions[index * 3 + 2] = radius * planar * Math.sin(azimuth);
      const tint = new THREE.Color(nebulaPalette[index % nebulaPalette.length]);
      nebulae.colors[index * 3] = tint.r;
      nebulae.colors[index * 3 + 1] = tint.g;
      nebulae.colors[index * 3 + 2] = tint.b;
      nebulae.sizes[index] = 20 + nebulaRng() * 32;
      nebulae.phases[index] = nebulaRng();
      nebulae.twinkles[index] = 0;
      nebulae.spikes[index] = 0;
    }
    const nebulaMaterial = this.addPoints(THREE, nebulae, { softness: 2.2, core: 3.5, opacity: TONES.screen.nebulaOpacity, additive: true, maxSize: TONES.screen.nebulaMaxSize, nebula: true });

    this.materialsByTone = { dust: dustMaterial, depth: depthMaterial, nebula: nebulaMaterial };
  }

  static create(host: UniverseBackdropHost) {
    return new UniverseBackdrop(host.THREE, host.parent, host.compact);
  }

  private addPoints(THREE: ThreeModule, attributes: PointCloudAttributes, style: PointCloudStyle) {
    const geometry = pointCloudGeometry(THREE, attributes);
    const material = createPointCloudMaterial(THREE, style, pointViewport());
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.group.add(points);
    this.geometries.push(geometry);
    this.materials.push(material);
    return material;
  }

  /** Screen, AR and VR differ in how much additive light the display can carry before it flares out. */
  setPresentation(next: BackdropPresentation) {
    if (this.disposed || this.presentation === next) return;
    this.presentation = next;
    this.applyTone();
  }

  private applyTone() {
    const tone = TONES[this.presentation];
    this.materialsByTone.dust.uniforms.uOpacity.value = tone.dustOpacity;
    this.materialsByTone.dust.uniforms.uMaxSize.value = tone.dustMaxSize;
    this.materialsByTone.depth.uniforms.uOpacity.value = tone.depthOpacity;
    this.materialsByTone.nebula.uniforms.uOpacity.value = tone.nebulaOpacity;
    this.materialsByTone.nebula.uniforms.uMaxSize.value = tone.nebulaMaxSize;
  }

  /** Drives twinkle and the audio response. Safe when never called: the field stays static. */
  update(elapsedSeconds: number, audioEnergy = 0) {
    if (this.disposed) return;
    const viewport = pointViewport();
    const motion = !this.motionQuery?.matches;
    const energy = Math.max(0, Math.min(1, audioEnergy)) * (motion ? 1 : .45);
    this.materials.forEach((material) => {
      const uniforms = material.uniforms;
      uniforms.uPixelRatio.value = viewport.pixelRatio;
      uniforms.uScale.value = viewport.scale;
      // Nebulae drift, they do not pulse: only the point fields follow the score.
      uniforms.uTime.value = motion ? elapsedSeconds : 0;
      uniforms.uEnergy.value = material === this.materialsByTone.nebula ? energy * .5 : energy;
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.geometries.length = 0;
    this.materials.length = 0;
  }
}
