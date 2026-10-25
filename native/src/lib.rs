use napi::bindgen_prelude::*;
use napi_derive::napi;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use walkdir::WalkDir;

#[napi]
pub fn is_native_active() -> bool {
    true
}

#[napi]
pub fn fast_hash_file_sha1(file_path: String) -> Result<String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(Error::new(
            Status::GenericFailure,
            format!("Soubor neexistuje: {}", file_path),
        ));
    }

    let mut file = File::open(path).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Nelze otevřít soubor {}: {}", file_path, e),
        )
    })?;

    let mut hasher = Sha1::new();
    let mut buffer = [0u8; 65536]; // 64KB buffer

    loop {
        let bytes_read = file.read(&mut buffer).map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Chyba čtení souboru {}: {}", file_path, e),
            )
        })?;

        if bytes_read == 0 {
            break;
        }

        hasher.update(&buffer[..bytes_read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

#[napi]
pub fn fast_hash_file_sha256(file_path: String) -> Result<String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(Error::new(
            Status::GenericFailure,
            format!("Soubor neexistuje: {}", file_path),
        ));
    }

    let mut file = File::open(path).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Nelze otevřít soubor {}: {}", file_path, e),
        )
    })?;

    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536]; // 64KB buffer

    loop {
        let bytes_read = file.read(&mut buffer).map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Chyba čtení souboru {}: {}", file_path, e),
            )
        })?;

        if bytes_read == 0 {
            break;
        }

        hasher.update(&buffer[..bytes_read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ScannedModInfo {
    pub file_name: String,
    pub relative_path: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub is_prohibited: bool,
    pub detection_reason: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ModScanResult {
    pub total_mods: usize,
    pub clean_mods: usize,
    pub prohibited_mods: usize,
    pub mods: Vec<ScannedModInfo>,
    pub scan_time_ms: f64,
}

// Prohibited keywords compiled directly into the binary
const PROHIBITED_KEYWORDS: &[(&str, &str)] = &[
    ("baritone", "Baritone / Bot Pathing"),
    ("xray", "X-Ray modifikace"),
    ("x-ray", "X-Ray modifikace"),
    ("x_ray", "X-Ray modifikace"),
    ("orefinder", "Ore finder cheat"),
    ("cavefinder", "Cave finder cheat"),
    ("freecam", "Freecam modifikace"),
    ("openfreecam", "Freecam modifikace"),
    ("simplefreecam", "Freecam modifikace"),
    ("seedcracker", "Seed cracker exploit"),
    ("seed-cracker", "Seed cracker exploit"),
    ("autoclicker", "Auto clicker"),
    ("auto-clicker", "Auto clicker"),
    ("worlddownloader", "World downloader"),
    ("autototem", "Auto totem exploit"),
    ("chestesp", "Chest ESP"),
    ("storageesp", "Storage ESP"),
    ("playeresp", "Player ESP"),
    ("chams", "Chams render cheat"),
    ("crystalaura", "Crystal Aura combat cheat"),
    ("crystal-aura", "Crystal Aura combat cheat"),
    ("anchoraura", "Anchor Aura combat cheat"),
    ("bedaura", "Bed Aura combat cheat"),
    ("meteor", "Meteor Hack Client"),
    ("trouserstreak", "TrouserStreak Hack Addon"),
    ("blackout", "Blackout Hack Client"),
    ("wurst", "Wurst Hack Client"),
    ("liquidbounce", "LiquidBounce Hack Client"),
    ("rusherhack", "Rusherhack Client"),
    ("futureclient", "Future Client"),
    ("bleachhack", "BleachHack Client"),
    ("thunderhack", "ThunderHack Client"),
    ("mathax", "Mathax Client"),
    ("vape", "Vape Client"),
    ("riseclient", "Rise Client"),
    ("aristois", "Aristois Hack Client"),
];

#[napi]
pub fn fast_verify_mods_dir(mods_dir: String) -> Result<String> {
    let start = std::time::Instant::now();
    let dir_path = Path::new(&mods_dir);

    if !dir_path.exists() || !dir_path.is_dir() {
        let empty_result = ModScanResult {
            total_mods: 0,
            clean_mods: 0,
            prohibited_mods: 0,
            mods: Vec::new(),
            scan_time_ms: 0.0,
        };
        return serde_json::to_string(&empty_result)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()));
    }

    // Collect all .jar files
    let jar_entries: Vec<walkdir::DirEntry> = WalkDir::new(dir_path)
        .max_depth(3)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file()
                && e.path()
                    .extension()
                    .and_then(|s| s.to_str())
                    .map(|s| s.eq_ignore_ascii_case("jar"))
                    .unwrap_or(false)
        })
        .collect();

    // Parallel processing with Rayon
    let scanned_mods: Vec<ScannedModInfo> = jar_entries
        .par_iter()
        .map(|entry| {
            let path = entry.path();
            let file_name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown.jar")
                .to_string();

            let relative_path = path
                .strip_prefix(dir_path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| file_name.clone());

            let metadata = std::fs::metadata(path).ok();
            let size_bytes = metadata.map(|m| m.len()).unwrap_or(0);

            // Compute SHA-256
            let sha256 = fast_hash_file_sha256(path.to_string_lossy().to_string())
                .unwrap_or_else(|_| "hash_error".to_string());

            // 1. Filename keyword check
            let lower_name = file_name.to_ascii_lowercase();
            let mut is_prohibited = false;
            let mut detection_reason = None;

            for (kw, reason) in PROHIBITED_KEYWORDS {
                if lower_name.contains(kw) {
                    is_prohibited = true;
                    detection_reason = Some(reason.to_string());
                    break;
                }
            }

            // 2. Deep ZIP & bytecode & fabric.mod.json inspection inside the JAR
            if !is_prohibited {
                if let Ok(file) = File::open(path) {
                    if let Ok(mut archive) = zip::ZipArchive::new(file) {
                        for i in 0..archive.len().min(120) {
                            if let Ok(entry) = archive.by_index(i) {
                                let entry_name = entry.name().to_ascii_lowercase();
                                if entry_name.starts_with("baritone/")
                                    || entry_name.starts_with("meteordevelopment/")
                                    || entry_name.starts_with("net/wurstclient/")
                                    || entry_name.starts_with("net/ccbluex/liquidbounce/")
                                    || entry_name.starts_with("org/rusherhack/")
                                    || entry_name.starts_with("com/matthewh/xray/")
                                    || entry_name.starts_with("dev/rise/")
                                    || entry_name.starts_with("com/vape/")
                                    || entry_name.starts_with("bleachhack/")
                                {
                                    is_prohibited = true;
                                    detection_reason = Some("Detekován nepovolený cheat balíček uvnitř JAR souboru".to_string());
                                    break;
                                }
                            }
                        }

                        if !is_prohibited {
                            if let Ok(mut fab) = archive.by_name("fabric.mod.json") {
                                let mut content = String::new();
                                if fab.read_to_string(&mut content).is_ok() {
                                    let lower_fab = content.to_ascii_lowercase();
                                    for (kw, reason) in PROHIBITED_KEYWORDS {
                                        if lower_fab.contains(kw) {
                                            is_prohibited = true;
                                            detection_reason = Some(format!("{} (identifikováno uvnitř fabric.mod.json)", reason));
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            ScannedModInfo {
                file_name,
                relative_path,
                size_bytes,
                sha256,
                is_prohibited,
                detection_reason,
            }
        })
        .collect();

    let total_mods = scanned_mods.len();
    let prohibited_mods = scanned_mods.iter().filter(|m| m.is_prohibited).count();
    let clean_mods = total_mods.saturating_sub(prohibited_mods);
    let scan_time_ms = start.elapsed().as_secs_f64() * 1000.0;

    let result = ModScanResult {
        total_mods,
        clean_mods,
        prohibited_mods,
        mods: scanned_mods,
        scan_time_ms,
    };

    serde_json::to_string(&result).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[derive(Serialize, Deserialize)]
pub struct CrashScanResult {
    pub has_crash: bool,
    pub crash_type: Option<String>,
    pub summary_line: Option<String>,
    pub suspected_cause: Option<String>,
    pub missing_dep_id: Option<String>,
    pub missing_for_mod: Option<String>,
    pub log_excerpt: Option<String>,
}

#[napi]
pub fn fast_scan_log_for_crashes(log_path: String) -> Result<String> {
    let path = Path::new(&log_path);
    if !path.exists() {
        let empty = CrashScanResult {
            has_crash: false,
            crash_type: None,
            summary_line: None,
            suspected_cause: None,
            missing_dep_id: None,
            missing_for_mod: None,
            log_excerpt: None,
        };
        return serde_json::to_string(&empty)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()));
    }

    let file = File::open(path)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Nelze otevřít log: {}", e)))?;

    let reader = BufReader::new(file);

    let mut has_crash = false;
    let mut crash_type = None;
    let mut summary_line = None;
    let mut suspected_cause = None;
    let mut missing_dep_id = None;
    let mut missing_for_mod = None;
    let mut recent_errors: Vec<String> = Vec::new();

    for line in reader.lines().filter_map(|l| l.ok()) {
        let lower = line.to_ascii_lowercase();

        // Check for false positive clean shutdown
        if lower.contains("client shutdown from post-main") || lower.contains("clientshutdownwatchdog") {
            let res = CrashScanResult {
                has_crash: false,
                crash_type: Some("CLEAN_SHUTDOWN".to_string()),
                summary_line: Some(line),
                suspected_cause: Some("Minecraft byl hráčem korektně ukončen.".to_string()),
                missing_dep_id: None,
                missing_for_mod: None,
                log_excerpt: None,
            };
            return serde_json::to_string(&res).map_err(|e| Error::new(Status::GenericFailure, e.to_string()));
        }

        // Store relevant error lines for log excerpt
        if line.contains("ERROR") || line.contains("FATAL") || line.contains("Exception") || line.contains("Error") {
            if recent_errors.len() >= 20 {
                recent_errors.remove(0);
            }
            recent_errors.push(line.clone());
        }

        if crash_type.is_none() {
            if lower.contains("outofmemoryerror") || lower.contains("java heap space") || lower.contains("gc overhead limit") {
                has_crash = true;
                crash_type = Some("OUT_OF_MEMORY".to_string());
                summary_line = Some(line);
                suspected_cause = Some("Nedostatek alokované RAM paměti pro Minecraft".to_string());
            } else if lower.contains("unsupportedclassversionerror") || lower.contains("compiled by a more recent version of the java runtime") {
                has_crash = true;
                crash_type = Some("JAVA_VERSION_MISMATCH".to_string());
                summary_line = Some(line);
                suspected_cause = Some("Nekompatibilní verze Javy. Mód vyžaduje novější verzi Javy.".to_string());
            } else if lower.contains("glfw error 65542") || lower.contains("wgl: the driver does not appear to support opengl") || lower.contains("ig9ic64.dll") || lower.contains("nvoglv64.dll") {
                has_crash = true;
                crash_type = Some("OPENGL_DRIVER".to_string());
                summary_line = Some(line);
                suspected_cause = Some("Chyba grafického ovladače nebo nepodporovaný OpenGL ovladač".to_string());
            } else if lower.contains("[hard_dep") || lower.contains("requires {") {
                has_crash = true;
                crash_type = Some("MISSING_DEPENDENCY".to_string());
                summary_line = Some(line.clone());
                suspected_cause = Some("Chybějící závislost nebo doplněk módu v profilu".to_string());

                // Parse missing dependency
                if let Some(dep_idx) = lower.find("depends ") {
                    let after = &line[dep_idx + 8..];
                    let dep = after.split_whitespace().next().unwrap_or("").trim_matches(|c: char| !c.is_alphanumeric() && c != '_' && c != '-');
                    if !dep.is_empty() {
                        missing_dep_id = Some(dep.to_string());
                    }
                }
            } else if lower.contains("mixintransformererror") || lower.contains("critical injection failure") {
                has_crash = true;
                crash_type = Some("MIXIN_ERROR".to_string());
                summary_line = Some(line);
                suspected_cause = Some("Konflikt mixinů mezi nainstalovanými módy".to_string());
            } else if lower.contains("minecraft has crashed!") || lower.contains("---- minecraft crash report ----") {
                has_crash = true;
                crash_type = Some("GAME_CRASH".to_string());
                summary_line = Some(line);
                suspected_cause = Some("Kritický pád herního jádra Minecraftu".to_string());
            } else if lower.contains("# a fatal error has been detected by the java runtime environment") {
                has_crash = true;
                crash_type = Some("JVM_FATAL_ERROR".to_string());
                summary_line = Some(line);
                suspected_cause = Some("Pád virtuálního stroje Java nebo grafického ovladače".to_string());
            }
        }
    }

    let excerpt = if !recent_errors.is_empty() {
        Some(recent_errors.join("\n"))
    } else {
        None
    };

    let res = CrashScanResult {
        has_crash: has_crash || crash_type.is_some(),
        crash_type,
        summary_line,
        suspected_cause,
        missing_dep_id,
        missing_for_mod,
        log_excerpt: excerpt,
    };

    serde_json::to_string(&res).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[napi]
pub fn fast_build_classpath(base_dir: String, rel_paths: Vec<String>, client_jar: String) -> String {
    let separator = if cfg!(windows) { ";" } else { ":" };
    let mut valid_paths: Vec<String> = rel_paths
        .par_iter()
        .filter_map(|rel| {
            let full = Path::new(&base_dir).join("libraries").join(rel);
            if full.exists() {
                Some(full.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect();

    if Path::new(&client_jar).exists() {
        valid_paths.push(client_jar);
    }

    valid_paths.join(separator)
}

#[derive(Serialize, Deserialize)]
pub struct DownloadResult {
    pub success: bool,
    pub bytes_downloaded: u64,
    pub elapsed_ms: f64,
    pub sha256: String,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct BatchDownloadItem {
    pub url: String,
    pub dest_path: String,
}

#[derive(Serialize, Deserialize)]
pub struct BatchDownloadResultItem {
    pub url: String,
    pub dest_path: String,
    pub success: bool,
    pub bytes_downloaded: u64,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct BatchDownloadResult {
    pub total: usize,
    pub successful: usize,
    pub failed: usize,
    pub total_bytes: u64,
    pub elapsed_ms: f64,
    pub items: Vec<BatchDownloadResultItem>,
}

#[napi]
pub fn fast_download_file(url: String, dest_path: String) -> Result<String> {
    let start = std::time::Instant::now();
    let dest = Path::new(&dest_path);

    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent("mychalVidea/mychalsmp-launcher")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| Error::new(Status::GenericFailure, format!("Nelze vytvořit HTTP klienta: {}", e)))?;

    let mut response = client.get(&url).send().map_err(|e| {
        Error::new(Status::GenericFailure, format!("Chyba požadavku {}: {}", url, e))
    })?;

    if !response.status().is_success() {
        return Err(Error::new(
            Status::GenericFailure,
            format!("HTTP status {}: {}", response.status(), url),
        ));
    }

    let mut file = File::create(dest).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Nelze vytvořit soubor {}: {}", dest_path, e),
        )
    })?;

    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    let mut total_bytes: u64 = 0;

    loop {
        let bytes_read = response.read(&mut buffer).map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Chyba stahování ze streamu: {}", e),
            )
        })?;

        if bytes_read == 0 {
            break;
        }

        hasher.update(&buffer[..bytes_read]);
        std::io::Write::write_all(&mut file, &buffer[..bytes_read]).map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Chyba zápisu na disk: {}", e),
            )
        })?;

        total_bytes += bytes_read as u64;
    }

    let sha256 = format!("{:x}", hasher.finalize());
    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;

    let res = DownloadResult {
        success: true,
        bytes_downloaded: total_bytes,
        elapsed_ms,
        sha256,
        error: None,
    };

    serde_json::to_string(&res).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[napi]
pub fn fast_download_batch(batch_json: String) -> Result<String> {
    let start = std::time::Instant::now();
    let items: Vec<BatchDownloadItem> = serde_json::from_str(&batch_json)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Chybný JSON: {}", e)))?;

    let total = items.len();

    let client = reqwest::blocking::Client::builder()
        .user_agent("mychalVidea/mychalsmp-launcher")
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| Error::new(Status::GenericFailure, format!("Chyba klienta: {}", e)))?;

    // Parallel download using Rayon threadpool
    let results: Vec<BatchDownloadResultItem> = items
        .par_iter()
        .map(|item| {
            let dest = Path::new(&item.dest_path);
            if let Some(parent) = dest.parent() {
                let _ = std::fs::create_dir_all(parent);
            }

            match client.get(&item.url).send() {
                Ok(mut resp) => {
                    if !resp.status().is_success() {
                        return BatchDownloadResultItem {
                            url: item.url.clone(),
                            dest_path: item.dest_path.clone(),
                            success: false,
                            bytes_downloaded: 0,
                            error: Some(format!("HTTP {}", resp.status())),
                        };
                    }

                    match File::create(dest) {
                        Ok(mut file) => {
                            let mut buf = [0u8; 65536];
                            let mut written = 0u64;
                            let mut has_err = None;

                            loop {
                                match resp.read(&mut buf) {
                                    Ok(0) => break,
                                    Ok(n) => {
                                        if let Err(we) =
                                            std::io::Write::write_all(&mut file, &buf[..n])
                                        {
                                            has_err = Some(we.to_string());
                                            break;
                                        }
                                        written += n as u64;
                                    }
                                    Err(re) => {
                                        has_err = Some(re.to_string());
                                        break;
                                    }
                                }
                            }

                            if let Some(err_msg) = has_err {
                                BatchDownloadResultItem {
                                    url: item.url.clone(),
                                    dest_path: item.dest_path.clone(),
                                    success: false,
                                    bytes_downloaded: written,
                                    error: Some(err_msg),
                                }
                            } else {
                                BatchDownloadResultItem {
                                    url: item.url.clone(),
                                    dest_path: item.dest_path.clone(),
                                    success: true,
                                    bytes_downloaded: written,
                                    error: None,
                                }
                            }
                        }
                        Err(fe) => BatchDownloadResultItem {
                            url: item.url.clone(),
                            dest_path: item.dest_path.clone(),
                            success: false,
                            bytes_downloaded: 0,
                            error: Some(fe.to_string()),
                        },
                    }
                }
                Err(req_err) => BatchDownloadResultItem {
                    url: item.url.clone(),
                    dest_path: item.dest_path.clone(),
                    success: false,
                    bytes_downloaded: 0,
                    error: Some(req_err.to_string()),
                },
            }
        })
        .collect();

    let successful = results.iter().filter(|r| r.success).count();
    let failed = total.saturating_sub(successful);
    let total_bytes = results.iter().map(|r| r.bytes_downloaded).sum();
    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;

    let res = BatchDownloadResult {
        total,
        successful,
        failed,
        total_bytes,
        elapsed_ms,
        items: results,
    };

    serde_json::to_string(&res).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[derive(Serialize, Deserialize)]
pub struct PatchResult {
    pub success: bool,
    pub original_bytes: u64,
    pub target_bytes: u64,
    pub patch_bytes: u64,
    pub elapsed_ms: f64,
    pub sha256: String,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ApplyPatchResult {
    pub success: bool,
    pub target_bytes: u64,
    pub elapsed_ms: f64,
    pub sha256: String,
    pub error: Option<String>,
}

#[napi]
pub fn create_binary_patch(
    old_path: String,
    new_path: String,
    patch_output_path: String,
) -> Result<String> {
    let start = std::time::Instant::now();
    let old_bytes = std::fs::read(&old_path).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Nelze přečíst starý soubor {}: {}", old_path, e),
        )
    })?;
    let new_bytes = std::fs::read(&new_path).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Nelze přečíst nový soubor {}: {}", new_path, e),
        )
    })?;

    let patch_dest = Path::new(&patch_output_path);
    if let Some(parent) = patch_dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let mut patch_file = File::create(patch_dest).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Nelze vytvořit patch soubor {}: {}", patch_output_path, e),
        )
    })?;

    qbsdiff::Bsdiff::new(&old_bytes, &new_bytes)
        .compare(&mut patch_file)
        .map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Chyba generování patche: {}", e),
            )
        })?;

    let patch_len = std::fs::metadata(patch_dest)
        .map(|m| m.len())
        .unwrap_or(0);
    let sha256 = fast_hash_file_sha256(patch_output_path).unwrap_or_default();
    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;

    let res = PatchResult {
        success: true,
        original_bytes: old_bytes.len() as u64,
        target_bytes: new_bytes.len() as u64,
        patch_bytes: patch_len,
        elapsed_ms,
        sha256,
        error: None,
    };

    serde_json::to_string(&res).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[napi]
pub fn apply_binary_patch(
    old_path: String,
    patch_path: String,
    target_output_path: String,
) -> Result<String> {
    let start = std::time::Instant::now();
    let old_bytes = std::fs::read(&old_path).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Nelze přečíst zdrojový soubor {}: {}", old_path, e),
        )
    })?;
    let patch_bytes = std::fs::read(&patch_path).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Nelze přečíst patch soubor {}: {}", patch_path, e),
        )
    })?;

    let target_dest = Path::new(&target_output_path);
    if let Some(parent) = target_dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let mut target_file = File::create(target_dest).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Nelze vytvořit cílový soubor {}: {}", target_output_path, e),
        )
    })?;

    let patcher = qbsdiff::Bspatch::new(&patch_bytes).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Neplatný formát patche: {}", e),
        )
    })?;

    patcher
        .apply(&old_bytes, &mut target_file)
        .map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Chyba aplikace patche: {}", e),
            )
        })?;

    let target_len = std::fs::metadata(target_dest)
        .map(|m| m.len())
        .unwrap_or(0);
    let sha256 = fast_hash_file_sha256(target_output_path).unwrap_or_default();
    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;

    let res = ApplyPatchResult {
        success: true,
        target_bytes: target_len,
        elapsed_ms,
        sha256,
        error: None,
    };

    serde_json::to_string(&res).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[cfg(target_os = "linux")]
extern "C" {
    fn malloc_trim(pad: usize) -> i32;
}

#[napi]
pub fn fast_trim_memory(pid: Option<u32>) -> bool {
    let mut success = false;

    #[cfg(target_os = "linux")]
    {
        let _ = pid;
        // On Linux glibc, malloc_trim(0) forces free memory arena pages back to the kernel.
        unsafe {
            if malloc_trim(0) == 1 {
                success = true;
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn GetCurrentProcess() -> isize;
            fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> isize;
            fn CloseHandle(hObject: isize) -> i32;
            fn SetProcessWorkingSetSize(
                hProcess: isize,
                dwMinimumWorkingSetSize: usize,
                dwMaximumWorkingSetSize: usize,
            ) -> i32;
        }

        unsafe {
            let cur = GetCurrentProcess();
            if SetProcessWorkingSetSize(cur, usize::MAX, usize::MAX) != 0 {
                success = true;
            }

            if let Some(target_pid) = pid {
                // PROCESS_SET_QUOTA (0x0100) | PROCESS_QUERY_LIMITED_INFORMATION (0x1000)
                let handle = OpenProcess(0x1100, 0, target_pid);
                if handle != 0 {
                    let _ = SetProcessWorkingSetSize(handle, usize::MAX, usize::MAX);
                    let _ = CloseHandle(handle);
                }
            }
        }
    }

    success
}

#[derive(Serialize, Deserialize)]
pub struct ParsedGameLogLine {
    pub event_type: String, // "none", "connecting", "singleplayer", "menu", "ignored_auxiliary"
    pub host: Option<String>,
    pub port: Option<u16>,
}

#[napi]
pub fn fast_parse_game_log_line(line: String) -> Result<String> {
    let lower = line.to_ascii_lowercase();

    // 1. Auxiliary voice/telemetry log filtering
    if lower.contains("voicechat")
        || lower.contains("plasmovoice")
        || lower.contains("simple voice")
        || lower.contains("audioplayer")
        || lower.contains("essential")
        || lower.contains("telemetry")
        || lower.contains("ice:")
        || lower.contains("stun:")
        || lower.contains("turn:")
    {
        let res = ParsedGameLogLine {
            event_type: "ignored_auxiliary".to_string(),
            host: None,
            port: None,
        };
        return serde_json::to_string(&res).map_err(|e| Error::new(Status::GenericFailure, e.to_string()));
    }

    // 2. Connecting to server
    if let Some(idx) = lower.find("connecting to ") {
        let after = &line[idx + 14..];
        let trimmed_after = after.trim_start_matches(|c: char| c.is_whitespace() || c == '[' || c == ']' || c == '<' || c == '>');
        let rest = trimmed_after.strip_prefix("server ").unwrap_or(trimmed_after);

        let delimiters = [',', ':', ' ', ']', '>'];
        let first_delim = rest.find(|c| delimiters.contains(&c));

        let (host, port) = if let Some(d_idx) = first_delim {
            let h = rest[..d_idx].trim_matches(|c: char| c == '[' || c == ']' || c == '<' || c == '>').to_string();
            let after_delim = rest[d_idx + 1..].trim();
            let mut p: Option<u16> = None;
            if let Some(first_num) = after_delim.split_whitespace().next() {
                let clean_num: String = first_num.chars().filter(|c| c.is_ascii_digit()).collect();
                if let Ok(parsed) = clean_num.parse::<u16>() {
                    p = Some(parsed);
                }
            }
            (h, p)
        } else {
            let raw_host = rest.trim_matches(|c: char| c == '[' || c == ']' || c == '<' || c == '>');
            (raw_host.to_string(), None)
        };

        if !host.is_empty() {
            let res = ParsedGameLogLine {
                event_type: "connecting".to_string(),
                host: Some(host),
                port: port.or(Some(25565)),
            };
            return serde_json::to_string(&res).map_err(|e| Error::new(Status::GenericFailure, e.to_string()));
        }
    }

    // 3. Singleplayer
    if lower.contains("starting integrated minecraft server")
        || lower.contains("[integrated server/info]")
        || lower.contains("preparing start region for dimension")
    {
        let res = ParsedGameLogLine {
            event_type: "singleplayer".to_string(),
            host: None,
            port: None,
        };
        return serde_json::to_string(&res).map_err(|e| Error::new(Status::GenericFailure, e.to_string()));
    }

    // 4. Menu / Disconnected
    if lower.contains("stopping integrated server")
        || lower.contains("lost connection to server")
        || lower.contains("client disconnected with reason")
        || lower.contains("disconnected from server")
    {
        let res = ParsedGameLogLine {
            event_type: "menu".to_string(),
            host: None,
            port: None,
        };
        return serde_json::to_string(&res).map_err(|e| Error::new(Status::GenericFailure, e.to_string()));
    }

    let res = ParsedGameLogLine {
        event_type: "none".to_string(),
        host: None,
        port: None,
    };
    serde_json::to_string(&res).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CleanableCacheItem {
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub mtime_ms: f64,
    pub category: String, // "logs", "crashes", "temps", "old_jars"
}

#[derive(Serialize, Deserialize)]
pub struct CleanableCacheResult {
    pub total_files: usize,
    pub total_bytes: u64,
    pub items: Vec<CleanableCacheItem>,
    pub scan_time_ms: f64,
}

#[napi]
pub fn fast_scan_cleaner_cache(
    directories: Vec<String>,
    max_age_days: Option<u32>,
) -> Result<String> {
    let start = std::time::Instant::now();
    let max_days = max_age_days.unwrap_or(30) as u64;
    let max_age_ms = (max_days * 24 * 60 * 60 * 1000) as f64;
    let now = std::time::SystemTime::now();
    let now_ms = now
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);

    let items: Vec<CleanableCacheItem> = directories
        .par_iter()
        .flat_map(|base_dir| {
            let path = Path::new(base_dir);
            if !path.exists() {
                return Vec::new();
            }

            let mut found = Vec::new();

            for entry in WalkDir::new(path)
                .max_depth(4)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                if !entry.file_type().is_file() {
                    continue;
                }

                let p = entry.path();
                let fname = entry.file_name().to_string_lossy();
                let lower = fname.to_ascii_lowercase();

                let metadata = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                let size = metadata.len();
                let mtime_ms = metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs_f64() * 1000.0)
                    .unwrap_or(0.0);

                let age_ms = now_ms - mtime_ms;

                // 1. Logs
                if (lower.ends_with(".log.gz")
                    || (lower.ends_with(".myco") && fname != "latest.myco")
                    || (lower.ends_with(".log") && fname != "latest.log"))
                    && age_ms > max_age_ms
                {
                    found.push(CleanableCacheItem {
                        path: p.to_string_lossy().to_string(),
                        file_name: fname.to_string(),
                        size_bytes: size,
                        mtime_ms,
                        category: "logs".to_string(),
                    });
                }
                // 2. Crashes
                else if lower.ends_with(".txt")
                    && p.to_string_lossy().contains("crash-reports")
                    && age_ms > max_age_ms
                {
                    found.push(CleanableCacheItem {
                        path: p.to_string_lossy().to_string(),
                        file_name: fname.to_string(),
                        size_bytes: size,
                        mtime_ms,
                        category: "crashes".to_string(),
                    });
                }
                // 3. Temps
                else if lower.ends_with(".tmp") || lower.ends_with(".download") {
                    found.push(CleanableCacheItem {
                        path: p.to_string_lossy().to_string(),
                        file_name: fname.to_string(),
                        size_bytes: size,
                        mtime_ms,
                        category: "temps".to_string(),
                    });
                }
            }

            found
        })
        .collect();

    let total_files = items.len();
    let total_bytes = items.iter().map(|i| i.size_bytes).sum();
    let scan_time_ms = start.elapsed().as_secs_f64() * 1000.0;

    let res = CleanableCacheResult {
        total_files,
        total_bytes,
        items,
        scan_time_ms,
    };

    serde_json::to_string(&res).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[derive(Serialize, Deserialize)]
pub struct ExtractArchiveResult {
    pub success: bool,
    pub extracted_files: usize,
    pub total_bytes: u64,
    pub elapsed_ms: f64,
    pub error: Option<String>,
}

#[napi]
pub fn fast_extract_archive(archive_path: String, dest_dir: String) -> Result<String> {
    let start = std::time::Instant::now();
    let file = File::open(&archive_path).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Nelze otevřít archiv {}: {}", archive_path, e),
        )
    })?;

    let mut zip = zip::ZipArchive::new(file).map_err(|e| {
        Error::new(
            Status::GenericFailure,
            format!("Neplatný zip archiv {}: {}", archive_path, e),
        )
    })?;

    let dest = Path::new(&dest_dir);
    if !dest.exists() {
        std::fs::create_dir_all(dest).map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Nelze vytvořit cílovou složku: {}", e),
            )
        })?;
    }

    let mut extracted_files = 0usize;
    let mut total_bytes = 0u64;

    for i in 0..zip.len() {
        let mut file_entry = zip.by_index(i).map_err(|e| {
            Error::new(
                Status::GenericFailure,
                format!("Chyba při čtení archivu: {}", e),
            )
        })?;

        let raw_enclosed = match file_entry.enclosed_name() {
            Some(path) => path.to_owned(),
            None => continue, // Skip unsafe paths (zip-slip defense)
        };

        let out_path = dest.join(raw_enclosed);

        if file_entry.is_dir() {
            let _ = std::fs::create_dir_all(&out_path);
        } else {
            if let Some(parent) = out_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let mut outfile = File::create(&out_path).map_err(|e| {
                Error::new(
                    Status::GenericFailure,
                    format!("Nelze vytvořit soubor {:?}: {}", out_path, e),
                )
            })?;
            let bytes = std::io::copy(&mut file_entry, &mut outfile).map_err(|e| {
                Error::new(
                    Status::GenericFailure,
                    format!("Chyba zápisu {:?}: {}", out_path, e),
                )
            })?;
            extracted_files += 1;
            total_bytes += bytes;
        }
    }

    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    let res = ExtractArchiveResult {
        success: true,
        extracted_files,
        total_bytes,
        elapsed_ms,
        error: None,
    };
    serde_json::to_string(&res).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[derive(Serialize, Deserialize)]
pub struct VerifyFileHashItem {
    pub path: String,
    pub expected_sha1: String,
    pub expected_size: Option<u64>,
}

#[derive(Serialize, Deserialize)]
pub struct BatchVerifyResult {
    pub total: usize,
    pub valid: usize,
    pub corrupted: usize,
    pub missing: usize,
    pub elapsed_ms: f64,
    pub invalid_files: Vec<String>,
}

#[napi]
pub fn fast_verify_file_hashes_batch(items_json: String) -> Result<String> {
    let start = std::time::Instant::now();
    let items: Vec<VerifyFileHashItem> = serde_json::from_str(&items_json)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Neplatný JSON: {}", e)))?;

    let results: Vec<(bool, bool, String)> = items
        .par_iter()
        .map(|item| {
            let p = Path::new(&item.path);
            if !p.exists() {
                return (false, false, item.path.clone());
            }

            if let Some(expected_size) = item.expected_size {
                if let Ok(m) = p.metadata() {
                    if m.len() != expected_size {
                        return (true, false, item.path.clone());
                    }
                }
            }

            match fast_hash_file_sha1(item.path.clone()) {
                Ok(hash) => {
                    let is_match = hash.eq_ignore_ascii_case(&item.expected_sha1);
                    (true, is_match, item.path.clone())
                }
                Err(_) => (true, false, item.path.clone()),
            }
        })
        .collect();

    let mut valid = 0usize;
    let mut corrupted = 0usize;
    let mut missing = 0usize;
    let mut invalid_files = Vec::new();

    for (exists, is_valid, path) in results {
        if !exists {
            missing += 1;
            invalid_files.push(path);
        } else if !is_valid {
            corrupted += 1;
            invalid_files.push(path);
        } else {
            valid += 1;
        }
    }

    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
    let res = BatchVerifyResult {
        total: items.len(),
        valid,
        corrupted,
        missing,
        elapsed_ms,
        invalid_files,
    };
    serde_json::to_string(&res).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

pub struct ProcessWaitTask {
    pub pid: u32,
    pub timeout_ms: u32,
}

impl Task for ProcessWaitTask {
    type Output = u32;
    type JsValue = u32;

    fn compute(&mut self) -> Result<Self::Output> {
        #[cfg(target_os = "linux")]
        {
            // Try pidfd_open (Linux kernel 5.3+ syscall 434 on x86_64)
            let pidfd = unsafe { libc::syscall(434, self.pid, 0) as i32 };
            if pidfd >= 0 {
                let mut pfd = libc::pollfd {
                    fd: pidfd,
                    events: libc::POLLIN | libc::POLLHUP,
                    revents: 0,
                };
                let timeout = if self.timeout_ms > 0 {
                    self.timeout_ms as i32
                } else {
                    -1
                };
                unsafe {
                    libc::poll(&mut pfd, 1, timeout);
                    libc::close(pidfd);
                }
                return Ok(0);
            }

            // Fallback for older kernels or permission limits: 1s sleep loop
            let start = std::time::Instant::now();
            loop {
                let alive = unsafe { libc::kill(self.pid as i32, 0) == 0 };
                if !alive {
                    break;
                }
                if self.timeout_ms > 0
                    && start.elapsed().as_millis() >= self.timeout_ms as u128
                {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(1000));
            }
            Ok(0)
        }

        #[cfg(target_os = "windows")]
        {
            extern "system" {
                fn OpenProcess(
                    dwDesiredAccess: u32,
                    bInheritHandle: i32,
                    dwProcessId: u32,
                ) -> isize;
                fn CloseHandle(hObject: isize) -> i32;
                fn WaitForSingleObject(hHandle: isize, dwMilliseconds: u32) -> u32;
                fn GetExitCodeProcess(hProcess: isize, lpExitCode: *mut u32) -> i32;
            }
            // SYNCHRONIZE (0x00100000) | PROCESS_QUERY_LIMITED_INFORMATION (0x1000)
            let handle = unsafe { OpenProcess(0x00101000, 0, self.pid) };
            if handle == 0 {
                return Ok(0);
            }
            let timeout = if self.timeout_ms > 0 {
                self.timeout_ms
            } else {
                0xFFFFFFFF
            };
            let _ = unsafe { WaitForSingleObject(handle, timeout) };
            let mut exit_code: u32 = 0;
            unsafe {
                GetExitCodeProcess(handle, &mut exit_code as *mut u32);
                CloseHandle(handle);
            }
            Ok(exit_code)
        }

        #[cfg(not(any(target_os = "linux", target_os = "windows")))]
        {
            Ok(0)
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub fn fast_wait_for_process_exit(
    pid: u32,
    timeout_ms: Option<u32>,
) -> AsyncTask<ProcessWaitTask> {
    AsyncTask::new(ProcessWaitTask {
        pid,
        timeout_ms: timeout_ms.unwrap_or(0),
    })
}

#[derive(Serialize, Deserialize)]
pub struct BatchDeleteResult {
    pub deleted_count: usize,
    pub freed_bytes: u64,
    pub elapsed_ms: f64,
}

#[napi]
pub fn fast_delete_files_batch(file_paths_json: String) -> Result<String> {
    let start = std::time::Instant::now();
    let paths: Vec<String> = serde_json::from_str(&file_paths_json)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Chybný JSON: {}", e)))?;

    let (deleted_count, freed_bytes): (usize, u64) = paths
        .par_iter()
        .map(|path_str| {
            let p = Path::new(path_str);
            if p.exists() {
                let size = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
                if std::fs::remove_file(p).is_ok() {
                    return (1usize, size);
                }
            }
            (0usize, 0u64)
        })
        .reduce(|| (0, 0), |(c1, s1), (c2, s2)| (c1 + c2, s1 + s2));

    let res = BatchDeleteResult {
        deleted_count,
        freed_bytes,
        elapsed_ms: start.elapsed().as_secs_f64() * 1000.0,
    };
    serde_json::to_string(&res).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

#[napi]
pub fn fast_ensure_gui_scale(game_dir: String, scale: u32) -> Result<bool> {
    let p = Path::new(&game_dir).join("options.txt");
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let target_needle = format!("guiScale:{}", scale);
    if p.exists() {
        if let Ok(content) = std::fs::read_to_string(&p) {
            for line in content.lines() {
                if line.trim() == target_needle {
                    return Ok(true); // Již nastaveno
                }
            }
            let mut new_lines = Vec::new();
            let mut replaced = false;
            for line in content.lines() {
                if line.starts_with("guiScale:") {
                    new_lines.push(target_needle.clone());
                    replaced = true;
                } else {
                    new_lines.push(line.to_string());
                }
            }
            if !replaced {
                new_lines.push(target_needle);
            }
            let _ = std::fs::write(&p, new_lines.join("\n") + "\n");
            return Ok(true);
        }
    }
    let _ = std::fs::write(&p, format!("{}\n", target_needle));
    Ok(true)
}

#[derive(Serialize, Deserialize)]
pub struct ServerEntryItem {
    pub name: Option<String>,
    pub ip: Option<String>,
    pub address: Option<String>,
}

#[napi]
pub fn fast_build_servers_dat(servers_json: String, dest_path: String) -> Result<bool> {
    let servers: Vec<ServerEntryItem> = serde_json::from_str(&servers_json)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Chybný JSON: {}", e)))?;

    let mut buf = Vec::new();
    // Root TAG_Compound (id 0x0A, name length 0)
    buf.extend_from_slice(&[0x0a, 0x00, 0x00]);

    // TAG_List "servers"
    let list_name = b"servers";
    buf.push(0x09);
    buf.extend_from_slice(&(list_name.len() as u16).to_be_bytes());
    buf.extend_from_slice(list_name);
    buf.push(0x0a); // TAG_Compound items
    buf.extend_from_slice(&(servers.len() as i32).to_be_bytes());

    for srv in servers {
        let srv_name = srv.name.unwrap_or_else(|| "Minecraft Server".to_string());
        let srv_ip = srv.ip.or(srv.address).unwrap_or_else(|| "mychalsmp.xyz".to_string());

        // TAG_String "name"
        let key_name = b"name";
        buf.push(0x08);
        buf.extend_from_slice(&(key_name.len() as u16).to_be_bytes());
        buf.extend_from_slice(key_name);
        let name_bytes = srv_name.as_bytes();
        buf.extend_from_slice(&(name_bytes.len() as u16).to_be_bytes());
        buf.extend_from_slice(name_bytes);

        // TAG_String "ip"
        let key_ip = b"ip";
        buf.push(0x08);
        buf.extend_from_slice(&(key_ip.len() as u16).to_be_bytes());
        buf.extend_from_slice(key_ip);
        let ip_bytes = srv_ip.as_bytes();
        buf.extend_from_slice(&(ip_bytes.len() as u16).to_be_bytes());
        buf.extend_from_slice(ip_bytes);

        // TAG_Byte "acceptTextures" = 1
        let key_tex = b"acceptTextures";
        buf.push(0x01);
        buf.extend_from_slice(&(key_tex.len() as u16).to_be_bytes());
        buf.extend_from_slice(key_tex);
        buf.push(0x01);

        // TAG_End of compound
        buf.push(0x00);
    }
    // TAG_End of root
    buf.push(0x00);

    let dest = Path::new(&dest_path);
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(dest, buf)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Nelze zapsat servers.dat: {}", e)))?;
    Ok(true)
}

#[derive(Serialize, Deserialize)]
pub struct FabricModMeta {
    pub id: Option<String>,
    pub name: Option<String>,
    pub version: Option<String>,
}

#[napi]
pub fn fast_read_fabric_mod_meta(jar_path: String) -> Result<String> {
    let file = File::open(&jar_path).map_err(|e| {
        Error::new(Status::GenericFailure, format!("Nelze otevřít jar {}: {}", jar_path, e))
    })?;

    let mut zip = zip::ZipArchive::new(file).map_err(|e| {
        Error::new(Status::GenericFailure, format!("Neplatný zip {}: {}", jar_path, e))
    })?;

    let mut meta = FabricModMeta {
        id: None,
        name: None,
        version: None,
    };

    if let Ok(mut entry) = zip.by_name("fabric.mod.json") {
        let mut content = String::new();
        if entry.read_to_string(&mut content).is_ok() {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                meta.id = val.get("id").and_then(|v| v.as_str()).map(|s| s.to_string());
                meta.name = val.get("name").and_then(|v| v.as_str()).map(|s| s.to_string());
                meta.version = val.get("version").and_then(|v| v.as_str()).map(|s| s.to_string());
            }
        }
    }

    serde_json::to_string(&meta).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

