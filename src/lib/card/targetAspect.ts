import sharp from "sharp";

/**
 * The portal aperture has to match the compiled target's own artwork, not the
 * card outline: MindAR anchors to the whole tracked image, so a hardcoded 85:55
 * aperture would hang past the printed target whenever the front side is not a
 * full-bleed landscape illustration. Measuring the source PNG keeps the scene
 * and the artwork from drifting apart when the production card arrives.
 *
 * The artwork is not published, so the path is repo-relative and read at build
 * time instead of coming from a URL.
 */
export async function targetAspectFor(sourcePath: string, fallback: number) {
  try {
    const meta = await sharp(sourcePath).metadata();
    if (meta.width && meta.height) return meta.width / meta.height;
    console.warn(`[card] ${sourcePath} has no readable dimensions; using fallback aspect ${fallback}.`);
    return fallback;
  } catch (error) {
    console.warn(`[card] cannot measure ${sourcePath}; using fallback aspect ${fallback}.`, error);
    return fallback;
  }
}
