# Quasar Backend — документация и план переезда на домен + TLS

> Документ для разработчиков и ИИ-агентов. Две части:
> **I** — как устроен бэкенд, **II** — пошаговая инструкция «купили домен → что делать»
> (nginx, TLS, скины, совместимость старых клиентов), **III** — перенос бэкенда
> на новую VDS вместе с покупкой домена.
> Смежный документ: [launcher.md](./launcher.md) — клиентская часть.

## Содержание

- [Часть I. Документация бэкенда](#часть-i-документация-бэкенда)
  - [Что это и стек](#что-это-и-стек)
  - [Структура](#структура)
  - [Конфигурация (.env)](#конфигурация-env)
  - [Модель данных (Prisma)](#модель-данных-prisma)
  - [HTTP API](#http-api)
  - [Yggdrasil-сервер (authlib-injector)](#yggdrasil-сервер-authlib-injector)
  - [Rate-limiting и безопасность](#rate-limiting-и-безопасность)
  - [Обновление лаунчера через GitHub Releases](#обновление-лаунчера-через-github-releases)
  - [Деплой на VDS](#деплой-на-vds)
- [Часть II. Переезд на домен: nginx + TLS](#часть-ii-переезд-на-домен-nginx--tls)
  - [0. Что меняется концептуально](#0-что-меняется-концептуально)
  - [1. DNS](#1-dns)
  - [2. Nginx + TLS](#2-nginx--tls)
  - [3. Firewall](#3-firewall)
  - [4. .env бэкенда](#4-env-бэкенда)
  - [5. Правки в коде (захардкоженный IP)](#5-правки-в-коде-захардкоженный-ip)
  - [6. Клиент лаунчера](#6-клиент-лаунчера)
  - [7. Выпуск релиза и обратная совместимость](#7-выпуск-релиза-и-обратная-совместимость)
  - [8. Чек-лист проверки после переезда](#8-чек-лист-проверки-после-переезда)
  - [9. Переезд бэкенда на другую VDS (+ домен)](#9-переезд-бэкенда-на-другую-vds--домен)
  - [10. Что можно сделать потом (не обязательно)](#10-что-можно-сделать-потом-не-обязательно)

---

# Часть I. Документация бэкенда

## Что это и стек

HTTP-сервер аккаунтов/контента для Quasar Launcher: регистрация/логин, JWT-сессии,
Yggdrasil-сервер для Minecraft (authlib-injector), хранилище скинов, манифест модов,
проксирование обновлений лаунчера из GitHub Releases.

Стек: **Node.js 20+**, **Express 4**, **Prisma 6** + **PostgreSQL**,
**zod** (валидация env/тел), **helmet**, **express-rate-limit**, **bcryptjs**,
**jsonwebtoken**, **sharp** (обработка скинов).

Скрипты (`backend/package.json`): `npm run dev` (tsx watch), `build` (tsc → dist/),
`start` (node dist/src/index.js), `prisma:generate|migrate|deploy`, `seed`.

## Структура

```
backend/
├── src/
│   ├── index.ts            # сборка app: helmet/cors/json/limiters, роутеры, graceful shutdown
│   ├── config.ts           # zod-валидация .env (падение при старте, если криво)
│   ├── db.ts               # PrismaClient
│   ├── ensureDb.ts         # авто-создание БД + prisma migrate deploy при старте (AUTO_MIGRATE)
│   ├── middleware/         # auth.ts (JWT), error.ts, rateLimit.ts
│   ├── routes/             # auth, skin, mods, texture, launcher, yggdrasil
│   └── utils/              # asyncRoute, errors, skin (sharp-обработка), yggdrasil (ключи/сигнатуры)
├── prisma/schema.prisma    # 6 моделей (ниже)
├── deploy-скрипты: ../deploy/
│   ├── vds-prepare.sh      # подготовка VDS: postgres, БД, пользователь, .env, systemd
│   ├── quasar-backend.service  # юнит systemd (порт 3000, EnvironmentFile=.env)
│   └── release.yml         # копия CI-воркфлоу (справочная)
└── .env.example
```

## Конфигурация (.env)

Все переменные валидируются `config.ts` при старте (невалидные → процесс падает сразу):

| Переменная | Смысл |
|---|---|
| `DATABASE_URL` | PostgreSQL: `postgresql://quasar:<пароль>@localhost:5432/quasar` |
| `PORT` | Порт (3000) |
| `NODE_ENV` | development / production |
| `JWT_SECRET` | **Минимум 32 символа**. Генерация: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | TTL JWT (12h) |
| `CLIENT_HASH` | Эталонный хэш клиента; пусто = проверка на логине отключена |
| `CORS_ORIGIN` | Список origins через запятую или `*` |
| `PUBLIC_API_ROOT` | **Публичный корень API**, который сервер называет наружу — должен совпадать с тем, что передаётся `-javaagent:authlib-injector.jar=...`. См. раздел про переезд |
| `YGG_TOKEN_TTL_HOURS` | Время жизни Yggdrasil accessToken (24 ч) |
| `GITHUB_REPO` | Репозиторий релизов лаунчера |
| `GITHUB_TOKEN` | Пат GitHub (Contents: Read) — без него `/api/launcher/*` отдаёт 503 |

При старте (если `AUTO_MIGRATE != false`) автоматически: создание БД, если нет,
и `prisma migrate deploy`. Т.е. деплой = `git pull && npm ci && npm run build && systemctl restart`.

## Модель данных (Prisma)

| Модель | Назначение |
|---|---|
| `User` | id (uuid), username (unique, 16), passwordHash (bcrypt), связи |
| `Session` | Одна на юзера (unique userId): JWT-токен, expiresAt, clientHash |
| `Skin` | Одна на юзера: image_data (bytes), textureHash, resolution, modelType (SLIM/CLASSIC) |
| `YggToken` | Одноразовые игровые accessToken (id = сам токен), TTL из env |
| `Setting` | key-value сервера; RSA-пара сигнатур хранится здесь |
| `ModManifest` | required/optional моды: fileName (unique), sha256Hash, githubUrl, downloadUrl |

## HTTP API

Заголовки ответов ошибок: JSON `{error: "КОД", message?: string}`. Коды важные
клиенту: `INVALID_CREDENTIALS`, `USERNAME_TAKEN`, `SERVER_ERROR`, `RATE_LIMITED`,
`UPDATER_NOT_CONFIGURED`, `GITHUB_ERROR`, `NO_UPDATE`.

| Метод и путь | Auth | Что делает |
|---|---|---|
| `GET /api/health` | — | `{ok, uptime}` |
| `POST /api/register` | — | создание аккаунта (лимитер auth) |
| `POST /api/login` | — | JWT-сессия; тело: `{username, password, clientHash}`; старые сессии юзера заменяются |
| `POST /api/yggdrasil-token` | JWT | одноразовый игровой accessToken (старый аннулируется) |
| `GET /api/mods` | — | `{required: [...], optional: [...]}` из ModManifest |
| `GET /api/manifest?files=mods` | — | `{files: [{path, sha256}]}` — эталон верификации |
| `POST /api/skin/upload` | JWT | base64 PNG + modelType; sharp валидирует/нормализует (64x/128x/256x, лимит размера) |
| `GET /api/skin/:userId` | JWT | `{image, modelType, resolution}` или 404 |
| `GET /api/texture/:hash` | — | PNG текстуры по хэшу (для properties скина в Yggdrasil) |
| `GET /api/launcher/latest` | — | прокси GitHub Releases: `{version, notes, size}` / `{version: null}` |
| `GET /api/launcher/download` | — | стриминг `QuasarLauncher.exe` с GitHub (Accept: octet-stream, asset id) |

## Yggdrasil-сервер (authlib-injector)

Маунтится **корнем** (не `/api`) — authlib-injector ожидает Yggdrasil-корень ровно
по адресу, который передан в `-javaagent:...={root}`:

| Путь | Назначение |
|---|---|
| `GET /` | metadata: serverName, feature, **skinDomains**, signaturePublickey |
| `POST /authserver/authenticate|refresh|validate|invalidate` | заглушки по стандарту |
| `POST /sessionserver/session/minecraft/join` | join при входе на сервер |
| `GET /sessionserver/session/minecraft/hasJoined` | проверка сервером |
| `GET /sessionserver/session/minecraft/profile/:uuid` | профиль + properties (текстуры со ссылками на `/api/texture/:hash`) |
| `POST /api/profiles/minecraft` | профили по никам (batch) |
| `POST /minecraftservices/player/certificates` | ключи chat-signing (Bearer accessToken) |

Ключевая инвариантность: **`PUBLIC_API_ROOT` (env) == корень, переданный в
`-javaagent` на клиенте == origin, по которому доступны skinDomains**. Если они
разъедутся — игроки не смогут логиниться/показывать скины.

## Rate-limiting и безопасность

- `apiLimiter` на весь `/api`, отдельные: `authLimiter` (15/15 мин), `verifyLimiter`
  (120/мин, для Paper-плагина), `skinLimiter` (10/10 мин), `launcherLimiter`, `yggLimiter`.
- `app.set('trust proxy', 1)` — **важно за nginx** (иначе лимитеры забанят весь интернет).
- helmet, отключён `x-powered-by`, JSON-лимит 1mb, `cors` только GET/POST.
- Пароли — bcrypt; JWT хранится в БД (Session), сессия одна на юзера.

## Обновление лаунчера через GitHub Releases

Бэкенд не хранит exe: `/api/launcher/latest` и `/download` ходят в GitHub API
(`env.GITHUB_REPO` + `GITHUB_TOKEN`). Бинарник качается через asset id
(`Accept: application/octet-stream`) — `browser_download_url` не годится (HTML-страница).
CI собирает exe при пуше тега `v*` (см. [launcher.md](./launcher.md)) и кладёт в Release.

## Деплой на VDS

Текущая схема (скрипты в `deploy/`, сервер Ubuntu, systemd):

1. `vds-prepare.sh` — postgres, пользователь/БД `quasar`, каталог `/home/quasar-backend`,
   `.env`, node.
2. `quasar-backend.service`: `ExecStart=/usr/bin/node dist/src/index.js`,
   `EnvironmentFile=/home/quasar-backend/.env`, `Restart=always`. Слушает **0.0.0.0:3000**
   (без реверс-прокси — см. Часть II, надо закрыть).
3. Обновление: `cd /home/quasar-backend && git pull && npm ci && npm run build && systemctl restart quasar-backend`
   (миграции накатятся сами при старте).

---

# Часть II. Переезд на домен: nginx + TLS

> Сценарий: купили домен (пусть условно `api.quasar.example`), хотим HTTPS через
> nginx, корректные скины и плавный переезд игроков со старой сборки.

## 0. Что меняется концептуально

Сейчас всё живёт на голом IP: `http://139.100.234.146:3000`, эта строка вшита в:

1. Бэкенд `.env` → `PUBLIC_API_ROOT` (отдаётся в Yggdrasil-metadata и URL текстур скинов)
2. **Код бэкенда**: `skinDomains: ['139.100.234.146']` в `src/routes/yggdrasil.ts` (захардкожено!)
3. **Клиент Rust**: `api::api_base()` в `src-tauri/src/api.rs` (дефолт при отсутствии `QUASAR_API`)
4. **Клиент UI**: `API_BASE` в `ui/src/api.ts` (константа, на бэкенд UI напрямую не ходит, но держим в синхроне)
5. Плёночный сервер (fabric-mod/Paper): свой конфиг API-корня, если использует.

Итого переезд = 4 правки + nginx/TLS + релиз клиента. Порядок ниже подобран так,
чтобы **старые клиенты не отломались**.

## 1. DNS

- A-запись: `api.домен` → `139.100.234.146` (TTL поменьше, 300–600).
- Пока не резолвится глобально — не идти дальше (certbot не выпустит сертификат).

## 2. Nginx + TLS

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

`/etc/nginx/sites-available/quasar`:

```nginx
# редирект всего http -> https (кроме ACME, certbot сам подрежет)
server {
    listen 80;
    server_name api.домен;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name api.домен;

    # сертификаты появятся после certbot; сначала можно запустить certbot --nginx
    ssl_certificate     /etc/letsencrypt/live/api.домен/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.домен/privkey.pem;

    # скины/текстуры кэшируем в браузере и на прокси
    proxy_cache_path /var/cache/nginx/quasar levels=1:2 keys_zone=quasar:10m max_size=1g inactive=7d;

    location /api/texture/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_cache quasar;
        proxy_cache_valid 200 7d;
        add_header Cache-Control "public, max-age=604800";
    }

    # стриминг exe из GitHub через бэкенд: без буферизации
    location /api/launcher/download {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    # всё остальное API + Yggdrasil
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        client_max_body_size 2m;   # скины в base64 укладываются в 1mb JSON + запас
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/quasar /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
# выпуск серта (отвечает на 80-й, конфиг выше уже готов):
sudo certbot --nginx -d api.домен   # или certonly --webroot
# автопродление уже в таймере; проверить: certbot renew --dry-run
```

Примечания:
- `proxy_buffering off` только на `/api/launcher/download` — иначе nginx будет
  буферизовать ~11+ МБ exe в память/диск на каждого качающего.
- Текстуры скинов (`/api/texture/:hash`) иммутабельны по хэшу — кэш безопасен.

## 3. Firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# 3000 наружу больше не нужен — только локально для nginx:
sudo ufw deny 3000/tcp   # и убрать allow, если был
sudo ufw enable
```

**Это критично**: после переезда сырой `http://IP:3000` должен перестать отвечать
снаружи, иначе TLS не смыслит (трафик скинов/токенов продолжит ходить мимо шифрования).

## 4. .env бэкенда

```env
PUBLIC_API_ROOT="https://api.домен"
CORS_ORIGIN="*"            # или конкретный origin, если появится веб-морда
```

`systemctl restart quasar-backend`. `DATABASE_URL`/`JWT_SECRET` не трогаем
(ротация JWT_SECRET вылогинит всех).

## 5. Правки в коде (захардкоженный IP)

1. **`backend/src/routes/yggdrasil.ts`** — вместо
   `skinDomains: ['139.100.234.146']` подставлять домен. Правильнее всего — вынести
   в env: в `config.ts` добавить `SKIN_DOMAINS: z.string().default('')`, в
   `yggdrasil.ts` писать `skinDomains: env.SKIN_DOMAINS.split(',').filter(Boolean)`,
   в `.env` → `SKIN_DOMAINS="api.домен"`. Это последний жестко вбитый IP — стоит убрать.
   (Быстрый вариант: просто заменить строку на `['api.домен']`.)
2. **`backend/.env.example`** — дополнить новой переменной.
3. Проверить, нигде ли ещё не осталось `139.100.234.146`:
   `grep -rn "139.100.234.146" backend/ launcher/ fabric-mod/` — после правок
   совпадений остаться не должно (кроме, может, документации).

## 6. Клиент лаунчера

Клиент держит базу API в двух местах (менять оба, значения идентичны):

- `launcher/src-tauri/src/api.rs`, функция `api_base()`:
  дефолт `"http://139.100.234.146:3000"` → `"https://api.домен"`.
- `launcher/ui/src/api.ts`, константа `API_BASE` → `"https://api.домен"`.

Больше ничего в клиенте менять не нужно: `PUBLIC_API_ROOT` используется бэкендом
только для формирования Yggdrasil-metadata и ссылок на текстуры — клиент получает
их динамически. reqwest в Rust ходит по https без доп. настроек.

**Обратная совместимость**: у игроков останется старый exe, вшитый на `http://IP:3000`.
Поэтому:

- **Нельзя** выключать `:3000` сразу после релиза новой версии — старые клиенты
  отвалятся все разом. Лаунчер сам заставит их обновиться (`UpdateModal` +
  обязательное обновление при проверке версии), но обновление добровольное по клику.
- Разумная последовательность: выпустить релиз с новым адресом → подождать
  несколько дней (большинство обновится) → закрыть 3000 на файрволе. Старые
  клиенты получат понятную «Сервер недоступен» и обновятся руками.

## 7. Выпуск релиза и обратная совместимость

1. Поднять версию: `launcher/src-tauri/Cargo.toml` + `tauri.conf.json`.
2. Локально: `npx vite build` (в `launcher/ui`!) → `cargo build --release --features tauri/custom-protocol`.
3. Коммит + тег `v0.7.0` + push → CI соберёт и создаст GitHub Release.
4. Игрокам при следующем запуске придёт модалка обновления.

## 8. Чек-лист проверки после переезда

- [ ] `curl https://api.домен/api/health` → `{"ok":true,...}`
- [ ] `curl -I https://api.домен/api/launcher/latest` → 200, валидный JSON
- [ ] `curl http://api.домen/...` → 301 на https
- [ ] `curl http://139.100.234.146:3000` снаружи → **отказ** (ufw)
- [ ] Yggdrasil-метаданные: `GET https://api.домен/` → в `skinDomains` домен,
      `signaturePublickey` не пустой
- [ ] Скачивание exe: `curl -o test.exe https://api.домен/api/launcher/download`,
      размер совпадает с релизом, файл запускается
- [ ] Лаунчер (собранный с новым API_BASE): логин, скины (загрузка + отображение
      в игре), запуск игры, вход на сервер
- [ ] Старый клиент до закрытия 3000: обновился на новый релиз
- [ ] `certbot renew --dry-run` — продление работает

## 9. Переезд бэкенда на другую VDS (+ домен)

> Сценарий: покупается **новая VDS**, бэкенд переносится туда со старой машины
> (`139.100.234.146`), одновременно (или позже) привязывается **домен**.
> Предполагается, что Часть II (nginx+TLS на текущем сервере) ещё не выполнялась
> — тогда делаем сразу чисто: nginx+TLS на новой VDS, без этапа «голый :3000».

### 9.1 Что переносим

| Что | Где | Как |
|---|---|---|
| Код | `/home/quasar-backend` | `git clone` заново (источник истины — репо) |
| База данных | PostgreSQL, БД `quasar` | **pg_dump со старого сервера** — самое ценное (аккаунты, скины, YggToken, ModManifest) |
| `.env` | `/home/quasar-backend/.env` | Переносим вручную (в git нет), меняя то, что относится к новому окружению |
| Системд-юнит | `deploy/quasar-backend.service` | Ставится заново из репо |
| GitHub-токен | `GITHUB_TOKEN` в `.env` | Тот же (это PAT, не привязан к серверу) |
| RSA-ключи Yggdrasil | Таблица `Setting` в БД | Едут вместе с дампом — **это критично**, см. 9.4 |

Код игры (instance) у игроков локальный — его перенос не касается.

### 9.2 Пошаговый план

**Шаг 1. Подготовка новой VDS.**

```bash
apt update && apt upgrade -y
apt install -y nodejs npm postgresql nginx certbot python3-certbot-nginx git ufw
# node 20+ (если в дистрибутиве старый — через nodesource)
```

**Шаг 2. PostgreSQL + БД на новой VDS.**

```bash
sudo -u postgres psql <<'SQL'
CREATE USER quasar WITH PASSWORD '<новый_пароль>';
CREATE DATABASE quasar OWNER quasar;
SQL
```

**Шаг 3. Дамп и перенос данных со старого сервера.**

```bash
# на СТАРОМ сервере:
pg_dump -U quasar -d quasar -Fc -f /tmp/quasar.dump
scp /tmp/quasar.dump user@НОВЫЙ_IP:/tmp/

# на НОВОМ сервере:
pg_restore -U quasar -d quasar --no-owner /tmp/quasar.dump
```

Проверка: `psql -U quasar -d quasar -c "SELECT count(*) FROM users;"` — число
пользователей совпадает со старым сервером. RSA-пара в `settings` на месте:
`SELECT key FROM settings;` → должно содержать ключи сигнатур.

**Шаг 4. Код + сборка.**

```bash
git clone <repo> /home/quasar-backend
cd /home/quasar-backend/backend
npm ci
npm run build
```

**Шаг 5. `.env` на новой VDS** (за основу старый, правки):

```env
DATABASE_URL="postgresql://quasar:<новый_пароль>@localhost:5432/quasar"
NODE_ENV="production"
JWT_SECRET="<ТОТ ЖЕ, что был>"      # иначе все сессии невалидны и игроков вылогинит
JWT_EXPIRES_IN="12h"
CLIENT_HASH=""                       # как на старом
CORS_ORIGIN="*"
PUBLIC_API_ROOT="https://api.<домен>"  # см. шаг 7; ДО домена — http://НОВЫЙ_IP:3000
YGG_TOKEN_TTL_HOURS="24"
GITHUB_REPO="romansvyatkov222-netizen/quasar-launcher"
GITHUB_TOKEN="<тот же PAT>"
SKIN_DOMAINS="api.<домен>"           # если уже выполнен п.5 Части II (вынос из кода)
```

**Шаг 6. systemd.**

```bash
cp deploy/quasar-backend.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now quasar-backend
systemctl status quasar-backend   # active (running)
curl http://127.0.0.1:3000/api/health   # {"ok":true,...}
```

Миграции накатятся при старте автоматически (`AUTO_MIGRATE`), схема и так
едет из дампа — это идемпотентно.

**Шаг 7. Домен + nginx + TLS (см. Часть II, п. 1–3).**

- DNS: A-запись `api.<домен>` → **IP новой VDS**.
- Конфиг nginx из Части II — один в один, `proxy_pass http://127.0.0.1:3000`.
- certbot на новый домен.
- Файрвол: `ufw allow 22,80,443`, `:3000` наружу **закрыт**.

**Шаг 8. Клиентский релиз.**

См. п. 6–7 Части II: `api.rs::api_base()` и `ui/src/api.ts` → `https://api.<домен>`,
поднять версию, тег, релиз. Игроки обновятся через встроенный апдейтер.

### 9.3 Порядок переключения (важно!)

1. Новый сервер готов (шаги 1–6), но **старый ещё работает** — игроки играют.
2. DNS переключается на новую VDS → но **старые клиенты бьют в `http://139.100.234.146:3000`**
   — старый сервер обязан продолжать работать, пока живы старые exe!
3. **Проблема расщепления**: после DNS-переключения новые регистрации/скины
   попадают в новую БД, а старый сервер всё ещё отвечает на IP. Решение — одно из:
   - **Проксирование со старого** (рекомендую): на старой VDS поднять nginx,
     который `proxy_pass https://api.<домен>` на все `/` и Yggdrasil-пути, т.е.
     старый IP становится «умной заглушкой», ведущей на новый сервер. Данные
     только в одном месте (новая БД), расщепления нет.
   - Либо: смириться с окном расщепления, быстро выпустить релиз, дождаться
     обновления большинства и **выключить старый бэкенд**, заблокировав 3000.
     Потери: регистрации/скины за окно.
4. Релиз клиента с новым адресом (шаг 8) → ждать обновления → старый сервер
   погасить совсем.

### 9.4 Неотложные подводные камни

- **RSA-ключи Yggdrasil едут в дампе БД** (таблица `Setting`). Если БД переносится
  без них (свежая), у сервера сгенерируется **новая пара** — тогда `signaturePublickey`
  изменится, и уже выданные токены/сертификаты chat-signing будут невалидны.
  Для чистого переезда дамп обязателен; генерация новой пары допустима только
  если осознанно «сжигаем» старые токены.
- **JWT_SECRET не менять** при переезде — иначе все сессии слетят разом.
- **skinDomains** — по-прежнему должен совпадать с доменом (или IP, если домена
  ещё нет); при переезде без домена временно `SKIN_DOMAINS="НОВЫЙ_IP"` и
  `PUBLIC_API_ROOT="http://НОВЫЙ_IP:3000"`.
- **Скины**: ссылки на текстуры формируются от `PUBLIC_API_ROOT` и хранятся в
  properties профиля **динамически** (не в БД) — после смены корня подхватятся
  новые URL автоматически. Старые клиенты (со старым корнем) будут ходить на
  старый сервер — ещё одна причина держать его живым до конца миграции.
- **Майнкрафт-сервер** (если Paper/fabric-mod на старой VDS): он тоже знает
  адрес API (verify-token и пр.) — при переезде обновить его конфиг и
  перезапустить **до** переключения DNS.

### 9.5 Чек-лист переезда

- [ ] Дамп восстановлен, `users`/`skins`/`settings` на месте (RSA-пара!)
- [ ] `JWT_SECRET` идентичен старому
- [ ] `curl http://127.0.0.1:3000/api/health` на новой VDS → ok
- [ ] nginx + TLS + 301 на https, `:3000` закрыт снаружи
- [ ] Yggdrasil `GET /` отдаёт metadata с корректным `skinDomains` и publickey
- [ ] Скин: загрузка через лаунчер, отображение в игре
- [ ] Релиз клиента с новым адресом, модалка обновления у игроков
- [ ] Старая VDS: nginx-заглушка (или приёмлемое окно расщепления)
- [ ] Через N дней: старый бэкенд остановлен, порт закрыт
- [ ] Старую VDS можно гасить

## 10. Что можно сделать потом (не обязательно)

- **HSTS** заголовок у nginx (после того как убедились, что всё на https).
- **HTTP/3** (quic) в nginx — мелочь, но приятна на «плохих» сетях.
- Кэш-заголовки `/api/mods` и `/api/manifest` (меняются редко) — меньше трафика
  на мобильных.
- Резервные копии PostgreSQL: `pg_dump` по крону + выгрузка вне VDS — до любых
  миграций с доменом/схемой.
- Мониторинг: `uptime-kuma` на `GET /api/health`.
- Вынести `SKIN_DOMAINS` (см. п. 5) и вообще убрать все IP из кода.
