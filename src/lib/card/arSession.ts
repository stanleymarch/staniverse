import * as THREE from "three-mindar";
import type { CardQuality } from "../../config/cardPortal";
import type { CardPortalGraph, PortalNode } from "./graphSubset";
import { buildPortalScene, type PortalScene } from "./portalScene";

/**
 * The camera half of `/card/`. MindAR is only the tracking layer: it supplies
 * the renderer, the video-backed scene and one anchor whose group we fill with
 * the portal scene. Everything the visitor reads stays in DOM.
 */

type StartOptions = {
  stage: HTMLElement;
  graph: CardPortalGraph;
  config: { targetSrc: string; targetAspect: number; portalScale: number; lostDelayMs: number; resetDelayMs: number };
  debug: boolean;
  debugPanel: HTMLOutputElement;
  nodeCard: HTMLElement;
  enter: HTMLElement;
  trackingMessage: HTMLElement;
  hooks: { setState(state: string): void; onFound(): void; onLost(): void; onRecovered(): void; onFrame(deltaSeconds: number): void };
};

const KIND_LABEL: Record<string, string> = { core: "ядро", hub: "созвездие", work: "Работа", project: "Проект", experiment: "Эксперимент", topic: "Тема", memory: "память" };

function qualityForDevice(): CardQuality {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  if (memory <= 2 || navigator.hardwareConcurrency <= 4) return "low";
  return memory <= 4 || navigator.hardwareConcurrency <= 6 ? "medium" : "high";
}
function shorten(text: string, limit = 190) {
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

export async function startCardAR(options: StartOptions): Promise<{ stop(): void }> {
  const { MindARThree } = await import("mind-ar/dist/mindar-image-three.prod.js");
  const mindar = new MindARThree({ container: options.stage, imageTargetSrc: options.config.targetSrc, maxTrack: 1, filterMinCF: 0.001, filterBeta: 0.01, warmupTolerance: 4, missTolerance: 8 });
  const quality = qualityForDevice();
  const portal: PortalScene = buildPortalScene(options.graph, options.config, quality);
  const anchor = mindar.addAnchor(0);
  anchor.group.add(portal.group);

  const enterTimer = { id: 0 };
  let foundOnce = false;
  let interactedOnce = false;
  let lostTimer = 0;
  let resetTimer = 0;
  anchor.onTargetFound = () => {
    window.clearTimeout(lostTimer);
    window.clearTimeout(resetTimer);
    const recovered = foundOnce;
    foundOnce = true;
    portal.setLost(false);
    portal.group.visible = true;
    options.hooks.setState("found");
    options.hooks.onFound();
    if (!recovered) {
      portal.reveal();
      enterTimer.id = window.setTimeout(() => { options.enter.hidden = false; }, 8000);
    } else {
      options.hooks.onRecovered();
    }
  };
  anchor.onTargetLost = () => {
    // Hysteresis: a frame or two of dropout must not flash the portal away.
    lostTimer = window.setTimeout(() => {
      portal.setLost(true);
      options.hooks.onLost();
    }, options.config.lostDelayMs);
    resetTimer = window.setTimeout(() => { portal.group.visible = false; }, options.config.resetDelayMs);
  };

  const meshes: THREE.Mesh[] = [];
  portal.group.traverse((child) => {
    if ((child as THREE.Mesh).userData?.node) meshes.push(child as THREE.Mesh);
  });
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const selectNode = (node: PortalNode) => {
    for (const mesh of meshes) {
      const meshNode = mesh.userData.node as PortalNode;
      const inCluster = node.portalKind === "hub" && meshNode.cluster === node.cluster;
      mesh.userData.selectedOpacity = meshNode === node || inCluster ? 1 : 0.28;
    }
    const card = options.nodeCard;
    const isCore = node.portalKind === "core";
    card.querySelector<HTMLElement>("[data-node-kind]")!.textContent = KIND_LABEL[node.portalKind] ?? node.kind;
    card.querySelector<HTMLElement>("[data-node-title]")!.textContent = isCore ? "Стас Ермоленко" : node.title;
    card.querySelector<HTMLElement>("[data-node-summary]")!.textContent = isCore ? "XR · AI · цифровые архивы · медиа." : shorten(node.summary);
    const link = card.querySelector<HTMLAnchorElement>("[data-node-link]")!;
    link.href = isCore ? "/universe/" : node.href;
    link.textContent = isCore ? "Войти во вселенную →" : node.portalKind === "hub" ? "Открыть раздел →" : node.kind === "experiment" ? "Открыть разбор →" : node.kind === "topic" ? "Открыть тему →" : "Открыть материал →";
    const about = card.querySelector<HTMLAnchorElement>("[data-node-about]")!;
    about.hidden = !isCore;
    about.href = "/about/";
    const launch = card.querySelector<HTMLAnchorElement>("[data-node-launch]")!;
    launch.hidden = !node.launch;
    if (node.launch) launch.href = node.launch;
    card.hidden = false;
    interactedOnce = true;
  };
  const deselect = () => {
    for (const mesh of meshes) delete mesh.userData.selectedOpacity;
    options.nodeCard.hidden = true;
    // The final CTA appears once the first exploration closes: the card already
    // carries the node's own way out, so the two must not stack.
    if (interactedOnce) options.enter.hidden = false;
  };
  const onPointerUp = (event: PointerEvent) => {
    const canvas = mindar.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, mindar.camera);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (hit) selectNode(hit.object.userData.node as PortalNode);
    else deselect();
  };
  mindar.renderer.domElement.addEventListener("pointerup", onPointerUp);

  if (options.debug) {
    options.debugPanel.hidden = false;
    const axes = new THREE.AxesHelper(0.16);
    axes.position.z = 0.01;
    anchor.group.add(axes);
  }

  await mindar.start();
  let last = performance.now();
  let frames = 0;
  let fpsWindow = last;
  mindar.renderer.setAnimationLoop(() => {
    const now = performance.now();
    portal.update(now);
    mindar.renderer.render(mindar.scene, mindar.camera);
    options.hooks.onFrame((now - last) / 1000);
    last = now;
    frames += 1;
    if (options.debug && now - fpsWindow > 500) {
      const fps = Math.round((frames * 1000) / (now - fpsWindow));
      frames = 0;
      fpsWindow = now;
      options.debugPanel.value = [
        `tracking: ${foundOnce ? "found" : "searching"} · lost: ${portal.group.visible ? "no" : "yes"}`,
        `quality: ${quality}`,
        `nodes: ${meshes.length} · edges: ${options.graph.edges.length}`,
        `fps: ${fps} · draw calls: ${mindar.renderer.info.render.calls}`,
        `aspect: ${options.config.targetAspect.toFixed(3)}:1`,
      ].join("\n");
    }
  });

  return {
    stop() {
      window.clearTimeout(lostTimer);
      window.clearTimeout(resetTimer);
      window.clearTimeout(enterTimer.id);
      mindar.renderer.domElement.removeEventListener("pointerup", onPointerUp);
      mindar.renderer.setAnimationLoop(null);
      deselect();
      portal.dispose();
      mindar.stop();
      mindar.renderer.dispose();
    },
  };
}
