import * as THREE from "three-mindar";
import type { CardQuality } from "../../config/cardPortal";
import type { CardPortalGraph, PortalNode } from "./graphSubset";

/**
 * The world behind the card. Everything lives in target-plane coordinates:
 * the card face is z = 0, the portal looks into negative z, and the camera that
 * MindAR drives provides the parallax that makes the depth read as real.
 */

const KIND_COLOR: Record<string, number> = { core: 0xeef5ff, hub: 0x79d7f2, work: 0xf1d18a, project: 0x79d7f2, experiment: 0xa7d7b4, topic: 0xc1acd9, memory: 0x94aac8 };
const CLUSTER_CENTER: Record<PortalNode["cluster"], [number, number, number]> = {
  core: [0, 0, -0.24],
  works: [-0.2, 0.17, -0.32],
  projects: [0.2, 0.17, -0.42],
  lab: [-0.2, -0.16, -0.53],
  garden: [0.2, -0.16, -0.72],
};
/** Reveal beats (seconds since first found), tuned to feel like one motion. */
const REVEAL = { frame: [0, 0.3], void: [0.3, 0.9], points: [0.3, 0.95], core: [0.7, 1.5], nodes: [1.0, 1.9], lines: [1.4, 2.2] } as const;

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}
function noise(id: string, salt: number) {
  return (hash(`${id}:${salt}`) % 10000) / 5000 - 1;
}
function roundedRectGeometry(width: number, height: number, radius: number) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return new THREE.ShapeGeometry(shape);
}
function stageProgress(elapsed: number, [start, end]: readonly [number, number]) {
  return THREE.MathUtils.smoothstep(THREE.MathUtils.clamp((elapsed - start) / (end - start), 0, 1), 0, 1);
}

export interface PortalScene {
  group: THREE.Group;
  reveal(): void;
  setLost(lost: boolean): void;
  update(now: number): void;
  meshFor(nodeId: string): THREE.Mesh | undefined;
  dispose(): void;
}

export function buildPortalScene(graph: CardPortalGraph, config: { targetAspect: number; portalScale: number }, quality: CardQuality): PortalScene {
  const width = config.portalScale;
  const height = width / config.targetAspect;
  const group = new THREE.Group();
  group.visible = false;

  // The aperture: stencil-writing mask first, then a stencil-tested dark plane
  // slightly behind the paper so the surface reads as having fallen inward.
  const mask = new THREE.Mesh(roundedRectGeometry(width, height, 0.035), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp }));
  mask.renderOrder = 0;
  group.add(mask);
  const voidMaterial = new THREE.MeshBasicMaterial({ color: 0x01040b, transparent: true, opacity: 0, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp });
  const voidPlane = new THREE.Mesh(roundedRectGeometry(width, height, 0.035), voidMaterial);
  voidPlane.position.z = -0.006;
  voidPlane.renderOrder = 1;
  group.add(voidPlane);
  const frameMaterial = new THREE.LineBasicMaterial({ color: 0x79d7f2, transparent: true, opacity: 0 });
  const frame = new THREE.LineLoop(new THREE.EdgesGeometry(roundedRectGeometry(width, height, 0.035)), frameMaterial);
  frame.position.z = 0.003;
  frame.renderOrder = 5;
  group.add(frame);

  const content = new THREE.Group();
  content.renderOrder = 2;
  group.add(content);

  // Interactive stars: core, hubs, curated foreground, topic stars. Background
  // memory is a single Points cloud, never hundreds of meshes.
  const interactive = graph.nodes.filter((node) => node.synthetic || ["work", "project", "experiment", "topic"].includes(node.kind)).slice(0, 26);
  const meshByNode = new Map<string, THREE.Mesh>();
  const starMaterials: THREE.MeshBasicMaterial[] = [];
  const haloMaterials: THREE.SpriteMaterial[] = [];
  for (const node of interactive) {
    const [cx, cy, cz] = CLUSTER_CENTER[node.cluster];
    const isCore = node.portalKind === "core";
    const isHub = node.portalKind === "hub";
    const position = new THREE.Vector3(cx, cy, cz);
    if (!isCore && !isHub) position.add(new THREE.Vector3(noise(node.id, 1) * 0.105, noise(node.id, 2) * 0.075, noise(node.id, 3) * 0.18));
    const radius = isCore ? 0.024 : isHub ? 0.017 : node.featured ? 0.012 : 0.008;
    const material = new THREE.MeshBasicMaterial({ color: KIND_COLOR[node.portalKind] ?? 0x94aac8, transparent: true, opacity: 0, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp });
    starMaterials.push(material);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, quality === "low" ? 8 : 12, 8), material);
    mesh.position.copy(position);
    mesh.userData.node = node;
    mesh.userData.baseOpacity = node.featured || isCore || isHub ? 0.95 : 0.82;
    mesh.userData.stagger = hash(node.id) % 350 / 1000;
    mesh.renderOrder = 3;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ color: KIND_COLOR[node.portalKind] ?? 0x94aac8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp }));
    halo.scale.setScalar(radius * 5);
    halo.userData.baseOpacity = isCore || isHub ? 0.2 : 0.09;
    mesh.add(halo);
    haloMaterials.push(halo.material as THREE.SpriteMaterial);
    content.add(mesh);
    meshByNode.set(node.id, mesh);
  }

  const linePoints: number[] = [];
  for (const edge of graph.edges) {
    const from = meshByNode.get(edge.source);
    const to = meshByNode.get(edge.target);
    if (from && to) linePoints.push(from.position.x, from.position.y, from.position.z, to.position.x, to.position.y, to.position.z);
  }
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePoints, 3));
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x79d7f2, transparent: true, opacity: 0, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp });
  const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
  lines.renderOrder = 2;
  content.add(lines);

  // Background memory. The garden quadrant keeps a visibly deeper, denser tail:
  // the visible patch must read as a small window into a much larger archive.
  const backgroundCount = quality === "low" ? 55 : quality === "medium" ? 85 : 120;
  const positions = new Float32Array(backgroundCount * 3);
  for (let index = 0; index < backgroundCount; index += 1) {
    const inGarden = index % 2 === 0;
    positions[index * 3] = inGarden ? 0.02 + Math.abs(noise(`bg${index}`, 1)) * 0.22 : noise(`bg${index}`, 1) * width * 0.48;
    positions[index * 3 + 1] = inGarden ? -0.02 - Math.abs(noise(`bg${index}`, 2)) * 0.16 : noise(`bg${index}`, 2) * height * 0.48;
    positions[index * 3 + 2] = -0.18 - Math.abs(noise(`bg${index}`, 3)) * (inGarden ? 1.15 : 0.8);
  }
  const pointsGeometry = new THREE.BufferGeometry();
  pointsGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const pointsMaterial = new THREE.PointsMaterial({ color: 0x94aac8, size: 0.004, transparent: true, opacity: 0, depthWrite: false, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp });
  const points = new THREE.Points(pointsGeometry, pointsMaterial);
  points.renderOrder = 2;
  content.add(points);

  let revealedAt = 0;
  let lost = false;
  let lostBlend = 1;
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return {
    group,
    reveal() {
      group.visible = true;
      revealedAt ||= performance.now();
    },
    setLost(value: boolean) {
      lost = value;
    },
    update(now: number) {
      const elapsed = revealedAt ? (now - revealedAt) / 1000 : 0;
      const motionScale = reducedMotion() ? 0 : 1;
      lostBlend += ((lost ? 0.32 : 1) - lostBlend) * 0.12;
      const dim = stageProgress(elapsed, REVEAL.frame);
      frameMaterial.opacity = 0.45 * dim * lostBlend;
      voidMaterial.opacity = 0.94 * stageProgress(elapsed, REVEAL.void) * lostBlend;
      pointsMaterial.opacity = 0.58 * stageProgress(elapsed, REVEAL.points) * lostBlend;
      lineMaterial.opacity = 0.14 * stageProgress(elapsed, REVEAL.lines) * lostBlend;
      for (const mesh of meshByNode.values()) {
        const node = mesh.userData.node as PortalNode;
        const nodeProgress = node.portalKind === "core" ? stageProgress(elapsed, REVEAL.core) : stageProgress(elapsed, [REVEAL.nodes[0] + (mesh.userData.stagger as number), REVEAL.nodes[1] + (mesh.userData.stagger as number)]);
        const selected = mesh.userData.selectedOpacity ?? mesh.userData.baseOpacity;
        (mesh.material as THREE.MeshBasicMaterial).opacity = selected * nodeProgress * lostBlend;
        ((mesh.children[0] as THREE.Sprite).material as THREE.SpriteMaterial).opacity = ((mesh.userData.baseOpacity as number) / 4) * nodeProgress * lostBlend * (1 + motionScale * 0.18 * Math.sin(now / 1300 + hash(node.id) % 7));
        mesh.scale.setScalar(nodeProgress * (mesh.userData.pulse as number ?? 1));
      }
      if (revealedAt && !reducedMotion()) {
        content.rotation.z = Math.sin(now * 0.00016) * 0.006;
        content.position.y = Math.sin(now * 0.00011) * 0.004;
      }
    },
    meshFor(nodeId: string) {
      return meshByNode.get(nodeId);
    },
    dispose() {
      for (const object of [mask, voidPlane, frame, lines, points, ...meshByNode.values()]) {
        object.geometry.dispose();
        const material = object.material as THREE.Material | THREE.Material[];
        (Array.isArray(material) ? material : [material]).forEach((entry) => entry.dispose());
      }
      for (const mesh of meshByNode.values()) ((mesh.children[0] as THREE.Sprite).material as THREE.SpriteMaterial).dispose();
      group.clear();
    },
  };
}
