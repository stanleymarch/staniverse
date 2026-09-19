/* Lightbox for garden and article imagery.

   One delegated listener turns every content image into an entry point:
   - an image wrapped in a link to an image file opens that image;
   - a carousel or gallery group opens as a navigable set from the clicked item;
   - a bare content image opens on its own.
   Inside the overlay: side arrows, keyboard, swipe, counter, close on Esc,
   backdrop or ✕, and pointer-anchored zoom (wheel, drag, pinch).
   A middle-click or modifier-click falls through to the browser default. */

export interface LightboxItem {
  src: string;
  alt?: string;
}

interface OverlayRefs {
  root: HTMLDivElement;
  image: HTMLImageElement;
  caption: HTMLElement;
  counter: HTMLElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  close: HTMLButtonElement;
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const SWIPE_THRESHOLD = 44;

const imageHref = (value: string) =>
  /\.(avif|webp|jpe?g|png|gif|svg)([?#].*)?$/i.test(value) || value.startsWith("/media/");

const anchorItems = (anchor: HTMLAnchorElement): LightboxItem[] => {
  const scope =
    anchor.closest<HTMLElement>("[data-media-carousel]") ??
    anchor.closest<HTMLElement>(".media-gallery") ??
    anchor.closest<HTMLElement>(".prose");
  if (!scope) return [];
  return [...scope.querySelectorAll<HTMLAnchorElement>("a")]
    .filter((link) => link.querySelector("img") && imageHref(link.getAttribute("href") ?? ""))
    .map((link) => ({ src: link.getAttribute("href") as string, alt: link.querySelector("img")?.alt ?? "" }));
};

class Lightbox {
  private items: LightboxItem[] = [];
  private index = 0;
  private scale = 1;
  private panX = 0;
  private panY = 0;
  private baseTop = 0;
  private baseLeft = 0;
  private baseWidth = 0;
  private baseHeight = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private dragFrom: { x: number; y: number; panX: number; panY: number } | null = null;
  private moved = false;
  private restoredFocus: HTMLElement | null = null;
  private refs: OverlayRefs | null = null;

  install() {
    const candidates = document.querySelectorAll<HTMLImageElement>(".prose img, .media-carousel img, .media-gallery img");
    for (const image of candidates) {
      const anchor = image.closest<HTMLAnchorElement>("a");
      if (anchor && !imageHref(anchor.getAttribute("href") ?? "")) continue;
      image.dataset.lightboxTrigger = "";
      if (!image.hasAttribute("title")) image.title = "Открыть изображение на весь экран";
      if (!anchor) {
        image.tabIndex = 0;
        image.setAttribute("role", "button");
        image.setAttribute("aria-label", image.alt ? `Открыть на весь экран: ${image.alt}` : "Открыть изображение на весь экран");
      }
    }
    document.addEventListener("click", (event) => this.delegate(event), { passive: false });
    document.addEventListener("keydown", (event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLImageElement>("img[data-lightbox-trigger]") : null;
      if (!target || target.closest("a") || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      target.click();
    });
  }

  private delegate(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    const image = target?.closest?.("img");
    if (!image) return;
    const scope = image.closest<HTMLElement>(".prose, .media-carousel, .media-gallery, .channel-gallery-grid");
    if (!scope) return;
    const anchor = image.closest<HTMLAnchorElement>("a");
    let items: LightboxItem[] = [];
    let index = 0;
    if (anchor && imageHref(anchor.getAttribute("href") ?? "")) {
      items = anchorItems(anchor);
      const found = items.findIndex((item) => item.src === anchor.getAttribute("href"));
      index = found >= 0 ? found : 0;
    } else if (anchor) {
      return; // The link leads somewhere else: let the reader follow it.
    } else {
      items = [{ src: image.currentSrc || image.src, alt: image.alt }];
    }
    if (!items.length) return;
    event.preventDefault();
    this.open(items, index);
  }

  private overlay(): OverlayRefs {
    if (this.refs) return this.refs;
    const root = document.createElement("div");
    root.className = "lightbox";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Просмотр изображения");
    root.innerHTML = `
      <div class="lightbox__backdrop" data-close></div>
      <figure class="lightbox__figure">
        <img class="lightbox__image" alt="" decoding="async">
        <figcaption class="lightbox__caption"><span data-caption></span><span class="lightbox__counter" data-counter></span></figcaption>
      </figure>
      <button type="button" class="lightbox__arrow is-prev" data-prev aria-label="Предыдущее изображение">←</button>
      <button type="button" class="lightbox__arrow is-next" data-next aria-label="Следующее изображение">→</button>
      <button type="button" class="lightbox__close" data-close aria-label="Закрыть просмотр">✕</button>
      <p class="lightbox__hint">Колесо — масштаб, протянуть — сдвинуть · клик вне изображения — закрыть</p>`;
    document.body.append(root);
    const refs: OverlayRefs = {
      root,
      image: root.querySelector(".lightbox__image") as HTMLImageElement,
      caption: root.querySelector("[data-caption]") as HTMLElement,
      counter: root.querySelector("[data-counter]") as HTMLElement,
      previous: root.querySelector("[data-prev]") as HTMLButtonElement,
      next: root.querySelector("[data-next]") as HTMLButtonElement,
      close: root.querySelector(".lightbox__close") as HTMLButtonElement,
    };
    refs.image.addEventListener("load", () => this.measureBase());
    refs.image.addEventListener("wheel", (event) => this.wheelZoom(event), { passive: false });
    refs.previous.addEventListener("click", () => this.step(-1));
    refs.next.addEventListener("click", () => this.step(1));
    for (const element of [refs.close, ...root.querySelectorAll<HTMLElement>("[data-close]")]) {
      element.addEventListener("click", () => this.closeOverlay());
    }
    root.addEventListener("pointerdown", (event) => this.pointerDown(event));
    root.addEventListener("pointermove", (event) => this.pointerMove(event));
    root.addEventListener("pointerup", (event) => this.pointerUp(event));
    root.addEventListener("pointercancel", (event) => this.pointerUp(event));
    root.addEventListener("keydown", (event) => this.keydown(event));
    this.refs = refs;
    return refs;
  }

  private open(items: LightboxItem[], index: number) {
    const refs = this.overlay();
    this.items = items;
    this.index = index;
    this.restoredFocus = document.activeElement as HTMLElement | null;
    refs.root.hidden = false;
    document.documentElement.style.overflow = "hidden";
    requestAnimationFrame(() => refs.root.classList.add("is-open"));
    this.show();
    refs.close.focus();
  }

  private closeOverlay() {
    if (!this.refs || this.refs.root.hidden) return;
    const { root } = this.refs;
    root.classList.remove("is-open");
    document.documentElement.style.overflow = "";
    const finish = () => {
      root.hidden = true;
      this.refs?.image.removeAttribute("src");
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
    else root.addEventListener("transitionend", finish, { once: true });
    this.restoredFocus?.focus?.();
    this.restoredFocus = null;
  }

  private show() {
    const refs = this.refs as OverlayRefs;
    const item = this.items[this.index];
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    refs.image.alt = item.alt ?? "";
    refs.image.src = item.src;
    refs.image.classList.remove("is-zoomed");
    this.applyTransform();
    refs.caption.textContent = item.alt ?? "";
    refs.counter.textContent = this.items.length > 1 ? `${this.index + 1} / ${this.items.length}` : "";
    const multiple = this.items.length > 1;
    refs.previous.hidden = !multiple;
    refs.next.hidden = !multiple;
    this.measureBase();
    this.preload(this.index + 1);
    this.preload(this.index - 1);
  }

  private step(direction: number) {
    if (this.items.length < 2) return;
    this.index = (this.index + direction + this.items.length) % this.items.length;
    this.show();
  }

  private preload(index: number) {
    const item = this.items[(index + this.items.length) % this.items.length];
    if (item) new Image().src = item.src;
  }

  private measureBase() {
    const refs = this.refs;
    if (!refs || refs.root.hidden) return;
    const saved = refs.image.getAttribute("style");
    refs.image.style.transform = "none";
    const rect = refs.image.getBoundingClientRect();
    refs.image.setAttribute("style", saved ?? "");
    this.baseTop = rect.top;
    this.baseLeft = rect.left;
    this.baseWidth = rect.width;
    this.baseHeight = rect.height;
    this.applyTransform();
  }

  private applyTransform() {
    const refs = this.refs;
    if (!refs) return;
    refs.image.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    refs.image.classList.toggle("is-zoomed", this.scale > MIN_SCALE + 0.01);
  }

  /* The transform origin is the untransformed centre, so screen = base + pan + scale·offset. */
  private zoomAt(clientX: number, clientY: number, nextScale: number) {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    if (scale === this.scale) return;
    const centerX = this.baseLeft + this.baseWidth / 2 + this.panX;
    const centerY = this.baseTop + this.baseHeight / 2 + this.panY;
    const factor = scale / this.scale;
    this.panX = clientX - centerX + (centerX + this.panX - clientX) * factor;
    this.panY = clientY - centerY + (centerY + this.panY - clientY) * factor;
    if (scale === MIN_SCALE) {
      this.panX = 0;
      this.panY = 0;
    }
    this.scale = scale;
    this.applyTransform();
  }


  private wheelZoom(event: WheelEvent) {
    event.preventDefault();
    this.zoomAt(event.clientX, event.clientY, this.scale * Math.exp(-event.deltaY * 0.0016));
  }

  private pointerDown(event: PointerEvent) {
    if (event.target instanceof Element && event.target.closest("[data-prev], [data-next], [data-close]")) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      const [first, second] = [...this.pointers.values()];
      this.pinchDistance = Math.hypot(second.x - first.x, second.y - first.y);
    } else if (this.pointers.size === 1) {
      this.dragFrom = { x: event.clientX, y: event.clientY, panX: this.panX, panY: this.panY };
      this.moved = false;
    }
  }

  private pointerMove(event: PointerEvent) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      const [first, second] = [...this.pointers.values()];
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const middle = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      if (this.pinchDistance > 0) this.zoomAt(middle.x, middle.y, this.scale * (distance / this.pinchDistance));
      this.pinchDistance = distance;
      this.moved = true;
      return;
    }
    if (!this.dragFrom) return;
    const deltaX = event.clientX - this.dragFrom.x;
    const deltaY = event.clientY - this.dragFrom.y;
    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) this.moved = true;
    if (this.scale > MIN_SCALE + 0.01) {
      this.panX = this.dragFrom.panX + deltaX;
      this.panY = this.dragFrom.panY + deltaY;
      this.applyTransform();
      event.preventDefault();
    }
  }

  private pointerUp(event: PointerEvent) {
    const start = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    this.pinchDistance = 0;
    if (!this.dragFrom || !start) {
      this.dragFrom = null;
      return;
    }
    const deltaX = event.clientX - this.dragFrom.x;
    const deltaY = event.clientY - this.dragFrom.y;
    this.dragFrom = null;
    if (this.scale > MIN_SCALE + 0.01 || this.moved === false) return;
    if (Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
      this.step(deltaX < 0 ? 1 : -1);
    }
  }

  private keydown(event: KeyboardEvent) {
    switch (event.key) {
      case "Escape": event.preventDefault(); this.closeOverlay(); break;
      case "ArrowLeft": event.preventDefault(); this.step(-1); break;
      case "ArrowRight": event.preventDefault(); this.step(1); break;
      case "+": case "=": event.preventDefault(); this.zoomAt(innerWidth / 2, innerHeight / 2, this.scale * 1.3); break;
      case "-": event.preventDefault(); this.zoomAt(innerWidth / 2, innerHeight / 2, this.scale / 1.3); break;
      case "0": event.preventDefault(); this.zoomAt(innerWidth / 2, innerHeight / 2, MIN_SCALE); break;
      case "Tab": {
        const focusable = [...this.refs!.root.querySelectorAll<HTMLElement>("button:not([hidden])")];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        break;
      }
    }
  }
}

export function installLightbox() {
  new Lightbox().install();
}
