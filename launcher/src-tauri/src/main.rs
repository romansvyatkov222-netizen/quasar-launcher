// Без консольного окна в release-сборке (в debug оставляем для логов)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod hashing;
mod install;
mod jvm;
mod mods;
mod state;
mod updater;
mod verify;

use api::{LoginResponse, ModsResponse};
use state::{AppState, Session};
use tauri::{AppHandle, Manager, State};

type Ctx<'a> = State<'a, AppState>;

fn err(e: impl std::fmt::Display) -> String {
    format!("{e:#}")
}

// ---------- auth ----------

#[tauri::command]
async fn cmd_register(username: String, password: String) -> Result<serde_json::Value, String> {
    api::post_json(
        "/api/register",
        &serde_json::json!({ "username": username, "password": password }),
    )
    .await
    .map_err(err)
}

#[tauri::command]
async fn cmd_login(
    app: AppHandle,
    ctx: Ctx<'_>,
    username: String,
    password: String,
) -> Result<Session, String> {
    let client_hash = verify::client_hash(&state::instance_dir(&app)).unwrap_or_default();

    let resp: LoginResponse = api::post_json(
        "/api/login",
        &api::LoginBody {
            username: &username,
            password: &password,
            client_hash,
        },
    )
    .await
    .map_err(err)?;

    let session = Session {
        user_id: resp.user.id.clone(),
        username: resp.user.username.clone(),
        token: resp.token,
        expires_at_millis: state::now_millis() + state::SESSION_TTL_MILLIS,
    };
    ctx.set_session(Some(session.clone()));
    state::save_session(&app, Some(&session)).map_err(err)?;
    Ok(session)
}

#[tauri::command]
fn cmd_current_user(ctx: Ctx<'_>) -> Option<Session> {
    ctx.current()
}

#[tauri::command]
async fn cmd_logout(app: AppHandle, ctx: Ctx<'_>) -> Result<(), String> {
    ctx.set_session(None);
    state::save_session(&app, None).map_err(err)
}

// ---------- mods ----------

/// Список модов с бэкенда (обязательные + опциональные).
#[tauri::command]
async fn cmd_get_mods() -> Result<ModsResponse, String> {
    api::get_json("/api/mods").await.map_err(err)
}

/// Скачивание модов: обязательные + выбранные опциональные (по id) с GitHub.
#[tauri::command]
async fn cmd_download_mods(
    app: AppHandle,
    window: tauri::WebviewWindow,
    optional_ids: Vec<String>,
) -> Result<Vec<String>, String> {
    let mods: ModsResponse = api::get_json("/api/mods").await.map_err(err)?;
    let selected: Vec<api::ModEntry> = mods
        .optional
        .iter()
        .filter(|m| optional_ids.contains(&m.id))
        .cloned()
        .collect();

    let game_dir = state::instance_dir(&app);
    let http = api::http().map_err(err)?;
    mods::sync_mods(&http, &game_dir, mods.required, selected, &window)
        .await
        .map_err(err)
}

// ---------- skin ----------

/// Превью скина: читаем файл в Rust, возвращаем data-URL для <img>.
#[tauri::command]
async fn cmd_skin_preview(file_path: String) -> Result<String, String> {
    let png = std::fs::read(&file_path).map_err(err)?;
    if png.len() > 512 * 1024 {
        return Err("Файл скина слишком большой (макс. 512 KB)".into());
    }
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png);
    Ok(format!("data:image/png;base64,{b64}"))
}

/// Загрузка скина: читаем PNG, шлём base64 на бэкенд с JWT.
#[tauri::command]
async fn cmd_upload_skin(
    ctx: Ctx<'_>,
    file_path: String,
    model_type: String,
) -> Result<serde_json::Value, String> {
    let session = ctx.current().ok_or_else(|| err("не авторизован"))?;
    let png = std::fs::read(&file_path).map_err(err)?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png);

    api::post_auth_json(
        "/api/skin/upload",
        &serde_json::json!({ "image": b64, "modelType": model_type }),
        &session.token,
    )
    .await
    .map_err(err)
}

/// Скин пользователя с бэкенда: data-URL для превью в лаунчере (или null).
#[tauri::command]
async fn cmd_fetch_skin(ctx: Ctx<'_>) -> Result<Option<String>, String> {
    let session = ctx.current().ok_or_else(|| err("не авторизован"))?;
    #[derive(serde::Deserialize)]
    struct SkinResp {
        image: String,
    }
    let resp: Option<SkinResp> = match api::get_auth_json_opt(&format!("/api/skin/{}", session.user_id), &session.token).await {
        Ok(r) => r,
        Err(_) => None, // скина нет / сеть — показываем дефолт
    };
    Ok(resp.map(|s| format!("data:image/png;base64,{}", s.image)))
}

// ---------- isolation + verification + launch ----------

#[tauri::command]
async fn cmd_clean_and_verify(app: AppHandle) -> Result<verify::VerifyReport, String> {
    let game_dir = state::instance_dir(&app);
    let wiped = verify::wipe_forbidden_dirs(&game_dir).map_err(err)?;
    let manifest: api::ManifestResponse = api::get_json("/api/manifest?files=mods")
        .await
        .map_err(err)?;

    // Сверяем только обязательные + сохранённый выбор опциональных
    let mods: ModsResponse = api::get_json("/api/mods").await.map_err(err)?;
    let mut expected: Vec<String> = mods.required.iter().map(|m| format!("mods/{}", m.file_name)).collect();
    let selected_path = game_dir.join("selected-mods.json");
    if selected_path.exists() {
        let ids: Vec<String> =
            serde_json::from_slice(&std::fs::read(&selected_path).map_err(err)?).map_err(err)?;
        for m in mods.optional.iter().filter(|m| ids.contains(&m.id)) {
            expected.push(format!("mods/{}", m.file_name));
        }
    }
    let relevant: Vec<api::ManifestFile> = manifest
        .files
        .into_iter()
        .filter(|f| expected.contains(&f.path))
        .collect();

    let mut report = verify::verify_manifest(&game_dir, &relevant);
    report.wiped = wiped;
    Ok(report)
}

/// Подготовка инстанса: скачали моды, чистим папки, сверяем хэши, запускаем JVM.
#[tauri::command]
async fn cmd_launch(
    app: AppHandle,
    ctx: Ctx<'_>,
    ram_mb: Option<u32>,
) -> Result<serde_json::Value, String> {
    let session = ctx.current().ok_or_else(|| err("не авторизован"))?;
    let game_dir = state::instance_dir(&app);
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| err("нет главного окна"))?;

    // 1. Скачивание/обновление модов (обязательные всегда; опциональные берутся из сохранённого выбора)
    let mods: ModsResponse = api::get_json("/api/mods").await.map_err(err)?;
    let http_client = api::http().map_err(err)?;
    let selected_path = game_dir.join("selected-mods.json");
    let selected: Vec<api::ModEntry> = if selected_path.exists() {
        let ids: Vec<String> =
            serde_json::from_slice(&std::fs::read(&selected_path).map_err(err)?).map_err(err)?;
        mods.optional
            .iter()
            .filter(|m| ids.contains(&m.id))
            .cloned()
            .collect()
    } else {
        Vec::new()
    };
    // Набор файлов, который ДОЛЖЕН быть у игрока (для верификации после скачивания)
    let expected: Vec<String> = mods
        .required
        .iter()
        .chain(selected.iter())
        .map(|m| format!("mods/{}", m.file_name))
        .collect();
    let download_errors = mods::sync_mods(&http_client, &game_dir, mods.required, selected, &window)
        .await
        .map_err(err)?;

    // 1.5 Подготовка инстанса: ванильный jar + библиотеки + ассеты + Fabric
    install::ensure_instance(http_client, &game_dir, &window)
        .await
        .map_err(err)?;

    // 2. Клиентская изоляция
    let wiped = verify::wipe_forbidden_dirs(&game_dir).map_err(err)?;

    // 3. Верификация хэшей с эталоном из БД.
    // Сверяем только требуемый набор: обязательные + выбранные опциональные,
    // иначе у игрока без Sodium/ModMenu верификация всегда провалится.
    let manifest: api::ManifestResponse = api::get_json("/api/manifest?files=mods")
        .await
        .map_err(err)?;
    let relevant: Vec<api::ManifestFile> = manifest
        .files
        .into_iter()
        .filter(|f| expected.contains(&f.path))
        .collect();
    let mut report = verify::verify_manifest(&game_dir, &relevant);
    report.wiped = wiped;
    if !report.ok {
        return Ok(serde_json::json!({
            "stage": "verify_failed",
            "report": report,
            "downloadErrors": download_errors,
        }));
    }

    // Защита от второго запуска
    if ctx.game_running() {
        return Err("Игра уже запущена. Закройте её перед новым запуском".into());
    }

    // 4. Игровой Yggdrasil-токен: выдаётся на один запуск, старый аннулируется.
    //    В JVM уходит ТОЛЬКО он (не JWT) — через -Dlauncher.accessToken.
    let session_now = ctx.current().ok_or_else(|| err("не авторизован"))?;
    let ygg: api::YggTokenResponse = api::post_auth_json(
        "/api/yggdrasil-token",
        &serde_json::json!({}),
        &session_now.token,
    )
    .await
    .map_err(err)?;

    // 5. Запуск JVM с authlib-injector (javaagent) и защитными флагами
    let rt = jvm::JavaRuntime::detect().map_err(err)?;
    let child = jvm::spawn(&rt, &game_dir, &session, &ygg, ram_mb.unwrap_or(4096)).map_err(err)?;
    *ctx.game.write().unwrap() = Some(child);

    // Наблюдатель: когда игрок сам закроет Minecraft — событие "game-exited" в UI
    AppState::spawn_game_watcher(app.clone());

    Ok(serde_json::json!({
        "stage": "launched",
        "report": report,
        "downloadErrors": download_errors,
    }))
}

/// Игра ещё запущена?
#[tauri::command]
fn cmd_game_running(ctx: Ctx<'_>) -> Result<bool, String> {
    Ok(ctx.game_running())
}

/// Закрыть Minecraft (кнопка "Выйти" в модалке).
#[tauri::command]
fn cmd_close_game(ctx: Ctx<'_>) -> Result<(), String> {
    let mut g = ctx.game.write().unwrap();
    if let Some(child) = g.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *g = None;
    Ok(())
}

/// Сохранить выбранные опциональные моды (галочки из UI).
#[tauri::command]
fn cmd_save_optional_selection(app: AppHandle, optional_ids: Vec<String>) -> Result<(), String> {    let dir = state::instance_dir(&app);
    std::fs::create_dir_all(&dir).map_err(err)?;
    let path = dir.join("selected-mods.json");
    std::fs::write(&path, serde_json::to_vec_pretty(&optional_ids).map_err(err)?).map_err(err)
}

/// Общий объём ОЗУ компьютера (МБ) — для динамических опций в настройках.
#[tauri::command]
fn cmd_system_ram_mb() -> u64 {
    state::total_ram_mb()
}

/// Версия лаунчера (Cargo.toml) — для тайтлбара и модалки обновлений.
#[tauri::command]
fn cmd_app_version() -> String {
    updater::current_version().to_string()
}

/// Загрузить сохранённый выбор опциональных модов (восстановление после перезапуска лаунчера).
#[tauri::command]
fn cmd_load_optional_selection(app: AppHandle) -> Result<Vec<String>, String> {
    let path = state::instance_dir(&app).join("selected-mods.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    serde_json::from_slice(&std::fs::read(&path).map_err(err)?).map_err(err)
}

fn main() {
    // Один экземпляр: повторный запуск exe выводит уже открытое окно на передний план
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            if let Some(session) = state::load_session(&handle) {
                app.state::<AppState>().set_session(Some(session));
            }
            Ok(())
        })
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            cmd_register,
            cmd_login,
            cmd_current_user,
            cmd_logout,
            cmd_get_mods,
            cmd_download_mods,
            cmd_upload_skin,
            cmd_skin_preview,
            cmd_fetch_skin,
            cmd_game_running,
            cmd_close_game,
            cmd_clean_and_verify,
            cmd_save_optional_selection,
            cmd_load_optional_selection,
            cmd_system_ram_mb,
            cmd_app_version,
            updater::cmd_check_updates,
            updater::cmd_apply_update,
            updater::cmd_finish_update,
            cmd_launch,
        ])
        .run(tauri::generate_context!())
        .expect("ошибка запуска Quasar Launcher");
}
