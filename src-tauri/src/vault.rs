use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use hmac::Hmac;
use once_cell::sync::Lazy;
use pbkdf2::pbkdf2;
use rand::RngCore;
use serde_json::Value;
use sha2::Sha256;
use std::env;

const VAULT_PREFIX_V2: &str = "enc:v2:aes-gcm:";
const VAULT_SALT: &[u8] = b"MychalSMP_Vault_HardwareBound_Salt_v2_2026";

static DERIVED_KEY: Lazy<[u8; 32]> = Lazy::new(|| {
    let username = env::var("USER")
        .or_else(|_| env::var("USERNAME"))
        .unwrap_or_else(|_| "player".to_string());
    let hostname = sysinfo::System::host_name().unwrap_or_else(|| "localhost".to_string());
    let platform = if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    };
    let arch = match env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let entropy = format!("{}|{}|{}|{}|{}", hostname, username, platform, arch, home);
    let mut key = [0u8; 32];
    let _ = pbkdf2::<Hmac<Sha256>>(entropy.as_bytes(), VAULT_SALT, 100_000, &mut key);
    key
});

pub fn encrypt_secret(plain_text: &str) -> String {
    if plain_text.is_empty() {
        return String::new();
    }
    if plain_text.starts_with(VAULT_PREFIX_V2) || plain_text.starts_with("enc:v1:dpapi:") {
        return plain_text.to_string();
    }

    let key = Key::<Aes256Gcm>::from_slice(&*DERIVED_KEY);
    let cipher = Aes256Gcm::new(key);
    let mut iv = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut iv);
    let nonce = Nonce::from_slice(&iv);

    match cipher.encrypt(nonce, plain_text.as_bytes()) {
        Ok(mut ciphertext_with_tag) => {
            if ciphertext_with_tag.len() >= 16 {
                let tag_offset = ciphertext_with_tag.len() - 16;
                let tag = ciphertext_with_tag.split_off(tag_offset);
                format!(
                    "{}{}:{}:{}",
                    VAULT_PREFIX_V2,
                    BASE64.encode(iv),
                    BASE64.encode(tag),
                    BASE64.encode(ciphertext_with_tag)
                )
            } else {
                plain_text.to_string()
            }
        }
        Err(_) => plain_text.to_string(),
    }
}

pub fn decrypt_secret(cipher_text: &str) -> Option<String> {
    if cipher_text.is_empty() {
        return None;
    }
    if cipher_text.starts_with(VAULT_PREFIX_V2) {
        let payload = &cipher_text[VAULT_PREFIX_V2.len()..];
        let parts: Vec<&str> = payload.split(':').collect();
        if parts.len() != 3 {
            return None;
        }
        let iv = BASE64.decode(parts[0]).ok()?;
        let tag = BASE64.decode(parts[1]).ok()?;
        let mut encrypted = BASE64.decode(parts[2]).ok()?;
        if iv.len() != 12 || tag.len() != 16 {
            return None;
        }
        encrypted.extend_from_slice(&tag);

        let key = Key::<Aes256Gcm>::from_slice(&*DERIVED_KEY);
        let cipher = Aes256Gcm::new(key);
        let nonce = Nonce::from_slice(&iv);
        let decrypted = cipher.decrypt(nonce, encrypted.as_ref()).ok()?;
        return String::from_utf8(decrypted).ok();
    }
    if cipher_text.starts_with("enc:v1:dpapi:") {
        return None;
    }
    Some(cipher_text.to_string())
}

pub fn protect_account_for_disk(account: &Value) -> Value {
    if !account.is_object() {
        return account.clone();
    }
    let mut copy = account.clone();
    if let Some(obj) = copy.as_object_mut() {
        if let Some(at) = obj.get("accessToken").and_then(|v| v.as_str()) {
            if !at.is_empty() {
                obj.insert(
                    "accessToken".to_string(),
                    Value::String(encrypt_secret(at)),
                );
            }
        }
        if let Some(rt) = obj.get("refreshToken").and_then(|v| v.as_str()) {
            if !rt.is_empty() {
                obj.insert(
                    "refreshToken".to_string(),
                    Value::String(encrypt_secret(rt)),
                );
            }
        }
        if let Some(mclc) = obj.get("mclcAuth") {
            if mclc.is_object() {
                let raw = serde_json::to_string(mclc).unwrap_or_default();
                obj.insert(
                    "mclcAuthEncrypted".to_string(),
                    Value::String(encrypt_secret(&raw)),
                );
                obj.remove("mclcAuth");
            }
        }
    }
    copy
}

pub fn unprotect_account_from_disk(account: &Value) -> Option<Value> {
    if !account.is_object() {
        return None;
    }
    let mut copy = account.clone();
    let obj = copy.as_object_mut()?;

    if let Some(at) = obj.get("accessToken").and_then(|v| v.as_str()) {
        match decrypt_secret(at) {
            Some(dec) => {
                obj.insert("accessToken".to_string(), Value::String(dec));
            }
            None => return None,
        }
    }

    if let Some(rt) = obj.get("refreshToken").and_then(|v| v.as_str()) {
        if let Some(dec) = decrypt_secret(rt) {
            obj.insert("refreshToken".to_string(), Value::String(dec));
        } else {
            obj.remove("refreshToken");
        }
    }

    if let Some(enc_mclc) = obj
        .get("mclcAuthEncrypted")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
    {
        if let Some(raw) = decrypt_secret(&enc_mclc) {
            if let Ok(parsed) = serde_json::from_str::<Value>(&raw) {
                obj.insert("mclcAuth".to_string(), parsed);
            }
        }
        obj.remove("mclcAuthEncrypted");
    }

    Some(copy)
}

pub fn sanitize_account_for_renderer(account: &Value) -> Value {
    if !account.is_object() {
        return Value::Null;
    }
    let obj = match account.as_object() {
        Some(o) => o,
        None => return Value::Null,
    };
    let has_valid_token = obj
        .get("accessToken")
        .and_then(|v| v.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false)
        || obj.get("mclcAuth").map(|v| v.is_object()).unwrap_or(false);

    serde_json::json!({
        "name": obj.get("name").and_then(|v| v.as_str()).unwrap_or("Player"),
        "uuid": obj.get("uuid").and_then(|v| v.as_str()).unwrap_or(""),
        "type": obj.get("type").and_then(|v| v.as_str()).unwrap_or("microsoft"),
        "expiresAt": obj.get("expiresAt").cloned().unwrap_or(Value::Null),
        "authenticated": has_valid_token
    })
}

