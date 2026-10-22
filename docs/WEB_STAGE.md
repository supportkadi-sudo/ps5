# Web/PWA stage — review guide

## Run

Node 24: `cd frontend && npm ci && npm run dev`. Open the address printed by Vite. For production preview: `npm run build && npx vite preview --host 0.0.0.0`.

Accounts: owner / cashier / manager, password `demo`. All identities and payments are fixtures; sandbox data stays in this browser's localStorage. Logging out does not clear it. Clear site data to reset. This is not production auth or a deployable cashier system.

## Modules

- contracts/openapi.json: versioned REST DTOs and commands; generated schema.d.ts.
- shared/api: typed interface, future HTTP adapter, mock command boundary; mock calculations never imported by UI.
- features/accounts: timer, goods, reasoned removal, precheck, split payment, explicit close, bill audit.
- features/shifts: opening/closing count, expense, expected cash, handover.
- features/admin: catalog, batch receipts/adjustments, tariff/booth config, extensible methods, owner role editing, review QR.
- features/reports: date-filtered prototype report and append-only demo audit. Period queries use the report API; club timezone is Asia/Tashkent.
- app: login, navigation, role views, connection state. Service worker only caches app shell; never API or auth responses.

## Review workflow

1. Login owner, open shift with 100000 UZS.
2. Create account in booth 01: verify no timer starts. Start explicitly.
3. Add Coca-Cola; remove with reason; inspect FIFO batch restoration and bill history.
4. Add goods worth over 20000, precheck, accept 20000 using fixture P2P t1 plus remaining cash. Full payment keeps awaiting status. Close explicitly.
5. Inspect revenue vs accepted payments and FIFO COGS. Record cash expense, close shift with discrepancy and reason. Start next shift with active account and inspect handover.
6. Login cashier: no catalog/settings/reports, costs hidden; API permission checks reject writes.
7. Toggle browser offline: visible warning and blocked mutations. Reload installed PWA only after initial online load; data is still demo, not server confirmed.
8. Change tariffs/products and verify previous snapshots stay intact; add custom payment method; edit review URL and print QR.

## Checks

`npm run generate:api`, `npm test`, `npm run build`, `npx playwright test`, `git diff --check`. CI checks schema generation drift, unit use cases, desktop/mobile browser journeys. Browser installation: `npx playwright install --with-deps chromium`.

## Deliberate limits / backend handoff

No real Django/database, secure authentication, P2P provider, refund, immutable DB audit, server offline synchronization, or production deployment in this stage. Production amounts, permissions, transactions, timestamps and status checks must be implemented server-side. Mock localStorage data is readable/editable by browser owner. Mock idempotency is process-local and exercises API behavior; PostgreSQL must make it durable and transactional. Audit snapshots are demo before/after aggregate snapshots, not a production storage strategy.

Time rounding, partial-payment edits, refund permissions and offline policy proposals are in API_CONTRACT.md. Don't turn them silently into production behavior. Paginated server history is a backend integration follow-up. Settings support role editing of three fixtures; provisioning real employees/passwords belongs to secure backend auth.

Rollback: discard the feature branch / revert stage commit. No migrations or production data changes exist.

## Review fixes

See [REVIEW.md](REVIEW.md) for confirmed defects, regression checks and remaining security boundaries. Stored demo data and commands are validated against OpenAPI at runtime. Corrupt/blocked storage is reported at login without deleting records. Use a single demo tab; detected stale-tab writes are blocked, but localStorage is not a transactional multi-user database. Inventory adjustments only decrease available quantity; increases require a receipt.

## Обновлённый дизайн

Светлая тема, мобильная нижняя навигация и полный каталог экранов: [VISUAL_REVIEW.md](VISUAL_REVIEW.md). Все снимки: [screenshots/redesign/README.md](screenshots/redesign/README.md).
