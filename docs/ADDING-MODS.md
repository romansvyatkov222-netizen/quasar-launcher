# Добавление модов в Quasar Launcher (руководство администратора)

Все моды хранятся в таблице `mod_manifest` в базе данных PostgreSQL на VDS (`139.100.234.146`).
Лаунчер читает их через два API-роута:

- `GET /api/mods` — список для UI (обязательные + опциональные с описаниями);
- `GET /api/manifest` — эталонные SHA-256 для проверки целостности перед запуском игры.

---

## Как это работает

```
[Ты добавляешь запись в БД]
        |
        v
[Игрок открывает лаунчер]  --->  GET /api/mods  --->  видит галочки опциональных модов
        |                                                (обязательные — молча, без галочек)
        v
[Игрок жмёт "Играть"]
        |
        v
[Лаунчер (Rust)]  --->  скачивает jar по downloadUrl
                  --->  считает SHA-256 скачанного файла
                  --->  сверяет с sha256Hash из БД
                  |        |
                  |        +-- совпало  -> продолжаем
                  |        +-- НЕ совпал -> файл удаляется, запуск блокируется
                  v
[Игра запускается только с чистыми, проверенными модами]
```

**Ключевые правила:**

1. `modType = REQUIRED` — мод ставится всем игрокам автоматически, в UI не отображается.
2. `modType = OPTIONAL` — мод появляется галочкой в UI, игрок сам решает.
3. `fileName` — точное имя jar-файла (под ним мод сохраняется и ищется при верификации).
   Должно совпадать с реальным именем файла символ в символ.
4. `sha256Hash` — эталон. Если файл на диске не совпал с эталоном, лаунчер его удалит
   и не даст запустить игру (защита от подмены модов читами).
5. Версия мода должна быть для **Minecraft 1.21.11**, иначе клиент упадёт при запуске.

---

## Шаг 1. Скачай jar и посчитай SHA-256

Скачай jar нужного мода вручную (Modrinth, GitHub, любой источник) — версии **1.21.11**,
лоадер **Fabric**. Затем на Windows:

```powershell
Get-FileHash "C:\Users\Ты\Downloads\modname-1.21.11.jar" -Algorithm SHA256
```

Пример вывода:

```
SHA256  bdff7fd7e220085cfad2ff9b1f40dde6534ae0b96cf378f97a374bc54cb9ed0f
```

Скопируй нижнюю строку (в строчных буквах, без пробелов).

> Если хэш в БД не совпадёт с реальным файлом — лаунчер скачает jar и удалит его
> при первой же проверке. Всегда перепроверяй хэш после скачивания.

---

## Шаг 2. Получи прямую ссылку для скачивания (downloadUrl)

Лаунчер качает мод по `downloadUrl`. Где брать ссылки:

| Источник | Как получить | Пример |
|---|---|---|
| **Modrinth** (большинство модов) | `https://api.modrinth.com/v2/project/<slug>/version?game_versions=["1.21.11"]&loaders=["fabric"]` → возьми `files[0].url` | `https://cdn.modrinth.com/data/AANobbMI/versions/rkdTcxoT/sodium-fabric-0.8.14+mc1.21.11.jar` |
| **maven.fabricmc.net** | Fabric API и библиотеки: `https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/<версия>/fabric-api-<версия>.jar` (пробел/`+` экранируй как `%2B`) | ссылка в seed.mjs |
| **GitHub releases** | Открой `https://github.com/<owner>/<repo>/releases` — если у релиза есть jar-файл в assets, используй его `browser_download_url` | работает НЕ для всех (у Sodium assets пустые) |
| **Свой бэкенд** | Положи jar на VDS: `/home/quasar-backend/files/` → ссылка `http://139.100.234.146:3000/api/files/<имя>.jar` | наш Quasar Mod так и раздаётся |

> **Про Modrinth:** фильтр по версии на самом сайте иногда врёт. Надёжный способ:
> через API получить все версии мода, найти ту, у которой в `game_versions` есть `1.21.11`.

Проверь ссылку перед добавлением — открой в браузере или:

```powershell
Invoke-WebRequest "<ссылка>" -Method Head
```

Ответ `200` = рабочая ссылка.

---

## Шаг 3. Добавь запись в БД

### Способ А: через seed.mjs (рекомендуется)

1. Открой `backend/prisma/seed.mjs` в проекте.
2. Добавь запись в массив `mods`:

```js
{
  modType: 'OPTIONAL',                     // REQUIRED - всем, OPTIONAL - галочка в UI
  name: 'JourneyMap',                      // имя в UI лаунчера
  description: 'Миникарта и вейпоинты',    // описание в UI
  githubUrl: 'https://github.com/TeamJM/journeymap',   // для кнопки GitHub в UI
  downloadUrl: 'https://cdn.modrinth.com/.../journeymap-x.jar',  // прямая ссылка из Шага 2
  fileName: 'journeymap-1.21.11-x.jar',    // ТОЧНОЕ имя jar (Шаг 1)
  sha256Hash: 'bdff7fd7e220085c...',       // SHA-256 из Шага 1
},
```

3. Залей на VDS и выполни seed:

```powershell
tar -czf - backend/prisma/seed.mjs | ssh root@139.100.234.146 "tar -xzf - -C /home && cp /home/backend/prisma/seed.mjs /home/quasar-backend/prisma/ && cd /home/quasar-backend && node prisma/seed.mjs && rm -rf /home/backend"
```

4. Должно вывести: `[seed] OK: N модов с реальными SHA-256`.

> **Внимание:** seed удаляет ВСЕ записи из `mod_manifest` и создаёт заново
> (`deleteMany` + `create`). Если добавлял моды руками через SQL (способ Б),
> они будут стёрты. Веди все моды в seed.mjs — это источник истины.

### Способ Б: разовая правка через SQL (быстро, но не воспроизводимо)

```bash
ssh root@139.100.234.146
su - postgres -c "psql quasar"
```

Добавить мод:

```sql
INSERT INTO mod_manifest (id, mod_type, name, description, github_url, download_url, file_name, sha256_hash)
VALUES (
  gen_random_uuid(),
  'OPTIONAL',                                     -- или 'REQUIRED'
  'JourneyMap',
  'Миникарта и вейпоинты',
  'https://github.com/TeamJM/journeymap',
  'https://cdn.modrinth.com/data/lfHFW1mp/versions/xxx/journeymap.jar',
  'journeymap-1.21.11-x.jar',
  'bdff7fd7e220085cfad2ff9b1f40dde6534ae0b96cf378f97a374bc54cb9ed0f'
);
```

Сменить тип / убрать из выдачи:

```sql
UPDATE mod_manifest SET mod_type = 'REQUIRED' WHERE file_name = 'sodium-fabric-0.8.14+mc1.21.11.jar';
DELETE FROM mod_manifest WHERE file_name = 'old-mod.jar';
```

Посмотреть всё, что есть:

```sql
SELECT mod_type, name, file_name FROM mod_manifest ORDER BY mod_type, name;
```

Выйди из psql: `\q`, из ssh: `exit`.

---

## Шаг 4. Проверь результат

Перезапускать бэкенд НЕ нужно — оба роута читают БД на каждый запрос.

```powershell
# 1. Мод виден в списке для UI
curl http://139.100.234.146:3000/api/mods

# 2. Мод вошёл в манифест верификации
curl http://139.100.234.146:3000/api/manifest

# 3. Ссылка качается
Invoke-WebRequest "<downloadUrl>" -Method Head
```

В ответе `/api/mods` мод должен появиться в `required` или `optional`.
В `/api/manifest` появится запись `mods/<fileName>` с его хэшем.

Затем запусти лаунчер: опциональный мод появится галочкой, после "Играть"
в логе лаунчера будет строка о скачивании, и игра запустится с модом.

---

## Частые ошибки

| Симптом | Причина | Решение |
|---|---|---|
| Лаунчер удаляет мод и не даёт играть | SHA-256 в БД не совпал с реальным jar | пересчитай хэш (Шаг 1), обнови запись |
| "Не удалось найти jar" в логе лаунчера | пустой/битый `downloadUrl`, нет jar в GitHub-релизах | возьми ссылку с Modrinth API (Шаг 2) |
| Игра крашится при старте | мод не для 1.21.11 | скачай версию именно под 1.21.11 Fabric |
| Мод есть в `/api/mods`, но не скачивается | `fileName` не совпадает с именем jar в `downloadUrl` | сделай их одинаковыми |
| Внес мод через SQL, пропал после seed | seed стирает таблицу и создаёт заново | добавь мод в seed.mjs (способ А) |
| 404 на `/api/files/<имя>` | файла нет в `/home/quasar-backend/files/` на VDS | скопируй jar туда: `scp файл.jar root@139.100.234.146:/home/quasar-backend/files/` |

---

## Обновление мода на новую версию

1. Скачай новый jar, посчитай SHA-256 (Шаг 1).
2. В seed.mjs (или SQL) замени у записи: `downloadUrl`, `fileName`, `sha256Hash`.
3. Выполни seed (способ А) — и всё: у игроков лаунчер сам скачает новую версию
   при следующем запуске, старый jar будет удалён, т.к. его нет в манифесте.
