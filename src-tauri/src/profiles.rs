use crate::config::{
    get_default_game_dir, load_config, resolve_profile_dir, save_config,
};
use crate::mods::download_mod_or_pack_with_deps;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use chrono::{DateTime, Datelike, Local, Timelike, Utc};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;

/// Copies a directory recursively.
pub fn copy_dir_recursive(src: &Path, dest: &Path) -> std::io::Result<()> {
    if !src.exists() {
        return Ok(());
    }
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)?;
        } else {
            let _ = fs::copy(&src_path, &dest_path);
        }
    }
    Ok(())
}

/// Formats a millisecond timestamp into user-friendly Czech string.
pub fn format_discovered_last_played(timestamp_ms: i64) -> String {
    if timestamp_ms <= 0 {
        return "Dříve".to_string();
    }
    let dt = match DateTime::from_timestamp_millis(timestamp_ms) {
        Some(t) => t.with_timezone(&Local),
        None => return "Dříve".to_string(),
    };

    let now = Local::now();
    let time_str = format!("{:02}:{:02}", dt.hour(), dt.minute());

    if dt.year() == now.year() && dt.month() == now.month() && dt.day() == now.day() {
        format!("Dnes v {}", time_str)
    } else {
        let yesterday = now - chrono::Duration::days(1);
        if dt.year() == yesterday.year()
            && dt.month() == yesterday.month()
            && dt.day() == yesterday.day()
        {
            format!("Včera v {}", time_str)
        } else {
            format!("{}. {}. {}", dt.day(), dt.month(), dt.year())
        }
    }
}

/// Strips version and loader suffixes from a mod jar filename to deduce the mod slug/name.
pub fn extract_mod_slug_from_filename(filename: &str) -> String {
    let re1 = Regex::new(r"(?i)\.jar$").unwrap();
    let re2 = Regex::new(r"(?i)[-_](fabric|forge|quilt|neoforge|mc[0-9.]+|v?[0-9].*)").unwrap();
    let re3 = Regex::new(r"[-_]+[0-9].*$").unwrap();

    let no_ext = re1.replace(filename, "");
    let no_loader = re2.replace_all(&no_ext, "");
    let clean = re3.replace(&no_loader, "").trim().to_string();

    if clean.is_empty() {
        let parts: Vec<&str> = no_ext.split(&['-', '_'][..]).collect();
        parts.first().unwrap_or(&"").to_lowercase()
    } else {
        clean.to_lowercase()
    }
}

/// Scans an external directory (Prism, CurseForge, Modrinth, .minecraft)
/// to detect Minecraft version, loader, mods count, and available configs.
pub fn scan_instance_directory(dir_path: &Path) -> Result<Value, String> {
    if !dir_path.exists() {
        return Err("Vybraná složka neexistuje.".to_string());
    }

    let mut detected_version = "26.3".to_string();
    let mut detected_loader = "fabric".to_string();
    let instance_name = dir_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Instance")
        .to_string();
    let mut name = instance_name;

    // 1. Prism / MultiMC instance.cfg check
    let instance_cfg_path = dir_path.join("instance.cfg");
    if instance_cfg_path.exists() {
        if let Ok(content) = fs::read_to_string(&instance_cfg_path) {
            let re_ver = Regex::new(r"IntendedVersion=([^\r\n]+)").unwrap();
            let re_name = Regex::new(r"name=([^\r\n]+)").unwrap();
            if let Some(cap) = re_ver.captures(&content) {
                detected_version = cap[1].trim().to_string();
            }
            if let Some(cap) = re_name.captures(&content) {
                name = cap[1].trim().to_string();
            }
        }
    }

    // 2. mmc-pack.json check (MultiMC / Prism component list)
    let mmc_pack_path = dir_path.join("mmc-pack.json");
    if mmc_pack_path.exists() {
        if let Ok(content) = fs::read_to_string(&mmc_pack_path) {
            if let Ok(json_data) = serde_json::from_str::<Value>(&content) {
                if let Some(components) = json_data.get("components").and_then(|c| c.as_array()) {
                    for comp in components {
                        let uid = comp
                            .get("uid")
                            .or_else(|| comp.get("id"))
                            .and_then(|u| u.as_str())
                            .unwrap_or("");
                        if uid == "net.minecraft" {
                            if let Some(ver) = comp.get("version").and_then(|v| v.as_str()) {
                                detected_version = ver.to_string();
                            }
                        } else if uid == "net.fabricmc.fabric-loader" {
                            detected_loader = "fabric".to_string();
                        } else if uid == "net.minecraftforge" {
                            detected_loader = "forge".to_string();
                        } else if uid == "net.neoforged" {
                            detected_loader = "neoforge".to_string();
                        }
                    }
                }
            }
        }
    }

    // 3. CurseForge minecraftinstance.json
    let curse_json_path = dir_path.join("minecraftinstance.json");
    if curse_json_path.exists() {
        if let Ok(content) = fs::read_to_string(&curse_json_path) {
            if let Ok(c_data) = serde_json::from_str::<Value>(&content) {
                if let Some(gv) = c_data.get("gameVersion").and_then(|v| v.as_str()) {
                    detected_version = gv.to_string();
                }
                if let Some(c_name) = c_data.get("name").and_then(|v| v.as_str()) {
                    name = c_name.to_string();
                }
                if let Some(b_name) = c_data
                    .pointer("/baseModLoader/name")
                    .and_then(|v| v.as_str())
                {
                    let b_lower = b_name.to_lowercase();
                    if b_lower.contains("fabric") || b_lower.contains("quilt") {
                        detected_loader = "fabric".to_string();
                    } else if b_lower.contains("neoforge") {
                        detected_loader = "neoforge".to_string();
                    } else if b_lower.contains("forge") {
                        detected_loader = "forge".to_string();
                    }
                }
            }
        }
    }

    // 4. Modrinth modrinth.index.json
    let modrinth_index_path = dir_path.join("modrinth.index.json");
    if modrinth_index_path.exists() {
        if let Ok(content) = fs::read_to_string(&modrinth_index_path) {
            if let Ok(m_data) = serde_json::from_str::<Value>(&content) {
                if let Some(game) = m_data.get("game").and_then(|v| v.as_str()) {
                    detected_version = game.to_string();
                }
                if let Some(m_name) = m_data.get("name").and_then(|v| v.as_str()) {
                    name = m_name.to_string();
                }
                if let Some(deps) = m_data.get("dependencies").and_then(|d| d.as_object()) {
                    if deps.contains_key("fabric-loader") || deps.contains_key("quilt-loader") {
                        detected_loader = "fabric".to_string();
                    } else if deps.contains_key("neoforge") {
                        detected_loader = "neoforge".to_string();
                    } else if deps.contains_key("forge") {
                        detected_loader = "forge".to_string();
                    }
                }
            }
        }
    }

    // Subdirectory check (support .minecraft or minecraft inside MultiMC / Prism)
    let mut effective_game_dir = dir_path.to_path_buf();
    let sub_mc = dir_path.join(".minecraft");
    let sub_mc_alt = dir_path.join("minecraft");
    if sub_mc.exists() && sub_mc.join("mods").exists() {
        effective_game_dir = sub_mc;
    } else if sub_mc_alt.exists() && sub_mc_alt.join("mods").exists() {
        effective_game_dir = sub_mc_alt;
    }

    // Scan mods
    let mods_dir = effective_game_dir.join("mods");
    let mut mod_count = 0;
    let mut mod_files = Vec::new();
    if mods_dir.exists() {
        if let Ok(entries) = fs::read_dir(&mods_dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.to_lowercase().ends_with(".jar") {
                    mod_count += 1;
                    mod_files.push(fname);
                }
            }
        }
    }

    // If mods present and loader is still vanilla, infer from mod filenames
    if mod_count > 0 && detected_loader == "vanilla" {
        let has_neoforge = mod_files
            .iter()
            .any(|f| f.to_lowercase().contains("neoforge"));
        let has_forge = mod_files
            .iter()
            .any(|f| f.to_lowercase().contains("forge") && !f.to_lowercase().contains("neoforge"));
        if has_neoforge {
            detected_loader = "neoforge".to_string();
        } else if has_forge {
            detected_loader = "forge".to_string();
        } else {
            detected_loader = "fabric".to_string();
        }
    }

    // Scan resourcepacks
    let rp_dir = effective_game_dir.join("resourcepacks");
    let mut rp_count = 0;
    if rp_dir.exists() {
        if let Ok(entries) = fs::read_dir(&rp_dir) {
            rp_count = entries
                .flatten()
                .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
                .count();
        }
    }

    let has_config = effective_game_dir.join("config").exists();
    let has_options = effective_game_dir.join("options.txt").exists();
    let has_shaderpacks = effective_game_dir.join("shaderpacks").exists();

    Ok(json!({
        "originalDir": dir_path.to_string_lossy(),
        "effectiveGameDir": effective_game_dir.to_string_lossy(),
        "name": name,
        "detectedVersion": detected_version,
        "detectedLoader": detected_loader,
        "modCount": mod_count,
        "modFiles": mod_files.into_iter().take(50).collect::<Vec<_>>(),
        "rpCount": rp_count,
        "hasConfig": has_config,
        "hasOptions": has_options,
        "hasShaderpacks": has_shaderpacks
    }))
}

/// Automatically discovers profiles and instances across installed launchers
/// (.minecraft, Lunar, Prism, MultiMC, Modrinth, CurseForge).
pub fn discover_installed_profiles() -> Vec<Value> {
    let mut candidates: Vec<Value> = Vec::new();
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let mut seen_dirs: HashSet<String> = HashSet::new();

    let mut add_candidate = |cand: Value| {
        if let Some(game_dir) = cand.get("gameDir").and_then(|g| g.as_str()) {
            let norm = game_dir.trim().to_lowercase();
            if !seen_dirs.contains(&norm) {
                seen_dirs.insert(norm);
                candidates.push(cand);
            }
        }
    };

    // ── 1. Vanilla Minecraft (.minecraft) ──────────────────────────────────
    let mut dot_mc_paths = vec![
        home.join(".minecraft"),
        home.join(".var/app/com.mojang.Minecraft/.minecraft"),
    ];
    if cfg!(target_os = "windows") {
        if let Ok(appdata) = std::env::var("APPDATA") {
            dot_mc_paths.push(PathBuf::from(appdata).join(".minecraft"));
        }
    } else if cfg!(target_os = "macos") {
        dot_mc_paths.push(home.join("Library/Application Support/minecraft"));
    }

    for mc_dir in dot_mc_paths {
        if !mc_dir.exists() {
            continue;
        }

        let profiles_files = [
            mc_dir.join("launcher_profiles.json"),
            mc_dir.join("launcher_profiles_microsoft_store.json"),
        ];

        for pf in profiles_files {
            if !pf.exists() {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&pf) {
                if let Ok(data) = serde_json::from_str::<Value>(&content) {
                    if let Some(profs) = data.get("profiles").and_then(|p| p.as_object()) {
                        for (prof_key, prof) in profs {
                            let p_name = prof
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or(prof_key);
                            let v_id = prof
                                .get("lastVersionId")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let v_lower = v_id.to_lowercase();

                            let mut detected_loader = "vanilla";
                            if v_lower.contains("fabric") || v_lower.contains("quilt") {
                                detected_loader = "fabric";
                            } else if v_lower.contains("neoforge") {
                                detected_loader = "neoforge";
                            } else if v_lower.contains("forge") {
                                detected_loader = "forge";
                            }

                            let re_ver = Regex::new(r"(\d+\.\d+(\.\d+)?)").unwrap();
                            let detected_version = re_ver
                                .captures(v_id)
                                .map(|c| c[1].to_string())
                                .unwrap_or_else(|| {
                                    if !v_id.is_empty() {
                                        v_id.to_string()
                                    } else {
                                        "26.3".to_string()
                                    }
                                });

                            let effective_dir = prof
                                .get("gameDir")
                                .and_then(|v| v.as_str())
                                .map(PathBuf::from)
                                .unwrap_or_else(|| mc_dir.clone());
                            if !effective_dir.exists() {
                                continue;
                            }

                            let mut mod_count = 0;
                            let mods_path = effective_dir.join("mods");
                            if mods_path.exists() {
                                if let Ok(entries) = fs::read_dir(&mods_path) {
                                    mod_count = entries
                                        .flatten()
                                        .filter(|e| {
                                            e.file_name()
                                                .to_string_lossy()
                                                .to_lowercase()
                                                .ends_with(".jar")
                                        })
                                        .count();
                                }
                            }
                            if mod_count > 0 && detected_loader == "vanilla" {
                                detected_loader = "fabric";
                            }

                            let mut ts: i64 = 0;
                            if let Some(last_used) =
                                prof.get("lastUsed").and_then(|v| v.as_str())
                            {
                                if let Ok(parsed) = DateTime::parse_from_rfc3339(last_used) {
                                    ts = parsed.timestamp_millis();
                                }
                            }
                            if ts == 0 {
                                if let Ok(meta) = fs::metadata(effective_dir.join("options.txt")) {
                                    if let Ok(mtime) = meta.modified() {
                                        ts = mtime
                                            .duration_since(std::time::UNIX_EPOCH)
                                            .map(|d| d.as_millis() as i64)
                                            .unwrap_or(0);
                                    }
                                }
                            }

                            add_candidate(json!({
                                "id": format!("vanilla-{}", prof_key),
                                "source": "Minecraft Launcher",
                                "sourceIcon": "minecraft",
                                "name": p_name,
                                "version": detected_version,
                                "loader": detected_loader,
                                "gameDir": effective_dir.to_string_lossy(),
                                "modCount": mod_count,
                                "lastPlayedTimestamp": ts,
                                "lastPlayedFormatted": format_discovered_last_played(ts)
                            }));
                        }
                    }
                }
            }
        }
    }

    // ── 2. Lunar Client (.lunarclient) ─────────────────────────────────────
    let mut lunar_roots = vec![home.join(".lunarclient")];
    if cfg!(target_os = "windows") {
        if let Ok(appdata) = std::env::var("APPDATA") {
            lunar_roots.push(PathBuf::from(appdata).join(".lunarclient"));
        }
    }

    for l_root in lunar_roots {
        let multiver_dir = l_root.join("offline/multiver");
        if multiver_dir.exists() {
            if let Ok(entries) = fs::read_dir(&multiver_dir) {
                for sub in entries.flatten() {
                    let sub_path = sub.path();
                    if !sub_path.is_dir() {
                        continue;
                    }
                    let sub_name = sub.file_name().to_string_lossy().to_string();
                    let v_clean = sub_name.trim_start_matches('v').replace('_', ".");
                    let re_ver = Regex::new(r"(\d+\.\d+(\.\d+)?)").unwrap();
                    let detected_version = re_ver
                        .captures(&v_clean)
                        .map(|c| c[1].to_string())
                        .unwrap_or(v_clean);

                    let mut mod_count = 0;
                    let mods_path = sub_path.join("mods");
                    if mods_path.exists() {
                        if let Ok(m_entries) = fs::read_dir(&mods_path) {
                            mod_count = m_entries
                                .flatten()
                                .filter(|e| {
                                    e.file_name()
                                        .to_string_lossy()
                                        .to_lowercase()
                                        .ends_with(".jar")
                                })
                                .count();
                        }
                    }

                    let mut ts: i64 = 0;
                    let opt_path = sub_path.join("options.txt");
                    let stat_path = if opt_path.exists() {
                        opt_path
                    } else {
                        sub_path.clone()
                    };
                    if let Ok(meta) = fs::metadata(&stat_path) {
                        if let Ok(mtime) = meta.modified() {
                            ts = mtime
                                .duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_millis() as i64)
                                .unwrap_or(0);
                        }
                    }

                    add_candidate(json!({
                        "id": format!("lunar-{}", sub_name),
                        "source": "Lunar Client",
                        "sourceIcon": "lunar",
                        "name": format!("Lunar Client ({})", sub_name),
                        "version": detected_version,
                        "loader": "fabric",
                        "gameDir": sub_path.to_string_lossy(),
                        "modCount": mod_count,
                        "lastPlayedTimestamp": ts,
                        "lastPlayedFormatted": format_discovered_last_played(ts)
                    }));
                }
            }
        }
    }

    // ── 3. Prism Launcher & MultiMC ────────────────────────────────────────
    let mut prism_roots = vec![
        home.join(".local/share/PrismLauncher/instances"),
        home.join(".var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher/instances"),
        home.join(".local/share/multimc/instances"),
        home.join("MultiMC/instances"),
    ];
    if cfg!(target_os = "windows") {
        if let Ok(appdata) = std::env::var("APPDATA") {
            prism_roots.push(PathBuf::from(&appdata).join("PrismLauncher/instances"));
            prism_roots.push(PathBuf::from(&appdata).join("MultiMC/instances"));
        }
    }

    for p_root in prism_roots {
        if !p_root.exists() {
            continue;
        }
        let is_prism = p_root
            .to_string_lossy()
            .to_lowercase()
            .contains("prism");
        let source_name = if is_prism {
            "Prism Launcher"
        } else {
            "MultiMC"
        };
        if let Ok(entries) = fs::read_dir(&p_root) {
            for sub in entries.flatten() {
                let inst_dir = sub.path();
                let sub_name = sub.file_name().to_string_lossy().to_string();
                if !inst_dir.is_dir() || sub_name.starts_with('.') {
                    continue;
                }
                if let Ok(scan) = scan_instance_directory(&inst_dir) {
                    let mut ts: i64 = 0;
                    let eff_dir = scan
                        .get("effectiveGameDir")
                        .and_then(|v| v.as_str())
                        .map(PathBuf::from)
                        .unwrap_or_else(|| inst_dir.clone());
                    let opt_path = eff_dir.join("options.txt");
                    let stat_path = if opt_path.exists() {
                        opt_path
                    } else {
                        inst_dir.clone()
                    };
                    if let Ok(meta) = fs::metadata(&stat_path) {
                        if let Ok(mtime) = meta.modified() {
                            ts = mtime
                                .duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_millis() as i64)
                                .unwrap_or(0);
                        }
                    }

                    add_candidate(json!({
                        "id": format!("prism-{}", sub_name),
                        "source": source_name,
                        "sourceIcon": "prism",
                        "name": scan.get("name").and_then(|v| v.as_str()).unwrap_or(&sub_name),
                        "version": scan.get("detectedVersion").and_then(|v| v.as_str()).unwrap_or("26.3"),
                        "loader": scan.get("detectedLoader").and_then(|v| v.as_str()).unwrap_or("fabric"),
                        "gameDir": eff_dir.to_string_lossy(),
                        "modCount": scan.get("modCount").and_then(|v| v.as_u64()).unwrap_or(0),
                        "lastPlayedTimestamp": ts,
                        "lastPlayedFormatted": format_discovered_last_played(ts)
                    }));
                }
            }
        }
    }

    // ── 4. Modrinth App ────────────────────────────────────────────────────
    let mut modrinth_roots = vec![
        home.join(".local/share/ModrinthApp/profiles"),
        home.join(".var/app/com.modrinth.ModrinthApp/data/ModrinthApp/profiles"),
        home.join(".config/ModrinthApp/profiles"),
    ];
    if cfg!(target_os = "windows") {
        if let Ok(appdata) = std::env::var("APPDATA") {
            modrinth_roots.push(PathBuf::from(appdata).join("ModrinthApp/profiles"));
        }
    }

    for m_root in modrinth_roots {
        if !m_root.exists() {
            continue;
        }
        if let Ok(entries) = fs::read_dir(&m_root) {
            for sub in entries.flatten() {
                let prof_dir = sub.path();
                let sub_name = sub.file_name().to_string_lossy().to_string();
                if !prof_dir.is_dir() || sub_name.starts_with('.') {
                    continue;
                }
                if let Ok(scan) = scan_instance_directory(&prof_dir) {
                    let mut ts: i64 = 0;
                    let eff_dir = scan
                        .get("effectiveGameDir")
                        .and_then(|v| v.as_str())
                        .map(PathBuf::from)
                        .unwrap_or_else(|| prof_dir.clone());
                    let opt_path = eff_dir.join("options.txt");
                    let stat_path = if opt_path.exists() {
                        opt_path
                    } else {
                        prof_dir.clone()
                    };
                    if let Ok(meta) = fs::metadata(&stat_path) {
                        if let Ok(mtime) = meta.modified() {
                            ts = mtime
                                .duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_millis() as i64)
                                .unwrap_or(0);
                        }
                    }

                    add_candidate(json!({
                        "id": format!("modrinth-{}", sub_name),
                        "source": "Modrinth App",
                        "sourceIcon": "modrinth",
                        "name": scan.get("name").and_then(|v| v.as_str()).unwrap_or(&sub_name),
                        "version": scan.get("detectedVersion").and_then(|v| v.as_str()).unwrap_or("26.3"),
                        "loader": scan.get("detectedLoader").and_then(|v| v.as_str()).unwrap_or("fabric"),
                        "gameDir": eff_dir.to_string_lossy(),
                        "modCount": scan.get("modCount").and_then(|v| v.as_u64()).unwrap_or(0),
                        "lastPlayedTimestamp": ts,
                        "lastPlayedFormatted": format_discovered_last_played(ts)
                    }));
                }
            }
        }
    }

    // ── 5. CurseForge ──────────────────────────────────────────────────────
    let mut curse_roots = vec![
        home.join("curseforge/minecraft/Instances"),
        home.join(".local/share/curseforge/minecraft/Instances"),
        home.join("Documents/curseforge/minecraft/Instances"),
    ];
    if cfg!(target_os = "windows") {
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            curse_roots.push(PathBuf::from(userprofile).join("curseforge/minecraft/Instances"));
        }
    }

    for c_root in curse_roots {
        if !c_root.exists() {
            continue;
        }
        if let Ok(entries) = fs::read_dir(&c_root) {
            for sub in entries.flatten() {
                let inst_dir = sub.path();
                let sub_name = sub.file_name().to_string_lossy().to_string();
                if !inst_dir.is_dir() || sub_name.starts_with('.') {
                    continue;
                }
                if let Ok(scan) = scan_instance_directory(&inst_dir) {
                    let mut ts: i64 = 0;
                    let eff_dir = scan
                        .get("effectiveGameDir")
                        .and_then(|v| v.as_str())
                        .map(PathBuf::from)
                        .unwrap_or_else(|| inst_dir.clone());
                    let opt_path = eff_dir.join("options.txt");
                    let stat_path = if opt_path.exists() {
                        opt_path
                    } else {
                        inst_dir.clone()
                    };
                    if let Ok(meta) = fs::metadata(&stat_path) {
                        if let Ok(mtime) = meta.modified() {
                            ts = mtime
                                .duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_millis() as i64)
                                .unwrap_or(0);
                        }
                    }

                    add_candidate(json!({
                        "id": format!("curse-{}", sub_name),
                        "source": "CurseForge",
                        "sourceIcon": "curseforge",
                        "name": scan.get("name").and_then(|v| v.as_str()).unwrap_or(&sub_name),
                        "version": scan.get("detectedVersion").and_then(|v| v.as_str()).unwrap_or("26.3"),
                        "loader": scan.get("detectedLoader").and_then(|v| v.as_str()).unwrap_or("fabric"),
                        "gameDir": eff_dir.to_string_lossy(),
                        "modCount": scan.get("modCount").and_then(|v| v.as_u64()).unwrap_or(0),
                        "lastPlayedTimestamp": ts,
                        "lastPlayedFormatted": format_discovered_last_played(ts)
                    }));
                }
            }
        }
    }

    // Sort descending by lastPlayedTimestamp and take TOP 10
    candidates.sort_by(|a, b| {
        let ts_a = a.get("lastPlayedTimestamp").and_then(|v| v.as_i64()).unwrap_or(0);
        let ts_b = b.get("lastPlayedTimestamp").and_then(|v| v.as_i64()).unwrap_or(0);
        ts_b.cmp(&ts_a)
    });

    candidates.into_iter().take(10).collect()
}

/// Opens a directory picker dialog and scans the selected folder.
pub fn import_profile_dialog(app: &AppHandle) -> Value {
    if let Some(folder_path) = app.dialog().file().blocking_pick_folder() {
        let p = folder_path.as_path().unwrap_or_else(|| Path::new(""));
        match scan_instance_directory(p) {
            Ok(scan) => json!({ "canceled": false, "scan": scan }),
            Err(e) => json!({ "canceled": false, "error": e }),
        }
    } else {
        json!({ "canceled": true })
    }
}

/// Confirms the import of an external instance into MYCHAL SMP Launcher.
pub fn confirm_import_profile(data: &Value) -> Value {
    let source_dir = match data
        .get("sourceDir")
        .or_else(|| data.get("originalDir"))
        .and_then(|v| v.as_str())
    {
        Some(s) => PathBuf::from(s),
        None => return json!({ "success": false, "error": "Chybí zdrojová složka instance." }),
    };

    let effective_dir = data
        .get("effectiveDir")
        .or_else(|| data.get("effectiveGameDir"))
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
        .unwrap_or_else(|| source_dir.clone());

    let name = data
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Importovaný profil")
        .to_string();
    let version = data
        .get("version")
        .or_else(|| data.get("detectedVersion"))
        .and_then(|v| v.as_str())
        .unwrap_or("26.3")
        .to_string();
    let loader = data
        .get("loader")
        .or_else(|| data.get("detectedLoader"))
        .and_then(|v| v.as_str())
        .unwrap_or("fabric")
        .to_string();

    let timestamp = Utc::now().timestamp_millis();
    let profile_id = format!("imported-{}", timestamp);
    let base_dir = get_default_game_dir();
    let instance_dir = base_dir.join("instances").join(&profile_id);

    if let Err(e) = fs::create_dir_all(&instance_dir) {
        return json!({ "success": false, "error": format!("Nelze vytvořit složku instance: {}", e) });
    }

    // 1. Copy options.txt
    let options_src = effective_dir.join("options.txt");
    if options_src.exists() {
        let _ = fs::copy(&options_src, instance_dir.join("options.txt"));
    }

    // 2. Copy config/
    let config_src = effective_dir.join("config");
    if config_src.exists() {
        let _ = copy_dir_recursive(&config_src, &instance_dir.join("config"));
    }

    // 3. Copy mods
    let mods_src = effective_dir.join("mods");
    let mut imported_mod_count = 0;
    if mods_src.exists() {
        let dest_mods = instance_dir.join("mods");
        let _ = fs::create_dir_all(&dest_mods);
        if let Ok(entries) = fs::read_dir(&mods_src) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.to_lowercase().ends_with(".jar") {
                    if fs::copy(entry.path(), dest_mods.join(&fname)).is_ok() {
                        imported_mod_count += 1;
                    }
                }
            }
        }
    }

    // 4. Copy resourcepacks & shaderpacks
    let rp_src = effective_dir.join("resourcepacks");
    if rp_src.exists() {
        let _ = copy_dir_recursive(&rp_src, &instance_dir.join("resourcepacks"));
    }
    let sp_src = effective_dir.join("shaderpacks");
    if sp_src.exists() {
        let _ = copy_dir_recursive(&sp_src, &instance_dir.join("shaderpacks"));
    }

    let source_base = source_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("neznámo");
    let new_profile = json!({
        "id": profile_id,
        "name": name,
        "version": version,
        "loader": loader,
        "isImported": true,
        "optimizedChosen": if loader == "fabric" { "optimized" } else { "vanilla" },
        "desc": format!("Importováno z {} • {} módů", source_base, imported_mod_count),
        "icon": "import",
        "lastPlayed": "Právě importováno",
        "playtimeSeconds": 0,
        "gameDir": instance_dir.to_string_lossy()
    });

    let mut cfg = load_config();
    let mut profiles = cfg
        .get("profiles")
        .and_then(|p| p.as_array())
        .cloned()
        .unwrap_or_default();
    profiles.insert(0, new_profile.clone());
    cfg["profiles"] = Value::Array(profiles);
    cfg["activeProfileId"] = json!(profile_id);
    cfg["version"] = json!(version);
    cfg["loader"] = json!(loader);

    save_config(&cfg);

    json!({
        "success": true,
        "profile": new_profile,
        "profileId": profile_id,
        "importedModCount": imported_mod_count
    })
}

/// Upgrades an existing profile to target Minecraft version, resolving compatible mods on Modrinth.
pub async fn upgrade_profile(
    app: Option<&AppHandle>,
    source_profile_id: &str,
    target_version: &str,
) -> Value {
    let cfg = load_config();
    let profiles = cfg
        .get("profiles")
        .and_then(|p| p.as_array())
        .cloned()
        .unwrap_or_default();

    let source_profile = profiles
        .iter()
        .find(|p| p.get("id").and_then(|i| i.as_str()) == Some(source_profile_id))
        .or_else(|| profiles.first());

    let source_profile = match source_profile {
        Some(p) => p.clone(),
        None => return json!({ "success": false, "error": "Zdrojový profil nebyl nalezen." }),
    };

    let base_dir = get_default_game_dir();
    let source_game_dir = source_profile
        .get("gameDir")
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
        .unwrap_or_else(|| base_dir.clone());

    let timestamp = Utc::now().timestamp_millis();
    let new_profile_id = format!("profile-{}-{}", target_version, timestamp);
    let target_game_dir = base_dir.join("instances").join(&new_profile_id);

    if let Err(e) = fs::create_dir_all(&target_game_dir) {
        return json!({ "success": false, "error": format!("Nelze vytvořit složku cílového profilu: {}", e) });
    }

    if let Some(a) = app {
        let _ = a.emit(
            "upgrade-progress",
            json!({ "status": "Překopírovávám nastavení hry (options.txt)...", "percent": 5 }),
        );
    }

    // 1. Copy options.txt
    let src_options = source_game_dir.join("options.txt");
    if src_options.exists() {
        let _ = fs::copy(&src_options, target_game_dir.join("options.txt"));
    }

    // 2. Copy config/
    if let Some(a) = app {
        let _ = a.emit(
            "upgrade-progress",
            json!({ "status": "Překopírovávám konfigurace módů (config/)...", "percent": 15 }),
        );
    }
    let src_config = source_game_dir.join("config");
    if src_config.exists() {
        let _ = copy_dir_recursive(&src_config, &target_game_dir.join("config"));
    }

    // 3. Copy resourcepacks/ and shaderpacks/
    if let Some(a) = app {
        let _ = a.emit(
            "upgrade-progress",
            json!({ "status": "Překopírovávám textury a resource packy...", "percent": 25 }),
        );
    }
    let src_rp = source_game_dir.join("resourcepacks");
    if src_rp.exists() {
        let _ = copy_dir_recursive(&src_rp, &target_game_dir.join("resourcepacks"));
    }
    let src_sp = source_game_dir.join("shaderpacks");
    if src_sp.exists() {
        let _ = copy_dir_recursive(&src_sp, &target_game_dir.join("shaderpacks"));
    }

    // 4. Scan & Upgrade mods
    let src_mods_dir = source_game_dir.join("mods");
    let dest_mods_dir = target_game_dir.join("mods");
    let _ = fs::create_dir_all(&dest_mods_dir);

    let mut upgraded_mods = Vec::new();
    let mut disabled_mods = Vec::new();
    let mut missing_mods = Vec::new();

    let client = reqwest::Client::builder()
        .user_agent("mychalVidea/mychalsmp-launcher")
        .build()
        .unwrap_or_default();

    if src_mods_dir.exists() {
        let mut jar_files = Vec::new();
        if let Ok(entries) = fs::read_dir(&src_mods_dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                let lower = fname.to_lowercase();
                if lower.ends_with(".jar") || lower.ends_with(".jar.disabled") {
                    jar_files.push(fname);
                }
            }
        }

        let total = jar_files.len();
        for (idx, file) in jar_files.iter().enumerate() {
            let clean_jar_name = file.replace(".disabled", "");
            let jar_path = src_mods_dir.join(file);

            // Read fabric.mod.json from inside the jar
            let mut mod_id = None;
            let mut mod_name = None;
            if let Ok(f) = File::open(&jar_path) {
                if let Ok(mut archive) = zip::ZipArchive::new(f) {
                    if let Ok(mut fab_entry) = archive.by_name("fabric.mod.json") {
                        let mut fab_data = String::new();
                        if fab_entry.read_to_string(&mut fab_data).is_ok() {
                            if let Ok(fab_json) = serde_json::from_str::<Value>(&fab_data) {
                                mod_id = fab_json.get("id").and_then(|v| v.as_str()).map(String::from);
                                mod_name = fab_json.get("name").and_then(|v| v.as_str()).map(String::from);
                            }
                        }
                    }
                }
            }

            let slug = mod_id.unwrap_or_else(|| extract_mod_slug_from_filename(&clean_jar_name));
            let display_name = mod_name.unwrap_or_else(|| slug.clone());

            let percent = 30 + (idx as u32 * 60 / total.max(1) as u32);
            if let Some(a) = app {
                let _ = a.emit(
                    "upgrade-progress",
                    json!({
                        "status": format!("Hledám verzi pro {} ({}/{})...", display_name, idx + 1, total),
                        "percent": percent
                    }),
                );
            }

            // Query Modrinth
            let loader = source_profile
                .get("loader")
                .and_then(|v| v.as_str())
                .unwrap_or("fabric");
            let direct_url = format!(
                "https://api.modrinth.com/v2/project/{}/version?game_versions={}&loaders={}",
                urlencoding::encode(&slug),
                urlencoding::encode(&serde_json::to_string(&vec![target_version]).unwrap_or_default()),
                urlencoding::encode(&serde_json::to_string(&vec![loader]).unwrap_or_default()),
            );

            let mut found_version = None;
            if let Ok(resp) = client.get(&direct_url).send().await {
                if resp.status().is_success() {
                    if let Ok(v_list) = resp.json::<Vec<Value>>().await {
                        if let Some(first_v) = v_list.first() {
                            if let Some(files) = first_v.get("files").and_then(|f| f.as_array()) {
                                let primary = files
                                    .iter()
                                    .find(|f| f.get("primary").and_then(|p| p.as_bool()) == Some(true))
                                    .or_else(|| files.first());
                                if let Some(p_file) = primary {
                                    if let (Some(url), Some(fname)) = (
                                        p_file.get("url").and_then(|u| u.as_str()),
                                        p_file.get("filename").and_then(|n| n.as_str()),
                                    ) {
                                        found_version = Some((
                                            url.to_string(),
                                            fname.to_string(),
                                            first_v.get("version_number").and_then(|n| n.as_str()).unwrap_or("").to_string(),
                                        ));
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if let Some((dl_url, out_name, ver_num)) = found_version {
                let dest_path = dest_mods_dir.join(&out_name);
                let mut download_ok = false;
                if let Ok(dl_resp) = client.get(&dl_url).send().await {
                    if dl_resp.status().is_success() {
                        if let Ok(bytes) = dl_resp.bytes().await {
                            if fs::write(&dest_path, bytes).is_ok() {
                                download_ok = true;
                            }
                        }
                    }
                }
                if download_ok {
                    upgraded_mods.push(json!({
                        "oldFile": file,
                        "newFile": out_name,
                        "name": display_name,
                        "version": ver_num
                    }));
                } else {
                    let disabled_path = dest_mods_dir.join(format!("{}.disabled", clean_jar_name));
                    let _ = fs::copy(&jar_path, &disabled_path);
                    disabled_mods.push(json!({
                        "file": clean_jar_name,
                        "disabledFile": format!("{}.disabled", clean_jar_name),
                        "name": display_name,
                        "reason": format!("Chyba při stahování verze pro {}", target_version)
                    }));
                    missing_mods.push(clean_jar_name);
                }
            } else {
                let disabled_path = dest_mods_dir.join(format!("{}.disabled", clean_jar_name));
                let _ = fs::copy(&jar_path, &disabled_path);
                disabled_mods.push(json!({
                    "file": clean_jar_name,
                    "disabledFile": format!("{}.disabled", clean_jar_name),
                    "name": display_name,
                    "reason": format!("Zatím nepodporuje verzi {}", target_version)
                }));
                missing_mods.push(clean_jar_name);
            }
        }
    }

    let source_name = source_profile
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Profil");
    let source_version = source_profile
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("26.2");
    let loader = source_profile
        .get("loader")
        .and_then(|v| v.as_str())
        .unwrap_or("fabric");

    let desc_text = if !disabled_mods.is_empty() {
        format!(
            "Upgradováno z {} • {} aktualizováno, {} zakázáno (nekompatibilní)",
            source_version,
            upgraded_mods.len(),
            disabled_mods.len()
        )
    } else {
        format!(
            "Upgradováno z {} • {} aktualizovaných módů",
            source_version,
            upgraded_mods.len()
        )
    };

    let new_profile = json!({
        "id": new_profile_id,
        "name": format!("{} ({})", source_name, target_version),
        "version": target_version,
        "loader": loader,
        "optimizedChosen": if loader == "fabric" { "optimized" } else { "vanilla" },
        "desc": desc_text,
        "icon": "upgrade",
        "lastPlayed": "Právě upgradováno",
        "playtimeSeconds": 0,
        "gameDir": target_game_dir.to_string_lossy()
    });

    let mut cfg = load_config();
    let mut current_profiles = cfg
        .get("profiles")
        .and_then(|p| p.as_array())
        .cloned()
        .unwrap_or_default();
    current_profiles.push(new_profile.clone());
    cfg["profiles"] = Value::Array(current_profiles);
    cfg["activeProfileId"] = json!(new_profile_id);
    cfg["version"] = json!(target_version);
    cfg["loader"] = json!(loader);
    save_config(&cfg);

    if let Some(a) = app {
        let _ = a.emit(
            "upgrade-progress",
            json!({ "status": "Hotovo!", "percent": 100 }),
        );
    }

    json!({
        "success": true,
        "profile": new_profile,
        "profileId": new_profile_id,
        "upgradedMods": upgraded_mods,
        "disabledMods": disabled_mods,
        "missingMods": missing_mods,
        "totalChecked": upgraded_mods.len() + disabled_mods.len()
    })
}

/// Opens the specified profile's directory or subfolder in OS file manager.
pub fn open_profile_folder(profile_id: Option<&str>, subfolder: Option<&str>) -> bool {
    let cfg = load_config();
    let base_dir = get_default_game_dir();
    let profile_dir = resolve_profile_dir(&cfg, profile_id);
    let mut folder = profile_dir;

    if let Some(sub) = subfolder {
        let safe_sub = Path::new(sub).file_name().and_then(|n| n.to_str()).unwrap_or("");
        let allowed = [
            "mods",
            "resourcepacks",
            "shaderpacks",
            "screenshots",
            "saves",
            "logs",
            "config",
        ];
        if allowed.contains(&safe_sub) {
            folder = folder.join(safe_sub);
            let _ = fs::create_dir_all(&folder);
        }
    }

    if !folder.exists() {
        folder = base_dir;
    }

    open::that_detached(&folder).is_ok()
}

/// Updates settings of a profile in configuration.
pub fn update_profile_settings(profile_id: &str, updates: &Value) -> Value {
    let mut cfg = load_config();
    let mut profiles = cfg
        .get("profiles")
        .and_then(|p| p.as_array())
        .cloned()
        .unwrap_or_default();

    let mut found = false;
    for p in &mut profiles {
        if p.get("id").and_then(|v| v.as_str()) == Some(profile_id) {
            found = true;
            let is_imported = p.get("isImported").and_then(|v| v.as_bool()).unwrap_or(false)
                || profile_id.starts_with("imported-");

            if let Some(obj) = updates.as_object() {
                for (k, v) in obj {
                    if is_imported && k == "loader" {
                        continue;
                    }
                    p[k] = v.clone();
                    if k == "loader" {
                        p["optimizedChosen"] = if v.as_str() == Some("fabric") {
                            json!("optimized")
                        } else {
                            json!("vanilla")
                        };
                    }
                }
            }
        }
    }

    if !found {
        return json!({ "success": false, "error": "Profil nebyl nalezen." });
    }

    if cfg.get("activeProfileId").and_then(|v| v.as_str()) == Some(profile_id) {
        if let Some(ver) = updates.get("version") {
            cfg["version"] = ver.clone();
        }
        if let Some(loader) = updates.get("loader") {
            cfg["loader"] = loader.clone();
        }
    }

    cfg["profiles"] = Value::Array(profiles);
    save_config(&cfg);

    json!({ "success": true })
}

/// Deletes a profile from configuration and removes its disk files within `base_dir`.
pub fn delete_profile_in_dir(base_dir: &Path, cfg: &mut Value, profile_id: &str) -> Result<Value, String> {
    let safe_id = Path::new(profile_id)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    if safe_id.is_empty() || safe_id != profile_id || safe_id == "." || safe_id == ".." {
        return Err("Neplatné ID profilu.".to_string());
    }

    let profiles = cfg
        .get("profiles")
        .and_then(|p| p.as_array())
        .cloned()
        .unwrap_or_default();

    if profiles.len() <= 1 {
        return Err("V launcheru musí zůstat alespoň jeden profil.".to_string());
    }

    let target_profile = profiles
        .iter()
        .find(|p| p.get("id").and_then(|v| v.as_str()) == Some(safe_id))
        .cloned()
        .ok_or_else(|| "Profil nebyl nalezen.".to_string())?;

    let updated_profiles: Vec<Value> = profiles
        .into_iter()
        .filter(|p| p.get("id").and_then(|v| v.as_str()) != Some(safe_id))
        .collect();

    let is_shared_dir = |candidate: &Path| {
        updated_profiles.iter().any(|p| {
            p.get("gameDir")
                .and_then(|v| v.as_str())
                .map(|s| Path::new(s) == candidate)
                .unwrap_or(false)
        })
    };

    if let Some(game_dir_str) = target_profile.get("gameDir").and_then(|v| v.as_str()) {
        let gdir = PathBuf::from(game_dir_str);
        if gdir != base_dir && gdir.starts_with(base_dir) && gdir.exists() && !is_shared_dir(&gdir) {
            let _ = fs::remove_dir_all(&gdir);
        }
    }

    let prof_sub = base_dir.join("profiles").join(safe_id);
    if prof_sub.exists() && prof_sub.starts_with(base_dir) && !is_shared_dir(&prof_sub) {
        let _ = fs::remove_dir_all(&prof_sub);
    }
    let inst_sub = base_dir.join("instances").join(safe_id);
    if inst_sub.exists() && inst_sub.starts_with(base_dir) && !is_shared_dir(&inst_sub) {
        let _ = fs::remove_dir_all(&inst_sub);
    }

    let mut deleted_defaults: Vec<String> = cfg
        .get("deletedDefaultProfiles")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    if !deleted_defaults.iter().any(|x| x == safe_id) {
        deleted_defaults.push(safe_id.to_string());
    }
    cfg["deletedDefaultProfiles"] = json!(deleted_defaults);

    let active_id = cfg
        .get("activeProfileId")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let new_active_profile = if active_id == safe_id {
        updated_profiles.first().cloned()
    } else {
        updated_profiles
            .iter()
            .find(|p| p.get("id").and_then(|v| v.as_str()) == Some(active_id))
            .or_else(|| updated_profiles.first())
            .cloned()
    };

    let new_active_id = new_active_profile
        .as_ref()
        .and_then(|p| p.get("id").and_then(|v| v.as_str()))
        .unwrap_or("minecraft-26.3")
        .to_string();

    cfg["profiles"] = Value::Array(updated_profiles);
    cfg["activeProfileId"] = json!(new_active_id);
    if cfg.get("selectedProfile").and_then(|v| v.as_str()) == Some(safe_id) {
        cfg["selectedProfile"] = json!(new_active_id);
    }
    if let Some(ap) = new_active_profile {
        if let Some(ver) = ap.get("version") {
            cfg["version"] = ver.clone();
        }
        if let Some(loader) = ap.get("loader") {
            cfg["loader"] = loader.clone();
        }
    }

    Ok(json!({ "success": true, "activeProfileId": new_active_id }))
}

/// Deletes a profile from configuration and removes its disk files.
pub fn delete_profile(profile_id: &str) -> Value {
    let mut cfg = load_config();
    let base_dir = get_default_game_dir();
    match delete_profile_in_dir(&base_dir, &mut cfg, profile_id) {
        Ok(res) => {
            save_config(&cfg);
            res
        }
        Err(err) => json!({ "success": false, "error": err }),
    }
}

/// Resets launcher state and data.
pub fn reset_launcher_data() -> Value {
    let base_dir = get_default_game_dir();
    if base_dir.exists() {
        if let Ok(entries) = fs::read_dir(&base_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname != "assets" {
                    if path.is_dir() {
                        let _ = fs::remove_dir_all(&path);
                    } else {
                        let _ = fs::remove_file(&path);
                    }
                }
            }
        }
    }
    save_config(&crate::config::default_config());
    json!({ "success": true })
}

/// Generates an exportable profile seed (base64 encoded JSON starting with SMP-PACK:).
pub fn generate_profile_seed(profile_id: &str) -> Value {
    let cfg = load_config();
    let game_dir = resolve_profile_dir(&cfg, Some(profile_id));
    let profile = cfg
        .get("profiles")
        .and_then(|p| p.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|p| p.get("id").and_then(|v| v.as_str()) == Some(profile_id))
        });

    let profile_name = profile
        .and_then(|p| p.get("name").and_then(|v| v.as_str()))
        .unwrap_or("Můj balíček");
    let mc_version = profile
        .and_then(|p| p.get("version").and_then(|v| v.as_str()))
        .unwrap_or("26.3");
    let loader = profile
        .and_then(|p| p.get("loader").and_then(|v| v.as_str()))
        .unwrap_or("fabric");

    let mut items = Vec::new();

    // 1. Mods
    let mods_dir = game_dir.join("mods");
    if mods_dir.exists() {
        let meta_map = fs::read_to_string(mods_dir.join(".mod_meta.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .unwrap_or_else(|| json!({}));

        if let Ok(entries) = fs::read_dir(&mods_dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.to_lowercase().ends_with(".jar") {
                    let clean = fname.replace(".jar", "");
                    let meta = meta_map.get(&fname).cloned().unwrap_or_else(|| json!({}));
                    items.push(json!({
                        "id": meta.get("id").and_then(|v| v.as_str()).unwrap_or(&clean).to_lowercase(),
                        "title": meta.get("title").and_then(|v| v.as_str()).unwrap_or(&clean),
                        "type": "mod",
                        "filename": fname,
                        "version": meta.get("version"),
                        "loader": meta.get("loader").and_then(|v| v.as_str()).unwrap_or(loader),
                        "downloadUrl": meta.get("downloadUrl")
                    }));
                }
            }
        }
    }

    // 2. Resource Packs
    let rp_dir = game_dir.join("resourcepacks");
    if rp_dir.exists() {
        let meta_map = fs::read_to_string(rp_dir.join(".mod_meta.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .unwrap_or_else(|| json!({}));

        if let Ok(entries) = fs::read_dir(&rp_dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.to_lowercase().ends_with(".zip") {
                    let clean = fname.replace(".zip", "");
                    let meta = meta_map.get(&fname).cloned().unwrap_or_else(|| json!({}));
                    items.push(json!({
                        "id": meta.get("id").and_then(|v| v.as_str()).unwrap_or(&clean).to_lowercase(),
                        "title": meta.get("title").and_then(|v| v.as_str()).unwrap_or(&clean),
                        "type": "resourcepack",
                        "filename": fname,
                        "downloadUrl": meta.get("downloadUrl")
                    }));
                }
            }
        }
    }

    // 3. Shader Packs
    let sp_dir = game_dir.join("shaderpacks");
    if sp_dir.exists() {
        let meta_map = fs::read_to_string(sp_dir.join(".mod_meta.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .unwrap_or_else(|| json!({}));

        if let Ok(entries) = fs::read_dir(&sp_dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.to_lowercase().ends_with(".zip") {
                    let clean = fname.replace(".zip", "");
                    let meta = meta_map.get(&fname).cloned().unwrap_or_else(|| json!({}));
                    items.push(json!({
                        "id": meta.get("id").and_then(|v| v.as_str()).unwrap_or(&clean).to_lowercase(),
                        "title": meta.get("title").and_then(|v| v.as_str()).unwrap_or(&clean),
                        "type": "shader",
                        "filename": fname,
                        "downloadUrl": meta.get("downloadUrl")
                    }));
                }
            }
        }
    }

    let payload = json!({
        "v": 1,
        "name": profile_name,
        "mc": mc_version,
        "loader": loader,
        "date": Utc::now().to_rfc3339(),
        "items": items
    });

    let json_str = serde_json::to_string(&payload).unwrap_or_default();
    let seed_string = format!("SMP-PACK:{}", BASE64.encode(json_str.as_bytes()));

    json!({
        "success": true,
        "seed": seed_string,
        "seedString": seed_string,
        "code": seed_string,
        "packCode": seed_string,
        "count": items.len(),
        "itemCount": items.len(),
        "items": items,
        "payload": payload
    })
}

/// Imports items from a seed string (SMP-PACK: or SMP-SEED:) into the specified profile.
pub async fn import_profile_seed(
    app: Option<&AppHandle>,
    profile_id: &str,
    seed_string: &str,
) -> Value {
    if seed_string.trim().is_empty() {
        return json!({ "success": false, "error": "Zadej platný kód balíčku." });
    }

    let mut cleaned = seed_string.trim();
    if let Some(s) = cleaned.strip_prefix("SMP-PACK:") {
        cleaned = s.trim();
    } else if let Some(s) = cleaned.strip_prefix("SMP-SEED:") {
        cleaned = s.trim();
    }

    let decoded = match BASE64.decode(cleaned.as_bytes()) {
        Ok(b) => b,
        Err(_) => {
            return json!({ "success": false, "error": "Formát kódu balíčku je poškozený nebo neplatný." })
        }
    };

    let payload: Value = match serde_json::from_slice(&decoded) {
        Ok(v) => v,
        Err(_) => {
            return json!({ "success": false, "error": "Formát kódu balíčku je poškozený nebo neplatný." })
        }
    };

    let items = match payload.get("items").and_then(|i| i.as_array()) {
        Some(arr) if !arr.is_empty() => arr.clone(),
        _ => return json!({ "success": false, "error": "Balíček neobsahuje žádné módy ani doplňky." }),
    };

    let total = items.len();
    let mut installed_count = 0;
    let mut failed_count = 0;
    let mut failed_items = Vec::new();

    for (idx, it) in items.iter().enumerate() {
        let it_title = it
            .get("title")
            .or_else(|| it.get("id"))
            .and_then(|v| v.as_str())
            .unwrap_or("Položka")
            .to_string();

        if let Some(a) = app {
            let _ = a.emit(
                "profile-seed-progress",
                json!({
                    "current": idx + 1,
                    "total": total,
                    "percent": ((idx + 1) * 100 / total) as u32,
                    "title": it_title
                }),
            );
        }

        let mut mod_opts = it.clone();
        mod_opts["profileId"] = json!(profile_id);
        if mod_opts.get("version").is_none() {
            if let Some(mc) = payload.get("mc") {
                mod_opts["version"] = mc.clone();
            }
        }
        if mod_opts.get("loader").is_none() {
            if let Some(ldr) = payload.get("loader") {
                mod_opts["loader"] = ldr.clone();
            }
        }

        let dl_res = if let Some(a) = app {
            download_mod_or_pack_with_deps(a, &mod_opts).await
        } else {
            Err("AppHandle not provided for download".to_string())
        };

        match dl_res {
            Ok(res) if res.get("success").and_then(|v| v.as_bool()) == Some(true) => {
                installed_count += 1;
            }
            _ => {
                failed_count += 1;
                failed_items.push(it_title);
            }
        }
    }

    json!({
        "success": true,
        "total": total,
        "installedCount": installed_count,
        "failedCount": failed_count,
        "failedItems": failed_items
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("mychalsmp_{}_{}", label, nanos));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_delete_profile_removes_dir_and_records_deleted_default() {
        let base = make_temp_dir("del_prof");
        let inst_dir = base.join("instances").join("vanilla-26-1");
        fs::create_dir_all(inst_dir.join("mods")).unwrap();
        fs::write(inst_dir.join("mods").join("test.jar"), b"abc").unwrap();

        let mut cfg = json!({
            "activeProfileId": "vanilla-26-1",
            "selectedProfile": "vanilla-26-1",
            "profiles": [
                {
                    "id": "mychalsmp-fabric",
                    "name": "MYCHAL SMP",
                    "version": "26.3",
                    "loader": "fabric"
                },
                {
                    "id": "vanilla-26-1",
                    "name": "Vanilla 26.1.2",
                    "version": "26.1.2",
                    "loader": "vanilla",
                    "gameDir": inst_dir.to_string_lossy()
                }
            ]
        });

        let res = delete_profile_in_dir(&base, &mut cfg, "vanilla-26-1").expect("should delete");
        assert_eq!(res["success"], json!(true));
        assert_eq!(res["activeProfileId"], json!("mychalsmp-fabric"));
        assert!(!inst_dir.exists(), "instance folder should be removed");
        assert_eq!(cfg["profiles"].as_array().unwrap().len(), 1);
        assert_eq!(cfg["selectedProfile"], json!("mychalsmp-fabric"));
        assert!(cfg["deletedDefaultProfiles"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "vanilla-26-1"));

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn test_delete_profile_rejects_last_profile() {
        let base = make_temp_dir("del_last");
        let mut cfg = json!({
            "activeProfileId": "mychalsmp-fabric",
            "profiles": [{ "id": "mychalsmp-fabric", "version": "26.3", "loader": "fabric" }]
        });
        let err = delete_profile_in_dir(&base, &mut cfg, "mychalsmp-fabric").unwrap_err();
        assert!(err.contains("alespoň jeden"));
        let _ = fs::remove_dir_all(&base);
    }
}

