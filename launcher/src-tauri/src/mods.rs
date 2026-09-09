use crate::api::{self, ModEntry};
use crate::hashing;
use std::fs;
use std::io::Write;
use std::path::Path;
use tauri::Emitter;

/// Скачивает файл с прогрессом (emit "download-progress" в UI).
/// Принимает готовый клиент, чтобы переиспользовать из install.rs.
pub async fn download_file(
    http: &reqwest::Client,
    url: &str,
    dest: &Path,
    label: &str,
    window: &tauri::WebviewWindow,
) -> anyhow::Result<()> {
    let mut resp = http
        .get(url)
        .header("User-Agent", "quasar-launcher")
        .send()
        .await?
        .error_for_status()?;
    let total = resp.content_length().unwrap_or(0);

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = fs::File::create(dest)?;
    let mut downloaded: u64 = 0;

    while let Some(chunk) = resp.chunk().await? {
        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;
        let percent = if total > 0 {
            (downloaded as f64 / total as f64 * 100.0) as u8
        } else {
            0
        };
        let _ = window.emit(
            "download-progress",
            serde_json::json!({ "file": label, "percent": percent }),
        );
    }
    file.flush()?;
    Ok(())
}

/// Тихое скачивание без прогресса (для параллельных пачек библиотек/ассетов).
pub async fn download_to_file(http: &reqwest::Client, url: &str, dest: &Path) -> anyhow::Result<()> {
    if dest.exists() {
        return Ok(());
    }
    let resp = http
        .get(url)
        .header("User-Agent", "quasar-launcher")
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await?
        .error_for_status()?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = fs::File::create(dest)?;
    let mut stream = resp;
    while let Some(chunk) = stream.chunk().await? {
        file.write_all(&chunk)?;
    }
    file.flush()?;
    Ok(())
}

async fn url_exists(url: &str) -> bool {
    let client = match api::http() {
        Ok(c) => c,
        Err(_) => return false,
    };
    matches!(
        client
            .head(url)
            .header("User-Agent", "quasar-launcher")
            .send()
            .await,
        Ok(r) if r.status().is_success()
    )
}

/// Резолвит прямую ссылку на jar по GitHub-ссылке из БД:
/// 1) последний release -> первый *.jar asset;
/// 2) raw.githubusercontent.com (main/master).
async fn resolve_download_url(github_url: &str, file_name: &str) -> anyhow::Result<String> {
    let url = github_url.trim_end_matches('/');

    let parts: Vec<&str> = url
        .strip_prefix("https://github.com/")
        .ok_or_else(|| anyhow::anyhow!("Не GitHub-ссылка: {github_url}"))?
        .split('/')
        .collect();
    anyhow::ensure!(parts.len() >= 2, "Некорректный GitHub URL: {github_url}");
    let repo = format!("{}/{}", parts[0], parts[1]);

    let releases_api = format!("https://api.github.com/repos/{repo}/releases/latest");
    if let Ok(resp) = api::http()?
        .get(&releases_api)
        .header("User-Agent", "quasar-launcher")
        .send()
        .await
    {
        if resp.status().is_success() {
            let json: serde_json::Value = resp.json().await?;
            if let Some(assets) = json["assets"].as_array() {
                if let Some(dl) = assets.iter().find_map(|a| {
                    let name = a["name"].as_str().unwrap_or("");
                    let link = a["browser_download_url"].as_str().unwrap_or("");
                    (name.ends_with(".jar") && !link.is_empty()).then(|| link.to_string())
                }) {
                    return Ok(dl);
                }
            }
        }
    }

    for branch in ["main", "master"] {
        let raw = format!("https://raw.githubusercontent.com/{repo}/{branch}/{file_name}");
        if url_exists(&raw).await {
            return Ok(raw);
        }
    }

    anyhow::bail!("Не удалось найти jar для {file_name} в {github_url}")
}

fn is_real_sha256(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Требуемые моды + выбранные опциональные -> <game_dir>/mods.
/// Скачивает по GitHub-ссылкам, сверяет sha256 с эталоном из БД.
pub async fn sync_mods(
    http: &reqwest::Client,
    game_dir: &Path,
    required: Vec<ModEntry>,
    selected_optional: Vec<ModEntry>,
    window: &tauri::WebviewWindow,
) -> anyhow::Result<Vec<String>> {
    let mods_dir = game_dir.join("mods");
    fs::create_dir_all(&mods_dir)?;

    // Изоляция: jar'ы, которых нет в манифесте, удаляются
    let known: Vec<String> = required
        .iter()
        .chain(selected_optional.iter())
        .map(|m| m.file_name.clone())
        .collect();
    for entry in fs::read_dir(&mods_dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".jar") && !known.contains(&name) {
            fs::remove_file(entry.path())?;
        }
    }

    let mut errors: Vec<String> = Vec::new();
    let all: Vec<&ModEntry> = required.iter().chain(selected_optional.iter()).collect();

    for m in all {
        let dest = mods_dir.join(&m.file_name);

        let placeholder = !is_real_sha256(&m.sha256_hash);
        let need_download = if dest.exists() && !placeholder {
            hashing::file_sha256(&dest)? != m.sha256_hash.to_lowercase()
        } else {
            !dest.exists()
        };

        if need_download {
            let _ = window.emit(
                "download-progress",
                serde_json::json!({ "file": m.name, "percent": 0 }),
            );
            // Прямая ссылка из БД имеет приоритет (Sodium/Fabric API не на GitHub);
            // иначе резолвим по GitHub-репозиторию
            let result = match &m.download_url {
                Some(url) if !url.trim().is_empty() => Ok(url.clone()),
                _ => resolve_download_url(&m.github_url, &m.file_name).await,
            };
            match result {
                Ok(url) => {
                    if let Err(e) = download_file(http, &url, &dest, &m.name, window).await {
                        errors.push(format!("{}: {e}", m.name));
                        continue;
                    }
                }
                Err(e) => {
                    errors.push(format!("{}: {e}", m.name));
                    continue;
                }
            }
        }

        if !placeholder {
            let actual = hashing::file_sha256(&dest)?;
            if actual != m.sha256_hash.to_lowercase() {
                let _ = fs::remove_file(&dest);
                errors.push(format!("{}: sha256 не совпал с эталоном из БД", m.name));
                continue;
            }
        }

        let _ = window.emit(
            "download-progress",
            serde_json::json!({ "file": m.name, "percent": 100, "done": true }),
        );
    }
    Ok(errors)
}
