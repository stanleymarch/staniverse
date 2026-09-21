---
id: "experiment:reality-field"
kind: experiment
title: "REALITY//FIELD"
summary: "Комната становится физическим полем: жесты выпускают импульсы, волны и частицы, которые цепляются за стол, пол и стены."
status: "live"
href: "https://stanleymarch.github.io/xr-experiments/xrblocks/reality-field/"
repo: "https://github.com/stanleymarch/xr-experiments"
stack: ["Google XR Blocks", "three.js"]
types: ["арт-опыт"]
platforms: ["мобильные", "гарнитуры", "десктоп"]
capabilities: []
tags: ["xr", "webxr", "depth-mesh", "gestures", "particles"]
entities: []
featured: false
date: "2026-09-20"
relations: []
---
## Что это

Комната перестаёт быть фоном и становится интерактивным физическим полем. Взмах руки выпускает импульс: он встречает поверхность, вспыхивает и расходится по ней световой волной. Здесь важен не отдельный объект в AR, а ощущение, что у самой комнаты появилась физика.

## Как взаимодействовать

- **Pinch** копит заряд, **select / клик** выпускает обычный импульс.
- Открытая ладонь отталкивает частицы, кулак притягивает, две руки растягивают поле.
- **DEBUG REALITY** показывает depth-геометрию, fallback-плоскости, руки, лучи и точки столкновений.
- **DREAM REALITY** оставляет те же данные, но превращает сетку в медленные волны, силовые линии и светящиеся частицы.

## Что внутри и где границы

На Quest 3 опыт использует живой depth mesh, если браузер его отдаёт; на телефоне и десктопе есть select и fallback-геометрия. Сейчас mesh определяет место и нормаль удара, а частицы остаются лёгкой CPU-системой с границами комнаты: полноценные столкновения каждой частицы с живой сеткой ещё не реализованы.

Google XR Blocks опирается на WebXR. На iOS, включая Safari, нужные возможности браузера могут отсутствовать, поэтому этот опыт может не запуститься; рабочей целевой платформой остаётся Quest 3, а десктопный simulator нужен для проверки механики.

## Стек

- Google XR Blocks
- three.js
- WebXR depth sensing и hand input, когда браузер их предоставляет

## Ссылки

- [Открыть опыт](https://stanleymarch.github.io/xr-experiments/xrblocks/reality-field/)
- [Код эксперимента](https://github.com/stanleymarch/xr-experiments)