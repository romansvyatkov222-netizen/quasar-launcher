# Quasar Launcher — документация

> Документ для разработчиков и ИИ-агентов. Описывает архитектуру, потоки данных,
> инварианты и «грабли», на которые уже наступали. Перед изменениями — прочти раздел
> [Инварианты и грабли](#инварианты-и-грабли).

## Содержание

1. [Что это](#что-это)
2. [Структура репозитория](#структура-репозитория)
3. [Архитектура](#архитектура)
4. [Клиент (Tauri): Rust-часть](#клиент-tauri-rust-часть)
5. [Клиент (Tauri): React-часть](#клиент-tauri-react-часть)
6. [Справочник Tauri-команд](#справочник-tauri-команд)
7. [Пайплайн запуска игры (главный поток)](#пайплайн-запуска-игры-главный-поток)
8. [Бэкенд API, который потребляет клиент](#бэкенд-api-который-потребляет-клиент)
9. [Сборка и релиз](#сборка-и-релиз)
10. [Инварианты и грабли](#инварианты-и-грабли)

---

## Что это

Windows-лаунчер Minecraft (версия игры **1.21.11**, модлоадер **Fabric**) с собственным
аккаунт-сервером. Ключевые особенности:

- **Кастомная авторизация** через собственный Yggdrasil-сервер (authlib-injector), а не Mojang.
- **Изоляция игрока**: игра живёт в отдельной папке `instance` (не `.minecraft`),
  запрещённые папки (saves/config/resourcepacks/shaderpacks) вытираются перед каждым запуском.
- **Целостность**: моды сверяются по SHA-256 с манифестом бэкенда; `client_hash`
  (агрегированный хэш папки mods) отправляется при логине — бэкенд видит несовпадения.
- **Самообновление**: лаунчер качает новый exe с бэкенда и подменяет себя через rename.
- UI — React + Tailwind; фон экрана игры пока пустой (тёмная тема), кастомный фон планируется.

Стек клиента: **Tauri 2** (Rust) + **React 18** + **TypeScript** + **Vite** + **Tailwind** + **skinview3d** (3D-скины).

## Структура репозитория

```
Quasar Launcher/
├── .github/workflows/release.yml   # CI: тег v* -> сборка exe -> GitHub Release
├── backend/                        # Express + Prisma (SQLite): auth, mods, skin, yggdrasil
│   ├── src/routes/                 #   auth.ts, mods.ts, skin.ts, texture.ts, launcher.ts, yggdrasil.ts
│   ├── prisma/schema.prisma        #   модели: User, Session, Skin, YggToken, Setting, ModManifest
│   └── .env                        #   JWT_SECRET и пр. (в git не коммитится)
├── deploy/                         # скрипты деплоя бэкенда
├── docs/                           # эта документация
├── fabric-mod/                     # исходники серверного Fabric-мода (Gradle)
└── launcher/                       # КЛИЕНТ (та часть, что собирается в exe)
    ├── QuasarLauncher.exe          # артефакт текущей локальной сборки (в git не хранится)
    ├── src-tauri/                  # Rust-ядро лаунчера
    │   ├── src/*.rs                #   модули, см. ниже
    │   ├── tauri.conf.json         #   окно 1000x680 без декораций, версия, иконка
    │   ├── icons/icon.ico          #   логотип (exe + панель задач)
    │   └── capabilities/default.json # разрешения Tauri (окно, drag, dialog)
    └── ui/                         # фронтенд (React)
        ├── src/components/*.tsx    # экраны и виджеты
        ├── src/assets/             # скины-заглушки (steve)
        └── dist/                   # выход vite (tauri embed'ит его в exe)
```

## Архитектура

```
┌────────────────────────────── Windows ──────────────────────────────┐
│  QuasarLauncher.exe (Tauri 2)                                       │
│  ┌───────────────────── WebView2 ─────────────────────┐             │
│  │  React UI (ui/src)                                 │             │
│  │   AuthScreen → ModSelect → LauncherScreen → ...    │             │
│  │        │ invoke("cmd_*")        ▲ listen()        │             │
│  └────────┼─────────────────────────┼─────────────────┘             │
│           ▼                         │ события: download-progress,  │
│  Rust-команды (src-tauri/src)       │ game-exited                  │
│   main.rs  api.rs  mods.rs  install.rs                              │
│   jvm.rs   verify.rs  updater.rs  state.rs  hashing.rs              │
│        │              │                                             │
│        │              └── java -javaagent authlib-injector ...       │
│        │                          Minecraft 1.21.11 + Fabric        │
└────────┼─────────────────────────────────────────────────────────────┘
         ▼ HTTP (reqwest, api_base = QUASAR_API || http://139.100.234.146:3000)
┌──────────────────────────── Бэкенд ─────────────────────────────────┐
│  Express: /api/register /api/login /api/mods /api/manifest          │
│           /api/skin/*  /api/yggdrasil-token  /api/launcher/*        │
│           /textures/:hash ( textureRouter, вне /api )               │
│  Prisma (SQLite): User, Session, Skin, YggToken, Setting, ModManifest│
└─────────────────────────────────────────────────────────────────────┘
```

Данные пользователя: `%APPDATA%/dev.quasar.launcher/`
- `launcher-session.json` — сессия (JWT, TTL 12 ч, переживает перезапуск)
- `instance/` — изолированный игровой клиент (versions, libraries, assets, mods, …)
- `instance/quasar-game.log` — stdout/stderr игры (диагностика вылетов)
- `instance/selected-mods.json` — выбранные опциональные моды

## Клиент (Tauri): Rust-часть

Все модули в `launcher/src-tauri/src/`. Точка входа `main.rs` регистрирует команды
и плагины (`single_instance` — второй запуск просто выводит окно вперёд; `dialog`).

| Модуль | Ответственность |
|---|---|
| `main.rs` | Регистрация 19 команд, сессия на старте, чистка остатков апдейтера |
| `api.rs` | HTTP-клиент (таймауты 10/30 с), типы DTO, ошибки по-русски, `post_auth_json` с **нарезкой тела на ~1.4 KB куски и retry ×3** (обход VPN-туннелей, рвущих бёрсты). Базовый URL: env `QUASAR_API`, иначе хардкод |
| `state.rs` | `AppState` (сессия + процесс игры, RwLock), TTL сессии 12 ч, сохранение сессии в файл, `instance_dir()`, объём ОЗУ через kernel32, watcher процесса игры (emit `game-exited`) |
| `install.rs` | Подготовка инстанса: профиль Mojang → fabric.json (loader 0.19.5) → клиентский jar → библиотеки (параллельно по 24) → ассеты (по 32), маркер `.installed`; authlib-injector 1.2.8 (SHA-256 закреплён) |
| `mods.rs` | Синхронизация модов с бэкенда: required всегда, optional по выбору; `download_file` с emit `download-progress` |
| `jvm.rs` | Поиск Java 21+ (JAVA_HOME/PATH/Program Files), сборка argv, защитные флаги (`-XX:+DisableAttachMechanism` и др.), `javaw.exe` + `CREATE_NO_WINDOW`, лог в `quasar-game.log`; classpath через walkdir: libraries + mods + vanilla jar |
| `verify.rs` | `WIPED_DIRS = [resourcepacks, shaderpacks, config, saves]` — вытираются при каждом запуске; сверка SHA-256 с манифестом; `offline_uuid()` — UUID v3 `OfflinePlayer:<ник>` (совпадает с профилем бэкенда) |
| `updater.rs` | `check_updates` (сравнение версий semver-подобно), `apply_update` (качает exe → `exe.new`, проверка MZ-сигнатуры), `finish_update` (rename-танец: exe→.old, .new→exe, откат при ошибке, рестарт) |
| `hashing.rs` | SHA-256 файла/байтов; `dir_aggregate_hash` — хэш папки mods для `client_hash` |

## Клиент (Tauri): React-часть

`launcher/ui/src/`. Навигация — простой `switch` в `App.tsx` (роутера нет).

Экраны (components):

| Компонент | Что делает |
|---|---|
| `AuthScreen` | Логин/регистрация, перевод кодов ошибок бэкенда в русский |
| `ModSelectScreen` | Список модов (required отключены, optional — чекбоксы), скачивание с прогрессом |
| `LauncherScreen` | Главный экран: фон (пока пустой), ник+аватар+выход, статус, прогресс, кнопки «Проверить файлы» и «ИГРАТЬ», модалка запущенной игры |
| `SkinUploadScreen` / `Skin3DViewer` | Загрузка PNG-скина (slim/classic), 3D-превью на skinview3d |
| `SettingsScreen` | Выбор ОЗУ (опции генерируются из фактического объёма ПК), сохранение в localStorage |
| `UpdateModal` | Показывается в `App.tsx`, если бэкенд отдал более новую версию |
| `TitleBar` / `Sidebar` | Кастомный тайтлбар (drag, минимизация), выдвижное меню-иконки |
| `GameRunningModal` | «Игра запущена», кнопка принудительного закрытия |

Служебные модули: `api.ts` (типизированные invoke-обёртки + `skinFaceDataUrl`),
`ram.ts` (опции ОЗУ: от 2 ГБ шагом 2, максимум = total − 2 ГБ).

Дизайн-токены в `tailwind.config.js`: палитра `quasar-*` (bg #0a0a0f, accent #8b5cf6),
свечения `shadow-glow`, анимация `fade-up`. Градиент логотипа: violet-400 → fuchsia-400.

## Справочник Tauri-команд

Фронт вызывает через `invoke` (см. `ui/src/api.ts`). Сигнатуры сокращены.

| Команда | Назначение |
|---|---|
| `cmd_register(username, password)` | Регистрация |
| `cmd_login(username, password)` | Логин; шлёт `client_hash`; сессия сохраняется на диск |
| `cmd_current_user` / `cmd_logout` | Текущая сессия (учитывает TTL) / выход |
| `cmd_get_mods` | Список модов (required + optional) |
| `cmd_download_mods(optional_ids)` | Скачать моды вручную (экран «Моды») |
| `cmd_save_optional_selection(ids)` / `cmd_load_optional_selection` | Выбор опциональных модов ↔ `selected-mods.json` |
| `cmd_skin_preview(path)` | Файл → data-URL (лимит 512 KB) |
| `cmd_upload_skin(path, model)` | PNG (base64) на бэкенд с JWT |
| `cmd_fetch_skin` | Скин юзера с бэкенда (404 → null) |
| `cmd_clean_and_verify` | Wipe запрещённых папок + сверка манифеста (кнопка «Проверить файлы») |
| `cmd_launch(ram_mb)` | **Полный пайплайн запуска**, см. ниже. Возвращает `{stage: "launched" \| "verify_failed", report, downloadErrors}` |
| `cmd_game_running` / `cmd_close_game` | Статус процесса / kill |
| `cmd_system_ram_mb` | Объём ОЗУ ПК (0 = не определился) |
| `cmd_app_version` | Версия из Cargo.toml |
| `cmd_check_updates` / `cmd_apply_update` / `cmd_finish_update` | Самообновление |

События из Rust в UI (через `emit`/`listen`):
- `download-progress` — `{file, percent, done?}` — всё скачивание (моды, jar, библиотеки, ассеты, апдейт)
- `game-exited` — Minecraft закрылся сам

## Пайплайн запуска игры (главный поток)

`cmd_launch` в `main.rs` — сердце лаунчера. Порядок строго важен:

1. **Моды**: GET `/api/mods` → required + optional (из `selected-mods.json`) → `sync_mods` (скачивает недостающее, emit прогресса).
2. **Инстанс**: `install::ensure_instance` — если нет маркера `.installed`: манифест Mojang → fabric.json → клиентский jar → библиотеки → ассеты → маркер; authlib-injector проверяется всегда.
3. **Изоляция**: `wipe_forbidden_dirs` — удаляет `saves`, `config`, `resourcepacks`, `shaderpacks`.
4. **Верификация**: GET `/api/manifest?files=mods`, сверяются **только expected-файлы** (required + выбранные optional — иначе у кого нет Sodium всегда провал). Провал → `stage: "verify_failed"` с отчётом, игра НЕ стартует.
5. **Защита от дубля**: `game_running()`.
6. **Одноразовый токен**: POST `/api/yggdrasil-token` (JWT лаунчера в игру не уходит).
7. **Запуск JVM**: Java 21+ → `javaw.exe`:
   - `-Xmx{ram}M -Xms{ram/2}M`
   - `-javaagent:authlib-injector.jar={api_base}` (Yggdrasil → наш бэкенд)
   - `-XX:+DisableAttachMechanism -Djdk.attach.allowAttachSelf=false -Djava.security.manager=disallow`
   - `-Dlauncher.accessToken={ygg_token}` (+ username/userId)
   - `-cp @classpath` (libraries + mods + vanilla jar), main-class `net.fabricmc.loader.impl.launch.knot.KnotClient`
   - `--username --uuid {offline v3} --version 1.21.11 --accessToken --gameDir --assetsDir --assetIndex`
8. **Watcher**: поток раз в секунду проверяет процесс; умер → `game-exited`.

## Бэкенд API, который потребляет клиент

Сервер: Express + Prisma, авторизация JWT (`Authorization: Bearer`).

| Эндпоинт | Auth | Отдаёт |
|---|---|---|
| `POST /api/register` | — | создание аккаунта |
| `POST /api/login` | — | `{token, user, clientHashOk?}` (клиент шлёт `clientHash`) |
| `GET /api/mods` | — | `{required: ModEntry[], optional: ModEntry[]}` — `githubUrl, fileName, sha256Hash` |
| `GET /api/manifest?files=mods` | — | `{files: [{path, sha256}]}` — эталон для верификации |
| `POST /api/skin/upload` | JWT | upsert скина (base64 PNG + modelType) |
| `GET /api/skin/:userId` | JWT | `{image, modelType, resolution}` / 404 |
| `POST /api/yggdrasil-token` | JWT | одноразовый `{accessToken, expiresAt, profile{id, name}}` |
| `GET /api/launcher/latest` | — | `{version \| null, notes, size}` — последняя версия exe |
| `GET /api/launcher/download` | — | сам exe (для самообновления) |
| `/textures/:hash` | — | текстуры (textureRouter, вне `/api`) |

Authlib-injector со стороны игры бьёт в стандартные Yggdrasil-эндпоинты
(`/authserver/*`, `/sessionserver/*`, `/api/profiles/minecraft`) — их реализация в
`backend/src/routes/yggdrasil.ts`. Токены `YggToken` одноразовые, старый аннулируется.

## Сборка и релиз

Локально (порядок важен!):

```powershell
# 1. Фронт: сначала типы, затем сборка в ui/dist
cd launcher/ui
npx tsc --noEmit
npx vite build

# 2. exe (dev-сборка без бандла; custom-protocol нужен только для релиза)
cd ../src-tauri
cargo build --release --features tauri/custom-protocol
# артефакт: target/release/quasar-launcher.exe
```

CI (`.github/workflows/release.yml`): пуш тега `v*` → на windows-latest собирает
фронт и `cargo build --release --features tauri/custom-protocol` → создаёт GitHub
Release с `QuasarLauncher.exe`.

Подъём версии — в **двух** файлах: `src-tauri/Cargo.toml` и `src-tauri/tauri.conf.json`.
От версии в Cargo.toml зависят ресурсы exe и тайтлбар (`cmd_app_version`).

## Инварианты и грабли

Проверено на реальных поломках — не нарушать без понимания:

1. **`tauri.conf.json` не имеет `beforeBuildCommand`.** `tauri build` НЕ пересобирает
   фронт — exe линкуется с существующим `ui/dist`. После правок фронта всегда
   `npx vite build` отдельно, затем сборка Rust. (Однажды из-за этого релиз
   содержал старое видео.)
2. **`custom-protocol` обязателен в release** (`cargo build --release --features
   tauri/custom-protocol`), иначе exe грузит `devUrl` localhost:5173 и падает с
   ERR_CONNECTION_REFUSED.
3. **Модифицированный exe = исключение из репозитория**: `*.exe` в `.gitignore`.
4. **Windows-кэш иконок привязан к пути файла**: при замене exe проводник может
   показывать старую иконку, хотя ресурсы в файле новые. Лечение: удалить
   `%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache_*.db` + перезапуск
   explorer.exe (или скопировать exe под новым именем).
5. **Верификация только по expected-набору** (required + выбранные optional),
   не по всему манифесту — иначе у игроков без опциональных модов вечный провал.
6. **JWT не покидает процесс лаунчера.** В JVM уходит только одноразовый
   Yggdrasil-токен.
7. **`post_auth_json` шлёт тело кусочками ~1.4 KB с паузами и делает до 3
   попыток** — обход VPN-туннелей, рвущих соединение. Не «оптимизировать» обратно.
8. **Updater: только rename-танец** (exe→.old, .new→exe, откат при ошибке), bat-файлы
   не использовать — cmd кодирует bat в OEM-866 и ломается на кириллице в путях.
9. **`offline_uuid` = UUID v3 от `OfflinePlayer:<ник>`** — обязан совпадать с
   тем, что бэкенд выдаёт в Yggdrasil-профиле, иначе скины не подхватятся.
10. **Java строго 21+** (MC 1.21), поиск по JAVA_HOME/PATH/Program Files,
    ошибка — понятное сообщение про Temurin.
11. **Wipe-папки (`saves/config/resourcepacks/shaderpacks`) вытираются при каждом
    запуске** — это античит-изоляция, не баг. Уведомление игроку — в отчёте `wiped`.
12. **Кириллица в путях Windows** — системная фича этого проекта (пользователь
    `Пользователь`). Все пути через Rust std (Unicode-WinAPI), никаких bat.
