import type { TelegramMessage, Thread } from "./types";

const continuationMarker = /(?:\u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0435\u043d\u0438\u0435|\u043d\u0430\u0447\u0430\u043b\u043e|\u0447\u0430\u0441\u0442\u044c)/iu;
const numberedContinuation = /(?:\u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0435\u043d\u0438\u0435|\u043d\u0430\u0447\u0430\u043b\u043e|\u0447\u0430\u0441\u0442\u044c)\s*(?:\u043f\u043e\u0441\u0442\u0430)?\s*(?:\u2116|#|:)?\s*(\d+)/giu;
const telegramPostLink = /(?:https?:\/\/)?t\.me\/[\w-]+\/(\d+)/giu;

function plainText(message: TelegramMessage): string {
  if (typeof message.text === "string") return message.text;
  if (Array.isArray(message.text)) return message.text.map((part) => typeof part === "string" ? part : part.text).join("");
  return "";
}

function continuationTarget(message: TelegramMessage, ids: Set<number>): number | undefined {
  const text = plainText(message);
  const patterns = [numberedContinuation];
  if (continuationMarker.test(text)) patterns.unshift(telegramPostLink);
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const id = Number(match[1]);
      if (id !== message.id && ids.has(id)) return id;
    }
  }
}

export function buildThreads(input: TelegramMessage[]): Thread[] {
  const messages = [...new Map(input.filter((message) => message.type !== "service").map((message) => [message.id, message])).values()].sort((a,b) => a.id-b.id);
  const byId = new Map(messages.map((message) => [message.id, message]));
  const ids = new Set(byId.keys());
  const parent = new Map<number, number>();
  const firstByGroup = new Map<string, number>();

  for (const message of messages) {
    if (message.grouped_id !== undefined) {
      const group = String(message.grouped_id);
      const first = firstByGroup.get(group);
      if (first !== undefined) parent.set(message.id, first); else firstByGroup.set(group, message.id);
    }
    if (message.reply_to_message_id && byId.has(message.reply_to_message_id)) parent.set(message.id, message.reply_to_message_id);
    const continuation = continuationTarget(message, ids);
    if (continuation !== undefined) parent.set(message.id, continuation);
  }

  const rootOf = (id: number) => {
    const visited = new Set<number>();
    let current = id;
    while (parent.has(current) && !visited.has(current)) {
      visited.add(current);
      current = parent.get(current)!;
    }
    return current;
  };
  const grouped = new Map<number, TelegramMessage[]>();
  for (const message of messages) {
    const root = rootOf(message.id);
    const list = grouped.get(root) ?? [];
    list.push(message);
    grouped.set(root,list);
  }
  return [...grouped.entries()]
    .map(([rootId, threadMessages]) => ({ rootId, messages: threadMessages.sort((a,b)=>a.id-b.id) }))
    .sort((a,b)=>a.rootId-b.rootId);
}
