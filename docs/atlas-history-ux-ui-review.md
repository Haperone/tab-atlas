> Generated evidence referenced below was deleted during the 6 October 2026 cleanup at the user's request. Filenames identify historical captures, not current verification. See [output storage and reruns](development-artifacts.md).

# Time machine: полное UX/UI-ревью и полировка

Последующая поправка по пользовательскому скриншоту: [выравнивание native thumb
и playhead](atlas-history-timeline-review.md). Обновлённый pointer runner проверяет
66 позиций (максимальная разница центров 0.625px) и отпускание мыши; общий UI
повторно проходит 32/32 на обоих размерах, startup 4/4. Описанные ниже 48-run,
keyboard, Node 333 и performance относятся к предшествовавшему полному ревью.

6 октября 2026. Область: история **коллекций Atlas**, включая вход, календарную
навигацию, сравнение с текущим Atlas, поиск, выбор ссылок/папок, конфликты,
подтверждение, восстановление, долговечный Undo, настройки хранения и ошибки.
Vanilla JS/CSS, native dialog, IndexedDB; существующие семантические theme tokens.
Основания: `AGENTS.md`, [текущее ТЗ](time-machine-spec.md), project-local
`better-interface` и все шесть профильных `better-*`, `apple-design`,
`chrome-extension-ui`. Минимализм, активные коллекции без архива, две устойчивые
части и тихое полное восстановление в шапке сохранены. Зависимости не добавлены.

Исходники и тестовые данные проверены в изолированном headless Chrome, не в
установленном MV3. Результаты относятся к этому явно ограниченному окружению.

## Покрытие

| Область | Проверенные поверхности и доказательства | Результат |
| --- | --- | --- |
| Accessibility | Native ссылки/checkbox/range/dialog, accessible names через CDP AX, реальные Tab/Space/Enter/Escape и Ctrl/middle click, ошибка второго конфликта, возврат фокуса, media emulation | 4 исправления; native speech/OS high contrast не проверены |
| Layout | Две части и независимая прокрутка, пустые соседние части, раскрытие красных строк, floating dock, конфликты, единая прокрутка подтверждения, 1280×720/640×360/320×400 | 2 исправления |
| Writing | Совпадающие/пустые слепки, пустой поиск, сброс, последствия восстановления, защита Undo, повторный возврат, History storage/Clear | 1 системное исправление |
| Typography | Заголовки/URL/имена, длинные подписи кнопок, переносы, bidi, 12px вторичный текст, bounds | 1 исправление |
| Colors | 16 тем: основной/вторичный текст, red/green comparison, focus/markers, Glass/Soft/solid materials, Soft backdrop, тихая тематическая ось | 1 исправление; существующая палитра сохранена |
| UI | Options/Escape/outside click, состояние pending date lookup, устаревшие ответы, read-only navigation, отмена, restore/Undo, reduced motion | 2 исправления |

## Находки и выполненные изменения

Все перечисленные находки исправлены. Строки указывают на итоговый исходник;
до/после — в `atlas-history-ux-ui-before.json`, `atlas-history-ux-ui-after.json`
и каталогах `time-machine-screenshots/review-before`, `review-after`, `review`.

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Accessibility | `extension/lib/atlas-history-ui.js:54`; `extension/time-machine.css:121` | Keyboard focus разворачивал URL/описание внутри строки. При следующем клике checkbox строка схлопывалась между pointerdown и mouseup, и выбор не срабатывал | Полные детали вынесены в тематический floating tooltip; строки не меняют высоту при смене способа ввода | Видимая цель не должна перемещаться во время нажатия. Реальная последовательность Enter → mouse checkbox воспроизводила отказ |
| MEDIUM | Accessibility | `extension/lib/atlas-history-ui.js:240`; `extension/lib/atlas-history-ui.js:501` | Исторические ссылки были кнопками, без обычных возможностей браузерной ссылки | Валидные HTTP/HTTPS/file представлены native anchors. Обычный click/Enter сохраняет сервисное открытие в текущем окне; Ctrl/Meta/middle используют браузер. Pending controls блокируют и modifier click | Сохраняется ожидаемая семантика и выбор способа открытия без изменения коллекции |
| MEDIUM | Accessibility | `extension/lib/atlas-history-ui.js:313`; `extension/lib/atlas-history-ui.js:338` | Ошибка следующей нерешённой папки возвращала фокус к первому полю, без связи с конкретным control | Ошибка имеет role=alert, aria-invalid/aria-describedby и фокус на реальном незаполненном input/select; исправление выбора очищает устаревшую ошибку | В длинном списке конфликтов пользователь сразу находит требующее решения поле |
| MEDIUM | Accessibility | `extension/lib/atlas-history-timeline.js:58` | Hover-дата использовала output с implicit status/live semantics | Неживой role=tooltip; отдельный status остаётся для завершённых действий | Движение курсора по шкале не должно непрерывно объявлять промежуточные даты |
| MEDIUM | Layout | `extension/lib/atlas-history-ui.js:363`; `extension/lib/atlas-history-ui.js:376` | Restore a copy продолжал показывать неиспользуемую существующую папку/lock hint; отсутствующий parent показывал destination заранее | Destination раскрывается только для применимого способа восстановления, copy не предлагает лишнюю цель | Progressive disclosure уменьшает неоднозначность решения, сохраняя все три режима |
| MEDIUM | Layout | `extension/lib/atlas-history-ui.js:410`; `extension/time-machine.css:139` | Подтверждение было длинным блоком текста с нулевыми счётчиками и несколькими ограничениями прокрутки | Дата, последствия и защита Undo в начале; dl только с ненулевыми изменениями; одна scrollable область и закреплённые действия | Перед подтверждением понятны объём и возможность возврата; кнопки доступны на коротком экране |
| MEDIUM | UI | `extension/lib/atlas-history-ui.js:514` | Клик снаружи оставлял options открытым; Escape из поиска мог закрыть весь Time machine | Outside pointer закрывает только options, Escape сначала закрывает options и возвращает summary focus | Закрытие второстепенной поверхности не теряет выбранный момент |
| MEDIUM | UI | `extension/lib/atlas-history-ui.js:106`; `extension/lib/atlas-history-ui.js:282`; `extension/lib/atlas-history-ui.js:527` | Indexed adjacent lookup не сразу показывал loading; поздняя ошибка старого открытия могла попасть в новую сессию | Немедленный loading/aria-busy, старое содержимое временно недоступно; результаты/ошибки привязаны к session/navigation | Нельзя восстановить старый показанный слепок, ожидая переход к новому; закрытый запрос не портит повторный вход |
| MEDIUM | Writing | `extension/lib/atlas-history-ui.js:154`; `extension/lib/atlas-history-ui.js:198`; `extension/lib/atlas-history-ui.js:463` | Совпадающий слепок не давал следующего шага; Undo last Undo и сброс звучали как другое восстановление | Совпадение предлагает Earlier, no results называет запрос, Return to previous Atlas объясняет повторный возврат, сброс сообщает No changes made и возвращает к выбору; History storage соответствует entry | Термины описывают результат, не внутренний механизм; безопасный сброс не подталкивает к полному restore |
| LOW | Typography | `extension/lib/atlas-history-ui.js:247`; `extension/time-machine.css:120` | URL был 11px; смешанное направление имени/адреса могло переставлять пунктуацию | URL 12px, адрес LTR, название и имя папки изолированы bdi; длинные captions переносятся | Адрес легче читать; Unicode не ломает порядок соседнего текста |
| LOW | Colors | `extension/time-machine.css:162` | Universal black backdrop затемнял Soft окружение, на котором светлая neu-shadow выглядела ярким ореолом | Soft использует нейтральный тон своей темы с alpha .22; Glass и solid сохраняют свои materials | Контекст соответствует тактильной поверхности и направлению её теней |

## Проверки

Для команд с `<playwright-entry>` использован уже установленный runtime
`C:/Users/Олег/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`;
`<chrome>` — `C:/Program Files/Google/Chrome/Application/chrome.exe`. Сервер:
`node tools/serve.mjs 8232`. Зависимости не устанавливались.

- `npm run verify`: **333/333**, лог (`atlas-history-ux-ui-verification.txt`, deleted capture).
- Страница `tools/screenshot-harness.html?time-machine&history-checks&theme=spaceblack`:
  **32/32** на 1280×720 и **32/32** на 320×400; automatic first-run **4/4**.
  Desktop (`atlas-history-current-snapshot-ui.json`, deleted capture), narrow (`atlas-history-current-snapshot-ui-320x400.json`, deleted capture), startup (`atlas-history-current-snapshot-first-run.json`, deleted capture).
  Включены all-folder modes, actual restore/Undo/return, full restore, Cancel,
  exact no-op, read-only comparison, original parent, multiple conflicts,
  all-theme text contrast/materials, поиск и обе позиции прокрутки.
- `node tools/atlas-history-ux-ui-checks.mjs <playwright-entry> <chrome>`:
  **48/48** — 16 тем × 3 viewport. Реальные options/outside/Escape,
  keyboard-to-pointer checkbox, link Enter/Ctrl/middle, Cancel/reset, copy destination,
  no results, storage consequences. Доступные имена у **1840** content controls и
  **96** modal controls в AX tree; увеличенные тестовые подписи не обрезаются.
  Гейт pending indexed step проверяет loading/disabled/default cancellation;
  гейт закрытой сессии проверяет изоляцию поздней ошибки.
  JSON (`atlas-history-ux-ui-browser.json`, deleted capture), все темы/состояния (`time-machine-screenshots/review/index.html`, deleted capture).
  Native modifier pages обслуживаются локальным route, без внешнего запроса.
- `node tools/atlas-history-keyboard-checks.mjs <playwright-entry> <chrome>`:
  **32/32**, JSON (`atlas-history-forced-colors-keyboard.json`, deleted capture). Реальные key events,
  browser-emulated forced colors/reduced motion, focus bounds, возврат фокуса.
- Календарные жесты: `node tools/atlas-history-timeline-checks.mjs <playwright-entry> <chrome>`:
  **6/6** в трёх семействах и двух размерах; native IDB suite **22/22**.
  Жесты (`atlas-history-timeline-ui.json`, deleted capture), native IDB (`atlas-history-timeline-native.json`, deleted capture).
  Это проверка текущего календарного контроллера до финальной UI-полировки;
  latest adjacent navigation дополнительно покрыта 48-run и keyboard suite.
- `tools/atlas-history-ui-performance.html` → Run, без параллельного browser audit:
  **3/3**, 100/1000/10 000 активных ссылок около payload-бюджета 20 MiB.
  Warm useful preview p95 **41.8/64.5/463.2 ms**, после module Worker restart
  **66.5/124.9/692.2 ms**; preview Long Tasks ≥50 ms не наблюдались.
  Native IDB/module Worker, protected restore/Undo и GC ledger;
  JSON (`atlas-history-current-snapshot-performance.json`, deleted capture). Recovery preview содержит
  одну missing ссылку на папку; гигантский полностью раскрытый inbox/all-red folder
  и годы настоящих правок отдельно не измерены.
- `node --check` изменённых modules/runners и `git diff --check`: без ошибок.
- Gallery smoke: загрузка module/import, список 16 тем, смена surface/theme и
  narrow preview 320px проходят; исходные PNG доступны по ссылке.

**Не проверено:** установленный MV3/service worker и browser restart,
toolbar/ПКМ transport, реальная file-access permission, offscreen/content audio,
screen-reader speech, OS forced colors, настоящий 200% browser zoom и физический
размер IDB. [Общая приёмка](atlas-history-acceptance.md) сохраняет эти границы.
Никакие пользовательские коллекции в этом проходе не восстанавливались/очищались.

## Вердикт

**Approve — для проверенных исходников, локальных UI/IDB/Worker fixtures и
указанного покрытия всех шести областей.** Открытых HIGH/MEDIUM/LOW из этой таблицы
нет. Это не утверждение завершённой native MV3-приёмки или готовности релиза.
Версия, permissions и release archive не менялись; коммита/push нет.

