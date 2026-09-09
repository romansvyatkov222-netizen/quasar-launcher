# Смена Minecraft-сервера: offline-mode → Yggdrasil (authlib-injector)

## Стартовая команда сервера (LOCALSERVERMINECRAFT/start.bat)

```bat
java -Xms2G -Xmx4G -javaagent:authlib-injector.jar=http://139.100.234.146:3000 -jar server.jar nogui
```

- `authlib-injector-1.2.8.jar` лежит рядом с `server.jar`
  (SHA-256 `9c7f4343e6c82034958ffb48c14a2cb0c85928be7283103ce17da00c6d5a7b10`)
- agent URL = PUBLIC_API_ROOT бэкенда; при переходе на HTTPS — поменять и тут

## server.properties

```properties
online-mode=true
enforce-secure-profile=true
```

Оба параметра обязательны (требование authlib-injector v1.2.0+ для MC 1.19+).
`enforce-secure-profile=true` работает благодаря нашему эндпоинту
`POST /minecraftservices/player/certificates` (ключи подписи чата выдаёт бэкенд).

## Как это работает

1. Лаунчер логинится (JWT) и запрашивает `POST /api/yggdrasil-token` → игровой
   `accessToken` (TTL 24 ч, одна активная сессия на пользователя)
2. Клиент запускается с `-javaagent:authlib-injector.jar=<API>` — все Yggdrasil-вызовы
   (join и т.д.) идут на наш бэкенд
3. При подключении к серверу клиент делает `POST /sessionserver/.../join` (accessToken
   + serverId), сервер Paper при логине — `GET /sessionserver/.../hasJoined`
4. Нет валидного join-а → игрок отсекается **на этапе логина**: не спавнится и не
   попадает в онлайн (Kick: Failed to verify username)
5. Скины: `hasJoined` возвращает профиль с подписанным свойством `textures`
   (URL `/api/texture/<sha256>.png`) — vanilla раздаёт скины сам, без модов

## UUID профилей

`UUID.nameUUIDFromBytes("OfflinePlayer:<name>")` (MD5 v3) — те же UUID, что были у
offline-mode сервера, поэтому миры/данные/правила LuckPerms не теряются.
Rust-ядро (`verify.rs:offline_uuid`) и бэкенд (`yggdrasil.ts:offlineUuid`) выдают
идентичные значения.

## Что удалено из архитектуры

- `server-plugin/` (QuasarAuth: verify-token, SkinInjector, SkinSender) — удалён
- `-Dlauncher.token` (долгоживущий JWT в cmdline) — больше не передаётся; в игру
  уходит только короткоживущий игровой accessToken

## Quasar SkinFix (обязательный мод)

Vanilla 1.21.x отбрасывает HD-скины (128/256): `PlayerSkinTextureDownloader.remapTexture`
кидает «Discarding incorrectly sized» для всего, кроме 64x64/64x32. Мод `quasar-skinfix`
(mixin на method_65863, intermediary-имена, refmap не нужен) разрешает квадратные
HD-скины. Без него скины крупнее 64x64 заменяются дефолтным Steve.
