export interface TelegramTextEntity { type: string; text: string; href?: string; language?: string }
export interface TelegramMessage {
  id: number;
  type?: string;
  date?: string;
  date_unixtime?: string;
  edited?: string;
  text?: string | Array<string | TelegramTextEntity>;
  text_entities?: TelegramTextEntity[];
  reply_to_message_id?: number;
  grouped_id?: string | number;
  photo?: string;
  file?: string;
  video_file?: string;
  audio_file?: string;
  voice_message?: string;
  mime_type?: string;
}
export interface TelegramExport { name?: string; id?: number; messages: TelegramMessage[] }
export interface Thread { rootId: number; messages: TelegramMessage[] }
export interface CanonicalMedia { sourcePath: string; type: "image"|"video"|"audio"|"document"; order: number; messageId: number }
export interface CanonicalSourceLink { url: string; messageId: number }
export interface CanonicalRelation { targetId: string; type: "references"; evidence: "telegram-link"; confidence: 1 }
export interface CanonicalPublication {
  id: string;
  kind: "telegram-post";
  sourceId: string;
  sourceUrl: string;
  date?: string;
  editedDate?: string;
  threadIds: string[];
  body: string;
  tags: string[];
  links: CanonicalSourceLink[];
  relations: CanonicalRelation[];
  media: CanonicalMedia[];
  rawMessageIds: number[];
}
