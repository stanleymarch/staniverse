import type { Camera, CanvasTexture, Group, Line, LineBasicMaterial, LineSegments, Material, Mesh, Points, Quaternion, Ray, Vector3, XRTargetRaySpace } from "three";
import type { GraphEdge, GraphNode } from "../../lib/graph";
import { provenanceField, relationLabel } from "../../lib/graph-visuals";
import { applyRadialDeadzone, arContentLift, arDiameterForMode, arModeSurrounds, cameraArOffer, cameraRelativeStep, createGestureTracker, experienceStateForAr, nearestScreenTarget, nextArPlacementState, nextExperienceState, nextSnapTurn, normalizedArContentTransform, xrOffer, AR_SURROUND_EYE_DROP_M, VR_SPEED_METERS_PER_SECOND, type ArPlacementEvent, type ArPlacementMode, type ArPlacementState, type ExperienceState, type SnapTurnState } from "../../lib/xr-experience";
import { startCameraAr, type CameraArSession, type CameraArStateEvent } from "./UniverseCameraAr";
import { NODE_LABELS, UniverseWorld } from "./UniverseWorld";
import { GenerativeUniverseAudio } from "./UniverseAudio";

type GraphPayload = { nodes: GraphNode[]; edges: GraphEdge[] };

function renderEdgeEvidence(root: HTMLElement, records: Array<{ node: GraphNode; edge: GraphEdge; outgoing: boolean }>) {
  const container = root.querySelector<HTMLElement>("[data-node-evidence]");
  const list = root.querySelector<HTMLElement>("[data-node-evidence-list]");
  if (!container || !list) return;
  const details = records.map(({ node: neighbor, edge, outgoing }) => {
    const item = document.createElement("details");
    const summary = document.createElement("summary");
    const label = relationLabel(edge.type);
    summary.textContent = `${outgoing ? `${label} →` : `← ${label}`} ${neighbor.title}`;
    item.append(summary);
    const fields: Array<[string, string | number | undefined]> = [
      ["Связь", label],
      ["Тип", edge.type],
      ["Основание", edge.evidence],
      ["Уверенность", `${Math.round(edge.confidence * 100)}%`],
      ["Объяснение", edge.explanation],
      ["Статус проверки", edge.reviewStatus ?? edge.status],
      ["Источник", provenanceField(edge.provenance, "source")],
      ["Метод", provenanceField(edge.provenance, "method")],
      ["Извлекатель", provenanceField(edge.provenance, "extractor")],
    ];
    const dl = document.createElement("dl");
    fields.filter(([, value]) => value).forEach(([key, value]) => {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = key;
      description.textContent = String(value);
      row.append(term, description);
      dl.append(row);
    });
    item.append(dl);
    return item;
  });
  list.replaceChildren(...details);
  container.hidden = records.length === 0;
}

function mountFallback(root: HTMLElement, graph: GraphPayload) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const list = root.querySelector<HTMLElement>("[data-node-list]");
  const announcer = root.querySelector<HTMLElement>("[data-announcer]");
  const card = root.querySelector<HTMLElement>("[data-node-card]");
  const title = root.querySelector<HTMLElement>("[data-node-title]");
  const summary = root.querySelector<HTMLElement>("[data-node-summary]");
  const kind = root.querySelector<HTMLElement>("[data-node-kind]");
  const tags = root.querySelector<HTMLElement>("[data-node-tags]");
  const link = root.querySelector<HTMLAnchorElement>("[data-node-link]");
  const adjacent = new Map<string, Array<{ node: GraphNode; edge: GraphEdge; outgoing: boolean }>>();
  graph.edges.forEach((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) return;
    adjacent.set(source.id, [...(adjacent.get(source.id) ?? []), { node: target, edge, outgoing: true }]);
    adjacent.set(target.id, [...(adjacent.get(target.id) ?? []), { node: source, edge, outgoing: false }]);
  });

  const updateCard = (node: GraphNode) => {
    if (!card || !title || !summary || !kind || !tags || !link) return;
    card.hidden = false;
    kind.textContent = NODE_LABELS[node.kind] ?? node.kind;
    title.textContent = node.title;
    summary.textContent = node.summary;
    const labels = [...node.topics, ...node.sourceTags].slice(0, 8);
    tags.replaceChildren(...labels.map((tag) => {
      const span = document.createElement("span");
      span.textContent = `#${tag}`;
      return span;
    }));
    link.href = node.href;
    const neighborsList = root.querySelector<HTMLElement>("[data-node-neighbor-list]");
    neighborsList?.replaceChildren(...(adjacent.get(node.id) ?? [])
      .map(({ node: neighbor, edge, outgoing }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.neighborId = neighbor.id;
        const label = relationLabel(edge.type);
        button.textContent = `${outgoing ? `${label} →` : `← ${label}`} ${neighbor.title}`;
        button.title = `${outgoing ? `${node.title} ${label} ${neighbor.title}` : `${neighbor.title} ${label} ${node.title}`}`;
        return button;
      }));
    renderEdgeEvidence(root, adjacent.get(node.id) ?? []);
    if (announcer) announcer.textContent = `Выбран узел: ${node.title}.`;
  };
  const controller = new AbortController();
  list?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-node-id]");
    const node = button ? byId.get(button.dataset.nodeId ?? "") : undefined;
    if (node) updateCard(node);
  }, { signal: controller.signal });
  root.querySelector<HTMLElement>("[data-node-neighbor-list]")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-neighbor-id]");
    const node = button ? byId.get(button.dataset.neighborId ?? "") : undefined;
    if (node) updateCard(node);
  }, { signal: controller.signal });
  root.querySelector<HTMLInputElement>("[data-node-search]")?.addEventListener("change", (event) => {
    const value = (event.currentTarget as HTMLInputElement).value.trim().toLocaleLowerCase("ru-RU");
    const node = graph.nodes.find((item) => item.title.toLocaleLowerCase("ru-RU") === value);
    if (node) updateCard(node);
  }, { signal: controller.signal });
  root.querySelector<HTMLButtonElement>("[data-node-close]")?.addEventListener("click", () => {
    if (card) card.hidden = true;
  }, { signal: controller.signal });
  return () => controller.abort();
}


interface RigPose {
  x: number; y: number; z: number;
  yaw: number; pitch: number; zoom: number;
}

interface RigTween {
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  start: number;
  duration: number;
}

/** On a phone the card must not eat the sky: fewer rows before "Ещё соседи". */
const neighborPageSizeOf = (compact: boolean) => compact ? 4 : 6;
/**
 * How many XR frames a surface hit stays valid for placement. A DOM click in AR arrives
 * outside the XR frame loop, so a wall-clock window is the wrong unit: on a slow device
 * (or a loaded workstation) frames can be a second apart and every click would read as
 * stale. Counting frames keeps placement usable at any frame rate while still refusing
 * evidence the viewer no longer sees.
 */
const AR_HIT_MAX_FRAME_AGE = 2;

export async function mountUniverse(scope: ParentNode = document) {
  const root = scope.querySelector<HTMLElement>("[data-universe]");
  if (!root || root.dataset.universeMounted === "true") return;
  root.dataset.universeMounted = "true";

  // Every mode reports through one state, so the overlay can react before the first WebGL frame
  // and without a pile of flags. `loading` is published synchronously, before three is fetched.
  const experienceLayer = root.querySelector<HTMLElement>("[data-experience-layer]");
  const experienceMessage = root.querySelector<HTMLElement>("[data-experience-message]");
  let experienceState: ExperienceState = "loading";
  const setExperienceState = (next: ExperienceState, message?: string) => {
    experienceState = next;
    root.dataset.experienceState = next;
    if (message && experienceMessage) experienceMessage.textContent = message;
    if (experienceLayer) experienceLayer.hidden = next !== "loading" && next !== "error";
  };
  setExperienceState("loading", "Загружаю созвездие…");

  let graph: GraphPayload;
  try {
    graph = JSON.parse(root.dataset.graph ?? "{}") as GraphPayload;
  } catch {
    root.dataset.motion = "reduced";
    setExperienceState("error", "Данные карты повреждены — открыт список узлов");
    root.querySelector<HTMLDetailsElement>(".universe-fallback")?.setAttribute("open", "");
    return;
  }
  const fallbackCleanup = mountFallback(root, graph);
  const canvas = root.querySelector<HTMLCanvasElement>(".universe-canvas");
  if (!canvas) {
    setExperienceState("error", "Сцена недоступна — открыт список узлов");
    return;
  }

  const compactViewport = root.dataset.embedded === "true" || window.matchMedia("(max-width: 780px)").matches;
  const focusFromUrl = () => new URLSearchParams(window.location.search).get("focus");
  const focusId = focusFromUrl();
  const xrDiagnosticsEnabled = new URLSearchParams(window.location.search).get("xrDebug") === "1";

  const controller = new AbortController();
  const timers: number[] = [];
  const audio = new GenerativeUniverseAudio();
  const announce = (message: string) => {
    const element = root.querySelector<HTMLElement>("[data-announcer]");
    if (element) element.textContent = message;
  };

  try {
    // Dynamic import is required: Three must stay out of the initial page chunk so the
    // accessible fallback list renders before the WebGL scene downloads.
    const THREE = await import("three");
    if (root.isConnected === false) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    let pixelRatioStep: "high" | "low" = "high";
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    // The page paints the deep sky; the canvas stays transparent so AR can show the camera through it.
    renderer.setClearColor(0x000000, 0);
    renderer.xr.enabled = true;
    const scene = new THREE.Scene();
    const deepSpaceFog = new THREE.FogExp2(0x02060e, .012);
    scene.fog = deepSpaceFog;
    const camera = new THREE.PerspectiveCamera(58, 1, .1, 900);
    camera.rotation.order = "YXZ";
    // The rig owns the camera: desktop look/flight and XR locomotion move the rig,
    // never the field, so graph coordinates stay stable across modes.
    const cameraRig = new THREE.Group();
    camera.position.set(0, 0, 40);
    cameraRig.add(camera);
    scene.add(cameraRig);

    const nodeDegreeOf = (id: string) => graph.edges.reduce((count, edge) => count + Number(edge.source === id || edge.target === id), 0);
    const initialIds = new Set<string>();
    if (focusId && graph.nodes.some((node) => node.id === focusId)) initialIds.add(focusId);
    graph.nodes
      .slice()
      .sort((a, b) => Number(b.featured) - Number(a.featured) || nodeDegreeOf(b.id) - nodeDegreeOf(a.id))
      .slice(0, 11)
      .forEach((node) => initialIds.add(node.id));
    // Canvas label textures are drawn once and never redrawn: the exact Geologica
    // faces they use must be loaded first, or sector captions silently bake in the
    // system fallback for the whole session. The Cyrillic sample matters: the subsets
    // are split by unicode-range, so a Latin-only load() would never fetch them.
    if (document.fonts?.load) {
      try {
        await Promise.all([
          document.fonts.load("600 30px Geologica", "Связь"),
          document.fonts.load("500 24px Geologica", "Связь"),
          document.fonts.load("600 30px Unbounded", "Связь"),
          document.fonts.load("500 30px Unbounded", "Связь"),
        ]);
      } catch { /* the fallback face is acceptable if loading fails */ }
    }
    const world = UniverseWorld.create({ THREE, scene }, graph, { compact: compactViewport, initialIds });
    const defaultAudioNode = graph.nodes.find((node) => initialIds.has(node.id)) ?? graph.nodes[0];
    if (defaultAudioNode) audio.select(defaultAudioNode);


    initialIds.forEach((id) => world.reveal(id));
    world.strongestUnrevealed(compactViewport ? 16 : 48).forEach((id, index) => {
      timers.push(window.setTimeout(() => world.revealBatch([id]), 500 + Math.min(index, 55) * 34));
    });

    // --- Orbit state: the rig orbits `target`; look/zoom/flight change only rig and camera. ---
    const reducedEntry = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const initialPose: RigPose = { x: 0, y: 0, z: 0, yaw: reducedEntry ? 0 : -.28, pitch: reducedEntry ? 0 : .1, zoom: reducedEntry ? 40 : 58 };
    const pose: RigPose = reducedEntry ? { ...initialPose } : { ...initialPose, yaw: -.06, pitch: .02, zoom: 40 };
    let targetZoom = pose.zoom;
    let rigTween: RigTween | undefined;
    // Cinematic entry: the camera settles from the wide establishing frame into the working
    // orbit. Any pointer, wheel, key or joystick input cancels it — the visitor is driving now.
    let entryFlight = reducedEntry || focusFromUrl() ? undefined : { start: performance.now(), duration: 1600 };
    const cancelEntryFlight = () => { entryFlight = undefined; };
    const snapRig = () => { cameraRig.position.set(pose.x, pose.y, pose.z); };
    snapRig();
    camera.rotation.y = pose.yaw;
    camera.rotation.x = pose.pitch;
    let selectedId: string | null = null;
    let focusedHistoryDepth = 0;
    let neighborPage = neighborPageSizeOf(compactViewport);
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let motionReduced = motionQuery.matches;
    root.dataset.motion = motionReduced ? "reduced" : "full";
    motionQuery.addEventListener("change", (event) => {
      motionReduced = event.matches;
      root.dataset.motion = motionReduced ? "reduced" : "full";
      // Drop any camera tween in flight: the user asked for less motion right now.
      if (motionReduced) rigTween = undefined;
    }, { signal: controller.signal });
    const updateBackButton = () => {
      const button = root.querySelector<HTMLButtonElement>("[data-history-back]");
      if (button) button.disabled = focusedHistoryDepth < 1;
    };

    const setCard = (node: GraphNode, neighbors: Array<{ node: GraphNode; edge: GraphEdge; outgoing: boolean }>) => {
      const card = root.querySelector<HTMLElement>("[data-node-card]");
      const kind = root.querySelector<HTMLElement>("[data-node-kind]");
      const title = root.querySelector<HTMLElement>("[data-node-title]");
      const summary = root.querySelector<HTMLElement>("[data-node-summary]");
      const tags = root.querySelector<HTMLElement>("[data-node-tags]");
      const link = root.querySelector<HTMLAnchorElement>("[data-node-link]");
      const neighborsList = root.querySelector<HTMLElement>("[data-node-neighbor-list]");
      if (!card || !kind || !title || !summary || !tags || !link || !neighborsList) return;
      card.hidden = false;
      kind.textContent = NODE_LABELS[node.kind] ?? node.kind;
      title.textContent = node.title;
      summary.textContent = node.summary;
      const labels = [...node.topics, ...node.sourceTags].slice(0, 8);
      tags.replaceChildren(...labels.map((tag) => { const span = document.createElement("span"); span.textContent = `#${tag}`; return span; }));
      link.href = node.href;
      const sorted = [...neighbors].sort((a, b) => b.edge.confidence - a.edge.confidence);
      const renderNeighbors = () => {
        neighborsList.replaceChildren();
        sorted.slice(0, neighborPage).forEach(({ edge, outgoing, node: neighbor }) => {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.neighborId = neighbor.id;
          const label = relationLabel(edge.type);
          button.textContent = `${outgoing ? `${label} →` : `← ${label}`} ${neighbor.title}`;
          button.title = `${outgoing ? `${node.title} ${label} ${neighbor.title}` : `${neighbor.title} ${label} ${node.title}`}`;
          neighborsList.append(button);
        });
        if (sorted.length > neighborPage) {
          const more = document.createElement("button");
          more.type = "button";
          more.className = "node-neighbor-more";
          more.textContent = `Ещё соседи (${sorted.length - neighborPage})`;
          more.addEventListener("click", () => { neighborPage += neighborPageSizeOf(compactViewport); renderNeighbors(); });
          neighborsList.append(more);
        }
      };
      renderNeighbors();
      renderEdgeEvidence(root, neighbors);
    };

    const poseSnapshot = (): RigPose => ({ ...pose });
    /** The working orbit the entry flight settles into; the wide frame is only for the first paint. */
    const workingPose: RigPose = { ...initialPose, yaw: -.06, pitch: .02, zoom: 40 };
    const applyPose = (next: RigPose, smooth: boolean) => {
      cancelEntryFlight();
      Object.assign(pose, next);
      targetZoom = next.zoom;
      if (smooth && !motionReduced) {
        rigTween = { from: { x: cameraRig.position.x, y: cameraRig.position.y, z: cameraRig.position.z }, to: { x: next.x, y: next.y, z: next.z }, start: performance.now(), duration: 700 };
      } else {
        rigTween = undefined;
        snapRig();
      }
      camera.rotation.y = next.yaw;
      camera.rotation.x = next.pitch;
    };

    const pushFocus = (id: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (id) params.set("focus", id); else params.delete("focus");
      const query = params.toString();
      history.pushState({ universeFocus: id, pose: poseSnapshot() }, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
      focusedHistoryDepth += 1;
      updateBackButton();
    };

    let onFocusCommitted: (() => void) | undefined;
    const focusNode = (node: GraphNode, push = true) => {
      if (selectedId === node.id) {
        resetFocus(push);
        return;
      }
      const card = world.focus(node.id);
      if (!card) return;
      if (push) pushFocus(node.id);
      selectedId = node.id;
      root.dataset.focused = "true";
      neighborPage = neighborPageSizeOf(compactViewport);
      setCard(card.node, card.neighbors);
      root.querySelector<HTMLDetailsElement>(".universe-tools")?.removeAttribute("open");
      // Selection is informational in every mode. Never move the camera or XR rig:
      // sudden travel is disorienting on screen and unsafe in headsets.
      root.querySelector<HTMLElement>("[data-intro]")?.setAttribute("data-hidden", "true");
      audio.select(node);
      // Only a visitor who opted into sound hears this, and only for a star they picked themselves.
      audio.accent();
      announce(`Выбрана звезда: ${node.title}. Связей рядом: ${world.neighbors.get(node.id)?.size ?? 0}. Закрыть выбор можно повторным нажатием, кнопкой «Закрыть» или Escape.`);
      onFocusCommitted?.();
    };
    const resetFocus = (push = true, resetView = false) => {
      if (push && selectedId) pushFocus(null);
      selectedId = null;
      delete root.dataset.focused;
      world.reset();
      neighborPage = neighborPageSizeOf(compactViewport);
      if (resetView) applyPose({ ...workingPose }, true);
      root.querySelector<HTMLElement>("[data-node-card]")!.hidden = true;
      root.querySelector<HTMLElement>("[data-intro]")?.removeAttribute("data-hidden");
      if (defaultAudioNode) audio.select(defaultAudioNode);
      announce(resetView ? "Карта и точка обзора сброшены." : "Выбор закрыт. Снова видна вся Вселенная.");
      onFocusCommitted?.();
    };
    const applyUrlFocus = (statePose?: RigPose) => {
      const id = focusFromUrl();
      const node = id ? world.byId.get(id) : undefined;
      if (node) {
        const card = world.focus(node.id);
        selectedId = node.id;
        root.dataset.focused = "true";
        neighborPage = neighborPageSizeOf(compactViewport);
        if (card) setCard(card.node, card.neighbors);
        if (statePose) applyPose(statePose, true);
        root.querySelector<HTMLElement>("[data-intro]")?.setAttribute("data-hidden", "true");
        audio.select(node);
      } else {
        selectedId = null;
        delete root.dataset.focused;
        world.reset();
        root.querySelector<HTMLElement>("[data-node-card]")!.hidden = true;
        root.querySelector<HTMLElement>("[data-intro]")?.removeAttribute("data-hidden");
        if (statePose) applyPose(statePose, true);
        if (defaultAudioNode) audio.select(defaultAudioNode);
      }
      onFocusCommitted?.();
    };
    root.querySelector<HTMLButtonElement>("[data-history-back]")?.addEventListener("click", () => history.back(), { signal: controller.signal });
    root.querySelector<HTMLButtonElement>("[data-reset]")?.addEventListener("click", () => resetFocus(true, true), { signal: controller.signal });
    root.querySelector<HTMLButtonElement>("[data-node-close]")?.addEventListener("click", () => resetFocus(), { signal: controller.signal });
    root.querySelector<HTMLInputElement>("[data-node-search]")?.addEventListener("change", (event) => {
      const value = (event.currentTarget as HTMLInputElement).value.trim().toLocaleLowerCase("ru-RU");
      const node = graph.nodes.find((item) => item.title.toLocaleLowerCase("ru-RU") === value);
      if (node) focusNode(node);
    }, { signal: controller.signal });
    root.querySelector<HTMLElement>("[data-node-neighbor-list]")?.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-neighbor-id]");
      const node = button ? world.byId.get(button.dataset.neighborId ?? "") : undefined;
      if (node) focusNode(node);
    }, { signal: controller.signal });
    root.querySelector<HTMLElement>("[data-node-list]")?.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-node-id]");
      const node = button ? world.byId.get(button.dataset.nodeId ?? "") : undefined;
      if (node) focusNode(node);
    }, { signal: controller.signal });
    window.addEventListener("popstate", (event) => {
      focusedHistoryDepth = Math.max(0, focusedHistoryDepth - 1);
      updateBackButton();
      const state = event.state as { pose?: RigPose } | null;
      applyUrlFocus(state?.pose);
    }, { signal: controller.signal });

    // --- Input: look, zoom, flight. Keyboard uses physical codes (RU layout safe);
    // keyboard and joystick stay independent so releasing one never cancels the other. ---
    const raycaster = new THREE.Raycaster();
    // Point-cloud slop follows the live presentation: AR squeezes the graph into ~a metre,
    // where a fixed world-unit threshold would grab stars far from the finger.
    raycaster.params.Points.threshold = world.pickTolerance();
    const pointer = new THREE.Vector2();
    const pointers = new Map<number, { x: number; y: number }>();
    // Tap versus drag is decided on the whole gesture, not on one sample: a slow finger travel
    // accumulates past the slop threshold, while the few pixels a tap jitters never do.
    const gesture = createGestureTracker();
    let lastPoint = { x: 0, y: 0 };
    let pinchDistance = 0;
    const keyFlight = { forward: 0, strafe: 0, rise: 0 };
    const joystickFlight = { forward: 0, strafe: 0 };
    const keys = new Set<string>();
    const knob = root.querySelector<HTMLElement>("[data-joystick-knob]");
    const syncKeyFlight = () => {
      keyFlight.forward = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
      keyFlight.strafe = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
      keyFlight.rise = Number(keys.has("KeyE")) - Number(keys.has("KeyQ"));
    };
    const resetInput = () => {
      keys.clear();
      syncKeyFlight();
      joystickFlight.forward = 0;
      joystickFlight.strafe = 0;
      knob?.style.removeProperty("transform");
      // A pointer released while the page was hidden never reaches the canvas: drop it here or the
      // stale entry keeps look/rotation disabled for the rest of the session.
      pointers.clear();
      pinchDistance = 0;
      gesture.reset();
    };
    const syncLook = () => { pose.yaw = camera.rotation.y; pose.pitch = camera.rotation.x; };
    const setPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };
    canvas.addEventListener("pointerdown", (event) => {
      cancelEntryFlight();
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
      gesture.start(event.clientX, event.clientY);
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
      gesture.move(event.clientX, event.clientY);
      camera.rotation.y -= dx * .004;
      camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - dy * .002, -1.2, 1.2);
      syncLook();
      lastPoint = { x: event.clientX, y: event.clientY };
    }, { signal: controller.signal });
    const stopPointer = (event: PointerEvent) => { pointers.delete(event.pointerId); if (pointers.size < 2) pinchDistance = 0; };
    canvas.addEventListener("pointerup", stopPointer, { signal: controller.signal });
    canvas.addEventListener("pointercancel", (event) => { stopPointer(event); resetInput(); }, { signal: controller.signal });
    canvas.addEventListener("lostpointercapture", stopPointer, { signal: controller.signal });
    canvas.addEventListener("wheel", (event) => { cancelEntryFlight(); targetZoom = THREE.MathUtils.clamp(targetZoom + event.deltaY * .018, 16, 76); }, { passive: true, signal: controller.signal });
    /**
     * Screen-space fallback for a raycast that missed. Every rendered star is projected
     * to CSS pixels, so a fingertip only has to land inside one 44px target instead of
     * exactly on a few rendered pixels. Unrevealed stars remain reachable while another
     * constellation is open: the point cloud still renders them and a tap can switch focus.
     * The projection camera is a parameter so camera AR can reuse the same contract.
     */
    const nearestNodeIdAt = (projectionCamera: Camera, ndcX: number, ndcY: number, width: number, height: number) => {
      world.root.updateWorldMatrix(true, false);
      const projected = new THREE.Vector3();
      const targets: Array<{ id: string; x: number; y: number; visible: boolean }> = [];
      world.visuals.forEach((visual, id) => {
        projected.copy(visual.position).applyMatrix4(world.root.matrixWorld).project(projectionCamera);
        if (projected.z < -1 || projected.z > 1) return;
        targets.push({
          id,
          x: (projected.x * .5 + .5) * width,
          y: (-projected.y * .5 + .5) * height,
          visible: true,
        });
      });
      return nearestScreenTarget(targets, (ndcX * .5 + .5) * width, (ndcY * .5 + .5) * height)?.id;
    };
    const rayTarget = new THREE.Vector3();
    const rayOffset = new THREE.Vector3();
    /** A controller/touch ray chooses the star nearest its centre line, independent of distance. */
    const nearestNodeIdAlongRay = (ray: Ray) => {
      world.root.updateWorldMatrix(true, false);
      let bestId: string | undefined;
      let bestAngularDistance = Math.tan(4 * Math.PI / 180) ** 2;
      world.visuals.forEach((visual, id) => {
        rayTarget.copy(visual.position).applyMatrix4(world.root.matrixWorld);
        rayOffset.subVectors(rayTarget, ray.origin);
        const along = rayOffset.dot(ray.direction);
        if (along <= 0) return;
        const angularDistance = Math.max(0, rayOffset.lengthSq() - along * along) / (along * along);
        if (angularDistance >= bestAngularDistance) return;
        bestAngularDistance = angularDistance;
        bestId = id;
      });
      return bestId;
    };
    const nearestNodeAt = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const id = nearestNodeIdAt(
        camera,
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
        rect.width,
        rect.height,
      );
      return id ? { id } : undefined;
    };
    canvas.addEventListener("click", (event) => {
      if (gesture.dragged) return;
      setPointer(event);
      raycaster.params.Points.threshold = world.pickTolerance();
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(world.pickableObjects(), false)[0];
      const nodeId = hit ? world.nodeIdFromPick(hit.object as Mesh | Points, hit.index) : undefined;
      const node = world.byId.get(nearestNodeAt(event)?.id ?? "") ?? (nodeId ? world.byId.get(nodeId) : undefined);
      if (node) focusNode(node);
    }, { signal: controller.signal });
    canvas.addEventListener("keydown", (event) => {
      cancelEntryFlight();
      const code = event.code;
      if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"].includes(code)) { keys.add(code); syncKeyFlight(); event.preventDefault(); return; }
      const step = event.shiftKey ? .17 : .07;
      if (code === "ArrowLeft") camera.rotation.y -= step;
      else if (code === "ArrowRight") camera.rotation.y += step;
      else if (code === "ArrowUp") camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - step, -1.2, 1.2);
      else if (code === "ArrowDown") camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x + step, -1.2, 1.2);
      else if (code === "NumpadAdd" || code === "Equal") targetZoom = THREE.MathUtils.clamp(targetZoom - 3, 16, 76);
      else if (code === "NumpadSubtract" || code === "Minus") targetZoom = THREE.MathUtils.clamp(targetZoom + 3, 16, 76);
      else if (code === "Home") { resetFocus(); return; }
      else if (code === "Escape") { resetFocus(); return; }
      else return;
      syncLook();
      event.preventDefault();
    }, { signal: controller.signal });
    window.addEventListener("keyup", (event) => { keys.delete(event.code); syncKeyFlight(); }, { signal: controller.signal });
    window.addEventListener("blur", resetInput, { signal: controller.signal });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { resetInput(); void audio.interrupt(); }
      else void audio.resumeIfEnabled();
    }, { signal: controller.signal });
    const joystick = root.querySelector<HTMLElement>("[data-flight-joystick]");
    let joystickPointer: number | undefined;
    const moveJoystick = (event: PointerEvent) => {
      if (joystickPointer !== event.pointerId || !joystick) return;
      const rect = joystick.getBoundingClientRect();
      joystickFlight.strafe = THREE.MathUtils.clamp((event.clientX - rect.left - rect.width / 2) / (rect.width / 2), -1, 1);
      joystickFlight.forward = -THREE.MathUtils.clamp((event.clientY - rect.top - rect.height / 2) / (rect.height / 2), -1, 1);
      knob?.style.setProperty("transform", `translate(${joystickFlight.strafe * 38}%, ${-joystickFlight.forward * 38}%)`);
    };
    joystick?.addEventListener("pointerdown", (event) => { cancelEntryFlight(); joystickPointer = event.pointerId; joystick.setPointerCapture(event.pointerId); moveJoystick(event); }, { signal: controller.signal });
    joystick?.addEventListener("pointermove", moveJoystick, { signal: controller.signal });
    const releaseJoystick = () => { joystickPointer = undefined; joystickFlight.forward = 0; joystickFlight.strafe = 0; knob?.style.removeProperty("transform"); };
    joystick?.addEventListener("pointerup", releaseJoystick, { signal: controller.signal });
    joystick?.addEventListener("pointercancel", releaseJoystick, { signal: controller.signal });

    const soundButton = root.querySelector<HTMLButtonElement>("[data-sound]");
    const audioSignal = root.querySelector<HTMLElement>("[data-audio-signal]");
    soundButton?.addEventListener("click", async () => {
      const enabled = await audio.toggle();
      soundButton.setAttribute("aria-pressed", String(enabled));
      soundButton.textContent = enabled ? "Звук: вкл" : "Звук: выкл";
      audioSignal?.toggleAttribute("data-active", enabled);
      announce(enabled ? "Генеративный звук включён для текущего маршрута." : "Генеративный звук выключен.");
    }, { signal: controller.signal });

    // --- XR: session ownership, VR locomotion, in-scene panel, AR placement. ---
    const xrDisposers: Array<() => void> = [];
    const xrStatus = root.querySelector<HTMLElement>("[data-xr-status]");
    const vrStatus = root.querySelector<HTMLElement>("[data-xr-vr-status]");
    const arStatus = root.querySelector<HTMLElement>("[data-xr-ar-status]");
    let vrSupported = false;
    let arSupported = false;
    let activeXrMode: "immersive-vr" | "immersive-ar" | undefined;
    let preSessionPose: RigPose | undefined;
    root.dataset.xr = "screen";
    const xrNavigator = (navigator as Navigator & { xr?: XRSystem }).xr;
    // One short, stable readout for the screen mode: the immersive detail lives in the two status
    // chips, which only render while that session is running.
    const screenModeLabel = () => {
      const modes = [vrSupported ? "VR" : undefined, arSupported ? "AR" : undefined].filter(Boolean);
      return modes.length ? `Экранный режим · ${modes.join(" и ")}` : "Экранный режим";
    };

    const makeXrButton = (label: string) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "icon-button xr-button";
      button.textContent = label;
      button.disabled = true;
      root.querySelector<HTMLElement>("[data-universe-actions]")?.prepend(button);
      return button;
    };
    const vrButton = makeXrButton("Войти в VR");
    const arButton = makeXrButton("Войти в AR");
    const enterXr = async (mode: "immersive-vr" | "immersive-ar", button: HTMLButtonElement) => {
      const activeSession = renderer.xr.getSession();
      if (activeSession) {
        button.disabled = true;
        try { await activeSession.end(); } finally { button.disabled = false; }
        return;
      }
      if (!xrNavigator?.requestSession || button.disabled) return;
      button.disabled = true;
      // The session request can take a permission prompt's worth of time: answer the click now,
      // in the button and in the route state, instead of leaving a dead-looking overlay behind.
      const launching = mode === "immersive-vr" ? "Запускаю VR…" : "Запускаю AR…";
      button.textContent = launching;
      if (xrStatus) xrStatus.textContent = launching;
      setExperienceState("loading", launching);
      let requestedSession: XRSession | undefined;
      try {
        renderer.xr.setReferenceSpaceType(mode === "immersive-vr" ? "local-floor" : "local");
        const init: XRSessionInit = mode === "immersive-vr"
          ? { optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"] }
          : { requiredFeatures: ["hit-test", "dom-overlay"], optionalFeatures: ["anchors", "local-floor"], domOverlay: { root } };
        requestedSession = await xrNavigator.requestSession(mode, init);
        activeXrMode = mode;
        await renderer.xr.setSession(requestedSession);
        button.textContent = mode === "immersive-vr" ? "Выйти из VR" : "Выйти из AR";
      } catch {
        activeXrMode = undefined;
        try { await requestedSession?.end(); } catch { /* session is already closed */ }
        if (xrStatus) xrStatus.textContent = mode === "immersive-vr" ? "VR: вход отменён" : "AR: вход отменён";
        button.textContent = mode === "immersive-vr" ? "Войти в VR" : "Войти в AR";
        // A cancelled or refused entry is not a broken route: drop back to the screen experience.
        setExperienceState(experienceStateForAr("idle"));
      } finally {
        button.disabled = false;
      }
    };
    vrButton.addEventListener("click", () => { void enterXr("immersive-vr", vrButton); }, { signal: controller.signal });
    arButton.addEventListener("click", () => { void enterXr("immersive-ar", arButton); }, { signal: controller.signal });
    // Only a device that really answers `immersive-*` is offered that mode. There is no platform
    // sniffing and no camera path here, so a phone without immersive-ar keeps the touch-3D view.
    const immersiveSupport = await Promise.all((["immersive-vr", "immersive-ar"] as XRSessionMode[]).map((mode) => xrNavigator?.isSessionSupported(mode).catch(() => false) ?? Promise.resolve(false)));
    const offer = xrOffer({ xrSystem: Boolean(xrNavigator?.requestSession), immersiveVr: immersiveSupport[0], immersiveAr: immersiveSupport[1] });
    vrSupported = offer.vr;
    arSupported = offer.ar;
    vrButton.disabled = !vrSupported;
    arButton.disabled = !arSupported;
    if (!vrSupported) vrButton.remove();
    if (!arSupported) arButton.remove();
    if (vrStatus) vrStatus.textContent = vrSupported ? "VR готов" : "VR недоступен";
    if (arStatus) arStatus.textContent = arSupported ? "AR готов" : "AR недоступен";
    if (xrStatus) xrStatus.textContent = screenModeLabel();
    // AR transform hierarchy: placementRoot (surface pose) → contentRoot (scale/rotation).
    // Node coordinates inside the world are never rewritten by placement.
    const arRoot = new THREE.Group();
    const contentRoot = new THREE.Group();
    arRoot.add(contentRoot);
    scene.add(arRoot);
    contentRoot.add(world.root);
    if (xrDiagnosticsEnabled) {
      // A read-only handle for emulator-driven tests and live debugging: the scene graph
      // itself, so a run can assert what is actually rendered instead of pixels alone.
      (window as typeof window & { __staniverseXR?: unknown }).__staniverseXR = {
        renderer, scene, camera, world, arRoot, contentRoot,
        placement: () => ({ arMode, arBase, arScaleFactor, arRotation }),
      };
    }
    const arPositions = [...world.visuals.values()].map((visual) => visual.position);
    let arMode: ArPlacementMode = "room";
    let arBase = normalizedArContentTransform(arPositions, arDiameterForMode(arMode));
    let arScaleFactor = 1;
    let arRotation = 0;
    const arHeadPosition = new THREE.Vector3();
    const arForward = new THREE.Vector3();
    const arBounds = world.contentBounds();
    const applyArTransform = () => {
      contentRoot.scale.setScalar(arBase.scale * arScaleFactor);
      contentRoot.position.set(0, arContentLift(arBase.offsetY, arScaleFactor), 0);
      contentRoot.rotation.y = arRotation;
      // Point sprites shrink with the group scale; the world divides it back out so stars
      // stay readable dots, and the ghost preview shows the very same transform.
      world.setArContentScale(arBase.scale * arScaleFactor);
      arPreview.scale.setScalar(arBase.scale * arScaleFactor);
      arPreview.position.setY(arContentLift(arBase.offsetY, arScaleFactor));
      arPreview.rotation.y = arRotation;
      arShadow.scale.setScalar(1 + arScaleFactor * .55);
    };
    const arGlow = (() => {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const context = canvas.getContext("2d");
      if (context) {
        const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 63);
        gradient.addColorStop(0, "rgba(255,255,255,.95)");
        gradient.addColorStop(.4, "rgba(255,255,255,.28)");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, 128, 128);
      }
      return new THREE.CanvasTexture(canvas);
    })();
    const arShadowTexture = (() => {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const context = canvas.getContext("2d");
      if (context) {
        const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 63);
        gradient.addColorStop(0, "rgba(0,0,0,.5)");
        gradient.addColorStop(.55, "rgba(0,0,0,.22)");
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, 128, 128);
      }
      return new THREE.CanvasTexture(canvas);
    })();

    // Before placement: a cyan reticle on the surface plus a ghost outline of the real extent.
    // The marker owns both, so it only ever has to be given one tracked pose per frame.
    const arMarker = new THREE.Group();
    arMarker.matrixAutoUpdate = false;
    arMarker.visible = false;
    scene.add(arMarker);
    const reticle = new THREE.Mesh(new THREE.RingGeometry(.07, .095, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7fd4f0, transparent: true, opacity: .9, side: THREE.DoubleSide }));
    const reticleCore = new THREE.Mesh(new THREE.CircleGeometry(.012, 18).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xd9fbff, transparent: true, opacity: .85 }));
    const reticleTicks = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-.145, .002, 0), new THREE.Vector3(-.105, .002, 0),
        new THREE.Vector3(.105, .002, 0), new THREE.Vector3(.145, .002, 0),
        new THREE.Vector3(0, .002, -.145), new THREE.Vector3(0, .002, -.105),
        new THREE.Vector3(0, .002, .105), new THREE.Vector3(0, .002, .145),
      ]),
      new THREE.LineBasicMaterial({ color: 0x7fd4f0, transparent: true, opacity: .55 }),
    );
    const reticleHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: arGlow, color: 0x7fd4f0, transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false }));
    reticleHalo.scale.setScalar(.42);
    const arPreview = new THREE.Group();
    arPreview.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(Math.max(arBounds.size.x, .1), Math.max(arBounds.size.y, .1), Math.max(arBounds.size.z, .1))),
      new THREE.LineBasicMaterial({ color: 0x7fd4f0, transparent: true, opacity: .3 }),
    ));
    arPreview.children[0].position.copy(arBounds.center);
    arMarker.add(reticle, reticleCore, reticleTicks, reticleHalo, arPreview);

    // After placement: a wide, soft ground shadow and a coloured rim, both lying flat on the
    // detected surface. A billboard would stand up in the room, so these are real rotated planes.
    const arShadow = new THREE.Group();
    const shadowPad = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: arShadowTexture, transparent: true, opacity: .55, depthWrite: false, side: THREE.DoubleSide }));
    shadowPad.rotation.x = -Math.PI / 2;
    shadowPad.position.y = .001;
    shadowPad.renderOrder = 1;
    const shadowRim = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), new THREE.MeshBasicMaterial({ map: arGlow, color: 0x7fd4f0, transparent: true, opacity: .22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    shadowRim.rotation.x = -Math.PI / 2;
    shadowRim.position.y = .002;
    shadowRim.renderOrder = 2;
    arShadow.add(shadowPad, shadowRim);
    arShadow.visible = false;
    arRoot.add(arShadow);

    const controllerRayGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    const xrControllers: XRTargetRaySpace[] = [];
    for (let index = 0; index < 2; index += 1) {
      const xrController = renderer.xr.getController(index);
      const ray = new THREE.Line(controllerRayGeometry, new THREE.LineBasicMaterial({ color: 0x6de1f4, transparent: true, opacity: .78 }));
      ray.scale.z = 8;
      xrController.add(ray);
      cameraRig.add(xrController);
      xrControllers.push(xrController);
    }

    let arState: ArPlacementState = "idle";
    let hitTestSource: XRHitTestSource | undefined;
    let arReferenceSpace: XRReferenceSpace | undefined;
    let arSessionIdentity = 0;
    let lastHitMatrix: Float32Array | undefined;
    let lastHitResult: XRHitTestResult | undefined;
    /** Monotonic XR frame counter and the tick of the last accepted surface hit. */
    let arFrameTick = 0;
    let lastHitTick = Number.NEGATIVE_INFINITY;
    let arAnchor: XRAnchor | undefined;
    let arAnchorMode = false;
    let relocating = false;
    let savedPlacement: { position: Vector3; quaternion: Quaternion; anchor?: XRAnchor; anchorMode: boolean } | undefined;
    let arVisibilityCleanup: (() => void) | undefined;
    const placeControl = root.querySelector<HTMLButtonElement>("[data-ar-place]");
    const relocateControl = root.querySelector<HTMLButtonElement>("[data-ar-relocate]");
    const relocateCancelControl = root.querySelector<HTMLButtonElement>("[data-ar-relocate-cancel]");
    const adjustmentControls = [...root.querySelectorAll<HTMLButtonElement>("[data-ar-adjust]")];
    const setArState = (event: ArPlacementEvent) => {
      arState = nextArPlacementState(arState, event);
      root.dataset.arState = arState === "lost-placed" ? "lost" : arState;
      // The route state follows the AR machine, so loading → searching → ready → placed → lost
      // is observable from outside without a second set of flags.
      setExperienceState(experienceStateForAr(arState));
      arShadow.visible = arState === "placed" || arState === "lost-placed";
      const placedLabel = arAnchorMode ? "AR: размещено · якорь" : "AR: размещено · локальная поза";
      const label = ({ searching: "AR: поверхность ищется, но поставить можно сразу", ready: "AR: поверхность найдена", placed: placedLabel, lost: "AR: трекинг потерян", "lost-placed": "AR: трекинг потерян — созвездие сохранено", idle: arSupported ? "AR готов" : "AR недоступен" } as Record<ArPlacementState, string>)[arState];
      if (arStatus) arStatus.textContent = label;
      if (placeControl) placeControl.disabled = arState !== "ready" && arState !== "searching";
      if (relocateControl) relocateControl.disabled = arState !== "placed";
      if (relocateCancelControl) relocateCancelControl.hidden = !relocating;
      adjustmentControls.forEach((control) => { control.disabled = arState !== "placed"; });
    };
    /** Surface evidence belongs to one tracked frame: drop it whenever tracking or the session changes. */
    const clearHitEvidence = () => {
      lastHitMatrix = undefined;
      lastHitResult = undefined;
      lastHitTick = Number.NEGATIVE_INFINITY;
      arMarker.visible = false;
    };
    const onArSessionStart = () => {
      const session = renderer.xr.getSession(); if (!session || activeXrMode !== "immersive-ar") return;
      preSessionPose = poseSnapshot();
      cameraRig.position.set(0, 0, 0);
      cameraRig.rotation.set(0, 0, 0);
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);
      // The camera feed is the background: no fog in front of it, and the sector landmarks and
      // the heavy dust step aside so the constellation reads as coloured stars and links.
      scene.fog = null;
      world.setArPresentation(true);
      applyArTransform();
      contentRoot.visible = false;
      arShadow.visible = false;
      relocating = false;
      arAnchor = undefined;
      savedPlacement = undefined;
      arVisibilityCleanup?.();
      const onVisibilityChange = () => setArState(session.visibilityState === "visible" ? "tracking-restored" : "tracking-lost");
      session.addEventListener("visibilitychange", onVisibilityChange);
      arVisibilityCleanup = () => session.removeEventListener("visibilitychange", onVisibilityChange);
      const identity = ++arSessionIdentity;
      setArState("start");
      if (session.requestHitTestSource) {
        Promise.all([session.requestReferenceSpace("viewer"), renderer.xr.getReferenceSpace() ? Promise.resolve(renderer.xr.getReferenceSpace()!) : session.requestReferenceSpace("local")]).then(([viewer, local]) => {
          if (identity !== arSessionIdentity) return;
          arReferenceSpace = local; return session.requestHitTestSource?.({ space: viewer });
        }).then((source) => { if (identity === arSessionIdentity && source) hitTestSource = source; }).catch(() => { if (arStatus) arStatus.textContent = "AR: без привязки к поверхности"; });
      } else if (arStatus) arStatus.textContent = "AR: размещение перед вами";
      // The reference is a galaxy already inhabiting the room. Give native WebXR a
      // few tracked frames, then place automatically; a later surface hit is useful
      // for explicit relocation, not a gate in front of the experience.
      const autoPlaceTimer = window.setTimeout(() => {
        if (identity === arSessionIdentity && (arState === "searching" || arState === "ready")) placeAr();
      }, 350);
      timers.push(autoPlaceTimer);
    };
    const onArSessionEnd = () => {
      arSessionIdentity += 1;
      arVisibilityCleanup?.();
      arVisibilityCleanup = undefined;
      hitTestSource?.cancel(); hitTestSource = undefined; arMarker.visible = false;
      arAnchor?.delete();
      savedPlacement?.anchor?.delete();
      arAnchor = undefined; arAnchorMode = false; relocating = false; savedPlacement = undefined;
      clearHitEvidence();
      contentRoot.visible = true;
      arShadow.visible = false;
      contentRoot.position.set(0, 0, 0); contentRoot.quaternion.identity(); contentRoot.scale.setScalar(1);
      arRoot.position.set(0, 0, 0); arRoot.quaternion.identity(); arRoot.scale.setScalar(1);
      scene.fog = deepSpaceFog;
      world.setArPresentation(false);
      if (activeXrMode === "immersive-ar") setArState("end");
    };
    const placeAr = () => {
      if (cameraArSession) { cameraArSession.place(); return; }
      if (renderer.xr.getSession()?.visibilityState !== "visible") return;

      const freshSurface = Boolean(
        lastHitMatrix
        && lastHitResult
        && arFrameTick - lastHitTick <= AR_HIT_MAX_FRAME_AGE,
      );
      const surfaceMatrix = freshSurface ? lastHitMatrix : undefined;
      const surfaceHit = freshSurface ? lastHitResult : undefined;
      if (arState === "searching") setArState("hit");
      if (arState !== "ready") return;
      if (relocating) savedPlacement?.anchor?.delete();
      relocating = false;
      savedPlacement = undefined;
      arAnchor?.delete();
      arAnchor = undefined;
      arAnchorMode = false;

      if (surfaceMatrix) {
        arRoot.matrix.fromArray(surfaceMatrix);
        arRoot.matrix.decompose(arRoot.position, arRoot.quaternion, arRoot.scale);
      } else {
        // Plane finding is an enhancement, not a gate. Native Android WebXR can
        // take many seconds to expose a hit-test plane in a plain room; a tap now
        // places the tabletop in front of the viewer immediately.
        clearHitEvidence();
        camera.getWorldPosition(arHeadPosition);
        camera.getWorldDirection(arForward);
        arRoot.position.copy(arHeadPosition).addScaledVector(arForward, 1.35);
        arRoot.position.y -= .45;
        arRoot.quaternion.identity();
        arRoot.scale.setScalar(1);
      }

      // Surround modes are worn, not visited: the ring centers on the head. With
      // no floor hit, eye height supplies the vertical origin as well.
      if (arModeSurrounds(arMode)) {
        camera.getWorldPosition(arHeadPosition);
        arRoot.position.x = arHeadPosition.x;
        arRoot.position.z = arHeadPosition.z;
        if (!surfaceMatrix && arMode !== "table") arRoot.position.y = arHeadPosition.y - AR_SURROUND_EYE_DROP_M[arMode];
      }
      contentRoot.visible = true;
      setArState("place");
      const identity = arSessionIdentity;
      if (arModeSurrounds(arMode)) {
        setArState("hit-missed");
        announce("Созвездие размещено вокруг вас: смотрите в любую сторону и выбирайте звёзды.");
      } else if (surfaceHit?.createAnchor) {
        announce("Созвездие размещено. Проверяю поддержку пространственного якоря.");
        surfaceHit.createAnchor().then((anchor) => {
          if (identity !== arSessionIdentity || arState !== "placed") { anchor.delete(); return; }
          arAnchor = anchor;
          arAnchorMode = true;
          setArState("hit-missed");
          announce("Созвездие размещено и заякорено на поверхности. Можно обойти его и выбрать звезду.");
        }).catch(() => {
          arAnchorMode = false;
          setArState("hit-missed");
          announce("Созвездие размещено по мировой позе в локальной системе отсчёта: пространственные якоря недоступны.");
        });
      } else if (surfaceMatrix) {
        announce("Созвездие размещено на найденной поверхности по локальной позе.");
      } else {
        announce("Созвездие размещено сразу перед вами. Поверхность для начала не требуется.");
      }
    };
    const relocateAr = () => {
      if (cameraArSession) { cameraArSession.relocate(); return; }
      if (arState !== "placed") return;
      savedPlacement = {
        position: arRoot.position.clone(),
        quaternion: arRoot.quaternion.clone(),
        anchor: arAnchor,
        anchorMode: arAnchorMode,
      };
      arAnchor = undefined;
      arAnchorMode = false;
      relocating = true;
      setArState("relocate");
      announce("Перенос: наведите камеру на новую поверхность и подтвердите размещение. Отмена вернёт прежнюю точку.");
    };
    const cancelRelocate = () => {
      if (cameraArSession) { cameraArSession.cancelRelocate(); return; }
      if (!relocating || !savedPlacement) return;
      arRoot.quaternion.copy(savedPlacement.quaternion);
      arRoot.position.copy(savedPlacement.position);
      arAnchor = savedPlacement.anchor;
      arAnchorMode = savedPlacement.anchorMode;
      relocating = false;
      savedPlacement = undefined;
      setArState("relocate-cancel");
      announce("Перенос отменён, прежнее размещение восстановлено.");
    };
    const adjustAr = (scaleDelta: number, rotateDelta: number) => {
      if (cameraArSession) { cameraArSession.adjust(scaleDelta, rotateDelta); return; }
      arScaleFactor = THREE.MathUtils.clamp(arScaleFactor + scaleDelta, .5, 2);
      arRotation += rotateDelta;
      applyArTransform();
    };
    const modeButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-ar-mode]")];
    const setArMode = (mode: ArPlacementMode) => {
      arMode = mode;
      if (!cameraArSession) {
        arScaleFactor = 1;
        arBase = normalizedArContentTransform(arPositions, arDiameterForMode(mode));
        applyArTransform();
      }
      root.dataset.arMode = mode;
      modeButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.arMode === mode)));
      announce(mode === "table"
        ? "Режим стола: созвездие 1 метр перед вами — в пределах досягаемости."
        : `Режим ${mode === "room" ? "комнаты: 4,5 метра" : "улицы: 10 метров"} вокруг вас — оборачивайтесь на 360° и выбирайте звёзды.`);
    };
    modeButtons.forEach((button) => button.addEventListener("click", () => {
      const mode = button.dataset.arMode as ArPlacementMode;
      if (cameraArSession) cameraArSession.setMode?.(normalizedArContentTransform(arPositions, arDiameterForMode(mode)), mode !== "table" ? AR_SURROUND_EYE_DROP_M[mode] : 0);
      setArMode(mode);
    }, { signal: controller.signal }));
    root.dataset.arMode = arMode;
    root.querySelector<HTMLButtonElement>("[data-ar-place]")?.addEventListener("click", placeAr, { signal: controller.signal });
    root.querySelector<HTMLButtonElement>("[data-ar-relocate]")?.addEventListener("click", relocateAr, { signal: controller.signal });
    root.querySelector<HTMLButtonElement>("[data-ar-relocate-cancel]")?.addEventListener("click", cancelRelocate, { signal: controller.signal });
    root.querySelector<HTMLButtonElement>("[data-ar-scale-down]")?.addEventListener("click", () => adjustAr(-.25, 0), { signal: controller.signal });
    root.querySelector<HTMLButtonElement>("[data-ar-scale-up]")?.addEventListener("click", () => adjustAr(.25, 0), { signal: controller.signal });
    root.querySelector<HTMLButtonElement>("[data-ar-rotate]")?.addEventListener("click", () => adjustAr(0, Math.PI / 8), { signal: controller.signal });

    // --- Camera AR: the 8th Wall adapter for phones without native WebXR (iOS). ---
    // Offered from capability answers alone: no navigator.xr at all, no immersive-ar,
    // finger-primary pointer, secure context. The engine binary is not even fetched
    // until this button is tapped.
    let cameraArSession: CameraArSession | undefined;
    let cameraArFailed = false;
    const cameraArButton = cameraArOffer({
      xrSystem: Boolean(xrNavigator?.requestSession),
      immersiveAr: arSupported,
      coarsePointer: window.matchMedia("(pointer: coarse)").matches,
      secureContext: window.isSecureContext,
    }) ? makeXrButton("AR через камеру") : undefined;
    if (cameraArButton) cameraArButton.disabled = false;
    const setCameraArControls = (view: "ready" | "placed") => {
      if (placeControl) placeControl.disabled = view !== "ready";
      if (relocateControl) relocateControl.disabled = view !== "placed";
      adjustmentControls.forEach((control) => { control.disabled = view !== "placed"; });
      if (relocateCancelControl) relocateCancelControl.hidden = true;
    };
    const endCameraAr = async () => {
      const session = cameraArSession;
      cameraArSession = undefined;
      if (session) await session.end();
      world.setArPresentation(false);
      root.dataset.xr = "screen";
      if (cameraArButton) {
        cameraArButton.disabled = false;
        cameraArButton.textContent = "AR через камеру";
      }
      if (arStatus) arStatus.textContent = arSupported ? "AR готов" : "AR: только через камеру";
      if (xrStatus) xrStatus.textContent = screenModeLabel();
      setExperienceState("exploring");
      lastFrame = performance.now();
      renderer.setAnimationLoop(frame);
      void audio.resumeIfEnabled();
      announce("Камера выключена. Возвращён экранный режим.");
    };
    cameraArButton?.addEventListener("click", async () => {
      if (cameraArSession) { await endCameraAr(); return; }
      if (cameraArButton.disabled) return;
      cameraArButton.disabled = true;
      cameraArButton.textContent = "Запускаю AR…";
      cameraArFailed = false;
      setExperienceState("loading", "Загружаю AR-движок…");
      if (arStatus) arStatus.textContent = "AR: загружаю движок";
      // The engine owns rendering while it runs; the screen loop and its camera stand down.
      renderer.setAnimationLoop(null);
      void audio.interrupt();
      world.setArPresentation(true);
      root.dataset.xr = "camera-ar";
      try {
        cameraArSession = await startCameraAr({
          scriptUrl: "https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/dist/xr.js",
          THREE,
          host: root,
          worldRoot: world.root,
          contentBase: arBase,
          pickables: () => world.pickableMeshes(),
          nodeIdFromPick: (mesh, index) => world.nodeIdFromPick(mesh, index),
          pointTolerance: () => world.pickTolerance(),
          nearestNode: (projectionCamera, ndcX, ndcY, width, height) =>
            nearestNodeIdAt(projectionCamera, ndcX, ndcY, width, height),
          worldUpdate: (elapsed, contentScale) => {
            world.setArContentScale(contentScale);
            world.update(elapsed, 0);
          },
          onState: (event: CameraArStateEvent, detail) => {
            if (event === "camera-requesting") {
              setExperienceState("loading", "Жду доступ к камере…");
              if (arStatus) arStatus.textContent = "AR: жду камеру";
              return;
            }
            if (event === "ready") {
              setExperienceState("ready");
              setCameraArControls("ready");
              if (arStatus) arStatus.textContent = "AR: наведите камеру и разместите";
              announce("Камера включена. Наведите её и нажмите «Разместить»: созвездие встанет по направлению взгляда.");
              return;
            }
            if (event === "placed") {
              setExperienceState("placed");
              setCameraArControls("placed");
              if (arStatus) arStatus.textContent = "AR: размещено по взгляду";
              announce("Созвездие размещено по взгляду. Можно обойти его и выбрать звезду касанием.");
              return;
            }
            if (event === "failed") {
              cameraArFailed = true;
              announce(`AR через камеру не запустился: ${detail ?? "ошибка"}. Возвращён экранный режим.`);
              void endCameraAr();
            }
          },
        });
        // A camera error can arrive in the microtask gap before this awaited
        // session handle is assigned. Finish teardown now that the handle exists.
        if (cameraArFailed) {
          await endCameraAr();
          return;
        }
        // Taps on the engine canvas select stars through the adapter's own camera.
        root.querySelector<HTMLCanvasElement>(".camera-ar-canvas")?.addEventListener("click", (event) => {
          if (gesture.dragged) return;
          const nodeId = cameraArSession?.pick(event.clientX, event.clientY);
          const node = nodeId ? world.byId.get(nodeId) : undefined;
          if (node) focusNode(node);
        }, { signal: controller.signal });
      } catch (error) {
        console.warn("Camera AR unavailable", error);
        announce("AR через камеру не загрузился на этом устройстве. Возвращён экранный режим.");
        await endCameraAr();
      }
    });
    // Two-finger rotate on the AR overlay: equivalent to the rotate button; never selects a star.
    const arPointers = new Map<number, { x: number; y: number }>();
    let arGestureAngle = 0;
    let arGestureActive = false;
    root.addEventListener("pointerdown", (event) => {
      if (root.dataset.xr !== "ar" && root.dataset.xr !== "camera-ar") return;
      arPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (arPointers.size === 2) {
        const [a, b] = [...arPointers.values()];
        arGestureAngle = Math.atan2(b.y - a.y, b.x - a.x);
        arGestureActive = true;
      }
    }, { signal: controller.signal });
    root.addEventListener("pointermove", (event) => {
      if (!arGestureActive || !arPointers.has(event.pointerId)) return;
      arPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const [a, b] = [...arPointers.values()];
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (cameraArSession) cameraArSession.adjust(0, angle - arGestureAngle);
      else {
        arRotation += angle - arGestureAngle;
        applyArTransform();
      }
      arGestureAngle = angle;
    }, { signal: controller.signal });
    const endArGesture = (event: PointerEvent) => {
      arPointers.delete(event.pointerId);
      if (arPointers.size < 2) arGestureActive = false;
    };
    root.addEventListener("pointerup", endArGesture, { signal: controller.signal });
    root.addEventListener("pointercancel", endArGesture, { signal: controller.signal });
    // Fingers lifted while the page is hidden never reach the overlay: without this the two-finger
    // rotate stays "active" and keeps steering the constellation from a single stray pointer.
    const clearArGesture = () => { arPointers.clear(); arGestureActive = false; arGestureAngle = 0; };
    window.addEventListener("blur", clearArGesture, { signal: controller.signal });
    document.addEventListener("visibilitychange", () => { if (document.hidden) clearArGesture(); }, { signal: controller.signal });

    // --- In-scene VR panel (CanvasTexture + ray-hit buttons; no DOM inside the session). ---
    let panelGroup: Group | undefined;
    let panelCanvas: HTMLCanvasElement | undefined;
    let panelTexture: CanvasTexture | undefined;
    let panelButtons: Mesh[] = [];
    let panelPage = 0;
    let panelOpen = false;
    let pendingOpenHref: string | undefined;
    const panelActions = ["prev", "next", "back", "reset", "sound", "open", "exit"] as const;
    type PanelAction = (typeof panelActions)[number];
    const panelActionLabels: Record<PanelAction, string> = { prev: "◀ Сосед", next: "Сосед ▶", back: "Назад", reset: "Сброс", sound: "Звук", open: "Открыть", exit: "Выход XR" };
    const ensurePanel = () => {
      if (panelGroup) return panelGroup;
      panelCanvas = document.createElement("canvas");
      panelCanvas.width = 1024;
      panelCanvas.height = 640;
      panelTexture = new THREE.CanvasTexture(panelCanvas);
      panelGroup = new THREE.Group();
      const surface = new THREE.Mesh(new THREE.PlaneGeometry(.8, .5), new THREE.MeshBasicMaterial({ map: panelTexture, transparent: true, side: THREE.DoubleSide }));
      panelGroup.add(surface);
      panelButtons = panelActions.map((action, index) => {
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(.104, .07), new THREE.MeshBasicMaterial({ transparent: true, opacity: .001 }));
        plane.userData.panelAction = action;
        plane.position.set(-.338 + index * .1125, -.212, .001);
        panelGroup!.add(plane);
        return plane;
      });
      panelGroup.visible = false;
      scene.add(panelGroup);
      return panelGroup;
    };
    const drawPanel = () => {
      if (!panelCanvas || !panelTexture) return;
      const context = panelCanvas.getContext("2d");
      if (!context) return;
      context.clearRect(0, 0, 1024, 640);
      context.beginPath();
      context.roundRect(6, 6, 1012, 628, 28);
      context.fillStyle = "rgba(10,14,26,.82)";
      context.fill();
      context.strokeStyle = "rgba(238,243,255,.22)";
      context.lineWidth = 2;
      context.stroke();
      context.beginPath();
      context.roundRect(6, 6, 1012, 120, [28, 28, 0, 0]);
      context.fillStyle = "rgba(238,243,255,.06)";
      context.fill();
      context.beginPath();
      context.roundRect(6, 6, 1012, 628, 28);
      context.strokeStyle = "rgba(127,212,240,.4)";
      context.lineWidth = 2;
      context.stroke();
      const selected = selectedId ? world.byId.get(selectedId) : undefined;
      context.fillStyle = "#7fd4f0";
      context.font = "500 24px Geologica, sans-serif";
      context.fillText(selected ? `✦ ${(NODE_LABELS[selected.kind] ?? selected.kind).toUpperCase()} · ДОСЬЕ` : "✦ СОЗВЕЗДИЕ", 36, 56);
      context.fillStyle = "#eef3ff";
      context.font = "650 44px Unbounded, Geologica, sans-serif";
      const title = selected ? selected.title : "Летайте между идеями";
      context.fillText(title.length > 40 ? `${title.slice(0, 39)}…` : title, 36, 112);
      context.font = "400 23px Geologica, sans-serif";
      context.fillStyle = "#b8c7dd";
      const excerpt = selected?.summary ?? "Выберите звезду лучом, чтобы открыть её контекст и связи.";
      context.fillText(excerpt.length > 82 ? `${excerpt.slice(0, 81)}…` : excerpt, 36, 152);
      context.font = "400 25px Geologica, sans-serif";
      context.fillStyle = "#aebfd2";
      const neighbors = selected ? world.edgesByNode.get(selected.id) ?? [] : [];
      const pageSize = 4;
      const pages = Math.max(1, Math.ceil(neighbors.length / pageSize));
      panelPage = ((panelPage % pages) + pages) % pages;
      const slice = neighbors.slice(panelPage * pageSize, panelPage * pageSize + pageSize);
      slice.forEach(({ edge, outgoing }, index) => {
        const neighbor = world.byId.get(outgoing ? edge.target : edge.source);
        const label = relationLabel(edge.type);
        const line = `${outgoing ? `${label} →` : `← ${label}`} ${neighbor?.title ?? ""}`;
        context.fillText(line.length > 58 ? `${line.slice(0, 57)}…` : line, 36, 210 + index * 66);
        context.fillStyle = "rgba(127,212,240,.6)";
        context.fillText(`${Math.round(edge.confidence * 100)}% · ${edge.evidence}`, 60, 241 + index * 66);
        context.fillStyle = "#aebfd2";
      });
      context.fillStyle = "#8fa6bc";
      context.font = "400 22px Geologica, sans-serif";
      context.fillText(`Связей ${selected ? neighbors.length : 0} · страница ${panelPage + 1}/${pages}`, 36, 512);
      panelActions.forEach((action, index) => {
        const x = 36 + index * 140;
        context.beginPath();
        context.roundRect(x, 540, 128, 66, 16);
        context.fillStyle = action === "exit" ? "rgba(229,168,209,.16)" : "rgba(127,212,240,.12)";
        context.fill();
        context.strokeStyle = action === "exit" ? "rgba(229,168,209,.5)" : "rgba(238,243,255,.28)";
        context.lineWidth = 2;
        context.stroke();
        context.fillStyle = "#dceefa";
        context.font = "500 24px Geologica, sans-serif";
        context.fillText(panelActionLabels[action], x + 12, 580);
      });
      panelTexture.needsUpdate = true;
    };
    // The panel is the only way to act inside immersive VR, where the DOM is not guaranteed to be
    // visible: keep it 1.2m in front of the viewer, facing back, so the card is reachable and the
    // panel raycast targets always sit where the viewer sees them.
    const PANEL_VIEW_DISTANCE = 1.2;
    const anchorPanelToViewer = (position = new THREE.Vector3(), forward = new THREE.Vector3()) => {
      const group = ensurePanel();
      // renderer.xr.getCamera() reports the head pose in the session's reference space while an XR
      // frame runs, so its getWorld*() helpers anchor the panel at the session origin instead of in
      // front of the viewer. The scene camera carries the viewer pose in world space, rig included,
      // which is the space the controller rays and the mouse pick use.
      camera.getWorldPosition(position);
      camera.getWorldDirection(forward);
      group.position.copy(position).addScaledVector(forward, PANEL_VIEW_DISTANCE);
      group.lookAt(position);
      return group;
    };
    const placePanelBeforeViewer = () => {
      const group = anchorPanelToViewer();
      group.visible = true;
      panelOpen = true;
      drawPanel();
    };
    onFocusCommitted = () => {
      if (!renderer.xr.isPresenting || activeXrMode !== "immersive-vr") return;
      panelPage = 0;
      if (panelOpen && panelGroup?.visible) drawPanel();
      else placePanelBeforeViewer();
    };
    const runPanelAction = async (action: PanelAction) => {
      if (action === "prev") { panelPage -= 1; drawPanel(); return; }
      if (action === "next") { panelPage += 1; drawPanel(); return; }
      if (action === "back") { if (focusedHistoryDepth > 0) history.back(); return; }
      if (action === "reset") { resetFocus(); drawPanel(); return; }
      if (action === "sound") {
        const enabled = await audio.toggle();
        soundButton?.setAttribute("aria-pressed", String(enabled));
        soundButton && (soundButton.textContent = enabled ? "Звук: вкл" : "Звук: выкл");
        drawPanel();
        return;
      }
      if (action === "open") {
        const node = selectedId ? world.byId.get(selectedId) : undefined;
        if (!node) return;
        pendingOpenHref = node.href;
        await renderer.xr.getSession()?.end();
        return;
      }
      if (action === "exit") { await renderer.xr.getSession()?.end(); return; }
    };
    const selectFromController = (xrController: XRTargetRaySpace) => {
      if (renderer.xr.isPresenting && activeXrMode === "immersive-ar") {
        if (arState === "ready" || arState === "searching") { placeAr(); return; }
        if (arState !== "placed") return;
      }
      raycaster.setFromXRController(xrController);
      raycaster.params.Points.threshold = world.pickTolerance();
      if (panelOpen && panelGroup?.visible) {
        const panelHit = raycaster.intersectObjects(panelButtons, false)[0];
        const action = panelHit ? (panelHit.object.userData as { panelAction?: PanelAction }).panelAction : undefined;
        if (action) { void runPanelAction(action); return; }
      }
      const hit = raycaster.intersectObjects(world.pickableObjects(), false)[0];
      const hitNodeId = hit ? world.nodeIdFromPick(hit.object as Mesh | Points, hit.index) : undefined;
      const nodeId = nearestNodeIdAlongRay(raycaster.ray) ?? hitNodeId;
      const node = nodeId ? world.byId.get(nodeId) : undefined;
      if (node) {
        focusNode(node);
        if (renderer.xr.isPresenting && activeXrMode === "immersive-vr" && panelOpen) drawPanel();
      }
    };
    xrControllers.forEach((xrController) => {
      const select = () => selectFromController(xrController);
      xrController.addEventListener("select", select);
      xrDisposers.push(() => xrController.removeEventListener("select", select));
      const squeeze = () => {
        if (renderer.xr.isPresenting && activeXrMode === "immersive-vr") {
          if (panelOpen && panelGroup?.visible) { panelGroup.visible = false; panelOpen = false; }
          else placePanelBeforeViewer();
        }
      };
      xrController.addEventListener("squeeze", squeeze);
      xrDisposers.push(() => xrController.removeEventListener("squeeze", squeeze));
    });

    const snapTurnState: SnapTurnState = { latched: false };
    let rigYaw = 0;
    let pendingVrAlignment = false;
    let pendingVrPanel = false;
    let sessionVisibilityCleanup: (() => void) | undefined;
    const onVrSessionStart = () => {
      if (activeXrMode !== "immersive-vr") return;
      preSessionPose = poseSnapshot();
      rigYaw = 0;
      snapTurnState.latched = false;
      pendingVrAlignment = true;
      pendingVrPanel = Boolean(selectedId);
      cameraRig.position.set(0, 0, 0);
      cameraRig.rotation.set(0, 0, 0);
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);
      // Entering VR re-arms the loader gate from the click handler's "Запускаю VR…": only the
      // first actually presented XR frame may lift it, never the session event alone.
      firstFrameRendered = false;
      // First XRFrame aligns the tracked head 2.2m from the focused constellation.
    };
    const onSessionStart = () => {
      root.dataset.xr = activeXrMode === "immersive-ar" ? "ar" : "vr";
      world.setVrPresentation(activeXrMode === "immersive-vr");
      if (activeXrMode === "immersive-vr") vrButton.textContent = "Выйти из VR";
      if (activeXrMode === "immersive-ar") arButton.textContent = "Выйти из AR";
      void audio.resumeIfEnabled();
      // Inside an immersive session the document may stay "visible" while the session is blurred or
      // hidden: the session's own visibility state is what suspends and restores the sound.
      const session = renderer.xr.getSession();
      const onVisibilityChange = () => {
        if (session?.visibilityState === "visible") void audio.resumeIfEnabled();
        else void audio.interrupt();
      };
      session?.addEventListener("visibilitychange", onVisibilityChange);
      sessionVisibilityCleanup = () => session?.removeEventListener("visibilitychange", onVisibilityChange);
      onVrSessionStart();
      onArSessionStart();
    };
    const onSessionEnd = () => {
      if (activeXrMode === "immersive-ar") onArSessionEnd();
      world.setVrPresentation(false);
      root.dataset.xr = "screen";
      activeXrMode = undefined;
      sessionVisibilityCleanup?.();
      sessionVisibilityCleanup = undefined;
      // Leaving the session returns to the screen: keep sounding only where the user asked for it.
      void audio.resumeIfEnabled();
      vrButton.textContent = "Войти в VR";
      arButton.textContent = "Войти в AR";
      if (xrStatus) xrStatus.textContent = screenModeLabel();
      pendingVrAlignment = false;
      pendingVrPanel = false;
      vrButton.disabled = !vrSupported;
      arButton.disabled = !arSupported;
      if (panelGroup) { panelGroup.visible = false; panelOpen = false; }
      rigYaw = 0;
      snapTurnState.latched = false;
      cameraRig.rotation.set(0, 0, 0);
      if (preSessionPose) {
        const restore = preSessionPose;
        preSessionPose = undefined;
        applyPose(restore, false);
        camera.position.set(0, 0, restore.zoom);
      }
      if (pendingOpenHref) {
        const href = pendingOpenHref;
        pendingOpenHref = undefined;
        window.location.assign(href);
      }
    };
    renderer.xr.addEventListener("sessionstart", onSessionStart);
    renderer.xr.addEventListener("sessionend", onSessionEnd);
    xrDisposers.push(() => {
      renderer.xr.removeEventListener("sessionstart", onSessionStart);
      renderer.xr.removeEventListener("sessionend", onSessionEnd);
    });

    const resize = () => { const width = root.clientWidth || window.innerWidth; const height = root.clientHeight || window.innerHeight; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); };
    resize();
    window.addEventListener("resize", resize, { signal: controller.signal });
    applyUrlFocus();
    updateBackButton();
    let lastFrame = performance.now(); let averageFrame = 16;
    let firstFrameRendered = false;
    const easeInOut = (t: number) => t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const tmpQuaternion = new THREE.Quaternion();
    const tmpForward = new THREE.Vector3();
    const tmpRight = new THREE.Vector3();
    const tmpPanelPosition = new THREE.Vector3();
    const tmpPanelForward = new THREE.Vector3();
    const tmpAudioListener = new THREE.Vector3();
    const tmpAudioTarget = new THREE.Vector3();
    let renderedAudioEnergy = -1;
    let renderedAudioTheme = "";
    const frame = (time: number, xrFrame?: XRFrame) => {
      let frameMotion = 0;
      const elapsed = Math.min(.05, Math.max(.001, (time - lastFrame) / 1000)); lastFrame = time;
      averageFrame = averageFrame * .94 + elapsed * 1000 * .06;
      // DPR changes only when crossing a quality step, never per frame.
      const nextStep = averageFrame > 24 ? "low" : averageFrame < 18 ? "high" : pixelRatioStep;
      if (nextStep !== pixelRatioStep) {
        pixelRatioStep = nextStep;
        renderer.setPixelRatio(nextStep === "low" ? Math.min(1.25, window.devicePixelRatio) : Math.min(window.devicePixelRatio, 1.8));
      }
      if (renderer.xr.isPresenting && xrFrame && hitTestSource && arReferenceSpace && activeXrMode === "immersive-ar") {
        arFrameTick += 1;
        const viewerPose = xrFrame.getViewerPose(arReferenceSpace);
        // A null viewer pose is tracking loss: the runtime cannot locate the viewer, so hit tests,
        // placement and the anchor pose are all unusable even while the session reports "visible".
        const trackingLost = renderer.xr.getSession()?.visibilityState !== "visible" || !viewerPose;
        const hits = viewerPose ? xrFrame.getHitTestResults(hitTestSource) : [];
        if (hits.length) {
          const hit = hits[0];
          const pose = hit.getPose(arReferenceSpace);
          if (pose) {
            lastHitMatrix = pose.transform.matrix as unknown as Float32Array;
            lastHitResult = hit;
            lastHitTick = arFrameTick;
            arMarker.matrix.fromArray(lastHitMatrix);
            arMarker.visible = arState !== "placed" || relocating;
            // The reticle breathes while it waits for a tap, so a still surface still looks alive.
            reticleHalo.material.opacity = motionReduced ? .45 : .32 + .2 * Math.sin(time / 320);
            if (arState === "searching") setArState("hit");
          }
        } else {
          // Surface miss is not tracking loss: hide the marker and go back to searching.
          arMarker.visible = false;
          if (arState === "ready") setArState("hit-missed");
        }
        if (trackingLost) {
          // Surface evidence from before the loss must never place content after recovery.
          clearHitEvidence();
          if (arState === "searching" || arState === "ready" || arState === "placed") setArState("tracking-lost");
        } else if (arState === "lost" || arState === "lost-placed") {
          setArState("tracking-restored");
        }
        if (arAnchor && arReferenceSpace) {
          const anchorPose = xrFrame.getPose(arAnchor.anchorSpace, arReferenceSpace);
          if (anchorPose) {
            arRoot.matrix.fromArray(anchorPose.transform.matrix);
            arRoot.matrix.decompose(arRoot.position, arRoot.quaternion, arRoot.scale);
          }
        }
      }
      if (renderer.xr.isPresenting) {
        // Controller rays double as hover feedback: white on a hittable target.
        xrControllers.forEach((xrController) => {
          raycaster.setFromXRController(xrController);
          raycaster.params.Points.threshold = world.pickTolerance();
          const ray = xrController.children[0] as Line | undefined;
          const panelHit = panelOpen && panelGroup?.visible ? raycaster.intersectObjects(panelButtons, false)[0] : undefined;
          const hovered = panelHit ?? raycaster.intersectObjects(world.pickableObjects(), false)[0];
          if (ray) (ray.material as LineBasicMaterial).color.set(hovered ? 0xffffff : 0x6de1f4);
        });
      }
      if (!renderer.xr.isPresenting) {
        if (entryFlight && !motionReduced) {
          const t = Math.min(1, (performance.now() - entryFlight.start) / entryFlight.duration);
          const eased = easeInOut(t);
          camera.rotation.y = initialPose.yaw + (workingPose.yaw - initialPose.yaw) * eased;
          camera.rotation.x = initialPose.pitch + (workingPose.pitch - initialPose.pitch) * eased;
          syncLook();
          targetZoom = initialPose.zoom + (workingPose.zoom - initialPose.zoom) * eased;
          if (t >= 1) entryFlight = undefined;
        }
        camera.position.z += (targetZoom - camera.position.z) * .07;
        pose.zoom = camera.position.z;
        const forward = THREE.MathUtils.clamp(keyFlight.forward + joystickFlight.forward, -1, 1);
        const strafe = THREE.MathUtils.clamp(keyFlight.strafe + joystickFlight.strafe, -1, 1);
        if (forward || strafe || keyFlight.rise) {
          const step = cameraRelativeStep({ forward, strafe, rise: keyFlight.rise }, camera.rotation.y, elapsed * 9);
          pose.x += step.x; pose.y += step.y; pose.z += step.z;
          if (!rigTween) cameraRig.position.set(pose.x, pose.y, pose.z);
        }
        frameMotion = Math.min(1, Math.abs(forward) + Math.abs(strafe) + Math.abs(keyFlight.rise));
        if (rigTween) {
          const t = Math.min(1, (performance.now() - rigTween.start) / rigTween.duration);
          const eased = easeInOut(t);
          cameraRig.position.set(
            rigTween.from.x + (rigTween.to.x - rigTween.from.x) * eased,
            rigTween.from.y + (rigTween.to.y - rigTween.from.y) * eased,
            rigTween.from.z + (rigTween.to.z - rigTween.from.z) * eased,
          );
          pose.x = cameraRig.position.x; pose.y = cameraRig.position.y; pose.z = cameraRig.position.z;
          if (t >= 1) rigTween = undefined;
        }
      } else if (activeXrMode === "immersive-vr") {
        const session = renderer.xr.getSession();
        if (pendingVrAlignment && xrFrame) {
          const referenceSpace = renderer.xr.getReferenceSpace();
          const trackedViewer = referenceSpace ? xrFrame.getViewerPose(referenceSpace) : null;
          if (trackedViewer) {
            const head = trackedViewer.transform.position;
            cameraRig.position.set(pose.x - head.x, pose.y - head.y, pose.z + 2.2 - head.z);
            cameraRig.updateMatrixWorld(true);
            pendingVrAlignment = false;
          }
        } else if (pendingVrPanel) {
          pendingVrPanel = false;
          placePanelBeforeViewer();
        }
        // Locomotion moves the rig under the viewer: without re-anchoring, an open panel drifts out of
        // reach while the raycast still reports its buttons as available.
        if (panelOpen && panelGroup?.visible) anchorPanelToViewer(tmpPanelPosition, tmpPanelForward);
        camera.getWorldQuaternion(tmpQuaternion);
        tmpForward.set(0, 0, -1).applyQuaternion(tmpQuaternion);
        const planar = Math.hypot(tmpForward.x, tmpForward.z);
        if (planar > 1e-4) { tmpForward.x /= planar; tmpForward.z /= planar; tmpRight.set(-tmpForward.z, 0, tmpForward.x); }
        if (session) {
          for (const source of session.inputSources) {
            const axes = source.gamepad?.axes ?? [];
            if (axes.length < 2) continue;
            const usesThumbstick = axes.length >= 4;
            const stickX = usesThumbstick ? axes[2] : axes[0];
            const stickY = usesThumbstick ? axes[3] : axes[1];
            const { x, y } = applyRadialDeadzone(stickX ?? 0, stickY ?? 0);
            frameMotion = Math.max(frameMotion, Math.min(1, Math.hypot(x, y)));
            if (source.handedness === "left") {
              if ((x || y) && planar > 1e-4) {
                const speed = VR_SPEED_METERS_PER_SECOND * elapsed;
                cameraRig.position.x += (tmpForward.x * -y + tmpRight.x * x) * speed;
                cameraRig.position.z += (tmpForward.z * -y + tmpRight.z * x) * speed;
              }
            } else if (source.handedness === "right") {
              cameraRig.position.y += y * VR_SPEED_METERS_PER_SECOND * elapsed;
              const turn = nextSnapTurn(snapTurnState, x, rigYaw);
              snapTurnState.latched = turn.latched;
              rigYaw = turn.yaw;
              cameraRig.rotation.y = rigYaw;
            }
          }
        }
      }
      const localAudioTarget = selectedId ? world.positionOf(selectedId) : world.nearestPosition(camera);
      let audioDistance = 1;
      if (localAudioTarget) {
        world.root.updateWorldMatrix(true, false);
        tmpAudioTarget.copy(localAudioTarget);
        world.root.localToWorld(tmpAudioTarget);
        camera.getWorldPosition(tmpAudioListener);
        audioDistance = Math.min(1, tmpAudioListener.distanceTo(tmpAudioTarget) / 80);
      }
      const audioState = audio.update(audioDistance, frameMotion);
      const displayedEnergy = Math.round(audioState.energy * 100) / 100;
      if (audioSignal && (displayedEnergy !== renderedAudioEnergy || audioState.theme !== renderedAudioTheme)) {
        renderedAudioEnergy = displayedEnergy;
        renderedAudioTheme = audioState.theme;
        audioSignal.dataset.theme = audioState.theme;
        audioSignal.toggleAttribute("data-active", audioState.enabled);
        audioSignal.style.setProperty("--audio-energy", String(displayedEnergy));
      }
      world.update(time / 1000, audioState.energy, camera.getWorldPosition(tmpAudioListener));
      if (xrDiagnosticsEnabled && renderer.xr.isPresenting) {
        root.dataset.xrRig = `${cameraRig.position.x.toFixed(4)},${cameraRig.position.y.toFixed(4)},${cameraRig.position.z.toFixed(4)}`;
        root.dataset.xrYaw = rigYaw.toFixed(4);
        root.dataset.xrPanel = String(Boolean(panelGroup?.visible));
      }
      renderer.render(scene, camera);
      if (!firstFrameRendered) {
        firstFrameRendered = true;
        // The sky is on screen: the loader steps aside and the canvas is left to breathe.
        setExperienceState(nextExperienceState(experienceState, "loaded"));
      }
    };
    renderer.setAnimationLoop(frame);
    announce(`Карта загружена: ${graph.nodes.length} узлов, ${graph.edges.length} связей. Секторы доступны для свободного полёта.`);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      controller.abort();
      timers.forEach((timer) => window.clearTimeout(timer));
      const cameraSession = cameraArSession;
      cameraArSession = undefined;
      void cameraSession?.end();
      if (activeXrMode === "immersive-ar") onArSessionEnd();
      xrDisposers.forEach((dispose) => dispose());
      void renderer.xr.getSession()?.end();
      renderer.setAnimationLoop(null);
      if (panelGroup) {
        panelGroup.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          child.geometry.dispose();
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((material) => material.dispose());
        });
        scene.remove(panelGroup);
      }
      panelTexture?.dispose();
      [reticle, reticleCore].forEach((mesh) => { mesh.geometry.dispose(); (mesh.material as Material).dispose(); });
      reticleTicks.geometry.dispose();
      (reticleTicks.material as Material).dispose();
      (reticleHalo.material as Material).dispose();
      arPreview.traverse((child) => {
        const preview = child as LineSegments;
        preview.geometry?.dispose();
        (preview.material as Material | undefined)?.dispose?.();
      });
      arShadow.traverse((child) => {
        const pad = child as Mesh;
        pad.geometry?.dispose?.();
        (pad.material as Material | undefined)?.dispose?.();
      });
      arGlow.dispose();
      arShadowTexture.dispose();
      scene.remove(arMarker);
      arShadow.removeFromParent();
      xrControllers.forEach((item) => {
        const ray = item.children[0] as Line | undefined;
        if (ray) (ray.material as Material).dispose();
        cameraRig.remove(item);
      });
      controllerRayGeometry.dispose();
      world.dispose();
      renderer.dispose();
      audio.dispose();
      vrButton.remove();
      arButton.remove();
      fallbackCleanup();
      delete root.dataset.xr;
      delete root.dataset.arState;
      delete root.dataset.experienceState;
      delete root.dataset.universeMounted;
    };
    root.addEventListener("universe:destroy", cleanup, { once: true });
    window.addEventListener("pagehide", cleanup, { once: true });
  } catch (error) {
    // No usable WebGL context: the accessible list is the whole experience, so open it instead of
    // leaving a dead canvas that still takes focus and page space.
    root.dataset.motion = "reduced";
    root.dataset.render = "unavailable";
    setExperienceState("error", "3D-режим недоступен — открыт список узлов");
    const tools = root.querySelector<HTMLDetailsElement>(".universe-tools");
    if (tools) tools.open = true;
    const fallback = root.querySelector<HTMLDetailsElement>(".universe-fallback");
    if (fallback) fallback.open = true;
    const status = root.querySelector<HTMLElement>("[data-xr-status]");
    if (status) status.textContent = "Экранный список доступен";
    announce("3D-режим недоступен. Используйте список узлов ниже.");
    console.warn("Universe 3D scene unavailable", error);
  }
}
