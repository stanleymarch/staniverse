import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import jsQR from "jsqr";
import { CARD_PORTAL } from "../src/config/cardPortal";
import { targetAspectFor } from "../src/lib/card/targetAspect";

/** The printed card is the only way in, so its link is pinned to one canonical URL. */
const ENTRY_URL = "https://staniverse.xyz/card/";
/** Working files, deliberately outside `public/`: nothing here is served. */
const PRINT_DIR = "design/card/print";

async function decodeQr(path: string) {
  // SVG sides are rasterised at ~150 dpi: the 25 mm code lands near nine pixels
  // per module, which a phone camera resolves comfortably, while a 300+ dpi
  // raster is large enough that the detector itself starts failing on it.
  const source = path.endsWith(".svg") ? await sharp(path, { density: 150 }).png().toBuffer() : await sharp(path).png().toBuffer();
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
}

test("the printed QR encodes the canonical entry URL", async () => {
  assert.equal(await decodeQr(join(PRINT_DIR, "qr-card.png")), ENTRY_URL);
});

test("the printable card back carries the same link as the standalone QR", async () => {
  assert.equal(await decodeQr(join(PRINT_DIR, "card-dev-back.svg")), ENTRY_URL);
});

test("only the compiled target is published, while the artwork and print sides are kept", () => {
  assert.ok(existsSync(join("public", CARD_PORTAL.targetSrc)), `${CARD_PORTAL.targetSrc} is missing`);
  assert.ok(existsSync(CARD_PORTAL.targetAspectSource), `${CARD_PORTAL.targetAspectSource} is missing`);
  assert.ok(existsSync(join(PRINT_DIR, "card-dev-front.svg")), "the printable front side is missing");
  // A leading slash would make the artwork a URL the site serves; the samples
  // must stay reachable only from the repository.
  assert.ok(!CARD_PORTAL.targetAspectSource.startsWith("/"), `${CARD_PORTAL.targetAspectSource} would be served by the site`);
  const publishedTargets = readdirSync("public/card/targets");
  assert.ok(publishedTargets.every((name) => name.endsWith(".mind")), `public/card/targets must hold only compiled targets, found: ${publishedTargets.join(", ")}`);
});

test("the aperture aspect follows the tracked artwork, not the card outline", async () => {
  const measured = await targetAspectFor(CARD_PORTAL.targetAspectSource, CARD_PORTAL.targetAspectFallback);
  const meta = await sharp(CARD_PORTAL.targetAspectSource).metadata();
  assert.equal(measured, meta.width! / meta.height!);
  assert.notEqual(measured, CARD_PORTAL.targetAspectFallback);
});
