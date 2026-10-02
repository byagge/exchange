# Exchange — Telegram Crypto Exchange

Полная платформа: **Telegram-бот + Mini App + Admin + workers**.  
Бренд: **Exchange** (временный).

## Что умеет

- Уникальные депозитные адреса **TON** и **TRC20 USDT** на каждого пользователя
- Автозачисление 1:1 (сколько пришло — столько на баланс)
- Пополнение чеками **CryptoBot / @send** (Telethon-сессия)
- Внутренний ledger: `available` / `locked` / `referral`
- Обмен USDT→RUB (очередь оператора в админке) и автовывод CryptoBot / on-chain
- Auto-sweep на master-кошелёк по порогу из админки
- Лояльность, рефералка, бан / лимиты / freeze выводов

## Стек

| Слой | Технологии |
|------|------------|
| API | NestJS, Prisma, SQLite (local) / Postgres (prod), Redis+BullMQ, JWT |
| Bot | grammY |
| Mini App | React 19, Vite, Framer Motion, Telegram WebApp |
| Admin | Next.js 15 |
| Worker | BullMQ + Telethon (`kb_session`) |
| Money | integer micros (USDT × 1 000 000) |

## Быстрый старт (local)

### 1. Env

```bash
cp .env.example .env
```

По умолчанию используется SQLite:

```env
DATABASE_URL=file:C:/exdb/dev.db
```

> Путь без пробелов надёжнее (каталог проекта `exchange crypto` содержит пробел).  
> Скопируйте `packages/db/prisma/dev.db` в `C:\exdb\dev.db` после первого `db push`, либо укажите свой абсолютный путь.

### 2. Установка пакетов

Из-за объёма зависимостей ставьте по приложениям (или один раз из корня, если хватает RAM):

```bash
cd packages/shared && npm install && npx tsc -p tsconfig.json
cd ../db && npm install && npx prisma generate && npx prisma db push && npx tsx prisma/seed.ts && npx tsc -p tsconfig.json
cd ../../apps/api && npm install
cd ../bot && npm install
cd ../worker && npm install
cd ../miniapp && npm install
cd ../admin && npm install
```

### 3. Запуск API (рекомендуемый способ)

`tsx` не эмитит Nest decorator metadata — для API используйте сборку:

```bash
cd apps/api
npm run build
npm run start
```

Health: http://localhost:3001/api/health

### 4. Остальные сервисы

```bash
# отдельные терминалы
npm run dev -w @exchange/miniapp   # http://localhost:5173/?dev=1001
npm run dev -w @exchange/admin     # http://localhost:3000
npm run dev -w @exchange/bot       # нужен BOT_TOKEN
npm run dev -w @exchange/worker    # нужен Redis для очередей
```

### 5. Smoke

```bash
node scripts/smoke.mjs
```

Покрывает: auth → wallets → simulate deposit → exchange → admin fulfill.

## Доступы

| | |
|--|--|
| Admin | `admin@exchange.local` / `ChangeMe123!` |
| Mini App (dev) | http://localhost:5173/?dev=1001&user=demo |
| API | http://localhost:3001/api |

## Postgres (production)

1. `docker compose up -d` (Postgres + Redis)
2. В `packages/db/prisma/schema.prisma` смените `provider` на `postgresql`
3. `DATABASE_URL=postgresql://exchange:exchange@localhost:5432/exchange`
4. `npx prisma db push && npx tsx prisma/seed.ts`

## CryptoBot session

```bash
cd apps/worker/kb_session
pip install -r requirements.txt
# TELEGRAM_API_ID / TELEGRAM_API_HASH / CRYPTOBOT_SESSION в .env
```

Скрипт: `activate_check.py <check_url>` → JSON `{ ok, amount }`.

## Структура

```
apps/api       NestJS API
apps/bot       Telegram bot + WebApp button
apps/miniapp   Apple-style Mini App
apps/admin     Admin panel
apps/worker    deposits / payouts / sweep / cryptobot / notify
packages/db    Prisma schema + client
packages/shared money utils, zod, theme.css
scripts/smoke.mjs
```

## Админка

Dashboard · Users (ban/freeze) · Orders (fulfill/reject RUB) · Deposits · Withdrawals · Wallets/Sweep · Settings (rate, fees, bot text, maintenance)

## Безопасность

- Ключи депозитных кошельков: AES-256-GCM (`ENCRYPTION_KEY`)
- Telegram `initData` HMAC (или `dev:<id>:<user>` в local)
- Admin JWT + audit log
- Идемпотентность депозитов по `txHash` / `checkId`

## Production checklist

1. Реальные HD mnemonic + TON/Tron API keys  
2. Реальный on-chain send в sweep/payout workers  
3. `BOT_TOKEN`, HTTPS `WEBAPP_URL`, CORS  
4. Сменить `JWT_SECRET`, `ADMIN_PASSWORD`, `ENCRYPTION_KEY`  
5. Master-адреса и sweep threshold в админке  
6. Redis обязателен для фоновых джоб
