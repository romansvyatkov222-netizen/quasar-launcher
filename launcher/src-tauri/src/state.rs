use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::RwLock;
use tauri::{AppHandle, Emitter, Manager};

pub const SESSION_TTL_MILLIS: u64 = 12 * 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub user_id: String,
    pub username: String,
    pub token: String,
    pub expires_at_millis: u64,
}

impl Session {
    pub fn expired(&self) -> bool {
        self.expires_at_millis <= now_millis()
    }
}

pub struct AppState {
    pub session: RwLock<Option<Session>>,
    /// Запущенный процесс игры (для защиты от второго запуска и закрытия игры).
    pub game: RwLock<Option<std::process::Child>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            session: RwLock::new(None),
            game: RwLock::new(None),
        }
    }

    pub fn set_session(&self, s: Option<Session>) {
        *self.session.write().unwrap() = s;
    }

    pub fn current(&self) -> Option<Session> {
        let guard = self.session.read().ok()?;
        let s = guard.as_ref()?;
        (!s.expired()).then(|| s.clone())
    }

    /// Проверяет, жив ли процесс игры; подчищает состояние, если уже завершился.
    pub fn game_running(&self) -> bool {
        let mut g = self.game.write().unwrap();
        match g.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(_)) => {
                    *g = None;
                    false
                }
                Ok(None) => true,
                Err(_) => {
                    *g = None;
                    false
                }
            },
            None => false,
        }
    }

    /// Фоновый наблюдатель: когда Minecraft закроют сам по себе,
    /// состояние чистится и в UI отправляется событие "game-exited".
    pub fn spawn_game_watcher(app: AppHandle) {
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(1000));
            let running = app
                .try_state::<AppState>()
                .map(|s| s.game_running())
                .unwrap_or(false);
            if !running {
                let _ = app.emit("game-exited", ());
                return;
            }
        });
    }
}

pub fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

/// Общий объём установленной физической памяти в МБ (Windows: kernel32).
/// 0 = не удалось определить (клиент возьмёт разумные дефолты).
#[cfg(windows)]
pub fn total_ram_mb() -> u64 {
    #[link(name = "kernel32")]
    extern "system" {
        #[allow(non_snake_case)]
        fn GetPhysicallyInstalledSystemMemory(TotalMemoryInKilobytes: *mut u64) -> i32;
    }
    let mut kb: u64 = 0;
    unsafe {
        if GetPhysicallyInstalledSystemMemory(&mut kb) != 0 && kb > 0 {
            return kb / 1024;
        }
    }
    0
}

#[cfg(not(windows))]
pub fn total_ram_mb() -> u64 {
    0
}

/// Изолированная папка игры: <app_data>/instance (НЕ .minecraft).
/// Создаёт её при первом обращении, чтобы любая запись в файлы не падала (os error 3).
pub fn instance_dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("quasar-launcher"))
        .join("instance");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn session_file(app: &AppHandle) -> anyhow::Result<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!("app_data_dir: {e}"))?
        .join("launcher-session.json"))
}

pub fn save_session(app: &AppHandle, session: Option<&Session>) -> anyhow::Result<()> {
    let path = session_file(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
        match session {
        Some(s) => std::fs::write(&path, serde_json::to_vec_pretty(s)?).map_err(|e| e.into()),
        None => {
            if path.exists() {
                std::fs::remove_file(&path)?;
            }
            Ok(())
        }
    }
}

pub fn load_session(app: &AppHandle) -> Option<Session> {
    let path = session_file(app).ok()?;
    let data = std::fs::read(path).ok()?;
    let s: Session = serde_json::from_slice(&data).ok()?;
    (!s.expired()).then_some(s)
}
