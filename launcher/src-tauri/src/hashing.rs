use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::Path;
use walkdir::WalkDir;

/// SHA-256 файла (стримингом, чтобы не грузить jar целиком в память).
pub fn file_sha256(path: &Path) -> anyhow::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// SHA-256 байтов в памяти.
pub fn bytes_sha256(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

/// Считает общий хэш по всем файлам директории (rel_path || bytes) —
/// используется как client_hash: единый отпечаток инстанса.
pub fn dir_aggregate_hash(dir: &Path) -> anyhow::Result<String> {
    let mut hasher = Sha256::new();
    if dir.exists() {
        let mut entries: Vec<_> = WalkDir::new(dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .collect();
        entries.sort_by_key(|e| e.path().to_path_buf());
        for entry in entries {
            let rel = entry.path().strip_prefix(dir)?;
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            hasher.update(rel_str.as_bytes());
            hasher.update([0]);
            hasher.update(fs::read(entry.path())?);
            hasher.update([1]);
        }
    }
    Ok(hex::encode(hasher.finalize()))
}
