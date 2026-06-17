# TODO

## Доставка инсайтов

Инсайты доставляются одним lane через `DeliveryWindow`. Окно открыто, **пока не говорит юзер** (`isOpen()`); внутри `state()` отдаёт конкретную полосу: `full` (модель тоже молчит — доставляем любой инсайт в паузу), `interrupt` (модель отвечает — берём только `critical` и перебиваем через `response.cancel` в `injectMessage`), `closed` (юзер говорит — ничего).
`DebouncedPoll` подписан на окно: 150мс дебаунс (анти-флап на быстрый re-speak), затем поллинг раз в 200мс пока окно открыто; поллинг продолжается и сквозь ход модели, гасится только речью юзера.
Набор «перебивающих» = ровно `importance: "critical"` (отдельного флага `interrupts` больше нет; второй таймер и `interruptAndDeliver` тоже удалены).

## Game events / tryDeliver — доп-шина

Игровые события (`gameEventQueue`) и fallback-status НЕ привязаны к `DeliveryWindow`. Они ездят по старой схеме: `tryDeliver()` на `turn_done` + `setInterval(5s)` safety tick + `startFallbackTimer(2min)`, гейтятся только через `deliveryWindow.isResponseActive()` (учитывают, что модель говорит, но НЕ что юзер говорит). Пока оставляем как доп-шину.

Подозреваем, что **fallback-status надо выпилить**: `takeFallbackStatus()` — единственная ветка с `triggerResponse: false` (молча пушит снапшот состояния матча раз в 2 мин). Это, похоже, дублирует то, что модель и так может достать тулзой `get_match_state`, и засоряет контекст. Проверить, нужен ли он вообще; если нет — убрать `takeFallbackStatus` + `startFallbackTimer`, тогда `tryDeliver` останется чисто про игровые события (всегда `triggerResponse: true`).

Подумать также:
- подвязать игровые события к тому же `DeliveryWindow` (чтобы не лезть в контекст прямо когда юзер говорит), либо дать им свой `DebouncedPoll` с более длинным throttle.
