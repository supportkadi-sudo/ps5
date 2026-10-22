# Онлайн-MVP: запуск и проверка

Рабочая версия использует Django/PostgreSQL, персональные логины, session cookies и CSRF. `VITE_API_MODE=http` — режим по умолчанию; `mock` включается только явно для старых демонстрационных тестов. Не включайте mock на кассовом месте. В онлайн-режиме нет базы/финансовых команд в localStorage, mock fallback или offline-очереди.

## Демонстрация на отдельной машине

Цепочка открытых PR: #2 → #3 → #4 → #5 → PR онлайн-MVP. До их слияния используйте ветку `feat/online-mvp`. Настроенного staging/deployment в репозитории нет; production не изменяется.

```bash
git clone https://github.com/supportkadi-sudo/ps5.git
cd ps5
git switch feat/online-mvp
cp .env.example .env
```

В `.env` замените оба placeholder секрета случайными значениями. Например, дважды выполните `python -c 'import secrets; print(secrets.token_urlsafe(48))'`. Пароли не добавляйте в git. Оставьте отдельную БД `club_demo`. Данные этой БД искусственные; не подключайте её к реальной кассе или банковскому источнику.

```bash
docker compose up -d db
docker compose build api web
docker compose run --rm api python manage.py migrate --noinput
docker compose run --rm api python manage.py create_employee club-owner --role owner
# Команда запрашивает пароль интерактивно, не в аргументах/логах.
docker compose run --rm -e ENABLE_DEMO_SEED=1 api python manage.py seed_demo --owner club-owner
docker compose up -d api web
curl --fail http://127.0.0.1:8000/ready
```

Открыть **http://localhost:8080**. Войти созданным owner, создать персонального кассира в Настройки → Сотрудники. Сид создаёт шесть кабинок, тарифы 40/50/60 тыс., два ручных способа оплаты и две позиции с партиями. Он не создаёт пользователей/пароли, платежи или подтверждённые переводы. Повтор на непустом каталоге отклоняется.

Для доступа с телефона используйте только согласованный demo/staging-хост: HTTPS reverse proxy к web:8080, `DJANGO_DEBUG=0`, явный домен в `DJANGO_ALLOWED_HOSTS`, HTTPS origin в `CSRF_TRUSTED_ORIGINS`, затем пересоздайте api. `WEB_BIND_ADDRESS` по умолчанию loopback; не открывайте публично DEBUG-сборку. PostgreSQL не публикуется. Браузер и API должны иметь один origin; nginx проксирует `/api/`.

## Разработка без Docker

Python 3.12+, PostgreSQL 16 и Node 22. Создайте отдельную БД, экспортируйте значения из настроенного `.env`, переопределите `POSTGRES_HOST=127.0.0.1`, `POSTGRES_PORT` и `CSRF_TRUSTED_ORIGINS=http://127.0.0.1:4173`.

```bash
python -m pip install -r backend/requirements.txt
python backend/manage.py migrate --noinput
python backend/manage.py create_employee club-owner --role owner
python backend/manage.py runserver 127.0.0.1:8000 --noreload
# Второй терминал
cd frontend
npm ci
VITE_API_MODE=http npm run dev -- --host 127.0.0.1 --port 4173
```

Vite проксирует API на 127.0.0.1:8000; `API_PROXY_TARGET` меняет только dev target.

## Повторы, история и ошибки

Финансовая команда сначала сохраняется в PostgreSQL в actor-scoped retry slot, затем выполняется с неизменными UUID/телом. Потерянный ответ, 409, 5xx и некорректное подтверждение сохраняют слот. Повтор после входа/перезагрузки читает исходную команду с сервера; новая команда не заменяет её. Подтверждённый `CommandResult` проверяется, затем перечитывается workspace. Не очищайте конфликт новым UUID: проверьте счёт/аудит. Слот не является offline-очередью и не исполняет команды сам.

Команды сотрудников с паролем остаются только в памяти редактора до ответа; при неоднозначном ответе повтор сохраняет UUID и тело, редактирование не заменяет запрос. Не закрывайте этот редактор до сверки. Пароли не пишутся в pending slots, audit/receipts или browser storage. После обновления страницы повторно войдите; финансовый pending восстановится с сервера.

Workspace ограничен: это рабочее место, не полный журнал. История счетов, аудит (включая фильтр entityId), смены, расходы и партии читаются страницами. Детали счёта загружаются отдельным запросом. Остатки берутся из `availableStock`, сверка из `expectedCash` и server method totals. Себестоимость скрывает backend для cashier. При недоступности API показывается ошибка; данные не подменяются локальными.

## Воспроизводимые проверки

```bash
cd backend
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py migrate --noinput
python manage.py test tests --noinput -v 2
cd ../frontend
npm ci
npm run check:contract
npm test
npm run build
npx playwright install chromium
```

Реальные E2E требуют **отдельной пустой БД `club_e2e`**, переменных PostgreSQL и DEBUG/CSRF origin из раздела разработки. Запустить Django на 127.0.0.1:8000 с этой БД, затем:

```bash
POSTGRES_DB=club_e2e python backend/manage.py migrate --noinput
POSTGRES_DB=club_e2e python scripts/seed-e2e.py
cd frontend
npx playwright test --config playwright.online.config.ts
```

`seed-e2e.py` отказывается работать вне `*_e2e`; тестовый пароль известен намеренно, поэтому эту БД/пользователя нельзя использовать для демонстрации с реальными деньгами. Два сценария на desktop и Pixel 7: UI-настройка owner, касса/FIFO/предчек/части оплаты/явное закрытие/расход/потерянный ответ/reload/сверка/история; отдельные реальные параллельные HTTP-запросы за последний stock и двойную оплату с проверкой backend 403. Старые mock E2E запускаются отдельно через `playwright.config.ts` и не доказывают интеграцию.

## Сброс только искусственных данных

Для тестов Django создаёт и удаляет `test_<POSTGRES_DB>` самостоятельно. Для новой демонстрации безопаснее остановить demo Compose и создать **новую** отдельную БД `club_demo_2` (для seed используйте имя с суффиксом `_demo`, например `club2_demo`), изменить `POSTGRES_DB`, выполнить migrate, создать owner и seed. Старую БД сохраните. Не используйте `down -v`, `flush`, `migrate zero` или TRUNCATE на данных клуба. `seed_demo` ничего не сбрасывает.

Для повторного E2E создайте новую пустую `*_e2e` БД и укажите её в окружении API и seed. Нельзя повторять комплект на уже незакрытой тестовой смене: это корректно отклоняется сервером.

## Ограничения

- **P2P выключен в online UI.** В репозитории есть только adapter boundary для unverified уведомлений. Нет подтверждённого интерфейса/формата реального источника клуба, данных его Telegram Business подключения, credentials и способа доказать происхождение/редактирование события. Публичный «production webhook» не создан. Нужны согласованные source identity, event ID, amount/date и authenticated delivery. Один перевод защищён уникальной связью с платежом; уведомление не закрывает счёт.
- Офлайн, бронирование и native Android/iOS не входят в этот этап. Потеря сети блокирует изменения. Физический телефон/клавиатура, принтер и стабильность интернета клуба проверяются на месте.
- Возврат backend — полный компенсирующий возврат, с причиной и явным решением по restock; банковский refund API и частичный возврат не реализованы. История показывает исходные оплаты и компенсации.
- До реального денежного пилота на staging нужны HTTPS, собственные пароли, проверка backup/restore и сверка начальных остатков. Локальные тесты не заменяют 2–3 дня наблюдения в клубе.

## Ручная проверка на 2–3 дня

1. День 1: owner проверяет тарифы/цены/остатки; кассир открывает смену, проводит 3–5 искусственных счетов. Проверить черновик без таймера, запуск, удаление с причиной, предчек и несколько частей оплаты. Сравнить итог с ручным расчётом.
2. День 2: проверить два браузера, краткий обрыв сети и исходный повтор. Убедиться, что нет дублей платежей/расходов, чужой кассир не принимает операции, cashier не меняет каталог. В конце сверить наличные и расходы, записать расхождение с причиной.
3. День 3: owner проверяет историю, кассира/смену, время, удалённые товары, оплаты и аудит. Повторить закрытие/новую смену. Зафиксировать экран, время, ID счёта и действие для каждого сбоя; не обходить конфликт новым платежом. Только после этого решать о денежном пилоте.
