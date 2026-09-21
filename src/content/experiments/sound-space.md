---
id: "experiment:sound-space"
kind: experiment
title: "SOUND//SPACE"
summary: "Звук становится пространством: микрофон строит световую структуру, а pinch замораживает фразу, музыку или хлопок в 3D-скульптуру."
status: "live"
href: "https://stanleymarch.github.io/xr-experiments/xrblocks/sound-space/"
repo: "https://github.com/stanleymarch/xr-experiments"
stack: ["Google XR Blocks", "three.js", "Web Audio API"]
types: ["арт-опыт"]
platforms: ["мобильные", "гарнитуры", "десктоп"]
capabilities: ["звук"]
tags: ["xr", "webxr", "web-audio", "fft", "microphone"]
entities: []
featured: false
date: "2026-09-20"
relations: []
---
## Что это

Звук перестаёт исчезать и становится пространством. После разрешения на микрофон live FFT рисует светящуюся ленту: речь выглядит нервным рельефом, музыка — спектральной тканью, хлопок — коротким ударом с расходящимся кольцом. Выбранный момент остаётся отдельной 3D-скульптурой, из которых собирается история последних минут.

## Как взаимодействовать

- **MIC** запрашивает микрофон.
- **Tap / click / pinch / FREEZE** сохраняет текущий звуковой момент.
- **Drag** поворачивает или перемещает выбранную скульптуру; **hold / squeeze** удаляет её.
- **Стереть** убирает всю историю.

## Данные и границы

Микрофонный поток остаётся внутри Web Audio API: он не записывается и не отправляется на сервер. Это FFT-эвристика, а не распознавание речи или AI. Если микрофон недоступен, демонстрационный генератор показывает речь, музыку и хлопок; он не выдаёт себя за входящий звук.

Google XR Blocks опирается на WebXR. На iOS, включая Safari, нужные возможности браузера могут отсутствовать, поэтому этот опыт может не запуститься; рабочей целевой платформой остаётся Quest 3, а десктопный simulator нужен для проверки механики.

## Стек

- Google XR Blocks
- three.js
- Web Audio API и `AnalyserNode`

## Ссылки

- [Открыть опыт](https://stanleymarch.github.io/xr-experiments/xrblocks/sound-space/)
- [Код эксперимента](https://github.com/stanleymarch/xr-experiments)