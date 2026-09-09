use serde::{Deserialize, Serialize};

/// Базовый URL бэкенда. Можно переопределить переменной QUASAR_API.
pub fn api_base() -> String {
    std::env::var("QUASAR_API").unwrap_or_else(|_| "http://139.100.234.146:3000".into())
}

/// Полный URL эндпоинта.
fn url(path: &str) -> String {
    format!("{}{}", api_base(), path)
}

/// HTTP-клиент без куки/редиректов на чужие домены, с таймаутами.
pub fn http() -> anyhow::Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()?)
}

#[derive(Debug, Deserialize)]
pub struct LoginResponse {
    pub token: String,
    #[serde(rename = "expiresAt")]
    #[allow(dead_code)]
    pub expires_at: String,
    pub user: User,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub username: String,
}

#[derive(Debug, Serialize)]
pub struct LoginBody<'a> {
    pub username: &'a str,
    pub password: &'a str,
    #[serde(rename = "clientHash")]
    pub client_hash: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModEntry {
    pub id: String,
    #[serde(rename = "modType")]
    pub mod_type: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "githubUrl")]
    pub github_url: String,
    #[serde(rename = "downloadUrl")]
    pub download_url: Option<String>,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "sha256Hash")]
    pub sha256_hash: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModsResponse {
    pub required: Vec<ModEntry>,
    pub optional: Vec<ModEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestFile {
    pub path: String,
    pub sha256: String,
}

#[derive(Debug, Deserialize)]
pub struct ManifestResponse {
    pub files: Vec<ManifestFile>,
}

#[derive(Debug, Deserialize)]
pub struct SkinResponse {
    pub resolution: u32,
    #[serde(rename = "modelType")]
    pub model_type: String,
    pub image: String,
}

/// Игровой Yggdrasil-токен (выдаётся на один запуск, ротируется refresh'ем).
#[derive(Debug, Clone, Deserialize)]
pub struct YggTokenResponse {
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "expiresAt")]
    #[allow(dead_code)]
    pub expires_at: String,
    pub profile: YggProfile,
}

#[derive(Debug, Clone, Deserialize)]
pub struct YggProfile {
    /// UUID без дефисов
    pub id: String,
    pub name: String,
}

/// Сырые ошибки reqwest -> понятные русские сообщения (без URL и английского).
fn friendly_network_error(e: reqwest::Error) -> anyhow::Error {
    if e.is_connect() {
        anyhow::anyhow!("Сервер недоступен. Проверьте интернет-соединение")
    } else if e.is_timeout() {
        anyhow::anyhow!("Сервер не отвечает. Попробуйте позже")
    } else {
        anyhow::anyhow!("Ошибка сети. Попробуйте позже")
    }
}

/// Публичная обёртка для updater.rs.
pub fn friendly_network_error_pub(e: reqwest::Error) -> anyhow::Error {
    friendly_network_error(e)
}

/// Код ошибки из тела ответа бэкенда (INVALID_CREDENTIALS и т.п.).
/// URL не показываем; фронт переводит коды в русский текст.
async fn error_with_body(resp: reqwest::Response) -> anyhow::Error {
    let body = resp.text().await.unwrap_or_default();
    let code = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from))
        .unwrap_or_else(|| "SERVER_ERROR".to_string());
    anyhow::anyhow!("{code}")
}

/// POST-запрос с JSON-телом, возвращает разобранный ответ.
pub async fn post_json<T: serde::de::DeserializeOwned, B: serde::Serialize>(
    path: &str,
    body: &B,
) -> anyhow::Result<T> {
    let resp = http()?
        .post(&url(path))
        .json(body)
        .send()
        .await
        .map_err(friendly_network_error)?;
    if !resp.status().is_success() {
        return Err(error_with_body(resp).await);
    }
    resp.json::<T>()
        .await
        .map_err(|_| anyhow::anyhow!("Сервер вернул некорректный ответ"))
}

/// GET-запрос с Bearer-токеном.
#[allow(dead_code)]
pub async fn get_auth_json<T: serde::de::DeserializeOwned>(
    path: &str,
    token: &str,
) -> anyhow::Result<T> {
    let resp = http()?.get(&url(path)).bearer_auth(token).send().await.map_err(friendly_network_error)?;
    if !resp.status().is_success() {
        return Err(error_with_body(resp).await);
    }
    resp.json::<T>().await.map_err(|_| anyhow::anyhow!("Сервер вернул некорректный ответ"))
}

/// GET JSON без авторизации.
pub async fn get_json<T: serde::de::DeserializeOwned>(path: &str) -> anyhow::Result<T> {
    let resp = http()?.get(&url(path)).send().await.map_err(friendly_network_error)?;
    if !resp.status().is_success() {
        return Err(error_with_body(resp).await);
    }
    resp.json::<T>().await.map_err(|_| anyhow::anyhow!("Сервер вернул некорректный ответ"))
}

/// GET с Bearer-токеном; 404 возвращает Ok(None) (например, «скина нет»).
pub async fn get_auth_json_opt<T: serde::de::DeserializeOwned>(
    path: &str,
    token: &str,
) -> anyhow::Result<Option<T>> {
    let resp = http()?
        .get(&url(path))
        .bearer_auth(token)
        .send()
        .await
        .map_err(friendly_network_error)?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(error_with_body(resp).await);
    }
    resp.json::<T>()
        .await
        .map(Some)
        .map_err(|_| anyhow::anyhow!("Сервер вернул некорректный ответ"))
}

/// POST JSON с Bearer-токеном.
///
/// Тело отправляется мелкими кусочками с паузами: через некоторые
/// VPN/прокси-туннели (sing-box/happ и т.п.) крупный единый TCP-бёрст
/// обрывается (ConnectionReset), из-за чего загрузка скина падала
/// с «Ошибка сети». Нарезка на ~1.4 KB с задержками обходит это.
pub async fn post_auth_json<T: serde::de::DeserializeOwned, B: serde::Serialize>(
    path: &str,
    body: &B,
    token: &str,
) -> anyhow::Result<T> {
    let json = serde_json::to_vec(body).map_err(|e| anyhow::anyhow!("Ошибка сериализации: {e}"))?;
    // До 3 попыток: через VPN-туннели редкие обрывы всё же случаются,
    // а загрузка скина идемпотентна (upsert на бэкенде)
    let mut last_err: Option<anyhow::Error> = None;
    for attempt in 0..3u32 {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(500 * u64::from(attempt))).await;
        }
        let resp = match http()?
            .post(&url(path))
            .bearer_auth(token)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(reqwest::Body::wrap_stream(paced_chunks(json.clone())))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                // Сбой сети — пробуем снова; последняя попытка возвращает ошибку
                last_err = Some(friendly_network_error(e));
                continue;
            }
        };
        if !resp.status().is_success() {
            return Err(error_with_body(resp).await);
        }
        return resp
            .json::<T>()
            .await
            .map_err(|_| anyhow::anyhow!("Сервер вернул некорректный ответ"));
    }
    Err(last_err.unwrap_or_else(|| anyhow::anyhow!("Ошибка сети. Попробуйте позже")))
}

/// Стрим, отдающий тело кусочками ~1400 байт с паузами 2 мс
/// (обход туннелей, рвущих соединение на больших бёрстах).
fn paced_chunks(
    data: Vec<u8>,
) -> impl futures_util::Stream<Item = reqwest::Result<Vec<u8>>> {
    futures_util::stream::unfold(Some(data), |state: Option<Vec<u8>>| async move {
        let mut rest = state?;
        if rest.is_empty() {
            return None;
        }
        let end = rest.len().min(1400);
        let tail = rest.split_off(end);
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        let piece = rest;
        Some((Ok(piece), Some(tail)))
    })
}
