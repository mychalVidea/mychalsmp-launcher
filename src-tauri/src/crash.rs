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
                            // Only consider crash reports created by the just-exited session (within 15 seconds)
                            if elapsed.as_secs() <= 15 {
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

const NON_MOD_WORDS: &[&str] = &[
    "minecraft",
    "java",
    "fabricloader",
    "fabric-loader",
    "fabric",
    "quilt_loader",
    "quiltloader",
    "version",
    "versions",
    "any",
    "mod",
    "mods",
    "the",
    "a",
    "an",
    "to",
    "for",
    "of",
    "between",
    "with",
    "which",
];

fn is_valid_dep_candidate(dep_lower: &str) -> bool {
    !dep_lower.is_empty() && !NON_MOD_WORDS.contains(&dep_lower)
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
        if is_valid_dep_candidate(&dep_id.to_lowercase()) {
            return Some((dep_id, mod_id));
        }
    }

    // 2. Fix: add [add:fzzy_config
    let re_fix = Regex::new(r"(?i)Fix:\s*add\s*\[add:([a-zA-Z0-9_\-]+)").unwrap();
    if let Some(caps) = re_fix.captures(text) {
        let dep_id = caps[1].to_string();
        if is_valid_dep_candidate(&dep_id.to_lowercase()) {
            return Some((dep_id, "Nainstalovaný mód".to_string()));
        }
    }

    // 2.5 Fabric formatted: "Mod 'Name' (mod_id) ... of mod 'Dep Name' (dep_id), which is missing!"
    let re_missing_mod = Regex::new(
        r"(?i)Mod\s+'[^']+'\s+\(([a-zA-Z0-9_\-]+)\)[^\n]*(?:requires|depends\s+on)[^\n]*of\s+mod\s+'[^']+'\s+\(([a-zA-Z0-9_\-]+)\),?\s*which\s+is\s+missing",
    )
    .unwrap();
    if let Some(caps) = re_missing_mod.captures(text) {
        let mod_id = caps[1].to_string();
        let dep_id = caps[2].to_string();
        if is_valid_dep_candidate(&dep_id.to_lowercase()) {
            return Some((dep_id, mod_id));
        }
    }

    // 3. Mod 'X' requires 'Y'
    let re_req = Regex::new(r"(?i)requires\s+([a-zA-Z0-9_\-]+)").unwrap();
    if let Some(caps) = re_req.captures(text) {
        let dep_id = caps[1].to_string();
        if is_valid_dep_candidate(&dep_id.to_lowercase()) {
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
        if is_valid_dep_candidate(&dep.to_lowercase()) {
            return Some((dep.to_string(), "Nainstalovaný mód".to_string()));
        }
    }

    None
}

/// Returns true when the Fabric crash log describes a version/compatibility conflict
/// rather than a simple missing third-party library mod.
fn is_mod_incompatibility_crash(full_lower: &str) -> bool {
    if full_lower.contains("is incompatible with")
        || full_lower.contains("replace mod '")
        || full_lower.contains("remove mod '")
    {
        return true;
    }

    let mentions_runtime_dep = (full_lower.contains("requires version")
        || full_lower.contains("requires any version")
        || full_lower.contains("depends on"))
        && (full_lower.contains("'minecraft'")
            || full_lower.contains("'fabricloader'")
            || full_lower.contains("'fabric-loader'")
            || full_lower.contains("'java'"));
    if mentions_runtime_dep {
        return true;
    }

    full_lower.contains("incompatible mods found!")
        && !full_lower.contains("which is missing")
        && !full_lower.contains("fix: add [add:")
}

/// Extracts candidate mod IDs involved in an incompatible-mods error (excluding core/protected IDs).
fn extract_incompatible_mod_candidates(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut push_id = |id: &str| {
        let clean = id.trim();
        if !clean.is_empty()
            && !is_protected_mod_id(clean)
            && !out.iter().any(|existing: &String| existing.eq_ignore_ascii_case(clean))
        {
            out.push(clean.to_string());
        }
    };

    // 1. Explicit Replace/Remove suggestions by Fabric Loader
    let re_action =
        Regex::new(r"(?i)(?:Replace|Remove)\s+mod\s+'[^']+'\s+\(([a-zA-Z0-9_\-]+)\)").unwrap();
    for caps in re_action.captures_iter(text) {
        push_id(&caps[1]);
    }

    // 2. Hard dependency / incompatibility culprit lines
    let re_hard = Regex::new(
        r"(?i)\[HARD_DEP(?:_NO_CANDIDATE)?\s+([a-zA-Z0-9_\-]+)\s+[^{]*\{depends\s+([a-zA-Z0-9_\-]+)",
    )
    .unwrap();
    for caps in re_hard.captures_iter(text) {
        push_id(&caps[1]);
        push_id(&caps[2]);
    }

    // 3. Detailed Fabric Mod 'Name' (mod_id) entries
    let re_mod_entry = Regex::new(r"(?i)Mod\s+'[^']+'\s+\(([a-zA-Z0-9_\-]+)\)").unwrap();
    for caps in re_mod_entry.captures_iter(text) {
        push_id(&caps[1]);
    }

    out
}

fn fabric_json_matches_id(json_str: &str, candidate_lower: &str) -> bool {
    let Ok(val) = serde_json::from_str::<Value>(json_str) else {
        return false;
    };
    if let Some(id) = val.get("id").and_then(|v| v.as_str()) {
        if id.eq_ignore_ascii_case(candidate_lower) {
            return true;
        }
    }
    if let Some(provides) = val.get("provides").and_then(|v| v.as_array()) {
        for p in provides {
            if p.as_str().map(|s| s.eq_ignore_ascii_case(candidate_lower)).unwrap_or(false) {
                return true;
            }
        }
    }
    false
}

fn jar_contains_mod_id(path: &Path, candidate_lower: &str) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    let Ok(mut archive) = zip::ZipArchive::new(file) else {
        return false;
    };

    if let Ok(mut entry) = archive.by_name("fabric.mod.json") {
        let mut content = String::new();
        if entry.read_to_string(&mut content).is_ok()
            && fabric_json_matches_id(&content, candidate_lower)
        {
            return true;
        }
    }

    // Check nested Jar-in-Jar submods (e.g. *_bundle inside META-INF/jars/*.jar)
    let nested_names: Vec<String> = (0..archive.len())
        .filter_map(|i| {
            let f = archive.by_index(i).ok()?;
            let name = f.name().to_string();
            if name.starts_with("META-INF/jars/") && name.ends_with(".jar") {
                Some(name)
            } else {
                None
            }
        })
        .collect();

    for nested_name in nested_names {
        let Ok(mut nested_entry) = archive.by_name(&nested_name) else {
            continue;
        };
        let mut bytes = Vec::new();
        if nested_entry.read_to_end(&mut bytes).is_err() {
            continue;
        }
        let cursor = std::io::Cursor::new(bytes);
        if let Ok(mut nested_zip) = zip::ZipArchive::new(cursor) {
            if let Ok(mut sub_fmj) = nested_zip.by_name("fabric.mod.json") {
                let mut content = String::new();
                if sub_fmj.read_to_string(&mut content).is_ok()
                    && fabric_json_matches_id(&content, candidate_lower)
                {
                    return true;
                }
            }
        }
    }

    false
}

fn normalize_mod_token(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Finds an installed active `.jar` in `mods_dir` matching any candidate mod ID
/// (via filename, `fabric.mod.json`, or nested `META-INF/jars/*.jar` sub-mods).
fn find_installed_mod_jar_by_ids(mods_dir: &Path, candidates: &[String]) -> Option<(String, String)> {
    let entries: Vec<String> = fs::read_dir(mods_dir)
        .ok()?
        .flatten()
        .filter_map(|e| {
            let fname = e.file_name().to_string_lossy().to_string();
            let lower = fname.to_lowercase();
            if e.path().is_file()
                && lower.ends_with(".jar")
                && !lower.starts_with("fabric-loader")
                && !lower.starts_with("fabric-api")
                && !lower.starts_with("minecraft")
                && !lower.starts_with("selfnametag")
                && !lower.starts_with("smpclient")
            {
                Some(fname)
            } else {
                None
            }
        })
        .collect();

    for cand in candidates {
        let cand_lower = cand.to_lowercase();
        if is_protected_mod_id(&cand_lower) {
            continue;
        }
        let cand_norm = normalize_mod_token(&cand_lower);

        // 1. Exact JAR fabric.mod.json / nested JiJ match (most accurate)
        for fname in &entries {
            if jar_contains_mod_id(&mods_dir.join(fname), &cand_lower) {
                return Some((fname.clone(), cand.clone()));
            }
        }

        // 2. Filename prefix / substring match
        if !cand_norm.is_empty() {
            for fname in &entries {
                let f_norm = normalize_mod_token(fname.trim_end_matches(".jar"));
                if f_norm.starts_with(&cand_norm) || fname.to_lowercase().contains(&cand_lower) {
                    return Some((fname.clone(), cand.clone()));
                }
            }
        }
    }

    None
}

/// Extracts incompatible mod filename from logs ONLY when explicitly identified as a duplicate or remove target.
pub fn extract_incompatible_mod_filename(text: &str) -> Option<String> {
    // 1. Explicit duplicate mod file in mods/ folder
    let re_dup = Regex::new(r"(?i)(?:Duplicate[^\n]+|mods[/\\])([a-zA-Z0-9_\-\.\+]+\.jar)").unwrap();
    if let Some(caps) = re_dup.captures(text) {
        let fname = caps[1].to_string();
        let lower = fname.to_lowercase();
        if !lower.starts_with("fabric-loader")
            && !lower.starts_with("fabric-api")
            && !lower.starts_with("minecraft")
            && !lower.starts_with("selfnametag")
            && !lower.starts_with("smpclient")
        {
            return Some(fname);
        }
    }
    None
}

const PROTECTED_CORE_MOD_IDS: &[&str] = &[
    "minecraft",
    "java",
    "fabricloader",
    "fabric-loader",
    "fabric",
    "fabric-api",
    "fabric_api",
    "mixinextras",
    "sodium",
    "lithium",
    "selfnametag",
    "smpclient",
];

fn is_protected_mod_id(mod_id: &str) -> bool {
    let lower = mod_id.to_lowercase();
    PROTECTED_CORE_MOD_IDS.contains(&lower.as_str()) || lower.starts_with("fabric-")
}

/// Extracts the true culprit mod ID from deep Mixin / SpongePowered crash stacks,
/// specifically avoiding false attribution to 'sodium' or other entrypoint providers.
pub fn extract_mixin_culprit_mod(text: &str) -> Option<String> {
    // 1. Check for Mixin [config:... from mod <culpritModId>]
    let re_from_mod = Regex::new(r"Mixin\s*\[[^\]]+?\s+from\s+mod\s+([a-zA-Z0-9_\-]+)\]").unwrap();
    if let Some(caps) = re_from_mod.captures(text) {
        let mod_id = caps[1].to_string();
        if !is_protected_mod_id(&mod_id) {
            return Some(mod_id);
        }
    }

    // 2. Check for @Mixin target ... was not found ... from mod <culpritModId>
    let re_target_mod = Regex::new(r"@Mixin\s+target[^\n]+?from\s+mod\s+([a-zA-Z0-9_\-]+)").unwrap();
    if let Some(caps) = re_target_mod.captures(text) {
        let mod_id = caps[1].to_string();
        if !is_protected_mod_id(&mod_id) {
            return Some(mod_id);
        }
    }

    // 3. Check for Caused by: ... from mod <culpritModId>
    let re_caused_by = Regex::new(r"Caused\s+by:[^\n]+?from\s+mod\s+([a-zA-Z0-9_\-]+)").unwrap();
    if let Some(caps) = re_caused_by.captures(text) {
        let mod_id = caps[1].to_string();
        if !is_protected_mod_id(&mod_id) {
            return Some(mod_id);
        }
    }

    // 4. Check for MixinApplyError: Mixin [<culpritModId>.mixins.json:...]
    let re_mixin_config = Regex::new(r"Mixin\s*\[([a-zA-Z0-9_\-]+)\.mixins\.json").unwrap();
    if let Some(caps) = re_mixin_config.captures(text) {
        let mod_id = caps[1].to_string();
        if !is_protected_mod_id(&mod_id) {
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

    // Also inspect newest hs_err_pid*.log in game_dir modified in last 30s
    let hs_err_content = fs::read_dir(game_dir)
        .ok()
        .and_then(|entries| {
            entries
                .flatten()
                .filter_map(|entry| {
                    let path = entry.path();
                    let name = path.file_name()?.to_str()?;
                    if !(name.starts_with("hs_err_pid") && name.ends_with(".log")) {
                        return None;
                    }
                    let mtime = entry.metadata().ok()?.modified().ok()?;
                    if mtime.elapsed().ok()?.as_secs() <= 30 {
                        Some((path, mtime))
                    } else {
                        None
                    }
                })
                .max_by_key(|(_, mt)| *mt)
                .and_then(|(p, _)| fs::read_to_string(p).ok())
        })
        .unwrap_or_default();

    let mut full_text = combined_logs.to_string();
    if !crash_content.is_empty() {
        full_text.push('\n');
        full_text.push_str(&crash_content);
    }
    if !hs_err_content.is_empty() {
        full_text.push('\n');
        full_text.push_str(&hs_err_content);
    }
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

    let report_path_str = crash_report_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string());

    // 1. Out of Memory
    if full_lower.contains("outofmemoryerror")
        || full_lower.contains("java heap space")
        || full_lower.contains("gc overhead limit")
    {
        let msg = "Minecraftu došla alokovaná paměť RAM (OutOfMemoryError). Pro plynulý běh s módy zvyšte paměť RAM v nastavení profilu.";
        return json!({
            "hasCrash": true,
            "isCleanShutdown": false,
            "fixed": false,
            "exitCode": exit_code,
            "crashType": "OUT_OF_MEMORY",
            "title": "Nedostatek paměti RAM",
            "message": msg,
            "description": msg,
            "recommendation": "Navýšit alokovanou paměť RAM pro tento profil.",
            "autoFix": {
                "id": "INCREASE_RAM",
                "type": "increase_ram",
                "label": "Zvýšit alokovanou RAM o 2 GB",
                "addRamGb": 2
            },
            "logExcerpt": log_excerpt,
            "stackExcerpt": log_excerpt,
            "crashReportPath": report_path_str,
            "reportPath": report_path_str
        });
    }

    // 2. Java Version Mismatch
    if full_lower.contains("unsupportedclassversionerror")
        || full_lower.contains("compiled by a more recent version of the java runtime")
        || full_lower.contains("class file format")
    {
        let msg = "Nainstalované módy vyžadují novější verzi Javy (např. Java 21 nebo Java 25). Zkontrolujte nastavení runtime v launcheru.";
        return json!({
            "hasCrash": true,
            "isCleanShutdown": false,
            "fixed": false,
            "exitCode": exit_code,
            "crashType": "JAVA_VERSION_MISMATCH",
            "title": "Nekompatibilní verze Java",
            "message": msg,
            "description": msg,
            "recommendation": "Přepnout na vestavěné prostředí Java 21/25.",
            "autoFix": {
                "id": "SWITCH_JAVA",
                "type": "switch_java",
                "label": "Detekovat a přepnout na Java 21/25"
            },
            "logExcerpt": log_excerpt,
            "stackExcerpt": log_excerpt,
            "crashReportPath": report_path_str,
            "reportPath": report_path_str
        });
    }

    // 3. Missing Mod Dependency (only when NOT an incompatibility crash and dependency isn't already installed)
    let mods_dir = game_dir.join("mods");
    if !is_mod_incompatibility_crash(&full_lower)
        && (full_lower.contains("[hard_dep")
            || full_lower.contains("requires {")
            || full_lower.contains("fix: add [add:")
            || full_lower.contains("missing dependency")
            || full_lower.contains("depends on")
            || full_lower.contains("which is missing"))
    {
        if let Some((dep_id, mod_name)) = extract_missing_dependency(&full_text) {
            let dep_already_installed =
                find_installed_mod_jar_by_ids(&mods_dir, &[dep_id.clone()]).is_some();
            if !dep_already_installed {
                let msg = format!(
                    "Mód '{}' vyžaduje pro spuštění doplněk '{}'. Můžete jej nainstalovat jedním kliknutím.",
                    mod_name, dep_id
                );
                return json!({
                    "hasCrash": true,
                    "isCleanShutdown": false,
                    "fixed": false,
                    "exitCode": exit_code,
                    "crashType": "MISSING_DEPENDENCY",
                    "title": "Chybějící závislost módu",
                    "message": msg,
                    "description": msg,
                    "recommendation": format!("Automaticky stáhnout a nainstalovat závislost '{}' z Modrinthu.", dep_id),
                    "autoFix": {
                        "id": "INSTALL_DEP",
                        "type": "install_mod",
                        "label": format!("Nainstalovat chybějící mód '{}'", dep_id),
                        "modId": dep_id
                    },
                    "logExcerpt": log_excerpt,
                    "stackExcerpt": log_excerpt,
                    "crashReportPath": report_path_str,
                    "reportPath": report_path_str
                });
            }
        }
    }

    // Helper to find a mod JAR matching an ID or prefix in the mods directory
    let find_mod_file_in_dir = |mods_dir: &Path, mod_id: &str| -> Option<String> {
        let lower_id = mod_id.to_lowercase();
        if is_protected_mod_id(&lower_id) {
            return None;
        }
        if let Ok(entries) = fs::read_dir(mods_dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                let fname_lower = fname.to_lowercase();
                if fname_lower.ends_with(".jar")
                    && (fname_lower.starts_with(&lower_id) || fname_lower.contains(&lower_id))
                {
                    return Some(fname);
                }
            }
        }
        None
    };

    // 4. Missing / Corrupted Client JAR (ClassNotFoundException: net.minecraft.client.main.Main or secondary Fabric GUI Mixin error)
    if full_text.contains("ClassNotFoundException: net.minecraft.client.main.Main")
        || full_text.contains("NoClassDefFoundError: net/minecraft/server/packs/resources/PreparableReloadListener")
        || full_text.contains("ClassNotFoundException: net.minecraft.server.packs.resources.PreparableReloadListener")
    {
        let msg = "Základní herní soubor Minecraftu (client.jar) chybí nebo je poškozený. Kliknutím níže jej můžete automaticky opravit a znovu stáhnout.";
        return json!({
            "hasCrash": true,
            "isCleanShutdown": false,
            "fixed": false,
            "exitCode": exit_code,
            "crashType": "CORRUPT_CLIENT_JAR",
            "title": "Chybějící nebo poškozený herní soubor Minecraftu",
            "message": msg,
            "description": msg,
            "recommendation": "Znovu stáhnout a ověřit čistý Minecraft Client JAR.",
            "autoFix": {
                "id": "REPAIR_CLIENT",
                "type": "repair_client_jar",
                "label": "Znovu stáhnout čistý Minecraft Client JAR"
            },
            "logExcerpt": log_excerpt,
            "stackExcerpt": log_excerpt,
            "crashReportPath": report_path_str,
            "reportPath": report_path_str
        });
    }

    // 5. Sodium vs Iris Version Incompatibility (breaks iris <= 1.11.7)
    if full_lower.contains("is incompatible with")
        && ((full_lower.contains("sodium") && full_lower.contains("iris"))
            || (full_lower.contains("mod 'sodium'") && full_lower.contains("mod 'iris'")))
    {
        let mods_dir = game_dir.join("mods");
        if let Some(iris_file) = find_mod_file_in_dir(&mods_dir, "iris") {
            let msg = "Detekován konflikt verzí mezi Sodium a Iris pro tuto verzi Minecraftu. Doporučujeme Iris dočasně vypnout nebo aktualizovat na kompatibilní verzi.";
            return json!({
                "hasCrash": true,
                "isCleanShutdown": false,
                "fixed": false,
                "exitCode": exit_code,
                "crashType": "INCOMPATIBLE_MODS",
                "title": "Nekompatibilita módů Sodium a Iris",
                "message": msg,
                "description": msg,
                "recommendation": format!("Zakázat nekompatibilní soubor {}.", iris_file),
                "autoFix": {
                    "id": "DISABLE_MOD",
                    "type": "disable_mod",
                    "label": format!("Zakázat kolidující mód {}", iris_file),
                    "filename": iris_file,
                    "modId": "iris"
                },
                "logExcerpt": log_excerpt,
                "stackExcerpt": log_excerpt,
                "crashReportPath": report_path_str,
                "reportPath": report_path_str
            });
        }
    }

    // 6. Deep Mixin Culprit Diagnosis (e.g. brightnessplus failing inside SodiumPreLaunch)
    // Never blame 'sodium' or core mods simply because they provided the preLaunch stage!
    if let Some(culprit_id) = extract_mixin_culprit_mod(&full_text) {
        let mods_dir = game_dir.join("mods");
        if let Some(matching_file) = find_mod_file_in_dir(&mods_dir, &culprit_id) {
            let msg = format!(
                "Mód '{}' ({}) způsobil pád hry při aplikaci Mixin transformace herního kódu.",
                culprit_id, matching_file
            );
            return json!({
                "hasCrash": true,
                "isCleanShutdown": false,
                "fixed": false,
                "exitCode": exit_code,
                "crashType": "INCOMPATIBLE_MODS",
                "title": format!("Chyba módu '{}' (Mixin pád)", culprit_id),
                "message": msg,
                "description": msg,
                "recommendation": format!("Zakázat nekompatibilní mód '{}'.", matching_file),
                "autoFix": {
                    "id": "DISABLE_MOD",
                    "type": "disable_mod",
                    "label": format!("Zakázat nekompatibilní mód '{}'", culprit_id),
                    "filename": matching_file,
                    "modId": culprit_id
                },
                "logExcerpt": log_excerpt,
                "stackExcerpt": log_excerpt,
                "crashReportPath": report_path_str,
                "reportPath": report_path_str
            });
        }
    }

    // 7. Incompatible Mods / Duplicate Mods
    if full_lower.contains("incompatible mods found!")
        || full_lower.contains("duplicate mod")
        || full_lower.contains("duplicate files found for mod")
        || full_lower.contains("mixintransformererror")
        || full_lower.contains("critical injection failure")
        || full_lower.contains("failed to inject into")
    {
        let mods_dir = game_dir.join("mods");
        let conflicting_file = extract_incompatible_mod_filename(&full_text)
            .filter(|fname| mods_dir.join(fname).exists());
        let matched_by_id = if conflicting_file.is_none() {
            let candidates = extract_incompatible_mod_candidates(&full_text);
            find_installed_mod_jar_by_ids(&mods_dir, &candidates)
        } else {
            None
        };

        let (disable_filename, disable_mod_id) = match (conflicting_file, matched_by_id) {
            (Some(fname), _) => (Some(fname), None),
            (None, Some((fname, mod_id))) => (Some(fname), Some(mod_id)),
            _ => (None, None),
        };

        let auto_fix = disable_filename.as_ref().map(|fname| {
            let mut fix = json!({
                "id": "DISABLE_MOD",
                "type": "disable_mod",
                "label": format!("Zakázat nekompatibilní mód {}", fname),
                "filename": fname
            });
            if let Some(ref mid) = disable_mod_id {
                fix["modId"] = json!(mid);
            }
            fix
        });
        let msg = if let Some(ref fname) = disable_filename {
            format!(
                "Mód '{}' je nekompatibilní s touto verzí Minecraftu nebo ostatními módy. SMPClient jej zakáže (.disabled).",
                fname
            )
        } else {
            "Detekován konflikt mezi nainstalovanými módy nebo nekompatibilní verze módu pro vybranou verzi Minecraftu. Zkontrolujte výpis chyby níže.".to_string()
        };
        let rec = if let Some(ref fname) = disable_filename {
            format!("Zakázat nekompatibilní mód '{}'.", fname)
        } else {
            "Zkontrolujte kompatibilitu nainstalovaných módů s touto verzí Minecraftu ve Správci módů.".to_string()
        };

        return json!({
            "hasCrash": true,
            "isCleanShutdown": false,
            "fixed": false,
            "exitCode": exit_code,
            "crashType": "INCOMPATIBLE_MODS",
            "title": "Nekompatibilní mód",
            "message": msg,
            "description": msg,
            "recommendation": rec,
            "autoFix": auto_fix,
            "logExcerpt": log_excerpt,
            "stackExcerpt": log_excerpt,
            "crashReportPath": report_path_str,
            "reportPath": report_path_str
        });
    }

    // 7.5 LWJGL Java vs Native Version Mismatch (check BEFORE OpenGL driver so nvoglv64.dll collateral segfaults report the true cause)
    if full_lower.contains("incompatible java and native library versions detected") {
        let msg = "Byly načteny nekompatibilní verze Java knihoven LWJGL a nativních souborů (.dll/.so), což způsobilo pád Javy (EXCEPTION_ACCESS_VIOLATION).";
        return json!({
            "hasCrash": true,
            "isCleanShutdown": false,
            "fixed": false,
            "exitCode": exit_code,
            "crashType": "LWJGL_NATIVES_MISMATCH",
            "title": "Nekompatibilní nativní knihovny (LWJGL)",
            "message": msg,
            "description": msg,
            "recommendation": "Vyčistit složku nativních knihoven (.mychalsmp/natives) a znovu rozbalit čistou verzi pro tento profil.",
            "autoFix": {
                "id": "REPAIR_NATIVES",
                "type": "repair_natives",
                "label": "Vyčistit a opravit nativní knihovny (LWJGL)"
            },
            "logExcerpt": log_excerpt,
            "stackExcerpt": log_excerpt,
            "crashReportPath": report_path_str,
            "reportPath": report_path_str
        });
    }

    // 7.6 Zink Frame Completion Timeout / Blaze3D Sync Error
    if full_lower.contains("failed to wait for frame completion")
        || (full_lower.contains("glcommandencoder.submit") && full_lower.contains("illegalstateexception"))
    {
        let msg = "Minecraft selhal při čekání na dokončení grafického snímku (Failed to wait for frame completion). Tato chyba vzniká při použití překladové vrstvy Mesa Zink na integrované grafice namísto dedikované grafiky NVIDIA.";
        return json!({
            "hasCrash": true,
            "isCleanShutdown": false,
            "fixed": false,
            "exitCode": exit_code,
            "crashType": "ZINK_FRAME_TIMEOUT",
            "title": "Chyba Zink / Synchronizace snímku (Frame Completion Timeout)",
            "message": msg,
            "description": msg,
            "recommendation": "Vypnout překladovou vrstvu Zink a použít nativní dedikovanou grafiku NVIDIA.",
            "autoFix": {
                "id": "DISABLE_ZINK_USE_NVIDIA",
                "type": "disable_zink",
                "label": "Vypnout Zink a použít dedikovanou grafiku NVIDIA"
            },
            "logExcerpt": log_excerpt,
            "stackExcerpt": log_excerpt,
            "crashReportPath": report_path_str,
            "reportPath": report_path_str
        });
    }

    // 8. OpenGL / Graphics Driver
    if full_lower.contains("glfw error 65542")
        || full_lower.contains("wgl: the driver does not appear to support opengl")
        || full_lower.contains("pixel format not accelerated")
        || full_lower.contains("ig9ic64.dll")
        || full_lower.contains("nvoglv64.dll")
        || full_lower.contains("atio6axx.dll")
    {
        let is_access_violation = full_lower.contains("exception_access_violation");
        let msg = if is_access_violation {
            "Došlo k nativnímu pádu v grafickém ovladači (EXCEPTION_ACCESS_VIOLATION). Zkuste opravit nativní knihovny LWJGL, dočasně vypnout shadery/Iris nebo aktualizovat ovladače GPU."
        } else {
            "Grafická karta nepodporuje požadovanou verzi OpenGL nebo chybí ovladače výrobce grafické karty (NVIDIA, AMD nebo Intel)."
        };
        let auto_fix = if is_access_violation {
            json!({
                "id": "REPAIR_NATIVES",
                "type": "repair_natives",
                "label": "Opravit nativní knihovny (LWJGL)"
            })
        } else {
            Value::Null
        };
        return json!({
            "hasCrash": true,
            "isCleanShutdown": false,
            "fixed": false,
            "exitCode": exit_code,
            "crashType": "OPENGL_DRIVER",
            "title": "Chyba grafického ovladače",
            "message": msg,
            "description": msg,
            "recommendation": if is_access_violation {
                "Aktualizujte ovladače grafické karty nebo opravte nativní knihovny LWJGL."
            } else {
                "Aktualizujte ovladače grafické karty."
            },
            "autoFix": auto_fix,
            "logExcerpt": log_excerpt,
            "stackExcerpt": log_excerpt,
            "crashReportPath": report_path_str,
            "reportPath": report_path_str
        });
    }

    // 9. Linux/POSIX missing executable or shared library (Exit code 127)
    if exit_code == 127 {
        let msg = "Proces skončil s kódem 127 (spustitelný soubor nebo systémová knihovna nebyla nalezena). Často jde o poškozený Java runtime, chybějící oprávnění +x nebo chybějící X11/systémovou knihovnu.";
        return json!({
            "hasCrash": true,
            "isCleanShutdown": false,
            "fixed": false,
            "exitCode": exit_code,
            "crashType": "MISSING_BINARY_OR_LIB",
            "title": "Chybějící binárka nebo knihovna (kód 127)",
            "message": msg,
            "description": msg,
            "recommendation": "Klikni na automatickou opravu pro opětovné stažení a nastavení práv Java runtime.",
            "autoFix": {
                "type": "reinstall_java",
                "label": "Stáhnout a opravit Java runtime"
            },
            "logExcerpt": log_excerpt,
            "stackExcerpt": log_excerpt,
            "crashReportPath": report_path_str,
            "reportPath": report_path_str
        });
    }

    // 10. Generic Game Crash
    let generic_msg = format!("Hra byla neočekávaně ukončena s kódem {}.", exit_code);
    json!({
        "hasCrash": true,
        "isCleanShutdown": false,
        "fixed": false,
        "exitCode": exit_code,
        "crashType": "GAME_CRASH",
        "title": "Kritický pád herního jádra",
        "message": generic_msg,
        "description": generic_msg,
        "recommendation": "Zkontrolujte výpis chyby níže nebo otevřete plný crash report.",
        "autoFix": Value::Null,
        "logExcerpt": log_excerpt,
        "stackExcerpt": log_excerpt,
        "crashReportPath": report_path_str,
        "reportPath": report_path_str
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
        .or_else(|| auto_fix.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match fix_type.to_lowercase().as_str() {
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
        "disable_zink" => {
            let mut cfg = load_config();
            cfg["enableZink"] = json!(false);
            cfg["enableDiscreteGpu"] = json!(true);
            save_config(&cfg);
            json!({
                "success": true,
                "message": "Překladová vrstva Zink byla zakázána a byla vynucena dedikovaná grafika NVIDIA."
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

            let target_filename = if let Some(f) = filename.filter(|f| mods_dir.join(f).exists()) {
                f.to_string()
            } else if let Some(m) = mod_id {
                find_installed_mod_jar_by_ids(&mods_dir, &[m.to_string()])
                    .map(|(fname, _)| fname)
                    .unwrap_or_else(|| filename.unwrap_or("").to_string())
            } else {
                filename.unwrap_or("").to_string()
            };

            if target_filename.is_empty() {
                return json!({ "success": false, "error": "Chybí název souboru k zakázání." });
            }

            let src_file = mods_dir.join(&target_filename);
            if !src_file.exists() {
                return json!({ "success": false, "error": format!("Soubor {} nebyl v profilu nalezen.", target_filename) });
            }

            let dest_file = mods_dir.join(format!("{}.disabled", target_filename.replace(".disabled", "")));
            if dest_file.exists() {
                let _ = fs::remove_file(&dest_file);
            }
            match crate::mods::resilient_rename(&src_file, &dest_file) {
                Ok(_) => json!({
                    "success": true,
                    "message": format!("Nekompatibilní mód '{}' byl v SMPClientu zakázán.", target_filename)
                }),
                Err(e) => json!({
                    "success": false,
                    "error": format!("Nelze zakázat mód: {}", e)
                }),
            }
        }
        "reinstall_java" | "fix_java" => {
            let cfg = load_config();
            let base_dir = crate::config::get_default_game_dir();
            let jre_dir = base_dir.join("runtime").join("java-25");
            if jre_dir.exists() {
                let _ = fs::remove_dir_all(&jre_dir);
            }
            match crate::launcher::download_and_install_java(25, &base_dir, |_, _| {}).await {
                Ok(_) => json!({
                    "success": true,
                    "message": "Java 25 runtime byl úspěšně znovu stažen a opraven."
                }),
                Err(e) => {
                    let _ = cfg;
                    json!({
                        "success": false,
                        "error": format!("Nepodařilo se opravit Java runtime: {}", e)
                    })
                }
            }
        }
        "repair_natives" => {
            let base_dir = crate::config::get_default_game_dir();
            for folder in ["natives", "natives_extract", "${natives_directory}"] {
                let p = base_dir.join(folder);
                if p.exists() {
                    let _ = fs::remove_dir_all(&p);
                }
            }
            json!({
                "success": true,
                "message": "Nativní knihovny LWJGL byly vyčištěny a při dalším spuštění se rozbalí znovu v přesné verzi."
            })
        }
        "repair_client_jar" | "repair_client" => {
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
            let loader_type = profile
                .and_then(|p| p.get("loader").and_then(|v| v.as_str()))
                .unwrap_or("fabric");

            let jar_path = base_dir.join("versions").join(mc_ver).join(format!("{}.jar", mc_ver));
            if jar_path.exists() {
                let _ = fs::remove_file(&jar_path);
            }

            // Remove any stale/corrupted cached Fabric loader profile jars/manifests for this version
            if !loader_type.eq_ignore_ascii_case("vanilla") {
                let versions_dir = base_dir.join("versions");
                if let Ok(entries) = fs::read_dir(&versions_dir) {
                    let suffix = format!("-{}", mc_ver);
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.starts_with("fabric-loader-") && name.ends_with(&suffix) {
                            let stale_jar = entry.path().join(format!("{}.jar", name));
                            if stale_jar.exists() {
                                let _ = fs::remove_file(&stale_jar);
                            }
                            let stale_json = entry.path().join(format!("{}.json", name));
                            if stale_json.exists() {
                                let _ = fs::remove_file(&stale_json);
                            }
                        }
                    }
                }
            }

            match crate::launcher::fetch_or_cache_mojang_manifest(&base_dir, mc_ver).await {
                Ok(vanilla_manifest) => {
                    let effective_manifest = if loader_type.eq_ignore_ascii_case("vanilla") {
                        vanilla_manifest.clone()
                    } else {
                        match crate::launcher::ensure_fabric_profile(&base_dir, mc_ver).await {
                            Ok(fm) => fm,
                            Err(e) => {
                                return json!({
                                    "success": false,
                                    "error": format!("Nepodařilo se obnovit Fabric profil: {}", e)
                                });
                            }
                        }
                    };

                    if let Err(e) = crate::launcher::ensure_vanilla_client_jar(&base_dir, mc_ver, &effective_manifest).await {
                        return json!({
                            "success": false,
                            "error": format!("Chyba při stahování herního souboru: {}", e)
                        });
                    }

                    if let Err(e) = crate::launcher::ensure_libraries(
                        &base_dir,
                        &effective_manifest.libraries,
                        crate::launcher::TargetOs::current(),
                        |_, _| {},
                    )
                    .await
                    {
                        return json!({
                            "success": false,
                            "error": format!("Chyba při ověřování knihoven: {}", e)
                        });
                    }

                    json!({
                        "success": true,
                        "message": format!("Herní soubor a knihovny verze {} byly úspěšně opraveny a ověřeny.", mc_ver)
                    })
                }
                Err(e) => json!({
                    "success": false,
                    "error": format!("Nelze načíst manifest verze: {}", e)
                }),
            }
        }
        "install_mod" | "install_dep" => {
            let mod_id = match auto_fix.get("modId").and_then(|v| v.as_str()) {
                Some(id) => id,
                None => return json!({ "success": false, "error": "Chybí identifikátor módu." }),
            };

            let cfg = load_config();
            let game_dir = resolve_profile_dir(&cfg, profile_id);
            let mods_dir = game_dir.join("mods");
            if let Some((existing_fname, _)) =
                find_installed_mod_jar_by_ids(&mods_dir, &[mod_id.to_string()])
            {
                let src_file = mods_dir.join(&existing_fname);
                let dest_file =
                    mods_dir.join(format!("{}.disabled", existing_fname.replace(".disabled", "")));
                if dest_file.exists() {
                    let _ = fs::remove_file(&dest_file);
                }
                return match crate::mods::resilient_rename(&src_file, &dest_file) {
                    Ok(_) => json!({
                        "success": true,
                        "message": format!("Nekompatibilní mód '{}' už existuje a byl v SMPClientu zakázán.", existing_fname)
                    }),
                    Err(e) => json!({
                        "success": false,
                        "error": format!("Nelze zakázat nekompatibilní mód: {}", e)
                    }),
                };
            }

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
        "open_crash_report" => {
            if let Some(rp) = auto_fix.get("reportPath").and_then(|v| v.as_str()) {
                let _ = open::that_detached(rp);
                json!({ "success": true })
            } else {
                json!({ "success": false, "error": "Cesta k reportu nebyla nalezena." })
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_analyze_crash_prioritizes_lwjgl_natives_mismatch_over_driver_dll() {
        let tmp = std::env::temp_dir().join(format!("mychalsmp_crash_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let logs = "[LWJGL] [ERROR] Incompatible Java and native library versions detected.\nA fatal error: EXCEPTION_ACCESS_VIOLATION (0xc0000005)\n# Problematic frame: C [nvoglv64.dll+0x1234]";
        let res = analyze_crash(&tmp, 1, logs, None);
        assert_eq!(res.get("crashType").and_then(|v| v.as_str()), Some("LWJGL_NATIVES_MISMATCH"));
        assert_eq!(res.pointer("/autoFix/type").and_then(|v| v.as_str()), Some("repair_natives"));

        let gl_logs = "GLFW error 65542: WGL: The driver does not appear to support OpenGL";
        let gl_res = analyze_crash(&tmp, 1, gl_logs, None);
        assert_eq!(gl_res.get("crashType").and_then(|v| v.as_str()), Some("OPENGL_DRIVER"));
        assert!(gl_res.get("autoFix").map_or(false, |v| v.is_null()));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_analyze_crash_detects_missing_client_main_and_webp_reload_listener() {
        let tmp = std::env::temp_dir().join(format!("mychalsmp_crash_client_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let logs = "[17:19:30] [main/ERROR]: Failed to start Minecraft!\n\
                    Caused by: java.lang.ClassNotFoundException: net.minecraft.client.main.Main\n\
                    Caused by: java.lang.RuntimeException: Mixin transformation of com.twelvemonkeys.imageio.plugins.webp.WebPImageReaderSpi failed\n\
                    Caused by: java.lang.NoClassDefFoundError: net/minecraft/server/packs/resources/PreparableReloadListener";
        let res = analyze_crash(&tmp, 1, logs, None);
        assert_eq!(res.get("crashType").and_then(|v| v.as_str()), Some("CORRUPT_CLIENT_JAR"));
        assert_eq!(res.pointer("/autoFix/type").and_then(|v| v.as_str()), Some("repair_client_jar"));

        let webp_only = "Caused by: java.lang.NoClassDefFoundError: net/minecraft/server/packs/resources/PreparableReloadListener";
        let res2 = analyze_crash(&tmp, 1, webp_only, None);
        assert_eq!(res2.get("crashType").and_then(|v| v.as_str()), Some("CORRUPT_CLIENT_JAR"));
        assert_eq!(res2.pointer("/autoFix/type").and_then(|v| v.as_str()), Some("repair_client_jar"));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_analyze_crash_disables_incompatible_mod_instead_of_downloading() {
        let tmp = std::env::temp_dir().join(format!("mychalsmp_crash_incompat_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let mods_dir = tmp.join("mods");
        fs::create_dir_all(&mods_dir).unwrap();

        // Build a zip simulating a mod jar containing clientsidecrystals_bundle metadata
        let jar_path = mods_dir.join("ClientSideCrystals-1.21.jar");
        {
            let file = File::create(&jar_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let opts = zip::write::SimpleFileOptions::default();
            zip.start_file("fabric.mod.json", opts).unwrap();
            zip.write_all(br#"{"id":"clientsidecrystals_bundle","version":"1.0.0"}"#).unwrap();
            zip.finish().unwrap();
        }

        let logs = "[00:50:41] [main/ERROR]: Incompatible mods found!\n\
                    net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!\n\
                    \tat net.fabricmc.loader.impl.FormattedException.ofLocalized(FormattedException.java:51)\n\
                    A potential solution has been determined, this may resolve your problem:\n\
                    \t - Replace mod 'clientsidecrystals' (clientsidecrystals) 1.0.0 with any version that is compatible with:\n\
                    \t\t - minecraft 26.3\n\
                    More details:\n\
                    [HARD_DEP clientsidecrystals_bundle {depends clientsidecrystals}]\n\
                    \t - Mod 'clientsidecrystals_bundle' (clientsidecrystals_bundle) 1.0.0 requires version 1.21.4 of 'minecraft'.";

        let res = analyze_crash(&tmp, 1, logs, None);
        assert_eq!(res.get("crashType").and_then(|v| v.as_str()), Some("INCOMPATIBLE_MODS"));
        assert_eq!(res.pointer("/autoFix/type").and_then(|v| v.as_str()), Some("disable_mod"));
        assert_eq!(
            res.pointer("/autoFix/filename").and_then(|v| v.as_str()),
            Some("ClientSideCrystals-1.21.jar")
        );

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_analyze_crash_still_installs_truly_missing_library_dependency() {
        let tmp = std::env::temp_dir().join(format!("mychalsmp_crash_missing_dep_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let mods_dir = tmp.join("mods");
        fs::create_dir_all(&mods_dir).unwrap();

        let logs = "[00:50:41] [main/ERROR]: Incompatible mods found!\n\
                    net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!\n\
                    A potential solution has been determined, this may resolve your problem:\n\
                    \t - Install fzzy_config, any version.\n\
                    More details:\n\
                    \t - Mod 'Particle Core' (particle_core) 0.3.0 depends on any version of mod 'Fzzy Config' (fzzy_config), which is missing!";

        let res = analyze_crash(&tmp, 1, logs, None);
        assert_eq!(res.get("crashType").and_then(|v| v.as_str()), Some("MISSING_DEPENDENCY"));
        assert_eq!(res.pointer("/autoFix/type").and_then(|v| v.as_str()), Some("install_mod"));
        assert_eq!(res.pointer("/autoFix/modId").and_then(|v| v.as_str()), Some("fzzy_config"));

        let _ = fs::remove_dir_all(&tmp);
    }
}


