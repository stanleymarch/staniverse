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

export interface PointCloudAttributes {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  phases: Float32Array;
  twinkles: Float32Array;
}

/** Buffers for one point cloud: position, colour, world size, twinkle phase and depth. */
export function pointCloudAttributes(count: number): PointCloudAttributes {
  return {
    positions: new Float32Array(count * 3),
    colors: new Float32Array(count * 3),
    sizes: new Float32Array(count),
    phases: new Float32Array(count),
    twinkles: new Float32Array(count),
  };
}

export function pointCloudGeometry(THREE: ThreeModule, attributes: PointCloudAttributes): BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(attributes.positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(attributes.colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(attributes.sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(attributes.phases, 1));
  geometry.setAttribute("aTwinkle", new THREE.BufferAttribute(attributes.twinkles, 1));
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
}

/**
 * Round star shader. Points are quads; `gl_PointCoord` turns each one into a soft
 * disc with a bright core, a wide corona and depth attenuation, in one draw call.
 * Two uniforms (`uSoftness`/`uCore`) cover both stars and nebulae, so every point
 * cloud in the universe shares one shader program.
 */
const POINT_VERTEX_SHADER = `
  attribute vec3 color;
  attribute float aSize;
  attribute float aPhase;
  attribute float aTwinkle;
  uniform float uPixelRatio;
  uniform float uScale;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uMaxSize;
  varying vec3 vColor;
  varying float vBrightness;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float twinkle = 1.0 + aTwinkle * 0.26 * sin(uTime * (0.55 + aPhase) + aPhase * 39.4784) * step(0.0001, uTime);
    float pulse = uEnergy * (0.6 + 0.4 * sin(uTime * 2.7 + aPhase * 6.2832));
    vColor = color;
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
  varying vec3 vColor;
  varying float vBrightness;
  #include <fog_pars_fragment>
  void main() {
    float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (radius > 1.0) discard;
    float falloff = 1.0 - radius;
    float corona = pow(falloff, uSoftness);
    float core = exp(-radius * radius * uCore);
    float alpha = clamp(corona * 0.7 + core, 0.0, 1.0) * uOpacity;
    gl_FragColor = vec4(vColor * (0.55 + 0.75 * core) * vBrightness, alpha);
    #include <fog_fragment>
    // Match three's built-in point/sprite output path so these colours land in the same
    // colour space as the node meshes and glows they sit beside.
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

/**
 * Deep-space dressing for the graph: a seeded dust field and a handful of procedural
 * nebulae, both drawn as round shader points. Two draw calls at every device tier,
 * deterministic from the dust offset alone, never a texture or remote asset.
 */
export class UniverseBackdrop {
  readonly group: Group;

  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: ShaderMaterial[] = [];
  private readonly motionQuery = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : undefined;
  private disposed = false;

  private constructor(THREE: ThreeModule, parent: Object3D, compact: boolean) {
    this.group = new THREE.Group();
    this.group.name = "universe-backdrop";
    parent.add(this.group);

    const dustCount = compact ? 340 : 780;
    const dust = pointCloudAttributes(dustCount);
    const dustRng = seeded("universe-backdrop-dust");
    for (let index = 0; index < dustCount; index += 1) {
      const azimuth = dustRng() * Math.PI * 2;
      const polar = Math.acos(1 - 2 * dustRng());
      const radius = 34 + 88 * Math.pow(dustRng(), .62);
      const planar = Math.sin(polar);
      dust.positions[index * 3] = radius * planar * Math.cos(azimuth);
      dust.positions[index * 3 + 1] = radius * Math.cos(polar) * .78;
      dust.positions[index * 3 + 2] = radius * planar * Math.sin(azimuth);
      const warmth = dustRng();
      dust.colors[index * 3] = .58 + warmth * .34;
      dust.colors[index * 3 + 1] = .72 + warmth * .2;
      dust.colors[index * 3 + 2] = .86 + dustRng() * .14;
      dust.sizes[index] = (compact ? .05 : .06) + dustRng() * .09;
      dust.phases[index] = dustRng();
      dust.twinkles[index] = .35 + dustRng() * .5;
    }
    this.addPoints(THREE, dust, { softness: 2.4, core: 4.5, opacity: .5, additive: true });

    // Nebulae are the same point cloud at a different scale: broad, almost flat discs.
    const nebulaCount = compact ? 4 : 7;
    const nebulae = pointCloudAttributes(nebulaCount);
    const nebulaPalette = [0x7548e8, 0x1e9ee8, 0xe33b9f, 0x27c6a3, 0xa25dea, 0x365fc7, 0xf18a3d];
    const nebulaRng = seeded("universe-backdrop-nebulae");
    for (let index = 0; index < nebulaCount; index += 1) {
      const azimuth = nebulaRng() * Math.PI * 2;
      const polar = Math.acos(1 - 2 * nebulaRng());
      const radius = 32 + 62 * nebulaRng();
      const planar = Math.sin(polar);
      nebulae.positions[index * 3] = radius * planar * Math.cos(azimuth);
      nebulae.positions[index * 3 + 1] = radius * Math.cos(polar) * .7;
      nebulae.positions[index * 3 + 2] = radius * planar * Math.sin(azimuth);
      const tint = new THREE.Color(nebulaPalette[index % nebulaPalette.length]);
      nebulae.colors[index * 3] = tint.r;
      nebulae.colors[index * 3 + 1] = tint.g;
      nebulae.colors[index * 3 + 2] = tint.b;
      nebulae.sizes[index] = 24 + nebulaRng() * 30;
      nebulae.phases[index] = nebulaRng();
      nebulae.twinkles[index] = 0;
    }
    this.addPoints(THREE, nebulae, { softness: 2.2, core: 3.5, opacity: .36, additive: true, maxSize: 240 });
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
      uniforms.uTime.value = motion ? elapsedSeconds : 0;
      uniforms.uEnergy.value = energy;
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
