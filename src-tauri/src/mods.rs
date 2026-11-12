use crate::config::{load_config, resolve_profile_dir};
use futures_util::StreamExt;
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use zip::ZipArchive;

pub struct OptimizationModDef {
    pub id: &'static str,
    pub slug: &'static str,
    pub name: &'static str,
    pub file_prefix: &'static str,
}

pub const OPTIMIZATION_PACK_MODS: &[OptimizationModDef] = &[
    OptimizationModDef { id: "fabric-api", slug: "fabric-api", name: "Fabric API", file_prefix: "fabric-api" },
    OptimizationModDef { id: "sodium", slug: "sodium", name: "Sodium", file_prefix: "sodium" },
    OptimizationModDef { id: "lithium", slug: "lithium", name: "Lithium", file_prefix: "lithium" },
    OptimizationModDef { id: "iris", slug: "iris", name: "Iris Shaders", file_prefix: "iris" },
    OptimizationModDef { id: "ferritecore", slug: "ferrite-core", name: "FerriteCore", file_prefix: "ferritecore" },
    OptimizationModDef { id: "entityculling", slug: "entityculling", name: "EntityCulling", file_prefix: "entityculling" },
    OptimizationModDef { id: "immediatelyfast", slug: "immediatelyfast", name: "ImmediatelyFast", file_prefix: "immediatelyfast" },
    OptimizationModDef { id: "modmenu", slug: "modmenu", name: "Mod Menu", file_prefix: "modmenu" },
    OptimizationModDef { id: "voicechat", slug: "simple-voice-chat", name: "Simple Voice Chat", file_prefix: "voicechat" },
];

pub fn get_version_candidates(mc_version: &str) -> Vec<String> {
    let mut list = vec![mc_version.to_string()];
    match mc_version {
        "26.3" => {
            list.push("26.2".to_string());
            list.push("26.1.2".to_string());
            list.push("26.1.1".to_string());
            list.push("26.1".to_string());
        }
        "26.2" => {
            list.push("26.1.2".to_string());
            list.push("26.1.1".to_string());
            list.push("26.1".to_string());
        }
        "26.1.2" | "26.1.1" | "26.1" => {
            list.push("26.1.2".to_string());
            list.push("26.1.1".to_string());
            list.push("26.1".to_string());
        }
        _ => {}
    }
    let mut dedup = Vec::new();
    for v in list {
        if !dedup.contains(&v) {
            dedup.push(v);
        }
    }
    dedup
}

fn modrinth_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("MychalSMP-Launcher/1.4.6 (https://join.mychalsmp.xyz)")
        .build()
        .unwrap_or_default()
}

pub fn compute_sha1_file(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha1::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Some(hex::encode(hasher.finalize()))
}

pub async fn search_modrinth_api(
    query: &str,
    version: &str,
    loader: &str,
    category: &str,
    project_type: &str,
    offset: u32,
    limit: u32,
) -> Result<Value, String> {
    let client = modrinth_client();
    let ptype = if project_type.trim().is_empty() {
        "mod"
    } else {
        project_type.trim()
    };

    let build_facets = |ver_opt: Option<&str>| -> String {
        let mut facets: Vec<Vec<String>> = Vec::new();
        facets.push(vec![format!("project_type:{}", ptype)]);
        if ptype == "mod" && !loader.is_empty() && loader != "all" && loader != "vanilla" {
            facets.push(vec![format!("categories:{}", loader)]);
        }
        if !category.is_empty() && category != "all" {
            facets.push(vec![format!("categories:{}", category)]);
        }
        if let Some(v) = ver_opt {
            if !v.is_empty() && v != "all" {
                let cands = get_version_candidates(v);
                let ver_group: Vec<String> = cands.into_iter().map(|c| format!("versions:{}", c)).collect();
                facets.push(ver_group);
            }
        }
        serde_json::to_string(&facets).unwrap_or_else(|_| "[]".to_string())
    };

    let facets_str = build_facets(if version.is_empty() { None } else { Some(version) });
    let url = format!(
        "https://api.modrinth.com/v2/search?query={}&facets={}&offset={}&limit={}&index=relevance",
        urlencoding::encode(query),
        urlencoding::encode(&facets_str),
        offset,
        limit.clamp(1, 50)
    );

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let mut data: Value = resp.json().await.map_err(|e| e.to_string())?;

    // If 0 hits with version filter on 26.x, fallback without version filter so players always find mods/packs
    let hits_len = data
        .get("hits")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    if hits_len == 0 && !version.is_empty() {
        let fallback_facets = build_facets(None);
        let fallback_url = format!(
            "https://api.modrinth.com/v2/search?query={}&facets={}&offset={}&limit={}&index=relevance",
            urlencoding::encode(query),
            urlencoding::encode(&fallback_facets),
            offset,
            limit.clamp(1, 50)
        );
        if let Ok(r2) = client.get(&fallback_url).send().await {
            if let Ok(d2) = r2.json::<Value>().await {
                data = d2;
            }
        }
    }

    Ok(data)
}

fn read_registry_file(profile_dir: &Path) -> Value {
    let reg_path = profile_dir.join("mods").join(".modrinth-registry.json");
    if let Ok(raw) = fs::read_to_string(&reg_path) {
        if let Ok(val) = serde_json::from_str::<Value>(&raw) {
            if val.is_object() {
                return val;
            }
        }
    }
    json!({})
}

fn write_registry_file(profile_dir: &Path, registry: &Value) {
    let mods_dir = profile_dir.join("mods");
    let _ = fs::create_dir_all(&mods_dir);
    let reg_path = mods_dir.join(".modrinth-registry.json");
    if let Ok(s) = serde_json::to_string_pretty(registry) {
        let _ = fs::write(reg_path, s);
    }
}

pub async fn find_best_modrinth_version(
    project_id_or_slug: &str,
    mc_version: &str,
    loader: &str,
    project_type: &str,
) -> Result<Value, String> {
    let client = modrinth_client();
    let url = format!(
        "https://api.modrinth.com/v2/project/{}/version",
        urlencoding::encode(project_id_or_slug)
    );
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!(
            "Modrinth nevrátil verze pro {} (HTTP {})",
            project_id_or_slug,
            resp.status()
        ));
    }
    let versions: Vec<Value> = resp.json().await.map_err(|e| e.to_string())?;
    if versions.is_empty() {
        return Err("Projekt nemá žádné publikované verze.".to_string());
    }

    let candidates = get_version_candidates(mc_version);
    let need_loader = project_type == "mod" && !loader.is_empty() && loader != "vanilla";

    let matches_loader = |v: &Value| -> bool {
        if !need_loader {
            return true;
        }
        v.get("loaders")
            .and_then(|l| l.as_array())
            .map(|arr| {
                arr.iter().any(|x| {
                    let s = x.as_str().unwrap_or("");
                    s.eq_ignore_ascii_case(loader) || (loader == "fabric" && s == "quilt")
                })
            })
            .unwrap_or(true)
    };

    for cand in &candidates {
        if let Some(found) = versions.iter().find(|v| {
            matches_loader(v)
                && v.get("game_versions")
                    .and_then(|gv| gv.as_array())
                    .map(|arr| arr.iter().any(|x| x.as_str() == Some(cand.as_str())))
                    .unwrap_or(false)
        }) {
            return Ok(found.clone());
        }
    }

    if project_type != "mod" {
        if let Some(found) = versions.iter().find(|v| matches_loader(v)) {
            return Ok(found.clone());
        }
    }

    Err(format!(
        "Mód '{}' zatím nemá vydanou kompatibilní verzi pro Minecraft {}.",
        project_id_or_slug, mc_version
    ))
}

pub async fn download_file_with_progress(
    url: &str,
    dest: &Path,
    expected_sha1: Option<&str>,
) -> Result<(), String> {
    if let Some(sha) = expected_sha1 {
        if dest.exists() {
            if let Some(actual) = compute_sha1_file(dest) {
                if actual.eq_ignore_ascii_case(sha) {
                    return Ok(());
                }
            }
        }
    }

    if let Some(parent) = dest.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let client = modrinth_client();
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} při stahování {}", resp.status(), url));
    }

    let tmp_path = dest.with_extension("download.tmp");
    let mut file = File::create(&tmp_path).map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);

    fs::rename(&tmp_path, dest).map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn download_mod_or_pack_with_deps(
    app: &AppHandle,
    mod_options: &Value,
) -> Result<Value, String> {
    let project_id = mod_options
        .get("projectId")
        .or_else(|| mod_options.get("id"))
        .or_else(|| mod_options.get("slug"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Chybí ID projektu.".to_string())?;
    let title = mod_options
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or(project_id);
    let project_type = mod_options
        .get("projectType")
        .and_then(|v| v.as_str())
        .unwrap_or("mod");
    let profile_id = mod_options.get("profileId").and_then(|v| v.as_str());

    let cfg = load_config();
    let prof_dir = resolve_profile_dir(&cfg, profile_id);
    let mut mc_version = mod_options
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mut loader = mod_options
        .get("loader")
        .and_then(|v| v.as_str())
        .unwrap_or("fabric")
        .to_string();

    if mc_version.is_empty() {
        if let Some(profiles) = cfg.get("profiles").and_then(|v| v.as_array()) {
            let pid = profile_id
                .or_else(|| cfg.get("activeProfileId").and_then(|v| v.as_str()))
                .or_else(|| cfg.get("selectedProfile").and_then(|v| v.as_str()))
                .unwrap_or("mychalsmp-fabric");
            if let Some(p) = profiles.iter().find(|x| x.get("id").and_then(|v| v.as_str()) == Some(pid)) {
                mc_version = p.get("version").and_then(|v| v.as_str()).unwrap_or("26.3").to_string();
                loader = p.get("loader").and_then(|v| v.as_str()).unwrap_or("fabric").to_string();
            }
        }
        if mc_version.is_empty() {
            mc_version = "26.3".to_string();
        }
    }

    let target_subdir = match project_type {
        "resourcepack" => "resourcepacks",
        "shader" => "shaderpacks",
        _ => "mods",
    };
    let target_dir = prof_dir.join(target_subdir);
    let _ = fs::create_dir_all(&target_dir);

    let direct_url_opt = mod_options
        .get("directUrl")
        .or_else(|| mod_options.get("downloadUrl"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    let direct_filename_opt = mod_options
        .get("filename")
        .or_else(|| mod_options.get("newFilename"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());

    let (download_url, filename, sha1_opt, ver_info) =
        if let (Some(d_url), Some(d_fname)) = (direct_url_opt, direct_filename_opt) {
            (
                d_url.to_string(),
                d_fname.to_string(),
                None,
                json!({
                    "id": mod_options.get("versionId").cloned().unwrap_or(Value::Null),
                    "version_number": mod_options.get("versionNumber").or_else(|| mod_options.get("newVersion")).cloned().unwrap_or(json!(""))
                }),
            )
        } else {
            let _ = app.emit(
                "mod-download-progress",
                json!({
                    "id": project_id,
                    "projectId": project_id,
                    "title": title,
                    "percent": 15,
                    "status": format!("Hledám kompatibilní verzi pro {}...", mc_version)
                }),
            );

            let v_info =
                find_best_modrinth_version(project_id, &mc_version, &loader, project_type).await?;
            let files = v_info
                .get("files")
                .and_then(|v| v.as_array())
                .ok_or_else(|| "Verze neobsahuje žádné soubory ke stažení.".to_string())?;
            let primary_file = files
                .iter()
                .find(|f| f.get("primary").and_then(|v| v.as_bool()) == Some(true))
                .or_else(|| files.first())
                .ok_or_else(|| "Nenalezen primární soubor.".to_string())?;

            let dl_url = primary_file
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Chybí URL ke stažení.".to_string())?
                .to_string();
            let fname = primary_file
                .get("filename")
                .and_then(|v| v.as_str())
                .unwrap_or("mod.jar")
                .to_string();
            let sha = primary_file
                .pointer("/hashes/sha1")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            (dl_url, fname, sha, v_info)
        };

    let _ = app.emit(
        "mod-download-progress",
        json!({
            "id": project_id,
            "projectId": project_id,
            "title": title,
            "percent": 50,
            "status": format!("Stahuji {}...", filename)
        }),
    );

    let dest_path = target_dir.join(&filename);
    download_file_with_progress(&download_url, &dest_path, sha1_opt.as_deref()).await?;

    // If updating/replacing an older version of the same project, remove old jar
    if project_type == "mod" {
        let mut reg = read_registry_file(&prof_dir);
        if let Some(old_file) = mod_options.get("oldFilename").and_then(|v| v.as_str()) {
            if old_file != filename {
                let _ = fs::remove_file(target_dir.join(old_file));
                if let Some(obj) = reg.as_object_mut() {
                    obj.remove(old_file);
                }
            }
        }
        reg[&filename] = json!({
            "projectId": project_id,
            "versionId": ver_info.get("id").cloned().unwrap_or(Value::Null),
            "versionNumber": ver_info.get("version_number").cloned().unwrap_or(Value::Null),
            "name": title,
            "author": mod_options.get("author").cloned().unwrap_or(json!("Modrinth")),
            "iconUrl": mod_options.get("iconUrl").cloned().unwrap_or(Value::Null),
            "installedAt": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
        });
        write_registry_file(&prof_dir, &reg);
        let _ = resolve_profile_mod_collisions(profile_id);

        // Resolve required dependencies (1 level deep)
        if let Some(deps) = ver_info.get("dependencies").and_then(|v| v.as_array()) {
            for dep in deps {
                if dep.get("dependency_type").and_then(|v| v.as_str()) == Some("required") {
                    if let Some(dep_proj_id) = dep.get("project_id").and_then(|v| v.as_str()) {
                        let already_installed = reg
                            .as_object()
                            .map(|m| {
                                m.values().any(|entry| {
                                    entry.get("projectId").and_then(|v| v.as_str()) == Some(dep_proj_id)
                                })
                            })
                            .unwrap_or(false);
                        if !already_installed {
                            if let Ok(dep_ver) =
                                find_best_modrinth_version(dep_proj_id, &mc_version, &loader, "mod").await
                            {
                                if let Some(dep_file) = dep_ver
                                    .get("files")
                                    .and_then(|v| v.as_array())
                                    .and_then(|arr| arr.first())
                                {
                                    if let (Some(u), Some(fnm)) = (
                                        dep_file.get("url").and_then(|v| v.as_str()),
                                        dep_file.get("filename").and_then(|v| v.as_str()),
                                    ) {
                                        let dep_dest = target_dir.join(fnm);
                                        if !dep_dest.exists() {
                                            let _ = download_file_with_progress(u, &dep_dest, None).await;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let _ = app.emit(
        "mod-download-progress",
        json!({
            "id": project_id,
            "projectId": project_id,
            "title": title,
            "percent": 100,
            "status": "Nainstalováno!"
        }),
    );

    Ok(json!({
        "success": true,
        "filename": filename,
        "path": dest_path.to_string_lossy().to_string(),
        "versionNumber": ver_info.get("version_number").cloned().unwrap_or(json!(""))
    }))
}

fn parse_jar_metadata(path: &Path, filename: &str) -> (String, String, String, Option<String>, Option<String>) {
    let clean_base = filename
        .trim_end_matches(".disabled")
        .trim_end_matches(".jar")
        .to_string();
    let mut name = clean_base.clone();
    let mut version = String::from("1.0");
    let mut mod_id = clean_base.to_lowercase();
    let mut description = None;
    let mut icon_data_url = None;
    let mut declared_icon_path = None;

    if let Ok(file) = File::open(path) {
        if let Ok(mut archive) = ZipArchive::new(file) {
            if let Ok(mut f) = archive.by_name("fabric.mod.json") {
                let mut content = String::new();
                if f.read_to_string(&mut content).is_ok() {
                    if let Ok(val) = serde_json::from_str::<Value>(&content) {
                        if let Some(id) = val.get("id").and_then(|v| v.as_str()) {
                            mod_id = id.to_lowercase();
                        }
                        if let Some(n) = val.get("name").and_then(|v| v.as_str()) {
                            name = n.to_string();
                        }
                        if let Some(ver) = val.get("version").and_then(|v| v.as_str()) {
                            if !ver.contains("${") {
                                version = ver.to_string();
                            }
                        }
                        if let Some(desc) = val.get("description").and_then(|v| v.as_str()) {
                            description = Some(desc.to_string());
                        }
                        if let Some(icon_val) = val.get("icon") {
                            if let Some(icon_str) = icon_val.as_str() {
                                declared_icon_path = Some(icon_str.trim_start_matches('/').to_string());
                            } else if let Some(icon_obj) = icon_val.as_object() {
                                if let Some((_, v)) = icon_obj.iter().next() {
                                    if let Some(s) = v.as_str() {
                                        declared_icon_path = Some(s.trim_start_matches('/').to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if let Ok(mut f) = archive.by_name("quilt.mod.json") {
                let mut content = String::new();
                if f.read_to_string(&mut content).is_ok() {
                    if let Ok(val) = serde_json::from_str::<Value>(&content) {
                        if let Some(id) = val.pointer("/quilt_loader/id").and_then(|v| v.as_str()) {
                            mod_id = id.to_lowercase();
                        }
                        if let Some(n) = val.pointer("/quilt_loader/metadata/name").and_then(|v| v.as_str()) {
                            name = n.to_string();
                        }
                        if let Some(ver) = val.pointer("/quilt_loader/version").and_then(|v| v.as_str()) {
                            if !ver.contains("${") {
                                version = ver.to_string();
                            }
                        }
                        if let Some(desc) = val.pointer("/quilt_loader/metadata/description").and_then(|v| v.as_str()) {
                            description = Some(desc.to_string());
                        }
                        if let Some(icon_val) = val.pointer("/quilt_loader/metadata/icon") {
                            if let Some(icon_str) = icon_val.as_str() {
                                declared_icon_path = Some(icon_str.trim_start_matches('/').to_string());
                            }
                        }
                    }
                }
            }

            let mut candidates = Vec::new();
            if let Some(ref p) = declared_icon_path {
                candidates.push(p.clone());
            }
            candidates.push("icon.png".to_string());
            candidates.push(format!("assets/{}/icon.png", mod_id));
            candidates.push("assets/icon.png".to_string());
            candidates.push("pack.png".to_string());

            for cand in candidates {
                if let Ok(mut icon_file) = archive.by_name(&cand) {
                    if icon_file.is_file() {
                        let mut bytes = Vec::new();
                        if icon_file.by_ref().take(2_000_000).read_to_end(&mut bytes).is_ok() && !bytes.is_empty() {
                            let mime = if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
                                "image/png"
                            } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
                                "image/jpeg"
                            } else if bytes.starts_with(b"GIF8") {
                                "image/gif"
                            } else if bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml") {
                                "image/svg+xml"
                            } else {
                                "image/png"
                            };
                            use base64::Engine;
                            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                            icon_data_url = Some(format!("data:{};base64,{}", mime, b64));
                            break;
                        }
                    }
                }
            }

            if icon_data_url.is_none() {
                for i in 0..archive.len() {
                    let (cand_name, is_file) = match archive.by_index(i) {
                        Ok(f) => (f.name().to_string(), f.is_file()),
                        Err(_) => continue,
                    };
                    let n = cand_name.to_lowercase();
                    if is_file && (n.ends_with("/icon.png") || n == "icon.png" || n.ends_with("/logo.png") || n == "logo.png") {
                        if let Ok(mut icon_file) = archive.by_index(i) {
                            let mut bytes = Vec::new();
                            if icon_file.by_ref().take(2_000_000).read_to_end(&mut bytes).is_ok() && !bytes.is_empty() {
                                let mime = if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
                                    "image/png"
                                } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
                                    "image/jpeg"
                                } else if bytes.starts_with(b"GIF8") {
                                    "image/gif"
                                } else if bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml") {
                                    "image/svg+xml"
                                } else {
                                    "image/png"
                                };
                                use base64::Engine;
                                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                                icon_data_url = Some(format!("data:{};base64,{}", mime, b64));
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
    (mod_id, name, version, description, icon_data_url)
}

pub fn get_profile_mods_list(profile_id: Option<&str>) -> Value {
    let cfg = load_config();
    let prof_dir = resolve_profile_dir(&cfg, profile_id);
    let mods_dir = prof_dir.join("mods");
    let reg = read_registry_file(&prof_dir);

    let pid = profile_id
        .or_else(|| cfg.get("activeProfileId").and_then(|v| v.as_str()))
        .or_else(|| cfg.get("selectedProfile").and_then(|v| v.as_str()))
        .unwrap_or("minecraft-26.3");
    let profile_name = cfg
        .get("profiles")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.iter().find(|p| p.get("id").and_then(|v| v.as_str()) == Some(pid)))
        .and_then(|p| p.get("name").and_then(|v| v.as_str()))
        .unwrap_or(pid)
        .to_string();

    if !mods_dir.exists() {
        return json!({
            "success": true,
            "profileId": pid,
            "profileName": profile_name,
            "mods": [],
            "collisions": []
        });
    }

    let mut mods = Vec::new();
    let mut id_map: HashMap<String, Vec<String>> = HashMap::new();

    if let Ok(entries) = fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            let lower = fname.to_lowercase();
            if !lower.ends_with(".jar") && !lower.ends_with(".jar.disabled") {
                continue;
            }
            let enabled = lower.ends_with(".jar");
            let path = entry.path();
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            let (mod_id, parsed_name, version, description, extracted_icon) = parse_jar_metadata(&path, &fname);

            if enabled {
                id_map.entry(mod_id.clone()).or_default().push(fname.clone());
            }

            let base_jar = fname.trim_end_matches(".disabled");
            let reg_entry = reg.get(&fname).or_else(|| reg.get(base_jar));
            let display_name = reg_entry
                .and_then(|r| r.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or(&parsed_name);

            let icon_val = extracted_icon
                .as_deref()
                .map(Value::from)
                .or_else(|| reg_entry.and_then(|r| r.get("iconUrl")).cloned())
                .unwrap_or(Value::Null);

            mods.push(json!({
                "filename": fname,
                "id": mod_id,
                "modId": mod_id,
                "name": display_name,
                "cleanName": display_name,
                "version": version,
                "description": description.unwrap_or_default(),
                "enabled": enabled,
                "sizeBytes": size_bytes,
                "projectId": reg_entry.and_then(|r| r.get("projectId")).cloned().unwrap_or(Value::Null),
                "iconUrl": icon_val,
                "iconDataUrl": icon_val,
                "isCore": mod_id == "selfnametag"
            }));
        }
    }

    mods.sort_by(|a, b| {
        let na = a.get("name").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
        let nb = b.get("name").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
        na.cmp(&nb)
    });

    let mut collisions = Vec::new();
    for (mid, files) in id_map {
        if files.len() > 1 {
            collisions.push(json!({
                "modId": mid,
                "count": files.len(),
                "files": files
            }));
        }
    }

    json!({
        "success": true,
        "profileId": pid,
        "profileName": profile_name,
        "mods": mods,
        "collisions": collisions
    })
}

/// Helper performing a resilient file rename with 4 retry attempts and 150ms delay.
/// If locked by Minecraft or Windows file locking (EBUSY / os error 32 / PermissionDenied),
/// returns a clear Czech error message instead of raw system stacktraces.
pub fn resilient_rename(from: &Path, to: &Path) -> Result<(), String> {
    let mut last_err = None;
    for attempt in 0..4 {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
        match fs::rename(from, to) {
            Ok(_) => return Ok(()),
            Err(e) => {
                last_err = Some(e);
            }
        }
    }

    let err = match last_err {
        Some(e) => e,
        None => return Ok(()),
    };

    let err_str = err.to_string();
    let is_lock = err.kind() == std::io::ErrorKind::PermissionDenied
        || err.raw_os_error() == Some(32) // Windows ERROR_SHARING_VIOLATION
        || err_str.contains("EBUSY")
        || err_str.contains("os error 32")
        || err_str.contains("Permission denied")
        || err_str.contains("Access is denied")
        || err_str.contains("resource busy")
        || err_str.contains("being used by another process");

    if is_lock || crate::launcher::is_game_running() {
        return Err("Mód je právě využíván běžící hrou Minecraft. Nejprve hru ukonči a poté mód vypni.".to_string());
    }

    Err(err_str)
}

/// Helper performing resilient file deletion with 4 retry attempts and 150ms delay.
pub fn resilient_remove_file(target: &Path) -> Result<(), String> {
    let mut last_err = None;
    for attempt in 0..4 {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
        match fs::remove_file(target) {
            Ok(_) => return Ok(()),
            Err(e) => {
                last_err = Some(e);
            }
        }
    }

    let err = match last_err {
        Some(e) => e,
        None => return Ok(()),
    };

    let err_str = err.to_string();
    let is_lock = err.kind() == std::io::ErrorKind::PermissionDenied
        || err.raw_os_error() == Some(32)
        || err_str.contains("EBUSY")
        || err_str.contains("os error 32")
        || err_str.contains("Permission denied")
        || err_str.contains("Access is denied")
        || err_str.contains("resource busy")
        || err_str.contains("being used by another process");

    if is_lock || crate::launcher::is_game_running() {
        return Err("Mód je právě využíván běžící hrou Minecraft. Nejprve hru ukonči a poté mód vypni.".to_string());
    }

    Err(err_str)
}

pub fn toggle_profile_mod_file(profile_id: Option<&str>, filename: &str) -> Value {
    let cfg = load_config();
    let prof_dir = resolve_profile_dir(&cfg, profile_id);
    let mods_dir = prof_dir.join("mods");
    let safe_name = Path::new(filename)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let current_path = mods_dir.join(&safe_name);
    if !current_path.exists() {
        return json!({ "success": false, "error": "Soubor nebyl nalezen." });
    }

    let (new_name, enabled) = if safe_name.ends_with(".disabled") {
        (safe_name.trim_end_matches(".disabled").to_string(), true)
    } else {
        (format!("{}.disabled", safe_name), false)
    };
    let new_path = mods_dir.join(&new_name);
    match resilient_rename(&current_path, &new_path) {
        Ok(_) => json!({ "success": true, "newFilename": new_name, "enabled": enabled }),
        Err(e) => json!({ "success": false, "error": e }),
    }
}

pub fn delete_profile_mod_file(profile_id: Option<&str>, filename: &str) -> Value {
    let cfg = load_config();
    let prof_dir = resolve_profile_dir(&cfg, profile_id);
    let mods_dir = prof_dir.join("mods");
    let safe_name = Path::new(filename)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let target = mods_dir.join(&safe_name);
    if target.exists() {
        if let Err(e) = resilient_remove_file(&target) {
            return json!({ "success": false, "error": e });
        }
    }
    json!({ "success": true })
}

pub fn resolve_profile_mod_collisions(profile_id: Option<&str>) -> Value {
    let cfg = load_config();
    let prof_dir = resolve_profile_dir(&cfg, profile_id);
    let mods_dir = prof_dir.join("mods");
    let list = get_profile_mods_list(profile_id);
    let mut removed = Vec::new();

    if let Some(collisions) = list.get("collisions").and_then(|v| v.as_array()) {
        for col in collisions {
            if let Some(files) = col.get("files").and_then(|v| v.as_array()) {
                let mut file_infos: Vec<(String, SystemTime)> = files
                    .iter()
                    .filter_map(|f| f.as_str().map(|s| s.to_string()))
                    .map(|fname| {
                        let mtime = fs::metadata(mods_dir.join(&fname))
                            .and_then(|m| m.modified())
                            .unwrap_or(UNIX_EPOCH);
                        (fname, mtime)
                    })
                    .collect();
                // Sort newest first, keep the newest, delete older duplicates
                file_infos.sort_by(|a, b| b.1.cmp(&a.1));
                for (old_file, _) in file_infos.into_iter().skip(1) {
                    if fs::remove_file(mods_dir.join(&old_file)).is_ok() {
                        removed.push(old_file);
                    }
                }
            }
        }
    }

    json!({
        "success": true,
        "resolved": removed.len(),
        "removed": removed
    })
}

pub fn get_profile_packs_list(profile_id: Option<&str>, pack_type: &str) -> Value {
    let cfg = load_config();
    let prof_dir = resolve_profile_dir(&cfg, profile_id);
    let subdir = if pack_type == "shader" || pack_type == "shaderpacks" {
        "shaderpacks"
    } else {
        "resourcepacks"
    };
    let dir = prof_dir.join(subdir);
    if !dir.exists() {
        return json!({ "packs": [] });
    }

    let mut packs = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            if fname.starts_with('.') {
                continue;
            }
            let enabled = !fname.ends_with(".disabled");
            let clean_name = fname
                .trim_end_matches(".disabled")
                .trim_end_matches(".zip")
                .to_string();
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            let mut pack_icon = None;
            let pack_path = entry.path();
            if pack_path.is_file() && (fname.ends_with(".zip") || fname.ends_with(".zip.disabled")) {
                if let Ok(file) = File::open(&pack_path) {
                    if let Ok(mut archive) = ZipArchive::new(file) {
                        if let Ok(mut f) = archive.by_name("pack.png") {
                            let mut b = Vec::new();
                            if f.by_ref().take(2_000_000).read_to_end(&mut b).is_ok() && !b.is_empty() {
                                use base64::Engine;
                                let b64 = base64::engine::general_purpose::STANDARD.encode(&b);
                                pack_icon = Some(format!("data:image/png;base64,{}", b64));
                            }
                        }
                    }
                }
            }
            packs.push(json!({
                "filename": fname,
                "name": clean_name,
                "enabled": enabled,
                "sizeBytes": size_bytes,
                "iconDataUrl": pack_icon.as_deref().map(Value::from).unwrap_or(Value::Null)
            }));
        }
    }
    json!({ "packs": packs })
}

pub fn toggle_profile_pack_file(profile_id: Option<&str>, pack_type: &str, filename: &str) -> Value {
    let cfg = load_config();
    let prof_dir = resolve_profile_dir(&cfg, profile_id);
    let subdir = if pack_type == "shader" || pack_type == "shaderpacks" {
        "shaderpacks"
    } else {
        "resourcepacks"
    };
    let dir = prof_dir.join(subdir);
    let safe_name = Path::new(filename)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let current = dir.join(&safe_name);
    if !current.exists() {
        return json!({ "success": false, "error": "Balíček nebyl nalezen." });
    }
    let (new_name, enabled) = if safe_name.ends_with(".disabled") {
        (safe_name.trim_end_matches(".disabled").to_string(), true)
    } else {
        (format!("{}.disabled", safe_name), false)
    };
    match resilient_rename(&current, &dir.join(&new_name)) {
        Ok(_) => json!({ "success": true, "newFilename": new_name, "enabled": enabled }),
        Err(e) => json!({ "success": false, "error": e }),
    }
}

pub fn delete_profile_pack_file(profile_id: Option<&str>, pack_type: &str, filename: &str) -> Value {
    let cfg = load_config();
    let prof_dir = resolve_profile_dir(&cfg, profile_id);
    let subdir = if pack_type == "shader" || pack_type == "shaderpacks" {
        "shaderpacks"
    } else {
        "resourcepacks"
    };
    let dir = prof_dir.join(subdir);
    let safe_name = Path::new(filename)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let target = dir.join(&safe_name);
    if target.exists() {
        if target.is_dir() {
            let _ = fs::remove_dir_all(&target);
        } else if let Err(e) = resilient_remove_file(&target) {
            return json!({ "success": false, "error": e });
        }
    }
    json!({ "success": true })
}

pub async fn check_profile_mod_updates_bulk(profile_id: Option<&str>) -> Value {
    let cfg = load_config();
    let prof_dir = resolve_profile_dir(&cfg, profile_id);
    let mods_dir = prof_dir.join("mods");
    if !mods_dir.exists() {
        return json!({ "updates": {} });
    }

    let mut mc_version = "26.3".to_string();
    let mut loader = "fabric".to_string();
    let pid = profile_id
        .or_else(|| cfg.get("activeProfileId").and_then(|v| v.as_str()))
        .or_else(|| cfg.get("selectedProfile").and_then(|v| v.as_str()))
        .unwrap_or("mychalsmp-fabric");
    if let Some(profiles) = cfg.get("profiles").and_then(|v| v.as_array()) {
        if let Some(p) = profiles.iter().find(|x| x.get("id").and_then(|v| v.as_str()) == Some(pid)) {
            mc_version = p.get("version").and_then(|v| v.as_str()).unwrap_or("26.3").to_string();
            loader = p.get("loader").and_then(|v| v.as_str()).unwrap_or("fabric").to_string();
        }
    }

    let mut hash_to_file: HashMap<String, String> = HashMap::new();
    if let Ok(entries) = fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            if !fname.ends_with(".jar") {
                continue;
            }
            if let Some(sha1) = compute_sha1_file(&entry.path()) {
                hash_to_file.insert(sha1, fname);
            }
        }
    }

    if hash_to_file.is_empty() {
        return json!({ "success": true, "updates": [] });
    }

    let hashes: Vec<String> = hash_to_file.keys().cloned().collect();
    // Strict exact game version check for updates so we never downgrade/cross-grade a working mod!
    let game_versions = vec![mc_version.clone()];
    let client = modrinth_client();

    let resp = match client
        .post("https://api.modrinth.com/v2/version_files/update")
        .json(&json!({
            "hashes": hashes,
            "algorithm": "sha1",
            "loaders": [loader],
            "game_versions": game_versions
        }))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        _ => return json!({ "success": true, "updates": [] }),
    };

    let latest_map: HashMap<String, Value> = resp.json().await.unwrap_or_default();
    let reg = read_registry_file(&prof_dir);
    let mut updates_arr = Vec::new();

    for (old_hash, new_ver) in latest_map {
        if let Some(old_fname) = hash_to_file.get(&old_hash) {
            if let Some(primary) = new_ver
                .get("files")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
            {
                let new_hash = primary
                    .pointer("/hashes/sha1")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !new_hash.is_empty() && !new_hash.eq_ignore_ascii_case(&old_hash) {
                    let proj_id = new_ver
                        .get("project_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let new_ver_num = new_ver
                        .get("version_number")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let dl_url = primary
                        .get("url")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let new_fname = primary
                        .get("filename")
                        .and_then(|v| v.as_str())
                        .unwrap_or(old_fname)
                        .to_string();
                    let base_jar = old_fname.trim_end_matches(".disabled");
                    let title = reg
                        .get(old_fname)
                        .or_else(|| reg.get(base_jar))
                        .and_then(|r| r.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or(base_jar)
                        .to_string();

                    updates_arr.push(json!({
                        "id": proj_id,
                        "projectId": proj_id,
                        "title": title,
                        "versionId": new_ver.get("id").cloned().unwrap_or(Value::Null),
                        "versionNumber": new_ver_num,
                        "newVersion": new_ver_num,
                        "oldFilename": old_fname,
                        "newFilename": new_fname,
                        "filename": new_fname,
                        "directUrl": dl_url,
                        "downloadUrl": dl_url
                    }));
                }
            }
        }
    }

    json!({
        "success": true,
        "updates": updates_arr
    })
}

pub fn check_is_profile_optimized(profile_id: Option<&str>) -> Value {
    let cfg = load_config();
    let prof_dir = resolve_profile_dir(&cfg, profile_id);
    let mods_dir = prof_dir.join("mods");
    if !mods_dir.exists() {
        return json!({
            "optimized": false,
            "installedCount": 0,
            "totalCount": OPTIMIZATION_PACK_MODS.len(),
            "missing": OPTIMIZATION_PACK_MODS.iter().map(|m| m.name).collect::<Vec<_>>()
        });
    }

    let mut existing_files = Vec::new();
    if let Ok(entries) = fs::read_dir(&mods_dir) {
        for e in entries.flatten() {
            existing_files.push(e.file_name().to_string_lossy().to_lowercase());
        }
    }

    let mut installed = 0usize;
    let mut missing = Vec::new();
    for def in OPTIMIZATION_PACK_MODS {
        let found = existing_files.iter().any(|f| {
            (f.ends_with(".jar") || f.ends_with(".jar.disabled"))
                && (f.contains(def.file_prefix) || f.contains(def.slug))
        });
        if found {
            installed += 1;
        } else {
            missing.push(def.name);
        }
    }

    let has_sodium = existing_files.iter().any(|f| f.ends_with(".jar") && f.contains("sodium"));
    let has_lithium = existing_files.iter().any(|f| f.ends_with(".jar") && f.contains("lithium"));

    json!({
        "optimized": installed >= 5 || (has_sodium && has_lithium),
        "hasSodium": has_sodium,
        "hasLithium": has_lithium,
        "installedCount": installed,
        "totalCount": OPTIMIZATION_PACK_MODS.len(),
        "missing": missing
    })
}

pub async fn install_optimization_pack_for_profile(
    app: &AppHandle,
    profile_id: Option<&str>,
    version: Option<&str>,
) -> Value {
    let cfg = load_config();
    let prof_dir = resolve_profile_dir(&cfg, profile_id);
    let mods_dir = prof_dir.join("mods");
    let _ = fs::create_dir_all(&mods_dir);

    let mc_ver = version.unwrap_or("26.3");
    let enabled_mods = cfg.get("mods").cloned().unwrap_or_else(|| json!({}));

    let total = OPTIMIZATION_PACK_MODS.len();
    let mut installed = 0usize;

    for (idx, def) in OPTIMIZATION_PACK_MODS.iter().enumerate() {
        let is_enabled = if def.id == "fabric-api" {
            true
        } else {
            enabled_mods
                .get(def.id)
                .and_then(|v| v.as_bool())
                .unwrap_or(true)
        };
        if !is_enabled {
            continue;
        }

        // Check if already present in mods_dir
        let already_exists = fs::read_dir(&mods_dir)
            .ok()
            .map(|entries| {
                entries.flatten().any(|e| {
                    let f = e.file_name().to_string_lossy().to_lowercase();
                    f.ends_with(".jar") && (f.contains(def.file_prefix) || f.contains(def.slug))
                })
            })
            .unwrap_or(false);

        let pct = (((idx + 1) as f64 / total as f64) * 100.0).round() as u32;
        let _ = app.emit(
            "optimization-progress",
            json!({
                "current": idx + 1,
                "total": total,
                "percent": pct,
                "modName": def.name,
                "status": if already_exists {
                    format!("{} je již připraven", def.name)
                } else {
                    format!("Stahuji {}...", def.name)
                }
            }),
        );

        if already_exists {
            installed += 1;
            continue;
        }

        if let Ok(ver_info) = find_best_modrinth_version(def.slug, mc_ver, "fabric", "mod").await {
            if let Some(primary) = ver_info
                .get("files")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
            {
                if let (Some(url), Some(fname)) = (
                    primary.get("url").and_then(|v| v.as_str()),
                    primary.get("filename").and_then(|v| v.as_str()),
                ) {
                    let sha = primary.pointer("/hashes/sha1").and_then(|v| v.as_str());
                    if download_file_with_progress(url, &mods_dir.join(fname), sha)
                        .await
                        .is_ok()
                    {
                        installed += 1;
                    }
                }
            }
        }
    }

    ensure_default_options_and_servers(&prof_dir);
    let _ = resolve_profile_mod_collisions(profile_id);

    json!({
        "success": true,
        "installedCount": installed
    })
}

pub fn ensure_default_options_and_servers(game_dir: &Path) {
    let _ = fs::create_dir_all(game_dir);
    let options_path = game_dir.join("options.txt");
    if !options_path.exists() {
        let default_opts = "guiScale:2\nmaxFps:260\nenableVsync:false\nrenderDistance:12\nsimulationDistance:10\ngamma:1.0\npauseOnLostFocus:false\n";
        let _ = fs::write(&options_path, default_opts);
    } else if let Ok(raw) = fs::read_to_string(&options_path) {
        // Fix disproportionate guiScale:0 or >3 if unset
        let mut modified = false;
        let mut out_lines = Vec::new();
        for line in raw.lines() {
            if line.starts_with("guiScale:") {
                let val = line.trim_start_matches("guiScale:").trim();
                if val == "0" || val == "4" || val == "5" {
                    out_lines.push("guiScale:2".to_string());
                    modified = true;
                } else {
                    out_lines.push(line.to_string());
                }
            } else {
                out_lines.push(line.to_string());
            }
        }
        if modified {
            let _ = fs::write(&options_path, out_lines.join("\n") + "\n");
        }
    }

    // Write valid uncompressed NBT servers.dat if missing
    let servers_dat = game_dir.join("servers.dat");
    if !servers_dat.exists() {
        let nbt = build_default_servers_dat_nbt();
        let _ = fs::write(&servers_dat, nbt);
    }
}

fn build_default_servers_dat_nbt() -> Vec<u8> {
    let mut buf = Vec::new();
    let put_string = |b: &mut Vec<u8>, s: &str| {
        let bytes = s.as_bytes();
        b.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
        b.extend_from_slice(bytes);
    };

    // Root TAG_Compound ("")
    buf.push(0x0A);
    put_string(&mut buf, "");

    // TAG_List ("servers") of TAG_Compound (0x0A), count = 2
    buf.push(0x09);
    put_string(&mut buf, "servers");
    buf.push(0x0A);
    buf.extend_from_slice(&2i32.to_be_bytes());

    let entries = [
        ("MYCHAL SMP — Hlavní Server", "mychalsmp.xyz"),
        ("MYCHAL PvP — Arény & Duely", "pvp.mychalsmp.xyz"),
    ];

    for (name, ip) in entries {
        // TAG_String "name"
        buf.push(0x08);
        put_string(&mut buf, "name");
        put_string(&mut buf, name);

        // TAG_String "ip"
        buf.push(0x08);
        put_string(&mut buf, "ip");
        put_string(&mut buf, ip);

        // TAG_Byte "acceptTextures" = 1
        buf.push(0x01);
        put_string(&mut buf, "acceptTextures");
        buf.push(1);

        // TAG_End of compound item
        buf.push(0x00);
    }

    // TAG_End of Root
    buf.push(0x00);
    buf
}

pub fn toggle_bundled_mod_state(mod_id: &str) -> Value {
    let mut cfg = load_config();
    let curr = cfg
        .pointer(&format!("/mods/{}", mod_id))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let next = !curr;
    if let Some(mods_obj) = cfg.get_mut("mods").and_then(|v| v.as_object_mut()) {
        mods_obj.insert(mod_id.to_string(), json!(next));
    }
    let saved = crate::config::save_config(&cfg);
    json!({
        "modId": mod_id,
        "enabled": next,
        "mods": saved.get("mods").cloned().unwrap_or_else(|| json!({}))
    })
}

pub async fn apply_profile_optimization(app: &AppHandle, profile_id: &str) -> Value {
    install_optimization_pack_for_profile(app, Some(profile_id), None).await
}

pub fn check_profile_optimization_status(profile_id: &str) -> Value {
    check_is_profile_optimized(Some(profile_id))
}

pub async fn check_profile_mod_updates(profile_id: Option<&str>) -> Value {
    check_profile_mod_updates_bulk(profile_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_parse_jar_metadata_fallback() {
        let dummy_path = PathBuf::from("/non/existent/path/dummy.jar");
        let (mod_id, name, version, desc, icon) = parse_jar_metadata(&dummy_path, "testmod-1.2.3.jar");
        assert_eq!(mod_id, "testmod-1.2.3");
        assert_eq!(name, "testmod-1.2.3");
        assert_eq!(version, "1.0");
        assert!(desc.is_none());
        assert!(icon.is_none());
    }

    #[test]
    fn test_get_profile_mods_list_returns_valid_structure() {
        let list = get_profile_mods_list(None);
        assert!(list.get("success").and_then(|v| v.as_bool()).unwrap_or(false));
        assert!(list.get("mods").and_then(|v| v.as_array()).is_some());
    }
}


