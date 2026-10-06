# Локальные навыки для мобильного Tab Atlas и синхронизации

Установлены 6 октября 2026 года в `.agents/skills`. Это инструкции и справочные
материалы для агента; они не добавляют код или зависимости в расширение.
Требования продукта остаются в [ТЗ](mobile-sync-spec.md).

## Что использовать

| Задача | Навык | Источник и закреплённая версия | Лицензия |
| --- | --- | --- | --- |
| PWA: manifest, установка, service worker, офлайн-оболочка, Share Target | [pwa-development](../.agents/skills/pwa-development/SKILL.md) | [alinaqi/maggy](https://github.com/alinaqi/maggy/tree/72a456e6ccf0e68d10f69157b590ec1c44f6ef44/skills/pwa-development), `72a456e6` | MIT |
| Мобильный веб-интерфейс: touch, клавиатура, safe area, viewport, scroll | [mobile-native](../.agents/skills/mobile-native/SKILL.md) | [Emil Kowalski](https://github.com/emilkowalski/skills/tree/e8a175de22ae1e49370fc144c1f3bb9aeedf988d/skills/mobile-native), `e8a175de` | MIT |
| Supabase: Auth, API, Realtime, изоляция пользователей | [supabase](../.agents/skills/supabase/SKILL.md) | [Supabase](https://github.com/supabase/agent-skills/tree/c9be0e931b7930f7d02126d04774d904c381e7d7/skills/supabase), `c9be0e93` | MIT |
| Postgres: схема, индексы, RLS, конкурирующие записи | [supabase-postgres-best-practices](../.agents/skills/supabase-postgres-best-practices/SKILL.md) | [Supabase](https://github.com/supabase/agent-skills/tree/c9be0e931b7930f7d02126d04774d904c381e7d7/skills/supabase-postgres-best-practices), `c9be0e93` | MIT |
| Cloudflare: выбор хостинга, Static Assets, Workers, D1 и ограничения | [cloudflare](../.agents/skills/cloudflare/SKILL.md) | [Cloudflare](https://github.com/cloudflare/skills/tree/41e0d19858946d18af9ee2c2feebbe2e11d829ff/skills/cloudflare), `41e0d198` | Apache-2.0 |
| Проверки PWA/расширения: офлайн, worker, сеть, мобильный экран, несколько клиентов | [playwright-best-practices](../.agents/skills/playwright-best-practices/SKILL.md) | [Currents](https://github.com/currents-dev/playwright-best-practices-skill/tree/283d5cbc5d11aac1abda058b16ad22c317d54dc0/playwright-best-practices), `283d5cbc` | MIT |
| Безопасная реализация веб-клиента: XSS, авторизация, секреты | [security-best-practices](../.agents/skills/security-best-practices/SKILL.md) | [OpenAI](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/security-best-practices), `49f948fa` | Apache-2.0 |

Для визуала продолжать использовать существующие `better-interface`,
`better-accessibility`, `better-layout`, `better-ui`, `better-colors`,
`better-typography`, `better-writing` и `apple-design`. Новый мобильный навык
дополняет их платформенными деталями. Отдельный React/Next.js-набор не установлен:
переход на другой стек не был выбран.

## Порядок применения

1. Прочитать соответствующий раздел ТЗ и проектные правила в `AGENTS.md`.
2. Загрузить нужный `SKILL.md`, затем только справочные файлы для текущей задачи.
3. Перед реализацией сверить изменчивые API и ограничения с официальной
   документацией платформы и фактически выбранными версиями.
4. Проверить изменение существующими средствами проекта. Эмуляцию, mocks и
   проверки на реальных телефонах указывать раздельно.

Supabase и Cloudflare — варианты архитектуры, а не уже выбранные провайдеры.
Установка навыков не подключает аккаунты, облачные ресурсы, MCP, CI или аналитику
и не запускает команды из их примеров.

## Важные границы

- `pwa-development` содержит общие рецепты и устаревающие примеры, включая CRA,
  Lighthouse PWA badge и упрощённые критерии установки. Это не критерии приёмки
  Tab Atlas: ориентироваться на актуальные платформенные источники из ТЗ.
- Общие примеры `skipWaiting`, очистки Cache API и кеширования API нельзя
  переносить буквально. Кеши должны иметь собственное пространство имён,
  личные ответы API и авторизации не кешируются общей стратегией; обновление
  оболочки не должно терять коллекцию, ключи и ожидающие отправки операции.
- Background Sync и Share Target не дают одинаковых возможностей на Android
  и iOS. Нужны обнаружение возможностей, резервные сценарии и реальные устройства.
- Supabase Realtime или WebSocket не заменяют журнал операций, cursor,
  идемпотентность, обработку пропущенной доставки и durable outbox.
- Подходящий проверенный специализированный навык для всего нашего протокола
  offline sync и E2EE не выбран. Эти части требуют отдельного проектирования,
  проверки конфликтов и криптографических решений по ТЗ; общий security-навык
  не доказывает их корректность. Собственную криптографию не изобретать.
- `cloudflare` ссылается на необязательный соседний `nextjs-on-cloudflare`.
  Он не установлен, поскольку Next.js не выбран. Сам навык разрешает использовать
  официальную документацию вместо отсутствующих соседних навыков.
- Рецепты установки пакетов, создания проектов, миграций и deploy выполняются
  только в рамках порученной реализации, с учётом правил проекта и пользователя.

## Проверка установки и воспроизводимость

Установлены полные каталоги семи навыков, включая справочные файлы: 388 файлов
из закреплённых версий источников. Их содержимое сверено с Git blob SHA из деревьев
GitHub; `SKILL.md` проверены на frontmatter с именем и описанием. Локальные ссылки
в основных `SKILL.md` разрешаются, кроме указанного необязательного соседа.
В составе исходных каталогов нет исполняемых скриптов или символических ссылок.
Лицензии сохранены рядом: `LICENSE.upstream.txt` либо исходный `LICENSE.txt`.

Полные refs, пути, SHA-256 основных файлов и лицензий записаны в
[локальном реестре](../.agents/skills/mobile-sync-sources.json). Установка
выполнена через OpenAI `skill-installer` с явными `--ref` и `--dest`.
Для обновления сначала изучить diff источника и затем заменить только выбранный
каталог; не обновлять весь набор автоматически.

`.agents/` уже исключён существующим `.gitignore`: навыки остаются локальными
на этой машине. `.gitignore` не менялся. Этот каталог источников находится в
`docs/`, чтобы инструкции по восстановлению набора можно было сохранить вместе
с ТЗ; перенос навыков в Git требует отдельного решения.
