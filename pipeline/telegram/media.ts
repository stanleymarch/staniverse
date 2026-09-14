import type { CanonicalMedia, TelegramMessage } from "./types";

/**
 * Telegram writes a marker into the media field when the export did not download the
 * file — `(File not included. Change data exporting settings to download.)`. The message
 * still is a media message, but there is no file to publish.
 */
export const isStoredMediaPath = (value: string | undefined): value is string => Boolean(value && !value.startsWith("("));
export const isMediaMessage = (message: TelegramMessage): boolean =>
  Boolean(message.photo || message.video_file || message.audio_file || message.voice_message || message.file);

/** The single attachment a message carries, in Telegram's own precedence order. */
export const storedAttachment = (message: TelegramMessage): string | undefined =>
  [message.photo, message.video_file, message.audio_file, message.voice_message, message.file].find(isStoredMediaPath);

const attachmentType = (message: TelegramMessage): CanonicalMedia["type"] =>
  message.photo ? "image"
    : message.video_file || message.mime_type?.startsWith("video/") ? "video"
      : message.audio_file || message.voice_message || message.mime_type?.startsWith("audio/") ? "audio"
        : "document";

/** Photos nested anywhere inside a Telegram Article, in document order. */
export function richPhotos(node: unknown, result: string[] = []): string[] {
  if (!node || typeof node !== "object") return result;
  const value = node as Record<string, unknown>;
  if (typeof value.photo === "string") result.push(value.photo);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => richPhotos(item, result));
    else if (child && typeof child === "object") richPhotos(child, result);
  }
  return result;
}

/** Every media item of one message, in source order; `order` is the position of the
 * message inside its publication, so an album keeps the sequence Telegram posted. */
export function messageMedia(message: TelegramMessage, order: number): CanonicalMedia[] {
  const attachment = storedAttachment(message);
  const primary = attachment ? [{ sourcePath: attachment, type: attachmentType(message), order, messageId: message.id }] : [];
  return [
    ...primary,
    ...richPhotos(message.rich_message).filter(isStoredMediaPath).map((photo, index) => ({
      sourcePath: photo,
      type: "image" as const,
      order: order + index + primary.length,
      messageId: message.id,
    })),
  ];
}
