---
id: "experiment:city-orbit"
kind: experiment
title: "CITY//ORBIT"
summary: "Улица из OpenStreetMap сжимается в голограмму: выбирай места лучом, поднимай карточки и меняй радиус города жестом."
status: "live"
href: "https://stanleymarch.github.io/xr-experiments/xrblocks/city-orbit/"
repo: "https://github.com/stanleymarch/xr-experiments"
stack: ["Google XR Blocks", "three.js", "OpenStreetMap", "Overpass API"]
types: ["арт-опыт"]
platforms: ["мобильные", "гарнитуры", "десктоп"]
capabilities: []
tags: ["xr", "webxr", "openstreetmap", "overpass", "geolocation"]
entities: []
featured: false
date: "2026-09-20"
relations: []
---
## Что это

Настоящий город уменьшается до голограммы между руками. Именованные места из OpenStreetMap становятся абстрактными световыми телами вокруг точки «ты»: их можно положить на стол как макет или раскрыть вокруг себя на 360° — без готовых 3D-моделей.

## Как взаимодействовать

- **СТОЛ** ставит 1,2-метровую орбитальную схему перед пользователем; **360°** окружает ею пользователя.
- **Select / pinch / клик** выбирает POI и поднимает его карточку.
- Две руки в pinch и разведение переключают радиус: **200 м → 1 км → 5 км**.
- На телефоне и десктопе остаются HTML-кнопки и координаты как fallback.

## Данные и границы

Клиент делает ограниченные Overpass-запросы к нескольким публичным инстансам для именованных мест. Ответ кэшируется в сессии, перегруженные узлы получают cooldown. Если серверы недоступны, появляется явно подписанный демонстрационный квартал у Эрмитажа — не под видом живых данных. Данные OpenStreetMap: © OpenStreetMap contributors, ODbL.

Google XR Blocks опирается на WebXR. На iOS, включая Safari, нужные возможности браузера могут отсутствовать, поэтому этот опыт может не запуститься; рабочей целевой платформой остаётся Quest 3, а десктопный simulator нужен для проверки механики.

## Стек

- Google XR Blocks
- three.js
- OpenStreetMap и Overpass API

## Ссылки

- [Открыть опыт](https://stanleymarch.github.io/xr-experiments/xrblocks/city-orbit/)
- [Код эксперимента](https://github.com/stanleymarch/xr-experiments)