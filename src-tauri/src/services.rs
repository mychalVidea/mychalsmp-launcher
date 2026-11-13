use crate::config::{
    get_default_game_dir, load_config, resolve_profile_dir, save_config, APP_VERSION,
};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
#[allow(unused_imports)]
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

    // 3. Temps and caches in base_dir (natives jsou vynechány, aby se nesmazaly systémové knihovny Minecraftu liblwjgl.so apod.)
    let temp_dirs = [
        base_dir.join("temp"),
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

    let electron_res = cleanup_obsolete_electron_files();
    deleted_files += electron_res.get("deletedFiles").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    freed_bytes += electron_res.get("freedBytes").and_then(|v| v.as_u64()).unwrap_or(0);

    let formatted = format_bytes(freed_bytes);
    let msg = format!("Vyčištěno {} souborů (uvolněno {})", deleted_files, formatted);
    json!({
        "success": true,
        "deletedFiles": deleted_files,
        "freedBytes": freed_bytes,
        "formattedFreed": formatted,
        "message": msg
    })
}

fn dir_size_and_file_count(path: &Path) -> (u64, u64) {
    let mut files = 0u64;
    let mut bytes = 0u64;
    for entry in WalkDir::new(path).into_iter().flatten() {
        if entry.file_type().is_file() {
            files += 1;
            bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    (files, bytes)
}

/// Removes obsolete Electron/Chromium runtime files and directories left inside a Tauri install dir.
pub fn cleanup_obsolete_electron_in_dir(install_dir: &Path) -> (u64, u64) {
    if !install_dir.is_dir() {
        return (0, 0);
    }

    // Safety guard: only clean inside directories containing our launcher binary
    let has_launcher_bin = ["mychalsmp-launcher", "mychalsmp-launcher.exe", "SMPClient", "SMPClient.exe"]
        .iter()
        .any(|name| install_dir.join(name).exists());
    if !has_launcher_bin {
        return (0, 0);
    }

    let obsolete_files = [
        "icudtl.dat",
        "LICENSES.chromium.html",
        "LICENSE.electron.txt",
        "libGLESv2.so",
        "libEGL.so",
        "libffmpeg.so",
        "libvulkan.so.1",
        "libvk_swiftshader.so",
        "vk_swiftshader_icd.json",
        "resources.pak",
        "chrome_100_percent.pak",
        "chrome_200_percent.pak",
        "v8_context_snapshot.bin",
        "snapshot_blob.bin",
        "chrome_crashpad_handler",
        "chrome-sandbox",
        "chrome-sandbox.disabled",
        "ffmpeg.dll",
        "d3dcompiler_47.dll",
        "libEGL.dll",
        "libGLESv2.dll",
        "vk_swiftshader.dll",
        "vulkan-1.dll",
        "Squirrel.exe",
    ];

    let obsolete_dirs = ["locales", "mychalsmp-launcher-1.0.0"];

    let mut deleted_files = 0u64;
    let mut freed_bytes = 0u64;

    for name in &obsolete_files {
        let p = install_dir.join(name);
        if p.is_file() {
            let sz = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            if fs::remove_file(&p).is_ok() {
                deleted_files += 1;
                freed_bytes += sz;
            }
        }
    }

    for dir_name in &obsolete_dirs {
        let d = install_dir.join(dir_name);
        if d.is_dir() {
            let (cnt, sz) = dir_size_and_file_count(&d);
            if fs::remove_dir_all(&d).is_ok() {
                deleted_files += cnt;
                freed_bytes += sz;
            }
        }
    }

    // Electron stored app.asar + app-update.yml + unpacked `app/` inside `resources/`,
    // whereas Tauri keeps only lightweight icon assets (`logo.png`, `server-icon.png`) there.
    let res_dir = install_dir.join("resources");
    if res_dir.is_dir() {
        for name in ["app.asar", "app.asar.bak", "app-update.yml", "elevate.exe"] {
            let p = res_dir.join(name);
            if p.is_file() {
                let sz = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                if fs::remove_file(&p).is_ok() {
                    deleted_files += 1;
                    freed_bytes += sz;
                }
            }
        }
        for sub in ["app", "assets"] {
            let d = res_dir.join(sub);
            if d.is_dir() {
                let (cnt, sz) = dir_size_and_file_count(&d);
                if fs::remove_dir_all(&d).is_ok() {
                    deleted_files += cnt;
                    freed_bytes += sz;
                }
            }
        }
    }

    // Remove leftover staging/backup files and versioned update directories from previous updates
    if let Ok(entries) = fs::read_dir(install_dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            let p = entry.path();
            if p.is_dir()
                && (fname.starts_with("mychalsmp-launcher-") || fname.starts_with("SMPClient-"))
            {
                let (cnt, sz) = dir_size_and_file_count(&p);
                if fs::remove_dir_all(&p).is_ok() {
                    deleted_files += cnt;
                    freed_bytes += sz;
                }
            } else if p.is_file()
                && (fname.ends_with(".update_new")
                    || fname.ends_with(".bak")
                    || fname.ends_with(".old")
                    || fname == "mychalsmp-launcher (deleted)")
            {
                let sz = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                if fs::remove_file(&p).is_ok() {
                    deleted_files += 1;
                    freed_bytes += sz;
                }
            }
        }
    }

    (deleted_files, freed_bytes)
}

/// Removes Chromium/Electron cache directories from legacy Electron userData directories.
pub fn cleanup_obsolete_electron_appdata(appdata_electron_dir: &Path) -> (u64, u64) {
    if !appdata_electron_dir.is_dir() {
        return (0, 0);
    }
    let cache_subdirs = [
        "Cache",
        "Code Cache",
        "GPUCache",
        "DawnCache",
        "DawnGraphiteCache",
        "DawnWebGPUCache",
        "Service Worker",
        "Session Storage",
        "Local Storage",
        "IndexedDB",
        "blob_storage",
        "Crashpad",
        "logs",
    ];
    let mut deleted_files = 0u64;
    let mut freed_bytes = 0u64;
    for sub in &cache_subdirs {
        let p = appdata_electron_dir.join(sub);
        if p.is_dir() {
            let (cnt, sz) = dir_size_and_file_count(&p);
            if fs::remove_dir_all(&p).is_ok() {
                deleted_files += cnt;
                freed_bytes += sz;
            }
        }
    }
    (deleted_files, freed_bytes)
}

/// Cleans obsolete Electron binaries, libraries, locales, and updater caches on Linux and Windows.
pub fn cleanup_obsolete_electron_files() -> Value {
    let mut candidate_dirs: HashSet<PathBuf> = HashSet::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            if !parent.to_string_lossy().contains("/tmp/.mount_") {
                candidate_dirs.insert(parent.to_path_buf());
            }
        }
    }

    let mut total_deleted = 0u64;
    let mut total_freed = 0u64;

    #[cfg(target_os = "linux")]
    if let Some(home) = dirs::home_dir() {
        candidate_dirs.insert(home.join(".local/share/mychalsmp-launcher"));
        let (cnt, sz) = cleanup_obsolete_electron_appdata(&home.join(".config/mychalsmp-launcher"));
        total_deleted += cnt;
        total_freed += sz;
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
            let local_pb = PathBuf::from(&local_appdata);
            candidate_dirs.insert(local_pb.join("Programs").join("mychalsmp-launcher"));
            candidate_dirs.insert(local_pb.join("Programs").join("SMPClient"));
            let updater_dir = local_pb.join("mychalsmp-launcher-updater");
            if updater_dir.is_dir() {
                let (cnt, sz) = dir_size_and_file_count(&updater_dir);
                if fs::remove_dir_all(&updater_dir).is_ok() {
                    total_deleted += cnt;
                    total_freed += sz;
                }
            }
        }
        if let Ok(appdata) = std::env::var("APPDATA") {
            let (cnt, sz) = cleanup_obsolete_electron_appdata(&PathBuf::from(appdata).join("mychalsmp-launcher"));
            total_deleted += cnt;
            total_freed += sz;
        }
    }

    for dir in candidate_dirs {
        let (cnt, sz) = cleanup_obsolete_electron_in_dir(&dir);
        total_deleted += cnt;
        total_freed += sz;
    }

    // Remove leftover updater staging artifacts from previous interrupted updates in ~/.mychalsmp/temp
    let temp_dir = get_default_game_dir().join("temp");
    let stale_extract = temp_dir.join("update_extracted");
    if stale_extract.is_dir() {
        let (cnt, sz) = dir_size_and_file_count(&stale_extract);
        if fs::remove_dir_all(&stale_extract).is_ok() {
            total_deleted += cnt;
            total_freed += sz;
        }
    }
    let stale_tar = temp_dir.join("mychalsmp-launcher-update.tar.gz");
    if stale_tar.is_file() {
        let sz = fs::metadata(&stale_tar).map(|m| m.len()).unwrap_or(0);
        if fs::remove_file(&stale_tar).is_ok() {
            total_deleted += 1;
            total_freed += sz;
        }
    }

    json!({
        "success": true,
        "deletedFiles": total_deleted,
        "freedBytes": total_freed,
        "formattedFreed": format_bytes(total_freed)
    })
}

#[cfg(target_os = "linux")]
const SMPCLIENT_ICON_512: &[u8] = include_bytes!("../icons/icon.png");
#[cfg(target_os = "linux")]
const SMPCLIENT_ICON_256: &[u8] = include_bytes!("../icons/128x128@2x.png");
#[cfg(target_os = "linux")]
const SMPCLIENT_ICON_128: &[u8] = include_bytes!("../icons/128x128.png");
#[cfg(target_os = "linux")]
const SMPCLIENT_ICON_64: &[u8] = include_bytes!("../icons/64x64.png");
#[cfg(target_os = "linux")]
const SMPCLIENT_ICON_32: &[u8] = include_bytes!("../icons/32x32.png");

/// Syncs official SMPClient PNG icons into ~/.local/share/icons/hicolor and rewrites
/// ~/.local/share/applications/mychalsmp-launcher.desktop so taskbars never show legacy logos.
#[cfg(target_os = "linux")]
pub fn sync_linux_desktop_icons_and_entry_at(
    home_dir: &std::path::Path,
    preferred_exec: Option<&std::path::Path>,
) -> bool {
    use std::os::unix::fs::PermissionsExt;

    let mut changed = false;
    let hicolor_dir = home_dir.join(".local/share/icons/hicolor");
    let icon_stems = ["mychalsmp-launcher", "SMPClient", "xyz.mychalsmp.launcher"];

    // Remove stale icon files in alternate sizes/paths that could hold legacy branding.
    let stale_sizes = [
        "16x16", "22x22", "24x24", "36x36", "48x48", "72x72", "96x96", "192x192", "scalable",
    ];
    for size in stale_sizes {
        let apps_dir = hicolor_dir.join(size).join("apps");
        for stem in icon_stems {
            for ext in ["png", "svg", "xpm"] {
                let candidate = apps_dir.join(format!("{}.{}", stem, ext));
                if candidate.exists() && fs::remove_file(&candidate).is_ok() {
                    changed = true;
                }
            }
        }
    }
    let legacy_icons_dir = home_dir.join(".icons");
    for stem in icon_stems {
        for ext in ["png", "svg", "xpm"] {
            let candidate = legacy_icons_dir.join(format!("{}.{}", stem, ext));
            if candidate.exists() && fs::remove_file(&candidate).is_ok() {
                changed = true;
            }
        }
    }

    let icon_sizes: [(&str, &[u8]); 5] = [
        ("512x512", SMPCLIENT_ICON_512),
        ("256x256", SMPCLIENT_ICON_256),
        ("128x128", SMPCLIENT_ICON_128),
        ("64x64", SMPCLIENT_ICON_64),
        ("32x32", SMPCLIENT_ICON_32),
    ];
    for (size, bytes) in icon_sizes {
        let apps_dir = hicolor_dir.join(size).join("apps");
        if fs::create_dir_all(&apps_dir).is_ok() {
            for stem in icon_stems {
                let dest = apps_dir.join(format!("{}.png", stem));
                let up_to_date = fs::read(&dest).ok().as_deref() == Some(bytes);
                if !up_to_date && fs::write(&dest, bytes).is_ok() {
                    changed = true;
                }
            }
        }
    }

    let install_dir = home_dir.join(".local/share/mychalsmp-launcher");
    if install_dir.is_dir() {
        let res_logo = install_dir.join("resources/logo.png");
        if let Some(parent) = res_logo.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let up_to_date = fs::read(&res_logo).ok().as_deref() == Some(SMPCLIENT_ICON_512);
        if !up_to_date && fs::write(&res_logo, SMPCLIENT_ICON_512).is_ok() {
            changed = true;
        }
    }

    let apps_dir = home_dir.join(".local/share/applications");
    let _ = fs::create_dir_all(&apps_dir);
    for obsolete in ["appimagekit-mychalsmp-launcher.desktop", "SMPClient.desktop"] {
        let obs_path = apps_dir.join(obsolete);
        if obs_path.exists() && fs::remove_file(&obs_path).is_ok() {
            changed = true;
        }
    }

    let wrapper_path = home_dir.join(".local/bin/mychalsmp-launcher");
    let bin_path = install_dir.join("mychalsmp-launcher");
    let exec_target = preferred_exec
        .map(|p| p.to_path_buf())
        .or_else(|| {
            if wrapper_path.exists() {
                Some(wrapper_path)
            } else if bin_path.is_file() {
                Some(bin_path)
            } else {
                None
            }
        })
        .unwrap_or_else(|| home_dir.join(".local/bin/mychalsmp-launcher"));

    let primary_icon = hicolor_dir.join("512x512/apps/mychalsmp-launcher.png");
    let desktop_path = apps_dir.join("mychalsmp-launcher.desktop");
    let desktop_content = format!(
        "[Desktop Entry]\nName=SMPClient\nComment=Oficiální Minecraft klient sítě MYCHAL SMP\nExec=\"{}\" %U\nIcon={}\nTerminal=false\nType=Application\nCategories=Game;ActionGame;AdventureGame;\nStartupWMClass=xyz.mychalsmp.launcher\n",
        exec_target.to_string_lossy(),
        primary_icon.to_string_lossy()
    );
    let desktop_up_to_date =
        fs::read_to_string(&desktop_path).ok().as_deref() == Some(desktop_content.as_str());
    if !desktop_up_to_date && fs::write(&desktop_path, &desktop_content).is_ok() {
        let _ = fs::set_permissions(&desktop_path, fs::Permissions::from_mode(0o755));
        changed = true;
    }

    changed
}

#[cfg(target_os = "linux")]
pub fn sync_linux_desktop_icons_and_entry(preferred_exec: Option<&std::path::Path>) {
    let Some(home) = dirs::home_dir() else {
        return;
    };
    if sync_linux_desktop_icons_and_entry_at(&home, preferred_exec) {
        let _ = fs::remove_file(home.join(".cache/icon-cache.kcache"));
        let hicolor = home.join(".local/share/icons/hicolor");
        let apps = home.join(".local/share/applications");
        let _ = std::process::Command::new("gtk-update-icon-cache")
            .args(["-q", "-f", "-t"])
            .arg(&hicolor)
            .status();
        let _ = std::process::Command::new("update-desktop-database")
            .arg(&apps)
            .status();
        let _ = std::process::Command::new("kbuildsycoca6")
            .arg("--noincremental")
            .status();
        let _ = std::process::Command::new("kbuildsycoca5")
            .arg("--noincremental")
            .status();
    }
}

/// Ensures ~/.local/bin/mychalsmp-launcher does not force legacy WEBKIT_DISABLE_DMABUF_RENDERER=1
/// and keeps desktop launcher icons synced to the SMPClient brand icon.
pub fn repair_linux_launcher_wrapper() {
    #[cfg(target_os = "linux")]
    if let Some(home) = dirs::home_dir() {
        use std::os::unix::fs::PermissionsExt;
        let wrapper_path = home.join(".local/bin/mychalsmp-launcher");
        let bin_path = home.join(".local/share/mychalsmp-launcher/mychalsmp-launcher");
        if wrapper_path.is_file() && bin_path.is_file() {
            if let Ok(content) = fs::read_to_string(&wrapper_path) {
                if content.contains("WEBKIT_DISABLE_DMABUF_RENDERER") {
                    let clean_content = format!(
                        "#!/usr/bin/env bash\nexec \"{}\" \"$@\"\n",
                        bin_path.to_string_lossy()
                    );
                    if fs::write(&wrapper_path, clean_content).is_ok() {
                        let _ = fs::set_permissions(&wrapper_path, fs::Permissions::from_mode(0o755));
                    }
                }
            }
        }
        let preferred = if wrapper_path.exists() {
            Some(wrapper_path.as_path())
        } else if bin_path.is_file() {
            Some(bin_path.as_path())
        } else {
            None
        };
        sync_linux_desktop_icons_and_entry(preferred);
    }
}

#[cfg(all(test, target_os = "linux"))]
mod linux_desktop_icon_tests {
    use super::sync_linux_desktop_icons_and_entry_at;
    use std::fs;

    #[test]
    fn syncs_smpclient_icons_purges_stale_and_writes_desktop() {
        let tmp_home = std::env::temp_dir().join(format!(
            "smpclient_icon_test_{}_{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        let stale_48 = tmp_home.join(".local/share/icons/hicolor/48x48/apps/mychalsmp-launcher.png");
        fs::create_dir_all(stale_48.parent().unwrap()).unwrap();
        fs::write(&stale_48, b"legacy-mychalsmp-icon").unwrap();

        let install_res = tmp_home.join(".local/share/mychalsmp-launcher/resources");
        fs::create_dir_all(&install_res).unwrap();
        fs::write(install_res.join("logo.png"), b"old-logo").unwrap();

        let wrapper = tmp_home.join(".local/bin/mychalsmp-launcher");
        fs::create_dir_all(wrapper.parent().unwrap()).unwrap();
        fs::write(&wrapper, b"#!/bin/sh\n").unwrap();

        let changed_first = sync_linux_desktop_icons_and_entry_at(&tmp_home, Some(&wrapper));
        assert!(changed_first);
        assert!(!stale_48.exists(), "stale 48x48 icon should be purged");

        let icon_512 = tmp_home.join(".local/share/icons/hicolor/512x512/apps/mychalsmp-launcher.png");
        assert!(icon_512.is_file());
        assert_eq!(fs::read(&icon_512).unwrap(), include_bytes!("../icons/icon.png"));
        assert_eq!(
            fs::read(tmp_home.join(".local/share/icons/hicolor/64x64/apps/SMPClient.png")).unwrap(),
            include_bytes!("../icons/64x64.png")
        );
        assert_eq!(
            fs::read(install_res.join("logo.png")).unwrap(),
            include_bytes!("../icons/icon.png")
        );

        let desktop = fs::read_to_string(
            tmp_home.join(".local/share/applications/mychalsmp-launcher.desktop"),
        )
        .unwrap();
        assert!(desktop.contains("Name=SMPClient"));
        assert!(desktop.contains(&format!("Icon={}", icon_512.to_string_lossy())));

        // Second invocation is idempotent and reports no changes.
        let changed_second = sync_linux_desktop_icons_and_entry_at(&tmp_home, Some(&wrapper));
        assert!(!changed_second);

        let _ = fs::remove_dir_all(&tmp_home);
    }
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

use once_cell::sync::Lazy;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;

pub static DISCORD_TX: Lazy<mpsc::UnboundedSender<Option<Value>>> = Lazy::new(|| {
    let (tx, rx) = mpsc::unbounded_channel();
    tauri::async_runtime::spawn(discord_rpc_worker(rx));
    tx
});

static LAUNCHER_RPC_START_TS: Lazy<Mutex<i64>> = Lazy::new(|| Mutex::new(chrono::Utc::now().timestamp()));

/// Returns whether Discord Rich Presence is enabled in configuration.
pub fn is_discord_rpc_enabled(cfg: &Value) -> bool {
    cfg.get("enableDiscordRpc")
        .or_else(|| cfg.get("discordRpc"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

/// Formats a clean human-readable Minecraft version + loader label for RPC.
pub fn format_version_label(mc_version: &str, loader_type: &str) -> String {
    let ver = mc_version.trim();
    if ver.is_empty() {
        return "Minecraft".to_string();
    }
    let ldr = loader_type.trim();
    if ldr.is_empty() || ldr.eq_ignore_ascii_case("vanilla") {
        return format!("Verze {}", ver);
    }
    let mut chars = ldr.chars();
    let loader_pretty = match chars.next() {
        Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str().to_lowercase()),
        None => String::new(),
    };
    format!("Verze {} ({})", ver, loader_pretty)
}

/// Builds the idle RPC state line from the currently selected profile version.
pub fn resolve_launcher_idle_state(cfg: &Value) -> String {
    let active_id = cfg
        .get("activeProfileId")
        .or_else(|| cfg.get("selectedProfile"))
        .and_then(|v| v.as_str());

    if let Some(profiles) = cfg.get("profiles").and_then(|v| v.as_array()) {
        let profile = active_id
            .and_then(|id| {
                profiles
                    .iter()
                    .find(|p| p.get("id").and_then(|v| v.as_str()) == Some(id))
            })
            .or_else(|| profiles.first());

        if let Some(p) = profile {
            let ver = p.get("version").and_then(|v| v.as_str()).unwrap_or("");
            let loader = p.get("loader").and_then(|v| v.as_str()).unwrap_or("");
            if !ver.trim().is_empty() {
                return format!("Připraven • {}", format_version_label(ver, loader));
            }
        }
    }
    "Připraven ke hře".to_string()
}

/// Sets or clears launcher-idle Discord Rich Presence based on active config.
pub fn set_launcher_discord_activity(cfg_opt: Option<&Value>, reset_timer: bool) {
    let loaded;
    let cfg = match cfg_opt {
        Some(c) => c,
        None => {
            loaded = crate::config::load_config();
            &loaded
        }
    };

    if !is_discord_rpc_enabled(cfg) {
        clear_discord_activity();
        return;
    }

    let start_ts = {
        let mut guard = LAUNCHER_RPC_START_TS.lock().unwrap();
        if reset_timer {
            *guard = chrono::Utc::now().timestamp();
        }
        *guard
    };

    let state = resolve_launcher_idle_state(cfg);
    set_discord_activity("V launcheru", &state, Some(start_ts));
}

pub fn set_discord_activity(details: &str, state: &str, start_time: Option<i64>) {
    let cfg = crate::config::load_config();
    if !is_discord_rpc_enabled(&cfg) {
        clear_discord_activity();
        return;
    }

    let mut act = json!({
        "details": details,
        "state": state,
        "assets": {
            "large_image": "logo",
            "large_text": "SMPClient • mychalsmp.xyz"
        }
    });
    if let Some(ts) = start_time {
        act["timestamps"] = json!({ "start": ts * 1000 });
    }
    let _ = DISCORD_TX.send(Some(act));
}

pub fn clear_discord_activity() {
    let _ = DISCORD_TX.send(None);
}

fn encode_ipc_packet(opcode: u32, payload: &Value) -> Vec<u8> {
    let json_bytes = serde_json::to_vec(payload).unwrap_or_default();
    let mut packet = Vec::with_capacity(8 + json_bytes.len());
    packet.extend_from_slice(&opcode.to_le_bytes());
    packet.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
    packet.extend_from_slice(&json_bytes);
    packet
}

fn build_set_activity_packet(activity: Option<&Value>) -> Vec<u8> {
    let mut args = json!({ "pid": std::process::id() });
    if let Some(act) = activity {
        args["activity"] = act.clone();
    } else {
        args["activity"] = Value::Null;
    }
    let frame = json!({
        "cmd": "SET_ACTIVITY",
        "args": args,
        "nonce": uuid::Uuid::new_v4().to_string()
    });
    encode_ipc_packet(1, &frame)
}

async fn run_discord_ipc_stream<S: AsyncRead + AsyncWrite + Unpin>(
    stream: &mut S,
    rx: &mut mpsc::UnboundedReceiver<Option<Value>>,
    current_activity: &mut Option<Value>,
) -> bool {
    let handshake = json!({ "v": 1, "client_id": DISCORD_CLIENT_ID });
    let h_pkt = encode_ipc_packet(0, &handshake);
    if stream.write_all(&h_pkt).await.is_err() {
        return true;
    }

    let mut hdr = [0u8; 8];
    if stream.read_exact(&mut hdr).await.is_err() {
        return true;
    }
    let len = u32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]) as usize;
    let mut body = vec![0u8; len.min(65536)];
    let _ = stream.read_exact(&mut body).await;

    let initial_pkt = build_set_activity_packet(current_activity.as_ref());
    if stream.write_all(&initial_pkt).await.is_err() {
        return true;
    }

    let mut read_buf = [0u8; 1024];
    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Some(new_act) => {
                        *current_activity = new_act.clone();
                        let pkt = build_set_activity_packet(current_activity.as_ref());
                        if stream.write_all(&pkt).await.is_err() {
                            return true;
                        }
                        if new_act.is_none() {
                            return true;
                        }
                    }
                    None => return false,
                }
            }
            read_res = stream.read(&mut read_buf) => {
                match read_res {
                    Ok(0) | Err(_) => return true,
                    Ok(_) => {}
                }
            }
        }
    }
}

#[cfg(unix)]
fn get_unix_discord_socket() -> Option<PathBuf> {
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR").ok().map(PathBuf::from);
    let tmp_dir = PathBuf::from("/tmp");

    for i in 0..10 {
        let name = format!("discord-ipc-{}", i);
        let candidates = [
            runtime_dir.as_ref().map(|d| d.join(&name)),
            runtime_dir.as_ref().map(|d| d.join(format!("app/com.discordapp.Discord/{}", name))),
            Some(tmp_dir.join(&name)),
        ];

        for c in candidates.into_iter().flatten() {
            if c.exists() {
                return Some(c);
            }
        }
    }
    None
}

async fn discord_rpc_worker(mut rx: mpsc::UnboundedReceiver<Option<Value>>) {
    let mut current_activity: Option<Value> = None;

    loop {
        // 1. Zjistit, zda je povolen Discord RPC v konfiguraci
        let cfg = crate::config::load_config();
        if !is_discord_rpc_enabled(&cfg) {
            tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
            while let Ok(msg) = rx.try_recv() {
                current_activity = msg;
            }
            continue;
        }

        if current_activity.is_none() {
            let start_ts = *LAUNCHER_RPC_START_TS.lock().unwrap();
            current_activity = Some(json!({
                "details": "V launcheru",
                "state": resolve_launcher_idle_state(&cfg),
                "timestamps": { "start": start_ts * 1000 },
                "assets": {
                    "large_image": "logo",
                    "large_text": "SMPClient • mychalsmp.xyz"
                }
            }));
        }

        // 2. Připojení na Linuxu (Unix domain socket)
        #[cfg(unix)]
        if let Some(sock_path) = get_unix_discord_socket() {
            if let Ok(mut stream) = tokio::net::UnixStream::connect(&sock_path).await {
                if !run_discord_ipc_stream(&mut stream, &mut rx, &mut current_activity).await {
                    return;
                }
            }
        }

        // 3. Připojení na Windows (Named Pipe)
        #[cfg(windows)]
        {
            for i in 0..10 {
                let pipe_name = format!(r"\\.\pipe\discord-ipc-{}", i);
                if let Ok(mut pipe) = tokio::net::windows::named_pipe::ClientOptions::new().open(&pipe_name) {
                    if !run_discord_ipc_stream(&mut pipe, &mut rx, &mut current_activity).await {
                        return;
                    }
                    break;
                }
            }
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
        while let Ok(msg) = rx.try_recv() {
            current_activity = msg;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Update Checker & Updater
// ─────────────────────────────────────────────────────────────────────────────

fn select_release_asset(assets: &[Value], is_linux: bool, is_windows: bool) -> (Option<String>, Option<u64>) {
    let mut download_url = None;
    let mut download_size = None;

    if is_linux {
        // Prioritize .tar.gz for seamless in-place Linux self-update
        for a in assets {
            let name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if name == "mychalsmp-launcher.tar.gz" || name.ends_with(".tar.gz") {
                download_url = a.get("browser_download_url").and_then(|v| v.as_str()).map(String::from);
                download_size = a.get("size").and_then(|v| v.as_u64());
                break;
            }
        }
        if download_url.is_none() {
            for a in assets {
                let name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
                if name.ends_with(".AppImage") || name.ends_with(".deb") || name.ends_with(".rpm") {
                    download_url = a.get("browser_download_url").and_then(|v| v.as_str()).map(String::from);
                    download_size = a.get("size").and_then(|v| v.as_u64());
                    break;
                }
            }
        }
    } else if is_windows {
        for a in assets {
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

    (download_url, download_size)
}

fn parse_release_update_payload(release: &Value, current_version: &str, is_linux: bool, is_windows: bool) -> Value {
    let latest_tag = release
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim_start_matches('v')
        .trim();

    let has_update = is_newer_version(latest_tag, current_version);

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

    let (download_url, download_size) = select_release_asset(&assets, is_linux, is_windows);

    let release_notes = release
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("Pravidelná aktualizace a vylepšení herního launcheru.")
        .to_string();

    json!({
        "hasUpdate": has_update,
        "updateAvailable": has_update,
        "currentVersion": current_version,
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

pub async fn check_for_updates() -> Value {
    let repo = "mychalVidea/mychalsmp-launcher";
    let url = format!("https://api.github.com/repos/{}/releases/latest", repo);

    let client = reqwest::Client::builder()
        .user_agent("mychalsmp-launcher-updater")
        .connect_timeout(std::time::Duration::from_secs(4))
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .unwrap_or_default();

    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            return json!({
                "hasUpdate": false,
                "updateAvailable": false,
                "currentVersion": APP_VERSION,
                "offline": e.is_connect() || e.is_timeout(),
                "error": e.to_string()
            })
        }
    };

    if !resp.status().is_success() {
        return json!({
            "hasUpdate": false,
            "updateAvailable": false,
            "currentVersion": APP_VERSION,
            "httpStatus": resp.status().as_u16(),
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

    parse_release_update_payload(&release, APP_VERSION, cfg!(target_os = "linux"), cfg!(target_os = "windows"))
}

pub async fn apply_update(app: Option<&AppHandle>, asset_url: &str) -> Value {
    if asset_url.trim().is_empty() {
        return json!({ "success": false, "applied": false, "error": "Chybí URL adresa aktualizace." });
    }

    let client = reqwest::Client::builder()
        .user_agent("mychalsmp-launcher-updater")
        .connect_timeout(std::time::Duration::from_secs(8))
        .read_timeout(std::time::Duration::from_secs(25))
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

    let expected_bytes = resp.content_length();
    let total_bytes = expected_bytes.unwrap_or(1).max(1);
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
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                if file.write_all(&chunk).is_err() {
                    drop(file);
                    let _ = fs::remove_file(&temp_path);
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
            Ok(None) => break,
            Err(e) => {
                drop(file);
                let _ = fs::remove_file(&temp_path);
                return json!({
                    "success": false,
                    "applied": false,
                    "error": format!("Stahování aktualizace bylo přerušeno: {}", e)
                });
            }
        }
    }
    let _ = file.flush();
    drop(file);

    if let Some(expected) = expected_bytes {
        if expected > 0 && downloaded < expected {
            let _ = fs::remove_file(&temp_path);
            return json!({
                "success": false,
                "applied": false,
                "error": "Stažený soubor aktualizace je neúplný."
            });
        }
    }

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

        // Capture current_exe before replacing local_install_dir so Linux doesn't report "(deleted)" first
        let current_exe_before = std::env::current_exe().ok();

        // 1. Update ~/.local/share/mychalsmp-launcher/{mychalsmp-launcher, SMPClient}
        let local_main_target = local_install_dir.join("mychalsmp-launcher");
        let local_alias_target = local_install_dir.join("SMPClient");
        let local_main_res = replace_binary_atomically(&local_main_target);
        let _ = replace_binary_atomically(&local_alias_target);

        // Copy assets & resources if present in archive
        for folder_name in ["assets", "resources"] {
            let src_folder = unpacked_root.join(folder_name);
            if src_folder.is_dir() {
                let dst_folder = local_install_dir.join(folder_name);
                let _ = copy_dir_recursive(&src_folder, &dst_folder);
            }
        }

        // 2. Also atomically replace current_exe() if distinct and writable (e.g. custom folder)
        let mut current_exe_res: Result<(), String> = Err("skipped".to_string());
        if let Some(exe_path) = current_exe_before {
            let exe_str = exe_path.to_string_lossy();
            if !exe_str.contains("/tmp/.mount_")
                && exe_path != local_main_target
                && exe_path != local_alias_target
            {
                current_exe_res = replace_binary_atomically(&exe_path);
            }
        }

        if local_main_res.is_err() && current_exe_res.is_err() {
            let _ = fs::remove_file(&temp_path);
            let _ = fs::remove_dir_all(&extract_dir);
            return json!({
                "success": false,
                "applied": false,
                "error": format!(
                    "Nepodařilo se zapsat novou verzi launcheru: {}",
                    local_main_res.err().unwrap_or_else(|| "neznámá chyba zápisu".to_string())
                )
            });
        }

        // Ensure ~/.local/bin/mychalsmp-launcher wrapper and .desktop entry are clean
        let local_bin_dir = home_dir.join(".local/bin");
        let _ = fs::create_dir_all(&local_bin_dir);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let wrapper_path = local_bin_dir.join("mychalsmp-launcher");
            let _ = fs::remove_file(&wrapper_path);
            let wrapper_content = format!(
                "#!/usr/bin/env bash\nexec \"{}\" \"$@\"\n",
                local_install_dir.join("mychalsmp-launcher").to_string_lossy()
            );
            if fs::write(&wrapper_path, wrapper_content).is_ok() {
                let _ = fs::set_permissions(&wrapper_path, fs::Permissions::from_mode(0o755));
            }

            sync_linux_desktop_icons_and_entry(Some(&wrapper_path));
        }

        let _ = fs::remove_file(&temp_path);
        let _ = fs::remove_dir_all(&extract_dir);
    }

    let _ = cleanup_obsolete_electron_files();

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

#[cfg(target_os = "linux")]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_launcher_cache_returns_message() {
        let res = clean_launcher_cache();
        assert!(res.get("success").and_then(|v| v.as_bool()).unwrap_or(false));
        let msg = res.get("message").and_then(|v| v.as_str());
        assert!(msg.is_some(), "clean_launcher_cache must return message field");
        assert!(!msg.unwrap().is_empty());
        assert!(res.get("formattedFreed").is_some());
    }

    #[test]
    fn test_cleanup_obsolete_electron_in_dir_preserves_tauri_files() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("mychalsmp_electron_clean_{}", nanos));
        fs::create_dir_all(dir.join("locales")).unwrap();
        fs::create_dir_all(dir.join("mychalsmp-launcher-1.0.0/resources")).unwrap();
        fs::create_dir_all(dir.join("resources/assets")).unwrap();
        fs::create_dir_all(dir.join("assets/indexes")).unwrap();
        fs::create_dir_all(dir.join("mods")).unwrap();

        // Active Tauri files (must remain)
        fs::write(dir.join("mychalsmp-launcher"), b"tauri-bin").unwrap();
        fs::write(dir.join("SMPClient"), b"tauri-bin").unwrap();
        fs::write(dir.join("resources/logo.png"), b"png").unwrap();
        fs::write(dir.join("assets/indexes/26.3.json"), b"{}").unwrap();
        fs::write(dir.join("mods/selfnametag-1.0.0.jar"), b"jar").unwrap();

        // Obsolete Electron files (must be deleted)
        fs::write(dir.join("icudtl.dat"), vec![1u8; 64]).unwrap();
        fs::write(dir.join("libGLESv2.so"), vec![2u8; 64]).unwrap();
        fs::write(dir.join("chrome_crashpad_handler"), vec![3u8; 32]).unwrap();
        fs::write(dir.join("resources/app.asar"), vec![4u8; 128]).unwrap();
        fs::write(dir.join("resources/app.asar.bak"), vec![5u8; 128]).unwrap();
        fs::write(dir.join("resources/app-update.yml"), b"old").unwrap();
        fs::write(dir.join("resources/assets/old.txt"), b"old").unwrap();
        fs::write(dir.join("locales/en-US.pak"), vec![6u8; 48]).unwrap();
        fs::write(dir.join("mychalsmp-launcher-1.0.0/resources/app.asar"), vec![7u8; 96]).unwrap();
        fs::write(dir.join("mychalsmp-launcher (deleted)"), vec![8u8; 64]).unwrap();
        fs::write(dir.join("mychalsmp-launcher.update_new"), vec![9u8; 32]).unwrap();

        let (deleted_files, freed_bytes) = cleanup_obsolete_electron_in_dir(&dir);
        assert!(deleted_files >= 11, "expected obsolete Electron and update files to be removed");
        assert!(freed_bytes >= 640);

        assert!(dir.join("mychalsmp-launcher").exists());
        assert!(dir.join("SMPClient").exists());
        assert!(dir.join("resources/logo.png").exists());
        assert!(dir.join("assets/indexes/26.3.json").exists());
        assert!(dir.join("mods/selfnametag-1.0.0.jar").exists());

        assert!(!dir.join("icudtl.dat").exists());
        assert!(!dir.join("libGLESv2.so").exists());
        assert!(!dir.join("locales").exists());
        assert!(!dir.join("mychalsmp-launcher-1.0.0").exists());
        assert!(!dir.join("mychalsmp-launcher (deleted)").exists());
        assert!(!dir.join("mychalsmp-launcher.update_new").exists());
        assert!(!dir.join("resources/app.asar").exists());
        assert!(!dir.join("resources/app-update.yml").exists());
        assert!(!dir.join("resources/assets").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_is_newer_version_cases() {
        assert!(is_newer_version("1.7.14", "1.7.13"));
        assert!(is_newer_version("v1.8.0", "1.7.99"));
        assert!(is_newer_version("2.0.0", "1.99.99"));
        assert!(!is_newer_version("1.7.13", "1.7.13"));
        assert!(!is_newer_version("1.7.12", "1.7.13"));
        assert!(!is_newer_version("", "1.7.13"));
    }

    #[test]
    fn test_parse_release_update_payload_prefers_platform_asset() {
        let release = json!({
            "tag_name": "v1.7.14",
            "name": "SMPClient 1.7.14",
            "body": "Discord splash auto-update",
            "html_url": "https://github.com/mychalVidea/mychalsmp-launcher/releases/tag/v1.7.14",
            "published_at": "2026-11-13T00:00:00Z",
            "assets": [
                {
                    "name": "mychalsmp-launcher-setup.exe.blockmap",
                    "browser_download_url": "https://example.com/setup.exe.blockmap",
                    "size": 100
                },
                {
                    "name": "mychalsmp-launcher-setup.exe",
                    "browser_download_url": "https://example.com/setup.exe",
                    "size": 25000000
                },
                {
                    "name": "mychalsmp-launcher.tar.gz",
                    "browser_download_url": "https://example.com/linux.tar.gz",
                    "size": 15000000
                }
            ]
        });

        let linux_res = parse_release_update_payload(&release, "1.7.13", true, false);
        assert_eq!(linux_res.get("hasUpdate").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(linux_res.get("latestVersion").and_then(|v| v.as_str()), Some("1.7.14"));
        assert_eq!(
            linux_res.get("downloadUrl").and_then(|v| v.as_str()),
            Some("https://example.com/linux.tar.gz")
        );

        let win_res = parse_release_update_payload(&release, "1.7.13", false, true);
        assert_eq!(win_res.get("hasUpdate").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(
            win_res.get("downloadUrl").and_then(|v| v.as_str()),
            Some("https://example.com/setup.exe")
        );
    }

    #[test]
    fn test_parse_release_update_payload_handles_up_to_date() {
        let release = json!({
            "tag_name": "v1.7.13",
            "assets": []
        });
        let res = parse_release_update_payload(&release, "1.7.13", true, false);
        assert_eq!(res.get("hasUpdate").and_then(|v| v.as_bool()), Some(false));
        assert!(res.get("downloadUrl").map(|v| v.is_null()).unwrap_or(true));
    }

    #[test]
    fn test_format_version_label_and_idle_state() {
        assert_eq!(format_version_label("26.3", "fabric"), "Verze 26.3 (Fabric)");
        assert_eq!(format_version_label("26.3", "vanilla"), "Verze 26.3");
        assert_eq!(format_version_label("1.21.11", ""), "Verze 1.21.11");

        let cfg = json!({
            "activeProfileId": "vanilla-26-3",
            "profiles": [
                { "id": "mychalsmp-fabric", "version": "26.3", "loader": "fabric" },
                { "id": "vanilla-26-3", "version": "26.3", "loader": "vanilla" }
            ]
        });
        assert_eq!(resolve_launcher_idle_state(&cfg), "Připraven • Verze 26.3");
        assert!(!is_discord_rpc_enabled(&json!({ "enableDiscordRpc": false })));
        assert!(is_discord_rpc_enabled(&json!({ "discordRpc": true })));
    }
}

