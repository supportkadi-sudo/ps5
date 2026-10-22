> Актуальный онлайн-этап: [запуск, реальные E2E и ограничения](ONLINE_MVP.md). HTTP/Django используется по умолчанию; mock только через VITE_API_MODE=mock. Старые результаты ниже относятся к предыдущим этапам.

# Django/PostgreSQL — первый серверный кассовый срез

Зависимость: PR #2, `feat/crm-web-mock`, исходный head `403b90a9`. Эта ветка добавляет backend поверх него; ветка PR #2 не меняется. Не сливать и не развёртывать автоматически. Это проверяемый серверный срез, а не заявление о готовности всей CRM к эксплуатации.

## Локальный запуск

Python 3.12+, PostgreSQL 16. Redis/Celery нет. Из корня репозитория:

```sh
cp .env.example .env
# Заменить оба значения replace-with... в .env; DEBUG=1 только для localhost.
docker compose up -d db
docker compose build api
docker compose run --rm api python manage.py migrate --noinput
docker compose run --rm api python manage.py create_employee owner --role owner
docker compose run --rm api python manage.py create_employee cashier --role cashier
docker compose up -d api
```

Пароли вводятся интерактивно, проверяются стандартными Django password validators и хешируются. Нет seed/demo-паролей, автоматического суперпользователя или доверия роли из запроса. Owner/manager/cashier — персональные Django users. Django Admin не включён; защищённый HTTP employee API описан ниже. CLI нужен для bootstrap. Отключение пользователя: `is_active=False` через доверенный Django management shell; существующая сессия перестаёт авторизовываться.

`GET /health` — процесс жив. `GET /ready` — PostgreSQL доступен и все миграции применены, иначе 503. `GET /api/v1/schema` — OpenAPI (после входа). API доступен на `http://localhost:8000` и опубликован только на loopback. Compose не запускает миграции автоматически и не публикует порт БД.

Для запуска без Docker: установить `backend/requirements.txt`, передать переменные из `.env.example`, указать `POSTGRES_HOST/PORT` локальной БД и выполнить те же `manage.py` команды из `backend`. Django не читает `.env` сам; Compose передаёт её в окружение. `DJANGO_DEBUG=0` по умолчанию: secure cookies, HttpOnly session, SameSite=Lax; для реального сервера нужен HTTPS. Login/logout защищены CSRF; login вращает токен, сессии хранятся в БД.

## Проверяемый HTTP-сценарий

Все пути ниже имеют префикс `/api/v1`. JSON; session cookie плюс `X-CSRFToken`. Каждая доменная POST-команда требует новый UUID `Idempotency-Key`; при сетевой ошибке повторять **тот же ключ и тело**, включая expectedVersion.

1. `GET /auth/csrf`, затем `POST /auth/login` с username/password и полученным CSRF. Сохранить cookie и новый csrfToken ответа.
2. Owner/manager: `/club/tariffs` (`tariff: {id:"",name:"PS5",hourlyRate:60000}`), `/club/booths` (`booth: {id:"",name:"01",console:"PS5",tariffId,enabled:true}`), `/catalog/products` (`product: {id:"",name:"Cola",category:"Bar",salePrice:15000,defaultCost:8000,enabled:true}`), `/settings/payment-methods` (`method:{id:"",name:"Наличные",kind:"cash",enabled:true}`). Повторить для другого реально принятого метода `other`; P2P без источника принять нельзя.
3. `/inventory/receipts`: `{productId,quantity:10,unitCost:8000}`. Не передавать остаток/цену продажи со стороны кассира.
4. Кассир: `/shifts/open`: `{openingCash:100000}`. `/accounts`: `{boothId,customerName:"",customerPhone:""}`. Черновик не запускает время.
5. `/accounts/{id}/start`: `{expectedVersion:1}`; `/accounts/{id}/lines`: `{expectedVersion:2,productId,quantity:1}`.
6. `/accounts/{id}/precheck`: `{expectedVersion:3}` — завершает сегмент, статус awaiting_payment. Итог получить через `GET /workspace`.
7. `/accounts/{id}/payments`: `{expectedVersion:4,methodId,amount:10000,transferId:"",confirmedByCashier:true}`. Остаток принять следующей командой с новой актуальной version; переплата запрещена. Счёт остаётся awaiting_payment даже при полной оплате.
8. `/accounts/{id}/close`: `{expectedVersion:<актуальная>}` — отдельное явное действие, только после полной оплаты.
9. `/expenses`: `{scope:"shift",amount:5000,category:"Доставка",methodId,reason:"Оплачена доставка из кассы"}`. `/shifts/{id}/close`: `{actualCash:<пересчёт>,reason:<обязательно при расхождении>}`. Workspace возвращает expectedCash/actualCash/difference.

Команды возвращают небольшой `CommandResult {entityId,operation,version}`. Он сохраняется в БД вместе с результатом операции. Read model запрашивается отдельно; replay не возвращает старый Workspace с устаревшими правами/данными. Тест `test_real_session_csrf_login_logout` проверяет реальную сессионную авторизацию, не force_authenticate.

## Решения и инварианты

- Время: сумма микросекунд всех серверных сегментов → количество начатых минут (`ceil` один раз по сумме). Нет округления каждого сегмента; пауза/возобновление не теряет время. Стоимость игры — точное рациональное `минуты × тариф / 60`; она складывается с товарами и только итог округляется до 500, ничья вверх. `gameAmount` — целая отображаемая часть, её нельзя использовать для повторного расчёта total. Минимальной фиксированной платы нет. При 80 мин × 40000/ч + товар 10000 итог 63500. Клиентские timestamps не принимаются.
- Тариф фиксируется при создании счёта; цена и FIFO-себестоимость — при добавлении товара. Оплаты/расходы сохраняют kind метода: переименование/отключение метода не меняет кассовую историю. Изменять kind существующего метода нельзя.
- После любой частичной оплаты состав товаров менять нельзя. Возобновить время можно с сохранением оплат. Предчек не создаёт платёж. Закрытые счета неизменяемы обычными командами.
- Полный возврат: `POST /accounts/{id}/refund` с `{expectedVersion,reason,restockGoods}`; только manager/owner, открытая смена. Команда означает **фактическую выдачу денег**, подтверждённую сотрудником; это не банковский refund API. Возврат по исходным методам, отдельные Refund/PaymentReversal, оригинальные платежи и строки сохраняются. При restockGoods=true возвращаются точные исходные FIFO-партии. Повторный полный возврат запрещён. Частичные возвраты/смена метода возврата не реализованы. Статус становится cancelled, closedAt/finalTotal сохраняются; payments/paid в read model — первоначально принятые суммы, компенсация видна в аудите и отчёте.
- Одна физическая касса: partial unique constraint разрешает одну открытую смену. Закрытие смены не останавливает игровые интервалы; следующая смена забирает активные счета с ростом version и отдельным Handover аудитом. Каждая оплата относится к смене получения, каждый возврат — к смене выдачи.
- Порядок денежных блокировок: смена → счёт → товар → партии/перевод. Даже разные счета одной кассы сериализуются по смене: это простой намеренный выбор для одного кассира. FIFO сортируется по receivedAt, затем UUID как стабильный tie-breaker.
- Ключ уникален **по сотруднику во всех командах**, а не только endpoint. Advisory transaction lock сериализует первый запрос при ещё отсутствующей receipt; DB unique constraint — окончательная гарантия. Hash включает тело; endpoint включает имя операции и объект. Повтор с другим телом/операцией — 409. Неуспешная транзакция не оставляет ни receipt, ни денег, ни склада, ни аудита. Клиент не должен заменять конфликт новым ключом.
- Audit, stock movements, allocations, payments, expenses, refunds, reversals и receipts защищены PostgreSQL BEFORE UPDATE/DELETE trigger. Это защита от обычных SQL/ORM изменений, не от администратора БД. Production runtime role не должна иметь DDL/TRUNCATE/возможность отключить triggers; Compose использует локальную development DB role, не является production-ролевой схемой. Миграции выполняются отдельно привилегированной ролью.
- GET workspace/report использует единый read-only REPEATABLE READ snapshot. Кассир получает только свои смены/счета/расходы; себестоимости, партии и audit payload скрыты на сервере. Owner/manager видят все счета. Report недоступен кассиру.
- Отчёт: выручка и FIFO COGS признаются по дате закрытия; возврат уменьшает выручку в дату возврата и COGS только при возврате товара на склад. Поэтому период может быть отрицательным. paymentsByMethod — принятые деньги минус выданные возвраты, независимо от закрытия. productSales — **валовые продажи** закрытых счетов, компенсации не скрывают исходную продажу. Расход признаётся по дате записи; scope=club не уменьшает кассу смены. Даты включительно в Asia/Tashkent. Прибыль не равна кассовому остатку.

## P2P — граница, без подделки подтверждений

`payments.adapter.record_notification` сохраняет source+source_event_id уникально, amount и received_at; всегда status=unverified. Изменившийся повтор source event отклоняется. Нет публичного webhook, credentials или тестового live-подтверждения. Тест может создать verified_source исключительно внутри тестовой БД; runtime HTTP не умеет ставить этот статус. Фикстура verified_fixture не является допустимым состоянием DB.

Приём P2P требует trusted verified_source + evidence_reference, точную сумму, явное подтверждение кассира, блокировку строки и уникальную OneToOne связь Payment→Transfer. Одно уведомление нельзя использовать для двух счетов. Уведомление никогда не закрывает счёт.

Для следующего этапа нужны: подтверждённый источник/формат реальных club Telegram Business событий HUMO/Uzcard; проверка отправителя/подписи и полномочий доступа; стабильный source event ID; правила отмен/дублей/изменённых сообщений; обезличенные примеры и отдельные credentials вне git. Скриншот или совпадение суммы не заменяют источник. Пока этого нет, P2P остаётся неподтверждённым и платёж блокируется.

## Контракт и frontend — честная граница среза

`contracts/openapi.json` остаётся единственным источником DTO: DRF проверяет входы JSON Schema из него, `/schema` экспортирует тот же документ. Это **contract-first**, а не две параллельные serializer/schema модели. Все кассовые, employee и review endpoints реализованы; legacy mock DTO отделены от серверных request DTO. Тест проверяет все реальные URL, request schema и ack; response DTO проверяются интеграционными тестами; TS генерируется существующим openapi-typescript.

Frontend не подключён в этом PR: сохранена текущая демоверсия PR #2, изменён только генерируемый schema.d.ts. Контракт пока допускает Workspace (mock) или CommandResult (Django) на командных ответах. Для подключения отдельным связанным этапом:

1. HttpApi.execute валидирует CommandResult, проверяет operation/entityId и после успешного ack загружает workspace. При потере ответа/ошибке reload сохраняет прежнюю pending-команду и ключ; повтор безопасен. Не подменять ack локальным mock-состоянием.
2. Включить HttpApi вместо MockApi только явно выбранным API-режимом; отдельный origin/domain storage namespace. Оставить DEMO-индикатор только в mock-режиме. Публиковать web/API под одним HTTPS origin; для localhost Vite proxy /api на backend.
3. Серверный cashier read model не содержит партий/закупочных цен; UI остатков использовать Product.availableStock из API, не складывать усечённые batches. Employee/review UI переключить на настоящие endpoints с серверными DTO, version, reason и матрицей прав. Добавить UI возвратов/компенсаций и статусов P2P.
4. Сквозной browser test с настоящим login, CSRF, PostgreSQL, потерей ack, частичной оплатой, отдельным close и сверкой смены. Удалить mock-расчёты из production bundle/режима. Не включать offline mutations до отдельного согласованного протокола.

## Проверки и ограничения

Воспроизведение на отдельной **тестовой** БД (имя club; Django создаёт test_club):

```sh
docker compose run --rm api python manage.py check
docker compose run --rm api python manage.py makemigrations --check --dry-run
docker compose run --rm api python manage.py test tests --noinput -v 2
cd frontend
npm ci
npm run generate:api
npm run check:contract
npm test
npm run build
```

PostgreSQL role тестов должна иметь CREATEDB. CI `.github/workflows/backend.yml` запускает миграции на чистой PostgreSQL 16 и тесты; web CI проверяет DTO drift и прежнюю демоверсию. Локальная проверка и её фактические результаты — в `docs/REVIEW.md`.

Внешние/операционные этапы: production HTTPS/reverse proxy, применение production DB grants, backup/restore rehearsal на сервере, browser-интеграция с backend, real Telegram Business и offline-команды. Login rate limiting, employee/review API и пагинация реализованы ниже. Частичные возвраты и индивидуальные делегированные manager permissions остаются явно вне выбранной минимальной модели, без молчаливого изменения денежных правил. Не называем систему production-ready.

Rollback: до эксплуатации — остановить API и revert только backend commit; сохранить PostgreSQL volume. После появления финансовых данных — сначала backup, затем rollback приложения с сохранением схемы/данных или forward-fix. Не выполнять `migrate ... zero`, `down -v`, TRUNCATE или удаление receipts: это уничтожит историю и защиту повторов. Нет миграции/деплоя на реальном сервере.

## Серверное администрирование (PR #4, зависит от #3)

Настоящие POST `/access/users` (SaveUser, **SaveEmployee DTO**) и `/settings/review-links` (SaveReview, **SaveReviewLink DTO**) используют существующие маршруты, а не дублирующие CRUD. Старые SaveUser/SaveReview DTO сохраняются исключительно для mock PR #2; server request schema задана в OpenAPI и именно её загружает DRF validator. Не отправлять старую mock-команду на server endpoint.

SaveEmployee: `{user:{id:"",name,role,isActive:true},username,password,expectedVersion:0,reason}` создаёт персонального сотрудника. Для изменения указать настоящий id и актуальную version, убрать username/password. `GET /access/users` возвращает разрешённые записи с username/isActive/version, без credential hashes. Manager создаёт/меняет/отключает **только cashier**, не может назначить management role или затронуть owner/manager; owner управляет всеми. Нельзя убрать последнего активного owner, отключить сотрудника с открытой сменой. Это зафиксированная минимальная матрица, без скрытых делегированных полномочий.

`POST /access/users/{id}/password` с `{expectedVersion,password,reason}` — reset в рамках той же матрицы. `POST /auth/password` с `{expectedVersion,oldPassword,newPassword,reason}` — смена собственного пароля любой ролью с проверкой старого. Django validators обязательны, plaintext/hash не возвращается и не аудируется. Все старые сессии целевого пользователя становятся недействительны, включая собственную после смены; войти заново с новым паролем. Credential command hashes — HMAC с постоянным COMMAND_HASH_KEY (по умолчанию SECRET_KEY); не менять этот ключ без плана сверки pending credential-команд. Не складывать password-команды в frontend localStorage outbox.

Все административные изменения транзакционны с аудитом, optimistic version и durable receipts. Общий PostgreSQL authorization read/write gate не даёт отключению/смене роли обогнать незавершённую денежную команду. Параллельные role changes сериализуются; последний owner сохраняется. CLI create_employee предназначен для доверенного bootstrap и тоже создаёт безопасный BootstrapEmployee audit без password/hash.

SaveReviewLink: `{review:{id:"",name,url:"https://...",enabled:true},expectedVersion:0,reason}`; изменение — тот же id с version. Только owner/manager. `GET /settings/review-links` — список; `GET /settings/review-links/{id}/qr` — SVG QR для печати, только enabled записи, без удалённой загрузки URL. URL валидируется как HTTPS, QR содержит ровно ссылку. Нет скидок/бонусов и публичного редиректа. Отключение сохраняет запись/аудит. Workspace возвращает действующие ссылки.

Login имеет PostgreSQL rate limiting без Redis: LOGIN_RATE_LIMIT=5 неуспешных/пока незавершённых попыток в LOGIN_RATE_WINDOW_SECONDS=300, одновременно по нормализованному username и REMOTE_ADDR. Успех освобождает только собственную попытку и не стирает другие ошибки; истечение окна восстанавливает доступ. Отказ — 429 с Retry-After; новая worker-инстанция использует те же DB counters. X-Forwarded-For от клиента не считается доверенным. За reverse proxy настроить дополнительное edge rate limiting и корректное происхождение IP; не доверять произвольным forwarding headers. Старые LoginBucket можно удалять оператором после истечения окна, финансовые receipts/audit удалять нельзя.

Production настройки: DEBUG=0, случайный SECRET_KEY минимум 32 символа (placeholder/короткий key отклоняется), явные ALLOWED_HOSTS без `*`, HTTPS origin в CSRF_TRUSTED_ORIGINS, secure/HttpOnly/SameSite cookies. SECURE_SSL_REDIRECT включать на TLS termination слое с корректно доверенным proxy, без доверия клиентскому X-Forwarded-Proto. Development Compose остаётся loopback-only, DEBUG=1 пример не production-конфигурация.

DB: отдельный migration owner и runtime LOGIN role; последнему только CONNECT, USAGE schema, SELECT/INSERT/UPDATE/DELETE на нужные operational tables и sequences, без SUPERUSER/CREATEDB/CREATEROLE/DDL/TRUNCATE и владения таблицами. На append-only таблицах дополнительно не выдавать UPDATE/DELETE; triggers сохраняются. Django auth/session таблицам нужны штатные DML права. Test role отдельно CREATEDB. Backup: регулярный `pg_dump --format=custom`, шифрование вне хоста, retention и проверка `pg_restore` на отдельной БД с запуском migrations/readiness и сверкой платежей/кассы. Backup/restore rehearsal на реальном сервере и TLS остаются отдельной операционной проверкой.


## История и сверка (следующий последовательный PR после #4)

`GET /accounts`, `/shifts`, `/payments`, `/expenses`, `/audit`, `/refunds`, `/transfers`, `/inventory/batches` возвращают `{items,nextCursor}`. Limit 1–100 (по умолчанию 50). Порядок — timestamp DESC, UUID DESC; индексы соответствуют сортировке и shift scopes. Cursor подписан, действует 24 часа и привязан к сотруднику, текущей роли, виду истории и фильтрам. Нельзя переносить его на другой endpoint, роль, пользователя или иной accountId/shiftId. `nextCursor=null` завершает выборку. Страницы задают верхнюю временную границу первого запроса и keyset, а не смещающийся offset; новые обычные записи не сдвигают страницы. Это не долгоживущий DB snapshot между HTTP-запросами: поздний commit с более ранним timestamp можно увидеть после refresh.

Фильтры: accounts — shiftId/status; payments/refunds — accountId/shiftId; expenses — shiftId; audit — entityId; batches — productId. Неверные UUID, cursor, limit и неизвестные параметры — 400. Права фильтрами не расширяются. Cashier видит account history по принадлежащей смене и платежи/расходы/возвраты своей кассы; owner/manager — все. Audit и закупочные партии доступны только management. `GET /accounts/{id}` возвращает полный scoped счёт с исходными payments и отдельным optional refund (причина, исходные payment IDs, issuing shift и restockGoods). Чужой счёт — 404; прямой POST в read-only историю — 405.

Workspace — рабочая проекция: все активные scoped счета + последние 50 завершённых, последние 20 смен, 50 расходов, 50 audit events, 100 партий и 100 разрешённых transfers. Это серверные пределы, не полный журнал. Продолжение и старые записи получать через page endpoints; source of truth остаётся полная PostgreSQL история. Product.availableStock считается по всем партиям на сервере, независимо от усечённых batch rows. Shift.paymentsByMethod / expensesByMethod / refundsByMethod также используют все операции смены, а не страницу. Суммы received/spent/refunded разделены; expectedCash по-прежнему opening + cash received − cash expenses − cash refunds. Кассиру не раскрываются COGS и audit payload. Workspace.report management показывает текущую локальную дату; для другого периода использовать уже существующий `/reports?from=...&to=...`, не пересчитывать по workspace.

Аудит дополнительных инвариантов: money() отклоняет bool/float и значения вне JS safe range; PostgreSQL CHECK constraints ограничивают сохранённые суммы/себестоимости и положительность payment/expense/notification/reversal. Расхождение смены тоже проверяется на переполнение **до** закрытия. Неизвестный id при обновлении каталога даёт 404, не создаёт новую сущность. Notification adapter проверяет положительный integer amount, непустые bounded source/event_id, aware timestamp; конкурентный одинаковый source_event_id создаёт одну unverified запись, изменившийся payload конфликтует. Нет фиктивного webhook и отсутствует публичная установка verified_source.

Финансовые допущения сохранены: minute-ceil по сумме интервалов, одно округление счёта до 500 с ничьей вверх; edits после первой оплаты запрещены; только полный возврат по исходным методам с причиной и явным restockGoods. Возврат без restock не восстанавливает товар и не уменьшает COGS. Эти ограничения — выбранная модель первого серверного этапа, не обещание частичных банковских refund API.

CI дополнительно проверяет Docker Compose config, собирает API image и запускает Gunicorn readiness against test PostgreSQL. Это тестовый container smoke, не проверка production сервера или frontend/backend browser journey. Полная цепочка: #2 (mock web) → #3 (касса + review fixes) → #4 (администрирование) → history/сверка PR. Ни один автоматически не сливается. После merge предшественника retarget следующего на main и повторные затронутые проверки обязательны.
