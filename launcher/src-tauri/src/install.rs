use anyhow::{anyhow, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::Emitter;

use crate::mods;

pub const MC_VERSION: &str = "1.21.11";
const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const FABRIC_PROFILE_URL: &str =
    "https://meta.fabricmc.net/v2/versions/loader/1.21.11/0.19.5/profile/json";
const FALLBACK_MAVEN: &str = "https://maven.fabricmc.net/";

/// authlib-injector: javaagent для своей Yggdrasil-авторизации (клиент и сервер).
/// Версия запиннена; jar качается в instance и проверяется по SHA-256.
pub const AUTHLIB_INJECTOR_VERSION: &str = "1.2.8";
pub const AUTHLIB_INJECTOR_SHA256: &str = "9c7f4343e6c82034958ffb48c14a2cb0c85928be7283103ce17da00c6d5a7b10";
const AUTHLIB_INJECTOR_URL: &str =
    "https://github.com/yushijinhun/authlib-injector/releases/download/v1.2.8/authlib-injector-1.2.8.jar";

/// Путь к authlib-injector.jar в инстансе (нужен и клиенту, и серверу).
pub fn authlib_injector_path(game_dir: &Path) -> PathBuf {
    game_dir.join("libraries").join("dev").join("quasar")
        .join(format!("authlib-injector-{AUTHLIB_INJECTOR_VERSION}.jar"))
}

/// Скачивает authlib-injector, если его нет или хэш не совпал.
async fn ensure_authlib_injector(http: &reqwest::Client, game_dir: &Path, window: &tauri::WebviewWindow) -> Result<()> {
    let dest = authlib_injector_path(game_dir);
    let needs_download = match std::fs::read(&dest) {
        Ok(bytes) => crate::hashing::bytes_sha256(&bytes) != AUTHLIB_INJECTOR_SHA256,
        Err(_) => true,
    };
    if !needs_download {
        return Ok(());
    }
    let _ = window.emit(
        "download-progress",
        serde_json::json!({ "file": "authlib-injector", "percent": 0 }),
    );
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    mods::download_to_file(http, AUTHLIB_INJECTOR_URL, &dest).await?;
    let actual = crate::hashing::bytes_sha256(&std::fs::read(&dest)?);
    if actual != AUTHLIB_INJECTOR_SHA256 {
        let _ = std::fs::remove_file(&dest);
        anyhow::bail!("authlib-injector: sha256 не совпал с эталоном");
    }
    let _ = window.emit(
        "download-progress",
        serde_json::json!({ "file": "authlib-injector", "percent": 100, "done": true }),
    );
    Ok(())
}

// ---------- сериализация JSON Mojang / Fabric ----------

#[derive(Deserialize)]
struct VersionManifest {
    versions: Vec<VersionRef>,
}
#[derive(Deserialize)]
struct VersionRef {
    id: String,
    url: String,
}
#[derive(Deserialize)]
struct VersionJson {
    #[serde(rename = "assetIndex")]
    asset_index: Option<AssetIndexRef>,
    #[serde(default)]
    libraries: Vec<MojangLib>,
    downloads: Option<Downloads>,
}
#[derive(Deserialize)]
struct Downloads {
    client: Option<Artifact>,
}
#[derive(Deserialize)]
struct Artifact {
    url: String,
    #[serde(default)]
    path: Option<String>,
}
#[derive(Deserialize)]
struct AssetIndexRef {
    id: String,
    url: String,
}
#[derive(Deserialize)]
struct AssetIndex {
    objects: HashMap<String, AssetObject>,
}
#[derive(Deserialize)]
struct AssetObject {
    hash: String,
}
#[derive(Deserialize)]
struct MojangLib {
    name: String,
    #[serde(default)]
    downloads: Option<LibDownloads>,
    #[serde(default)]
    rules: Option<Vec<Rule>>,
}
#[derive(Deserialize)]
struct LibDownloads {
    #[serde(default)]
    artifact: Option<Artifact>,
}
#[derive(Deserialize)]
struct Rule {
    action: String,
    #[serde(default)]
    os: Option<RuleOs>,
}
#[derive(Deserialize)]
struct RuleOs {
    #[serde(default)]
    name: Option<String>,
}
#[derive(serde::Serialize, Deserialize)]
struct FabricProfile {
    #[serde(default)]
    libraries: Vec<FabricLib>,
}
#[derive(serde::Serialize, Deserialize)]
struct FabricLib {
    name: String,
    #[serde(default)]
    url: Option<String>,
}

/// Фильтр правил Mojang: разрешено ли на текущей ОС.
fn rules_allow(rules: &Option<Vec<Rule>>) -> bool {
    match rules {
        None => true,
        Some(rs) => {
            let mut allow = false;
            for r in rs {
                let applies = match &r.os {
                    Some(o) => o.name.as_deref() == Some(std::env::consts::OS),
                    None => true,
                };
                if applies {
                    allow = r.action == "allow";
                }
            }
            allow
        }
    }
}

/// group:artifact:version[:classifier] -> group/artifact/version/artifact-version[-classifier].jar
fn maven_rel(name: &str) -> String {
    let parts: Vec<&str> = name.split(':').collect();
    let (g, a, v) = (parts[0], parts[1], parts[2]);
    let file = match parts.get(3) {
        Some(c) => format!("{a}-{v}-{c}.jar"),
        None => format!("{a}-{v}.jar"),
    };
    format!("{}/{}/{}/{}", g.replace('.', "/"), a, v, file)
}
struct Job {
    url: String,
    dest: PathBuf,
}

/// Готовит инстанс: ванильный jar, библиотеки (Mojang + Fabric), ассеты.
/// Идемпотентно: пропускает уже скачанные файлы, маркер .installed — сигнал готовности.
pub async fn ensure_instance(
    http: reqwest::Client,
    game_dir: &Path,
    window: &tauri::WebviewWindow,
) -> Result<()> {
    let ver_dir = game_dir.join("versions").join(MC_VERSION);
    let client_jar = ver_dir.join(format!("{MC_VERSION}.jar"));
    let libs_dir = game_dir.join("libraries");
    let assets_dir = game_dir.join("assets");
    std::fs::create_dir_all(&ver_dir)?;

    let marker = ver_dir.join(".installed");
    if marker.exists() && client_jar.exists() {
        // authlib-injector проверяем всегда (не зависит от маркера)
        return ensure_authlib_injector(&http, game_dir, window).await;
    }

    let emit = |file: &str, percent: u8| {
        let _ = window.emit(
            "download-progress",
            serde_json::json!({ "file": file, "percent": percent }),
        );
    };

    emit("Профиль Minecraft", 3);
    let manifest: VersionManifest = http
        .get(MANIFEST_URL)
        .send()
        .await
        .map_err(|_| anyhow!("Сервер Mojang недоступен"))?
        .error_for_status()?
        .json()
        .await?;
    let vref = manifest
        .versions
        .iter()
        .find(|v| v.id == MC_VERSION)
        .ok_or_else(|| anyhow!("Версия {MC_VERSION} не найдена в манифесте Mojang"))?
        .url
        .clone();
    let vjson: VersionJson = http
        .get(&vref)
        .send()
        .await
        .map_err(|_| anyhow!("Сервер Mojang недоступен"))?
        .error_for_status()?
        .json()
        .await?;

    emit("Профиль Fabric", 8);
    let fabric: FabricProfile = http
        .get(FABRIC_PROFILE_URL)
        .send()
        .await
        .map_err(|_| anyhow!("Сервер Fabric Meta недоступен"))?
        .error_for_status()?
        .json()
        .await?;
    std::fs::write(ver_dir.join("fabric.json"), serde_json::to_vec_pretty(&fabric)?)?;

    // Клиентский jar
    let client_url = vjson
        .downloads
        .as_ref()
        .and_then(|d| d.client.as_ref())
        .map(|c| c.url.clone())
        .ok_or_else(|| anyhow!("Mojang не отдал ссылку на клиентский jar"))?;
    if !client_jar.exists() {
        emit("Minecraft 1.21.11", 10);
        mods::download_file(&http, &client_url, &client_jar, "Minecraft 1.21.11", window).await?;
    }

    // Библиотеки: Mojang (с фильтром правил) + Fabric
    let mut jobs: Vec<Job> = Vec::new();
    for lib in &vjson.libraries {
        if !rules_allow(&lib.rules) {
            continue;
        }
        if let Some(art) = lib.downloads.as_ref().and_then(|d| d.artifact.as_ref()) {
            let rel = art.path.clone().unwrap_or_else(|| maven_rel(&lib.name));
            jobs.push(Job {
                url: art.url.clone(),
                dest: libs_dir.join(rel),
            });
        }
    }
    for lib in &fabric.libraries {
        let rel = maven_rel(&lib.name);
        let base = lib
            .url
            .clone()
            .unwrap_or_else(|| FALLBACK_MAVEN.to_string());
        let base = if base.ends_with('/') { base } else { format!("{base}/") };
        jobs.push(Job {
            url: format!("{base}{rel}"),
            dest: libs_dir.join(rel),
        });
    }
    let total = jobs.len();
    let mut done = 0usize;
    for chunk in jobs.chunks(24) {
        let mut handles = Vec::with_capacity(chunk.len());
        for job in chunk {
            if job.dest.exists() {
                continue;
            }
            let http = http.clone();
            let url = job.url.clone();
            let dest = job.dest.clone();
            handles.push(tokio::spawn(async move {
                mods::download_to_file(&http, &url, &dest).await
            }));
        }
        for h in handles {
            h.await.map_err(|e| anyhow!("токен-задача: {e}"))??;
        }
        done += chunk.len();
        emit("Библиотеки", 15 + (45 * done / total.max(1)) as u8);
    }

    // Ассеты
    if let Some(ai) = &vjson.asset_index {
        let idx_dir = assets_dir.join("indexes");
        std::fs::create_dir_all(&idx_dir)?;
        let idx_path = idx_dir.join(format!("{}.json", ai.id));
        if !idx_path.exists() {
            mods::download_to_file(&http, &ai.url, &idx_path).await?;
        }
        let index: AssetIndex = serde_json::from_slice(&std::fs::read(&idx_path)?)?;
        let objects_dir = assets_dir.join("objects");
        let total = index.objects.len();
        let mut done = 0usize;
        let mut jobs: Vec<Job> = index
            .objects
            .values()
            .map(|o| Job {
                url: format!(
                    "https://resources.download.minecraft.net/{}/{}",
                    &o.hash[..2], o.hash
                ),
                dest: objects_dir.join(&o.hash[..2]).join(&o.hash),
            })
            .collect();
        for chunk in jobs.chunks_mut(32) {
            let chunk_len = chunk.len();
            let mut handles = Vec::with_capacity(chunk_len);
            for job in chunk.iter() {
                if job.dest.exists() {
                    continue;
                }
                let http = http.clone();
                let url = job.url.clone();
                let dest = job.dest.clone();
                handles.push(tokio::spawn(async move {
                    mods::download_to_file(&http, &url, &dest).await
                }));
            }
            for h in handles {
                h.await.map_err(|e| anyhow!("токен-задача: {e}"))??;
            }
            done += chunk_len;
            emit("Ассеты", 60 + (40 * done / total.max(1)) as u8);
        }
        // id индекса для флага --assetIndex
        std::fs::write(ver_dir.join("asset-index.txt"), &ai.id)?;
    }

    std::fs::write(&marker, "ok")?;
    // authlib-injector: javaagent для Yggdrasil-логина (после маркера — проверяется всегда)
    ensure_authlib_injector(&http, game_dir, window).await?;
    Ok(())
}
