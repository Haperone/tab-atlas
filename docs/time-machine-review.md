> Generated evidence referenced below was deleted during the 6 October 2026 cleanup at the user's request. Filenames identify historical captures, not current verification. See [output storage and reruns](development-artifacts.md).

# Time machine: реализация и проверка

> Устаревшая продуктовая модель. С 5 октября 2026 Time machine означает историю
> папок, сохранённых ссылок, порядка и архива Atlas. Этот отчёт относится к прежнему
> браузерному журналу, а не к [новому ТЗ](time-machine-spec.md).
> Реализация новой модели начата в atlas-history-model/db, но ещё не подключена
> к интерфейсу. Этот отчёт и прежний green verdict к ней не относятся.

4 октября 2026 года. Функция реализована в рабочем дереве по
[ТЗ](time-machine-spec.md). Нативная приёмка установленного Chrome-расширения
ещё не завершена. Версия 1.2.0, manifest permissions и minimum Chrome 109
не изменены; коммит, push и новый релиз не выполнялись.

Вход: **Customize → Time machine → Enable local history**. Запись выключена
по умолчанию. Отдельный worker-журнал сохраняет обычные web-вкладки, окна,
порядок, pin, activation и группы. Предпросмотр не меняет браузер. Есть поиск,
фильтр окна, восстановление ссылки/выбора/домена/момента, Stop и безопасный Undo.
Сохранённые коллекции и backup schema 1 не версионируются этой функцией.

История использует отдельную IndexedDB с бюджетом сериализованных UTF-8 записей
20 МиБ, очисткой к 16 МиБ и максимальным возрастом 30 дней. Словарь, текущая
модель, checkpoints и ownership операций входят в учёт. Отдельный резерв
256 КиБ ограничивает Undo; слишком большой набор предлагается уменьшить до
начала browser mutations. Внешних автоматических запросов функция не добавляет.

## Область better-review

Проверены вход, onboarding, timeline, domain cards, поиск/выбор, меню, storage,
подтверждение, прогресс, Undo, ошибки и состояния паузы/разрыва/пустоты.
Vanilla JS, native dialog/details/range/checkbox, существующие semantic tokens;
без новых зависимостей. Применены `better-interface` и все шесть его владельцев,
а также `apple-design` для прерываемого движения. Основание: AGENTS.md,
проектные `.agents/skills`, ТЗ и существующие компоненты dashboard.

| Домен | Осмотренное доказательство | Результат |
| --- | --- | --- |
| Accessibility | Native modal isolation, имена, focus/возврат, Escape, selection/Undo; 12 UI-сценариев при обычной ширине и 320 px | Исправлены имена и потеря фокуса; реальные screen reader/200%/forced colors не проверены |
| Layout | Timeline, menu stacking, confirmation bounds, responsive cards; скриншоты трёх материалов | Исправлены наложение меню и центрирование подтверждения |
| Writing | Onboarding/privacy, gap, zero/empty, interrupted/error, restore counts, Clear | Сокращён текст очистки, состояния различаются явно |
| Typography | Theme fonts, перенос названий, numeric dates, доступ к полному URL при focus, narrow layout | Clear в проверенных состояниях |
| Colors | 112 text/material probes × 2 viewport runs по 16 темам | Минимальный измеренный контраст 5.03:1; материалы тем сохранены |
| UI | Stable cards, domain-level 120 ms transitions, reduced motion, interruptible seek, existing notification | Clear после исправлений в проверенных состояниях |

## Исправленные находки

В таблице перечислены найденные при реализации причины и окончательные исправления.
Последние исправления ниже прошли Node-проверки; повторная браузерная проверка
после них ещё требуется. Прежний preview verdict относится к сохранённым снимкам.

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Accessibility | `extension/lib/time-machine-ui.js:26` | Пустое имя recording action до успешного status | `Checking recording…`, disabled до status | Ошибка первичного чтения оставляла безымянный контрол |
| HIGH | Layout | `extension/time-machine.css:8` | Общий header transform/stacking мог перекрывать меню шкалой | Собственный stacking и `transform:none` | Действия меню должны оставаться доступны |
| HIGH | UI | `extension/lib/time-machine-ui.js:87` | Restore/open мог использовать desired time с карточками предыдущего seek | Блокировка действий во время seek; restore использует result.time | Выбранный видимый момент должен совпадать с восстановлением |
| HIGH | Accessibility | `extension/lib/time-machine-ui.js:87` | Disable фокусированной кнопки/удаление кнопки теряли focus | Busy guard и перевод focus на шкалу/Close перед disable | Клавиатурный сценарий должен продолжаться предсказуемо; последний helper требует повторного UI run |
| HIGH | UI | `extension/lib/time-machine-db.js:316` | Earlier/Later в разрыве использовали seq checkpoint и пропускали события | В разрыве переход по времени к ближайшему событию | Подтверждено native IDB 23/23 в navigation-checks |
| HIGH | Reliability | `extension/lib/time-machine-restore.js:34` | Отказ финальной записи оставлял running, отказ recovery мешал status | Терминальный результат доступен в текущем worker; recovery сохраняет доступ к status | Пользователь должен видеть прерванный результат; покрыто Node |
| HIGH | Safety | `extension/lib/time-machine-restore.js:20` | Неудачная запись пользовательского переноса могла потерять защиту Undo после worker restart | Ограниченный session marker запрещает Undo для неопределённой операции | Изменённые вкладки должны оставаться; покрыто Node, native повтор требуется |
| MEDIUM | Layout | `extension/time-machine.css:67` | Подтверждение в верхнем левом углу | Native dialog с `inset:0; margin:auto` | Подтверждение должно быть заметным и связанным с действием |
| MEDIUM | Writing | `extension/lib/time-machine-ui.js:335` | Длинный технический абзац очистки с общим origin estimate | Последствия сначала, короткое отдельное описание бюджета | Пользователь должен понимать, что удаляется |
| MEDIUM | Writing | `extension/lib/time-machine-ui.js:220` | Render мог заменить сообщение прерванного restore | Interrupted сообщение сохраняется вместе с выбранным состоянием | Неполный результат и безопасный Undo не должны скрываться |

Исправлены и проверены backend-гонки: rollback словарного cache, cold startup,
перенос через закрывшееся окно, физические индексы внутренних вкладок,
обновление состава группы, pin failure, одновременный Undo, изменение вкладки
во время Undo и появление уже открытого URL посреди restore. При повреждении
история не удаляется тихо; status и явная Clear остаются доступны.
Один session marker и epoch не содержат URL/названий. При квоте ownership write,
как и append, выполняет одну ограниченную очистку и один повтор; новый native
сценарий для ownership добавлен, но пока не исполнен.

## Проверки

- `npm run verify`: **239/239**; полный вывод — verification (`time-machine-verification.txt`, deleted capture).
  Time machine имеет 41 отдельных model/service/restore тестов.
- Native IndexedDB: **22/22** — measurements (`time-machine-measurements.json`, deleted capture).
  Ledger, dictionary GC, replay, 200 events/5 minutes, atomic abort, quota fault
  с ровно одним retry, paused age expiry, blocked open, newer schema,
  versionchange, missing dictionary и explicit Clear.
- Последующий native run: **23/23**, включая переходы через разрыв —
  navigation checks (`time-machine-navigation-checks.json`, deleted capture). Он предшествует
  последним изменениям ownership/recovery. Текущий набор содержит 24 сценария;
  новый ownership quota test и повтор всего набора остаются открытыми.
- Native Worker termination + postMessage + IDB: журнал переживает смену worker;
  interrupted restore не продолжается автоматически, известный owned tab отменяется.
  Chrome APIs в этом тесте синтетические.
- Production UI: **12/12** при обычной ширине и **12/12** при 320×800 —
  обычный экран (`time-machine-ui-checks.json`, deleted capture), 320 px (`time-machine-ui-320.json`, deleted capture).
  Включая 100 быстрых input, сохранение выбранного момента, reduced motion,
  confirmation, gap, paused Clear/Resume, zero tabs, Undo и отсутствие external resources.
  Эти сохранённые runs предшествуют последнему focus helper и обработке unsafe Undo;
  повтор на обеих ширинах и performance run после этих изменений не подтверждён.
- Existing dashboard audit: **14/14** — regression (`time-machine-dashboard-regression.json`, deleted capture).
  Existing page/popup receipt checks: **8/8** — notification regression (`time-machine-notification-regression.json`, deleted capture).
  Все сценарии используют тестовые Chrome APIs и вымышленные данные.
- Дополнительно вручную в harness: off onboarding → enable → pause → Clear →
  Resume; подтверждение 80 вкладок/Cancel, частичный restore/Undo; error/Retry.
  Retry в намеренно постоянно занятом fixture сохраняет понятную ошибку.
- `git diff --check`: passed. Version/permissions/release не изменены.

## Производительность

Машина: Intel Core i7-13700K, 24 logical CPUs; физическая RAM 68,340,011,008 bytes
(около 63.65 ГиБ); Windows 11 Pro 10.0.26200; Node v22.22.0.
IAB engine сообщает Chrome 154, hardwareConcurrency 24 и deviceMemory 32 ГиБ
(ограниченная браузерная оценка, не физическая RAM). Все страницы синтетические.
Seek: 20 прогретых чтений, p95 — 19-й отсортированный результат.
UI: 10 циклов, p95 — максимум этих 10; polling resolution около 10 мс.

| Набор | Учтённые bytes | Начальная запись, мс | p95 seek, мс |
| --- | ---: | ---: | ---: |
| 100 вкладок | 78,338 | 37.7 | 2.7 |
| 1,000 вкладок | 788,850 | 348.0 | 25.4 |
| 10,000 вкладок | 8,037,862 | 3,798.3 | 261.0 |
| 1,000 + 199 replay events | 876,798 | 6,855.4 за 199 изменений | 32.0 |

Требование ≤250 мс относится к 1,000 вкладок; 10,000 seek имеет отдельное
измерение и не выдан за результат ≤250 мс. Начальная запись больших состояний
выполняется в worker, а не в UI.

При **20,230,717 bytes**: p95 status+seek **72.4 мс**; trim **290.9 мс**;
после trim **4,491,015 bytes**, p95 **35.2 мс**. Цель ≤1 секунды выполнена.
Origin estimate до/после — 28,007,302 / 23,637,129 bytes; включает другие базы
этого origin и IDB overhead. Это не точный физический размер одной history DB.

Production UI с 10,000 вкладок через отдельный native Worker: p95 полезного
предпросмотра **453.5 мс**, задач более 50 мс **нет**. Сразу создаётся ограниченное
число DOM rows; доступны Show more и поиск. После возврата Latest — 15 rows.
Приблизительный UI heap в конце: used 11,973,556 bytes, allocated 72,244,708;
это снимок renderer, не прирост памяти функции и не память worker/файлы IDB.
UI performance JSON (`time-machine-ui-performance.json`, deleted capture) содержит исходные значения.

Воспроизведение: `node tools/serve.mjs 8232`; затем страницы из
[tools README](../tools/README.md#time-machine-checks). Нажать Run checks на
`/tools/time-machine-checks.html`; UI runs включаются query `history-checks`;
performance — `time-machine&history-size=10000&history-performance&theme=spaceblack`.
Для метрик выполнять один стенд за раз, без других активных проверок.

## Скриншоты

Обычные скриншоты реального UI на синтетической базе; это не установленное расширение.

- Glass (`time-machine-screenshots/glass.png`, deleted capture)
- Soft (`time-machine-screenshots/soft.png`, deleted capture), первое включение (`time-machine-screenshots/soft-onboarding.png`, deleted capture)
- Apple (`time-machine-screenshots/apple.png`, deleted capture), подтверждение 80 вкладок (`time-machine-screenshots/apple-confirm.png`, deleted capture)
- Ошибка чтения (`time-machine-screenshots/error.png`, deleted capture)

## TM-01–23: границы приёмки

«Стенд» означает автоматические/ручные synthetic Chrome APIs; «native IDB» и
«native Worker» означают настоящие браузерные механизмы, но не Chrome MV3 lifecycle.

| ID | Доказательство | Осталось |
| --- | --- | --- |
| TM-01 | Off DB/service; вручную onboarding/Enable | Новая установка/обновление Chrome |
| TM-02 | Reducer/replay + native IDB | Реальные browser event sequences |
| TM-03 | Model/service moves/groups; restore tests | Native pin/group order |
| TM-04 | Model window closure retains past state | Реальное закрытие окна |
| TM-05 | Native Worker restart + IDB keys/journal | MV3 worker termination/wake |
| TM-06 | Service startup/epoch/cold overlap | Рестарт Chrome |
| TM-07 | Queue/replacement/detach/Undo race tests | Реальная доставка Chrome events |
| TM-08 | Native gap + UI pause/resume | Проверка паузы в установленном расширении |
| TM-09 | 100 rapid UI inputs, read-only preview | — |
| TM-10 | Native budget + exact ledger near 20 МиБ | — |
| TM-11 | Native GC/replay anchor/dictionary audit | — |
| TM-12 | Native rollback/one quota retry; Node corrupt-current Clear | Реальная quota exhaustion профиля |
| TM-13 | Single/selection/domain/all, confirmation tests | Реальные tabs/windows APIs |
| TM-14 | Exact URL/query/fragment plans; live skip during restore | Реальные Chrome URLs |
| TM-15 | Stop/idempotency/failures; native Worker interrupted restore | MV3 termination during restore |
| TM-16 | Ownership/redirect/move/pin/concurrent Undo tests | Реальные redirect/group event timings |
| TM-17 | UI receipt + existing 8 notification checks | Звук и page feedback в установленном расширении |
| TM-18 | Capture/event/sender allowlist tests | Реальный incognito-контекст |
| TM-19 | 16 тем, 320 px, keyboard, project reduced motion | Реальные zoom 200%, forced colors, системный reduced motion, screen reader |
| TM-20 | Native IDB/Worker/UI metrics и CPU/heap/origin report | Отдельный worker heap не измерен |
| TM-21 | 239 tests + прежние 14 dashboard + 8 receipt checks | Нативная регрессия popup/ПКМ/drag/backup/workspace |
| TM-22 | Native blocked/versionchange/newer schema/corrupt dictionary/Clear | Extension update и eviction в Chrome |
| TM-23 | README/privacy/store обновлены; manifest unchanged; no external resources | Публикация нового релиза не входит в эту работу |

На момент отчёта инструменты видят только IAB и MCP Apps, обычный Chrome не
подключён. Поэтому пункты выше не объявлены пройденными на установленном
расширении. Нативный список: [checklist](time-machine-native-checklist.md).
В последнем продолжении автоматическая проверка безопасности отклонила доступ
к существующей вкладке стенда из-за недопустимого протокола. Browser run не
выполнен; обход блокировки не применялся. Локальный сервер снова доступен на 8232.

## Verdict

Прежний **Approve** ограничен осмотренными preview-поверхностями и сохранёнными
better-проверками. Текущая версия требует повторного browser run после последних
исправлений, затем нативной приёмки Chrome. Общая приёмка ТЗ **не завершена**;
настоящий zoom/forced colors и остальные границы перечислены выше.
