import type { CardPortalGraph } from "./graphSubset";

type PortalConfig = { targetSrc: string; targetAspect: number; portalScale: number; lostDelayMs: number; resetDelayMs: number };

/** Reads the page payload without importing any rendering library. */
export function readCardPortal(root: HTMLElement) {
  return {
    graph: JSON.parse(root.dataset.graph ?? "{}") as CardPortalGraph,
    config: JSON.parse(root.dataset.config ?? "{}") as PortalConfig,
    debug: root.dataset.debug === "true",
  };
}

/**
 * Owns the DOM half of `/card/`: the landing gate, the camera states and the
 * info card. The Three.js/MindAR half is imported only when the visitor taps
 * «Открыть портал», so the QR landing stays a light document.
 */
export function mountCardPortal() {
  const root = document.querySelector<HTMLElement>("[data-card-portal]");
  if (!root) return;
  const { graph, config } = readCardPortal(root);
  // A static build cannot see ?debug=1 at render time; the flag is read where
  // it lives, on the visitor's URL.
  const debug = root.dataset.debug === "true" || new URLSearchParams(window.location.search).get("debug") === "1";
  const stage = root.querySelector<HTMLElement>("[data-stage]")!;
  const landing = root.querySelector<HTMLElement>("[data-landing]")!;
  const tracking = root.querySelector<HTMLElement>("[data-tracking]")!;
  const trackingMessage = root.querySelector<HTMLElement>("[data-tracking-message]")!;
  const errorPane = root.querySelector<HTMLElement>("[data-error]")!;
  const errorMessage = root.querySelector<HTMLElement>("[data-error-message]")!;
  const hud = root.querySelector<HTMLElement>("[data-hud]")!;
  const enter = root.querySelector<HTMLElement>("[data-enter]")!;
  const debugPanel = root.querySelector<HTMLOutputElement>("[data-debug-panel]")!;
  const nodeCard = root.querySelector<HTMLElement>("[data-node-card]")!;
  const dialog = root.querySelector<HTMLDialogElement>("[data-contact-dialog]")!;
  let session: { stop(): void } | undefined;
  let starting = false;

  const setState = (state: string) => { root.dataset.state = state; };
  const closeNodeCard = () => { nodeCard.hidden = true; };

  const showCameraError = (message: string) => {
    setState("error");
    errorMessage.textContent = message;
    errorPane.hidden = false;
    landing.hidden = true;
    tracking.hidden = true;
  };

  const stopSession = () => {
    session?.stop();
    session = undefined;
    starting = false;
    stage.replaceChildren();
    setState("idle");
    tracking.hidden = true;
    hud.hidden = true;
    enter.hidden = true;
    closeNodeCard();
    landing.hidden = false;
    errorPane.hidden = true;
  };

  const startSession = async () => {
    if (starting || session) return;
    starting = true;
    errorPane.hidden = true;
    setState("loading");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera-unavailable");
      const probe = document.createElement("canvas");
      if (!probe.getContext("webgl2") && !probe.getContext("webgl")) throw new Error("webgl-unavailable");
      const { startCardAR } = await import("./arSession");
      tracking.hidden = false;
      trackingMessage.textContent = "Переверните визитку и наведите камеру на лицевую сторону";
      session = await startCardAR({ stage, graph, config, debug, debugPanel, nodeCard, enter, trackingMessage,
        hooks: {
          setState,
          onFound: () => { tracking.hidden = false; hud.hidden = false; trackingMessage.textContent = "Портал открыт"; },
          onLost: () => { tracking.hidden = false; trackingMessage.textContent = "Верните визитку в кадр"; setState("lost"); },
          onRecovered: () => { setState("found"); },
          onFrame: () => {},
        },
      });
      starting = false;
    } catch (reason) {
      starting = false;
      const name = reason instanceof DOMException ? reason.name : reason instanceof Error ? reason.message : "unknown";
      if (import.meta.env.DEV) console.error("[card portal]", reason);
      const message = name === "NotAllowedError" || name === "PermissionDeniedError"
        ? "Доступ к камере запрещён. Разрешите его в настройках браузера — или продолжите без AR."
        : name === "NotFoundError" || name === "OverconstrainedError" ? "Камера не найдена. AR недоступен, но все ссылки работают."
        : name === "webgl-unavailable" ? "WebGL недоступен на этом устройстве. Все ссылки работают без AR."
        : name === "camera-unavailable" ? "Этот браузер не отдаёт камеру. Все ссылки работают без AR."
        : "AR-портал не запустился. Проверьте доступ к камеру или продолжите на обычном сайте.";
      showCameraError(message);
    }
  };

  root.querySelectorAll<HTMLElement>("[data-ar-start], [data-ar-retry]").forEach((button) => button.addEventListener("click", () => void startSession()));
  root.querySelector("[data-ar-stop]")?.addEventListener("click", stopSession);
  root.querySelector("[data-node-close]")?.addEventListener("click", closeNodeCard);
  root.querySelector("[data-contact-open]")?.addEventListener("click", () => dialog.showModal());
  root.querySelector("[data-contact-close]")?.addEventListener("click", () => dialog.close());
  // Exit intents must release the camera: pagehide covers normal navigation and
  // reload; visibilitychange keeps the stream from running in a hidden tab.
  window.addEventListener("pagehide", stopSession, { once: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopSession(); });
}
