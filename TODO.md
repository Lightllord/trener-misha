# TODO

## Доставка инсайтов

Сейчас инсайты пушатся через `DeliveryWindow` — окно открыто, когда модель не отвечает И юзер не говорит (turn_done / speech_stopped → open; turn_started / speech_started / audio_interrupted → close).
`DebouncedPoll` подписан на окно: при открытии ждёт 300мс дебаунса (анти-флап на гонку speech_stopped → turn_started), затем дёргает picker и далее раз в 3с пока окно открыто.

## Game events vs новый механизм окна

Игровые события (`gameEventQueue`) и fallback-status сейчас НЕ привязаны к `DeliveryWindow`.
Они ездят по старой схеме: `tryDeliver()` на `turn_done` + `setInterval(5s)` safety tick + `startFallbackTimer(2min)`, гейтятся только через `dw.isResponseActive()` (т.е. учитывают что модель говорит, но НЕ учитывают что юзер говорит).

Подумать:
- может ли быть полезным подвязать их к тому же `DeliveryWindow` (тогда мы не лезем в контекст прямо когда юзер говорит)
- или дать им свой `DebouncedPoll` с другими параметрами (например, для events не нужен 300мс дебаунс, но нужен throttle подлиннее)
- или оставить как есть — они в основном пушаются в контекст без `response.create`, не перебивают речь, всё ок
