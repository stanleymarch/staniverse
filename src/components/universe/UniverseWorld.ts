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
import { UniverseBackdrop, createPointCloudMaterial, pointCloudAttributes, pointCloudGeometry, pointViewport, seeded } from "./UniverseBackdrop";

export type ThreeModule = typeof import("three");

export interface WorldNodeVisual {
  node: GraphNode;
  mesh?: Mesh;
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

function cleanTitle(value: string, limit = 34) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
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
  private readonly glowTexture: CanvasTexture;
  private readonly starPoints: Points;
  private readonly starMaterial: ShaderMaterial;
  private readonly backdrop: UniverseBackdrop;
  private readonly ambientEdges: Line[] = [];
  private constellation: Array<{ line: Line; material: Material; edge: GraphEdge }> = [];
  private readonly motionQuery = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : undefined;
  private disposed = false;
  private vrPresentation = false;

  private constructor(
    host: UniverseWorldHost,
    graph: { nodes: GraphNode[]; edges: GraphEdge[] },
    options: UniverseWorldOptions,
  ) {
    this.THREE = host.THREE;
    this.nodes = graph.nodes;
    this.edges = graph.edges;
    this.compact = options.compact;
    this.root = new this.THREE.Group();
    host.scene.add(this.root);
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
    this.sharedSphereGeometry = new this.THREE.SphereGeometry(1, options.compact ? 9 : 14, options.compact ? 9 : 14);
    this.sharedMeshMaterial = new this.THREE.MeshBasicMaterial({ color: 0xc4d3e3, transparent: true, opacity: 1 });

    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = 96;
    glowCanvas.height = 96;
    const glowContext = glowCanvas.getContext("2d");
    if (!glowContext) throw new Error("Glow canvas is unavailable");
    const glowGradient = glowContext.createRadialGradient(48, 48, 1, 48, 48, 47);
    glowGradient.addColorStop(0, "rgba(255,255,255,1)");
    glowGradient.addColorStop(.22, "rgba(255,255,255,.42)");
    glowGradient.addColorStop(1, "rgba(255,255,255,0)");
    glowContext.fillStyle = glowGradient;
    glowContext.fillRect(0, 0, 96, 96);
    this.glowTexture = new this.THREE.CanvasTexture(glowCanvas);

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
    const palette = new this.THREE.Color() as Color;
    this.nodes.forEach((node, index) => {
      const visual = this.visuals.get(node.id)!;
      stars.positions[index * 3] = visual.position.x;
      stars.positions[index * 3 + 1] = visual.position.y;
      stars.positions[index * 3 + 2] = visual.position.z;
      palette.set(NODE_COLORS[node.kind] ?? 0xc4d3e3);
      stars.colors[index * 3] = palette.r;
      stars.colors[index * 3 + 1] = palette.g;
      stars.colors[index * 3 + 2] = palette.b;
      stars.sizes[index] = (node.featured ? .34 : visual.layer === "core" ? .27 : visual.layer === "neighborhood" ? .2 : .14) * this.prominence(node.id) * (options.compact ? .85 : 1);
      const rng = seeded(`star|${node.id}`);
      stars.phases[index] = rng();
      stars.twinkles[index] = .4 + rng() * .6;
    });
    const starGeometry = pointCloudGeometry(this.THREE, stars);
    this.starMaterial = createPointCloudMaterial(this.THREE, { softness: 2.6, core: 5.5, opacity: .9, additive: true }, pointViewport());
    this.starPoints = new this.THREE.Points(starGeometry, this.starMaterial);
    this.root.add(this.starPoints);

    // Dust and nebulae live with the content so they follow it into tabletop AR.
    this.backdrop = UniverseBackdrop.create({ THREE: this.THREE, parent: this.root, compact: options.compact });

    selectVisualEdges(this.edges, options.compact ? AMBIENT_EDGE_BUDGET.compact : AMBIENT_EDGE_BUDGET.full, .55).forEach((edge) => {
      const source = this.visuals.get(edge.source);
      const target = this.visuals.get(edge.target);
      if (!source || !target) return;
      const geometry = new this.THREE.BufferGeometry().setFromPoints([source.position, target.position]);
      const material = isInferredGraphEdge(edge)
        ? new this.THREE.LineDashedMaterial({ color: 0x6de1f4, transparent: true, opacity: AMBIENT_EDGE_OPACITY, dashSize: .32, gapSize: .22 })
        : new this.THREE.LineBasicMaterial({ color: isCausalRelation(edge) ? 0xf1b7dd : 0x8ea6c0, transparent: true, opacity: AMBIENT_EDGE_OPACITY });
      const line = new this.THREE.Line(geometry, material);
      if (isInferredGraphEdge(edge)) line.computeLineDistances();
      this.root.add(line);
      this.ambientEdges.push(line);
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

  private labelFor(text: string) {
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 600;
    labelCanvas.height = 80;
    const context = labelCanvas.getContext("2d");
    if (!context) return undefined;
    context.font = "500 24px Geologica, sans-serif";
    context.textAlign = "center";
    context.fillStyle = "rgba(235,244,255,.92)";
    context.fillText(cleanTitle(text), 300, 47);
    const texture = new this.THREE.CanvasTexture(labelCanvas);
    const sprite = new this.THREE.Sprite(new this.THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    const presentationScale = this.vrPresentation ? .12 : 1;
    sprite.scale.set(7.4 * presentationScale, .98 * presentationScale, 1);
    sprite.position.y = -1.05 * (this.vrPresentation ? .35 : 1);
    return { sprite, texture };
  }

  /** Interactive mesh for one node, created on demand and cached for the session. */
  private ensureMesh(id: string) {
    const visual = this.visuals.get(id);
    if (!visual || visual.mesh || this.disposed) return visual;
    const mesh = new this.THREE.Mesh(this.sharedSphereGeometry, this.sharedMeshMaterial.clone());
    mesh.scale.setScalar(visual.radius);
    mesh.position.copy(visual.position);
    mesh.userData.nodeId = id;
    mesh.visible = false;
    this.root.add(mesh);
    visual.mesh = mesh;
    if (!this.compact || visual.layer !== "archive") {
      const aura = new this.THREE.Sprite(new this.THREE.SpriteMaterial({ map: this.glowTexture, color: NODE_COLORS[visual.node.kind] ?? 0xc4d3e3, transparent: true, opacity: 0, blending: this.THREE.AdditiveBlending, depthWrite: false }));
      const auraSize = this.compact
        ? visual.node.featured ? 1.8 : visual.layer === "core" ? 1.35 : .7
        : visual.node.featured ? 2.9 : visual.layer === "core" ? 2.1 : visual.layer === "neighborhood" ? 1.05 : .42;
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
    const material = visual.mesh.material as MeshBasicMaterial;
    material.opacity = visual.layer === "archive" ? .26 : 1;
    if (visual.aura) (visual.aura.material as SpriteMaterial).opacity = visual.node.featured ? .58 : visual.layer === "core" ? .35 : visual.layer === "neighborhood" ? .16 : .025;
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
  /** The point cloud makes every visible star pickable without allocating one mesh per archive item. */
  pickableObjects(): Array<Mesh | Points> {
    return this.selectedId ? this.pickableMeshes() : [this.starPoints, ...this.pickableMeshes()];
  }

  nodeIdFromPick(object: Mesh | Points, pointIndex?: number) {
    if (object === this.starPoints) return pointIndex === undefined ? undefined : this.nodes[pointIndex]?.id;
    return (object.userData as { nodeId?: string }).nodeId;
  }

  private disposeConstellation() {
    this.constellation.forEach(({ line, material }) => {
      line.geometry.dispose();
      material.dispose();
      this.root.remove(line);
    });
    this.constellation = [];
  }

  private buildConstellation(id: string) {
    this.disposeConstellation();
    const adjacency = (this.edgesByNode.get(id) ?? []).map(({ edge }) => edge);
    const budget = this.compact ? 72 : 180;
    selectVisualEdges(adjacency, budget, 0).forEach((edge) => {
      const source = this.visuals.get(edge.source);
      const target = this.visuals.get(edge.target);
      if (!source || !target) return;
      const geometry = new this.THREE.BufferGeometry().setFromPoints([source.position, target.position]);
      const material = isInferredGraphEdge(edge)
        ? new this.THREE.LineDashedMaterial({ color: 0x6de1f4, transparent: true, opacity: .92, dashSize: .32, gapSize: .22 })
        : new this.THREE.LineBasicMaterial({ color: isCausalRelation(edge) ? 0xf1b7dd : 0x8ea6c0, transparent: true, opacity: .92 });
      const line = new this.THREE.Line(geometry, material);
      if (isInferredGraphEdge(edge)) line.computeLineDistances();
      this.root.add(line);
      this.constellation.push({ line, material, edge });
    });
  }

  updateHighlights() {
    const direct = this.selectedId ? this.neighbors.get(this.selectedId) ?? new Set<string>() : new Set<string>();
    this.visuals.forEach((visual) => {
      if (!visual.mesh) return;
      const material = visual.mesh.material as MeshBasicMaterial;
      const isPath = this.selectedId === visual.node.id || direct.has(visual.node.id);
      visual.mesh.visible = !this.selectedId || isPath;
      if (visual.label) visual.label.visible = Boolean(this.selectedId && isPath);
      material.opacity = visual.layer === "archive" ? (isPath ? .7 : .18) : (this.selectedId && !isPath ? .48 : 1);
      const emphasis = this.selectedId === visual.node.id ? 1.42 : direct.has(visual.node.id) ? 1.15 : 1;
      visual.mesh.scale.setScalar(visual.radius * emphasis);
    });
    this.ambientEdges.forEach((line) => {
      line.visible = !this.selectedId;
      (line.material as LineBasicMaterial | LineDashedMaterial).opacity = AMBIENT_EDGE_OPACITY;
    });
    this.constellation.forEach(({ line, edge, material }) => {
      line.visible = true;
      const active = edge.source === this.selectedId || edge.target === this.selectedId;
      (material as LineBasicMaterial | LineDashedMaterial).opacity = active ? .92 : .08;
    });
    this.starMaterial.uniforms.uOpacity.value = this.selectedId ? .34 : .9;
  }

  /**
   * Optional per-frame animation: star twinkle, the audio response and the backdrop.
   * Node coordinates never change, so picking stays exactly where it was. A world that
   * is never updated simply renders as a still star field.
   */
  update(elapsedSeconds: number, audioEnergy = 0) {
    if (this.disposed) return;
    const motion = !this.motionQuery?.matches;
    const energy = Math.max(0, Math.min(1, audioEnergy));
    const viewport = pointViewport();
    this.starMaterial.uniforms.uTime.value = motion ? elapsedSeconds : 0;
    this.starMaterial.uniforms.uEnergy.value = energy * (motion ? 1 : .45);
    this.starMaterial.uniforms.uPixelRatio.value = viewport.pixelRatio;
    this.starMaterial.uniforms.uScale.value = viewport.scale;
    this.backdrop.update(elapsedSeconds, energy);
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
    this.visuals.forEach((visual) => {
      if (visual.aura) {
        const baseWorldScale = Number(visual.aura.userData.baseWorldScale);
        if (Number.isFinite(baseWorldScale)) visual.aura.scale.setScalar((baseWorldScale * auraScale) / visual.radius);
      }
      if (visual.label) {
        visual.label.scale.set(7.4 * labelScale / visual.radius, .98 * labelScale / visual.radius, 1);
        visual.label.position.y = -1.05 * labelOffset / visual.radius;
      }
    });
  }

  /** Visual position of a node in world (graph) coordinates. */
  positionOf(id: string): Vector3 | undefined {
    return this.visuals.get(id)?.position;
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
      // Every revealed mesh shares one sphere geometry: disposing it per mesh would release the same
      // GPU buffer once per node, so the shared instance is released exactly once below.
      if (geometry && geometry !== this.sharedSphereGeometry) geometry.dispose?.();
      const material = renderObject.material as Material | Material[] | undefined;
      if (Array.isArray(material)) material.forEach((item) => item.dispose()); else material?.dispose?.();
    });
    this.visuals.forEach((visual) => {
      const map = (visual.label?.material as SpriteMaterial | undefined)?.map;
      map?.dispose();
    });
    this.sharedSphereGeometry.dispose();
    this.glowTexture.dispose();
    this.sharedMeshMaterial.dispose();
  }
}
