use crate::api::ManifestFile;
use crate::hashing;
use std::fs;
use std::path::Path;

/// Папки, которые перед запуском полностью удаляются (клиентская изоляция).
pub const WIPED_DIRS: &[&str] = &["resourcepacks", "shaderpacks", "config", "saves"];

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyReport {
    pub wiped: Vec<String>,
    pub missing: Vec<String>,
    pub corrupted: Vec<String>,
    pub ok: bool,
}

/// Изоляция клиента: удаляем resourcepacks/shaderpacks/config/saves перед запуском.
pub fn wipe_forbidden_dirs(game_dir: &Path) -> anyhow::Result<Vec<String>> {
    let mut wiped = Vec::new();
    for dir in WIPED_DIRS {
        let p = game_dir.join(dir);
        if p.exists() {
            fs::remove_dir_all(&p)?;
            wiped.push(dir.to_string());
        }
    }
    Ok(wiped)
}

/// Сверка файлов с эталонным манифестом из БД (path -> sha256).
pub fn verify_manifest(game_dir: &Path, manifest: &[ManifestFile]) -> VerifyReport {
    let mut missing = Vec::new();
    let mut corrupted = Vec::new();

    for f in manifest {
        let path = game_dir.join(&f.path);
        if !path.exists() {
            missing.push(f.path.clone());
            continue;
        }
        match hashing::file_sha256(&path) {
            Ok(actual) if actual == f.sha256.to_lowercase() => {}
            _ => corrupted.push(f.path.clone()),
        }
    }

    let ok = missing.is_empty() && corrupted.is_empty();
    VerifyReport {
        wiped: Vec::new(),
        missing,
        corrupted,
        ok,
    }
}

/// client_hash: агрегированный отпечаток инстанса для login.
pub fn client_hash(game_dir: &Path) -> anyhow::Result<String> {
    hashing::dir_aggregate_hash(&game_dir.join("mods"))
}

/// Публичный UUID, идентичный алгоритму ванилы для offline-mode:
/// UUID.nameUUIDFromBytes("OfflinePlayer:" + username) — MD5-based v3.
pub fn offline_uuid(username: &str) -> anyhow::Result<String> {
    use md5::Digest as _;

    let mut hasher = md5::Md5::new();
    hasher.update(format!("OfflinePlayer:{username}"));
    let mut b: [u8; 16] = hasher.finalize().into();

    b[6] = (b[6] & 0x0f) | 0x30; // version 3
    b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant

    let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    ))
}
