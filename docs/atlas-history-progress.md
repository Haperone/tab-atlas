> Generated evidence referenced below was deleted during the 6 October 2026 cleanup at the user's request. Filenames identify historical captures, not current verification. See [output storage and reruns](development-artifacts.md).

## 6 October — second full UX/UI polish

Eight local review findings fixed: short desktop lists no longer collapse to zero;
critical warning and selection dock keep content reachable; header actions wrap
without squeezed mobile labels; help sits beside the date while preserving the
wide right gutter; padded native checkbox labels and persistent selected outlines;
review names selected links and avoids an incorrect destination promise; 12px dock
date and logical options alignment. Palette/capture/GC semantics unchanged.
Node335/335, UX80/80 across16themes/five sizes, warning+RTL/growth32/32,
keyboard/media-emulation32/32, actual restore/Undo generalUI32+32 and startup4.
[Full six-domain review](atlas-history-ux-ui-second-review.md). Isolated native
IndexedDB/synthetic Chrome only; installed/native lifecycle remains unverified.
# История Atlas: состояние реализации

5 октября 2026. Выполняется [ТЗ](time-machine-spec.md). Новая история коллекций
подключена к production worker и UI. Приёмка ещё не закончена; версия и permissions
не менялись, коммита/push/релиза нет. Старый browser-tab recorder отключён; его
база не читается, не конвертируется и не удаляется автоматически.

## Последние корректировки пользователя

6 октября, оптимизация очистки 200 МиБ: вместо повторного полного чтения словаря
на каждой границе checkpoint — однократный расчёт по счётчикам ссылок/размерам.
Схема v2 добавляет `records.bytes`; v1 обновляется без переписывания слепков/Undo.
Старый префикс метаданных удаляется диапазонами, недостижимые records — один раз.
Подготовка restore тоже собирает мусор без чтения payload всего словаря.
[До/после и ограничения](atlas-history-gc-optimization.md),
200 МиБ benchmark (`atlas-history-gc-performance.json`, deleted capture): сценарий запись+GC
12.80/13.00/14.50s → 1.63/1.51/2.30s для 100/1000/10000 ссылок; 6.3–8.6×.
Оставшийся объём 156.98/157.15/159.41 МиБ, exact ledger и защищённый Undo сохранены.
Native IDB 25/25 (`atlas-history-gc-native.json`, deleted capture), active migration/restore
6/6 (`atlas-history-gc-active.json`, deleted capture); Node 335/335 (`atlas-history-gc-verification.txt`, deleted capture).
General UI 32/32 на обоих размерах, startup4/4; newer schema/corrupt/quota по2/2.
Installed-MV3 приёмка отдельно. Нужны reload карточки расширения и вкладки Atlas.

6 октября, увеличение бюджета по запросу пользователя: история Atlas — 200 МиБ,
целевая автоочистка к 160 МиБ. Предупреждение с 160 МиБ (80%), критическое с
190 МиБ (95%). В status/storage-status передаётся целевой объём очистки;
уведомление и управление хранилищем выводят реальные значения без фиксированных
20/16. Записи и защищённый Undo не мигрируют/не очищаются при увеличении лимита.
Node 335/335 (`atlas-history-200mb-verification.txt`, deleted capture);
32 UI-проверки (`atlas-history-capacity-200-ui.json`, deleted capture) подтверждают новый реальный
default, оба порога/тексты, 16 тем × два размера и Cancel без изменений.
Performance fixture теперь заполняет текущий бюджет историческими коллекциями
меньше обычной local quota и добавляет изменения до реального срабатывания GC.
Измерения 200 МиБ (`atlas-history-200mb-performance.json`, deleted capture) прошли 100/1000/10000
ссылок с реальными 187.85–188.01 МиБ учтённых данных в native IDB/Worker.
После пересечения лимита объём 156.98/157.15/159.41 МиБ; защищённый Undo сохранён,
restore/Undo — две записи текущих коллекций, audit совпадает с ledger.
Useful preview warm p95 81.5/85.2/500.3ms, после Worker restart
110.9/166.8/637.6ms. Это изолированный localhost, не installed-MV3/profile quota.
Для локального расширения: reload карточки chrome://extensions + обновление Atlas.

6 октября, заполнение истории: предупреждение в Time machine с 80%, критическая
подпись с 95%. Показывает процент/объём, автоматическую очистку старых слепков,
сохранение коллекций и защищённого Undo. Использует красный semantic danger
каждой темы; переход в существующий диалог History storage с подтверждением
очистки. Бюджет остаётся 20 МиБ, очистка к 16 МиБ; это лимит приложения.
UI 32/32 (`atlas-history-capacity-ui.json`, deleted capture): 16 тем × два размера, границы
80/95%, нормальный/неизвестный объём, повторное открытие без stale warning,
Cancel без изменений коллекций. Данные объёма в этой проверке инъецированы,
не физическое заполнение диска. General UI 32/32 на обоих размерах, startup 4/4;
storage-usage Node 4/4, module syntax pass. Скрин предупреждения проверен визуально.

6 октября, объяснение Time machine: в правом свободном поле на широком экране
добавлен `How it works`, без фоновой карточки. Объясняет сравнение с текущим
Atlas, скрытые группы, цвета и перемещённые ссылки, навигацию, восстановление,
Undo и открытие ссылки в текущем окне. Рабочая область не сужается. На меньших
экранах — раскрываемая подсказка в потоке с доступной прокруткой.
22 проверки (`atlas-history-guide-ui.json`, deleted capture): 16 тем на 1920px, граница
1839/1840px, 320/760/1280px и короткий 400px экран. Текущие коллекции неизменны.

6 октября, секундный предел шкалы: минимальное приближение — одна секунда;
миллисекундные деления убраны. Более короткая полная история остаётся в своих
реальных границах. Все слепки сохранены: Earlier/Later и стрелки выбирают каждую
запись внутри секунды. На пределе скопление переводит фокус на ползунок и
подсказывает точную навигацию вместо дальнейшего приближения. Календарные тесты
9/9; Node 335/335 (`atlas-history-second-zoom-verification.txt`, deleted capture);
pointer/wheel/keyboard 6/6 (`atlas-history-timeline-ui.json`, deleted capture), native IDB 23/23;
1000 переходов Earlier/Later (`atlas-history-step-ui.json`, deleted capture) с точными датами и
содержимым при секундном масштабе. Достаточно обновить вкладку Atlas.

6 октября, остановка Earlier/Later: воспроизведена на валидном журнале с прежним
интервалом checkpoint больше текущих 200 изменений. `step` возвращал следующий
timestamp, но `seek` обрывал replay после 200 записей и показывал тот же момент.
Replay теперь ограничен реальным диапазоном checkpoint → запрошенный timestamp,
а не настройкой новых записей. Данные не переписываются/очищаются. Новый UI runner
прошёл 250 Earlier + 250 Later на каждом из двух размеров: точная дата/содержимое
каждого слепка, остановка только на концах, текущие коллекции неизменны.
UI (`atlas-history-step-ui.json`, deleted capture), native IDB 23/23 (`atlas-history-step-native.json`, deleted capture),
Node 333/333 (`atlas-history-step-verification.txt`, deleted capture). Исправлен background module;
для установленного расширения нужны reload карточки в chrome://extensions и
обновление вкладки Atlas. Native MV3-приёмка по-прежнему отдельно.

6 октября, выравнивание выбора на шкале: native range расширен на диаметр thumb
и смещён на половину, чтобы центр точки проходил ровно по координатам playhead.
Убрано округление выбранной позиции и наследованная transition playhead при
reduced motion. Регрессия проверяет центр реальной native hit area у краёв,
в середине, при mouse drag и после nearest commit: 6/6 в трёх семействах/двух
размерах; native IDB 22/22, календарные Node-тесты 7/7. Preview не выбирает слепок
до отпускания; стрелки/Home/End остаются точными.

6 октября, полное UX/UI-ревью: исправлены options/Escape, native historical links,
ошибки выбора конфликтов, подтверждение, копии папок, возврат фокуса и тексты Undo.
Устранён пропадающий mouse click по checkbox после keyboard focus: детали больше
не меняют высоту строки. Adjacent lookup сразу показывает loading и блокирует
старое содержимое; поздние ошибки закрытого открытия не попадают в новое.
[Ревью всех шести областей](atlas-history-ux-ui-review.md),
скриншоты 16 тем/трёх состояний (`time-machine-screenshots/review/index.html`, deleted capture).
Node 333/333; general UI 32/32 на обоих размерах, startup 4/4;
UX flow 48/48 на трёх размерах, keyboard/media emulation 32/32.
Изолированный native IDB/module Worker benchmark 100/1000/10000: warm p95
41.8/64.5/463.2 ms, после Worker restart 66.5/124.9/692.2 ms.
Эти результаты не завершают приёмку установленного MV3; границы в review/acceptance.

6 октября: вместо общей полосы — шкала с масштабом, годами/месяцами/днями,
колесом вокруг курсора, перемещением периода и точным выбором слепков. По замечанию
пользователя числовые плашки заменены маленькими точками и штрихами; количество
видно только при наведении/фокусе. Drag работает и по скоплению, без выбора слепка.
`All history` возвращает полный диапазон. Движение ползунка только показывает
дату; отпускание выбирает ближайшую запись. Метаданные читаются через ограниченные
индексные count/key requests, без содержимого ссылок и без дополнительной записи.
[Review и границы проверки](atlas-history-timeline-review.md): Node 333/333,
native IDB 22/22, жесты в трёх семействах тем/двух размерах 6/6, общий UI 32/32
на обоих размерах, startup 4/4. Ниже сохранены предыдущие этапы и их результаты.

Saved for later раскрывается полностью, без пагинации ссылок. В каждой показанной
папке начальный лимит увеличивается до количества красных ссылок; они остаются
первыми. «Показать ещё» добавляет 25 строк после уже видимых, а не после прежнего
лимита 10. Большие списки появляются порциями по 25 строк с передачей управления
браузеру. Новый прогон: 32/32 на 1280 × 720 и 320 × 400, первый запуск — 4/4;
проверены смешанный inbox, 30 красных строк, целиком удалённая папка, поиск,
выбор последней красной строки и сохранение обеих позиций прокрутки.
Приведённые ниже Node/keyboard/performance результаты относятся к предыдущему
прогону; производительность полностью раскрытых больших списков отдельно не измерялась.

Пустая левая часть больше не сдвигает папки: обе desktop-колонки закреплены
явно и сохраняют ширину при скрытии соседней части, в том числе после поиска.
Удалено правило, которое сворачивало сетку в одну колонку и заново уплотняло
папки на всю ширину. На узком экране по-прежнему используется общий поток.

6 октября, корректировка действий: полное восстановление перенесено в закреплённую
шапку как второстепенная кнопка без акцентной заливки. Нижняя панель появляется
только после выбора папок/ссылок; сброс скрывает её и возвращает фокус в шапку.
Текст обеих кнопок полный, без многоточий, с переносом. Устранено наследование
глобальной анимации dashboard footer: выбранное действие видно сразу, без задержки
0.65 с и смещения. Третий пункт реализован по ответу пользователя: Saved for later
слева как список без карточки, папки справа; на широком экране прокрутка независима.
При раскрытии списков сохраняются обе позиции. На узком экране блоки расположены
последовательно с общей прокруткой. Новый UI-прогон проверяет смешанный выбор,
отсутствие обёртки, native ul/li, независимые scroll offsets и поиск/пагинацию:
31/31 на 1280 × 720 и 320 × 400, первый запуск/off — 4/4.
Клавиатура/forced-colors по всем темам — 32/32, Node — 325/325
(актуальный лог (`atlas-history-split-verification.txt`, deleted capture)). Свежий near-budget замер
100/1 000/10 000: полезный preview p95 33.2/59.3/425.9 мс, после module Worker
restart 68.0/125.5/602.4 мс; все три набора проходят. Он выполнен параллельно с
отдельным keyboard fixture прогоном, это наблюдаемое время под такой нагрузкой.

Следующий шаг приёмки 6 октября: 32 клавиатурных прогона (`atlas-history-forced-colors-keyboard.json`, deleted capture)
по всем 16 темам на 1280 × 720 и 320 × 400 проходят с browser-emulated forced colors
и reduced motion. Настоящие Tab/Shift+Tab/Space/Enter/Escape: выбор, подтверждение,
Cancel, возврат фокуса, сброс и закрытие. Сфокусированные controls не обрезаны;
периметр фокуса solid ≥2 CSS px. [Runner](../tools/atlas-history-keyboard-checks.mjs)
использует уже установленный runtime; зависимостей не добавлено. Это новые
проверенные границы, но не OS high contrast, 200% browser zoom или screen reader.

6 октября 2026: пользователь подтвердил обновление последнего слепка после
сохранения ссылки при закрытом dashboard. Это ручная проверка одного из путей
popup/ПКМ, без уточнения пути; состав слепка и второй путь отдельно не подтверждены.

Панель восстановления скрывается, когда выбранный слепок совпадает с текущим
активным Atlas, включая свойства и порядок. Архив и настройки не влияют на
сравнение. Дата не используется как признак совпадения: последний момент при
выключенной записи по-прежнему можно восстановить, если текущий Atlas изменился.
Скрытая панель не получает фокус после restore/Undo.

Проверки этой корректировки: Node (`atlas-history-current-snapshot-verification.txt`, deleted capture)
325/325, UI (`atlas-history-current-snapshot-ui.json`, deleted capture) и
320 × 400 (`atlas-history-current-snapshot-ui-320x400.json`, deleted capture) 30/30,
первый запуск/off (`atlas-history-current-snapshot-first-run.json`, deleted capture) 4/4.
Изолированный headless Chrome, native IDB и синтетические Chrome adapters.
Тестовый CSP исключает внешний скрипт, который антивирус вставлял в fixture;
это не проверка privacy или установленного MV3. Замер (`atlas-history-current-snapshot-performance.json`, deleted capture)
100/1 000/10 000 проходит: p95 открытия полезного preview 23.8/50.0/369.6 мс,
после module Worker restart 93.6/98.5/591.2 мс. Нового нативного automation
доступа нет: CUA не запускается из-за ошибки записи kernel assets.

Текущая приёмка сопоставлена с каждым AT-01–AT-25 в
[обновлённой матрице](atlas-history-acceptance.md). Свежие native IDB проверки:
активная модель/миграция/реактивация/Undo/бюджет (`atlas-history-current-native.json`, deleted capture)
**6/6**, UTF-8/квоты/повреждения/очистка/replay (`atlas-history-current-storage.json`, deleted capture)
**21/21**. Actual module Worker (`atlas-history-current-worker.json`, deleted capture) **10/10**.
Это настоящие IDB/Worker с синтетическими Chrome adapters, не installed MV3.

После замера длительного restore/Undo статус перенесён также на закреплённую
кнопку: `Reviewing…`, `Restoring…`, `Undoing restore…`. Ошибка после действия
внизу прокрутки выводится в видимую область с Retry; повторное нажатие блокируется.
UI-сценарий проверяет задержанный ответ, отказ без изменений, видимую ошибку,
Retry и точный результат/Undo. Текущий near-budget прогон (`atlas-history-restore-dock-performance.json`, deleted capture)
прошёл 100/1,000/10,000: p95 полезного просмотра **67.4/88.2/333.3 мс**,
после Worker restart **106.9/148.5/577.7 мс**, seek round trip **5.1/27.5/178.1 мс**.
Long Task observer доступен; задач просмотра ≥50 мс не зарегистрировано.
[Консолидированный better-review](atlas-history-better-review.md) явно отделяет
проверенные пары/состояния от непроверенных zoom/forced colors/audio/Chrome lifecycle.

Восстановление перенесено из строки поиска/меню в компактную панель снизу справа.
Она остаётся видимой при прокрутке, показывает дату слепка и точное число выбранных
папок/ссылок, позволяет сбросить выбор. На узком экране кнопка разворачивается
на ширину панели; отдельная область прокрутки оставляет последние ссылки доступными.
Подтверждение, конфликты папок и защищённый Undo используют прежний путь.
Основной UI (`atlas-history-restore-dock-ui.json`, deleted capture) и
320 × 400 (`atlas-history-restore-dock-ui-320x400.json`, deleted capture) прошли **29/29** каждый
с 16 темами; исходники (`atlas-history-restore-dock-verification.txt`, deleted capture) **324/324**.
Glass (`time-machine-screenshots/atlas-history-restore-dock-glass.png`, deleted capture) и
Soft (`time-machine-screenshots/atlas-history-restore-dock-soft.png`, deleted capture) сохраняют свои материалы.

Актуальный просмотр скрывает полностью присутствующие папки, существующие пустые
папки и совпадающий Saved for later до поиска и пагинации. У смешанных групп
отсутствующие ссылки идут первыми; полный слепок остаётся доступен для восстановления.
Текущий UI (`atlas-history-current-ui.json`, deleted capture) и 320 px (`atlas-history-current-ui-320.json`, deleted capture)
прошли **28/28** каждый, включая 16 тем. Пример (`time-machine-screenshots/atlas-history-hidden-groups-current.png`, deleted capture).
Текущая проверка исходников (`atlas-history-current-source-verification.txt`, deleted capture): **324/324**.

Сравнение теперь передаёт компактные JSON-совместимые данные вместо второй полной
коллекции; старые клиенты сохраняют прежний протокол. Read-only сравнение не клонирует
коллекции, seek не запускает повторное сравнение, status/step не читают ненужные
массивы сохранённых ссылок. Свежий контрольный прогон (`atlas-history-current-performance.json`, deleted capture)
на 100/1,000/10,000 ссылках около бюджета 20 MiB прошёл все три размера: p95
просмотра **70.3/107.3/493.7 мс**, после перезапуска Worker **132.4/177/881 мс**.
Long Task ≥50 мс в измеренном просмотре не зарегистрированы. Это localhost/IAB
с настоящим module Worker и IDB, синтетическим Chrome adapter; installed MV3,
физический размер базы и heap Worker этим не подтверждены.

Следующие результаты относятся к предыдущим промежуточным прогонам.

Запись теперь включена по умолчанию. Первое пробуждение владельца автоматически
сохраняет один baseline; повторный startup/enable не дублирует его. Opt-in экран
удалён. Явный off/pause остаётся в metadata и сохраняется после reopening/Clear.
Проверки: первый запуск (`atlas-history-automatic-first-run.json`, deleted capture) **4/4**;
native IDB (`atlas-history-automatic-native.json`, deleted capture) **21/21** в IAB;
основной UI (`atlas-history-automatic-ui-checks.json`, deleted capture) и
реальный iframe 320 px (`atlas-history-automatic-ui-320.json`, deleted capture) **28/28**;
`npm run verify` **314/314**. Chrome installed policy boundary не изменился.

Исправлено скрытие Saved for later за ленивой загрузкой первых 12 папок:
inbox теперь первый, исходный порядок настоящих папок сохраняется. Новый UI case
до исправления воспроизвёл ошибку (исходный результат (`atlas-history-inbox-initial.json`, deleted capture));
после исправления проверяет 18 дополнительных папок, null/отсутствующий/orphan
folderId, индивидуальное восстановление и Undo без изменения остальных коллекций.

Архив исключён из обычных слепков, словаря истории и UI. Изменения только архива
не создают моменты. Существующая коллекционная история атомарно мигрирует с
сохранением дат/seq/настроек и защищённого Undo; недостижимые архивные версии
освобождаются. При повреждении миграция откатывается, явная Clear доступна.
Семантика согласована и реализована: выбранная ссылка
возвращается активной в прежнюю папку, включая возвращение отсутствующей папки.
Та же запись в текущем архиве реактивируется без дубликата; остальные архивные
записи не меняются. Текущий dashboard архив не удаляется. Защищённая операция
Undo хранит точное состояние отдельно от обычных слепков: отмена реактивации
возвращает выбранный id в архив; можно отменить и сам Undo. Новую archive grace
не создаём. Цветовое сравнение реализовано: если все исторические ссылки папки
есть сейчас — группа скрыта, если ни одной — общий красный фон. Отдельной заливки
строк внутри полностью отсутствующей папки нет. У смешанной папки фон нейтральный, ссылки
зелёные/красные; перенесённые считаются присутствующими. Пустая папка сравнивается
по её наличию: существующие пустые папки скрыты, удалённые видны. Совпадающий inbox
тоже скрыт. Красные ссылки идут первыми; полный слепок и порядок восстановления
не меняются. Поиск и пагинация не меняют статус. Постоянных подписей/значков статусов нет; подробности
перемещений/правок в title и доступных именах. Текущие изменения обновляют сравнение,
не сбрасывая исторический момент, включая запись на паузе.

Свежая проверка: `npm run verify` **322/322**;
активная проекция/миграция/Undo (`atlas-history-active-native.json`, deleted capture) **5/5** native IDB;
общая база/квоты/повреждения (`atlas-history-active-storage.json`, deleted capture) **21/21** native IDB.
Контрольный seek p95 на 100/1,000/10,000 активных ссылках: 2.4/17.2/159.7 мс в IAB;
это не измерение installed worker и не тест около полного бюджета.
UI проверяется по обновлённым сценариям без архива; свежие результаты:
основной UI (`atlas-history-active-ui.json`, deleted capture), 320 px (`atlas-history-active-ui-320.json`, deleted capture)
**28/28** каждый; **2,144** текстовых/материальных измерения на 16 темах в каждом
прогоне, минимальный измеренный контраст **5.00:1**. Скриншот сравнения:
красные/зелёные фоны (`time-machine-screenshots/atlas-history-active-comparison.png`, deleted capture).
Последующий прогон с общей заливкой папок: основной UI (`atlas-history-uniform-ui.json`, deleted capture)
и 320 px (`atlas-history-uniform-ui-320.json`, deleted capture) **28/28** каждый, **2,912** измерений
на 16 темах, минимум **5.00:1**. Проверены однородные/смешанные/пустые папки,
отсутствующая ссылка за первой десяткой и за поиском; исправлен контраст текста
пустой папки на цветной поверхности. Новый пример (`time-machine-screenshots/atlas-history-uniform-comparison.png`, deleted capture).
Нативная приёмка установленного расширения и повтор расширенных измерений на
обновлённой модели ещё нужны. Старые archive/opt-in требования и verdict ниже
описывают предыдущий этап, не подтверждают новую цель.

Дополнительный актуальный прогон: actual Worker (`atlas-history-active-worker.json`, deleted capture)
**10/10** — реальные terminate/postMessage/native IDB с синтетическими Chrome API,
popup/ПКМ shared writer, idempotence/recovery и долговечный Undo. Для 1,000 активных
ссылок и 199 событий p95 seek **31.8 мс**, service round trip **33.7 мс** в IAB.
Первый запуск (`atlas-history-active-first-run.json`, deleted capture) **4/4** — автоматический baseline
без активации, сохранение off/pause, возобновление без дубликатов.

## Предыдущий этап: подключение модели с архивом (исторический отчёт)

- Один worker-owned writer обслуживает dashboard, popup/ПКМ, папки, переносы,
  архив/retention, backup/shared import и Undo. UI посылает намерения вместо
  устаревших массивов. Workspace тоже использует этот writer, но не входит в историю.
- Массовое сохранение, native group → folder и Apply в Sweep сохраняют все успешные
  элементы одним local commit. Новая папка и её ссылки записываются вместе.
  Ошибка всего commit оставляет все вкладки открытыми. Массовый Undo удаляет
  добавленные ссылки одной командой; оставшиеся locked записи доступны для повторения.
- `atlas-history-model/db/restore/service` записывают folders/deferred/порядок/архив
  в отдельную `tab-atlas-collections-history`: immutable версии, дельты,
  checkpoints, индексированный seek, exact UTF-8 ledger, 20→16 MiB size trimming,
  protected Before/target и ограниченный quota retry. Нет ограничения возрастом 30 дней.
- Restorer защищает Before и подготовку в IDB до atomic local commit коллекций,
  receipt, generation и карты archive grace. Recovery определяет commit по receipt;
  повтор запроса не дублирует действие. Undo после новых правок требует подтверждения
  и сохраняет эти правки в Before Undo. Restore не создаёт browser tabs/windows.
- Карта восстановленного архива реально используется cleanup-archive. Даты не
  подменяются; grace 30 дней проверяет id/completedAt/until. Ручное удаление доступно.
- Новая UI показывает исторические папки/inbox/archive, дату, timeline 0–1000,
  Earlier/Later/Latest, поиск и ленивый DOM. Новые записи сохраняют выбранный момент.
  Folder conflict предлагает Replace / Add missing / prefixed copy без default;
  окончательное подтверждение показывает изменения и точное имя копии.
  Выбор нескольких папок/ссылок разрешается до общего commit. Locked replacement
  недоступен с объяснением. Отдельная историческая ссылка открывается только в текущем
  normal window; точный существующий URL в этом окне активируется.
- Общая нижняя зелёная плашка содержит countdown/hover Undo/back glyph и существующие
  success/undo звуки. Долговечные Undo/Before остаются в меню после её исчезновения.
- Старый dashboard Undo привязан к generation в начале действия, до async work:
  восстановление до показа старой плашки не даёт ей изменить новый Atlas. Browser-only
  и workspace Undo не блокируются. Устаревший Undo объясняет переход в Time machine.
- History failure не превращает уже успешное ordinary save в ложную ошибку.
  Одинаковые/legacy-only записи не создают слепков. Explicit Clear доступна даже
  при corrupt history; она не требует успешного initialization/decoding, показывает
  последствия и не меняет текущие коллекции. Нет автоматического wipe при ошибке.
- README, privacy policy и store notes описывают новую модель; существующий ZIP 1.2.0
  не изменён. Старые fixtures/отчёты явно superseded и не доказывают её готовность.

## Проверено

- `npm run verify`: **313/313**, syntax checks — вывод (`atlas-history-verification.txt`, deleted capture).
  Общая цифра включает старые и нерелевантные тесты; она не равна полной приёмке.
  Новые focused checks: model 24, writer 10, restore protocol 16, collection commands
  11, service 7; quick save 26. Есть controlled race, quota/commit failure,
  generation/old Undo, batch commit и cold receipt recovery без лишнего baseline.
- Native IndexedDB в IAB **20/20** — JSON (`atlas-history-native-checks.json`, deleted capture).
  Настоящие transactions/rollback, trimming/protected return/reopening, receipt →
  recovery → Undo, abandoned preparation, injected quota, corrupt root/guard Clear,
  максимальный replay 199 событий, baseline timing 100/1,000/10,000 ссылок,
  missing dictionary row после cache и bounded retry/rollback пакетной записи.
- Те же native IDB checks в подключённом Chrome **20/20** —
  JSON (`atlas-history-native-chrome-checks.json`, deleted capture). Chrome 154, Windows,
  hardwareConcurrency 24, deviceMemory 32 GiB (browser estimate).
- UI с real controller/service/native IDB и synthetic Chrome/local storage:
  **27/27** в IAB JSON (`atlas-history-ui-checks.json`, deleted capture),
  **27/27** при 320×720 в iframe JSON (`atlas-history-ui-320.json`, deleted capture).
  **27/27** в Chrome — JSON (`atlas-history-chrome-ui-checks.json`, deleted capture), фактическая
  ширина браузера 3200 px; это не отдельная narrow/zoom проверка Chrome.
  Read-only preview, три folder modes и Cancel, prefixed-copy exact name/archive,
  Undo/Before Undo, conflict after newer edits/Cancel/confirmed return, open link in
  current fixture window, filtering/search/focus, rapid seek/reduced motion,
  Clear cancellation, full restore/Undo, отдельная ссылка без соседей, несколько
  конфликтующих папок с одним Undo, prototype-like imported ID, pause/resume/off,
  empty, loading/error/Retry, все направления для отсутствующей родительской папки,
  предупреждение о занятом имени сразу при выборе, несколько одноимённых
  destinations и locked folder. Основной прогон: 1,760 rendered text contrast samples
  по 16 темам, минимум 5.00. Добавлены первый запуск **2/2**
  JSON (`atlas-history-first-run-ui.json`, deleted capture) и recovery **2/2 каждый**:
  corrupt (`atlas-history-corrupt-ui.json`, deleted capture), quota (`atlas-history-quota-ui.json`, deleted capture),
  newer schema (`atlas-history-newer-schema-ui.json`, deleted capture), blocked (`atlas-history-blocked-ui.json`, deleted capture).
  Corrupt/newer-schema используют настоящую disposable IDB; quota проверяет stopped
  state, blocked — controlled error, не native quota/upgrade blocking.
  Contrast helper теперь разбирает computed RGB/sRGB напрямую: прежнее canvas
  readback давало непоследовательную прозрачность и неверный фон в Chrome.
  Исходный результат (`atlas-history-chrome-color-readback-initial.json`, deleted capture) сохранён;
  порог 4.5 и палитры не менялись. Эти samples не заменяют assistive technologies.
  Для нового узкого прогона browser viewport override не применялся; вместо него
  `tools/atlas-history-ui-narrow.html` проверяет настоящий child viewport 320×720.
  Подготовка synthetic слепков больше не зависит от 150 ms: fixture дожидается
  закрытия предыдущего действия и заново открывает history для fresh status.
  Исходная гонка Chrome (`atlas-history-chrome-seed-timing-initial.json`, deleted capture) и
  гонка переоткрытия (`atlas-history-ui-reopen-timing-initial.json`, deleted capture) сохранены.
- Реальный module Worker + postMessage + native IDB: **10/10** в
  IAB (`atlas-history-worker-checks.json`, deleted capture) и Chrome (`atlas-history-worker-chrome-checks.json`, deleted capture).
  Termination на prepared/local receipt/committed/target-recorded; повтор после
  потерянного ответа; durable Undo после нового Worker; folder modes, concurrent
  intents, stale preview и Undo после новых правок. 1,000 links + 199 replay events:
  p95 service round trip **28.4 ms IAB / 31.1 ms Chrome**, native seek 29.6/30.2 ms.
- Near-budget performance (91–94% accounted 20 MiB): все три набора проходят
  IAB (`atlas-history-ui-performance.json`, deleted capture) и Chrome (`atlas-history-chrome-ui-performance.json`, deleted capture).
  По 20 warm/cold useful-preview и seek samples; реальный Worker и ленивый UI.
  Chrome p95 useful warm/cold: **28/106 ms** (100), **69.5/137 ms** (1,000),
  **334.7/735 ms** (10,000). Seek round trip: 8.7/37.6/215.5 ms.
  Preview long tasks не обнаружены; это не измерение Worker CPU. Полные samples
  сохранены: один warm sample 10,000 links был 3.93 s, p95 остаётся ниже 1 s.
  Restore/Undo Chrome: 0.25/0.52 s, 0.56/0.98 s, **3.12/8.83 s** соответственно.
  GC 2.57–3.59 s; exact ledger и protected Before/target после trimming сохранены.
  Renderer heap/origin estimate — оценки, не физический размер history или Worker heap.
- Replay клонирует baseline один раз; dictionary чтение/запись пакетами ограничено
  500 records, metadata-only updates не запускают полный GC. Эти изменения сохраняют
  строгую промежуточную валидацию и atomic native rollback. Dashboard dictionaries
  не наследуют Object.prototype: imported `__proto__` больше не ломает rendering.
- Ручной keyboard walkthrough через CUA: Enter открывает Customize/history/conflict,
  Tab переводит Cancel → Review с видимым 2px focus; Space выбирает Copy, Enter
  открывает итоговое имя, Escape отменяет только верхний диалог и затем возвращает
  Customize. Скриншот (`time-machine-screenshots/atlas-folder-conflict-keyboard.png`, deleted capture).
- Dashboard regression в IAB **14/14** — JSON (`atlas-history-dashboard-regression.json`, deleted capture):
  share/read failure, empty selection, privacy/tour focus, Sweep/staged Undo/read failure,
  search/keyboard/folder reorder, failed atomic bulk/group commit preserving open tabs
  and data, retry/Undo, partial close/open and retryable Undo, theme samples.
- `git diff --check` проходит. Сохранены диалоги
  Apple (`time-machine-screenshots/atlas-folder-conflict-spaceblack.png`, deleted capture),
  Glass (`time-machine-screenshots/atlas-folder-conflict-paperglass.png`, deleted capture),
  Soft (`time-machine-screenshots/atlas-folder-conflict-papersoft.png`, deleted capture).

Прежний dashboard audit при 320 px дал 13/14 (Tour: UI did not settle),
исходный результат (`atlas-history-dashboard-320-initial.json`, deleted capture) сохранён.
Свежий responsive regression (`atlas-history-responsive-regression.json`, deleted capture) проверяет
настоящие child viewports: dashboard 320×700 **15/15** (с load failure/Retry),
640×400 с увеличенными текстовыми отступами **14/14**, dialogs/drawers 320 px
**10/10**, public pages 320 px **5/5**. Ошибка Tour в этом прогоне не повторилась;
это новое наблюдение, не заявленное исправление исходного timeout.

В реальном клавиатурном walkthrough Chrome найдена и исправлена ошибка Escape:
открытое меню закрывало всю историю и сохраняло expanded state при повторном входе.
Теперь первый Escape закрывает только меню, сохраняет preview и фокусирует summary;
следующий закрывает историю и возвращает Customize. Close также сворачивает меню.
Исходная проверка (`atlas-history-keyboard-initial.json`, deleted capture),
проверка после исправления (`atlas-history-keyboard-checks.json`, deleted capture),
снимок (`time-machine-screenshots/atlas-history-menu-escape.png`, deleted capture).
Клавиатурой также выполнены Merge → подтверждение → долговечный Undo и validation
без выбора, с native radio ArrowDown и видимым 2px focus на Review.
Ctrl+plus / Ctrl+equal через инструмент не изменили width/DPR: 200% zoom не проверен.
Forced colors и настоящий screen-reader walkthrough через доступные API не проверены.

Эти browser fixtures используют disposable synthetic collections и injected
Chrome APIs/local storage. Native IDB reopening и unit lifecycle fault injection
не подменяют установленный extension worker/browser restart. Пользовательские
коллекции и реальные browser windows в них не восстанавливаются.

Свежий Worker сценарий запускает production quick-save и history service с общим
writer без dashboard DOM: popup-save, повторное сохранение (0 новых точек), ПКМ,
Undo, create-folder-and-save одновременно с dashboard save, restart и отклонение
старого popup Undo после restore. **10/10** в IAB и Chrome; пять подтверждённых
изменений дают ровно пять точек. Проверены запросы 4 receipts / 3 success sounds /
1 Undo sound, а не реальная Chrome injection или слышимость.
Свежие регрессии: dashboard drag (`atlas-history-drag-regression.json`, deleted capture) **12/12**,
включая неподвижный drag у края, wheel, перенос нижней ссылки в верхнюю папку и
остановку scroll после drop; popup/receipt (`atlas-history-notification-regression.json`, deleted capture)
**8/8**, включая реальный iframe 360 px, все 16 материалов, hover/focus/back glyph,
остаток countdown, double-click Undo и stale receipt. Drag events и Chrome APIs
в этих проверках синтетические; installed acceptance ими не закрывается.

## Ещё предстоит — не считать готовым

1. Оставшиеся hover/focus сочетания, 200% browser zoom, forced colors,
   screen reader и полную keyboard/focus
   доступность. Проверенные состояния/320 px не закрывают AT-18.
2. Реальное установленное расширение: два dashboard + popup/ПКМ, сохранения
   при закрытом dashboard, archive grace после startup, durable Undo после worker
   termination и browser restart. Пользователь открыл обычную страницу расширения:
   актуальный inventory подтверждает chrome-extension://…/index.html. Прямой
   getTab этой страницы явно отклонён browser security policy: допустимы только
   http/https. Это подтверждённое ограничение доступа, а не отсутствие вкладки
   или неисправность Atlas. Ранее chrome://newtab возвращал about:blank; переход
   на chrome://extensions также запрещён. Запрет не обходился; повторное открытие
   страницы не решает ограничение. Нужен ручной native прогон по checklist.
   Актуальный [native checklist](atlas-history-native-checklist.md) пока не закрыт.
3. Полная acceptance остаётся in progress. См. [AT-01–24 matrix и scoped better review](atlas-history-acceptance.md).

Автономная native приёмка заблокирована после повторных попыток доступа в нескольких
последовательных goal turns. HTTP fixtures и 313 Node tests не являются заменой
оставшимся installed checks. Первый ожидаемый ручной результат: в Customize →
Time machine отображаются папки/сохранённые ссылки, а не browser domain groups.
Ответ пока не получен; никакой installed пункт не отмечен пройденным.
