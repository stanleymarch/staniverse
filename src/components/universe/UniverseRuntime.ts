import type { GraphEdge, GraphNode } from "../../lib/graph";

type GraphPayload = { nodes: GraphNode[]; edges: GraphEdge[] };
type ThreeModule = typeof import("three");
type NodeVisual = {
  node: GraphNode;
  mesh: import("three").Mesh;
  label?: import("three").Sprite;
  revealed: boolean;
  layer: "core" | "neighborhood" | "archive";
};
type EdgeVisual = {
  edge: GraphEdge;
  line: import("three").Line;
  material: import("three").LineBasicMaterial | import("three").LineDashedMaterial;
  source: NodeVisual;
  target: NodeVisual;
};

const NODE_COLORS: Record<string, number> = {
  work: 0x6de1f4,
  project: 0x94baff,
  article: 0xe5a8d1,
  "telegram-post": 0xa9bdd0,
  "telegram-article": 0xa9bdd0,
  "youtube-video": 0xc9b9a3,
  video: 0xc9b9a3,
  topic: 0xf1f6ff,
};
const NODE_LABELS: Record<string, string> = {
  work: "работа",
  project: "проект",
  article: "статья",
  "telegram-post": "публикация",
  "telegram-article": "публикация",
  "youtube-video": "видео",
  video: "видео",
  topic: "тема",
};

function seeded(seedText: string) {
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

function cleanTitle(value: string, limit = 34) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function mountFallback(root: HTMLElement, graph: GraphPayload) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const list = root.querySelector<HTMLElement>("[data-node-list]");
  const announcer = root.querySelector<HTMLElement>("[data-announcer]");
  const card = root.querySelector<HTMLElement>("[data-node-card]");
  const title = root.querySelector<HTMLElement>("[data-node-title]");
  const kind = root.querySelector<HTMLElement>("[data-node-kind]");
  const tags = root.querySelector<HTMLElement>("[data-node-tags]");
  const link = root.querySelector<HTMLAnchorElement>("[data-node-link]");
  const adjacent = new Map<string, GraphNode[]>();
  graph.edges.forEach((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) return;
    adjacent.set(source.id, [...(adjacent.get(source.id) ?? []), target]);
    adjacent.set(target.id, [...(adjacent.get(target.id) ?? []), source]);
  });

  const updateCard = (node: GraphNode) => {
    if (!card || !title || !kind || !tags || !link) return;
    card.hidden = false;
    kind.textContent = NODE_LABELS[node.kind] ?? node.kind;
    title.textContent = node.title;
    tags.replaceChildren(...node.tags.slice(0, 8).map((tag) => {
      const span = document.createElement("span");
      span.textContent = `#${tag}`;
      return span;
    }));
    link.href = node.href;
    if (announcer) announcer.textContent = `Выбран узел: ${node.title}.`;
  };
  const controller = new AbortController();
  list?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-node-id]");
    const node = button ? byId.get(button.dataset.nodeId ?? "") : undefined;
    if (node) updateCard(node);
  }, { signal: controller.signal });
  root.querySelector<HTMLInputElement>("[data-node-search]")?.addEventListener("change", (event) => {
    const value = (event.currentTarget as HTMLInputElement).value.trim().toLocaleLowerCase("ru-RU");
    const node = graph.nodes.find((item) => item.title.toLocaleLowerCase("ru-RU") === value);
    if (node) updateCard(node);
  }, { signal: controller.signal });
  return () => controller.abort();
}

class GenerativeRouteAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private oscillators: OscillatorNode[] = [];
  private enabled = false;
  private routeRoot = 110;

  private ensure() {
    if (this.context) return;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0.022;
    this.master.connect(this.context.destination);
    [1, 1.5, 2].forEach((ratio, index) => {
      const oscillator = this.context!.createOscillator();
      const gain = this.context!.createGain();
      oscillator.type = index === 1 ? "sine" : "triangle";
      gain.gain.value = .18 / (index + 1);
      oscillator.frequency.value = this.routeRoot * ratio;
      oscillator.connect(gain).connect(this.master!);
      oscillator.start();
      this.oscillators.push(oscillator);
    });
  }

  async toggle() {
    this.ensure();
    if (!this.context) return false;
    if (this.context.state === "suspended") await this.context.resume();
    this.enabled = !this.enabled;
    if (!this.enabled) await this.context.suspend();
    return this.enabled;
  }

  route(path: string) {
    let hash = 7;
    for (const character of path) hash = (hash * 31 + character.charCodeAt(0)) % 24;
    this.routeRoot = 82.5 + hash * 3.5;
    this.oscillators.forEach((oscillator, index) => {
      oscillator.frequency.setTargetAtTime(this.routeRoot * [1, 1.5, 2][index], this.context?.currentTime ?? 0, .18);
    });
  }

  dispose() {
    this.oscillators.forEach((oscillator) => oscillator.stop());
    this.oscillators = [];
    void this.context?.close();
    this.context = undefined;
  }
}

export async function mountUniverse() {
  const root = document.querySelector<HTMLElement>("[data-universe]");
  if (!root || root.dataset.universeMounted === "true") return;
  root.dataset.universeMounted = "true";

  let graph: GraphPayload;
  try {
    graph = JSON.parse(root.dataset.graph ?? "{}") as GraphPayload;
  } catch {
    root.dataset.motion = "reduced";
    return;
  }
  const fallbackCleanup = mountFallback(root, graph);
  const canvas = root.querySelector<HTMLCanvasElement>(".universe-canvas");
  if (!canvas) return;

  const dataById = new Map(graph.nodes.map((node) => [node.id, node]));
  const neighbors = new Map<string, Set<string>>();
  graph.edges.forEach((edge) => {
    if (!dataById.has(edge.source) || !dataById.has(edge.target)) return;
    if (!neighbors.has(edge.source)) neighbors.set(edge.source, new Set());
    if (!neighbors.has(edge.target)) neighbors.set(edge.target, new Set());
    neighbors.get(edge.source)!.add(edge.target);
    neighbors.get(edge.target)!.add(edge.source);
  });
  const nodeDegree = (id: string) => neighbors.get(id)?.size ?? 0;
  const focusFromUrl = () => new URLSearchParams(window.location.search).get("focus");
  const focusId = focusFromUrl();
  const initialIds = new Set<string>();
  if (focusId && dataById.has(focusId)) {
    initialIds.add(focusId);
    neighbors.get(focusId)?.forEach((id) => initialIds.add(id));
  }
  graph.nodes
    .slice()
    .sort((a, b) => Number(b.featured) - Number(a.featured) || nodeDegree(b.id) - nodeDegree(a.id))
    .slice(0, 11)
    .forEach((node) => initialIds.add(node.id));

  const controller = new AbortController();
  const timers: number[] = [];
  const audio = new GenerativeRouteAudio();
  const announce = (message: string) => {
    const element = root.querySelector<HTMLElement>("[data-announcer]");
    if (element) element.textContent = message;
  };

  try {
    // Keep Three out of the initial page chunk: the accessible list is usable while the scene loads.
    const THREE: ThreeModule = await import("three");
    const [{ VRButton }, { ARButton }] = await Promise.all([
      import("three/addons/webxr/VRButton.js"),
      import("three/addons/webxr/ARButton.js"),
    ]);
    if (root.isConnected === false) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.xr.enabled = true;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x02060e, .012);
    const camera = new THREE.PerspectiveCamera(58, 1, .1, 900);
    camera.position.set(0, 0, 40);
    const field = new THREE.Group();
    scene.add(field);
    const nodeVisuals = new Map<string, NodeVisual>();
    const seed = seeded(graph.nodes.map((node) => node.id).join("|"));

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
    const glowTexture = new THREE.CanvasTexture(glowCanvas);

    const labelFor = (text: string) => {
      const labelCanvas = document.createElement("canvas");
      labelCanvas.width = 600;
      labelCanvas.height = 80;
      const context = labelCanvas.getContext("2d");
      if (!context) return undefined;
      context.font = "500 24px Geologica, sans-serif";
      context.textAlign = "center";
      context.fillStyle = "rgba(235,244,255,.92)";
      context.fillText(cleanTitle(text), 300, 47);
      const texture = new THREE.CanvasTexture(labelCanvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
      sprite.scale.set(7.4, .98, 1);
      sprite.position.y = -1.05;
      return sprite;
    };

    graph.nodes.forEach((node, index) => {
      const neighborCount = nodeDegree(node.id);
      const layer: NodeVisual["layer"] = initialIds.has(node.id) ? "core" : neighborCount > 0 ? "neighborhood" : "archive";
      const ring = layer === "core" ? 5.2 : layer === "neighborhood" ? 12.5 : 23;
      const latitude = Math.acos(1 - (2 * (index + .5)) / Math.max(graph.nodes.length, 1));
      const longitude = index * Math.PI * (3 - Math.sqrt(5)) + seed() * .6;
      const position = new THREE.Vector3(
        ring * Math.cos(longitude) * Math.sin(latitude),
        ring * Math.sin(longitude) * Math.sin(latitude),
        ring * Math.cos(latitude),
      );
      const radius = node.featured ? .48 : layer === "core" ? .31 : layer === "neighborhood" ? .17 : .075;
      const geometry = new THREE.SphereGeometry(radius, layer === "archive" ? 8 : 14, layer === "archive" ? 8 : 14);
      const material = new THREE.MeshBasicMaterial({ color: NODE_COLORS[node.kind] ?? 0xc4d3e3, transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      mesh.userData.nodeId = node.id;
      const visual: NodeVisual = { node, mesh, revealed: false, layer };
      field.add(mesh);
      nodeVisuals.set(node.id, visual);
      const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: NODE_COLORS[node.kind] ?? 0xc4d3e3, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      aura.scale.setScalar(node.featured ? 4.7 : layer === "core" ? 3 : layer === "neighborhood" ? 1.7 : .72);
      mesh.add(aura);
      const labelBudget = 22;
      const shouldLabel = node.featured || (initialIds.has(node.id) && index < labelBudget);
      if (shouldLabel) {
        const label = labelFor(node.title);
        if (label) { visual.label = label; label.visible = false; mesh.add(label); }
      }
      mesh.userData.aura = aura;
    });

    const edgeVisuals: EdgeVisual[] = [];
    const lineBudget = 180;
    graph.edges
      .filter((edge) => edge.confidence >= .55)
      .sort((a, b) => Number(b.evidence === "topic") - Number(a.evidence === "topic") || b.confidence - a.confidence)
      .slice(0, lineBudget)
      .forEach((edge) => {
        const source = nodeVisuals.get(edge.source);
        const target = nodeVisuals.get(edge.target);
        if (!source || !target) return;
        const geometry = new THREE.BufferGeometry().setFromPoints([source.mesh.position, target.mesh.position]);
        const topicEdge = edge.evidence === "topic" || edge.type === "part-of";
        const material = topicEdge
          ? new THREE.LineDashedMaterial({ color: 0x6de1f4, transparent: true, opacity: 0, dashSize: .32, gapSize: .22 })
          : new THREE.LineBasicMaterial({ color: 0x8ea6c0, transparent: true, opacity: 0 });
        const line = new THREE.Line(geometry, material);
        if (topicEdge) line.computeLineDistances();
        field.add(line);
        edgeVisuals.push({ edge, line, material, source, target });
      });

    const dustPositions: number[] = [];
    for (let index = 0; index < 520; index += 1) {
      dustPositions.push((seed() - .5) * 140, (seed() - .5) * 90, (seed() - .5) * 120);
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute("position", new THREE.Float32BufferAttribute(dustPositions, 3));
    const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0x7d9cb7, size: .055, transparent: true, opacity: .34 }));
    scene.add(dust);

    const reveal = (visual: NodeVisual) => {
      visual.revealed = true;
      visual.mesh.visible = true;
      const material = visual.mesh.material as import("three").MeshBasicMaterial;
      material.opacity = visual.layer === "archive" ? .26 : 1;
      const aura = visual.mesh.userData.aura as import("three").Sprite;
      (aura.material as import("three").SpriteMaterial).opacity = visual.node.featured ? .58 : visual.layer === "core" ? .35 : visual.layer === "neighborhood" ? .16 : .025;
      if (visual.label) visual.label.visible = true;
    };
    nodeVisuals.forEach((visual) => { visual.mesh.visible = false; });
    [...nodeVisuals.values()]
      .filter((visual) => initialIds.has(visual.node.id))
      .forEach(reveal);
    [...nodeVisuals.values()]
      .filter((visual) => !visual.revealed)
      .sort((a, b) => Number(b.node.featured) - Number(a.node.featured) || nodeDegree(b.node.id) - nodeDegree(a.node.id))
      .forEach((visual, index) => {
        timers.push(window.setTimeout(() => reveal(visual), 500 + Math.min(index, 55) * 34));
      });

    let selectedId: string | null = null;
    let focusedHistoryDepth = 0;
    const updateBackButton = () => {
      const button = root.querySelector<HTMLButtonElement>("[data-history-back]");
      if (button) button.disabled = focusedHistoryDepth < 1;
    };
    const updateHighlights = () => {
      const direct = selectedId ? neighbors.get(selectedId) ?? new Set<string>() : new Set<string>();
      nodeVisuals.forEach((visual) => {
        const material = visual.mesh.material as import("three").MeshBasicMaterial;
        const isPath = selectedId === visual.node.id || direct.has(visual.node.id);
        material.opacity = visual.layer === "archive" ? (isPath ? .7 : .18) : (selectedId && !isPath ? .48 : 1);
        visual.mesh.scale.setScalar(selectedId === visual.node.id ? 1.42 : direct.has(visual.node.id) ? 1.15 : 1);
      });
      edgeVisuals.forEach(({ edge, line, material, source, target }) => {
        const active = Boolean(selectedId && (edge.source === selectedId || edge.target === selectedId));
        line.visible = source.revealed && target.revealed;
        material.opacity = selectedId ? (active ? .92 : .1) : (source.layer === "core" && target.layer === "core" ? .38 : .13);
        material.color.set(active ? 0x6de1f4 : edge.evidence === "topic" ? 0x6d9eb8 : 0x8ea6c0);
      });
    };
    const setCard = (node: GraphNode) => {
      const card = root.querySelector<HTMLElement>("[data-node-card]");
      const kind = root.querySelector<HTMLElement>("[data-node-kind]");
      const title = root.querySelector<HTMLElement>("[data-node-title]");
      const tags = root.querySelector<HTMLElement>("[data-node-tags]");
      const link = root.querySelector<HTMLAnchorElement>("[data-node-link]");
      const neighborsList = root.querySelector<HTMLElement>("[data-node-neighbor-list]");
      if (!card || !kind || !title || !tags || !link || !neighborsList) return;
      card.hidden = false;
      kind.textContent = NODE_LABELS[node.kind] ?? node.kind;
      title.textContent = node.title;
      tags.replaceChildren(...node.tags.slice(0, 8).map((tag) => { const span = document.createElement("span"); span.textContent = `#${tag}`; return span; }));
      link.href = node.href;
      neighborsList.replaceChildren(...[...(neighbors.get(node.id) ?? [])].map((id) => {
        const neighbor = dataById.get(id);
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.neighborId = id;
        button.textContent = neighbor?.title ?? id;
        button.title = neighbor?.title ?? id;
        return button;
      }));
    };
    const pushFocus = (id: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (id) params.set("focus", id); else params.delete("focus");
      const query = params.toString();
      history.pushState({ universeFocus: id }, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
      focusedHistoryDepth += 1;
      updateBackButton();
    };
    const focusNode = (node: GraphNode, push = true) => {
      const visual = nodeVisuals.get(node.id);
      if (!visual) return;
      if (push && selectedId !== node.id) pushFocus(node.id);
      selectedId = node.id;
      visual.revealed = true;
      reveal(visual);
      field.position.copy(visual.mesh.position).multiplyScalar(-1);
      setCard(node);
      updateHighlights();
      root.querySelector<HTMLElement>("[data-intro]")?.setAttribute("data-hidden", "true");
      audio.route(`${window.location.pathname}?focus=${encodeURIComponent(node.id)}`);
      announce(`Выбран узел: ${node.title}. Связей рядом: ${neighbors.get(node.id)?.size ?? 0}.`);
    };
    const resetFocus = (push = true) => {
      if (push) pushFocus(null);
      selectedId = null;
      field.position.set(0, 0, 0);
      root.querySelector<HTMLElement>("[data-node-card]")!.hidden = true;
      root.querySelector<HTMLElement>("[data-intro]")?.removeAttribute("data-hidden");
      updateHighlights();
      announce("Фокус сброшен. Показано центральное соседство.");
    };
    const applyUrlFocus = () => {
      const id = focusFromUrl();
      const node = id ? dataById.get(id) : undefined;
      if (node) focusNode(node, false); else resetFocus(false);
    };
    root.querySelector<HTMLButtonElement>("[data-history-back]")?.addEventListener("click", () => history.back(), { signal: controller.signal });
    root.querySelector<HTMLButtonElement>("[data-reset]")?.addEventListener("click", () => resetFocus(), { signal: controller.signal });
    root.querySelector<HTMLInputElement>("[data-node-search]")?.addEventListener("change", (event) => {
      const value = (event.currentTarget as HTMLInputElement).value.trim().toLocaleLowerCase("ru-RU");
      const node = graph.nodes.find((item) => item.title.toLocaleLowerCase("ru-RU") === value);
      if (node) focusNode(node);
    }, { signal: controller.signal });
    root.querySelector<HTMLElement>("[data-node-neighbor-list]")?.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-neighbor-id]");
      const node = button ? dataById.get(button.dataset.neighborId ?? "") : undefined;
      if (node) focusNode(node);
    }, { signal: controller.signal });
    root.querySelector<HTMLElement>("[data-node-list]")?.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-node-id]");
      const node = button ? dataById.get(button.dataset.nodeId ?? "") : undefined;
      if (node) focusNode(node);
    }, { signal: controller.signal });
    window.addEventListener("popstate", () => { focusedHistoryDepth = Math.max(0, focusedHistoryDepth - 1); updateBackButton(); applyUrlFocus(); }, { signal: controller.signal });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pointers = new Map<number, { x: number; y: number }>();
    let dragMoved = false;
    let lastPoint = { x: 0, y: 0 };
    let pinchDistance = 0;
    let targetZoom = 40;
    const setPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };
    canvas.addEventListener("pointerdown", (event) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
      dragMoved = false;
      lastPoint = { x: event.clientX, y: event.clientY };
      if (pointers.size === 2) pinchDistance = Math.hypot(event.clientX - lastPoint.x, event.clientY - lastPoint.y);
    }, { signal: controller.signal });
    canvas.addEventListener("pointermove", (event) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size > 1) {
        const points = [...pointers.values()];
        const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        if (pinchDistance) targetZoom = THREE.MathUtils.clamp(targetZoom - (distance - pinchDistance) * .035, 16, 76);
        pinchDistance = distance;
        return;
      }
      const dx = event.clientX - lastPoint.x;
      const dy = event.clientY - lastPoint.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
      field.rotation.y += dx * .004;
      field.rotation.x = THREE.MathUtils.clamp(field.rotation.x + dy * .002, -1.2, 1.2);
      lastPoint = { x: event.clientX, y: event.clientY };
    }, { signal: controller.signal });
    const stopPointer = (event: PointerEvent) => { pointers.delete(event.pointerId); if (pointers.size < 2) pinchDistance = 0; };
    canvas.addEventListener("pointerup", stopPointer, { signal: controller.signal });
    canvas.addEventListener("pointercancel", stopPointer, { signal: controller.signal });
    canvas.addEventListener("wheel", (event) => { targetZoom = THREE.MathUtils.clamp(targetZoom + event.deltaY * .018, 16, 76); }, { passive: true, signal: controller.signal });
    canvas.addEventListener("click", (event) => {
      if (dragMoved) return;
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects([...nodeVisuals.values()].map((visual) => visual.mesh).filter((mesh) => mesh.visible))[0];
      const node = hit ? dataById.get((hit.object.userData as { nodeId: string }).nodeId) : undefined;
      if (node) focusNode(node);
    }, { signal: controller.signal });
    canvas.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? .17 : .07;
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") field.rotation.y -= step;
      else if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") field.rotation.y += step;
      else if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") field.rotation.x = THREE.MathUtils.clamp(field.rotation.x - step, -1.2, 1.2);
      else if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") field.rotation.x = THREE.MathUtils.clamp(field.rotation.x + step, -1.2, 1.2);
      else if (event.key === "+" || event.key === "=") targetZoom = THREE.MathUtils.clamp(targetZoom - 3, 16, 76);
      else if (event.key === "-" || event.key === "_") targetZoom = THREE.MathUtils.clamp(targetZoom + 3, 16, 76);
      else if (event.key === "Home") { resetFocus(); field.rotation.set(0, 0, 0); targetZoom = 40; }
      else if (event.key === "Escape") resetFocus();
      else return;
      event.preventDefault();
    }, { signal: controller.signal });

    const soundButton = root.querySelector<HTMLButtonElement>("[data-sound]");
    soundButton?.addEventListener("click", async () => {
      const enabled = await audio.toggle();
      soundButton.setAttribute("aria-pressed", String(enabled));
      soundButton.textContent = enabled ? "Звук: вкл" : "Звук: выкл";
      announce(enabled ? "Генеративный звук включён для текущего маршрута." : "Генеративный звук выключен.");
    }, { signal: controller.signal });

    const xrDisposers: Array<() => void> = [];
    const xrStatus = root.querySelector<HTMLElement>("[data-xr-status]");
    const vrStatus = root.querySelector<HTMLElement>("[data-xr-vr-status]");
    const arStatus = root.querySelector<HTMLElement>("[data-xr-ar-status]");
    const xr = (navigator as Navigator & { xr?: { isSessionSupported: (mode: string) => Promise<boolean> } }).xr;
    if (!xr) {
      if (xrStatus) xrStatus.textContent = "XR недоступен — экранный режим";
      if (vrStatus) vrStatus.textContent = "VR недоступен";
      if (arStatus) arStatus.textContent = "AR недоступен";
    } else {
      const [vrSupported, arSupported] = await Promise.all(["immersive-vr", "immersive-ar"].map((mode) => xr.isSessionSupported(mode).catch(() => false)));
      if (vrStatus) vrStatus.textContent = vrSupported ? "VR готов" : "VR недоступен";
      if (arStatus) arStatus.textContent = arSupported ? "AR готов" : "AR недоступен";
      if (xrStatus) xrStatus.textContent = vrSupported || arSupported ? "XR готов" : "XR недоступен — экранный режим";
      if (vrSupported) {
        const button = VRButton.createButton(renderer, { optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"] });
        button.className = "icon-button xr-button";
        button.textContent = "Войти в VR";
        root.querySelector<HTMLElement>("[data-universe-actions]")?.prepend(button);
        const onStart = () => { button.textContent = "Выйти из VR"; };
        const onEnd = () => { button.textContent = "Войти в VR"; };
        renderer.xr.addEventListener("sessionstart", onStart);
        renderer.xr.addEventListener("sessionend", onEnd);
        xrDisposers.push(() => { renderer.xr.removeEventListener("sessionstart", onStart); renderer.xr.removeEventListener("sessionend", onEnd); });
      }
      if (arSupported) {
        const button = ARButton.createButton(renderer, { optionalFeatures: ["dom-overlay"], domOverlay: { root } });
        button.className = "icon-button xr-button";
        button.textContent = "Войти в AR";
        root.querySelector<HTMLElement>("[data-universe-actions]")?.prepend(button);
      }
    }

    const controllerRayGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    const xrControllers: import("three").Object3D[] = [];
    for (let index = 0; index < 2; index += 1) {
      const xrController = renderer.xr.getController(index);
      const ray = new THREE.Line(controllerRayGeometry, new THREE.LineBasicMaterial({ color: 0x6de1f4, transparent: true, opacity: .78 }));
      ray.scale.z = 8;
      xrController.add(ray);
      const select = () => {
        raycaster.setFromXRController(xrController);
        const hit = raycaster.intersectObjects([...nodeVisuals.values()].map((visual) => visual.mesh).filter((mesh) => mesh.visible))[0];
        const node = hit ? dataById.get((hit.object.userData as { nodeId: string }).nodeId) : undefined;
        if (node) focusNode(node);
      };
      xrController.addEventListener("select", select);
      xrDisposers.push(() => xrController.removeEventListener("select", select));
      scene.add(xrController);
      xrControllers.push(xrController);
    }

    const resize = () => { const width = window.innerWidth; const height = window.innerHeight; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); };
    resize();
    window.addEventListener("resize", resize, { signal: controller.signal });
    root.dataset.motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full";
    const reduced = root.dataset.motion === "reduced";
    applyUrlFocus();
    updateHighlights();
    updateBackButton();
    const frame = () => {
      if (!renderer.xr.isPresenting) camera.position.z += (targetZoom - camera.position.z) * .07;
      if (!reduced && !renderer.xr.isPresenting) field.rotation.y += .00045;
      dust.rotation.y += .0001;
      renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(frame);
    announce(`Карта загружена: ${graph.nodes.length} узлов, ${graph.edges.length} связей. Начинаю с центрального соседства.`);

    const cleanup = () => {
      controller.abort();
      timers.forEach((timer) => window.clearTimeout(timer));
      renderer.setAnimationLoop(null);
      field.traverse((object) => {
        const renderObject = object as import("three").Mesh | import("three").Line | import("three").Sprite;
        (renderObject.geometry as import("three").BufferGeometry | undefined)?.dispose();
        const material = renderObject.material as import("three").Material | import("three").Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose()); else material?.dispose();
      });
      dustGeometry.dispose();
      (dust.material as import("three").Material).dispose();
      glowTexture.dispose();
      controllerRayGeometry.dispose();
      xrControllers.forEach((item) => scene.remove(item));
      xrDisposers.forEach((dispose) => dispose());
      renderer.dispose();
      audio.dispose();
      fallbackCleanup();
      delete root.dataset.universeMounted;
    };
    root.addEventListener("universe:destroy", cleanup, { once: true });
    window.addEventListener("pagehide", cleanup, { once: true });
  } catch (error) {
    root.dataset.motion = "reduced";
    const status = root.querySelector<HTMLElement>("[data-xr-status]");
    if (status) status.textContent = "Экранный список доступен";
    announce("3D-режим недоступен. Используйте список узлов ниже.");
    console.warn("Universe 3D scene unavailable", error);
  }
}
