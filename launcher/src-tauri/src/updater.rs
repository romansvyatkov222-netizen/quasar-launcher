use serde::Deserialize;
use tauri::{AppHandle, Emitter};
use std::io::Write;

use crate::api;

/// Ответ бэкенда: свежая версия релиза (или version: null — релизов нет).
#[derive(Debug, Deserialize)]
pub struct LatestResponse {
    pub version: Option<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub size: u64,
}

#[derive(Debug, serde::Serialize)]
pub struct UpdateCheck {
    pub available: bool,
    pub current: String,
    pub latest: String,
    #[serde(rename = "notes")]
    pub notes: String,
}

/// Текущая версия лаунчера (Cargo.toml).
pub fn current_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

fn version_tuple(v: &str) -> Vec<u64> {
    v.trim_start_matches('v')
        .split('.')
        .map(|p| p.parse::<u64>().unwrap_or(0))
        .collect()
}

fn is_newer(latest: &str, current: &str) -> bool {
    let l = version_tuple(latest);
    let c = version_tuple(current);
    for i in 0..l.len().max(c.len()) {
        let a = l.get(i).copied().unwrap_or(0);
        let b = c.get(i).copied().unwrap_or(0);
        if a != b {
            return a > b;
        }
    }
    false
}

/// Проверка обновлений. Ошибки сети/сервера -> available: false (не мешаем игроку).
#[tauri::command]
pub async fn cmd_check_updates() -> UpdateCheck {
    let current = current_version().to_string();
    let resp: Result<LatestResponse, _> = api::get_json("/api/launcher/latest").await;
    match resp {
        Ok(r) => match r.version {
            Some(latest) if is_newer(&latest, &current) => UpdateCheck {
                available: true,
                latest,
                current,
                notes: r.notes,
            },
            _ => UpdateCheck {
                available: false,
                latest: r.version.unwrap_or_default(),
                current,
                notes: String::new(),
            },
        },
        Err(_) => UpdateCheck {
            available: false,
            latest: String::new(),
            current,
            notes: String::new(),
        },
    }
}

/// Путь к работающему exe (QuasarLauncher.exe).
fn exe_path() -> anyhow::Result<std::path::PathBuf> {
    std::env::current_exe()
        .map_err(|e| anyhow::anyhow!("не удалось определить путь exe: {e}"))
}

/// Скачивание новой версии рядом с текущим exe (QuasarLauncher.exe.new)
/// с прогрессом через событие download-progress.
#[tauri::command]
pub async fn cmd_apply_update(window: tauri::WebviewWindow) -> Result<(), String> {
    let dest = exe_path().map_err(err_s)?;
    let tmp = dest.with_extension("exe.new");

    let http = api::http().map_err(err_s)?;
    let mut resp = http
        .get(format!("{}/api/launcher/download", api::api_base()))
        .header("User-Agent", "quasar-launcher")
        .send()
        .await
        .map_err(|e| api::friendly_network_error_pub(e))
        .map_err(err_s)?
        .error_for_status()
        .map_err(err_s)?;

    let total = resp.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(&tmp).map_err(err_s)?;
    let mut downloaded: u64 = 0;

    while let Some(chunk) = resp.chunk().await.map_err(err_s)? {
        file.write_all(&chunk).map_err(err_s)?;
        downloaded += chunk.len() as u64;
        let percent = if total > 0 {
            (downloaded as f64 / total as f64 * 100.0) as u8
        } else {
            0
        };
        let _ = window.emit(
            "download-progress",
            serde_json::json!({ "file": "Обновление лаунчера", "percent": percent }),
        );
    }
    file.flush().map_err(err_s)?;

    // sanity-check: файл не пустой и имеет MZ-сигнатуру PE
    let head = {
        use std::io::Read;
        let mut f = std::fs::File::open(&tmp).map_err(err_s)?;
        let mut b = [0u8; 2];
        let _ = f.read_exact(&mut b);
        b
    };
    if head != [0x4D, 0x5A] {
        return Err("Скачанный файл не является исполняемым".into());
    }

    Ok(())
}

/// Замена exe без bat-скриптов: работающий exe ПЕРЕИМЕНОВЫВАЕТСЯ в .old
/// (Windows это разрешает), новый файл встаёт на его место, запускается
/// новая версия; .old чистится при следующем старте.
///
/// Прежний вариант через cmd/bat ломался на кириллице в пути: cmd читает
/// bat в OEM-кодировке (866), а файл писался в UTF-8 -> del/move не находили
/// файл («не удаётся найти лаунчер»). std::fs::rename использует
/// Unicode-WinAPI и работает с любыми путями.
#[tauri::command]
pub fn cmd_finish_update(app: AppHandle) -> Result<(), String> {
    let dest = exe_path().map_err(err_s)?;
    let tmp = dest.with_extension("exe.new");
    if !tmp.exists() {
        return Err("Обновление не скачано".into());
    }
    let old = dest.with_extension("exe.old");
    if old.exists() {
        let _ = std::fs::remove_file(&old); // хвост прошлой попытки
    }

    // 1. работающий exe уходит в .old
    std::fs::rename(&dest, &old).map_err(err_s)?;
    // 2. новый встаёт на его место; при неудаче возвращаем старый обратно
    if let Err(e) = std::fs::rename(&tmp, &dest) {
        let _ = std::fs::rename(&old, &dest);
        return Err(format!("Не удалось установить обновление: {e:#}"));
    }

    // 3. запуск уже новой версии (пути Unicode-safe)
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new(&dest)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(err_s)?;
    }

    app.exit(0);
    #[allow(unreachable_code)]
    Ok(())
}

/// Чистка хвостов прошлых обновлений (.old / .new / update.bat) при старте.
pub fn cleanup_update_leftovers() {
    let Ok(exe) = exe_path() else { return };
    let _ = std::fs::remove_file(exe.with_extension("exe.old"));
    let _ = std::fs::remove_file(exe.with_extension("exe.update.bat"));
}

fn err_s(e: impl std::fmt::Display) -> String {
    format!("{e:#}")
}
