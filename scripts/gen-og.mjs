/** Renders branded Open Graph images (1200x630) into dist/og/ after build.
 * Zero per-page runtime cost. Sharp reads the same self-hosted Unbounded and
 * Geologica files as the site through a project-local fontconfig. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "dist", "og");
const fontDir = join(root, "scripts", "fonts");
const fontCacheDir = join(root, "tmp", "fontconfig-cache");
const fontConfigPath = join(root, "tmp", "og-fontconfig.xml");
await mkdir(outDir, { recursive: true });
await mkdir(fontCacheDir, { recursive: true });
await writeFile(fontConfigPath, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><dir>${fontDir}</dir><cachedir>${fontCacheDir}</cachedir></fontconfig>`, "utf8");
process.env.FONTCONFIG_FILE = fontConfigPath;
const { default: sharp } = await import("sharp");

const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const card = ({ label, title, accent = "#64dff4" }) => `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="78%" cy="30%" r="60%">
      <stop offset="0%" stop-color="#3d7adb" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="#070a12" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="90%" cy="70%" r="45%">
      <stop offset="0%" stop-color="#23cdea" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#070a12" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#070a12"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect width="1200" height="630" fill="url(#glow2)"/>
  <g fill="#d6f9ff">
    ${Array.from({ length: 26 }, (_, i) => {
      const x = (i * 173) % 1160 + 20, y = ((i * 317) % 560) + 20, r = i % 5 === 0 ? 2.4 : 1.4;
      return `<circle cx="${x}" cy="${y}" r="${r}" opacity="${0.25 + (i % 4) * 0.14}"/>`;
    }).join("")}
  </g>
  <rect x="72" y="96" width="88" height="8" fill="${accent}"/>
  <text x="72" y="152" font-family="Geologica Thin Roman, sans-serif" font-weight="500" font-size="30" letter-spacing="6" fill="${accent}">${escape(label.toUpperCase())}</text>
  <text x="72" y="300" font-family="Unbounded, sans-serif" font-weight="600" font-size="82" letter-spacing="-2" fill="#eef3ff">${escape(title)}</text>
  <text x="72" y="540" font-family="Geologica Thin Roman, sans-serif" font-weight="450" font-size="34" fill="#97a6c2">staniverse.xyz · Станислав Ермоленко</text>
</svg>`;

const images = {
  "staniverse": { label: "Staniverse", title: "Цифровой сад", accent: "#64dff4" },
  "works": { label: "Работы", title: "Портфолио", accent: "#64dff4" },
  "projects": { label: "Проекты", title: "Лаборатория", accent: "#7183bd" },
  "garden": { label: "Сад", title: "Каталог опыта", accent: "#64dff4" },
  "videos": { label: "Видео", title: "Видеотека", accent: "#ef8ecf" },
  "topics": { label: "Темы", title: "Указатель", accent: "#7183bd" },
  "articles": { label: "Статьи", title: "Лонгриды", accent: "#ef8ecf" },
  "about": { label: "Обо мне", title: "Профиль", accent: "#64dff4" },
  "universe": { label: "Вселенная", title: "Пространство идей", accent: "#7183bd" },
  "donate": { label: "Поддержать", title: "Топливо для проектов", accent: "#ef8ecf" },
};

for (const [name, spec] of Object.entries(images)) {
  const png = await sharp(Buffer.from(card(spec))).png().toBuffer();
  await writeFile(join(outDir, `${name}.png`), png);
}
console.log(`og images: ${Object.keys(images).length} written to dist/og/`);
