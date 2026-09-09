use crate::state::Session;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

pub struct JavaRuntime {
    pub java_path: PathBuf,
    pub version: u32,
}

pub struct LaunchSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
}

impl JavaRuntime {
    /// Ищем Java 21+ (требование MC 1.21): JAVA_HOME, PATH, стандартные пути Windows.
    pub fn detect() -> anyhow::Result<JavaRuntime> {
        let candidates: Vec<PathBuf> = {
            let mut v = Vec::new();
            if let Ok(home) = std::env::var("JAVA_HOME") {
                v.push(PathBuf::from(home).join("bin").join(java_exe()));
            }
            if let Ok(path_var) = std::env::var("PATH") {
                for dir in std::env::split_paths(&path_var) {
                    v.push(dir.join(java_exe()));
                }
            }
            // Типичные пути установки Temurin/Oracle на Windows
            for glob in ["C:/Program Files/Java", "C:/Program Files/Eclipse Adoptium"] {
                if let Ok(rd) = std::fs::read_dir(glob) {
                    for entry in rd.flatten() {
                        v.push(entry.path().join("bin").join(java_exe()));
                    }
                }
            }
            v
        };

        let mut newest: Option<(u32, JavaRuntime)> = None;
        for c in candidates {
            if !c.exists() {
                continue;
            }
            // java.exe — консольное приложение: без CREATE_NO_WINDOW каждое
            // окно кандидата будет мигать при поиске (выглядит как «консольки»)
            let out = {
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
                    let mut ver_cmd = Command::new(&c);
                    ver_cmd.arg("-version").creation_flags(CREATE_NO_WINDOW);
                    ver_cmd.output()
                }
                #[cfg(not(windows))]
                {
                    Command::new(&c).arg("-version").output()
                }
            };
            if let Ok(out) = out {
                let s = String::from_utf8_lossy(&out.stderr).to_string();
                if let Some(ver) = parse_java_version(&s) {
                    if ver >= 21 && newest.as_ref().is_none_or(|(v, _)| ver > *v) {
                        newest = Some((ver, JavaRuntime { java_path: c, version: ver }));
                    }
                }
            }
        }
        newest.map(|(_, r)| r).ok_or_else(|| {
            anyhow::anyhow!("Java 21+ не найдена. Установите Eclipse Temurin 21 (https://adoptium.net)")
        })
    }
}

fn java_exe() -> &'static str {
    if cfg!(windows) {
        "java.exe"
    } else {
        "java"
    }
}

fn parse_java_version(s: &str) -> Option<u32> {
    // строка вида: openjdk version "21.0.4" ...
    let idx = s.find('"')? + 1;
    let rest = &s[idx..];
    let end = rest.find('"')?;
    let first = rest[..end].split('.').next()?;
    first.parse().ok()
}

/// Защитные JVM-флаги: запрет attach и SecurityManager.
/// ВАЖНО: `-javaagent` для authlib-injector разрешён (агенты блокируем
/// только в рантайме через DisableAttachMechanism, не через jdk.instrument).
fn protection_flags() -> Vec<String> {
    vec![
        // Запрет attach-агентов в рантайме (основной вектор инжекта читов)
        "-XX:+DisableAttachMechanism".into(),
        "-Djdk.attach.allowAttachSelf=false".into(),
        // SecurityManager запрещён (JEP 486), задвоение не повредит
        "-Djava.security.manager=disallow".into(),
    ]
}

/// Собирает полный argv запуска Fabric-клиента.
pub fn build_launch(
    rt: &JavaRuntime,
    game_dir: &Path,
    session: &Session,
    ygg: &crate::api::YggTokenResponse,
    ram_mb: u32,
) -> anyhow::Result<LaunchSpec> {
    // Фабричный main class Fabric Loader (устанавливается при подготовке инстанса)
    let fabric_main_class = "net.fabricmc.loader.impl.launch.knot.KnotClient";

    let classpath = build_classpath(game_dir)?;

    // authlib-injector: подменяет Yggdrasil/Mojang-авторизацию на наш сервер
    let agent = crate::install::authlib_injector_path(game_dir);
    anyhow::ensure!(
        agent.exists(),
        "authlib-injector.jar не найден в instance — запустите «Проверить файлы»"
    );
    let api_root = crate::api::api_base();

    let mut args: Vec<String> = vec![
        format!("-Xmx{ram_mb}M"),
        format!("-Xms{}M", (ram_mb / 2).max(512)),
        // javaagent ДО защиты: редирект session-вызовов на наш Yggdrasil
        format!("-javaagent:{}={api_root}", agent.to_string_lossy().replace('\\', "/")),
    ];
    args.extend(protection_flags());
    // Игровой accessToken (одноразовый Yggdrasil-токен). JWT лаунчера не покидает процесс.
    args.push(format!("-Dlauncher.accessToken={}", ygg.access_token));
    args.push(format!("-Dlauncher.username={}", session.username));
    args.push(format!("-Dlauncher.userId={}", session.user_id));
    args.push("-Dfabric.gameDir=".to_string() + game_dir.to_string_lossy().as_ref());
    args.push("-cp".into());
    args.push(classpath);
    args.push(fabric_main_class.into());
    args.push("--username".into());
    args.push(session.username.clone());
    // Офлайн UUID (OfflinePlayer:<name>) — совпадает с Yggdrasil-профилем на бэкенде
    args.push("--uuid".into());
    args.push(crate::verify::offline_uuid(&session.username)?);
    args.push("--version".into());
    args.push("1.21.11".into());
    args.push("--accessToken".into());
    args.push(ygg.access_token.clone());
    args.push("--userType".into());
    args.push("msa".into());
    // Папки игры и ассетов, скачанных install.rs
    args.push("--gameDir".into());
    args.push(game_dir.to_string_lossy().into_owned());
    args.push("--assetsDir".into());
    args.push(game_dir.join("assets").to_string_lossy().into_owned());
    let idx_id = std::fs::read_to_string(
        game_dir.join("versions").join(crate::install::MC_VERSION).join("asset-index.txt"),
    )
    .unwrap_or_default();
    let idx_id = idx_id.trim().to_string();
    if !idx_id.is_empty() {
        args.push("--assetIndex".into());
        args.push(idx_id);
    }

    Ok(LaunchSpec {
        program: rt.java_path.clone(),
        args,
    })
}

/// Временный classpath-файл (@argfile), чтобы не упереться в лимит длины командной строки Windows.
fn build_classpath(game_dir: &Path) -> anyhow::Result<String> {
    let mut entries: Vec<String> = Vec::new();

    let add_dir_jars = |dir: &Path, entries: &mut Vec<String>, recursive: bool| -> anyhow::Result<()> {
        if dir.exists() {
            let mut walker = walkdir::WalkDir::new(dir);
            if !recursive {
                walker = walker.max_depth(1);
            }
            for e in walker {
                let e = e?;
                if e.file_type().is_file() {
                    let p = e.path().to_string_lossy().replace('\\', "/");
                    entries.push(p);
                }
            }
        }
        Ok(())
    };

    add_dir_jars(&game_dir.join("libraries"), &mut entries, true)?;
    add_dir_jars(&game_dir.join("mods"), &mut entries, false)?;

    // Ванильный jar должен появиться после подготовителя инстанса; если его нет — ошибка
    let vanilla = game_dir.join("versions/1.21.11/1.21.11.jar");
    if !vanilla.exists() {
        anyhow::bail!(
            "Не найден ванильный jar: {}. Запуск возможен после подготовки инстанса (versions/1.21.11).",
            vanilla.display()
        );
    }
    entries.push(vanilla.to_string_lossy().replace('\\', "/"));

    Ok(entries.join(if cfg!(windows) { ";" } else { ":" }))
}

/// Собирает argv и запускает JVM.
/// Вывод игры пишется в <game_dir>/quasar-game.log (для диагностики вылетов),
/// консольное окно java.exe подавляется (CREATE_NO_WINDOW).
pub fn spawn(
    rt: &JavaRuntime,
    game_dir: &Path,
    session: &Session,
    ygg: &crate::api::YggTokenResponse,
    ram_mb: u32,
) -> anyhow::Result<Child> {
    let spec = build_launch(rt, game_dir, session, ygg, ram_mb)?;
    std::fs::create_dir_all(game_dir)?;

    let log_path = game_dir.join("quasar-game.log");
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)?;
    let stderr = log_file.try_clone()?;

    // javaw.exe (GUI-подсистема) вместо java.exe: консоль невозможна в принципе.
    // CREATE_NO_WINDOW оставляем как страховку.
    let mut program = spec.program;
    if program.file_name().map(|f| f == "java.exe").unwrap_or(false) {
        let javaw = program.with_file_name("javaw.exe");
        if javaw.exists() {
            program = javaw;
        }
    }

    let mut cmd = Command::new(&program);
    cmd.args(&spec.args)
        .current_dir(game_dir)
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(stderr));

    // java.exe — консольное приложение: без этого флага Windows рисует терминал
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn().map_err(|e| anyhow::anyhow!("запуск JVM: {e}"))
}
