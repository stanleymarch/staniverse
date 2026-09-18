/**
 * Force-directed placement shared by every graph on the site: the garden map and
 * the local neighbourhood on a material page. It is a miniature Fruchterman–
 * Reingold — every pair repels, every drawn link pulls, a weak centring force
 * keeps separate clusters out of the corners — which is all a few dozen nodes
 * need, and cheap enough to run again on every depth change.
 *
 * The simulation is deterministic: the seed comes from the node ids, so the same
 * selection always produces the same picture and a re-render never makes the map
 * jump under the reader's cursor.
 */

export interface ForceLayoutOptions {
  width: number;
  height: number;
  /** Inset kept free around the box: node circles and labels live inside it. */
  padding?: number;
  /** Fixed step count: the cost stays predictable, the result stays stable. */
  steps?: number;
  /** Smallest distance kept between two nodes, in the same units as the box. */
  separation?: number;
}

export interface ForcePoint {
  x: number;
  y: number;
}

/** FNV-1a over the ids, then mulberry32: the only randomness in the layout. */
function seededRandom(keys: readonly string[]): () => number {
  let seed = 2166136261;
  for (const key of keys) {
    for (let index = 0; index < key.length; index += 1) {
      seed ^= key.charCodeAt(index);
      seed = Math.imul(seed, 16777619);
    }
  }
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function forceLayout(
  ids: readonly string[],
  links: ReadonlyArray<readonly [string, string]>,
  { width, height, padding = 48, steps = 320, separation = 40 }: ForceLayoutOptions,
): Map<string, ForcePoint> {
  const points = new Map<string, ForcePoint>();
  if (!ids.length) return points;
  const random = seededRandom(ids);
  const centre = { x: width / 2, y: height / 2 };
  const area = (width - padding * 2) * (height - padding * 2);
  const spacing = Math.sqrt(area / ids.length);
  ids.forEach((id, index) => {
    const angle = (index / ids.length) * Math.PI * 2 + random() * 0.7;
    const radius = spacing * (0.5 + random() * 0.5);
    points.set(id, { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius });
  });
  const springs = links.filter(([source, target]) => points.has(source) && points.has(target));
  let temperature = spacing * 0.6;
  const cooling = temperature / steps;
  for (let step = 0; step < steps; step += 1) {
    const shift = new Map<string, ForcePoint>(ids.map((id) => [id, { x: 0, y: 0 }]));
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = points.get(ids[i])!;
        const b = points.get(ids[j])!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.01) {
          dx = 0.01 + random() * 0.02;
          dy = 0.01 + random() * 0.02;
          distance = Math.hypot(dx, dy);
        }
        const force = (spacing * spacing) / distance;
        const ux = (dx / distance) * force;
        const uy = (dy / distance) * force;
        const left = shift.get(ids[i])!;
        const right = shift.get(ids[j])!;
        left.x += ux; left.y += uy;
        right.x -= ux; right.y -= uy;
      }
    }
    for (const [source, target] of springs) {
      const a = points.get(source)!;
      const b = points.get(target)!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distance = Math.max(0.01, Math.hypot(dx, dy));
      const force = (distance * distance) / (spacing * 1.7);
      const ux = (dx / distance) * force;
      const uy = (dy / distance) * force;
      const left = shift.get(source)!;
      const right = shift.get(target)!;
      left.x -= ux; left.y -= uy;
      right.x += ux; right.y += uy;
    }
    for (const id of ids) {
      const point = points.get(id)!;
      const move = shift.get(id)!;
      move.x += (centre.x - point.x) * 0.02;
      move.y += (centre.y - point.y) * 0.02;
      const length = Math.max(0.01, Math.hypot(move.x, move.y));
      const limit = Math.min(length, temperature);
      point.x = Math.min(width - padding, Math.max(padding, point.x + (move.x / length) * limit));
      point.y = Math.min(height - padding, Math.max(padding, point.y + (move.y / length) * limit));
    }
    temperature = Math.max(0.4, temperature - cooling);
  }
  /* The simulation settles the shape; this pass guarantees the room every dot
     needs, so two nodes are never drawn on top of each other. */
  if (separation > 0) {
    for (let pass = 0; pass < 40; pass += 1) {
      let crowded = false;
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const a = points.get(ids[i])!;
          const b = points.get(ids[j])!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.hypot(dx, dy);
          if (distance >= separation) continue;
          crowded = true;
          const ux = distance < 0.01 ? random() - 0.5 : dx / distance;
          const uy = distance < 0.01 ? random() - 0.5 : dy / distance;
          const push = (separation - distance) / 2;
          a.x = Math.min(width - padding, Math.max(padding, a.x - ux * push));
          a.y = Math.min(height - padding, Math.max(padding, a.y - uy * push));
          b.x = Math.min(width - padding, Math.max(padding, b.x + ux * push));
          b.y = Math.min(height - padding, Math.max(padding, b.y + uy * push));
        }
      }
      if (!crowded) break;
    }
  }
  return new Map(ids.map((id) => {
    const point = points.get(id)!;
    return [id, { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 }];
  }));
}
