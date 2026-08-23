import test from "node:test";
import assert from "node:assert/strict";
import { buildThreads } from "../pipeline/telegram/threading";
import { normalizeExport, renderText } from "../pipeline/telegram/normalize";

test("collects explicit reply chains", () => {
  const threads = buildThreads([{id:10,text:"Начало"},{id:11,reply_to_message_id:10,text:"Продолжение"},{id:12,text:"Другой пост"}]);
  assert.deepEqual(threads.map((thread)=>thread.messages.map((message)=>message.id)), [[10,11],[12]]);
});

test("collects albums only by grouped_id and never by time heuristic", () => {
  const threads = buildThreads([{id:20,grouped_id:"a",photo:"1.jpg"},{id:21,grouped_id:"a",photo:"2.jpg"},{id:22,date:"2026-01-01T12:00",photo:"3.jpg"}]);
  assert.deepEqual(threads.map((thread)=>thread.messages.map((message)=>message.id)), [[20,21],[22]]);
});

test("follows explicit Telegram continuation links", () => {
  const threads = buildThreads([{id:30,text:"Первая часть"},{id:31,text:"Продолжение https://t.me/staniverse/30"}]);
  assert.equal(threads.length,1); assert.deepEqual(threads[0].messages.map((message)=>message.id),[30,31]);
});

test("keeps an ordinary Telegram hyperlink as a relation, not a thread", () => {
  const threads = buildThreads([{id:30,text:"source"},{id:31,text:"Useful reference https://t.me/staniverse/30"}]);
  assert.deepEqual(threads.map((thread)=>thread.messages.map((message)=>message.id)),[[30],[31]]);
});

test("deduplicates messages by Telegram ID", () => {
  const threads = buildThreads([{id:1,text:"old"},{id:1,text:"new"}]);
  assert.equal(threads.length,1); assert.equal(threads[0].messages[0].text,"new");
});

test("follows a Russian continuation marker with a post number", () => {
  const threads = buildThreads([{id:40,text:"root"},{id:41,text:"\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0435\u043d\u0438\u0435 \u043f\u043e\u0441\u0442\u0430 \u211640"}]);
  assert.equal(threads.length,1);
  assert.deepEqual(threads[0].messages.map((message)=>message.id),[40,41]);
});

test("renders Telegram entities as standard Markdown", () => {
  const text = renderText({id:1,text_entities:[{type:"plain",text:"Смотри "},{type:"bold",text:"важное"},{type:"plain",text:" и "},{type:"text_link",text:"источник",href:"https://example.com"}]});
  assert.equal(text,"Смотри **важное** и [источник](https://example.com)");
});

test("normalizes a thread without changing authorial text", () => {
  const [post] = normalizeExport({messages:[{id:7,date:"2026-01-01",text:"Первая мысль"},{id:8,reply_to_message_id:7,text:"Вторая мысль",photo:"photo.jpg"}]});
  assert.equal(post.id,"publication:telegram:staniverse:7"); assert.equal(post.body,"Первая мысль\n\nВторая мысль"); assert.deepEqual(post.threadIds,["7","8"]); assert.equal(post.media[0].messageId,8);
});

test("extracts tags and explicit post references without rewriting text", () => {
  const posts = normalizeExport({messages:[
    {id:50,text:"Origin"},
    {id:51,text:"See https://t.me/staniverse/50 #WebXR #\u0438\u0441\u043a\u0443\u0441\u0441\u0442\u0432\u043e"},
  ]});
  assert.deepEqual(posts[1].tags,["webxr","\u0438\u0441\u043a\u0443\u0441\u0441\u0442\u0432\u043e"]);
  assert.equal(posts[1].links[0].url,"https://t.me/staniverse/50");
  assert.deepEqual(posts[1].relations,[{targetId:"publication:telegram:staniverse:50",type:"references",evidence:"telegram-link",confidence:1}]);
});
