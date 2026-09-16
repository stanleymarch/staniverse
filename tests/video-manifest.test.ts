import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { materializeVideos } from "../pipeline/materialize-videos";
import {
  type AllowlistedChannel,
  type VideoManifestEntry,
  verifyVideoOwnership,
} from "../pipeline/video-manifest";

const channel: AllowlistedChannel = {
  key: "staniverse",
  platform: "youtube",
  label: "Staniverse",
  handle: "@staniverse",
  channelUrl: "https://www.youtube.com/@staniverse",
  channelId: "UC-local-evidence",
  evidence: [{ kind: "channel-page", path: "src/content/projects/staniverse.md", url: "https://www.youtube.com/@staniverse" }],
};

const video = (overrides: Partial<VideoManifestEntry> = {}): VideoManifestEntry => ({
  id: "abc12345678",
  title: "Test video",
  platform: "youtube",
  format: "video",
  ownership: "pending",
  sourceUrl: "https://www.youtube.com/watch?v=abc12345678",
  embedUrl: "https://www.youtube.com/embed/abc12345678",
  target: "project:test",
  channelKey: "staniverse",
  channelHandle: "@staniverse",
  ...overrides,
});

test("verification requires an exact allowlisted channel ID", () => {
  assert.equal(verifyVideoOwnership(video(), [channel]).ownership, "pending");
  assert.equal(verifyVideoOwnership(video({ channelId: "wrong" }), [channel]).verification.reason, "channel-id-mismatch");
  assert.equal(verifyVideoOwnership(video({ channelId: "UC-local-evidence" }), [channel]).ownership, "verified");
});

test("external links remain references and can never become owned", () => {
  const result = verifyVideoOwnership(video({ ownership: "external", channelId: "UC-local-evidence" }), [channel]);
  assert.equal(result.ownership, "external");
  assert.equal(result.verification.reason, "external-source");
});

test("external videos stay contextual and are never materialized as publications", async () => {
  const root = await mkdtemp(join(tmpdir(), "staniverse-video-"));
  try {
    const manifestPath = join(root, "manifest.json");
    const channelsPath = join(root, "channels.json");
    const outputDir = join(root, "publications");
    await writeFile(manifestPath, JSON.stringify([video({ ownership: "external" })]));
    await writeFile(channelsPath, JSON.stringify([channel]));
    const result = await materializeVideos({ manifestPath, channelsPath, outputDir });
    assert.equal(result.videos, 0);
    assert.equal(result.excludedExternal, 1);
    assert.deepEqual(await readdir(outputDir), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository manifest contains no unverified own records or placeholder", async () => {
  const manifest = JSON.parse(await readFile("pipeline/video-manifest.json", "utf8")) as VideoManifestEntry[];
  assert.ok(manifest.length > 0);
  assert.ok(manifest.every((item) => item.ownership !== ("own" as never)));
  assert.ok(manifest.filter((item) => item.platform === "youtube" && item.channelKey === "staniverse").every((item) => item.channelHandle === "@staniverse"));
  assert.equal((await readFile("src/content/publications/youtube-cultural-travel.md").catch(() => null)), null);
});
