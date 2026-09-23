import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import jsQR from "jsqr";
import { CARD_PORTAL } from "../src/config/cardPortal";
import { targetAspectFor } from "../src/lib/card/targetAspect";

/** The printed card is the only way in, so its link is pinned to one canonical URL. */
const ENTRY_URL = "https://staniverse.xyz/card/";

async function decodeQr(path: string) {
  // SVG sides are rasterised at ~150 dpi: the 25 mm code lands near nine pixels
  // per module, which a phone camera resolves comfortably, while a 300+ dpi
  // raster is large enough that the detector itself starts failing on it.
  const source = path.endsWith(".svg") ? await sharp(path, { density: 150 }).png().toBuffer() : await sharp(path).png().toBuffer();
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
}

test("the printed QR encodes the canonical entry URL", async () => {
  assert.equal(await decodeQr("public/card/print/qr-card.png"), ENTRY_URL);
});

test("the printable card back carries the same link as the standalone QR", async () => {
  assert.equal(await decodeQr("public/card/print/card-dev-back.svg"), ENTRY_URL);
});

test("the compiled target and its source artwork are both present", () => {
  assert.ok(existsSync(join("public", CARD_PORTAL.targetSrc)), `${CARD_PORTAL.targetSrc} is missing`);
  assert.ok(existsSync(join("public", CARD_PORTAL.targetAspectSource)), `${CARD_PORTAL.targetAspectSource} is missing`);
  assert.ok(existsSync("public/card/print/card-dev-front.svg"), "the printable front side is missing");
});

test("the aperture aspect follows the tracked artwork, not the card outline", async () => {
  const measured = await targetAspectFor(CARD_PORTAL.targetAspectSource, CARD_PORTAL.targetAspectFallback);
  const meta = await sharp(join("public", CARD_PORTAL.targetAspectSource)).metadata();
  assert.equal(measured, meta.width! / meta.height!);
  assert.notEqual(measured, CARD_PORTAL.targetAspectFallback);
});
