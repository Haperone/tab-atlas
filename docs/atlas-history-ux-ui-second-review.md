> Generated evidence referenced below was deleted during the 6 October 2026 cleanup at the user's request. Filenames identify historical captures, not current verification. See [output storage and reruns](development-artifacts.md).

# Time machine: повторное UX/UI-ревью и полировка

6 октября 2026. Область — весь Time machine: вход и пустой/совпадающий слепок,
навигация, сравнение с текущим Atlas, поиск, выбор, восстановление папки/ссылок,
конфликты, подтверждение, Undo, настройки, загрузка, ошибки и предупреждение
о заполнении. Vanilla JS/CSS, native dialog и IndexedDB; существующие
семантические токены 16 тем. Проверены AGENTS.md и проектные better-interface,
better-accessibility, better-layout, better-writing, better-typography,
better-colors и better-ui. Область не ограничивалась Git diff.

Это ревью локальной сборки в изолированном браузере. Оно не заменяет приёмку
установленного расширения в реальном профиле Chrome.

## Покрытие

| Домен | Проверенные свидетельства | Результат |
| --- | --- | --- |
| Accessibility | UI/modal/timeline source; настоящие pointer/key events; AX names; focus/Cancel/reset; browser-emulated forced colors и reduced motion | Исправлена область нажатия checkbox; короткие окна больше не скрывают список |
| Layout | 16 тем × 5 размеров; раскрытая справка; critical warning + dock; длинные подписи и RTL на двух размерах; скриншоты | Исправлены схлопывание списков, тесная мобильная шапка и лишняя строка над шкалой |
| Writing | Все действия, варианты конфликтов, review, Undo/return, ошибки, empty/search, storage consequences сопоставлены с обработчиками | Подтверждение называет выбранные ссылки; итоговое примечание не обещает неправильную папку для copy/destination |
| Typography | Даты, адреса, названия, переносы, heading scale, bidi; новые h4/list входят в проверки контраста | Дата dock на узком экране поднята с 11 до 12 px |
| Colors | Существующие theme/status tokens; computed foreground/background composition в 16 темах; скриншоты Space Black, Pearl Glass, Paper Soft | Палитры сохранены; выбор получает существующий accent, красный/зелёный статус остаётся |
| UI | Hover/focus/selection/disabled/loading/empty; card/dock/dialog surfaces; новые pointer targets и видимый выбор | Выбранные строки и папки различимы без дополнительной постоянной подписи |

## Исправленные находки

Все строки ниже имеют статус **Fixed**.

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Layout | `extension/time-machine.css:232`, `extension/time-machine.css:238` | При 1024×500 высота `.tm-columns` была 0 px: верхние элементы занимали всю область с overflow:hidden. Warning/dock усугубляли это | В коротких широких окнах содержимое прокручивается целиком; при warning тот же режим действует до 800 px высоты. На обычном desktop независимые столбцы сохранены | Критичное содержимое должно оставаться достижимым. После исправления список имеет 730 px содержимого, доступного прокруткой |
| MEDIUM | Layout | `extension/time-machine.css:26`, `extension/time-machine.css:218` | На 320 px Restore entire Atlas сжимался до трёх коротких строк между options и Back | Header actions переносятся; полный restore — отдельная спокойная строка на узком экране | Текст действия читается целиком и не конкурирует с возвращением в Atlas; long-caption/RTL checks проходят |
| MEDIUM | Writing | `extension/lib/atlas-history-ui.js:451`, `extension/lib/atlas-history-ui.js:460` | Review показывал только объём изменений, а примечание обещало original folder даже для copy/выбранного destination | Перечислены первые пять выбранных ссылок и количество остальных; общее примечание говорит только о гарантированном активном состоянии | Перед подтверждением виден объект действия; copy/destination не получает противоречивого обещания |
| MEDIUM | UI | `extension/lib/atlas-history-ui.js:154`, `extension/time-machine.css:125` | Выбор отдельной ссылки был заметен лишь по маленькой галочке | Тонкая акцентная рамка строки/папки дополняет checkbox; статусные фоны сохранены | Объём выбранного действия легче сверить с содержимым, не добавляя подписи или новые панели |
| LOW | Accessibility | `extension/lib/atlas-history-ui.js:276`, `extension/time-machine.css:124` | Pointer должен был попасть в нативный checkbox 16×16 px | Семантический label добавляет 4 px со всех сторон: область 24×24 px, на coarse pointer — больше; подпись сохраняет title/status | Padding действительно выбирает ссылку и не открывает её; проверено реальным кликом по краю label |
| LOW | Layout | `extension/lib/atlas-history-ui.js:68`, `extension/time-machine.css:50`, `extension/time-machine.css:54` | Свёрнутая справка занимала отдельную строку перед датой, рабочие ссылки начинались на y=525.7 при 1280×720 | Справка находится рядом с датой, интервалы timeline уменьшены. Список начинается на y=457.5; широкая справка остаётся в правом поле | Иерархия отдаёт больше места ссылкам: высота desktop списка выросла с 154.3 до 222.5 px |
| LOW | Typography | `extension/time-machine.css:218` | Дата выбранного слепка в mobile dock становилась 11 px | Сохраняется 12 px и tabular nums, подписи переносятся | Время действия остаётся читаемым на узком экране |
| LOW | Layout | `extension/time-machine.css:42` | Options buttons использовали физическое text-align:left | Используется text-align:start | RTL mirror сохраняет чтение и выравнивание управляющих элементов |

Исходная геометрия записана при первом реальном рендере текущей сборки в этой
сессии. Начальные PNG не сохранены; численные значения до исправления приведены
выше. Галерея (`time-machine-screenshots/review/index.html`, deleted capture) показывает результат,
включая короткое и широкое окна. Дополнительные выбранные состояния с warning —
в `time-machine-screenshots/second-review/`.

## Проверки

Использован существующий Playwright:
`C:/Users/Олег/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`;
Chrome: `C:/Program Files/Google/Chrome/Application/chrome.exe`.
Новые зависимости не устанавливались. Сервер — `node tools/serve.mjs 8232`.

- `npm run verify`: **335/335**, лог (`atlas-history-second-ux-verification.txt`, deleted capture).
- `node tools/atlas-history-ux-ui-checks.mjs <playwright-entry> <chrome>`:
  **80/80**, 16 тем × 1280×720 / 1024×500 / 1920×1080 / 640×360 / 320×400.
  Проверены размеры списков и справки, реальные label clicks, selection cue,
  названия ссылок в review, options/Escape, native link Enter/Ctrl/middle,
  доступные имена, длинные кнопки, Cancel/reset/search/storage, pending/stale reads.
  JSON (`atlas-history-ux-ui-browser.json`, deleted capture).
- `node tools/atlas-history-polish-checks.mjs <playwright-entry> <chrome>`:
  **32/32**, 16 тем × 1024×500 / 320×400. Critical warning, прокрутка к последней
  папке/ссылке, выбранный элемент не закрыт шапкой/dock, review/Cancel,
  раскрытие справки, RTL + длинная шапка, неизменность коллекций.
  JSON (`atlas-history-second-polish-ui.json`, deleted capture). Usage metadata инъецирована;
  реальный диск не заполнялся.
- `node tools/atlas-history-keyboard-checks.mjs <playwright-entry> <chrome>`:
  **32/32**, реальные клавиши, browser-emulated forced colors/reduced motion,
  focus bounds и возврат фокуса. JSON (`atlas-history-forced-colors-keyboard.json`, deleted capture).
- Страница `tools/screenshot-harness.html?time-machine&history-checks&theme=spaceblack`:
  **32/32** desktop и **32/32** в `tools/atlas-history-ui-narrow.html?height=400`;
  automatic first-run **4/4**. Включены фактические selected/full restore,
  all folder modes, original parent, архив/locks, durable Undo/return,
  no-op, pause/off, failure/Retry, comparison/search/read-only и материалы тем.
  Desktop (`atlas-history-current-snapshot-ui.json`, deleted capture),
  narrow (`atlas-history-current-snapshot-ui-320x400.json`, deleted capture),
  startup (`atlas-history-current-snapshot-first-run.json`, deleted capture).
  Новые заголовки/list entries включены в text contrast sampling;
  6352 desktop text samples имеют minimum **5.00:1** по computed/composited CSS.
  Декоративная ось имеет отдельный критерий; её значения не выдаются за text contrast.
- Space Black/Pearl Glass/Paper Soft: визуально прочитаны overview, wide guide,
  confirmation и selected short/narrow screenshots. Checked state сохраняет
  тематические backgrounds, radius и тени; никаких новых постоянных status labels.
- `node --check extension/lib/atlas-history-ui.js` и
  `node --check tools/atlas-history-polish-checks.mjs`: проходят.

**Not verified:** installed MV3/profile lifecycle и перезапуск Chrome, native OS
high contrast/browser zoom/screen-reader speech/audio, Animations panel replay
на 10% скорости. Скриншоты и reduced-motion emulation не заменяют эти проверки.
База, GC, бюджет, capture/restore semantics и minimum zoom не менялись;
200 MiB performance suite повторно не запускался для этих UI изменений.

Начальный старый UX runner остановился на strict selector двух storage buttons;
селектор ограничен `.tm-menu`, затем весь расширенный runner прошёл 80/80.
Это исправление проверки, не удаление пользовательской warning action.

## Verdict

**Approve** в рамках описанного локального UI/source/browser coverage:
неисправленных HIGH находок нет, все восемь находок исправлены. Это не утверждение
о нативной приёмке установленного расширения. Коммитов, push, `.gitignore`,
версии, permissions и релизного архива не изменяли.
