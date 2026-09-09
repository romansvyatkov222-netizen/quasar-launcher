# Quasar Backend — заметки по безопасности деплоя (VDS 139.100.234.146)

Текущее состояние: Express слушает `0.0.0.0:3000` напрямую (systemd-сервис `quasar-backend`).
Перед публичной эксплуатацией поправить пункты ниже.

> **Архитектура (сентябрь 2026):** авторизация переведена на Yggdrasil (authlib-injector).
> Парольного входа через Yggdrasil нет (`/authserver/authenticate` → 403) — игровой
> accessToken выдаёт только лаунчер через `POST /api/yggdrasil-token` (Bearer JWT).
> Порт 3000 должен быть доступен клиенту И Minecraft-серверу (join/hasJoined).

## 1. Nginx + TLS (обязательно)
Сейчас API ходит по голому HTTP — JWT и пароли передаются в открытом виде.
```bash
apt install -y nginx certbot python3-certbot-nginx
# /etc/nginx/sites-available/quasar:
#   server { listen 80; server_name api.<домен>;
#            location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; } }
ln -s /etc/nginx/sites-available/quasar /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx
certbot --nginx -d api.<домен>   # выдаст TLS, редирект на https
```
После этого:
1. `backend/.env` на VDS: `PUBLIC_API_ROOT="https://api.<домен>"` и `systemctl restart quasar-backend`
   (важно: этот корень вшивается в подписи player certificates, менять его = пере-выдача ключей чата);
2. лаунчер: `QUASAR_API` / `api_base()` → `https://api.<домен>`, пересборка exe;
3. `-javaagent:authlib-injector.jar=https://api.<домен>` и в стартовой команде сервера, и в `jvm.rs`.

## 2. Firewall + bind
```bash
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw deny 3000/tcp && ufw enable
```
Плюс в `backend/src/index.ts` поменять `app.listen(env.PORT)` на
`app.listen(env.PORT, "127.0.0.1")` — тогда порт 3000 будет недоступен снаружи даже при ошибках ufw.

## 3. CORS
`.env`: `CORS_ORIGIN="*"` → заменить на origin Tauri-окна:
- Windows: `tauri://localhost` (Tauri v2: `http://tauri.localhost`)
- итог: `CORS_ORIGIN="http://tauri.localhost"`

## 4. JWT в аргументах JVM (`-Dlauncher.token`)
Токен виден в списке процессов (Task Manager / `wmic process`), т.е. любой локальный процесс пользователя
может его украсть. Смягчения: короткий TTL сессии (сейчас 12h, можно меньше), relogin перед каждым запуском.
Правильное решение на будущее — короткоживущий одноразовый ключ, выдаваемый бэком на 60 сек только для входа.

## 5. online-mode=false на Paper
Сервер принимает подключения с любым ником. Единственная защита — проверка токена Paper-плагином
(Шаг 4): без валидного `mylauncher:auth` — кик. Также включить `enforce-secure-profile=false` в server.properties.

## 6. PostgreSQL
- Слушает только localhost (по умолчанию) — 5432 наружу НЕ открывать.
- Пароль БД и JWT_SECRET в `/home/quasar-backend/.env` (chmod 600), не коммитить.
