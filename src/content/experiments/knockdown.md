---
id: "experiment:knockdown"
kind: experiment
title: "Knockdown"
summary: "Физическая песочница в AR: тап по полу ставит пирамиду из пятнадцати кирпичей, тапом бросаешь в неё шарик и считаешь заваленные."
status: "live"
href: "https://stanleymarch.github.io/ar-experiments/experiments/knockdown/"
repo: "https://github.com/stanleymarch/ar-experiments"
stack: ["8th Wall", "A-Frame", "cannon-es"]
types: ["песочница"]
platforms: ["мобильные"]
capabilities: ["физика"]
complexity: 2
tags: ["ar","webxr","8th-wall","physics"]
entities: []
featured: false
updated: "2026-09-19"
relations: []
---
## Что это
Демо физики в дополненной реальности: на полу реальной комнаты появляется пирамида, а ты сбиваешь её броском. Здесь меня интересовала не игра, а связка «SLAM-поверхность → физический мир → счёт попаданий».

## Как играть
- **Тап по полу** — поставить пирамиду из пятнадцати кирпичей (пять уровней, кирпич около девяти сантиметров).
- **Тап в любую точку** — бросить туда шарик: он летит из точки тапа со скоростью порядка семи метров в секунду.
- **Reset** — поставить пирамиду заново.

## Что внутри
Кирпич считается сбитым, если он сдвинулся больше чем на восемь сантиметров от своего места или наклонился сильнее примерно сорока четырёх градусов — счётчик внизу показывает «Down N / 15». Физика собрана на `cannon-es`: шарик бросают телом в точку тапа, а не «в центр пирамиды», поэтому траектория и подкрутка влияют на результат. Разбор — в `src/physics-world.js`, `src/tower.js` и `src/knockdown.js`.

## Стек
- 8th Wall (SLAM, поверхности)
- A-Frame (сцена и HUD)
- cannon-es (физика)

## Ссылки

- [Открыть демо на телефоне](https://stanleymarch.github.io/ar-experiments/experiments/knockdown/)
- [Код эксперимента](https://github.com/stanleymarch/ar-experiments)
