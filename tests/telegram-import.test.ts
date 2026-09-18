import test from "node:test";
import assert from "node:assert/strict";
import { buildPublications } from "../pipeline/telegram/threading";
import { normalizeExport, renderText } from "../pipeline/telegram/normalize";
import { publicationDisplay } from "../pipeline/telegram/display";
import { mergeMessages } from "../pipeline/telegram/incremental";
import { enrichLocally } from "../pipeline/enrichment/catalog";
import { mergeEnrichment } from "../pipeline/enrichment/merge";
import { renderEntity } from "../pipeline/telegram/normalize";
import { inlineTelegramMedia } from "../pipeline/telegram/inline-media";
test("bold spanning a paragraph break closes inside each paragraph instead of leaking asterisks", () => {
  const render = renderText({ id: 1, date: "2024-06-27T21:08:43", date_unixtime: "1",
    text_entities: [
      { type: "plain", text: "" },
      { type: "bold", text: "Google релизнули Gemma 2\n\n" },
      { type: "bold", text: "Можно скачать веса" },
      { type: "plain", text: "\n\nДальше текст." },
    ] });
  // The closing marker must never land in the next paragraph: each paragraph's
  // asterisk count stays even, so nothing renders as literal **.
  assert.equal((render.match(/\*\*/g) ?? []).length % 2, 0);
  render.split(/\n{2,}/).forEach((paragraph) => {
    assert.equal((paragraph.match(/\*\*/g) ?? []).length % 2, 0, paragraph);
  });
  assert.match(render, /\*\*Google релизнули Gemma 2\*\*/);
  assert.match(render, /\*\*Можно скачать веса\*\*/);
  // Italic gets the same guarantee, and emphasis whitespace stays outside the markers.
  const italic = renderEntity({ type: "italic", text: "  важно  " });
  assert.equal(italic, "  _важно_  ");
});

test("a post opening with a continuation phrase merges into the previous publication", () => {
  const posts = normalizeExport({messages:[
    {id:270,date:"2026-01-10T10:00:00",date_unixtime:"10",text:"Моё увлечение аудиотехникой началось давно"},
    {id:271,date:"2026-01-10T11:00:00",date_unixtime:"11",text:"продолжение поста\n\nВыбрал Premiera Eco BT"},
  ]});
  assert.equal(posts.length,1);
  assert.equal(posts[0].sourceId,"270");
  assert.deepEqual(posts[0].threadIds,["270","271"]);
  assert.match(posts[0].body,/увлечение аудиотехникой/);
  assert.match(posts[0].body,/Premiera Eco BT/);
});

test("начало-here chains merge transitively into the first post", () => {
  const posts = normalizeExport({messages:[
    {id:992,date:"2026-02-01T09:00:00",date_unixtime:"1",text:"Разбор года: часть первая"},
    {id:993,date:"2026-02-01T10:00:00",date_unixtime:"2",text:"начало здесь\n2. Виртуальная и дополненная реальность"},
    {id:994,date:"2026-02-01T11:00:00",date_unixtime:"3",text:"начало здесь\nА теперь самое вкусное"},
  ]});
  assert.equal(posts.length,1);
  assert.equal(posts[0].sourceId,"992");
  assert.deepEqual(posts[0].threadIds,["992","993","994"]);
});

test("a temporal «начало июня» is not a continuation and stays its own post", () => {
  const posts = normalizeExport({messages:[
    {id:99,date:"2026-06-01T09:00:00",date_unixtime:"1",text:"Предыдущая мысль"},
    {id:101,date:"2026-06-02T09:00:00",date_unixtime:"2",text:"Ух, гайз, начало июня выдалось просто мега загруженным"},
  ]});
  assert.equal(posts.length,2);
});

test("an explicit numbered continuation keeps two pages and a continues relation", () => {
  const posts = normalizeExport({messages:[
    {id:5,date:"2026-03-01T09:00:00",date_unixtime:"1",text:"Первая часть мысли"},
    {id:8,date:"2026-03-02T09:00:00",date_unixtime:"2",text:"продолжение поста №5\n\nВторая часть мысли"},
  ]});
  assert.equal(posts.length,2);
  assert.equal(posts[1].relations.find((relation)=>relation.type==="continues")?.targetId,"publication:telegram:staniverse:5");
});
test("collects one album from consecutive media messages that share a timestamp", () => {
  const posts = normalizeExport({messages:[
    {id:100,date:"2026-04-24T20:00:00",date_unixtime:"1",photo:"photos/a.jpg",text:"Подпись"},
    {id:101,date:"2026-04-24T20:00:00",date_unixtime:"1",photo:"photos/b.jpg",text:""},
    {id:102,date:"2026-04-24T20:00:00",date_unixtime:"1",photo:"photos/c.jpg",text:""},
  ]});
  assert.deepEqual(posts.map((post)=>post.sourceId),["100"]);
  assert.equal(posts[0].sourceUrl,"https://t.me/staniverse/100");
  assert.deepEqual(posts[0].threadIds,["100","101","102"]);
  assert.deepEqual(posts[0].media.map((item)=>[item.messageId,item.sourcePath,item.order]),[[100,"photos/a.jpg",0],[101,"photos/b.jpg",1],[102,"photos/c.jpg",2]]);
  assert.equal(posts[0].body,"Подпись");
});

test("anchors an album on the message that carries its caption", () => {
  const [album]=normalizeExport({messages:[
    {id:110,date:"2024-04-12T12:00:00",date_unixtime:"2",photo:"photos/a.jpg",text:""},
    {id:111,date:"2024-04-12T12:00:00",date_unixtime:"2",photo:"photos/b.jpg",text:"Подпись"},
  ]});
  assert.equal(album.sourceId,"111");
  assert.deepEqual(album.threadIds,["110","111"]);
  assert.deepEqual(album.media.map((item)=>item.order),[0,1]);
});

test("collapses an album whose files the export did not download", () => {
  const posts=normalizeExport({messages:[
    {id:120,date:"2024-04-12T12:00:00",date_unixtime:"3",file:"(File not included. Change data exporting settings to download.)",text:""},
    {id:121,date:"2024-04-12T12:00:00",date_unixtime:"3",file:"(File not included. Change data exporting settings to download.)",text:""},
    {id:122,date:"2024-04-12T12:00:00",date_unixtime:"3",file:"(File not included. Change data exporting settings to download.)",text:"Стихи"},
  ]});
  assert.deepEqual(posts.map((post)=>post.sourceId),["122"]);
  assert.deepEqual(posts[0].media,[]);
  assert.equal(posts[0].body,"Стихи");
});

test("never merges posts that share a second but carry their own text", () => {
  const posts=normalizeExport({messages:[
    {id:130,date:"2026-03-05T18:19:38",date_unixtime:"4",photo:"photos/a.jpg",text:"Первый"},
    {id:131,date:"2026-03-05T18:19:38",date_unixtime:"4",photo:"photos/b.jpg",text:"Второй"},
  ]});
  assert.deepEqual(posts.map((post)=>post.sourceId),["130","131"]);
});

test("keeps a message without stored media out of an album", () => {
  const posts=normalizeExport({messages:[
    {id:140,date:"2025-03-13T19:16:23",date_unixtime:"5",text:"Про «мой типаж»"},
    {id:141,date:"2025-03-13T19:16:23",date_unixtime:"5",file:"(File not included. Change data exporting settings to download.)",text:""},
  ]});
  assert.deepEqual(posts.map((post)=>post.sourceId),["140","141"]);
});

test("collects explicit grouped albums and leaves a lone photo of another time alone", () => {
  const groups = buildPublications([{id:20,grouped_id:"a",photo:"1.jpg"},{id:21,grouped_id:"a",photo:"2.jpg"},{id:22,date:"2026-01-01T12:00",photo:"3.jpg"}]);
  assert.deepEqual(groups.map((group)=>group.messages.map((message)=>message.id)), [[20,21],[22]]);
});

test("anchors an explicit grouped album on its caption message", () => {
  const [album] = normalizeExport({messages:[
    {id:23,grouped_id:"b",photo:"1.jpg",text:""},
    {id:24,grouped_id:"b",photo:"2.jpg",text:"Авторская подпись"},
  ]});
  assert.equal(album.sourceId,"24");
  assert.deepEqual(album.threadIds,["23","24"]);
});

test("keeps replies as their own publications with a typed reply relation", () => {
  const posts = normalizeExport({messages:[{id:10,text:"Начало"},{id:11,reply_to_message_id:10,text:"Ответ"},{id:12,text:"Другой пост"}]});
  assert.deepEqual(posts.map((post)=>post.sourceId),["10","11","12"]);
  assert.deepEqual(posts[0].relations,[]);
  assert.deepEqual(posts[1].relations,[{targetId:"publication:telegram:staniverse:10",type:"reply-to",evidence:"telegram-reply",confidence:1}]);
  assert.deepEqual(posts[2].relations,[]);
});

test("keeps a linked continuation as its own publication with a continuation relation", () => {
  const posts = normalizeExport({messages:[{id:30,text:"Первая часть"},{id:31,text:"Продолжение https://t.me/staniverse/30"}]});
  assert.deepEqual(posts.map((post)=>post.sourceId),["30","31"]);
  assert.deepEqual(posts[1].relations,[{targetId:"publication:telegram:staniverse:30",type:"continues",evidence:"continuation",confidence:1}]);
});

test("records an ordinary Telegram hyperlink as a reference, not a continuation", () => {
  const posts = normalizeExport({messages:[{id:32,text:"source"},{id:33,text:"Useful reference https://t.me/staniverse/32"}]});
  assert.deepEqual(posts.map((post)=>post.sourceId),["32","33"]);
  assert.deepEqual(posts[1].relations,[{targetId:"publication:telegram:staniverse:32",type:"references",evidence:"telegram-link",confidence:1}]);
});

test("never relates merely adjacent posts", () => {
  const posts = normalizeExport({messages:[{id:34,text:"Первый"},{id:35,text:"Второй"},{id:36,reply_to_message_id:34,text:"Третий"}]});
  assert.deepEqual(posts[0].relations,[]);
  assert.deepEqual(posts[1].relations,[]);
  assert.deepEqual(posts[2].relations,[{targetId:"publication:telegram:staniverse:34",type:"reply-to",evidence:"telegram-reply",confidence:1}]);
});

test("does not join a continuation link from another Telegram channel", () => {
  const posts = normalizeExport({messages:[
    {id:37,text:"Первая часть"},
    {id:38,text:"Продолжение https://t.me/otherchannel/37"},
  ]});
  assert.deepEqual(posts.map((post)=>post.sourceId),["37","38"]);
  assert.deepEqual(posts[1].relations,[]);
});

test("deduplicates messages by Telegram ID", () => {
  const groups = buildPublications([{id:1,text:"old"},{id:1,text:"new"}]);
  assert.equal(groups.length,1); assert.equal(groups[0].messages[0].text,"new");
});

test("records a Russian continuation marker with a post number without merging", () => {
  const posts = normalizeExport({messages:[{id:40,text:"root"},{id:41,text:"\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0435\u043d\u0438\u0435 \u043f\u043e\u0441\u0442\u0430 \u211640"}]});
  assert.deepEqual(posts.map((post)=>post.sourceId),["40","41"]);
  assert.deepEqual(posts[1].relations,[{targetId:"publication:telegram:staniverse:40",type:"continues",evidence:"continuation",confidence:1}]);
});

test("an album inherits the reply evidence of the messages it absorbed", () => {
  const posts = normalizeExport({messages:[
    {id:200,text:"Основа"},
    {id:201,date:"2026-06-20T22:00:00",date_unixtime:"9",photo:"photos/a.jpg",text:"Вечеринка",reply_to_message_id:200},
    {id:202,date:"2026-06-20T22:00:00",date_unixtime:"9",photo:"photos/b.jpg",text:"",reply_to_message_id:200},
  ]});
  assert.deepEqual(posts.map((post)=>post.sourceId),["200","201"]);
  assert.deepEqual(posts[1].threadIds,["201","202"]);
  assert.deepEqual(posts[1].relations,[{targetId:"publication:telegram:staniverse:200",type:"reply-to",evidence:"telegram-reply",confidence:1}]);
});

test("renders Telegram entities as standard Markdown", () => {
  const text = renderText({id:1,text_entities:[{type:"plain",text:"Смотри "},{type:"bold",text:"важное"},{type:"plain",text:" и "},{type:"text_link",text:"источник",href:"https://example.com"}]});
  assert.equal(text,"Смотри **важное** и [источник](https://example.com)");
});

test("normalizes every message without changing authorial text", () => {
  const [first,second] = normalizeExport({messages:[{id:7,date:"2026-01-01",text:"Первая мысль"},{id:8,reply_to_message_id:7,text:"Вторая мысль",photo:"photo.jpg"}]});
  assert.equal(first.id,"publication:telegram:staniverse:7");
  assert.equal(first.body,"Первая мысль");
  assert.deepEqual(first.threadIds,["7"]);
  assert.equal(second.body,"Вторая мысль");
  assert.deepEqual(second.threadIds,["8"]);
  assert.equal(second.media[0].messageId,8);
});

test("shows a leading source heading once, as the title", () => {
  const [post]=normalizeExport({messages:[{id:60,date:"2024-12-01T20:34:51",photo:"photos/photo.jpg",text_entities:[
    {type:"bold",text:"На этом групповом фото довольно историческая фигня"},
    {type:"plain",text:"\n\nВ общем, тут группа слушателей курса Digital Autumn.\n\n"},
    {type:"italic",text:"Фото: Михаил"},
  ]}]});
  const display=publicationDisplay(post);
  assert.equal(display.title,"На этом групповом фото довольно историческая фигня");
  assert.match(display.body,/^В общем, тут группа слушателей курса Digital Autumn\./);
  assert.equal(display.body.includes(display.title),false);
  assert.equal(display.summary.startsWith(display.title),false);
  assert.equal(display.summary.includes("Фото: Михаил"),true);
});

test("keeps a Telegram Article heading as the title only", () => {
  const [article]=normalizeExport({messages:[{id:61,date:"2026-08-15",rich_message:{blocks:[
    {type:"heading",level:1,text:{type:"plain",text:"Приключение на час"}},
    {type:"paragraph",text:"Открыть Nearventure"},
  ]}}]});
  const display=publicationDisplay(article);
  assert.equal(display.title,"Приключение на час");
  assert.equal(display.body,"Открыть Nearventure");
  assert.equal(display.summary,"Открыть Nearventure");
});

test("drops a leading paragraph only when the page already shows it as the title", () => {
  const [post]=normalizeExport({messages:[{id:62,date:"2023-09-28T21:30:00",text:"Смотрю 2-й день Meta Connect.\n\nМеня удивляет низкий онлайн."}]});
  const display=publicationDisplay(post);
  assert.equal(display.title,"Смотрю 2-й день Meta Connect");
  assert.equal(display.body,"Меня удивляет низкий онлайн.");
  assert.equal(display.summary,"Меня удивляет низкий онлайн.");
});

test("keeps a one-paragraph post in the body", () => {
  const [post]=normalizeExport({messages:[{id:63,date:"2026-01-01",text:"Короткая заметка про VRchat."}]});
  const display=publicationDisplay(post);
  assert.equal(display.title,"Короткая заметка про VRchat");
  assert.equal(display.body,"Короткая заметка про VRchat.");
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

test("does not turn a foreign Telegram post id into a local relation", () => {
  const posts = normalizeExport({messages:[
    {id:50,text:"Local post"},
    {id:51,text:"See https://t.me/otherchannel/50"},
  ]});
  assert.equal(posts[1].links[0].url,"https://t.me/otherchannel/50");
  assert.deepEqual(posts[1].relations,[]);
});

test("matches Telegram links against the configured channel handle", () => {
  const posts = normalizeExport({messages:[
    {id:60,text:"Origin"},
    {id:61,text:"See https://t.me/custom_channel/60"},
  ]},"custom_channel");
  assert.deepEqual(posts[1].relations,[{targetId:"publication:telegram:custom_channel:60",type:"references",evidence:"telegram-link",confidence:1}]);
});

test("renders Telegram rich messages as articles with links and gallery media",()=>{
  const [article]=normalizeExport({messages:[{id:1115,date:"2026-08-15",rich_message:{blocks:[
    {type:"heading",level:1,text:{type:"plain",text:"Приключение на час"}},
    {type:"paragraph",text:{type:"concat",text:[{type:"plain",text:"Открыть "},{type:"text_link",href:"https://nearventure.ru/",text:{type:"plain",text:"Nearventure"}}]}},
    {type:"slideshow",items:[{type:"photo",photo:"photos/one.jpg"},{type:"photo",photo:"photos/two.jpg"}]},
  ]}}]});
  assert.equal(article.kind,"telegram-article");assert.match(article.body,/^# Приключение на час/);assert.match(article.body,/\[Nearventure\]\(https:\/\/nearventure.ru\/\)/);assert.equal(article.media.length,2);assert.equal(article.links[0].url,"https://nearventure.ru/");
  assert.deepEqual(article.relations,[{targetId:"project:nearventure",type:"references",evidence:"known-public-url",confidence:1}]);
});

test("preserves the position of photos inside Telegram Articles",()=>{
  const [article]=normalizeExport({messages:[{id:12,date:"2026-08-23",rich_message:{blocks:[
    {type:"paragraph",text:"До фотографии"},
    {type:"photo",photo:"photos/inside.jpg",caption:{type:"plain",text:"Подпись"}},
    {type:"paragraph",text:"После фотографии"},
  ]}}]});
  assert.match(article.body,/До фотографии[\s\S]*telegram-media:photos%2Finside\.jpg[\s\S]*Подпись[\s\S]*После фотографии/);
});

test("groups consecutive Telegram Article images into an inline carousel", () => {
  const [article] = normalizeExport({ messages: [{ id: 13, date: "2026-08-23", rich_message: { blocks: [
    { type: "heading", level: 1, text: "Галерея" },
    { type: "slideshow", items: [{ type: "photo", photo: "photos/one.jpg" }, { type: "photo", photo: "photos/two.jpg" }] },
    { type: "paragraph", text: "Текст после галереи" },
  ] } }] });
  article.media.forEach((item, index) => { item.publicPath = `/media/telegram/13-13-${index}.webp`; });
  const materialized = inlineTelegramMedia(article.body, article);
  assert.match(materialized, /class="media-carousel telegram-article-carousel"/);
  assert.equal((materialized.match(/data-carousel-slide/g) ?? []).length, 2);
  assert.ok(materialized.indexOf("data-media-carousel") < materialized.indexOf("Текст после галереи"));
});

test("incremental merge adds new messages and replaces edited ones by stable id",()=>{
  const result=mergeMessages([{id:1,text:"original"},{id:2,text:"same"}],[{id:2,text:"same"},{id:1,text:"edited",edited:"now"},{id:3,text:"new"}]);
  assert.deepEqual({added:result.added,updated:result.updated,unchanged:result.unchanged},{added:1,updated:1,unchanged:1});assert.deepEqual(result.messages.map((item)=>[item.id,item.text]),[[1,"edited"],[2,"same"],[3,"new"]]);
});

test("local enrichment classifies topics and exact project mentions without rewriting source",()=>{
  const publication = normalizeExport({messages:[{id:90,text:"Собираю Nearventure на Astro: маршруты, город и WebXR."}]})[0];
  const original = publication.body;
  const result = enrichLocally(publication,new Set(["project:nearventure"]));
  assert.equal(publication.body,original);
  assert.ok(result.topics.includes("xr"));
  assert.ok(result.topics.includes("веб-разработка"));
  assert.ok(result.entities.includes("Nearventure"));
  assert.equal(result.relations[0].targetId,"project:nearventure");
  const merged=mergeEnrichment(publication,result);
  assert.equal(merged.tags.includes("xr"),false);
  assert.ok(merged.topics.includes("xr"));
  assert.deepEqual(merged.entities,["Nearventure"]);
});

test("materialized local relations are replaced without changing provenance or multiplying edges",()=>{
  const publication=normalizeExport({messages:[{id:96,text:"Nearventure"}]})[0];
  const result=enrichLocally(publication,new Set(["project:nearventure"]));
  const first=mergeEnrichment(publication,result);
  assert.equal(first.relations.length,1);
  const roundTripped={
    ...publication,
    relations:first.relations.map((relation)=>({
      targetId:relation.target,
      type:relation.type,
      evidence:relation.evidence,
      confidence:relation.confidence,
      explanation:relation.explanation,
      reviewStatus:relation.reviewStatus,
      provenance:relation.provenance,
    })),
  };
  const second=mergeEnrichment(roundTripped,result);
  assert.deepEqual(second.relations,first.relations);
});

test("materialized Telegram source links cannot create project mentions",()=>{
  const publication=normalizeExport({messages:[{id:97,text:"Обычный текст без названия проекта."}]})[0];
  publication.body+="\n\n[Оригинал в Telegram](https://t.me/staniverse/97)";
  const result=enrichLocally(publication,new Set(["project:staniverse"]));
  assert.equal(result.entities.includes("Staniverse"),false);
  assert.equal(result.relations.some((relation)=>relation.targetId==="project:staniverse"),false);
});

test("stale enrichment is ignored when Telegram source text changes",()=>{
  const publication = normalizeExport({messages:[{id:91,text:"Nearventure"}]})[0];
  const result = enrichLocally(publication,new Set(["project:nearventure"]));
  publication.body="Отредактированный текст";
  const merged=mergeEnrichment(publication,result);
  assert.deepEqual(merged.tags,publication.tags);
  assert.deepEqual(merged.entities,[]);
  assert.deepEqual(merged.relations,[]);
});

test("non-local topics land unless rejected while relations stay proposal-gated",()=>{
  const publication=normalizeExport({messages:[{id:92,text:"Nearventure и XR"}]})[0];
  const result=enrichLocally(publication,new Set(["project:nearventure"]));
  result.topics=["xr"];
  result.provider="openrouter";result.model="cheap-model";result.needsReview=true;
  const pending=mergeEnrichment(publication,result);
  const proposedTopic=result.topics[0];
  const proposedRelation=result.relations[0];
  assert.ok(proposedTopic);assert.ok(proposedRelation);
  assert.equal(pending.tags.includes(proposedTopic),false);
  assert.equal(pending.topics.includes(proposedTopic),true);
  assert.equal(pending.relations.length,0);
  const reviewed=mergeEnrichment(publication,result,[
    {key:`${result.id}::relation::${proposedRelation.targetId}|${proposedRelation.type}`,status:"accepted",reviewedAt:"2026-08-23"},
  ]);
  assert.equal(reviewed.tags.includes(proposedTopic),false);
  assert.equal(reviewed.topics.includes(proposedTopic),true);
  assert.equal(reviewed.relations[0]?.target,"project:nearventure");
  const banned=mergeEnrichment(publication,result,[
    {key:`${result.id}::topic::${proposedTopic}`,status:"rejected",reviewedAt:"2026-08-24"},
  ]);
  assert.equal(banned.topics.includes(proposedTopic),false);
});

test("rejected local proposal stays hidden after deterministic enrichment",()=>{
  const publication=normalizeExport({messages:[{id:95,text:"Nearventure и WebXR"}]})[0];
  const result=enrichLocally(publication,new Set(["project:nearventure"]));
  const relation=result.relations[0];
  assert.ok(relation);
  const merged=mergeEnrichment(publication,result,[
    {key:`${result.id}::topic::xr`,status:"rejected",reviewedAt:"2026-09-07"},
    {key:`${result.id}::relation::${relation.targetId}|${relation.type}`,status:"rejected",reviewedAt:"2026-09-07"},
  ]);
  assert.equal(merged.topics.includes("xr"),false);
  assert.equal(merged.relations.some((edge)=>edge.target===relation.targetId),false);
});

test("local enrichment keeps precise IoT, open-source and intimacy topics without broad false positives",()=>{
  const [signal]=normalizeExport({messages:[{id:93,text:"IoT на ESP32 и Zigbee, исходники опубликованы как open source. ИИ-компаньон работает локально."}]});
  const topics=enrichLocally(signal).topics;
  assert.ok(topics.includes("iot"));
  assert.ok(topics.includes("open source"));
  assert.ok(topics.includes("ai-компаньоны"));
  const [intimacy]=normalizeExport({messages:[{id:931,text:"В VRChat говорят о близости, одиночестве и отношениях с ИИ-компаньонами."}]});
  const intimacyTopics=enrichLocally(intimacy).topics;
  assert.ok(intimacyTopics.includes("интим и близость"));
  assert.ok(intimacyTopics.includes("ai-компаньоны"));
  const [vtuber]=normalizeExport({messages:[{id:932,text:"Paper про AI VTubers и виртуальные эфиры."}]});
  assert.ok(enrichLocally(vtuber).topics.includes("втюбинг и виртуальные персонажи"));
  const [platform]=normalizeExport({messages:[{id:933,text:"У меня странные отношения с платформой: кнопки снова не работают."}]});
  assert.equal(enrichLocally(platform).topics.includes("интим и близость"),false);
  const [spatial]=normalizeExport({messages:[{id:95,text:"Собрал 3D Gaussian Splats старой церкви и открыл сцену в WebXR."}]});
  assert.ok(enrichLocally(spatial).topics.includes("Gaussian Splatting"));
  const [noise]=normalizeExport({messages:[{id:94,text:"Во время экскурсии увидел сайт Белого дома в интернете и результаты голосования."}]});
  const noiseTopics=enrichLocally(noise).topics;
  assert.equal(noiseTopics.includes("образование"),false);
  assert.equal(noiseTopics.includes("веб-разработка"),false);
  assert.equal(noiseTopics.includes("цифровая культура"),false);
  assert.equal(noiseTopics.includes("музыка и звук"),false);
});

test("grounds VRChat in the posts that actually name it",()=>{
  const [album]=normalizeExport({messages:[
    {id:326,date:"2024-12-01T20:34:51",date_unixtime:"1733074491",photo:"photos/photo_190.jpg",text_entities:[
      {type:"bold",text:"На этом групповом фото довольно историческая фигня, но объяснить будет сложно"},
      {type:"plain",text:"\n\nВ общем, тут группа потенциально отобранных когда-нибудь на программу иммерсивного Биеннале создателей миров, но пока ещё слушателей курса в рамках Digital Autumn, вместе с двумя глыбами платформы VRchat Niko и ShuShu, которые оба в Selected Best of World этого года представлены.\n\n"},
      {type:"italic",text:"Фото: Михаил из Less Media"},
    ]},
    {id:327,date:"2024-12-01T20:34:51",date_unixtime:"1733074491",photo:"photos/photo_191.jpg",text:""},
  ]});
  const result=enrichLocally(album);
  assert.ok(result.topics.includes("xr"));
  assert.ok(result.entities.includes("VRChat"));
  const [quietPost]=normalizeExport({messages:[{id:95,text:"Собрал 3D Gaussian Splats старой церкви."}]});
  assert.equal(enrichLocally(quietPost).entities.includes("VRChat"),false);
});
