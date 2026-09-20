import { createHash } from "node:crypto";
import type { TelegramMessage } from "./types";

export const messageFingerprint=(message:TelegramMessage)=>createHash("sha256").update(JSON.stringify(message)).digest("hex");

const MEDIA_KEYS = ["photo", "file", "video_file", "audio_file", "voice_message", "thumbnail"] as const;

export function mergeMessages(previous:TelegramMessage[],incoming:TelegramMessage[]){
  const merged=new Map(previous.map((message)=>[message.id,message]));let added=0,updated=0,unchanged=0;
  for(const message of incoming){
    const old=merged.get(message.id);
    // Later exports can be made without the media files ("(file not included)")
    // or without forwarded-from info — the export settings differ per download.
    // Provenance and real media paths already learned from an earlier export are
    // carried forward instead of being silently erased by the newer message.
    const carried={...message};
    if(old?.forwarded_from&&!carried.forwarded_from)carried.forwarded_from=old.forwarded_from;
    for(const key of MEDIA_KEYS){
      const value=carried[key],previousValue=old?.[key];
      if(typeof previousValue==="string"&&!previousValue.startsWith("(")&&typeof value==="string"&&value.startsWith("("))(carried as Record<string,unknown>)[key]=previousValue;
    }
    if(!old)added++;else if(messageFingerprint(old)!==messageFingerprint(carried))updated++;else unchanged++;
    merged.set(message.id,carried);
  }
  return {messages:[...merged.values()].sort((a,b)=>a.id-b.id),added,updated,unchanged};
}
