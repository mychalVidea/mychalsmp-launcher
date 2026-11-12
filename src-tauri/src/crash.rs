use crate::config::{load_config, resolve_profile_dir, save_config};
use crate::mods::download_mod_or_pack_with_deps;
use regex::Regex;
use serde_json::{json, Value};
use std::fs::{self, File};
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tauri::AppHandle;

/// Searches for the newest crash report in gameDir/crash-reports modified within the last 30 minutes.
pub fn find_latest_crash_report(game_dir: &Path) -> Option<PathBuf> {
    let crash_dir = game_dir.join("crash-reports");
    if !crash_dir.exists() {
        return None;
    }

    let mut latest_file: Option<(PathBuf, SystemTime)> = None;
    if let Ok(entries) = fs::read_dir(&crash_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file()
                && path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|s| s.eq_ignore_ascii_case("txt"))
                    .unwrap_or(false)
            {
                if let Ok(meta) = entry.metadata() {
                    if let Ok(mtime) = meta.modified() {
                        if let Ok(elapsed) = mtime.elapsed() {
                            // Within last 30 minutes (1800 seconds)
                            if elapsed.as_secs() <= 1800 {
                                match &latest_file {
                                    Some((_, prev_mtime)) => {
                                        if mtime > *prev_mtime {
                                            latest_file = Some((path, mtime));
                                        }
                                    }
                                    None => {
                                        latest_file = Some((path, mtime));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    latest_file.map(|(p, _)| p)
}

/// Reads the tail of `latest.log` (up to last 512KB and max_lines).
pub fn read_latest_log_tail(game_dir: &Path, max_lines: usize) -> String {
    let log_path = game_dir.join("logs/latest.log");
    if !log_path.exists() {
        return String::new();
    }

    let file = match File::open(&log_path) {
        Ok(f) => f,
        Err(_) => return String::new(),
    };

    let metadata = match file.metadata() {
        Ok(m) => m,
        Err(_) => return String::new(),
    };

    let file_len = metadata.len();
    let max_read = 512 * 1024; // 512 KB
    let read_size = file_len.min(max_read);

    let mut reader = BufReader::new(file);
    if file_len > read_size {
        if reader.seek(SeekFrom::End(-(read_size as i64))).is_err() {
            return String::new();
        }
    }

    let mut content = Vec::new();
    if reader.read_to_end(&mut content).is_err() {
        return String::new();
    }

    let text = String::from_utf8_lossy(&content);
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() > max_lines {
        lines[lines.len() - max_lines..].join("\n")
    } else {
        lines.join("\n")
    }
}

/// Extracts missing mod dependencies from logs.
pub fn extract_missing_dependency(text: &str) -> Option<(String, String)> {
    let lower = text.to_lowercase();

    // 1. [HARD_DEP particle_core {depends fzzy_config}]
    let re_hard = Regex::new(
        r"(?i)\[HARD_DEP(?:_NO_CANDIDATE)?\s+([a-zA-Z0-9_\-]+)\s+[^{]*\{depends\s+([a-zA-Z0-9_\-]+)",
    )
    .unwrap();
    if let Some(caps) = re_hard.captures(text) {
        let mod_id = caps[1].to_string();
        let dep_id = caps[2].to_string();
        let dep_lower = dep_id.to_lowercase();
        if !["minecraft", "java", "fabricloader", "fabric-loader", "fabric", "quilt_loader", "quiltloader"].contains(&dep_lower.as_str()) {
            return Some((dep_id, mod_id));
        }
    }

    // 2. Fix: add [add:fzzy_config
    let re_fix = Regex::new(r"(?i)Fix:\s*add\s*\[add:([a-zA-Z0-9_\-]+)").unwrap();
    if let Some(caps) = re_fix.captures(text) {
        let dep_id = caps[1].to_string();
        let dep_lower = dep_id.to_lowercase();
        if !["minecraft", "java", "fabricloader", "fabric-loader", "fabric"].contains(&dep_lower.as_str()) {
            return Some((dep_id, "Nainstalovaný mód".to_string()));
        }
    }

    // 3. Mod 'X' requires 'Y'
    let re_req = Regex::new(r"(?i)requires\s+([a-zA-Z0-9_\-]+)").unwrap();
    if let Some(caps) = re_req.captures(text) {
        let dep_id = caps[1].to_string();
        let dep_lower = dep_id.to_lowercase();
        if !["minecraft", "java", "fabricloader", "fabric-loader", "fabric"].contains(&dep_lower.as_str()) {
            return Some((dep_id, "Nainstalovaný mód".to_string()));
        }
    }

    // 4. depends on <dep_id>
    if let Some(idx) = lower.find("depends ") {
        let after = &text[idx + 8..];
        let dep = after
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim_matches(|c: char| !c.is_alphanumeric() && c != '_' && c != '-');
        let dep_lower = dep.to_lowercase();
        if !dep.is_empty()
            && !["minecraft", "java", "fabricloader", "fabric-loader", "fabric"].contains(&dep_lower.as_str())
        {
            return Some((dep.to_string(), "Nainstalovaný mód".to_string()));
        }
    }

    None
}

/// Extracts incompatible mod filename from logs.
pub fn extract_incompatible_mod_filename(text: &str) -> Option<String> {
    let re_jar = Regex::new(r"([a-zA-Z0-9_\-\.\+]+\.jar)").unwrap();
    if let Some(caps) = re_jar.captures(text) {
        return Some(caps[1].to_string());
    }
    None
}

/// Extracts the true culprit mod ID from deep Mixin / SpongePowered crash stacks,
/// specifically avoiding false attribution to 'sodium' or other entrypoint providers.
pub fn extract_mixin_culprit_mod(text: &str) -> Option<String> {
    // 1. Check for Mixin [config:... from mod <culpritModId>]
    let re_from_mod = Regex::new(r"Mixin\s*\[[^\]]+?\s+from\s+mod\s+([a-zA-Z0-9_\-]+)\]").unwrap();
    if let Some(caps) = re_from_mod.captures(text) {
        let mod_id = caps[1].to_string();
        if !mod_id.eq_ignore_ascii_case("minecraft") {
            return Some(mod_id);
        }
    }

    // 2. Check for @Mixin target ... was not found ... from mod <culpritModId>
    let re_target_mod = Regex::new(r"@Mixin\s+target[^\n]+?from\s+mod\s+([a-zA-Z0-9_\-]+)").unwrap();
    if let Some(caps) = re_target_mod.captures(text) {
        let mod_id = caps[1].to_string();
        if !mod_id.eq_ignore_ascii_case("minecraft") {
            return Some(mod_id);
        }
    }

    // 3. Check for Caused by: ... from mod <culpritModId>
    let re_caused_by = Regex::new(r"Caused\s+by:[^\n]+?from\s+mod\s+([a-zA-Z0-9_\-]+)").unwrap();
    if let Some(caps) = re_caused_by.captures(text) {
        let mod_id = caps[1].to_string();
        if !mod_id.eq_ignore_ascii_case("minecraft") {
            return Some(mod_id);
        }
    }

    // 4. Check for MixinApplyError: Mixin [<culpritModId>.mixins.json:...]
    let re_mixin_config = Regex::new(r"Mixin\s*\[([a-zA-Z0-9_\-]+)\.mixins\.json").unwrap();
    if let Some(caps) = re_mixin_config.captures(text) {
        let mod_id = caps[1].to_string();
        if !mod_id.eq_ignore_ascii_case("minecraft") {
            return Some(mod_id);
        }
    }

    None
}

/// Intelligent Czech Crash Diagnosis Engine.
pub fn analyze_crash(
    game_dir: &Path,
    exit_code: i32,
    combined_logs: &str,
    _options: Option<&Value>,
) -> Value {
    let lower = combined_logs.to_lowercase();

    // False positive clean shutdown check
    if exit_code == 0
        || lower.contains("client shutdown from post-main")
        || lower.contains("clientshutdownwatchdog")
    {
        return json!({
            "hasCrash": false,
            "isCleanShutdown": true,
            "fixed": false
        });
    }

    let crash_report_path = find_latest_crash_report(game_dir);
    let crash_content = crash_report_path
        .as_ref()
        .and_then(|p| fs::read_to_string(p).ok())
        .unwrap_or_default();

    let full_text = if !crash_content.is_empty() {
        format!("{}\n{}", combined_logs, crash_content)
    } else {
        combined_logs.to_string()
    };
    let full_lower = full_text.to_lowercase();

    // Collect recent error lines for log excerpt
    let mut recent_errors: Vec<String> = Vec::new();
    for line in full_text.lines() {
        let l_upper = line.to_uppercase();
        if l_upper.contains("ERROR")
            || l_upper.contains("FATAL")
            || l_upper.contains("EXCEPTION")
            || l_upper.contains("CRASH")
        {
            if recent_errors.len() >= 25 {
                recent_errors.remove(0);
            }
            recent_errors.push(line.trim().to_string());
        }
    }
    let log_excerpt = if !recent_errors.is_empty() {
        recent_errors.join("\n")
    } else {
        full_text
            .lines()
            .rev()
            .take(20)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n")
    };

    // 1. Out of Memory
    if full_lower.contains("outofmemoryerror")
        || full_lower.contains("java heap space")
        || full_lower.contains("gc overhead limit")
    {
        return json!({
            "hasCrash": true,
            "isCleanShutdown": false,
            "fixed": false,
            "crashType": "OUT_OF_MEMORY",
            "title": "Nedostatek paměti RAM",
            "message": "Minecraftu došla alokovaná paměť RAM (OutOfMemoryError). Pro plynulý běh s módy zvyšte paměť RAM v nastavení profilu.",
            "autoFix": {
                "type": "increase_ram",
                "label": "Zvýšit alokovanou RAM o 2 GB",
                "addRamGb": 2
            },
            "logExcerpt": log_excerpt,
            "crashReportPath": crash_report_path.as_ref().map(|p| p.to_string_lossy())
        });
    }

    // 2. Java Version Mismatch
    if full_lower.contains("unsupportedclassversionerror")
        || full_lower.contains("compiled by a more recent version of the java runtime")
        || full_lower.contains("class file format")
    {
        return json!({
            "hasCrash": true,
            "isCleanShutdown": false,
            "fixed": false,
            "crashType": "JAVA_VERSION_MISMATCH",
            "title": "Nekompatibilní verze Java",
            "message": "Nainstalované módy vyžadují novější verzi Javy (např. Java 21 nebo Java 25). Zkontrolujte nastavení runtime v launcheru.",
            "autoFix": {
                "type": "switch_java",
                "label": "Detekovat a přepnout na Java 21/25"
            },
            "logExcerpt": log_excerpt,
            "crashReportPath": crash_report_path.as_ref().map(|p| p.to_string_lossy())
        });
    }

    // 3. Missing Mod Dependency
    if full_lower.contains("[hard_dep")
        || full_lower.contains("requires {")
        || full_lower.contains("fix: add [add:")
        || full_lower.contains("missing dependency")
        || full_lower.contains("depends on")
    {
        if let Some((dep_id, mod_name)) = extract_missing_dependency(&full_text) {
            return json!({
                "hasCrash": true,
                "isCleanShutdown": false,
                "fixed": false,
                "crashType": "MISSING_DEPENDENCY",
                "title": "Chybějící závislost módu",
                "message": format!("Mód '{}' vyžaduje pro spuštění doplněk '{}'. Můžete jej nainstalovat jedním kliknutím.", mod_name, dep_id),
                "autoFix": {
                    "type": "install_mod",
                    "label": format!("Nainstalovat chybějící mód '{}'", dep_id),
                    "modId": dep_id
                },
                "logExcerpt": log_excerpt,
                "crashReportPath": crash_report_path.as_ref().map(|p| p.to_string_lossy())
            });
        }
    }

    // Helper to find a mod JAR matching an ID or prefix in the mods directory
    let find_mod_file_in_dir = |mods_dir: &Path, mod_id: &str| -> Option<String> {
        let lower_id = mod_id.to_lowercase();
        if let Ok(entries) = fs::read_dir(mods_dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                let fname_lower = fname.to_lowercase();
                if (fname_lower.ends_with(".jar") || fname_lower.ends_with(".jar.disabled"))
                    && (fname_lower.starts_with(&lower_id) || fname_lower.contains(&lower_id))
                {
                    return Some(fname);
                }
            }
        }
        None
    };

    // 4. Missing / Corrupted Client JAR (ClassNotFoundException: net.minecraft.client.main.Main)
    if full_text.contains("ClassNotFoundException: net.minecraft.client.main.Main") {
        return json!({
            "hasCrash": true,
            "isCleanShutdown": false,
            "fixed": false,
            "crashType": "CORRUPT_CLIENT_JAR",
            "title": "Chybějící nebo poškozený herní soubor Minecraftu",
            "message": "Základní herní soubor Minecraftu (client.jar) chybí nebo je poškozený. Kliknutím níže jej můžete znovu stáhnout a opravit.",
            "autoFix": {
                "type": "repair_client_jar",
                "label": "Znovu stáhnout čistý Minecraft Client JAR"
            },
            "logExcerpt": log_excerpt,
            "crashReportPath": crash_report_path.as_ref().map(|p| p.to_string_lossy())
        });
    }

    // 5. Sodium vs Iris Version Incompatibility (breaks iris <= 1.11.7)
    if full_lower.contains("is incompatible with")
        && ((full_lower.contains("sodium") && full_lower.contains("iris"))
            || (full_lower.contains("mod 'sodium'") && full_lower.contains("mod 'iris'")))
    {
        let mods_dir = game_dir.join("mods");
        let iris_file = find_mod_file_in_dir(&mods_dir, "iris")
            .unwrap_or_else(|| "iris.jar".to_string());
        return json!({
            "hasCrash": true,
            "isCleanShutdown": false,
            "fixed": false,
            "crashType": "INCOMPATIBLE_MODS",
            "title": "Nekompatibilita módů Sodium a Iris",
            "message": "Detekován konflikt verzí mezi Sodium a Iris pro tuto verzi Minecraftu. Doporučujeme Iris dočasně vypnout nebo aktualizovat na kompatibilní verzi.",
            "autoFix": {
                "type": "disable_mod",
                "label": format!("Zakázat kolidující mód {}", iris_file),
                "filename": iris_file,
                "modId": "iris"
            },
            "logExcerpt": log_excerpt,
            "crashReportPath": crash_report_path.as_ref().map(|p| p.to_string_lossy())
        });
    }

    // 6. Deep Mixin Culprit Diagnosis (e.g. brightnessplus failing inside SodiumPreLaunch)
    // Never blame 'sodium' simply because it provided the preLaunch stage!
    if let Some(culprit_id) = extract_mixin_culprit_mod(&full_text) {
        let mods_dir = game_dir.join("mods");
        let matching_file = find_mod_file_in_dir(&mods_dir, &culprit_id)
            .unwrap_or_else(|| format!("{}.jar", culprit_id));

        return json!({
            "hasCrash": true,
            "isCleanShutdown": false,
            "fixed": false,
            "crashType": "INCOMPATIBLE_MODS",
            "title": format!("Chyba módu '{}' (Mixin pád)", culprit_id),
            "message": format!("Mód '{}' způsobil pád hry při aplikaci Mixin transformace herního kódu. Doporučujeme tento mód vypnout.", culprit_id),
            "autoFix": {
                "type": "disable_mod",
                "label": format!("Zakázat nekompatibilní mód '{}'", culprit_id),
                "filename": matching_file,
                "modId": culprit_id
            },
            "logExcerpt": log_excerpt,
            "crashReportPath": crash_report_path.as_ref().map(|p| p.to_string_lossy())
        });
    }

    // 7. Incompatible Mods / Mixin Collision / Duplicate
    if full_lower.contains("incompatible mods found!")
        || full_lower.contains("duplicate mod")
        || full_lower.contains("duplicate files found for mod")
        || full_lower.contains("mixintransformererror")
        || full_lower.contains("critical injection failure")
        || full_lower.contains("failed to inject into")
    {
        let conflicting_file = extract_incompatible_mod_filename(&full_text);
        let auto_fix = conflicting_file.as_ref().map(|fname| {
            json!({
                "type": "disable_mod",
                "label": format!("Zakázat konfliktní soubor {}", fname),
                "filename": fname
            })
        });

        return json!({
            "hasCrash": true,
            "isCleanShutdown": false,
            "fixed": false,
            "crashType": "INCOMPATIBLE_MODS",
            "title": "Konflikt mezi módy",
            "message": "Detekován konflikt mezi nainstalovanými módy nebo nekompatibilní modifikace herního jádra.",
            "autoFix": auto_fix,
            "logExcerpt": log_excerpt,
            "crashReportPath": crash_report_path.as_ref().map(|p| p.to_string_lossy())
        });
    }

    // 8. OpenGL / Graphics Driver
    if full_lower.contains("glfw error 65542")
        || full_lower.contains("wgl: the driver does not appear to support opengl")
        || full_lower.contains("pixel format not accelerated")
        || full_lower.contains("ig9ic64.dll")
        || full_lower.contains("nvoglv64.dll")
    {
        return json!({
            "hasCrash": true,
            "isCleanShutdown": false,
            "fixed": false,
            "crashType": "OPENGL_DRIVER",
            "title": "Chyba grafického ovladače",
            "message": "Grafická karta nepodporuje požadovanou verzi OpenGL nebo chybí ovladače výrobce grafické karty (NVIDIA, AMD nebo Intel).",
            "autoFix": {
                "type": "open_url",
                "label": "Otevřít návod na aktualizaci ovladačů",
                "url": "https://mychalsmp.xyz"
            },
            "logExcerpt": log_excerpt,
            "crashReportPath": crash_report_path.as_ref().map(|p| p.to_string_lossy())
        });
    }

    // 6. Generic Game Crash
    json!({
        "hasCrash": true,
        "isCleanShutdown": false,
        "fixed": false,
        "crashType": "GAME_CRASH",
        "title": "Kritický pád herního jádra",
        "message": format!("Hra byla neočekávaně ukončena s kódem {}.", exit_code),
        "autoFix": Value::Null,
        "logExcerpt": log_excerpt,
        "crashReportPath": crash_report_path.as_ref().map(|p| p.to_string_lossy())
    })
}

/// Executes an automatic 1-click crash fix based on the diagnosis.
pub async fn apply_crash_fix(
    app: Option<&AppHandle>,
    auto_fix: &Value,
    profile_id: Option<&str>,
) -> Value {
    let fix_type = auto_fix
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match fix_type {
        "increase_ram" => {
            let mut cfg = load_config();
            let current_max = cfg
                .get("maxRam")
                .and_then(|v| v.as_u64())
                .unwrap_or(4096) as u32;

            let add_gb = auto_fix.get("addRamGb").and_then(|v| v.as_u64()).unwrap_or(2) as u32;
            let target_mb = (current_max + (add_gb * 1024)).min(16384);

            cfg["maxRam"] = json!(target_mb);

            if let Some(pid) = profile_id {
                if let Some(profiles) = cfg.get_mut("profiles").and_then(|p| p.as_array_mut()) {
                    for p in profiles {
                        if p.get("id").and_then(|v| v.as_str()) == Some(pid) {
                            p["maxRam"] = json!(target_mb);
                        }
                    }
                }
            }

            save_config(&cfg);
            json!({
                "success": true,
                "message": format!("Paměť RAM byla úspěšně navýšena na {} MB.", target_mb)
            })
        }
        "disable_mod" => {
            let filename = auto_fix.get("filename").and_then(|v| v.as_str());
            let mod_id = auto_fix.get("modId").and_then(|v| v.as_str());
            if filename.is_none() && mod_id.is_none() {
                return json!({ "success": false, "error": "Chybí název souboru nebo identifikátor módu k zakázání." });
            }

            let cfg = load_config();
            let game_dir = resolve_profile_dir(&cfg, profile_id);
            let mods_dir = game_dir.join("mods");

            let target_filename = if let Some(f) = filename {
                if mods_dir.join(f).exists() {
                    f.to_string()
                } else if let Some(m) = mod_id {
                    let mut found = None;
                    if let Ok(entries) = fs::read_dir(&mods_dir) {
                        for entry in entries.flatten() {
                            let name = entry.file_name().to_string_lossy().to_string();
                            if name.to_lowercase().contains(&m.to_lowercase()) && name.ends_with(".jar") {
                                found = Some(name);
                                break;
                            }
                        }
                    }
                    found.unwrap_or_else(|| f.to_string())
                } else {
                    f.to_string()
                }
            } else if let Some(m) = mod_id {
                let mut found = None;
                if let Ok(entries) = fs::read_dir(&mods_dir) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.to_lowercase().contains(&m.to_lowercase()) && name.ends_with(".jar") {
                            found = Some(name);
                            break;
                        }
                    }
                }
                found.unwrap_or_else(|| format!("{}.jar", m))
            } else {
                return json!({ "success": false, "error": "Chybí název souboru k zakázání." });
            };

            let src_file = mods_dir.join(&target_filename);
            if !src_file.exists() {
                return json!({ "success": false, "error": format!("Soubor {} nebyl v profilu nalezen.", target_filename) });
            }

            let dest_file = mods_dir.join(format!("{}.disabled", target_filename.replace(".disabled", "")));
            match crate::mods::resilient_rename(&src_file, &dest_file) {
                Ok(_) => json!({
                    "success": true,
                    "message": format!("Konfliktní mód '{}' byl zakázán.", target_filename)
                }),
                Err(e) => json!({
                    "success": false,
                    "error": format!("Nelze zakázat mód: {}", e)
                }),
            }
        }
        "repair_client_jar" => {
            let cfg = load_config();
            let base_dir = crate::config::get_default_game_dir();
            let profile = cfg
                .get("profiles")
                .and_then(|p| p.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .find(|p| p.get("id").and_then(|v| v.as_str()) == profile_id)
                });
            let mc_ver = profile
                .and_then(|p| p.get("version").and_then(|v| v.as_str()))
                .or_else(|| cfg.get("version").and_then(|v| v.as_str()))
                .unwrap_or("26.3");

            let jar_path = base_dir.join("versions").join(mc_ver).join(format!("{}.jar", mc_ver));
            if jar_path.exists() {
                let _ = fs::remove_file(&jar_path);
            }

            match crate::launcher::fetch_or_cache_mojang_manifest(&base_dir, mc_ver).await {
                Ok(manifest) => {
                    match crate::launcher::ensure_vanilla_client_jar(&base_dir, mc_ver, &manifest).await {
                        Ok(_) => json!({
                            "success": true,
                            "message": format!("Herní soubor verze {} byl úspěšně opraven a stažen.", mc_ver)
                        }),
                        Err(e) => json!({
                            "success": false,
                            "error": format!("Chyba při stahování herního souboru: {}", e)
                        }),
                    }
                }
                Err(e) => json!({
                    "success": false,
                    "error": format!("Nelze načíst manifest verze: {}", e)
                }),
            }
        }
        "install_mod" => {
            let mod_id = match auto_fix.get("modId").and_then(|v| v.as_str()) {
                Some(id) => id,
                None => return json!({ "success": false, "error": "Chybí identifikátor módu." }),
            };

            if let Some(a) = app {
                let opts = json!({
                    "id": mod_id,
                    "title": mod_id,
                    "projectType": "mod",
                    "profileId": profile_id
                });
                match download_mod_or_pack_with_deps(a, &opts).await {
                    Ok(_) => json!({
                        "success": true,
                        "message": format!("Mód '{}' byl úspěšně stažen a nainstalován.", mod_id)
                    }),
                    Err(e) => json!({
                        "success": false,
                        "error": format!("Chyba při stahování módu: {}", e)
                    }),
                }
            } else {
                json!({
                    "success": false,
                    "error": "Aplikace není připravena pro stahování doplňků."
                })
            }
        }
        "open_url" => {
            let url = auto_fix
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("https://mychalsmp.xyz");
            let _ = open::that_detached(url);
            json!({ "success": true })
        }
        _ => json!({
            "success": false,
            "error": "Neznámý nebo nepodporovaný typ automatické opravy."
        }),
    }
}

