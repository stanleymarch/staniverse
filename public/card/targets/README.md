# Image target for `/card/`

The checked-in development pair is the official MindAR sample card. It exists only so camera tracking can be developed before the printed Staniverse card is final:

- `card-target-source-dev.png` — the image to print or show during development;
- `card-target-dev.mind` — the compiled MindAR target used by `src/config/cardPortal.ts`.

## Replace it with the production card

1. Export the final front face as a flat, high-resolution PNG. Keep its printed ratio close to 85 × 55 mm (1.545:1), use asymmetric high-contrast details, and avoid repeated dot patterns or large empty areas.
2. Open the official local/compiler tool from the pinned `mind-ar@1.2.5` package or the MindAR image-target compiler, add the PNG, inspect its feature map, and export the `.mind` file.
3. Put both source PNG and compiled `.mind` in this directory. Use production-specific names rather than overwriting the development pair while comparing tracking.
4. Change `targetSrc` and, if necessary, `targetAspect` once in `src/config/cardPortal.ts`.
5. Print at final size on matte stock. Test the physical card at 20–50 cm, straight on and at 20–30°, under daylight, room light, low light, glare, hand jitter, and partial finger occlusion.
6. Run `npm run build`, deploy through the normal site pipeline, and repeat the physical test from the production HTTPS URL. Camera access does not work on an ordinary insecure remote origin.

Do not treat successful tracking from a monitor as print validation. The `.mind` file is derived from the exact production artwork; any material artwork change requires recompilation and another physical test.
