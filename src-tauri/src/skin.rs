use crate::auth::refresh_microsoft_session;
use crate::config::{get_default_game_dir, load_config, resolve_profile_dir, save_config};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::multipart::{Form, Part};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub fn get_curated_skin_catalog() -> Value {
    json!({
        "skins": [
            {
                "id": "default_steve",
                "name": "Klasický Steve",
                "category": "Klasika",
                "variant": "classic",
                "url": "assets/default_steve.png",
                "previewNick": "MHF_Steve"
            },
            {
                "id": "default_alex",
                "name": "Klasická Alex",
                "category": "Klasika",
                "variant": "slim",
                "url": "assets/default_alex.png",
                "previewNick": "MHF_Alex"
            },
            {
                "id": "mychal_founder",
                "name": "mychalVidea (Founder)",
                "category": "MYCHAL SMP",
                "variant": "classic",
                "url": "https://mc-heads.net/skin/mychalVidea",
                "previewNick": "mychalVidea"
            },
            {
                "id": "smp_knight",
                "name": "Temný Rytíř",
                "category": "Bojovníci",
                "variant": "classic",
                "url": "https://mc-heads.net/skin/Knight",
                "previewNick": "Knight"
            },
            {
                "id": "smp_samurai",
                "name": "Krvavý Samuraj",
                "category": "Bojovníci",
                "variant": "classic",
                "url": "https://mc-heads.net/skin/Samurai",
                "previewNick": "Samurai"
            },
            {
                "id": "smp_assassin",
                "name": "Stínový Lovec",
                "category": "Bojovníci",
                "variant": "slim",
                "url": "https://mc-heads.net/skin/Shadow",
                "previewNick": "Shadow"
            },
            {
                "id": "smp_cyber",
                "name": "Neon Runner",
                "category": "Moderní",
                "variant": "classic",
                "url": "https://mc-heads.net/skin/Cyber",
                "previewNick": "Cyber"
            },
            {
                "id": "smp_astronaut",
                "name": "Hvězdný Poutník",
                "category": "Moderní",
                "variant": "classic",
                "url": "https://mc-heads.net/skin/Astronaut",
                "previewNick": "Astronaut"
            },
            {
                "id": "smp_mage",
                "name": "Arcimág Endu",
                "category": "Fantasy",
                "variant": "classic",
                "url": "https://mc-heads.net/skin/Wizard",
                "previewNick": "Wizard"
            },
            {
                "id": "smp_viking",
                "name": "Severský Jarl",
                "category": "Bojovníci",
                "variant": "classic",
                "url": "https://mc-heads.net/skin/Viking",
                "previewNick": "Viking"
            },
            {
                "id": "smp_panda",
                "name": "Bambusový Mistr",
                "category": "Zábavné",
                "variant": "classic",
                "url": "https://mc-heads.net/skin/Panda",
                "previewNick": "Panda"
            },
            {
                "id": "smp_axolotl",
                "name": "Modrý Axolotl",
                "category": "Zábavné",
                "variant": "slim",
                "url": "https://mc-heads.net/skin/Axolotl",
                "previewNick": "Axolotl"
            }
        ],
        "capes": [
            { "id": "none", "name": "Žádná kápě", "url": null },
            {
                "id": "migrator",
                "name": "Migrator Cape",
                "url": "https://textures.minecraft.net/texture/2340c0e03dd24a11b15a8b33c2a7e9e32abb2051b2481d0ba7defd635ca7a933"
            },
            {
                "id": "vanilla",
                "name": "Vanilla Cape",
                "url": "https://textures.minecraft.net/texture/17912790ff164b93196f08ba71d0e62129304776d0f347334f8a6eae509f8a56"
            },
            {
                "id": "cherry",
                "name": "Cherry Blossom",
                "url": "https://textures.minecraft.net/texture/badc048a7ce78f7dad72a07da27d85c0916881e5522eeed1e33217a38c1a"
            },
            {
                "id": "minecon2016",
                "name": "Minecon 2016 (Enderman)",
                "url": "https://textures.minecraft.net/texture/e7dfea16dc83c97df01a12fabbd1216359c0cd0ea42f9999b6e97c584963e980"
            },
            {
                "id": "minecon2013",
                "name": "Minecon 2013 (Piston)",
                "url": "https://textures.minecraft.net/texture/153b1a0dfcbae953cdeb6f2c2bf6bf79943239b1372780da44bcbb29273131da"
            }
        ]
    })
}

pub fn file_to_data_url(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    Some(format!("data:image/png;base64,{}", BASE64.encode(bytes)))
}

fn sync_local_selfnametag_skin(skin_bytes: Option<&[u8]>, cape_bytes: Option<&[u8]>) {
    let cfg = load_config();
    let base_dir = cfg
        .get("gameDirectory")
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
        .unwrap_or_else(get_default_game_dir);
    let prof_dir = resolve_profile_dir(&cfg, None);

    for dir in [&base_dir, &prof_dir] {
        let cfg_dir = dir.join("config");
        let _ = fs::create_dir_all(&cfg_dir);
        if let Some(sb) = skin_bytes {
            let _ = fs::write(cfg_dir.join("selfnametag_skin.png"), sb);
        }
        if let Some(cb) = cape_bytes {
            if cb.is_empty() {
                let _ = fs::remove_file(cfg_dir.join("selfnametag_cape.png"));
            } else {
                let _ = fs::write(cfg_dir.join("selfnametag_cape.png"), cb);
            }
        }
    }
}

pub async fn get_mojang_profile_data() -> Result<Value, String> {
    let cfg = load_config();
    let auth_type = cfg.get("authType").and_then(|v| v.as_str()).unwrap_or("offline");

    if auth_type == "microsoft" {
        if let Ok(ms) = refresh_microsoft_session(false).await {
            if let Some(token) = ms.get("accessToken").and_then(|v| v.as_str()) {
                let client = reqwest::Client::builder()
                    .timeout(Duration::from_secs(12))
                    .build()
                    .map_err(|e| e.to_string())?;
                if let Ok(resp) = client
                    .get("https://api.minecraftservices.com/minecraft/profile")
                    .bearer_auth(token)
                    .send()
                    .await
                {
                    if resp.status().is_success() {
                        if let Ok(profile) = resp.json::<Value>().await {
                            let skins = profile.get("skins").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                            let capes = profile.get("capes").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                            let active_skin = skins.iter().find(|s| s.get("state").and_then(|v| v.as_str()) == Some("ACTIVE")).or_else(|| skins.first()).cloned().unwrap_or(Value::Null);
                            let active_cape = capes.iter().find(|c| c.get("state").and_then(|v| v.as_str()) == Some("ACTIVE")).cloned().unwrap_or(Value::Null);
                            return Ok(json!({
                                "success": true,
                                "mode": "microsoft",
                                "id": profile.get("id").cloned().unwrap_or(Value::Null),
                                "name": profile.get("name").cloned().unwrap_or(Value::Null),
                                "profile": profile.clone(),
                                "activeSkin": active_skin,
                                "activeCape": active_cape,
                                "capes": capes
                            }));
                        }
                    }
                }
            }
        }
    }

    let offline_skin = cfg.get("offlineSkin").cloned().unwrap_or_else(|| json!({}));
    let mut skin_url = offline_skin
        .get("skinUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if let Some(custom_path) = offline_skin.get("customFilePath").and_then(|v| v.as_str()) {
        if !custom_path.is_empty() && Path::new(custom_path).exists() {
            if let Some(data_url) = file_to_data_url(Path::new(custom_path)) {
                skin_url = data_url;
            }
        }
    }

    Ok(json!({
        "success": true,
        "mode": "offline",
        "offlineSkin": {
            "presetId": offline_skin.get("presetId").and_then(|v| v.as_str()).unwrap_or("default_steve"),
            "skinUrl": skin_url,
            "variant": offline_skin.get("variant").and_then(|v| v.as_str()).unwrap_or("classic"),
            "skinName": offline_skin.get("skinName").and_then(|v| v.as_str()).unwrap_or("Klasický Steve"),
            "cape": offline_skin.get("cape").and_then(|v| v.as_str()).unwrap_or("none")
        }
    }))
}

pub async fn upload_custom_skin_file(file_path: &str, variant: &str) -> Value {
    let path = Path::new(file_path);
    if !path.exists() {
        return json!({ "success": false, "error": "Soubor se skinem neexistuje." });
    }
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) => return json!({ "success": false, "error": format!("Nelze přečíst soubor: {}", e) }),
    };

    let skins_dir = get_default_game_dir().join("skins");
    let _ = fs::create_dir_all(&skins_dir);
    let local_copy = skins_dir.join("custom_skin.png");
    let _ = fs::write(&local_copy, &bytes);
    sync_local_selfnametag_skin(Some(&bytes), None);

    let cfg = load_config();
    let variant_norm = if variant.eq_ignore_ascii_case("slim") { "slim" } else { "classic" };

    if cfg.get("authType").and_then(|v| v.as_str()) == Some("microsoft") {
        if let Ok(ms) = refresh_microsoft_session(false).await {
            if let Some(token) = ms.get("accessToken").and_then(|v| v.as_str()) {
                let part = match Part::bytes(bytes.clone())
                    .file_name("skin.png")
                    .mime_str("image/png")
                {
                    Ok(p) => p,
                    Err(e) => return json!({ "success": false, "error": e.to_string() }),
                };
                let form = Form::new()
                    .text("variant", variant_norm.to_string())
                    .part("file", part);

                let client = reqwest::Client::new();
                if let Ok(resp) = client
                    .post("https://api.minecraftservices.com/minecraft/profile/skins")
                    .bearer_auth(token)
                    .multipart(form)
                    .send()
                    .await
                {
                    if resp.status().is_success() {
                        return json!({
                            "success": true,
                            "mode": "microsoft",
                            "skinDataUrl": format!("data:image/png;base64,{}", BASE64.encode(&bytes)),
                            "variant": variant_norm
                        });
                    }
                }
            }
        }
    }

    let data_url = format!("data:image/png;base64,{}", BASE64.encode(&bytes));
    let mut offline_skin = cfg.get("offlineSkin").cloned().unwrap_or_else(|| json!({}));
    offline_skin["presetId"] = json!("custom");
    offline_skin["customFilePath"] = json!(local_copy.to_string_lossy().to_string());
    offline_skin["skinUrl"] = json!(data_url);
    offline_skin["variant"] = json!(variant_norm);
    offline_skin["skinName"] = json!("Vlastní skin");
    save_config(&json!({ "offlineSkin": offline_skin }));

    json!({
        "success": true,
        "mode": "offline",
        "skinDataUrl": data_url,
        "variant": variant_norm
    })
}

pub async fn apply_preset_skin_url(skin_url: &str, variant: &str, skin_name: &str) -> Value {
    let variant_norm = if variant.eq_ignore_ascii_case("slim") { "slim" } else { "classic" };
    let cfg = load_config();

    if skin_url.starts_with("http://") || skin_url.starts_with("https://") {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .user_agent("MychalSMP-Launcher/1.4.6")
            .build()
            .unwrap_or_default();
        if let Ok(resp) = client.get(skin_url).send().await {
            if let Ok(bytes) = resp.bytes().await {
                sync_local_selfnametag_skin(Some(&bytes), None);
            }
        }
    }

    if cfg.get("authType").and_then(|v| v.as_str()) == Some("microsoft")
        && (skin_url.starts_with("http://") || skin_url.starts_with("https://"))
    {
        if let Ok(ms) = refresh_microsoft_session(false).await {
            if let Some(token) = ms.get("accessToken").and_then(|v| v.as_str()) {
                let client = reqwest::Client::new();
                if let Ok(resp) = client
                    .post("https://api.minecraftservices.com/minecraft/profile/skins")
                    .bearer_auth(token)
                    .json(&json!({
                        "variant": variant_norm,
                        "url": skin_url
                    }))
                    .send()
                    .await
                {
                    if resp.status().is_success() {
                        return json!({
                            "success": true,
                            "mode": "microsoft",
                            "skinUrl": skin_url,
                            "variant": variant_norm
                        });
                    }
                }
            }
        }
    }

    let mut offline_skin = cfg.get("offlineSkin").cloned().unwrap_or_else(|| json!({}));
    offline_skin["presetId"] = json!(skin_name);
    offline_skin["customFilePath"] = json!("");
    offline_skin["skinUrl"] = json!(skin_url);
    offline_skin["variant"] = json!(variant_norm);
    offline_skin["skinName"] = json!(skin_name);
    save_config(&json!({ "offlineSkin": offline_skin }));

    json!({
        "success": true,
        "mode": "offline",
        "skinUrl": skin_url,
        "variant": variant_norm
    })
}

pub async fn reset_skin_to_default() -> Value {
    let cfg = load_config();
    if cfg.get("authType").and_then(|v| v.as_str()) == Some("microsoft") {
        if let Ok(ms) = refresh_microsoft_session(false).await {
            if let Some(token) = ms.get("accessToken").and_then(|v| v.as_str()) {
                let client = reqwest::Client::new();
                let _ = client
                    .delete("https://api.minecraftservices.com/minecraft/profile/skins/active")
                    .bearer_auth(token)
                    .send()
                    .await;
            }
        }
    }

    let mut offline_skin = cfg.get("offlineSkin").cloned().unwrap_or_else(|| json!({}));
    offline_skin["presetId"] = json!("default_steve");
    offline_skin["customFilePath"] = json!("");
    offline_skin["skinUrl"] = json!("assets/default_steve.png");
    offline_skin["variant"] = json!("classic");
    offline_skin["skinName"] = json!("Klasický Steve");
    save_config(&json!({ "offlineSkin": offline_skin }));

    json!({ "success": true })
}

pub async fn set_mojang_active_cape(cape_id: Option<&str>) -> Value {
    if let Ok(ms) = refresh_microsoft_session(false).await {
        if let Some(token) = ms.get("accessToken").and_then(|v| v.as_str()) {
            let client = reqwest::Client::new();
            let cid = cape_id.unwrap_or("none");
            let res = if cid.is_empty() || cid == "none" {
                client
                    .delete("https://api.minecraftservices.com/minecraft/profile/capes/active")
                    .bearer_auth(token)
                    .send()
                    .await
            } else {
                client
                    .put("https://api.minecraftservices.com/minecraft/profile/capes/active")
                    .bearer_auth(token)
                    .json(&json!({ "capeId": cid }))
                    .send()
                    .await
            };
            if let Ok(resp) = res {
                if resp.status().is_success() {
                    return json!({ "success": true });
                }
            }
        }
    }
    set_local_offline_cape(cape_id.unwrap_or("none")).await
}

pub async fn set_local_offline_cape(cape_value: &str) -> Value {
    let cfg = load_config();
    let mut offline_skin = cfg.get("offlineSkin").cloned().unwrap_or_else(|| json!({}));
    offline_skin["cape"] = json!(cape_value);
    save_config(&json!({ "offlineSkin": offline_skin }));

    if cape_value.is_empty() || cape_value == "none" {
        sync_local_selfnametag_skin(None, Some(&[]));
    } else if cape_value.starts_with("http://") || cape_value.starts_with("https://") {
        let client = reqwest::Client::new();
        if let Ok(resp) = client.get(cape_value).send().await {
            if let Ok(bytes) = resp.bytes().await {
                sync_local_selfnametag_skin(None, Some(&bytes));
            }
        }
    } else if Path::new(cape_value).exists() {
        if let Ok(bytes) = fs::read(cape_value) {
            sync_local_selfnametag_skin(None, Some(&bytes));
        }
    }

    json!({ "success": true, "cape": cape_value })
}

