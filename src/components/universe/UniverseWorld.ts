import type {
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  Material,
  Mesh,
  MeshBasicMaterial,
  Points,
  Scene,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import type { GraphEdge, GraphNode } from "../../lib/graph";
import { isCausalRelation, isInferredGraphEdge, selectVisualEdges } from "../../lib/graph-visuals";
import { UniverseBackdrop, createPointCloudMaterial, pointCloudAttributes, pointCloudGeometry, pointViewport, seeded, SPECTRAL_TINTS } from "./UniverseBackdrop";

export type ThreeModule = typeof import("three");

export interface WorldNodeVisual {
  node: GraphNode;
  mesh?: Mesh;
  core?: Mesh;
  aura?: Sprite;
  label?: Sprite;
  position: Vector3;
  radius: number;
  revealed: boolean;
  layer: "core" | "neighborhood" | "archive";
}

export interface UniverseWorldOptions {
  compact: boolean;
  /** Initial node ids to reveal before progressive reveal. */
  initialIds: Set<string>;
}

export interface WorldFocusCard {
  node: GraphNode;
  neighbors: Array<{ node: GraphNode; edge: GraphEdge; outgoing: boolean }>;
}

export interface UniverseWorldHost {
  THREE: ThreeModule;
  scene: Scene;
}

export const NODE_COLORS: Record<string, number> = {
  work: 0x6de1f4,
  project: 0x94baff,
  article: 0xe5a8d1,
  "telegram-post": 0xa9bdd0,
  "telegram-article": 0xa9bdd0,
  "youtube-video": 0xc9b9a3,
  video: 0xc9b9a3,
  topic: 0xf1f6ff,
};

export const NODE_LABELS: Record<string, string> = {
  work: "работа",
  project: "проект",
  article: "статья",
  "telegram-post": "публикация",
  "telegram-article": "публикация",
  "youtube-video": "видео",
  video: "видео",
  topic: "тема",
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Ambient edges are context, not structure: faint enough that sectors and voids read first. */
const AMBIENT_EDGE_OPACITY = .11;
/** Ambient edge budget per device tier; selection constellations keep their own budget. */
const AMBIENT_EDGE_BUDGET = { compact: 24, full: 60 };
/** Flattest allowed cluster axis: keeps galaxy-like clouds while preserving separation. */
const SQUASH_MIN = .82;
/** How many sector captions stay readable at once; the rest fade with distance. */
const BEACON_LABEL_BUDGET = 6;
const BEACON_LABEL_WIDTH = 1536;
const BEACON_LABEL_HEIGHT = 208;
const BEACON_LABEL_HEIGHT_RATIO = BEACON_LABEL_HEIGHT / BEACON_LABEL_WIDTH;


/**
 * Integer lattice points ordered by distance from the origin. The first `count` entries
 * are the tightest packing with exactly one lattice step between neighbours, so scaling
 * the count-th radius to a cluster radius keeps a predictable minimum star separation.
 */
const latticeOrder: Array<{ x: number; y: number; z: number; r: number }> = [];

function latticeSlice(count: number) {
  if (latticeOrder.length < count) {
    const bound = Math.ceil(Math.cbrt(count * 1.4)) + 2;
    const gathered: Array<{ x: number; y: number; z: number; r: number }> = [];
    for (let x = -bound; x <= bound; x += 1) {
      for (let y = -bound; y <= bound; y += 1) {
        for (let z = -bound; z <= bound; z += 1) {
          const r = Math.sqrt(x * x + y * y + z * z);
          if (r <= bound) gathered.push({ x, y, z, r });
        }
      }
    }
    gathered.sort((a, b) => a.r - b.r || a.x - b.x || a.y - b.y || a.z - b.z);
    latticeOrder.length = 0;
    latticeOrder.push(...gathered);
  }
  // A lone star has no radius of its own; one lattice step keeps the maths finite.
  const radius = Math.max(latticeOrder[count - 1].r, 1);
  return { points: latticeOrder, radius };
}

/** One semantic star cloud: a topic hub with its material, or a kind-only drift sector. */
interface WorldSector {
  key: string;
  /** Topic node at the centre of the cloud, absent for drift sectors. */
  hub?: string;
  ids: string[];
  score: number;
  radius: number;
  center: { x: number; y: number; z: number };
}

/** A named sector landmark: the halo, the pillar and the label that make deep space navigable. */
interface WorldBeacon {
  id: string;
  title: string;
  tint: Color;
  position: Vector3;
  radius: number;
  group: Group;
  label: Sprite;
}

/** One edge of the focused constellation, with the pulse and the travelling spark that animate it.
 *  `secondary` marks a neighbour-to-neighbour edge: context around the spokes, dimmer at rest. */
interface ConstellationEdge {
  line: Line;
  material: Material;
  edge: GraphEdge;
  from: Vector3;
  to: Vector3;
  phase: number;
  active: boolean;
  secondary: boolean;
  spark: Sprite;
  /** Daylight-readable physical stroke; hidden outside AR. */
  tube: Mesh;
  tubeMaterial: MeshBasicMaterial;
}

function cleanTitle(value: string, limit = 34) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

/** Canvas labels must earn their width: the type shrinks to fit first and only a
 *  still-overflowing line is truncated, so no caption ever spills its sprite. */
function fitCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number, style: (size: number) => string, baseSize: number, floorSize: number) {
  let size = baseSize;
  context.font = style(size);
  let value = text;
  let measured = context.measureText(value).width;
  while (measured > maxWidth && size > floorSize) {
    size -= 2;
    context.font = style(size);
    measured = context.measureText(value).width;
  }
  while (measured > maxWidth && value.length > 4) {
    value = `${value.slice(0, -2)}…`;
    measured = context.measureText(value).width;
  }
  return { value, size };
}
/** Inbound references carry slightly more prominence; logarithmic growth prevents hub glare. */
export function nodeProminenceScale(incoming: number, outgoing: number) {
  const weightedDegree = Math.max(0, incoming) * 1.15 + Math.max(0, outgoing) * .85;
  return 1 + Math.min(.85, Math.log2(1 + weightedDegree) * .16);
}

/**
 * Reusable graph scene content: stable node positions, an ambient point cloud for
 * every node, on-demand interactive meshes for the revealed/selected neighborhood,
 * and per-selection constellations built from the full graph adjacency.
 * The host supplies the renderer/camera and all input; the world never moves them.
 */
export class UniverseWorld {
  readonly root: Group;
  readonly byId: Map<string, GraphNode>;
  readonly neighbors: Map<string, Set<string>>;
  readonly edgesByNode: Map<string, Array<{ edge: GraphEdge; outgoing: boolean }>>;
  readonly visuals = new Map<string, WorldNodeVisual>();
  selectedId: string | null = null;

  private readonly THREE: ThreeModule;
  private readonly nodes: GraphNode[];
  private readonly edges: GraphEdge[];
  private readonly compact: boolean;
  private readonly nodeDegree = (id: string) => this.neighbors.get(id)?.size ?? 0;
  private readonly prominence = (id: string) => {
    let incoming = 0;
    let outgoing = 0;
    (this.edgesByNode.get(id) ?? []).forEach((record) => {
      if (record.outgoing) outgoing += 1;
      else incoming += 1;
    });
    return nodeProminenceScale(incoming, outgoing);
  };
  private readonly sharedSphereGeometry: SphereGeometry;
  private readonly sharedMeshMaterial: MeshBasicMaterial;
  private readonly opticalSphereGeometry: SphereGeometry;
  private readonly glowTexture: CanvasTexture;
  private readonly starPoints: Points;
  private readonly starMaterial: ShaderMaterial;
  private readonly backdrop: UniverseBackdrop;
  private readonly ambientEdges: Line[] = [];
  /** Strongest ambient routes receive physical filaments in AR; hidden on the screen sky. */
  private readonly ambientTubes: Mesh[] = [];
  private constellation: ConstellationEdge[] = [];
  /** Spectral colour per node, cached: the sky is tinted once, never per frame. */
  private readonly spectra = new Map<string, Color>();
  /** The selected star's marker: an instrument ring that stays readable over any sky. */
  private readonly focusReticle: Sprite;
  private readonly beacons: WorldBeacon[] = [];
  /** Reused ranking buffer: sorting sector captions every frame must not allocate. */
  private readonly beaconOrder: Array<{ beacon: WorldBeacon; distance: number }> = [];
  private readonly sectorSites: Array<{ id: string; title: string; tint: Color; position: Vector3; radius: number }> = [];
  private readonly beaconGroup: Group;
  private readonly motionQuery = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : undefined;
  private disposed = false;
  private vrPresentation = false;
  private arPresentation = false;
  /** Live AR content scale (graph units → metres); pick tolerance follows it physically. */
  private arContentScale = 1;
  private beaconLimit = 0;
  /** Scratch vectors for per-frame proximity: no allocation in the hot path. */
  private readonly probeEar: Vector3;
  private readonly probePoint: Vector3;
  private constructor(
    host: UniverseWorldHost,
    graph: { nodes: GraphNode[]; edges: GraphEdge[] },
    options: UniverseWorldOptions,
  ) {
    this.THREE = host.THREE;
    this.nodes = graph.nodes;
    this.edges = graph.edges;
    this.compact = options.compact;
    this.probeEar = new this.THREE.Vector3();
    this.probePoint = new this.THREE.Vector3();
    this.root = new this.THREE.Group();
    this.byId = new Map(graph.nodes.map((node) => [node.id, node]));
    this.neighbors = new Map();
    this.edgesByNode = new Map();
    graph.edges.forEach((edge) => {
      if (!this.byId.has(edge.source) || !this.byId.has(edge.target)) return;
      if (!this.neighbors.has(edge.source)) this.neighbors.set(edge.source, new Set());
      if (!this.neighbors.has(edge.target)) this.neighbors.set(edge.target, new Set());
      this.neighbors.get(edge.source)!.add(edge.target);
      this.neighbors.get(edge.target)!.add(edge.source);
      this.edgesByNode.set(edge.source, [...(this.edgesByNode.get(edge.source) ?? []), { edge, outgoing: true }]);
      this.edgesByNode.set(edge.target, [...(this.edgesByNode.get(edge.target) ?? []), { edge, outgoing: false }]);
    });
    // The sphere is a generous controller/mouse hit volume only. Visible semantic nodes are
    // optical point sources attached below, so proximity never turns a star into a flat ball.
    this.sharedSphereGeometry = new this.THREE.SphereGeometry(1, 8, 6);
    this.opticalSphereGeometry = new this.THREE.SphereGeometry(1, 20, 14);
    this.sharedMeshMaterial = new this.THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthWrite: false,
    });

    // A restrained optical signature: a tiny photosphere, a faint Airy ring and narrow
    // diffraction rays. The transparent corners prevent the old soft circular sticker.
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = 256;
    glowCanvas.height = 256;
    const glowContext = glowCanvas.getContext("2d");
    if (!glowContext) throw new Error("Glow canvas is unavailable");
    const glowGradient = glowContext.createRadialGradient(128, 128, 0, 128, 128, 70);
    glowGradient.addColorStop(0, "rgba(255,255,255,1)");
    glowGradient.addColorStop(.035, "rgba(255,255,255,.95)");
    glowGradient.addColorStop(.09, "rgba(255,255,255,.22)");
    glowGradient.addColorStop(.22, "rgba(255,255,255,.05)");
    glowGradient.addColorStop(1, "rgba(255,255,255,0)");
    glowContext.fillStyle = glowGradient;
    glowContext.fillRect(0, 0, 256, 256);
    const ray = glowContext.createLinearGradient(0, 128, 256, 128);
    ray.addColorStop(0, "rgba(255,255,255,0)");
    ray.addColorStop(.4, "rgba(255,255,255,.02)");
    ray.addColorStop(.48, "rgba(255,255,255,.2)");
    ray.addColorStop(.5, "rgba(255,255,255,.9)");
    ray.addColorStop(.52, "rgba(255,255,255,.2)");
    ray.addColorStop(.6, "rgba(255,255,255,.02)");
    ray.addColorStop(1, "rgba(255,255,255,0)");
    glowContext.fillStyle = ray;
    glowContext.fillRect(0, 126.5, 256, 3);
    glowContext.save();
    glowContext.translate(128, 128);
    glowContext.rotate(Math.PI / 2);
    glowContext.translate(-128, -128);
    glowContext.fillStyle = ray;
    glowContext.fillRect(0, 127, 256, 2);
    glowContext.restore();
    glowContext.strokeStyle = "rgba(255,255,255,.055)";
    glowContext.lineWidth = 1;
    glowContext.beginPath();
    glowContext.arc(128, 128, 31, 0, Math.PI * 2);
    glowContext.stroke();
    this.glowTexture = new this.THREE.CanvasTexture(glowCanvas);

    // Focus glow: the selected star answers the open card with extra light, not an
    // instrument. A soft dark backing keeps the light readable even over the bright
    // AR camera feed; the gradient is drawn once and only breathes in opacity.
    const reticleCanvas = document.createElement("canvas");
    reticleCanvas.width = 256;
    reticleCanvas.height = 256;
    const reticleContext = reticleCanvas.getContext("2d");
    if (!reticleContext) throw new Error("Reticle canvas is unavailable");
    const backing = reticleContext.createRadialGradient(128, 128, 24, 128, 128, 126);
    backing.addColorStop(0, "rgba(3,6,13,.5)");
    backing.addColorStop(.7, "rgba(3,6,13,.26)");
    backing.addColorStop(1, "rgba(3,6,13,0)");
    reticleContext.fillStyle = backing;
    reticleContext.fillRect(0, 0, 256, 256);
    const glow = reticleContext.createRadialGradient(128, 128, 2, 128, 128, 98);
    glow.addColorStop(0, "rgba(227,249,255,.95)");
    glow.addColorStop(.28, "rgba(151,227,255,.5)");
    glow.addColorStop(.62, "rgba(127,212,240,.16)");
    glow.addColorStop(1, "rgba(127,212,240,0)");
    reticleContext.fillStyle = glow;
    reticleContext.fillRect(0, 0, 256, 256);
    this.focusReticle = new this.THREE.Sprite(new this.THREE.SpriteMaterial({
      map: new this.THREE.CanvasTexture(reticleCanvas),
      transparent: true,
      opacity: .85,
      depthWrite: false,
    }));
    this.focusReticle.visible = false;
    this.focusReticle.userData.baseWorldScale = 0;
    this.root.add(this.focusReticle);

    // Stable graph coordinates, derived from the content alone: see layoutNodes.
    const layout = this.layoutNodes();
    this.nodes.forEach((node) => {
      const layer: WorldNodeVisual["layer"] = options.initialIds.has(node.id) ? "core" : this.nodeDegree(node.id) > 0 ? "neighborhood" : "archive";
      const baseRadius = node.featured ? .48 : layer === "core" ? .31 : layer === "neighborhood" ? .17 : .075;
      this.visuals.set(node.id, {
        node,
        position: layout.get(node.id)!,
        radius: baseRadius * this.prominence(node.id) * (options.compact ? .56 : .72),
        revealed: false,
        layer,
      });
    });

    // One point cloud stands in for every node; interactive meshes are added on demand.
    const stars = pointCloudAttributes(this.nodes.length);
    this.nodes.forEach((node, index) => {
      const visual = this.visuals.get(node.id)!;
      stars.positions[index * 3] = visual.position.x;
      stars.positions[index * 3 + 1] = visual.position.y;
      stars.positions[index * 3 + 2] = visual.position.z;
      const spectrum = this.spectral(node.id, node.kind);
      stars.colors[index * 3] = spectrum.r;
      stars.colors[index * 3 + 1] = spectrum.g;
      stars.colors[index * 3 + 2] = spectrum.b;
      const rng = seeded(`star|${node.id}`);
      // A minority of hot, flaring stars gives the field its depth: most dots stay quiet.
      const heat = rng();
      stars.sizes[index] = (node.featured ? .34 : visual.layer === "core" ? .27 : visual.layer === "neighborhood" ? .2 : .14) * this.prominence(node.id) * (options.compact ? .85 : 1) * (.8 + heat * .7);
      stars.phases[index] = rng();
      stars.twinkles[index] = .4 + rng() * .6;
      stars.spikes[index] = heat > .84 ? 1 : heat > .7 ? .45 : 0;
    });
    const starGeometry = pointCloudGeometry(this.THREE, stars);
    this.starMaterial = createPointCloudMaterial(this.THREE, { softness: 2.6, core: 5.5, opacity: .9, additive: true }, pointViewport());
    this.starPoints = new this.THREE.Points(starGeometry, this.starMaterial);
    this.root.add(this.starPoints);

    // Dust and nebulae live with the content so they follow it into tabletop AR.
    this.backdrop = UniverseBackdrop.create({ THREE: this.THREE, parent: this.root, compact: options.compact });

    // Sector landmarks give the empty space names: one beacon per topic hub, strongest first.
    this.beaconGroup = new this.THREE.Group();
    this.beaconGroup.name = "universe-beacons";
    this.root.add(this.beaconGroup);
    this.beaconLimit = options.compact ? 8 : 14;
    this.buildBeacons();

    selectVisualEdges(this.edges, options.compact ? AMBIENT_EDGE_BUDGET.compact : AMBIENT_EDGE_BUDGET.full, .55).forEach((edge) => {
      const source = this.visuals.get(edge.source);
      const target = this.visuals.get(edge.target);
      if (!source || !target) return;
      const inferred = isInferredGraphEdge(edge);
      const causal = isCausalRelation(edge);
      const character = inferred ? 0x6de1f4 : causal ? 0xf1b7dd : 0x8ea6c0;
      const geometry = new this.THREE.BufferGeometry().setFromPoints([source.position, target.position]);
      const material = inferred
        ? new this.THREE.LineDashedMaterial({ color: character, transparent: true, opacity: AMBIENT_EDGE_OPACITY, dashSize: .32, gapSize: .22 })
        : new this.THREE.LineBasicMaterial({ color: character, transparent: true, opacity: AMBIENT_EDGE_OPACITY });
      const line = new this.THREE.Line(geometry, material);
      line.userData.character = inferred ? "inferred" : causal ? "causal" : "related";
      if (inferred) line.computeLineDistances();
      const tube = new this.THREE.Mesh(
        new this.THREE.TubeGeometry(new this.THREE.LineCurve3(source.position, target.position), 1, .12, 3, false),
        new this.THREE.MeshBasicMaterial({ color: character, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
      );
      tube.visible = false;
      tube.renderOrder = 1;
      this.root.add(line, tube);
      this.ambientEdges.push(line);
      this.ambientTubes.push(tube);
    });
  }

  static create(host: UniverseWorldHost, graph: { nodes: GraphNode[]; edges: GraphEdge[] }, options: UniverseWorldOptions) {
    return new UniverseWorld(host, graph, options);
  }

  /**
   * Deterministic deep-space coordinates, derived from the content alone.
   *
   * Every node joins the cloud of its rarest canonical topic, so a topic hub and the
   * material filed under it share one volume; nodes with no canonical topic form
   * kind-only drift sectors. Each cloud is a flattened, randomly oriented lattice —
   * one lattice step apart, jittered just enough to read as a star field — and clouds
   * are packed into seeded directions with a guaranteed gap between them. Related
   * nodes therefore stay close and edges stay legible, while the whole system spans
   * real depth instead of orbiting one shared centre.
   */
  private layoutNodes() {
    const separation = this.compact ? 1.9 : 2.4;
    const minDistance = this.compact ? 8 : 9;
    const maxDistance = this.compact ? 40 : 46;
    const maxChunk = this.compact ? 48 : 64;

    const hubIds = new Set(this.nodes.filter((node) => node.kind === "topic").map((node) => node.id));
    const topicSize = new Map<string, number>();
    this.nodes.forEach((node) => node.topics.forEach((topic) => {
      const id = `topic:${topic}`;
      if (hubIds.has(id)) topicSize.set(id, (topicSize.get(id) ?? 0) + 1);
    }));

    const anchored = new Map<string, string[]>();
    const drift = new Map<string, string[]>();
    [...this.nodes].sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((node) => {
      if (node.kind === "topic") return;
      // The rarest topic owns the node, which keeps dense hubs from swallowing the graph.
      let anchor: string | undefined;
      for (const topic of node.topics) {
        const id = `topic:${topic}`;
        const size = topicSize.get(id);
        if (size === undefined) continue;
        const current = anchor === undefined ? Number.POSITIVE_INFINITY : topicSize.get(anchor)!;
        if (size < current || (size === current && anchor !== undefined && id < anchor)) anchor = id;
      }
      const bucket = anchor ? anchored : drift;
      const key = anchor ?? node.kind;
      bucket.set(key, [...(bucket.get(key) ?? []), node.id]);
    });

    const featuredIds = new Set(this.nodes.filter((node) => node.featured).map((node) => node.id));
    const sectors: WorldSector[] = [];
    const sectorFor = (key: string, ids: string[], hub?: string): WorldSector => {
      const count = ids.length + (hub ? 1 : 0);
      // The lattice radius that holds `count` points, scaled by the separation the
      // cloud should keep between neighbouring stars.
      const rho = Math.cbrt((count * 3) / (4 * Math.PI));
      const featured = ids.reduce((total, id) => total + (featuredIds.has(id) ? 1 : 0), 0);
      return {
        key,
        hub,
        ids,
        score: featured * 6 + ids.length + (hub ? 4 : 0),
        radius: (separation / SQUASH_MIN) * rho,
        center: { x: 0, y: 0, z: 0 },
      };
    };
    anchored.forEach((ids, key) => sectors.push(sectorFor(key, [...ids].sort(), key)));
    // A hub whose material was all claimed by rarer topics still owns a beacon: every
    // topic node gets a cloud, so no node is left without coordinates.
    hubIds.forEach((id) => { if (!anchored.has(id)) sectors.push(sectorFor(id, [], id)); });
    [...drift]
      .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
      .forEach(([kind, ids]) => {
        const chunks = Math.max(1, Math.ceil(ids.length / maxChunk));
        const perChunk = Math.ceil(ids.length / chunks);
        for (let chunk = 0; chunk < chunks; chunk += 1) {
          const members = ids.slice(chunk * perChunk, (chunk + 1) * perChunk);
          if (members.length) sectors.push(sectorFor(`kind:${kind}#${chunk}`, members));
        }
      });
    sectors.sort((a, b) => b.score - a.score || b.ids.length - a.ids.length || (a.key < b.key ? -1 : 1));

    // Cloud centres: golden-angle directions on a radial profile that keeps the strongest
    // sectors near the middle and scatters the drift field outward, with retries until
    // every cloud clears its neighbours.
    const hubs = sectors.filter((sector) => sector.hub);
    const driftSectors = sectors.filter((sector) => !sector.hub);
    const radialSlot = (index: number, count: number, attempt: number, rng: () => number) => {
      const slot = index * 64 + attempt;
      const polar = Math.acos(1 - (2 * ((slot % 41) + .5)) / 41);
      const azimuth = slot * GOLDEN_ANGLE + rng() * .7;
      const progress = index / Math.max(1, count - 1);
      const distance = minDistance + (maxDistance - minDistance) * (.8 * Math.pow(progress, .9) + .2 * rng()) + attempt * 1.6;
      const planar = Math.sin(polar);
      return {
        x: distance * planar * Math.cos(azimuth),
        y: distance * Math.cos(polar) * .66,
        z: distance * planar * Math.sin(azimuth),
      };
    };
    hubs.forEach((sector, index) => { sector.center = radialSlot(index, hubs.length, 0, seeded(`sector|${sector.key}`)); });

    // Topics that share material slide towards each other, so a cross-topic edge stays a
    // short hop instead of a line across the field. Radial "homes" and a pairwise push
    // keep the seeded depth spread and stop the clouds from merging.
    if (hubs.length > 1) {
      const hubIndex = new Map(hubs.map((sector, index) => [sector.key, index]));
      const shared = hubs.map(() => new Float64Array(hubs.length));
      this.nodes.forEach((node) => {
        const indices: number[] = [];
        node.topics.forEach((topic) => {
          const index = hubIndex.get(`topic:${topic}`);
          if (index !== undefined) indices.push(index);
        });
        for (let a = 0; a < indices.length; a += 1) {
          for (let b = a + 1; b < indices.length; b += 1) {
            shared[indices[a]][indices[b]] += 1;
            shared[indices[b]][indices[a]] += 1;
          }
        }
      });
      const centers = hubs.map((sector) => new this.THREE.Vector3(sector.center.x, sector.center.y, sector.center.z));
      const homes = centers.map((center) => center.clone());
      const pull = new this.THREE.Vector3();
      const push = new this.THREE.Vector3();
      for (let step = 0; step < 24; step += 1) {
        for (let index = 0; index < hubs.length; index += 1) {
          pull.set(0, 0, 0);
          let weight = 0;
          for (let other = 0; other < hubs.length; other += 1) {
            const link = shared[index][other];
            if (!link) continue;
            weight += link;
            pull.addScaledVector(centers[other], link);
          }
          if (weight) centers[index].lerp(pull.divideScalar(weight), .35);
          centers[index].lerp(homes[index], .12);
        }
        for (let a = 0; a < hubs.length; a += 1) {
          for (let b = a + 1; b < hubs.length; b += 1) {
            const minimum = hubs[a].radius + hubs[b].radius + separation * 1.2;
            const distance = centers[a].distanceTo(centers[b]);
            if (distance >= minimum) continue;
            const overlap = (minimum - distance) * .5;
            if (distance > 1e-4) push.copy(centers[b]).sub(centers[a]).divideScalar(distance); else push.set(1, 0, 0);
            centers[a].addScaledVector(push, -overlap);
            centers[b].addScaledVector(push, overlap);
          }
        }
      }
      hubs.forEach((sector, index) => { sector.center = { x: centers[index].x, y: centers[index].y, z: centers[index].z }; });
    }

    const placed: WorldSector[] = [...hubs];
    driftSectors.forEach((sector, index) => {
      const rng = seeded(`sector|${sector.key}`);
      const margin = separation * 1.4;
      let clearance = -Infinity;
      for (let attempt = 0; attempt < 64 && clearance < margin; attempt += 1) {
        const candidate = radialSlot(index, driftSectors.length, attempt, rng);
        let candidateClearance = Infinity;
        placed.forEach((other) => {
          const gap = Math.hypot(candidate.x - other.center.x, candidate.y - other.center.y, candidate.z - other.center.z) - other.radius - sector.radius;
          if (gap < candidateClearance) candidateClearance = gap;
        });
        if (candidateClearance > clearance) {
          clearance = candidateClearance;
          sector.center = candidate;
        }
      }
      placed.push(sector);
    });

    const positions = new Map<string, Vector3>();

    // Sector landmarks hang from the hub clouds, strongest sector first: this is the list the
    // beacons are built from, captured here because the centres only exist inside the layout.
    sectors.filter((sector) => sector.hub).forEach((sector) => {
      const hub = this.byId.get(sector.hub!);
      if (!hub) return;
      this.sectorSites.push({
        id: hub.id,
        title: hub.title,
        tint: this.spectral(hub.id, hub.kind),
        position: new this.THREE.Vector3(sector.center.x, sector.center.y, sector.center.z),
        radius: sector.radius,
      });
    });

    const local = new this.THREE.Vector3();
    const axis = new this.THREE.Vector3();
    sectors.forEach((sector) => {
      const rng = seeded(`cloud|${sector.key}`);
      const order = sector.hub ? [sector.hub, ...sector.ids] : sector.ids;
      const packing = latticeSlice(order.length);
      const step = 1 / packing.radius;
      const jitter = step * .12;
      const squashY = SQUASH_MIN + rng() * (1 - SQUASH_MIN);
      const squashZ = SQUASH_MIN + rng() * (1 - SQUASH_MIN);
      axis.set(rng() - .5, rng() - .5, rng() - .5).normalize();
      const orientation = new this.THREE.Quaternion().setFromAxisAngle(axis, rng() * Math.PI * 2);
      order.forEach((id, index) => {
        const point = packing.points[index];
        local
          .set(
            point.x * step + (rng() - .5) * 2 * jitter,
            (point.y * step + (rng() - .5) * 2 * jitter) * squashY,
            (point.z * step + (rng() - .5) * 2 * jitter) * squashZ,
          )
          .applyQuaternion(orientation);
        positions.set(id, new this.THREE.Vector3(
          sector.center.x + local.x * sector.radius,
          sector.center.y + local.y * sector.radius,
          sector.center.z + local.z * sector.radius,
        ));
      });
    });
    return positions;
  }

  /**
   * Spectral tint for one node: the colour that says what it is, pulled towards a photospheric
   * temperature and dimmed by a seeded amount, so a deep-sky field replaces a wall of identical
   * white dots. Cached per node, because the mesh, its aura and the point cloud must agree.
   */
  private spectral(id: string, kind: string): Color {
    const cached = this.spectra.get(id);
    if (cached) return cached;
    const rng = seeded(`spectrum|${id}`);
    const base = new this.THREE.Color(NODE_COLORS[kind] ?? 0xc4d3e3);
    const temperature = new this.THREE.Color(SPECTRAL_TINTS[Math.floor(rng() * SPECTRAL_TINTS.length)]);
    const color = base.lerp(temperature, .45).multiplyScalar(.82 + rng() * .3);
    this.spectra.set(id, color);
    return color;
  }

  /**
   * One landmark per topic hub: a soft tinted halo marking the sector volume, a vertical pillar
   * for orientation and the sector name above it. Bounded to the strongest sectors, so the sky
   * becomes navigable instead of filling up with captions.
   */
  private buildBeacons() {
    this.sectorSites.slice(0, this.beaconLimit).forEach((site) => {
      const group = new this.THREE.Group();
      group.position.copy(site.position);
      const haloSize = site.radius * 2.4;
      const halo = new this.THREE.Sprite(new this.THREE.SpriteMaterial({ map: this.glowTexture, color: site.tint, transparent: true, opacity: .18, blending: this.THREE.AdditiveBlending, depthWrite: false }));
      halo.userData.baseWorldScale = haloSize;
      halo.userData.baseOpacity = .18;
      halo.scale.setScalar(haloSize);
      const pillarHeight = site.radius * 2.8;
      const pillar = new this.THREE.Line(
        new this.THREE.BufferGeometry().setFromPoints([new this.THREE.Vector3(0, -pillarHeight / 2, 0), new this.THREE.Vector3(0, pillarHeight / 2, 0)]),
        new this.THREE.LineBasicMaterial({ color: site.tint, transparent: true, opacity: .3 }),
      );
      pillar.userData.baseOpacity = .3;
      const label = this.beaconLabel(site.title, site.tint);
      const labelWidth = Math.min(18, Math.max(6, site.radius * 2.6));
      label.scale.set(labelWidth, labelWidth * BEACON_LABEL_HEIGHT_RATIO, 1);
      label.position.y = pillarHeight / 2 + labelWidth * .16;
      label.userData.baseWidth = labelWidth;
      group.add(halo, pillar, label);
      this.beaconGroup.add(group);
      this.beacons.push({ id: site.id, title: site.title, tint: site.tint, position: site.position, radius: site.radius, group, label });
    });
  }

  /** Sector caption: tinted text lifted toward white over a soft dark backing, so it reads over
   *  nebulae and bright star clouds alike. Normal blending keeps the backing dark instead of
   *  additive-ignoring it. */
  private beaconLabel(text: string, tint: Color) {
    const canvas = document.createElement("canvas");
    canvas.width = BEACON_LABEL_WIDTH;
    canvas.height = BEACON_LABEL_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) return new this.THREE.Sprite();
    const fitted = fitCanvasText(context, text.toUpperCase(), BEACON_LABEL_WIDTH - 96, (size) => `600 ${size}px Unbounded, Geologica, sans-serif`, 30, 20);
    const readable = tint.clone().lerp(new this.THREE.Color(0xeef3ff), .58);
    context.shadowColor = "rgba(3,6,13,.92)";
    context.shadowBlur = 22;
    context.fillStyle = `#${readable.getHexString()}`;
    context.fillText(fitted.value, BEACON_LABEL_WIDTH / 2, BEACON_LABEL_HEIGHT / 2);
    return new this.THREE.Sprite(new this.THREE.SpriteMaterial({
      map: new this.THREE.CanvasTexture(canvas),
      transparent: true,
      opacity: .82,
      depthWrite: false,
    }));
  }

  private labelFor(text: string) {
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 1200;
    labelCanvas.height = 160;
    const context = labelCanvas.getContext("2d");
    if (!context) return undefined;
    context.textAlign = "center";
    context.textBaseline = "middle";
    // Unbounded at 2x resolution: the site's display voice, crisp at every zoom.
    // The type shrinks to fit the sprite before any letter is cut.
    const fitted = fitCanvasText(context, cleanTitle(text, 48), 1120, (size) => `500 ${size}px Unbounded, Geologica, sans-serif`, 30, 18);
    // The caption has to survive crossing a bright edge or beacon halo: a soft dark
    // backing keeps it readable without adding a visible plate to the sky.
    context.shadowColor = "rgba(3,6,13,.9)";
    context.shadowBlur = 20;
    context.fillStyle = "rgba(238,245,255,.95)";
    context.fillText(fitted.value, 600, 84);
    const texture = new this.THREE.CanvasTexture(labelCanvas);
    const sprite = new this.THREE.Sprite(new this.THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    const presentationScale = this.vrPresentation ? .12 : 1;
    sprite.scale.set(10 * presentationScale, 1.32 * presentationScale, 1);
    sprite.position.y = -1.05 * (this.vrPresentation ? .35 : 1);
    return { sprite, texture };
  }

  /** Interactive mesh for one node, created on demand and cached for the session. */
  private ensureMesh(id: string) {
    const visual = this.visuals.get(id);
    if (!visual || visual.mesh || this.disposed) return visual;
    // This mesh is a raycast volume only. `colorWrite:false` is invariant across
    // screen, VR and AR; making it visible created faceted balls over the camera.
    const mesh = new this.THREE.Mesh(this.sharedSphereGeometry, this.sharedMeshMaterial.clone());
    mesh.scale.setScalar(visual.radius);
    mesh.position.copy(visual.position);
    mesh.userData.nodeId = id;
    mesh.visible = false;
    this.root.add(mesh);
    visual.mesh = mesh;
    const core = new this.THREE.Mesh(
      this.opticalSphereGeometry,
      new this.THREE.MeshBasicMaterial({
        color: this.spectral(id, visual.node.kind),
        transparent: true,
        opacity: .94,
        depthWrite: false,
      }),
    );
    core.scale.setScalar(.72);
    core.visible = this.arPresentation;
    core.renderOrder = 3;
    mesh.add(core);
    visual.core = core;
    if (!this.compact || visual.layer !== "archive") {
      const aura = new this.THREE.Sprite(new this.THREE.SpriteMaterial({ map: this.glowTexture, color: this.spectral(id, visual.node.kind), transparent: true, opacity: 0, blending: this.arPresentation ? this.THREE.NormalBlending : this.THREE.AdditiveBlending, depthWrite: false }));
      const auraSize = this.compact
        ? visual.node.featured ? 1.15 : visual.layer === "core" ? .92 : .54
        : visual.node.featured ? 1.6 : visual.layer === "core" ? 1.25 : visual.layer === "neighborhood" ? .74 : .32;
      aura.userData.baseWorldScale = auraSize;
      aura.scale.setScalar((auraSize * (this.vrPresentation ? .18 : 1)) / visual.radius);
      mesh.add(aura);
      visual.aura = aura;
    }
    return visual;
  }

  private ensureLabel(id: string) {
    const visual = this.ensureMesh(id);
    if (!visual?.mesh || visual.label) return;
    const label = this.labelFor(visual.node.title);
    if (!label) return;
    label.sprite.scale.multiplyScalar(1 / visual.radius);
    label.sprite.position.y /= visual.radius;
    visual.label = label.sprite;
    label.sprite.visible = false;
    visual.mesh.add(label.sprite);
  }

  reveal(id: string) {
    const visual = this.ensureMesh(id);
    if (!visual?.mesh) return;
    visual.revealed = true;
    visual.mesh.visible = true;
    const auraDim = this.arPresentation ? .85 : 1;
    if (visual.aura) (visual.aura.material as SpriteMaterial).opacity = auraDim * (visual.node.featured ? .62 : visual.layer === "core" ? .46 : visual.layer === "neighborhood" ? .24 : .06);
  }

  /** Progressive reveal of the strongest remaining neighborhood, ordered by featured/degree. */
  revealBatch(ids: string[]) {
    ids.forEach((id) => this.reveal(id));
    this.updateHighlights();
  }

  strongestUnrevealed(count: number) {
    return [...this.visuals.values()]
      .filter((visual) => !visual.revealed && visual.layer !== "archive")
      .sort((a, b) => Number(b.node.featured) - Number(a.node.featured) || this.nodeDegree(b.node.id) - this.nodeDegree(a.node.id))
      .slice(0, count)
      .map((visual) => visual.node.id);
  }

  /** Interactive meshes available for picking: only what is currently revealed and visible. */
  pickableMeshes(): Mesh[] {
    const meshes: Mesh[] = [];
    this.visuals.forEach((visual) => { if (visual.mesh?.visible) meshes.push(visual.mesh); });
    return meshes;
  }
  /** The point cloud makes every star pickable without allocating one mesh per archive
   *  item — including while a selection is open, so any star can take over the card. */
  pickableObjects(): Array<Mesh | Points> {
    return [this.starPoints, ...this.pickableMeshes()];
  }
  nodeIdFromPick(object: Mesh | Points, pointIndex?: number) {
    if (object === this.starPoints) return pointIndex === undefined ? undefined : this.nodes[pointIndex]?.id;
    // We set `nodeId` on every pickable mesh ourselves (see ensureMesh), so the shape is ours.
    const userData = object.userData as { nodeId?: string };
    return userData.nodeId;
  }

  private disposeConstellation() {
    this.constellation.forEach(({ line, material, spark, tube, tubeMaterial }) => {
      line.geometry.dispose();
      material.dispose();
      (spark.material as SpriteMaterial).dispose();
      tube.geometry.dispose();
      tubeMaterial.dispose();
      this.root.remove(line, spark, tube);
    });
    this.constellation = [];
  }

  private buildConstellation(id: string) {
    this.disposeConstellation();
    const budget = this.arPresentation ? (this.compact ? 36 : 72) : this.compact ? 72 : 180;
    // Direct spokes answer "what is this star tied to"; edges between its neighbours answer
    // "are those tied to each other" — one constellation, two questions, drawn together.
    const directEdges = (this.edgesByNode.get(id) ?? []).map(({ edge }) => edge);
    const direct = selectVisualEdges(directEdges, budget, 0);
    const neighbourIds = new Set<string>();
    directEdges.forEach((edge) => {
      if (edge.source !== id || edge.target !== id) neighbourIds.add(edge.source === id ? edge.target : edge.source);
    });
    const pairKey = (edge: GraphEdge) => [edge.source, edge.target].sort().join("|");
    const seen = new Set(direct.map(pairKey));
    const crossEdges: GraphEdge[] = [];
    this.edgesByNode.forEach((records, nodeId) => {
      if (nodeId === id || !neighbourIds.has(nodeId)) return;
      records.forEach(({ edge }) => {
        const other = edge.source === nodeId ? edge.target : edge.source;
        if (other === id || !neighbourIds.has(other)) return;
        const key = pairKey(edge);
        if (seen.has(key)) return;
        seen.add(key);
        crossEdges.push(edge);
      });
    });
    const secondaryEdges = budget - direct.length > 0 ? selectVisualEdges(crossEdges, budget - direct.length, 0) : [];
    const secondary = new Set(secondaryEdges);
    [...direct, ...secondaryEdges].forEach((edge, index) => {
      const source = this.visuals.get(edge.source);
      const target = this.visuals.get(edge.target);
      if (!source || !target) return;
      const inferred = isInferredGraphEdge(edge);
      const causal = isCausalRelation(edge);
      const character = inferred ? 0x6de1f4 : causal ? 0xf1b7dd : 0x8ea6c0;
      const geometry = new this.THREE.BufferGeometry().setFromPoints([source.position, target.position]);
      const material = inferred
        ? new this.THREE.LineDashedMaterial({ color: character, transparent: true, opacity: .92, dashSize: .32, gapSize: .22 })
        : new this.THREE.LineBasicMaterial({ color: character, transparent: true, opacity: .92 });
      const line = new this.THREE.Line(geometry, material);
      if (inferred) line.computeLineDistances();
      // WebGL line width is fixed to one pixel on mobile. A low-poly physical tube
      // supplies a real daylight-readable stroke in AR; the original line remains
      // on top to preserve the dashed/solid relation character.
      const tubeMaterial = new this.THREE.MeshBasicMaterial({ color: character, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
      const tube = new this.THREE.Mesh(
        new this.THREE.TubeGeometry(new this.THREE.LineCurve3(source.position, target.position), 1, .11, 4, false),
        tubeMaterial,
      );
      tube.visible = false;
      tube.renderOrder = 2;
      // A travelling spark per connection: the pulse that makes a live route legible in depth.
      const spark = new this.THREE.Sprite(new this.THREE.SpriteMaterial({ map: this.glowTexture, color: character, transparent: true, opacity: .85, blending: this.THREE.AdditiveBlending, depthWrite: false }));
      const sparkScale = Math.max(.18, Math.min(source.radius, target.radius) * 2.2);
      spark.scale.setScalar(sparkScale);
      spark.userData.baseWorldScale = sparkScale;
      spark.position.copy(source.position);
      spark.visible = false;
      this.root.add(line, spark, tube);
      this.constellation.push({
        line,
        material,
        edge,
        from: source.position,
        to: target.position,
        phase: (seeded(`spark|${edge.source}|${edge.target}|${edge.type}`)() + index * .37) % 1,
        active: false,
        secondary: secondary.has(edge),
        spark,
        tube,
        tubeMaterial,
      });
    });
    this.toneConstellation();
  }
  updateHighlights() {
    const direct = this.selectedId ? this.neighbors.get(this.selectedId) ?? new Set<string>() : new Set<string>();
    this.visuals.forEach((visual) => {
      if (!visual.mesh) return;
      const isPath = this.selectedId === visual.node.id || direct.has(visual.node.id);
      visual.mesh.visible = !this.selectedId || isPath;
      if (visual.label) visual.label.visible = Boolean(this.selectedId && isPath);
      const auraDim = this.arPresentation ? .85 : 1;
      if (visual.aura) {
        const baseOpacity = visual.node.featured ? .62 : visual.layer === "core" ? .46 : visual.layer === "neighborhood" ? .24 : .06;
        (visual.aura.material as SpriteMaterial).opacity = auraDim * (this.selectedId === visual.node.id ? .9 : direct.has(visual.node.id) ? Math.max(.42, baseOpacity) : baseOpacity);
      }
      const emphasis = this.selectedId === visual.node.id ? 1.22 : direct.has(visual.node.id) ? 1.08 : 1;
      visual.mesh.scale.setScalar(visual.radius * emphasis);
    });
    this.constellation.forEach((item) => {
      item.line.visible = true;
      item.active = item.edge.source === this.selectedId || item.edge.target === this.selectedId;
      (item.material as LineBasicMaterial | LineDashedMaterial).opacity = item.active ? (this.arPresentation ? 1 : .92) : item.secondary ? (this.arPresentation ? .72 : .34) : (this.arPresentation ? .24 : .08);
      item.tube.visible = this.arPresentation;
      item.tubeMaterial.opacity = item.active ? .9 : item.secondary ? .36 : .16;
      item.spark.visible = false;
    });
    this.starMaterial.uniforms.uOpacity.value = this.selectedId ? (this.arPresentation ? .8 : .34) : (this.arPresentation ? 1 : .9);
  }

  /**
   * Optional per-frame animation: star twinkle, the audio response, live connections and the
   * backdrop. Node coordinates never change, so picking stays exactly where it was. A world
   * that is never updated simply renders as a still star field. Passing the viewer keeps the
   * sector captions readable and out of each other's way.
   */
  update(elapsedSeconds: number, audioEnergy = 0, viewer?: Vector3) {
    if (this.disposed) return;
    const motion = !this.motionQuery?.matches;
    const energy = Math.max(0, Math.min(1, audioEnergy));
    const viewport = pointViewport();
    this.starMaterial.uniforms.uTime.value = motion ? elapsedSeconds : 0;
    this.starMaterial.uniforms.uEnergy.value = energy * (motion ? 1 : .45);
    // Physical star sizing: gl_PointSize ∝ aSize·scale/depth already tracks the physical
    // metres the content scale produces, so the featured/core/satellite hierarchy survives
    // AR placement without pixel compensation (which saturated every tier to one blob size).
    this.starMaterial.uniforms.uScale.value = viewport.scale;
    // A selected constellation is a live route: the edges breathe and a spark travels each one.
    this.constellation.forEach((item) => {
      if (!item.active) return;
      item.spark.visible = motion;
      if (!motion) return;
      const wave = .76 + .24 * Math.sin(elapsedSeconds * 2.3 + item.phase * Math.PI * 2);
      (item.material as LineBasicMaterial | LineDashedMaterial).opacity = .92 * wave;
      if (item.tube.visible) item.tubeMaterial.opacity = .9 * wave;
      item.spark.position.lerpVectors(item.from, item.to, (elapsedSeconds * .22 + item.phase) % 1);
    });
    if (viewer) this.focusBeacons(viewer);
    // The reticle breathes only while the full experience allows motion; reduced motion keeps it still.
    if (this.focusReticle.visible) (this.focusReticle.material as SpriteMaterial).opacity = motion ? .62 + .22 * Math.sin(elapsedSeconds * 1.7) : .85;
    this.backdrop.update(elapsedSeconds, energy);
  }

  /**
   * Sector captions follow the viewer: the nearest handful stay readable at a constant apparent
   * size and the rest fade away. In a sky this dense that is what keeps the labels from piling
   * up into unreadable collisions.
   */
  private focusBeacons(viewer: Vector3) {
    // The AR mini-map owns its captions: per-frame ranking would fight the four named sectors.
    if (this.arPresentation) return;
    const ordered = this.beaconOrder;
    ordered.length = 0;
    this.beacons.forEach((beacon) => { ordered.push({ beacon, distance: viewer.distanceTo(beacon.position) }); });
    ordered.sort((a, b) => a.distance - b.distance);
    ordered.forEach(({ beacon, distance }, rank) => {
      const width = Math.min(30, Math.max(4, distance * .2));
      beacon.label.scale.set(width, width * BEACON_LABEL_HEIGHT_RATIO, 1);
      const rankFade = rank < BEACON_LABEL_BUDGET ? 1 : Math.max(0, 1 - (rank - BEACON_LABEL_BUDGET + 1) / 4);
      (beacon.label.material as SpriteMaterial).opacity = .5 * rankFade;
      beacon.label.visible = rankFade > 0;
    });
  }
  focusCard(id: string): WorldFocusCard | undefined {
    const node = this.byId.get(id);
    if (!node) return undefined;
    const neighbors = (this.edgesByNode.get(id) ?? []).flatMap(({ edge, outgoing }) => {
      const neighbor = this.byId.get(outgoing ? edge.target : edge.source);
      return neighbor ? [{ node: neighbor, edge, outgoing }] : [];
    });
    return { node, neighbors };
  }
  /** Release one label's canvas texture; labels are re-created on demand for the focused set. */
  private releaseLabel(id: string) {
    const visual = this.visuals.get(id);
    if (!visual?.label) return;
    const material = visual.label.material as SpriteMaterial;
    visual.mesh?.remove(visual.label);
    material.map?.dispose();
    material.dispose();
    visual.label = undefined;
  }

  /** Select a node: reveal its neighborhood, label the strongest neighbors, rebuild its constellation. */
  focus(id: string): WorldFocusCard | undefined {
    const card = this.focusCard(id);
    if (!card) return undefined;
    this.selectedId = id;
    this.reveal(id);
    const focusedVisual = this.visuals.get(id);
    if (focusedVisual) {
      // The ring sits on the star itself, sized from its hit volume: the open card and the
      // marker answer each other without any camera movement.
      this.focusReticle.position.copy(focusedVisual.position);
      const worldScale = this.THREE.MathUtils.clamp(focusedVisual.radius * 6, 2.2, 3.2) * (this.vrPresentation ? .3 : 1);
      this.focusReticle.userData.baseWorldScale = worldScale;
      this.focusReticle.scale.setScalar(worldScale);
      this.focusReticle.visible = true;
    }
    card.neighbors.forEach(({ edge }) => {
      this.reveal(edge.source === id ? edge.target : edge.source);
    });
    const ranked = [...card.neighbors]
      .sort((a, b) => Number(isCausalRelation(b.edge)) - Number(isCausalRelation(a.edge)) || b.edge.confidence - a.edge.confidence)
      .slice(0, 8);
    // Every label owns a 600x80 canvas texture: keep exactly the focused constellation's labels,
    // otherwise each explored star leaves a texture allocated for the rest of the session.
    const labelled = new Set<string>([id, ...ranked.map(({ edge }) => (edge.source === id ? edge.target : edge.source))]);
    this.visuals.forEach((_visual, visualId) => { if (!labelled.has(visualId)) this.releaseLabel(visualId); });
    labelled.forEach((labelId) => this.ensureLabel(labelId));
    this.buildConstellation(id);
    this.updateHighlights();
    return card;
  }

  reset() {
    this.selectedId = null;
    this.focusReticle.visible = false;
    this.disposeConstellation();
    this.visuals.forEach((_visual, id) => this.releaseLabel(id));
    this.updateHighlights();
  }

  /** Keep world coordinates metric in VR while reducing screen-oriented glows and labels to readable physical sizes. */
  setVrPresentation(enabled: boolean) {
    if (this.vrPresentation === enabled) return;
    this.vrPresentation = enabled;
    const labelScale = enabled ? .12 : 1;
    const labelOffset = enabled ? .35 : 1;
    const auraScale = enabled ? .18 : 1;
    const reticleBase = Number(this.focusReticle.userData.baseWorldScale);
    if (Number.isFinite(reticleBase) && reticleBase > 0) this.focusReticle.scale.setScalar(reticleBase * (enabled ? .3 : 1));
    this.visuals.forEach((visual) => {
      if (visual.aura) {
        const baseWorldScale = Number(visual.aura.userData.baseWorldScale);
        if (Number.isFinite(baseWorldScale)) visual.aura.scale.setScalar((baseWorldScale * auraScale) / visual.radius);
      }
      if (visual.label) {
        visual.label.scale.set(10 * labelScale / visual.radius, 1.32 * labelScale / visual.radius, 1);
        visual.label.position.y = -1.05 * labelOffset / visual.radius;
      }
    });
    this.backdrop.setPresentation(this.presentation());
  }

  /**
   * AR shows the constellation over a live camera feed: full-size sector landmarks would
   * swallow a tabletop, so they shrink to a mini-map while stars, links and sparks switch
   * to daylight-readable inks (see toneAmbientEdges / toneConstellation).
   */
  setArPresentation(enabled: boolean) {
    if (this.arPresentation === enabled) return;
    this.arPresentation = enabled;
    this.beaconGroup.visible = true;
    this.applyBeaconScale();
    this.starMaterial.blending = enabled ? this.THREE.NormalBlending : this.THREE.AdditiveBlending;
    this.starMaterial.uniforms.uDaylight.value = enabled ? 1 : 0;
    this.starMaterial.uniforms.uMaxSize.value = enabled ? 42 : 64;
    // Hit volumes never render. Only optical sprites change blending for the camera
    // feed, which removes faceted spheres without sacrificing large raycast targets.
    this.visuals.forEach((visual) => {
      if (visual.core) visual.core.visible = enabled;
      if (!visual.aura) return;
      const material = visual.aura.material as SpriteMaterial;
      material.blending = enabled ? this.THREE.NormalBlending : this.THREE.AdditiveBlending;
      material.needsUpdate = true;
    });
    if (this.selectedId) this.buildConstellation(this.selectedId);
    this.toneAmbientEdges();
    this.toneConstellation();
    this.updateHighlights();
    if (!enabled) this.arContentScale = 1;
    this.backdrop.setPresentation(this.presentation());
  }

  /** Ambient context lines are tuned for a dark sky. Over a daylight camera feed they
   *  disappear entirely, so AR re-inks them darker and far more opaque. */
  private toneAmbientEdges() {
    const ar = this.arPresentation;
    this.ambientEdges.forEach((line, index) => {
      const material = line.material as LineBasicMaterial | LineDashedMaterial;
      const character = line.userData.character as "inferred" | "causal" | "related";
      const color = ar
        ? character === "inferred" ? 0x0b6278 : character === "causal" ? 0x8c285a : 0x174968
        : character === "inferred" ? 0x6de1f4 : character === "causal" ? 0xf1b7dd : 0x8ea6c0;
      material.opacity = ar ? .68 : AMBIENT_EDGE_OPACITY;
      (material as LineBasicMaterial).color.set(color);
      const tube = this.ambientTubes[index];
      if (!tube) return;
      tube.visible = ar;
      const tubeMaterial = tube.material as MeshBasicMaterial;
      tubeMaterial.color.set(color);
      tubeMaterial.opacity = ar ? .32 : 0;
    });
  }

  /** The focused constellation must stay legible over a bright feed: darker saturated
   *  ink, full opacity on active legs, and normal-blended sparks that read as beads. */
  private toneConstellation() {
    const ar = this.arPresentation;
    this.constellation.forEach((item) => {
      const inferred = isInferredGraphEdge(item.edge);
      const causal = isCausalRelation(item.edge);
      const character = ar
        ? inferred ? 0x087a9a : causal ? 0xa52f69 : 0x155a82
        : inferred ? 0x6de1f4 : causal ? 0xf1b7dd : 0x8ea6c0;
      (item.material as LineBasicMaterial).color.set(character);
      item.tubeMaterial.color.set(character);
      const spark = item.spark.material as SpriteMaterial;
      spark.blending = ar ? this.THREE.NormalBlending : this.THREE.AdditiveBlending;
      spark.opacity = ar ? 1 : .85;
      const storedScale = Number(item.spark.userData.baseWorldScale);
      const baseScale = Number.isFinite(storedScale) ? storedScale : item.spark.scale.x;
      item.spark.userData.baseWorldScale = baseScale;
      item.spark.scale.setScalar(baseScale * (ar ? 1.7 : 1));
    });
  }

  /** Sector landmarks shrink into the AR mini-map and return to full sky scale after it. */
  private applyBeaconScale() {
    const mini = this.arPresentation;
    this.beacons.forEach((beacon, index) => {
      const halo = beacon.group.children[0] as Sprite;
      const pillar = beacon.group.children[1] as Line;
      const baseScale = Number(halo.userData.baseWorldScale);
      const baseOpacity = Number(halo.userData.baseOpacity);
      const pillarOpacity = Number(pillar.userData.baseOpacity);
      const baseWidth = Number(beacon.label.userData.baseWidth);
      if (mini) {
        // Only the strongest sectors stay named on a tabletop; the rest keep a faint halo.
        const named = index < 6;
        if (Number.isFinite(baseScale)) halo.scale.setScalar(baseScale * .35);
        if (Number.isFinite(baseOpacity)) {
          // Additive halos turn into milky white discs over a bright feed: in AR they
          // become quiet tinted stains instead.
          (halo.material as SpriteMaterial).blending = this.THREE.NormalBlending;
          (halo.material as SpriteMaterial).opacity = baseOpacity * .55;
        }
        if (Number.isFinite(pillarOpacity)) (pillar.material as LineBasicMaterial).opacity = pillarOpacity * .5;
        beacon.label.visible = named;
        if (named && Number.isFinite(baseWidth)) {
          const width = Math.max(baseWidth * .5, 2.2);
          beacon.label.scale.set(width, width * BEACON_LABEL_HEIGHT_RATIO, 1);
        }
      } else {
        if (Number.isFinite(baseScale)) halo.scale.setScalar(baseScale);
        if (Number.isFinite(pillarOpacity)) (pillar.material as LineBasicMaterial).opacity = pillarOpacity;
        if (Number.isFinite(baseOpacity)) {
          (halo.material as SpriteMaterial).blending = this.THREE.AdditiveBlending;
          (halo.material as SpriteMaterial).opacity = baseOpacity;
        }
        if (Number.isFinite(baseWidth)) beacon.label.scale.set(baseWidth, baseWidth * BEACON_LABEL_HEIGHT_RATIO, 1);
        beacon.label.visible = true;
      }
    });
  }

  private presentation(): "screen" | "ar" | "vr" {
    if (this.arPresentation) return "ar";
    return this.vrPresentation ? "vr" : "screen";
  }

  /**
   * The live content scale of the AR placement (graph units → physical metres). Star
   * sprites are sized physically by the shader and need no compensation; pick tolerance
   * and the ghost preview read the scale from here.
   */
  setArContentScale(scale: number) {
    if (Number.isFinite(scale) && scale > 0) this.arContentScale = scale;
  }
  /**
   * Point-cloud picking tolerance in world (graph) units. In AR the constellation is
   * scaled to physical metres, so the slop must follow: eight physical centimetres is a
   * forgiving fingertip target that still cannot swallow a neighbour at tabletop scale.
   */
  pickTolerance(): number {
    if (!this.arPresentation || !Number.isFinite(this.arContentScale) || this.arContentScale <= 0) return .42;
    return this.THREE.MathUtils.clamp(.08 / this.arContentScale, .08, .42);
  }
  /** Bounds of the revealed constellation in graph coordinates, for the AR ghost preview. */
  contentBounds(): { center: Vector3; size: Vector3 } {

    const box = new this.THREE.Box3();
    this.visuals.forEach((visual) => box.expandByPoint(visual.position));
    const center = new this.THREE.Vector3();
    const size = new this.THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    return { center, size };
  }

  /** Visual position of a node in world (graph) coordinates. */
  positionOf(id: string): Vector3 | undefined {
    return this.visuals.get(id)?.position;
  }

  /**
   * Nearest revealed constellation to the listener in world coordinates. The drone follows
   * the cluster the visitor is actually near — selection included — instead of one pinned node.
   */
  nearestPosition(camera: { getWorldPosition(target: Vector3): Vector3 }): Vector3 | undefined {
    this.root.updateWorldMatrix(true, false);
    camera.getWorldPosition(this.probeEar);
    let best: Vector3 | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    this.visuals.forEach((visual) => {
      if (!visual.revealed) return;
      if (this.selectedId && !visual.mesh?.visible) return;
      this.probePoint.copy(visual.position);
      this.root.localToWorld(this.probePoint);
      const distance = this.probePoint.distanceTo(this.probeEar);
      if (distance < bestDistance) { bestDistance = distance; best = visual.position; }
    });
    return best ?? this.visuals.get(this.selectedId ?? "")?.position;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeConstellation();
    // The backdrop owns its geometry and materials; release them before the generic
    // traversal so every buffer is freed exactly once, by the owner that created it.
    this.backdrop.dispose();
    this.root.traverse((object) => {
      const renderObject = object as Mesh | Line | Sprite | Points;
      const geometry = renderObject.geometry as BufferGeometry | undefined;
      // Interactive and optical meshes share their sphere buffers.
      if (geometry && geometry !== this.sharedSphereGeometry && geometry !== this.opticalSphereGeometry) geometry.dispose?.();
      const material = renderObject.material as Material | Material[] | undefined;
      if (Array.isArray(material)) material.forEach((item) => item.dispose()); else material?.dispose?.();
    });
    this.visuals.forEach((visual) => {
      const map = (visual.label?.material as SpriteMaterial | undefined)?.map;
      map?.dispose();
    });
    this.beacons.forEach((beacon) => (beacon.label.material as SpriteMaterial).map?.dispose());
    this.sharedSphereGeometry.dispose();
    this.opticalSphereGeometry.dispose();
    this.glowTexture.dispose();
    (this.focusReticle.material as SpriteMaterial).map?.dispose();
    this.sharedMeshMaterial.dispose();
  }
}
