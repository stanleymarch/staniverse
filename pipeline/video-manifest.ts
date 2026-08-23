export type VideoPlatform = "youtube" | "vk";
export type VideoOwnership = "verified" | "pending" | "external";
export type VideoVerificationStatus = "verified" | "pending" | "external";

export interface VideoEvidence {
  kind: "local-link" | "channel-page" | "manifest";
  path: string;
  url: string;
}

export interface VideoVerification {
  status: VideoVerificationStatus;
  reason: string;
  evidence: VideoEvidence[];
}

export interface VideoManifestEntry {
  id: string;
  title: string;
  platform: VideoPlatform;
  format: "video" | "short" | "stream" | "embed";
  ownership: VideoOwnership;
  sourceUrl: string;
  embedUrl?: string;
  target: string;
  /** Stable key into video-channels.json. Handles are not identity proof. */
  channelKey?: string;
  channelHandle?: string;
  /** Deliberately absent until a local source proves the platform channel ID. */
  channelId?: string;
  /** Publication timestamp reported by the canonical channel feed. */
  publishedAt?: string;
  verification?: VideoVerification;
}

export interface AllowlistedChannel {
  key: string;
  platform: VideoPlatform;
  label: string;
  handle: string;
  channelUrl: string;
  /** Null means the ID has not been established from local evidence yet. */
  channelId?: string | null;
  evidence: VideoEvidence[];
}

export interface OwnershipResult {
  ownership: VideoOwnership;
  verification: VideoVerification;
  channel?: AllowlistedChannel;
}

/**
 * Verify ownership without network access. A handle or editorial target is
 * useful provenance, but only an exact allowlisted platform ID is identity
 * evidence. This keeps imports repeatable and prevents accidental claims.
 */
export function verifyVideoOwnership(
  video: Pick<VideoManifestEntry, "platform" | "ownership" | "channelKey" | "channelHandle" | "channelId" | "sourceUrl">,
  channels: AllowlistedChannel[],
): OwnershipResult {
  if (video.ownership === "external") {
    return {
      ownership: "external",
      verification: {
        status: "external",
        reason: "external-source",
        evidence: [],
      },
    };
  }

  const channel = video.channelKey ? channels.find((item) => item.key === video.channelKey && item.platform === video.platform) : undefined;
  const evidence = channel?.evidence ?? [];

  if (!channel) {
    return {
      ownership: "pending",
      verification: { status: "pending", reason: "channel-not-allowlisted", evidence },
    };
  }

  if (!channel.channelId || !video.channelId) {
    return {
      ownership: "pending",
      verification: { status: "pending", reason: "channel-id-not-established", evidence },
      channel,
    };
  }

  if (channel.channelId !== video.channelId) {
    return {
      ownership: "pending",
      verification: { status: "pending", reason: "channel-id-mismatch", evidence },
      channel,
    };
  }

  return {
    ownership: "verified",
    verification: { status: "verified", reason: "allowlisted-channel-id", evidence },
    channel,
  };
}

export function youtubeThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

export function channelEvidence(channel: AllowlistedChannel): VideoEvidence[] {
  return channel.evidence.map((item) => ({ ...item }));
}
