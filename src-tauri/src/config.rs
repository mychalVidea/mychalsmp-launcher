use crate::vault::{protect_account_for_disk, sanitize_account_for_renderer, unprotect_account_from_disk};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub const APP_VERSION: &str = "1.4.6";

pub fn get_default_game_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join(".mychalsmp");
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".mychalsmp")
}

pub fn get_config_path() -> PathBuf {
    get_default_game_dir().join("launcher-config.json")
}

pub fn default_servers() -> Value {
    json!([
        {
            "id": "mychalsmp-main",
            "name": "MYCHAL SMP — Hlavní Server",
            "ip": "mychalsmp.xyz",
            "port": 25565,
            "badge": "DOPORUČENO • 26.3",
            "description": "Oficiální Survival SMP, ekonomika, eventy, hlasový chat a přátelská komunita.",
            "isPrimary": true
        },
        {
            "id": "mychalsmp-pvp",
            "name": "MYCHAL PvP — Arény & Duely",
            "ip": "pvp.mychalsmp.xyz",
            "port": 25565,
            "badge": "PVP PRACTICE",
            "description": "Dedikovaný tréninkový PvP server: Custom Kity, Duely 1v1, FFA arény a 0ms odezva.",
            "isPrimary": false
        }
    ])
}

pub fn default_profiles() -> Value {
    json!([
        {
            "id": "mychalsmp-fabric",
            "name": "MYCHAL SMP (Optimalizováno)",
            "type": "fabric",
            "version": "26.3",
            "loader": "fabric",
            "icon": "assets/logo.png",
            "badge": "DOPORUČENO",
            "description": "Maximální FPS (Sodium, Lithium, Iris Shaders) + Simple Voice Chat pro MYCHAL SMP."
        },
        {
            "id": "vanilla-26-3",
            "name": "Vanilla 26.3",
            "type": "release",
            "version": "26.3",
            "loader": "vanilla",
            "icon": "grass",
            "badge": "ČISTÁ HRA",
            "description": "Čistý nemodovaný Minecraft 26.3 přímo od Mojangu."
        },
        {
            "id": "vanilla-26-2",
            "name": "Vanilla 26.2",
            "type": "release",
            "version": "26.2",
            "loader": "vanilla",
            "icon": "grass",
            "badge": "ČISTÁ HRA",
            "description": "Čistý nemodovaný Minecraft 26.2 přímo od Mojangu."
        },
        {
            "id": "vanilla-26-1",
            "name": "Vanilla 26.1.2",
            "type": "release",
            "version": "26.1.2",
            "loader": "vanilla",
            "icon": "grass",
            "badge": "ČISTÁ HRA",
            "description": "Čistý nemodovaný Minecraft 26.1.2 přímo od Mojangu."
        }
    ])
}

pub fn default_config() -> Value {
    let game_dir = get_default_game_dir().to_string_lossy().to_string();
    json!({
        "authType": "offline",
        "offlineUsername": "Player",
        "microsoftAccount": Value::Null,
        "selectedProfile": "mychalsmp-fabric",
        "profiles": default_profiles(),
        "selectedServer": "mychalsmp-main",
        "servers": default_servers(),
        "ram": {
            "min": 2048,
            "max": 4096
        },
        "resolution": {
            "width": 1280,
            "height": 720,
            "fullscreen": true,
            "borderlessFullscreen": true
        },
        "autoConnect": false,
        "closeOnLaunch": false,
        "autoTrimMemory": true,
        "discordRpc": true,
        "downloadAudioDlc": false,
        "enableSnapshots": false,
        "gameDirectory": game_dir,
        "javaPath": "auto",
        "jvmArgs": "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch",
        "mods": {
            "sodium": true,
            "lithium": true,
            "iris": true,
            "ferritecore": true,
            "entityculling": true,
            "immediatelyfast": true,
            "modmenu": true,
            "voicechat": true
        },
        "playtime": {
            "totalSeconds": 0,
            "sessionsCount": 0,
            "lastPlayed": Value::Null,
            "perProfile": {}
        },
        "selfNametag": {
            "enabled": true,
            "showInThirdPerson": true,
            "showBackground": true,
            "style": "CLEAN"
        },
        "offlineSkin": {
            "presetId": "default_steve",
            "skinUrl": "",
            "customFilePath": "",
            "variant": "classic",
            "skinName": "Klasický Steve",
            "cape": "none"
        }
    })
}

pub fn load_config() -> Value {
    let config_path = get_config_path();
    let backup_path = config_path.with_extension("json.bak");
    let mut base = default_config();

    let parse_file = |p: &Path| -> Option<Value> {
        if !p.exists() {
            return None;
        }
        let raw = fs::read_to_string(p).ok()?;
        if raw.trim().is_empty() {
            return None;
        }
        serde_json::from_str::<Value>(&raw).ok()
    };

    let mut saved = parse_file(&config_path);
    if saved.is_none() {
        saved = parse_file(&backup_path);
    }

    if let Some(Value::Object(saved_map)) = saved {
        if let Value::Object(base_map) = &mut base {
            for (k, v) in saved_map {
                match k.as_str() {
                    "ram" | "resolution" | "mods" | "playtime" | "selfNametag" | "offlineSkin" => {
                        if let ( Some(Value::Object(b_sub)), Value::Object(s_sub) ) = (base_map.get_mut(&k), v) {
                            for (sk, sv) in s_sub {
                                b_sub.insert(sk, sv);
                            }
                        }
                    }
                    _ => {
                        base_map.insert(k, v);
                    }
                }
            }
        }
    }

    // Decrypt microsoftAccount
    if let Some(ms) = base.get("microsoftAccount").cloned() {
        if ms.is_object() {
            match unprotect_account_from_disk(&ms) {
                Some(unprotected) => {
                    base["microsoftAccount"] = unprotected;
                }
                None => {
                    base["microsoftAccount"] = Value::Null;
                }
            }
        }
    }

    // Migrate default profiles (26.2 -> 26.3, ensure vanilla-26-3, vanilla-26-2, vanilla-26-1 exist)
    if let Some(profiles) = base.get_mut("profiles").and_then(|v| v.as_array_mut()) {
        for p in profiles.iter_mut() {
            if p.get("id").and_then(|v| v.as_str()) == Some("mychalsmp-fabric") {
                if p.get("version").and_then(|v| v.as_str()) == Some("26.2") {
                    p["version"] = json!("26.3");
                }
                if p.get("icon").and_then(|v| v.as_str()) != Some("assets/logo.png") {
                    p["icon"] = json!("assets/logo.png");
                }
            }
        }
        let has_id = |arr: &[Value], id: &str| {
            arr.iter().any(|x| x.get("id").and_then(|v| v.as_str()) == Some(id))
        };
        if !has_id(profiles, "vanilla-26-3") {
            profiles.insert(
                (1usize).min(profiles.len()),
                json!({
                    "id": "vanilla-26-3",
                    "name": "Vanilla 26.3",
                    "type": "release",
                    "version": "26.3",
                    "loader": "vanilla",
                    "icon": "grass",
                    "badge": "ČISTÁ HRA",
                    "description": "Čistý nemodovaný Minecraft 26.3 přímo od Mojangu."
                }),
            );
        }
        if !has_id(profiles, "vanilla-26-2") {
            profiles.push(json!({
                "id": "vanilla-26-2",
                "name": "Vanilla 26.2",
                "type": "release",
                "version": "26.2",
                "loader": "vanilla",
                "icon": "grass",
                "badge": "ČISTÁ HRA",
                "description": "Čistý nemodovaný Minecraft 26.2 přímo od Mojangu."
            }));
        }
        if !has_id(profiles, "vanilla-26-1") {
            profiles.push(json!({
                "id": "vanilla-26-1",
                "name": "Vanilla 26.1.2",
                "type": "release",
                "version": "26.1.2",
                "loader": "vanilla",
                "icon": "grass",
                "badge": "ČISTÁ HRA",
                "description": "Čistý nemodovaný Minecraft 26.1.2 přímo od Mojangu."
            }));
        }
    }

    base
}

pub fn save_config(new_config: &Value) -> Value {
    let mut current = load_config();
    if let (Some(curr_map), Some(new_map)) = (current.as_object_mut(), new_config.as_object()) {
        for (k, v) in new_map {
            if k == "microsoftAccount" && v.is_object() {
                let has_raw_token = v.get("accessToken").and_then(|x| x.as_str()).is_some()
                    || v.get("mclcAuth").map(|x| x.is_object()).unwrap_or(false);
                if !has_raw_token {
                    // Keep existing decrypted tokens from current config
                    if let Some(existing_ms) = curr_map.get("microsoftAccount").and_then(|x| x.as_object()).cloned() {
                        let mut merged = existing_ms;
                        if let Some(v_obj) = v.as_object() {
                            for (mk, mv) in v_obj {
                                merged.insert(mk.clone(), mv.clone());
                            }
                        }
                        curr_map.insert(k.clone(), Value::Object(merged));
                        continue;
                    }
                }
            }
            curr_map.insert(k.clone(), v.clone());
        }
    }

    let config_path = get_config_path();
    if let Some(parent) = config_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let mut disk_payload = current.clone();
    if let Some(ms) = disk_payload.get("microsoftAccount").cloned() {
        if ms.is_object() {
            disk_payload["microsoftAccount"] = protect_account_for_disk(&ms);
        }
    }

    if let Ok(serialized) = serde_json::to_string_pretty(&disk_payload) {
        let tmp_path = config_path.with_extension("json.tmp");
        let bak_path = config_path.with_extension("json.bak");
        if fs::write(&tmp_path, &serialized).is_ok() {
            if config_path.exists() {
                let _ = fs::copy(&config_path, &bak_path);
            }
            let _ = fs::rename(&tmp_path, &config_path);
        } else {
            let _ = fs::write(&config_path, &serialized);
        }
    }

    sync_self_nametag_config(&current);
    current
}

pub fn get_config_for_renderer() -> Value {
    let mut cfg = load_config();
    if let Some(ms) = cfg.get("microsoftAccount").cloned() {
        if ms.is_object() {
            cfg["microsoftAccount"] = sanitize_account_for_renderer(&ms);
        }
    }
    cfg
}

pub fn resolve_profile_dir(config: &Value, profile_id: Option<&str>) -> PathBuf {
    let base_dir = config
        .get("gameDirectory")
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
        .unwrap_or_else(get_default_game_dir);

    let pid = profile_id
        .or_else(|| config.get("selectedProfile").and_then(|v| v.as_str()))
        .unwrap_or("mychalsmp-fabric");

    if let Some(profiles) = config.get("profiles").and_then(|v| v.as_array()) {
        if let Some(profile) = profiles.iter().find(|p| p.get("id").and_then(|v| v.as_str()) == Some(pid)) {
            if let Some(custom_dir) = profile.get("gameDir").and_then(|v| v.as_str()) {
                if !custom_dir.trim().is_empty() {
                    return PathBuf::from(custom_dir);
                }
            }
        }
    }

    if pid == "mychalsmp-fabric" || pid.starts_with("vanilla-") {
        base_dir
    } else {
        let safe_id: String = pid
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
            .collect();
        base_dir.join("instances").join(safe_id)
    }
}

pub fn sync_self_nametag_config(config: &Value) {
    let nt = config.get("selfNametag").cloned().unwrap_or_else(|| json!({}));
    let res = config.get("resolution").cloned().unwrap_or_else(|| json!({}));
    let payload = json!({
        "enabled": nt.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true),
        "showInThirdPerson": nt.get("showInThirdPerson").and_then(|v| v.as_bool()).unwrap_or(true),
        "showBackground": nt.get("showBackground").and_then(|v| v.as_bool()).unwrap_or(true),
        "style": nt.get("style").and_then(|v| v.as_str()).unwrap_or("CLEAN"),
        "borderlessFullscreen": res.get("borderlessFullscreen").and_then(|v| v.as_bool()).unwrap_or(true)
    });

    let serialized = match serde_json::to_string_pretty(&payload) {
        Ok(s) => s,
        Err(_) => return,
    };

    let base_dir = config
        .get("gameDirectory")
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
        .unwrap_or_else(get_default_game_dir);

    let write_to = |dir: &Path| {
        let cfg_dir = dir.join("config");
        if fs::create_dir_all(&cfg_dir).is_ok() {
            let _ = fs::write(cfg_dir.join("selfnametag.json"), &serialized);
        }
    };

    write_to(&base_dir);
    let selected_dir = resolve_profile_dir(config, None);
    if selected_dir != base_dir {
        write_to(&selected_dir);
    }
}

