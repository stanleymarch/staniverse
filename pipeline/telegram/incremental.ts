import { createHash } from "node:crypto";
import type { TelegramMessage } from "./types";

export const messageFingerprint=(message:TelegramMessage)=>createHash("sha256").update(JSON.stringify(message)).digest("hex");

export function mergeMessages(previous:TelegramMessage[],incoming:TelegramMessage[]){
  const merged=new Map(previous.map((message)=>[message.id,message]));let added=0,updated=0,unchanged=0;
  for(const message of incoming){
    const old=merged.get(message.id);
    // A later export can be made without forwarded-from info (the export setting
    // differs per download); provenance already learned from an earlier export is
    // carried forward instead of being silently erased by the newer message.
    const carried=old?.forwarded_from&&!message.forwarded_from?{...message,forwarded_from:old.forwarded_from}:message;
    if(!old)added++;else if(messageFingerprint(old)!==messageFingerprint(carried))updated++;else unchanged++;
    merged.set(message.id,carried);
  }
  return {messages:[...merged.values()].sort((a,b)=>a.id-b.id),added,updated,unchanged};
}
