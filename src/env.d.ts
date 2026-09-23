/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_YANDEX_METRIKA_ID?: string;
  readonly YANDEX_WEBMASTER_VERIFICATION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module "three-mindar" {
  export * from "three";
}

declare module "mind-ar/dist/mindar-image-three.prod.js" {
  import type * as THREE from "three-mindar";
  export class MindARThree {
    constructor(options: Record<string, unknown>);
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    addAnchor(index: number): { group: THREE.Group; onTargetFound?: () => void; onTargetLost?: () => void };
    start(): Promise<void>;
    stop(): void;
  }
}
