use crate::config::{load_config, save_config};
use crate::vault::sanitize_account_for_renderer;
use md5::{Digest, Md5};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

const MS_CLIENT_ID: &str = "00000000402b5328";
const MS_REDIRECT_URI: &str = "https://login.live.com/oauth20_desktop.srf";
const MS_AUTH_URL: &str = "https://login.live.com/oauth20_authorize.srf?client_id=00000000402b5328&response_type=code&scope=service%3A%3Auser.auth.xboxlive.com%3A%3AMBI_SSL&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf&prompt=select_account";

pub fn generate_offline_uuid(username: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(format!("OfflinePlayer:{}", username).as_bytes());
    let mut bytes: [u8; 16] = hasher.finalize().into();
    bytes[6] = (bytes[6] & 0x0f) | 0x30; // Version 3
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant RFC4122
    let hex_str = hex::encode(bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &hex_str[0..8],
        &hex_str[8..12],
        &hex_str[12..16],
        &hex_str[16..20],
        &hex_str[20..32]
    )
}

pub fn format_dashed_uuid(raw_uuid: &str) -> String {
    let clean = raw_uuid.replace('-', "");
    if clean.len() == 32 {
        format!(
            "{}-{}-{}-{}-{}",
            &clean[0..8],
            &clean[8..12],
            &clean[12..16],
            &clean[16..20],
            &clean[20..32]
        )
    } else {
        raw_uuid.to_string()
    }
}

pub fn create_offline_auth(username: &str) -> Result<Value, String> {
    let clean = username.trim();
    let valid = clean.len() >= 3
        && clean.len() <= 16
        && clean.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !valid {
        return Err("Herní nick musí mít 3–16 znaků (pouze písmena, čísla a podtržítko).".to_string());
    }
    let uuid = generate_offline_uuid(clean);
    Ok(json!({
        "access_token": uuid,
        "client_token": uuid,
        "uuid": uuid,
        "name": clean,
        "user_properties": "{}",
        "meta": {
            "type": "offline",
            "demo": false
        }
    }))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

async fn exchange_ms_token_to_minecraft(
    ms_access_token: &str,
    ms_refresh_token: &str,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("MychalSMP-Launcher/1.4.6")
        .build()
        .map_err(|e| e.to_string())?;

    // 1. Xbox Live (XBL) Authenticate
    let xbl_resp = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": format!("t={}", ms_access_token)
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|e| format!("Chyba připojení k Xbox Live: {}", e))?;

    if !xbl_resp.status().is_success() {
        return Err(format!("Xbox Live autentizace selhala (HTTP {}).", xbl_resp.status()));
    }
    let xbl_json: Value = xbl_resp.json().await.map_err(|e| e.to_string())?;
    let xbl_token = xbl_json
        .get("Token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Xbox Live nevrátil platný token.".to_string())?;
    let uhs = xbl_json
        .pointer("/DisplayClaims/xui/0/uhs")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Xbox Live nevrátil User Hash (uhs).".to_string())?;

    // 2. XSTS Authorize for Minecraft Services
    let xsts_resp = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&json!({
            "Properties": {
                "SandboxId": "RETAIL",
                "UserTokens": [xbl_token]
            },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|e| format!("Chyba připojení k XSTS: {}", e))?;

    if !xsts_resp.status().is_success() {
        let err_json: Value = xsts_resp.json().await.unwrap_or_default();
        let xerr = err_json.get("XErr").and_then(|v| v.as_u64()).unwrap_or(0);
        let msg = match xerr {
            2148916233 => "Tento Microsoft účet nemá vytvořený Xbox profil.",
            2148916235 => "Xbox Live není ve tvém regionu podporován.",
            2148916236 | 2148916237 => "Účet vyžaduje ověření věku dospělým na webu Xbox.",
            2148916238 => "Dětský účet (<18 let) musí být nejprve přidán do Microsoft Rodiny (Family) dospělým.",
            _ => "XSTS autorizace selhala.",
        };
        return Err(msg.to_string());
    }

    let xsts_json: Value = xsts_resp.json().await.map_err(|e| e.to_string())?;
    let xsts_token = xsts_json
        .get("Token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "XSTS nevrátil platný token.".to_string())?;

    // 3. Minecraft login_with_xbox
    let mc_resp = client
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&json!({
            "identityToken": format!("XBL3.0 x={};{}", uhs, xsts_token)
        }))
        .send()
        .await
        .map_err(|e| format!("Chyba připojení k Minecraft Services: {}", e))?;

    if !mc_resp.status().is_success() {
        return Err(format!(
            "Minecraft Services přihlášení selhalo (HTTP {}).",
            mc_resp.status()
        ));
    }

    let mc_json: Value = mc_resp.json().await.map_err(|e| e.to_string())?;
    let mc_access_token = mc_json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Minecraft Services nevrátil access_token.".to_string())?;
    let expires_in = mc_json
        .get("expires_in")
        .and_then(|v| v.as_u64())
        .unwrap_or(86400);

    // 4. Fetch Minecraft Profile
    let profile_resp = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(mc_access_token)
        .send()
        .await
        .map_err(|e| format!("Chyba při načítání Minecraft profilu: {}", e))?;

    if profile_resp.status().as_u16() == 404 || !profile_resp.status().is_success() {
        return Err("Tento Microsoft účet nevlastní zakoupenou hru Minecraft: Java Edition.".to_string());
    }

    let profile_json: Value = profile_resp.json().await.map_err(|e| e.to_string())?;
    let raw_uuid = profile_json
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Na tomto účtu nebyl nalezen profil Minecraft: Java Edition.".to_string())?;
    let name = profile_json
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Player");
    let dashed_uuid = format_dashed_uuid(raw_uuid);
    let expires_at = now_ms() + expires_in * 1000;

    Ok(json!({
        "name": name,
        "uuid": dashed_uuid,
        "rawUuid": raw_uuid.replace('-', ""),
        "accessToken": mc_access_token,
        "refreshToken": ms_refresh_token,
        "expiresAt": expires_at,
        "type": "microsoft",
        "mclcAuth": {
            "access_token": mc_access_token,
            "client_token": dashed_uuid,
            "uuid": raw_uuid.replace('-', ""),
            "name": name,
            "user_properties": "{}",
            "meta": {
                "type": "msa",
                "demo": false
            }
        }
    }))
}

pub async fn login_microsoft_flow(app: AppHandle) -> Result<Value, String> {
    let _ = app.emit(
        "auth-status",
        "Otevírám přihlašovací okno Microsoft...",
    );

    if let Some(existing) = app.get_webview_window("ms-auth") {
        let _ = existing.close();
    }

    let (tx, rx) = oneshot::channel::<Result<String, String>>();
    let tx_shared = Arc::new(Mutex::new(Some(tx)));
    let tx_nav = Arc::clone(&tx_shared);

    let parsed_url: url::Url = MS_AUTH_URL.parse().map_err(|e: url::ParseError| e.to_string())?;
    let auth_win = WebviewWindowBuilder::new(&app, "ms-auth", WebviewUrl::External(parsed_url))
        .title("Přihlášení k účtu Microsoft — SMPClient")
        .inner_size(520.0, 680.0)
        .center()
        .resizable(true)
        .on_navigation(move |nav_url| {
            let url_str = nav_url.as_str();
            if url_str.starts_with(MS_REDIRECT_URI) || url_str.contains("oauth20_desktop.srf") {
                if let Some( code ) = nav_url.query_pairs().find(|(k, _)| k == "code").map(|(_, v)| v.to_string()) {
                    if let Ok(mut guard) = tx_nav.lock() {
                        if let Some(sender) = guard.take() {
                            let _ = sender.send(Ok(code));
                        }
                    }
                    return false;
                }
                if let Some( error_desc ) = nav_url.query_pairs().find(|(k, _)| k == "error_description" || k == "error").map(|(_, v)| v.to_string()) {
                    if let Ok(mut guard) = tx_nav.lock() {
                        if let Some(sender) = guard.take() {
                            let _ = sender.send(Err(format!("Přihlášení bylo zrušeno ({})", error_desc)));
                        }
                    }
                    return false;
                }
            }
            true
        })
        .build()
        .map_err(|e| format!("Nepodařilo se otevřít přihlašovací okno: {}", e))?;

    let tx_close = Arc::clone(&tx_shared);
    auth_win.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            if let Ok(mut guard) = tx_close.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(Err("Přihlašovací okno bylo zavřeno.".to_string()));
                }
            }
        }
    });

    let auth_code = match rx.await {
        Ok(Ok(code)) => {
            let _ = auth_win.close();
            code
        }
        Ok(Err(e)) => {
            let _ = auth_win.close();
            return Err(e);
        }
        Err(_) => {
            let _ = auth_win.close();
            return Err("Přihlášení bylo přerušeno.".to_string());
        }
    };

    let _ = app.emit(
        "auth-status",
        "Ověřuji Microsoft účet a Xbox Live...",
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let token_resp = client
        .post("https://login.live.com/oauth20_token.srf")
        .form(&[
            ("client_id", MS_CLIENT_ID),
            ("code", auth_code.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", MS_REDIRECT_URI),
            ("scope", "service::user.auth.xboxlive.com::MBI_SSL"),
        ])
        .send()
        .await
        .map_err(|e| format!("Nepodařilo se ověřit OAuth kód: {}", e))?;

    if !token_resp.status().is_success() {
        return Err("Chyba při výměně OAuth2 tokenu s Microsoftem.".to_string());
    }

    let token_json: Value = token_resp.json().await.map_err(|e| e.to_string())?;
    let ms_access = token_json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Microsoft nevrátil access_token.".to_string())?;
    let ms_refresh = token_json
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let account = exchange_ms_token_to_minecraft(ms_access, ms_refresh).await?;
    save_config(&json!({
        "authType": "microsoft",
        "microsoftAccount": account
    }));

    Ok(sanitize_account_for_renderer(&account))
}

pub async fn refresh_microsoft_session(force: bool) -> Result<Value, String> {
    let cfg = load_config();
    let ms = cfg
        .get("microsoftAccount")
        .cloned()
        .unwrap_or(Value::Null);
    if !ms.is_object() {
        return Err("Žádný Microsoft účet není uložen.".to_string());
    }

    let expires_at = ms.get("expiresAt").and_then(|v| v.as_u64()).unwrap_or(0);
    let has_token = ms
        .get("accessToken")
        .and_then(|v| v.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false);

    // If not forced and still valid for > 15 minutes, verify quickly against profile endpoint
    if !force && has_token && expires_at > now_ms() + 15 * 60 * 1000 {
        return Ok(ms);
    }

    let refresh_token = ms
        .get("refreshToken")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if refresh_token.is_empty() {
        if has_token {
            return Ok(ms);
        }
        return Err("Chybí obnovovací token Microsoft účtu. Přihlas se prosím znovu.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let token_resp = client
        .post("https://login.live.com/oauth20_token.srf")
        .form(&[
            ("client_id", MS_CLIENT_ID),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
            ("redirect_uri", MS_REDIRECT_URI),
            ("scope", "service::user.auth.xboxlive.com::MBI_SSL"),
        ])
        .send()
        .await
        .map_err(|e| format!("Obnova Microsoft relace selhala: {}", e))?;

    if !token_resp.status().is_success() {
        if has_token && expires_at > now_ms() {
            return Ok(ms);
        }
        return Err("Platnost přihlášení vypršela. Přihlas se prosím znovu.".to_string());
    }

    let token_json: Value = token_resp.json().await.map_err(|e| e.to_string())?;
    let ms_access = token_json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Microsoft nevrátil nový access_token.".to_string())?;
    let new_refresh = token_json
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or(refresh_token);

    let refreshed = exchange_ms_token_to_minecraft(ms_access, new_refresh).await?;
    save_config(&json!({
        "microsoftAccount": refreshed
    }));

    Ok(refreshed)
}

