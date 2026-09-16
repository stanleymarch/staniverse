export interface TelegramTextEntity { type: string; text: string; href?: string; language?: string }
export interface TelegramMessage {
  id: number;
  type?: string;
  date?: string;
  date_unixtime?: string;
  edited?: string;
  edited_unixtime?: string;
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
  rich_message?: TelegramRichMessage;
}
export interface TelegramRichNode { type?: string; level?: number; text?: string|TelegramRichNode|TelegramRichNode[]; href?: string; photo?: string; caption?: TelegramRichNode; items?: TelegramRichNode[]; blocks?: TelegramRichNode[]; [key:string]: unknown }
export interface TelegramRichMessage { rtl?: boolean; part?: boolean; blocks: TelegramRichNode[] }
export interface TelegramExport { name?: string; id?: number; messages: TelegramMessage[] }
/** One publication and the Telegram messages it owns: a single post, or an album. */
export interface PublicationGroup { rootId: number; messages: TelegramMessage[] }
export interface CanonicalMedia { sourcePath: string; publicPath?: string; type: "image"|"video"|"audio"|"document"; order: number; messageId: number }
export interface CanonicalSourceLink { url: string; messageId: number }
/** Materialized frontmatter can carry reviewed relation metadata in addition
 * to the raw Telegram import fields. */
export interface CanonicalRelationProvenance {
  kind?: string;
  [key: string]: unknown;
}
export interface CanonicalRelation {
  targetId: string;
  type: string;
  evidence: string;
  confidence: number;
  explanation?: string;
  reviewStatus?: string;
  status?: string;
  provenance?: string | CanonicalRelationProvenance;
}
export interface CanonicalPublication {
  id: string;
  kind: "telegram-post"|"telegram-article";
  sourceId: string;
  sourceUrl: string;
  date?: string;
  title?: string;
  editedDate?: string;
  threadIds: string[];
  body: string;
  tags: string[];
  links: CanonicalSourceLink[];
  relations: CanonicalRelation[];
  media: CanonicalMedia[];
  rawMessageIds: number[];
}
