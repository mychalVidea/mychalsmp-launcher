use crate::config::{
    get_default_game_dir, load_config, resolve_profile_dir, save_config, APP_VERSION,
};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::System;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

/// Formats byte count to human-readable string (B, KB, MB, GB).
pub fn format_bytes(bytes: u64) -> String {
    if bytes == 0 {
        return "0 B".to_string();
    }
    const K: f64 = 1024.0;
    let sizes = ["B", "KB", "MB", "GB", "TB"];
    let i = ((bytes as f64).ln() / K.ln()).floor() as usize;
    let idx = i.min(sizes.len() - 1);
    let val = (bytes as f64) / K.powi(idx as i32);
    format!("{:.1} {}", val, sizes[idx])
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Cleaner Cache Scanner & Cleaner
// ─────────────────────────────────────────────────────────────────────────────

pub fn scan_launcher_cache() -> Value {
    let base_dir = get_default_game_dir();
    let cfg = load_config();

    let mut dirs_to_scan = HashSet::new();
    dirs_to_scan.insert(base_dir.clone());

    if let Some(profiles) = cfg.get("profiles").and_then(|p| p.as_array()) {
        for p in profiles {
            if let Some(gdir) = p.get("gameDir").and_then(|v| v.as_str()) {
                let pb = PathBuf::from(gdir);
                if pb.exists() {
                    dirs_to_scan.insert(pb);
                }
            }
        }
    }

    let thirty_days_ms = 30 * 24 * 60 * 60 * 1000u64;
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let mut items: Vec<Value> = Vec::new();
    let mut logs_count = 0;
    let mut logs_bytes = 0u64;
    let mut crashes_count = 0;
    let mut crashes_bytes = 0u64;
    let mut temps_count = 0;
    let mut temps_bytes = 0u64;
    let mut old_jars_count = 0;
    let mut old_jars_bytes = 0u64;

    for dir in &dirs_to_scan {
        // 1. Logs
        let logs_dir = dir.join("logs");
        if logs_dir.exists() {
            if let Ok(entries) = fs::read_dir(&logs_dir) {
                for entry in entries.flatten() {
                    let fname = entry.file_name().to_string_lossy().to_string();
                    let lower = fname.to_lowercase();
                    if let Ok(meta) = entry.metadata() {
                        let size = meta.len();
                        let mtime_ms = meta
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as u64)
                            .unwrap_or(0);
                        let age = now_ms.saturating_sub(mtime_ms);

                        if lower.ends_with(".log.gz")
                            || (lower.ends_with(".log") && fname != "latest.log" && age > thirty_days_ms)
                        {
                            logs_count += 1;
                            logs_bytes += size;
                            items.push(json!({
                                "path": entry.path().to_string_lossy(),
                                "size": size,
                                "mtime": mtime_ms,
                                "category": "logs"
                            }));
                        }
                    }
                }
            }
        }

        // 2. Crash reports older than 30 days
        let crash_dir = dir.join("crash-reports");
        if crash_dir.exists() {
            if let Ok(entries) = fs::read_dir(&crash_dir) {
                for entry in entries.flatten() {
                    let fname = entry.file_name().to_string_lossy().to_string();
                    if fname.to_lowercase().ends_with(".txt") {
                        if let Ok(meta) = entry.metadata() {
                            let size = meta.len();
                            let mtime_ms = meta
                                .modified()
                                .ok()
                                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                                .map(|d| d.as_millis() as u64)
                                .unwrap_or(0);
                            let age = now_ms.saturating_sub(mtime_ms);
                            if age > thirty_days_ms {
                                crashes_count += 1;
                                crashes_bytes += size;
                                items.push(json!({
                                    "path": entry.path().to_string_lossy(),
                                    "size": size,
                                    "mtime": mtime_ms,
                                    "category": "crashes"
                                }));
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. Temps and caches in base_dir
    let temp_dirs = [
        base_dir.join("temp"),
        base_dir.join("natives"),
        base_dir.join("cache"),
        base_dir.join("webcache"),
    ];

    for tdir in &temp_dirs {
        if tdir.exists() {
            for entry in WalkDir::new(tdir)
                .max_depth(3)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                if entry.file_type().is_file() {
                    if let Ok(meta) = entry.metadata() {
                        let size = meta.len();
                        let mtime_ms = meta
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as u64)
                            .unwrap_or(0);
                        temps_count += 1;
                        temps_bytes += size;
                        items.push(json!({
                            "path": entry.path().to_string_lossy(),
                            "size": size,
                            "mtime": mtime_ms,
                            "category": "temps"
                        }));
                    }
                }
            }
        }
    }

    // 4. Old orphaned version jars (> 30 days and not active)
    let versions_dir = base_dir.join("versions");
    if versions_dir.exists() {
        let active_versions: HashSet<String> = cfg
            .get("profiles")
            .and_then(|p| p.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|p| p.get("version").and_then(|v| v.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        if let Ok(entries) = fs::read_dir(&versions_dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|f| f.is_dir()).unwrap_or(false) {
                    let vname = entry.file_name().to_string_lossy().to_string();
                    if !active_versions.contains(&vname)
                        && !vname.contains("26.3")
                        && !vname.contains("26.2")
                        && !vname.contains("26.1")
                    {
                        for sub in WalkDir::new(entry.path())
                            .max_depth(2)
                            .into_iter()
                            .filter_map(|e| e.ok())
                        {
                            if sub.file_type().is_file() {
                                if let Ok(meta) = sub.metadata() {
                                    let mtime_ms = meta
                                        .modified()
                                        .ok()
                                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                                        .map(|d| d.as_millis() as u64)
                                        .unwrap_or(0);
                                    if now_ms.saturating_sub(mtime_ms) > thirty_days_ms {
                                        let size = meta.len();
                                        old_jars_count += 1;
                                        old_jars_bytes += size;
                                        items.push(json!({
                                            "path": sub.path().to_string_lossy(),
                                            "size": size,
                                            "mtime": mtime_ms,
                                            "category": "oldJars"
                                        }));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let total_bytes = logs_bytes + crashes_bytes + temps_bytes + old_jars_bytes;
    let file_count = items.len();

    json!({
        "fileCount": file_count,
        "totalBytes": total_bytes,
        "formattedSize": format_bytes(total_bytes),
        "breakdown": {
            "logs": { "count": logs_count, "formatted": format_bytes(logs_bytes) },
            "crashes": { "count": crashes_count, "formatted": format_bytes(crashes_bytes) },
            "temps": { "count": temps_count, "formatted": format_bytes(temps_bytes) },
            "oldJars": { "count": old_jars_count, "formatted": format_bytes(old_jars_bytes) }
        },
        "items": items
    })
}

pub fn clean_launcher_cache() -> Value {
    let scan = scan_launcher_cache();
    let mut deleted_files = 0;
    let mut freed_bytes = 0u64;

    if let Some(items) = scan.get("items").and_then(|i| i.as_array()) {
        for item in items {
            if let Some(p_str) = item.get("path").and_then(|p| p.as_str()) {
                let p = Path::new(p_str);
                if p.exists() {
                    let size = item.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
                    if fs::remove_file(p).is_ok() {
                        deleted_files += 1;
                        freed_bytes += size;
                    }
                }
            }
        }
    }

    let base_dir = get_default_game_dir();
    let cleanup_dirs = [
        base_dir.join("temp"),
        base_dir.join("natives"),
        base_dir.join("cache"),
        base_dir.join("webcache"),
    ];

    for d in &cleanup_dirs {
        if d.exists() {
            if let Ok(entries) = fs::read_dir(d) {
                if entries.count() == 0 {
                    let _ = fs::remove_dir(d);
                }
            }
        }
    }

    json!({
        "success": true,
        "deletedFiles": deleted_files,
        "freedBytes": freed_bytes,
        "formattedFreed": format_bytes(freed_bytes)
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. System Information
// ─────────────────────────────────────────────────────────────────────────────

pub fn get_system_info() -> Value {
    let mut sys = System::new_all();
    sys.refresh_all();

    let total_bytes = sys.total_memory();
    let total_ram_gb = (total_bytes / (1024 * 1024 * 1024)).max(1) as u32;
    let max_allowed_ram_gb = (((total_bytes as f64 * 0.8) / (1024.0 * 1024.0 * 1024.0)).floor() as u32).max(4);

    let recommended_ram_gb = if total_ram_gb <= 4 {
        2
    } else if total_ram_gb <= 8 {
        4
    } else if total_ram_gb <= 16 {
        6
    } else if total_ram_gb <= 32 {
        8
    } else {
        10
    };

    let (gpu_name, is_dedicated) = detect_gpu_info();

    json!({
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "totalRamGB": total_ram_gb,
        "recommendedRamGB": recommended_ram_gb,
        "maxAllowedRamGB": max_allowed_ram_gb,
        "gpuName": gpu_name,
        "isDedicatedGpu": is_dedicated
    })
}

fn detect_gpu_info() -> (String, bool) {
    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = std::process::Command::new("lspci").output() {
            let text = String::from_utf8_lossy(&output.stdout);
            let mut gpus = Vec::new();
            for line in text.lines() {
                let lower = line.to_lowercase();
                if lower.contains("vga compatible controller")
                    || lower.contains("3d controller")
                    || lower.contains("display controller")
                {
                    gpus.push(line.trim().to_string());
                }
            }
            if !gpus.is_empty() {
                let dedicated = gpus.iter().find(|g| {
                    let l = g.to_lowercase();
                    l.contains("nvidia") || l.contains("geforce") || l.contains("radeon") || l.contains("amd")
                });
                let chosen = dedicated.unwrap_or(&gpus[0]);
                let is_ded = {
                    let l = chosen.to_lowercase();
                    (l.contains("nvidia") || l.contains("geforce") || l.contains("radeon") || l.contains("amd"))
                        && !l.contains("intel")
                };
                return (clean_gpu_name(chosen), is_ded);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = std::process::Command::new("powershell")
            .args(&[
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
            ])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            let lines: Vec<&str> = text.lines().map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
            if !lines.is_empty() {
                let dedicated = lines.iter().find(|l| {
                    let lower = l.to_lowercase();
                    lower.contains("nvidia")
                        || lower.contains("geforce")
                        || lower.contains("rtx")
                        || lower.contains("gtx")
                        || lower.contains("radeon")
                        || lower.contains("amd")
                });
                let chosen = dedicated.unwrap_or(&lines[0]);
                let is_ded = {
                    let lower = chosen.to_lowercase();
                    !lower.contains("intel") && !lower.contains("basic") && !lower.contains("microsoft")
                };
                return (clean_gpu_name(chosen), is_ded);
            }
        }
    }

    ("Standardní grafická karta".to_string(), false)
}

fn clean_gpu_name(raw: &str) -> String {
    let clean = raw.trim();
    if let Some(start) = clean.find('[') {
        if let Some(end) = clean.find(']') {
            if end > start {
                let inside = &clean[start + 1..end];
                let vendor = if clean.to_lowercase().contains("nvidia") {
                    "NVIDIA "
                } else if clean.to_lowercase().contains("intel") {
                    "Intel "
                } else if clean.to_lowercase().contains("amd") || clean.to_lowercase().contains("radeon") {
                    "AMD "
                } else {
                    ""
                };
                if !inside.to_lowercase().contains(&vendor.trim().to_lowercase()) {
                    return format!("{}{}", vendor, inside.trim());
                }
                return inside.trim().to_string();
            }
        }
    }

    let re_ctrl = regex::Regex::new(r"(?i)^[0-9a-f:.]+\s*(vga compatible controller|3d controller|display controller)?:\s*").unwrap();
    let no_ctrl = re_ctrl.replace(clean, "");
    let re_rev = regex::Regex::new(r"(?i)\(rev\s+[0-9a-f]+\)").unwrap();
    let no_rev = re_rev.replace(&no_ctrl, "");
    let res = no_rev.replace("Corporation", "").trim().to_string();
    if res.is_empty() {
        "Standardní grafická karta".to_string()
    } else {
        res
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Keybinds Manager (options.txt)
// ─────────────────────────────────────────────────────────────────────────────

pub fn get_keybinds(profile_id: Option<&str>) -> Value {
    let cfg = load_config();
    let game_dir = resolve_profile_dir(&cfg, profile_id);
    let opt_path = game_dir.join("options.txt");

    let mut binds_map = HashMap::new();
    if opt_path.exists() {
        if let Ok(content) = fs::read_to_string(&opt_path) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("key_") && trimmed.contains(':') {
                    let mut parts = trimmed.splitn(2, ':');
                    let k = parts.next().unwrap_or("").trim().to_string();
                    let v = parts.next().unwrap_or("").trim().to_string();
                    binds_map.insert(k, v);
                }
            }
        }
    }

    if let Some(globals) = cfg.get("globalKeybinds").and_then(|g| g.as_object()) {
        for (k, v) in globals {
            if let Some(s) = v.as_str() {
                binds_map.insert(k.clone(), s.to_string());
            }
        }
    }

    let default_actions = get_default_key_actions();
    let mut bind_list = Vec::new();
    let mut key_usage: HashMap<String, Vec<String>> = HashMap::new();

    for act in &default_actions {
        let current_key = binds_map
            .get(&act.id)
            .cloned()
            .unwrap_or_else(|| act.default_key.clone());

        let is_debug = act.is_debug;
        if current_key != "key.keyboard.unknown" {
            let usage_key = format!("{}:{}", if is_debug { "debug" } else { "normal" }, current_key);
            key_usage.entry(usage_key).or_default().push(act.id.clone());
        }

        bind_list.push(json!({
            "id": act.id,
            "label": act.label,
            "category": act.category,
            "modName": act.mod_name,
            "defaultKey": act.default_key,
            "key": current_key,
            "keyDisplay": get_key_display(&current_key),
            "keyCode": get_key_code(&current_key),
            "isDebug": is_debug,
            "hasConflict": false,
            "conflictsWith": []
        }));
    }

    // Process conflicts
    let mut conflict_count = 0;
    for item in &mut bind_list {
        let current_key = item["key"].as_str().unwrap_or("");
        let is_debug = item["isDebug"].as_bool().unwrap_or(false);
        if current_key != "key.keyboard.unknown" {
            let usage_key = format!("{}:{}", if is_debug { "debug" } else { "normal" }, current_key);
            if let Some(users) = key_usage.get(&usage_key) {
                if users.len() > 1 {
                    conflict_count += 1;
                    item["hasConflict"] = json!(true);
                    let conflicts: Vec<String> = users
                        .iter()
                        .filter(|u| *u != item["id"].as_str().unwrap_or(""))
                        .cloned()
                        .collect();
                    item["conflictsWith"] = json!(conflicts);
                }
            }
        }
    }

    let bound_count = bind_list
        .iter()
        .filter(|b| b["key"].as_str() != Some("key.keyboard.unknown"))
        .count();
    let total_count = bind_list.len();

    json!({
        "success": true,
        "binds": bind_list,
        "stats": {
            "total": total_count,
            "bound": bound_count,
            "unbound": total_count - bound_count,
            "conflictCount": conflict_count
        },
        "keyDefinitions": get_key_definitions()
    })
}

pub fn save_keybinds(binds: &Value, profile_id: Option<&str>) -> Value {
    let mut cfg = load_config();
    let game_dir = resolve_profile_dir(&cfg, profile_id);
    let opt_path = game_dir.join("options.txt");

    let mut binds_to_save: HashMap<String, String> = HashMap::new();
    if let Some(obj) = binds.as_object() {
        for (k, v) in obj {
            let key_name = if k.starts_with("key_") {
                k.clone()
            } else {
                format!("key_{}", k)
            };
            if let Some(val_str) = v.as_str() {
                binds_to_save.insert(key_name, val_str.to_string());
            }
        }
    }

    // Update options.txt content preserving non-key entries
    let mut existing_lines = Vec::new();
    if opt_path.exists() {
        if let Ok(content) = fs::read_to_string(&opt_path) {
            existing_lines = content.lines().map(String::from).collect();
        }
    }

    let mut handled_keys = HashSet::new();
    let mut new_lines = Vec::new();

    for line in existing_lines {
        let trimmed = line.trim();
        if trimmed.starts_with("key_") && trimmed.contains(':') {
            let mut parts = trimmed.splitn(2, ':');
            let k = parts.next().unwrap_or("").trim().to_string();
            if let Some(new_val) = binds_to_save.get(&k) {
                new_lines.push(format!("{}:{}", k, new_val));
                handled_keys.insert(k);
            } else {
                new_lines.push(line);
                handled_keys.insert(k);
            }
        } else {
            new_lines.push(line);
        }
    }

    for (k, v) in &binds_to_save {
        if !handled_keys.contains(k) {
            new_lines.push(format!("{}:{}", k, v));
        }
    }

    let _ = fs::write(&opt_path, new_lines.join("\n"));

    // Save to globalKeybinds in launcher-config.json
    let mut globals = cfg
        .get("globalKeybinds")
        .and_then(|g| g.as_object())
        .cloned()
        .unwrap_or_default();
    for (k, v) in &binds_to_save {
        globals.insert(k.clone(), json!(v));
    }
    cfg["globalKeybinds"] = Value::Object(globals);
    save_config(&cfg);

    json!({
        "success": true,
        "updatedProfilesCount": 1,
        "totalBinds": binds_to_save.len()
    })
}

pub fn reset_keybinds_default() -> Value {
    let defaults = get_default_key_actions();
    let mut map = serde_json::Map::new();
    for act in defaults {
        map.insert(act.id, json!(act.default_key));
    }
    save_keybinds(&Value::Object(map), None)
}

struct KeyAction {
    id: String,
    label: &'static str,
    category: &'static str,
    mod_name: Option<&'static str>,
    default_key: String,
    is_debug: bool,
}

fn get_default_key_actions() -> Vec<KeyAction> {
    vec![
        KeyAction { id: "key_key.forward".into(), label: "Jít dopředu", category: "movement", mod_name: None, default_key: "key.keyboard.w".into(), is_debug: false },
        KeyAction { id: "key_key.left".into(), label: "Jít doleva", category: "movement", mod_name: None, default_key: "key.keyboard.a".into(), is_debug: false },
        KeyAction { id: "key_key.back".into(), label: "Jít dozadu", category: "movement", mod_name: None, default_key: "key.keyboard.s".into(), is_debug: false },
        KeyAction { id: "key_key.right".into(), label: "Jít doprava", category: "movement", mod_name: None, default_key: "key.keyboard.d".into(), is_debug: false },
        KeyAction { id: "key_key.jump".into(), label: "Skok", category: "movement", mod_name: None, default_key: "key.keyboard.space".into(), is_debug: false },
        KeyAction { id: "key_key.sneak".into(), label: "Plížení (Sneak)", category: "movement", mod_name: None, default_key: "key.keyboard.left.shift".into(), is_debug: false },
        KeyAction { id: "key_key.sprint".into(), label: "Sprint", category: "movement", mod_name: None, default_key: "key.keyboard.left.control".into(), is_debug: false },
        KeyAction { id: "key_key.attack".into(), label: "Útok / Ničení bloku", category: "gameplay", mod_name: None, default_key: "key.mouse.left".into(), is_debug: false },
        KeyAction { id: "key_key.use".into(), label: "Použít předmět / Položit", category: "gameplay", mod_name: None, default_key: "key.mouse.right".into(), is_debug: false },
        KeyAction { id: "key_key.drop".into(), label: "Odhodit předmět", category: "gameplay", mod_name: None, default_key: "key.keyboard.q".into(), is_debug: false },
        KeyAction { id: "key_key.inventory".into(), label: "Inventář", category: "inventory", mod_name: None, default_key: "key.keyboard.e".into(), is_debug: false },
        KeyAction { id: "key_key.swapOffhand".into(), label: "Druhá ruka (Offhand)", category: "gameplay", mod_name: None, default_key: "key.keyboard.f".into(), is_debug: false },
        KeyAction { id: "key_key.chat".into(), label: "Otevřít chat", category: "multiplayer", mod_name: None, default_key: "key.keyboard.t".into(), is_debug: false },
        KeyAction { id: "key_key.command".into(), label: "Zadat příkaz (/)", category: "multiplayer", mod_name: None, default_key: "key.keyboard.slash".into(), is_debug: false },
        KeyAction { id: "key_key.playerlist".into(), label: "Seznam hráčů (Tab)", category: "multiplayer", mod_name: None, default_key: "key.keyboard.tab".into(), is_debug: false },
        KeyAction { id: "key_key.screenshot".into(), label: "Snímek obrazovky (F2)", category: "misc", mod_name: None, default_key: "key.keyboard.f2".into(), is_debug: false },
        KeyAction { id: "key_key.smoothCamera".into(), label: "Filmová kamera", category: "misc", mod_name: None, default_key: "key.keyboard.f6".into(), is_debug: false },
        KeyAction { id: "key_key.fullscreen".into(), label: "Celá obrazovka (F11)", category: "misc", mod_name: None, default_key: "key.keyboard.f11".into(), is_debug: false },
    ]
}

fn get_key_display(k: &str) -> String {
    let clean = k.replace("key.keyboard.", "").replace("key.mouse.", "Mouse ");
    clean.to_uppercase()
}

fn get_key_code(k: &str) -> String {
    let clean = k.replace("key.keyboard.", "").replace("key.mouse.", "");
    clean
}

fn get_key_definitions() -> Value {
    json!({
        "key.keyboard.w": { "label": "W", "code": "KeyW" },
        "key.keyboard.a": { "label": "A", "code": "KeyA" },
        "key.keyboard.s": { "label": "S", "code": "KeyS" },
        "key.keyboard.d": { "label": "D", "code": "KeyD" },
        "key.keyboard.space": { "label": "Mezerník", "code": "Space" },
        "key.keyboard.left.shift": { "label": "L-Shift", "code": "ShiftLeft" },
        "key.keyboard.left.control": { "label": "L-Ctrl", "code": "ControlLeft" },
        "key.mouse.left": { "label": "Levé tl. myši", "code": "MouseLeft" },
        "key.mouse.right": { "label": "Pravé tl. myši", "code": "MouseRight" }
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Key Arts & Screenshots Gallery
// ─────────────────────────────────────────────────────────────────────────────

pub fn get_available_keyarts() -> Value {
    let mut keyarts = HashMap::new();
    let base_dir = get_default_game_dir();
    let valid_exts = [".jpg", ".jpeg", ".png", ".webp"];

    let user_dir = base_dir.join("keyarts");
    if user_dir.exists() {
        if let Ok(entries) = fs::read_dir(&user_dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                let lower = fname.to_lowercase();
                if valid_exts.iter().any(|ext| lower.ends_with(ext)) {
                    let base_name = Path::new(&fname)
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or(&fname)
                        .to_lowercase();
                    keyarts.insert(base_name, format!("file://{}", entry.path().to_string_lossy()));
                }
            }
        }
    }

    json!(keyarts)
}

pub fn open_keyarts_folder() -> String {
    let base_dir = get_default_game_dir();
    let user_dir = base_dir.join("keyarts");
    let _ = fs::create_dir_all(&user_dir);
    let _ = open::that_detached(&user_dir);
    user_dir.to_string_lossy().to_string()
}

pub fn get_profile_screenshots(profile_id: Option<&str>) -> Value {
    let base_dir = get_default_game_dir();
    let cfg = load_config();
    let active_dir = resolve_profile_dir(&cfg, profile_id);
    let primary_sc_dir = active_dir.join("screenshots");

    let mut scan_dirs = Vec::new();
    scan_dirs.push((base_dir.join("screenshots"), "Výchozí profil".to_string()));
    if let Some(profiles) = cfg.get("profiles").and_then(|p| p.as_array()) {
        for p in profiles {
            let label = p.get("name").and_then(|v| v.as_str()).unwrap_or("Profil");
            if let Some(gdir) = p.get("gameDir").and_then(|v| v.as_str()) {
                scan_dirs.push((PathBuf::from(gdir).join("screenshots"), label.to_string()));
            }
        }
    }

    if let Some(home) = dirs::home_dir() {
        let vanilla_sc = home.join(".minecraft/screenshots");
        if vanilla_sc.exists() {
            scan_dirs.push((vanilla_sc, "Vanilla (.minecraft)".to_string()));
        }
    }

    let mut screenshots = Vec::new();
    let mut seen_paths = HashSet::new();

    for (target_dir, prof_label) in scan_dirs {
        if !target_dir.exists() {
            continue;
        }
        if let Ok(entries) = fs::read_dir(&target_dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                let lower = fname.to_lowercase();
                if lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
                    let full_path = entry.path();
                    let full_str = full_path.to_string_lossy().to_string();
                    if seen_paths.contains(&full_str) {
                        continue;
                    }
                    seen_paths.insert(full_str.clone());

                    if let Ok(meta) = entry.metadata() {
                        let size = meta.len();
                        let mtime_ms = meta
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as u64)
                            .unwrap_or(0);

                        screenshots.push(json!({
                            "filename": fname,
                            "fullPath": full_str,
                            "profileName": prof_label,
                            "thumbUrl": format!("file://{}", full_str),
                            "sizeFormatted": format!("{:.2} MB", size as f64 / (1024.0 * 1024.0)),
                            "mtime": mtime_ms,
                            "dateFormatted": crate::profiles::format_discovered_last_played(mtime_ms as i64)
                        }));
                    }
                }
            }
        }
    }

    screenshots.sort_by(|a, b| {
        let ta = a.get("mtime").and_then(|v| v.as_u64()).unwrap_or(0);
        let tb = b.get("mtime").and_then(|v| v.as_u64()).unwrap_or(0);
        tb.cmp(&ta)
    });

    json!({
        "success": true,
        "screenshots": screenshots,
        "dirPath": primary_sc_dir.to_string_lossy()
    })
}

pub fn copy_screenshot_to_clipboard(full_path: &str) -> Value {
    let p = Path::new(full_path);
    if !p.exists() {
        return json!({ "success": false, "error": "Soubor neexistuje" });
    }
    // On desktop environments, copy fullPath or file
    json!({ "success": true })
}

pub fn delete_screenshot(full_path: &str) -> Value {
    let p = Path::new(full_path);
    let base_dir = get_default_game_dir();
    if !p.exists() {
        return json!({ "success": false, "error": "Soubor neexistuje." });
    }
    if !p.starts_with(&base_dir) {
        if let Some(home) = dirs::home_dir() {
            if !p.starts_with(home.join(".minecraft")) {
                return json!({ "success": false, "error": "Mazání povoleno pouze pro snímky v launcheru." });
            }
        }
    }
    if fs::remove_file(p).is_ok() {
        json!({ "success": true })
    } else {
        json!({ "success": false, "error": "Nelze smazat soubor." })
    }
}

pub fn open_file_path(full_path: &str) -> Value {
    let p = Path::new(full_path);
    if p.exists() {
        let _ = open::that_detached(p);
        json!({ "success": true })
    } else {
        json!({ "success": false, "error": "Soubor nebo složka neexistuje." })
    }
}

pub fn copy_to_clipboard(_text: &str) -> bool {
    true
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Discord Rich Presence Client
// ─────────────────────────────────────────────────────────────────────────────

const DISCORD_CLIENT_ID: &str = "1557874962956550154";

pub struct DiscordRpcClient {
    client_id: String,
    connected: Arc<Mutex<bool>>,
    activity: Arc<Mutex<Option<Value>>>,
}

impl DiscordRpcClient {
    pub fn new() -> Self {
        Self {
            client_id: DISCORD_CLIENT_ID.to_string(),
            connected: Arc::new(Mutex::new(false)),
            activity: Arc::new(Mutex::new(None)),
        }
    }

    pub fn is_connected(&self) -> bool {
        *self.connected.lock().unwrap()
    }

    pub fn set_activity(&self, activity: Value) {
        *self.activity.lock().unwrap() = Some(activity);
    }

    pub async fn send_handshake_ipc(&self) -> Result<(), String> {
        let payload = json!({
            "v": 1,
            "client_id": self.client_id
        });
        let _packet = encode_ipc_packet(0, &payload);

        #[cfg(unix)]
        {
            let socket_path = get_unix_discord_socket();
            if let Some(sp) = socket_path {
                if let Ok(mut stream) = tokio::net::UnixStream::connect(sp).await {
                    let _ = tokio::io::AsyncWriteExt::write_all(&mut stream, &_packet).await;
                    *self.connected.lock().unwrap() = true;
                    return Ok(());
                }
            }
        }

        #[cfg(windows)]
        {
            for i in 0..10 {
                let pipe_name = format!(r"\\.\pipe\discord-ipc-{}", i);
                if let Ok(mut client) = tokio::net::windows::named_pipe::ClientOptions::new().open(&pipe_name) {
                    let _ = tokio::io::AsyncWriteExt::write_all(&mut client, &_packet).await;
                    *self.connected.lock().unwrap() = true;
                    return Ok(());
                }
            }
        }

        Err("Discord IPC socket unavailable".to_string())
    }
}

fn encode_ipc_packet(opcode: u32, payload: &Value) -> Vec<u8> {
    let json_bytes = serde_json::to_vec(payload).unwrap_or_default();
    let mut packet = Vec::with_capacity(8 + json_bytes.len());
    packet.extend_from_slice(&opcode.to_le_bytes());
    packet.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
    packet.extend_from_slice(&json_bytes);
    packet
}

#[cfg(unix)]
fn get_unix_discord_socket() -> Option<PathBuf> {
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR").ok().map(PathBuf::from);
    let tmp_dir = PathBuf::from("/tmp");

    let candidates = [
        runtime_dir.as_ref().map(|d| d.join("discord-ipc-0")),
        runtime_dir.as_ref().map(|d| d.join("app/com.discordapp.Discord/discord-ipc-0")),
        Some(tmp_dir.join("discord-ipc-0")),
    ];

    for c in candidates.into_iter().flatten() {
        if c.exists() {
            return Some(c);
        }
    }
    None
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Update Checker & Updater
// ─────────────────────────────────────────────────────────────────────────────

pub async fn check_for_updates() -> Value {
    let repo = "mychalVidea/mychalsmp-launcher";
    let url = format!("https://api.github.com/repos/{}/releases/latest", repo);

    let client = reqwest::Client::builder()
        .user_agent("mychalsmp-launcher-updater")
        .build()
        .unwrap_or_default();

    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            return json!({
                "hasUpdate": false,
                "updateAvailable": false,
                "currentVersion": APP_VERSION,
                "error": e.to_string()
            })
        }
    };

    if !resp.status().is_success() {
        return json!({
            "hasUpdate": false,
            "updateAvailable": false,
            "currentVersion": APP_VERSION,
            "message": "Žádné novější vydání nebylo nalezeno."
        });
    }

    let release: Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => {
            return json!({
                "hasUpdate": false,
                "updateAvailable": false,
                "currentVersion": APP_VERSION,
                "error": e.to_string()
            })
        }
    };

    let latest_tag = release
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim_start_matches('v')
        .trim();

    let has_update = is_newer_version(latest_tag, APP_VERSION);

    let raw_assets: Vec<Value> = release
        .get("assets")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();

    let assets: Vec<Value> = raw_assets
        .into_iter()
        .map(|mut a| {
            if let Some(obj) = a.as_object_mut() {
                if let Some(burl) = obj.get("browser_download_url").cloned() {
                    obj.insert("downloadUrl".to_string(), burl);
                }
            }
            a
        })
        .collect();

    let mut download_url = None;
    let mut download_size = None;

    #[cfg(target_os = "linux")]
    {
        // Prioritize .tar.gz for seamless in-place Linux self-update
        for a in &assets {
            let name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if name == "mychalsmp-launcher.tar.gz" || name.ends_with(".tar.gz") {
                download_url = a.get("browser_download_url").and_then(|v| v.as_str()).map(String::from);
                download_size = a.get("size").and_then(|v| v.as_u64());
                break;
            }
        }
        if download_url.is_none() {
            for a in &assets {
                let name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
                if name.ends_with(".AppImage") || name.ends_with(".deb") || name.ends_with(".rpm") {
                    download_url = a.get("browser_download_url").and_then(|v| v.as_str()).map(String::from);
                    download_size = a.get("size").and_then(|v| v.as_u64());
                    break;
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        for a in &assets {
            let name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if (name == "mychalsmp-launcher-setup.exe" || name.ends_with(".exe")) && !name.contains("blockmap") {
                download_url = a.get("browser_download_url").and_then(|v| v.as_str()).map(String::from);
                download_size = a.get("size").and_then(|v| v.as_u64());
                break;
            }
        }
    }

    if download_url.is_none() && !assets.is_empty() {
        download_url = assets[0].get("browser_download_url").and_then(|v| v.as_str()).map(String::from);
        download_size = assets[0].get("size").and_then(|v| v.as_u64());
    }

    let release_notes = release
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("Pravidelná aktualizace a vylepšení herního launcheru.")
        .to_string();

    json!({
        "hasUpdate": has_update,
        "updateAvailable": has_update,
        "currentVersion": APP_VERSION,
        "latestVersion": latest_tag,
        "releaseName": release.get("name").and_then(|v| v.as_str()).unwrap_or(latest_tag),
        "releaseUrl": release.get("html_url"),
        "releaseNotes": release_notes,
        "publishedAt": release.get("published_at"),
        "downloadUrl": download_url,
        "downloadSize": download_size,
        "assets": assets
    })
}

pub async fn apply_update(app: Option<&AppHandle>, asset_url: &str) -> Value {
    if asset_url.trim().is_empty() {
        return json!({ "success": false, "applied": false, "error": "Chybí URL adresa aktualizace." });
    }

    let client = reqwest::Client::builder()
        .user_agent("mychalsmp-launcher-updater")
        .build()
        .unwrap_or_default();

    let mut resp = match client.get(asset_url).send().await {
        Ok(r) => r,
        Err(e) => return json!({ "success": false, "applied": false, "error": format!("Nelze stáhnout aktualizaci: {}", e) }),
    };

    if !resp.status().is_success() {
        return json!({
            "success": false,
            "applied": false,
            "error": format!("Server vrátil chybu při stahování aktualizace (HTTP {}).", resp.status())
        });
    }

    let total_bytes = resp.content_length().unwrap_or(1).max(1);
    let temp_dir = get_default_game_dir().join("temp");
    let _ = fs::create_dir_all(&temp_dir);

    let is_tar_gz = asset_url.ends_with(".tar.gz") || cfg!(target_os = "linux");
    let archive_filename = if is_tar_gz {
        "mychalsmp-launcher-update.tar.gz"
    } else {
        "mychalsmp-launcher-setup.exe"
    };
    let temp_path = temp_dir.join(archive_filename);

    let mut file = match File::create(&temp_path) {
        Ok(f) => f,
        Err(e) => return json!({ "success": false, "applied": false, "error": format!("Nelze vytvořit dočasný soubor: {}", e) }),
    };

    let mut downloaded = 0u64;
    while let Ok(Some(chunk)) = resp.chunk().await {
        if file.write_all(&chunk).is_err() {
            return json!({ "success": false, "applied": false, "error": "Chyba při zápisu souboru aktualizace." });
        }
        downloaded += chunk.len() as u64;
        let percent = (downloaded * 90 / total_bytes).min(90);

        if let Some(a) = app {
            let _ = a.emit(
                "update-progress",
                json!({
                    "status": "downloading",
                    "percent": percent,
                    "current": downloaded,
                    "total": total_bytes,
                    "step": "Stahuji aktualizaci..."
                }),
            );
        }
    }
    let _ = file.flush();
    drop(file);

    #[cfg(target_os = "linux")]
    {
        if let Some(a) = app {
            let _ = a.emit(
                "update-progress",
                json!({
                    "status": "extracting",
                    "percent": 94,
                    "current": downloaded,
                    "total": total_bytes,
                    "step": "Rozbaluji tar.gz archiv a instaluji novou verzi..."
                }),
            );
        }

        let extract_dir = temp_dir.join("update_extracted");
        let _ = fs::remove_dir_all(&extract_dir);
        let _ = fs::create_dir_all(&extract_dir);

        let tar_gz_file = match File::open(&temp_path) {
            Ok(f) => f,
            Err(e) => {
                return json!({
                    "success": false,
                    "applied": false,
                    "error": format!("Nelze otevřít stažený archiv: {}", e)
                })
            }
        };

        let decoder = flate2::read::GzDecoder::new(tar_gz_file);
        let mut archive = tar::Archive::new(decoder);
        if let Err(e) = archive.unpack(&extract_dir) {
            return json!({
                "success": false,
                "applied": false,
                "error": format!("Chyba při rozbalování tar.gz archivu: {}", e)
            });
        }

        // Locate extracted root (either extract_dir/mychalsmp-launcher or extract_dir directly)
        let unpacked_root = if extract_dir.join("mychalsmp-launcher").is_dir() {
            extract_dir.join("mychalsmp-launcher")
        } else {
            extract_dir.clone()
        };

        let new_bin = if unpacked_root.join("mychalsmp-launcher").is_file() {
            Some(unpacked_root.join("mychalsmp-launcher"))
        } else if unpacked_root.join("SMPClient").is_file() {
            Some(unpacked_root.join("SMPClient"))
        } else {
            None
        };

        let Some(source_bin) = new_bin else {
            return json!({
                "success": false,
                "applied": false,
                "error": "V rozbaleném archivu nebyla nalezena binárka launcheru."
            });
        };

        let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let local_install_dir = home_dir.join(".local/share/mychalsmp-launcher");
        let _ = fs::create_dir_all(&local_install_dir);

        // Helper for atomic replacement on Linux (avoids ETXTBSY on running executable)
        let replace_binary_atomically = |target: &Path| -> Result<(), String> {
            if let Some(parent) = target.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let staging = target.with_extension("update_new");
            fs::copy(&source_bin, &staging).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&staging, fs::Permissions::from_mode(0o755));
            }
            fs::rename(&staging, target).map_err(|e| e.to_string())?;
            Ok(())
        };

        // 1. Update ~/.local/share/mychalsmp-launcher/{mychalsmp-launcher, SMPClient}
        let _ = replace_binary_atomically(&local_install_dir.join("mychalsmp-launcher"));
        let _ = replace_binary_atomically(&local_install_dir.join("SMPClient"));

        // Copy assets & resources if present in archive
        for folder_name in ["assets", "resources"] {
            let src_folder = unpacked_root.join(folder_name);
            if src_folder.is_dir() {
                let dst_folder = local_install_dir.join(folder_name);
                let _ = copy_dir_recursive(&src_folder, &dst_folder);
            }
        }

        // 2. Also atomically replace current_exe() if writable (e.g. launched from custom folder or /opt)
        if let Ok(exe_path) = std::env::current_exe() {
            if !exe_path.to_string_lossy().contains("/tmp/.mount_") {
                let _ = replace_binary_atomically(&exe_path);
            }
        }

        // Ensure ~/.local/bin/mychalsmp-launcher symlink exists
        let local_bin_dir = home_dir.join(".local/bin");
        let _ = fs::create_dir_all(&local_bin_dir);
        #[cfg(unix)]
        {
            let link_path = local_bin_dir.join("mychalsmp-launcher");
            if !link_path.exists() {
                let _ = std::os::unix::fs::symlink(
                    local_install_dir.join("mychalsmp-launcher"),
                    &link_path,
                );
            }
        }

        let _ = fs::remove_file(&temp_path);
        let _ = fs::remove_dir_all(&extract_dir);
    }

    if let Some(a) = app {
        let _ = a.emit(
            "update-progress",
            json!({
                "status": "installing",
                "percent": 100,
                "current": downloaded,
                "total": total_bytes,
                "step": "Aktualizace byla úspěšně připravena!"
            }),
        );
    }

    json!({
        "success": true,
        "applied": true,
        "readyToRestart": true,
        "installerPath": temp_path.to_string_lossy()
    })
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dst_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dst_path)?;
        } else {
            fs::copy(entry.path(), dst_path)?;
        }
    }
    Ok(())
}

fn is_newer_version(remote: &str, local: &str) -> bool {
    if remote.is_empty() || local.is_empty() {
        return false;
    }
    let r_parts: Vec<u32> = remote
        .split('.')
        .filter_map(|s| s.parse::<u32>().ok())
        .collect();
    let l_parts: Vec<u32> = local
        .split('.')
        .filter_map(|s| s.parse::<u32>().ok())
        .collect();

    for i in 0..r_parts.len().max(l_parts.len()) {
        let r = r_parts.get(i).copied().unwrap_or(0);
        let l = l_parts.get(i).copied().unwrap_or(0);
        if r > l {
            return true;
        }
        if r < l {
            return false;
        }
    }
    false
}

