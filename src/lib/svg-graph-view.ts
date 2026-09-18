/**
 * Pan and zoom for a graph drawn inside one SVG: the wheel scales around the
 * pointer, dragging moves the view, a double click returns to the fitted picture.
 * A drag that ends on a node must not also open it, so the click that follows a
 * real drag is swallowed.
 */
const ns = "http://www.w3.org/2000/svg";

export interface GraphView {
  /** The group every renderer draws into: it carries the pan/zoom transform. */
  layer: SVGGElement;
  reset: () => void;
}

export interface GraphViewOptions {
  minScale?: number;
  maxScale?: number;
  /** Touch dragging is opt-in, so a stage that scrolls natively keeps its gestures. */
  touch?: boolean;
}

export function mountGraphView(svg: SVGSVGElement, options: GraphViewOptions = {}): GraphView {
  const { minScale = 0.6, maxScale = 3, touch = false } = options;
  let layer = svg.querySelector<SVGGElement>("[data-graph-view]");
  if (!layer) {
    layer = document.createElementNS(ns, "g");
    layer.setAttribute("data-graph-view", "");
    svg.append(layer);
  }
  const target = layer;
  let scale = 1;
  let x = 0;
  let y = 0;
  let armed = false;
  let dragging = false;
  let dragged = false;
  let last = { x: 0, y: 0 };

  const apply = () => target.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)})`);
  /* Screen pixels to view-box units at the current fit. */
  const toView = (dx: number, dy: number) => {
    const factor = svg.getScreenCTM()?.a || 1;
    return { x: dx / factor, y: dy / factor };
  };

  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const next = Math.min(maxScale, Math.max(minScale, scale * Math.exp(-event.deltaY * 0.0015)));
    const ratio = next / scale;
    x = point.x - (point.x - x) * ratio;
    y = point.y - (point.y - y) * ratio;
    scale = next;
    apply();
  }, { passive: false });

  /* Touch keeps one finger for the page: a second finger turns the gesture into
     pan and pinch, so a phone can still scroll past the graph. */
  const active = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; centre: { x: number; y: number } } | undefined;

  const zoom = (factor: number, point: DOMPoint) => {
    const next = Math.min(maxScale, Math.max(minScale, scale * factor));
    const ratio = next / scale;
    x = point.x - (point.x - x) * ratio;
    y = point.y - (point.y - y) * ratio;
    scale = next;
    apply();
  };

  svg.addEventListener("dragstart", (event) => event.preventDefault());

  svg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || (!touch && event.pointerType !== "mouse")) return;
    active.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (active.size > 1) {
      const [first, second] = [...active.values()];
      pinch = { distance: Math.hypot(first.x - second.x, first.y - second.y), centre: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 } };
      armed = false;
      return;
    }
    /* Nothing is captured yet: capturing on press would retarget the click away
       from the node under the cursor, and a plain click has to open it. */
    armed = true;
    dragging = false;
    dragged = false;
    last = { x: event.clientX, y: event.clientY };
  });

  svg.addEventListener("pointermove", (event) => {
    if (active.has(event.pointerId)) active.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && active.size > 1) {
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const [first, second] = [...active.values()];
      const centre = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      const factor = matrix.a || 1;
      x += (centre.x - pinch.centre.x) / factor;
      y += (centre.y - pinch.centre.y) / factor;
      apply();
      zoom(distance / Math.max(1, pinch.distance), new DOMPoint(centre.x, centre.y).matrixTransform(matrix.inverse()));
      pinch = { distance, centre };
      return;
    }
    if (!armed) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    if (!dragging) {
      if (Math.abs(dx) + Math.abs(dy) < 3) return;
      dragging = true;
      dragged = true;
      svg.setPointerCapture(event.pointerId);
      svg.classList.add("is-panning");
    }
    const delta = toView(dx, dy);
    last = { x: event.clientX, y: event.clientY };
    x += delta.x;
    y += delta.y;
    apply();
  });

  const finish = (event: PointerEvent) => {
    active.delete(event.pointerId);
    if (active.size < 2) pinch = undefined;
    armed = false;
    if (!dragging) return;
    dragging = false;
    svg.classList.remove("is-panning");
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  };
  svg.addEventListener("pointerup", finish);
  svg.addEventListener("pointercancel", finish);

  svg.addEventListener("click", (event) => {
    if (!dragged) return;
    event.preventDefault();
    event.stopPropagation();
    dragged = false;
  }, true);

  const reset = () => {
    scale = 1;
    x = 0;
    y = 0;
    apply();
  };
  svg.addEventListener("dblclick", reset);
  apply();
  return { layer: target, reset };
}
