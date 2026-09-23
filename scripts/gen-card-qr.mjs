/**
 * Generates the printed side of the physical card.
 *
 * The QR is the only way in: it must encode the canonical entry URL exactly, so
 * the encoding is derived from one constant here instead of being drawn by hand
 * in a design tool. The front side is the image target itself, placed at the
 * card's real millimetre size, so what is printed is what the tracker was
 * compiled from.
 *
 *   node scripts/gen-card-qr.mjs
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import QRCode from "qrcode";
import sharp from "sharp";

/** Canonical entry point. The printed card must never point anywhere else. */
const ENTRY_URL = "https://staniverse.xyz/card/";
/** ISO card size, portrait-agnostic: 85 × 55 mm landscape. */
const CARD = { width: 85, height: 55 };
const QR_MM = 25;
const TARGET_SOURCE = "public/card/targets/card-target-source-dev.png";
const PRINT_DIR = "public/card/print";

const write = async (path, content) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  console.log(`${path} — ${typeof content === "string" ? `${content.length} bytes` : `${content.byteLength} bytes`}`);
};

/** Draws QR modules as rects in module units; callers scale once. */
function qrRects(text, errorCorrectionLevel = "M") {
  const { modules } = QRCode.create(text, { errorCorrectionLevel });
  const quiet = 4;
  const total = modules.size + quiet * 2;
  const rects = [];
  for (let row = 0; row < modules.size; row += 1) {
    for (let col = 0; col < modules.size; col += 1) {
      if (!modules.data[row * modules.size + col]) continue;
      rects.push(`<rect x="${col + quiet}" y="${row + quiet}" width="1" height="1" />`);
    }
  }
  return { rects, total };
}

function standaloneQrSvg(text) {
  const { rects, total } = qrRects(text);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${QR_MM}mm" height="${QR_MM}mm" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">
  <rect width="${total}" height="${total}" fill="#ffffff" />
  <g fill="#060b18">${rects.join("")}</g>
</svg>
`;
}

function backSvg(text) {
  const { rects, total } = qrRects(text);
  const panel = { x: CARD.width - QR_MM - 6, y: (CARD.height - QR_MM) / 2, size: QR_MM };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}mm" height="${CARD.height}mm" viewBox="0 0 ${CARD.width} ${CARD.height}">
  <rect width="${CARD.width}" height="${CARD.height}" rx="3" fill="#060b18" />
  <rect x="0.35" y="0.35" width="${CARD.width - 0.7}" height="${CARD.height - 0.7}" rx="2.8" fill="none" stroke="#79d7f2" stroke-opacity="0.42" stroke-width="0.3" />
  <g fill="#eef5ff" font-family="Geologica, Helvetica, Arial, sans-serif">
    <text x="6" y="14" font-size="4.2" font-weight="600" letter-spacing="0.12">станивёрс</text>
    <text x="6" y="26" font-size="3.6" font-weight="600" letter-spacing="0.34">SCAN TO ENTER</text>
    <text x="6" y="34" font-size="2.6" fill="#94aac8" letter-spacing="0.06">staniverse.xyz/card</text>
    <text x="6" y="45" font-size="2.2" fill="#94aac8" letter-spacing="0.04">Стас Ермоленко</text>
    <text x="6" y="49.6" font-size="2.2" fill="#94aac8" letter-spacing="0.04">XR · AI · цифровые архивы · медиа</text>
  </g>
  <rect x="${panel.x}" y="${panel.y}" width="${panel.size}" height="${panel.size}" rx="2" fill="#ffffff" />
  <g fill="#060b18" transform="translate(${panel.x} ${panel.y}) scale(${(panel.size / total).toFixed(6)})">${rects.join("")}</g>
</svg>
`;
}

async function frontSvg() {
  const image = await readFile(TARGET_SOURCE);
  const meta = await sharp(image).metadata();
  const aspect = meta.width / meta.height;
  const width = CARD.width;
  const height = width / aspect;
  const y = (CARD.height - height) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}mm" height="${CARD.height}mm" viewBox="0 0 ${CARD.width} ${CARD.height}">
  <rect width="${CARD.width}" height="${CARD.height}" rx="3" fill="#060b18" />
  <image x="0" y="${y.toFixed(3)}" width="${width}" height="${height.toFixed(3)}" preserveAspectRatio="none" href="data:image/png;base64,${image.toString("base64")}" />
</svg>
`;
}

const qrSvg = standaloneQrSvg(ENTRY_URL);
await write(join(PRINT_DIR, "qr-card.svg"), qrSvg);
await write(join(PRINT_DIR, "qr-card.png"), await sharp(Buffer.from(qrSvg)).resize(1024, 1024).png().toBuffer());
await write(join(PRINT_DIR, "card-dev-back.svg"), backSvg(ENTRY_URL));
await write(join(PRINT_DIR, "card-dev-front.svg"), await frontSvg());
console.log(`QR encodes: ${ENTRY_URL}`);
