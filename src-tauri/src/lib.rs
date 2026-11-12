pub mod auth;
pub mod config;
pub mod crash;
pub mod launcher;
pub mod mods;
pub mod ping;
pub mod profiles;
pub mod services;
pub mod skin;
pub mod vault;
pub mod warden;

use base64::Engine;
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, Window};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Configuration Commands
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_config() -> Value {
    crate::config::load_config()
}

#[tauri::command]
fn save_config(cfg: Value) -> Value {
    crate::config::save_config(&cfg)
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Server Ping Commands
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
async fn ping_server(ip: String, port: u16) -> Value {
    crate::ping::ping_minecraft_server(&ip, port).await
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Authentication Commands
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn login_offline(username: String) -> Value {
    match crate::auth::create_offline_auth(&username) {
        Ok(v) => v,
        Err(e) => json!({ "success": false, "error": e }),
    }
}

#[tauri::command]
async fn login_microsoft(app: AppHandle) -> Value {
    match crate::auth::login_microsoft_flow(app).await {
        Ok(v) => v,
        Err(e) => json!({ "success": false, "error": e }),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Launch & Process Management Commands
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
async fn launch_game(
    app: AppHandle,
    profile_id: String,
    server_ip: Option<String>,
) -> Value {
    let cfg = crate::config::load_config();
    let base_dir = crate::config::get_default_game_dir();
    let prof_dir = crate::config::resolve_profile_dir(&cfg, Some(&profile_id));
    let profile = match cfg
        .get("profiles")
        .and_then(|p| p.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|p| p.get("id").and_then(|v| v.as_str()) == Some(&profile_id))
                .cloned()
        }) {
        Some(p) => p,
        None => {
            return json!({ "success": false, "error": format!("Profil '{}' nebyl nalezen.", profile_id) });
        }
    };

    if crate::launcher::is_game_running() {
        return json!({ "success": false, "error": "Hra již běží." });
    }

    let mc_ver = profile
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("26.3");
    let mc_ver_owned = mc_ver.to_string();

    let app_clone = app.clone();
    let pid_clone = profile_id.clone();
    let server_clone = server_ip.clone();

    tokio::spawn(async move {
        let app_prog = app_clone.clone();
        let _ = app_clone.emit(
            "launch-progress",
            json!({ "percent": 5, "text": "Hledání běhového prostředí Java..." }),
        );
        let java_path = match crate::launcher::ensure_java_executable(
            &cfg,
            &base_dir,
            move |pct, text| {
                let _ = app_prog.emit("launch-progress", json!({ "percent": pct, "text": text }));
            },
        )
        .await
        {
            Ok(p) => p,
            Err(e) => {
                let _ = app_clone.emit(
                    "launch-crash",
                    json!({
                        "hasCrash": true,
                        "title": "Chyba běhového prostředí Java",
                        "message": format!("Nepodařilo se připravit Javu: {}", e)
                    }),
                );
                return;
            }
        };

        let _ = app_clone.emit(
            "launch-progress",
            json!({ "percent": 15, "text": "Příprava herního manifestu..." }),
        );
        let manifest = match crate::launcher::ensure_fabric_profile(&base_dir, &mc_ver_owned).await {
            Ok(m) => m,
            Err(e) => {
                let _ = app_clone.emit(
                    "launch-crash",
                    json!({
                        "hasCrash": true,
                        "title": "Chyba manifestu",
                        "message": format!("Nepodařilo se načíst manifest verze: {}", e)
                    }),
                );
                return;
            }
        };

        let _ = app_clone.emit(
            "launch-progress",
            json!({ "percent": 25, "text": "Ověřování integrity herního klienta..." }),
        );
        if let Err(e) =
            crate::launcher::ensure_vanilla_client_jar(&base_dir, &mc_ver_owned, &manifest).await
        {
            let _ = app_clone.emit(
                "launch-crash",
                json!({
                    "hasCrash": true,
                    "title": "Chyba herního klienta",
                    "message": format!("Nepodařilo se ověřit Minecraft client JAR: {}", e)
                }),
            );
            return;
        }

        let app_lib = app_clone.clone();
        let target_os = crate::launcher::TargetOs::current();
        let _ = app_clone.emit(
            "launch-progress",
            json!({ "percent": 35, "text": "Ověřování knihoven..." }),
        );
        if let Err(e) = crate::launcher::ensure_libraries(
            &base_dir,
            &manifest.libraries,
            target_os,
            move |pct, text| {
                let _ = app_lib.emit("launch-progress", json!({ "percent": pct, "text": text }));
            },
        )
        .await
        {
            let _ = app_clone.emit(
                "launch-crash",
                json!({
                    "hasCrash": true,
                    "title": "Chyba knihoven",
                    "message": format!("Nepodařilo se stáhnout knihovny: {}", e)
                }),
            );
            return;
        }

        let app_ast = app_clone.clone();
        let _ = app_clone.emit(
            "launch-progress",
            json!({ "percent": 50, "text": "Ověřování herních assetů..." }),
        );
        if let Some(ref asset_ref) = manifest.asset_index {
            if let Err(e) = crate::launcher::ensure_assets(
                &base_dir,
                asset_ref,
                false,
                move |pct, text| {
                    let _ = app_ast.emit("launch-progress", json!({ "percent": pct, "text": text }));
                },
            )
            .await
            {
                let _ = app_clone.emit(
                    "launch-crash",
                    json!({
                        "hasCrash": true,
                        "title": "Chyba herních assetů",
                        "message": format!("Nepodařilo se stáhnout assety: {}", e)
                    }),
                );
                return;
            }
        }

        let _ = app_clone.emit(
            "launch-progress",
            json!({ "percent": 65, "text": "Warden kontrola modifikací..." }),
        );
        let warden_scan = crate::warden::scan_profile_mods_warden(Some(&pid_clone));
        if let Some(violations) = warden_scan.get("violations").and_then(|v| v.as_array()) {
            if !violations.is_empty() {
                let _ = crate::warden::disable_all_illegal_mods(Some(&pid_clone));
            }
        }

        let _ = crate::launcher::resolve_mod_compatibility(&prof_dir.join("mods"));

        let auth_session = if let Some(ms) = cfg.get("microsoftAccount").filter(|x| !x.is_null()) {
            json!({
                "name": ms
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Player"),
                "uuid": ms
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("00000000-0000-0000-0000-000000000000"),
                "access_token": ms
                    .get("accessToken")
                    .and_then(|v| v.as_str())
                    .unwrap_or("offline"),
                "user_type": "msa",
            })
        } else {
            let uname = cfg
                .get("username")
                .and_then(|v| v.as_str())
                .unwrap_or("Player");
            json!({
                "name": uname,
                "uuid": crate::auth::generate_offline_uuid(uname),
                "access_token": "offline",
                "user_type": "legacy",
            })
        };

        let mut spec = match crate::launcher::construct_launch_spec(
            &cfg,
            &profile,
            &auth_session,
            &manifest,
            &base_dir,
            &java_path,
            target_os,
        ) {
            Ok(s) => s,
            Err(e) => {
                let _ = app_clone.emit(
                    "launch-crash",
                    json!({
                        "hasCrash": true,
                        "title": "Chyba spouštěcích parametrů",
                        "message": format!("Chyba při sestavování příkazu: {}", e)
                    }),
                );
                return;
            }
        };

        if let Some(ref srv) = server_clone {
            if !srv.is_empty() {
                spec.game_args.push("--quickPlayMultiplayer".to_string());
                spec.game_args.push(srv.clone());
            }
        }

        let _ = app_clone.emit(
            "launch-progress",
            json!({ "percent": 90, "text": "Spouštění herního procesu..." }),
        );
        if let Err(e) =
            crate::launcher::spawn_game_process(&app_clone, spec, pid_clone, prof_dir).await
        {
            let _ = app_clone.emit(
                "launch-crash",
                json!({
                    "hasCrash": true,
                    "title": "Chyba spuštění procesu",
                    "message": format!("Nelze spustit Minecraft: {}", e)
                }),
            );
        }
    });

    json!({ "success": true })
}

#[tauri::command]
fn kill_game() -> Value {
    let ok = crate::launcher::kill_game();
    json!({ "success": ok })
}

#[tauri::command]
fn cancel_launch() -> Value {
    let ok = crate::launcher::cancel_launch();
    json!({ "success": ok })
}

#[tauri::command]
fn is_game_running() -> bool {
    crate::launcher::is_game_running()
}

#[tauri::command]
fn get_active_session() -> Value {
    crate::launcher::get_active_session()
}

#[tauri::command]
fn detect_java() -> Value {
    if let Some(path) = crate::launcher::detect_java_path(21) {
        let ver = crate::launcher::get_java_major_version(&path);
        json!({
            "path": path.to_string_lossy(),
            "version": ver,
            "compatible": ver >= 21
        })
    } else {
        Value::Null
    }
}

#[tauri::command]
fn get_available_javas() -> Value {
    json!(crate::launcher::get_available_javas())
}

#[tauri::command]
fn get_installed_versions() -> Value {
    let base = crate::config::get_default_game_dir();
    let versions_dir = base.join("versions");
    let mut versions = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&versions_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if entry.path().join(format!("{}.jar", name)).exists()
                    || entry.path().join(format!("{}.json", name)).exists()
                {
                    versions.push(name);
                }
            }
        }
    }
    json!(versions)
}

#[tauri::command]
async fn preload_launch_environment(_app: AppHandle, profile_id: Option<String>) -> Value {
    let cfg = crate::config::load_config();
    let base_dir = crate::config::get_default_game_dir();
    let profile = cfg
        .get("profiles")
        .and_then(|p| p.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|p| p.get("id").and_then(|v| v.as_str()) == profile_id.as_deref())
                .cloned()
        });
    let mc_ver = profile
        .as_ref()
        .and_then(|p| p.get("version").and_then(|v| v.as_str()))
        .or_else(|| cfg.get("version").and_then(|v| v.as_str()))
        .unwrap_or("26.3");

    let _ = crate::launcher::ensure_java_executable(&cfg, &base_dir, |_, _| {}).await;
    if let Ok(manifest) = crate::launcher::ensure_fabric_profile(&base_dir, mc_ver).await {
        let _ = crate::launcher::ensure_vanilla_client_jar(&base_dir, mc_ver, &manifest).await;
    }
    json!({ "success": true })
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Modrinth & Mod Manager Commands
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
async fn search_modrinth(
    query: Option<String>,
    version: Option<String>,
    loader: Option<String>,
    category: Option<String>,
    project_type: Option<String>,
    offset: Option<u32>,
    limit: Option<u32>,
) -> Value {
    match crate::mods::search_modrinth_api(
        query.as_deref().unwrap_or(""),
        version.as_deref().unwrap_or(""),
        loader.as_deref().unwrap_or(""),
        category.as_deref().unwrap_or(""),
        project_type.as_deref().unwrap_or("mod"),
        offset.unwrap_or(0),
        limit.unwrap_or(20),
    )
    .await
    {
        Ok(v) => v,
        Err(e) => json!({ "hits": [], "total_hits": 0, "error": e }),
    }
}

#[tauri::command]
async fn download_mod_or_pack(app: AppHandle, options: Value) -> Value {
    match crate::mods::download_mod_or_pack_with_deps(&app, &options).await {
        Ok(v) => v,
        Err(e) => json!({ "success": false, "error": e }),
    }
}

#[tauri::command]
async fn check_profile_mod_updates(profile_id: Option<String>) -> Value {
    crate::mods::check_profile_mod_updates_bulk(profile_id.as_deref()).await
}

#[tauri::command]
fn toggle_mod(mod_id: String) -> Value {
    let cfg = crate::config::load_config();
    let active_id = cfg.get("activeProfileId").and_then(|v| v.as_str());
    let list = crate::mods::get_profile_mods_list(active_id);
    if let Some(mods) = list.get("mods").and_then(|v| v.as_array()) {
        for m in mods {
            if m.get("id").and_then(|v| v.as_str()) == Some(&mod_id) {
                if let Some(filename) = m.get("filename").and_then(|v| v.as_str()) {
                    return crate::mods::toggle_profile_mod_file(active_id, filename);
                }
            }
        }
    }
    json!({ "success": false, "error": format!("Mód '{}' nebyl nalezen.", mod_id) })
}

#[tauri::command]
fn get_profile_mods(profile_id: Option<String>) -> Value {
    crate::mods::get_profile_mods_list(profile_id.as_deref())
}

#[tauri::command]
fn toggle_profile_mod(profile_id: Option<String>, filename: String) -> Value {
    crate::mods::toggle_profile_mod_file(profile_id.as_deref(), &filename)
}

#[tauri::command]
fn delete_profile_mod(profile_id: Option<String>, filename: String) -> Value {
    crate::mods::delete_profile_mod_file(profile_id.as_deref(), &filename)
}

#[tauri::command]
fn resolve_mod_collisions(profile_id: Option<String>) -> Value {
    crate::mods::resolve_profile_mod_collisions(profile_id.as_deref())
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Profile Discovery, Import, Seed & Studio Commands
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn discover_installed_profiles() -> Value {
    json!(crate::profiles::discover_installed_profiles())
}

#[tauri::command]
fn import_profile_dialog(app: AppHandle) -> Value {
    crate::profiles::import_profile_dialog(&app)
}

#[tauri::command]
fn confirm_import_profile(data: Value) -> Value {
    crate::profiles::confirm_import_profile(&data)
}

#[tauri::command]
async fn upgrade_profile(
    app: AppHandle,
    source_profile_id: String,
    target_version: String,
) -> Value {
    crate::profiles::upgrade_profile(Some(&app), &source_profile_id, &target_version).await
}

#[tauri::command]
fn open_profile_folder(profile_id: Option<String>, subfolder: Option<String>) -> Value {
    let ok = crate::profiles::open_profile_folder(profile_id.as_deref(), subfolder.as_deref());
    json!({ "success": ok })
}

#[tauri::command]
fn update_profile_settings(profile_id: String, updates: Value) -> Value {
    crate::profiles::update_profile_settings(&profile_id, &updates)
}

#[tauri::command]
fn delete_profile(profile_id: String) -> Value {
    crate::profiles::delete_profile(&profile_id)
}

#[tauri::command]
fn reset_launcher_data() -> Value {
    crate::profiles::reset_launcher_data()
}

#[tauri::command]
fn generate_profile_seed(profile_id: String) -> Value {
    crate::profiles::generate_profile_seed(&profile_id)
}

#[tauri::command]
async fn import_profile_seed(
    app: AppHandle,
    profile_id: String,
    seed_string: String,
) -> Value {
    crate::profiles::import_profile_seed(Some(&app), &profile_id, &seed_string).await
}

#[tauri::command]
fn duplicate_profile(profile_id: String) -> Value {
    let mut cfg = crate::config::load_config();
    let original = match cfg
        .get("profiles")
        .and_then(|p| p.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|p| p.get("id").and_then(|v| v.as_str()) == Some(&profile_id))
                .cloned()
        }) {
        Some(p) => p,
        None => {
            return json!({ "success": false, "error": format!("Profil '{}' nebyl nalezen.", profile_id) });
        }
    };

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let new_id = format!("{}-copy-{}", profile_id, ts);
    let original_name = original
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Profil");
    let new_name = format!("{} (Kopie)", original_name);

    let mut new_profile = original.clone();
    new_profile["id"] = json!(new_id);
    new_profile["name"] = json!(new_name);
    new_profile["lastPlayed"] = Value::Null;
    new_profile["playtimeSeconds"] = json!(0);

    let base_instances_dir = crate::config::get_default_game_dir().join("instances");
    let orig_inst_dir = base_instances_dir.join(&profile_id);
    if orig_inst_dir.exists() && orig_inst_dir.is_dir() {
        let new_inst_dir = base_instances_dir.join(&new_id);
        let _ = crate::profiles::copy_dir_recursive(&orig_inst_dir, &new_inst_dir);
        new_profile["gameDir"] = json!(new_inst_dir.to_string_lossy());
    }

    if let Some(profiles) = cfg.get_mut("profiles").and_then(|v| v.as_array_mut()) {
        profiles.insert(0, new_profile.clone());
    }
    cfg["activeProfileId"] = json!(new_id);
    crate::config::save_config(&cfg);

    json!({
        "success": true,
        "profile": new_profile,
        "activeProfileId": new_id
    })
}

#[tauri::command]
async fn apply_profile_optimization(app: AppHandle, profile_id: String) -> Value {
    crate::mods::apply_profile_optimization(&app, &profile_id).await
}

#[tauri::command]
fn check_optimization_status(profile_id: String) -> Value {
    crate::mods::check_profile_optimization_status(&profile_id)
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Keybinds & Keyarts Commands
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_keybinds(profile_id: Option<String>) -> Value {
    crate::services::get_keybinds(profile_id.as_deref())
}

#[tauri::command]
fn save_keybinds(binds: Value, profile_id: Option<String>) -> Value {
    crate::services::save_keybinds(&binds, profile_id.as_deref())
}

#[tauri::command]
fn reset_keybinds_default() -> Value {
    crate::services::reset_keybinds_default()
}

#[tauri::command]
fn get_available_keyarts() -> Value {
    crate::services::get_available_keyarts()
}

#[tauri::command]
fn open_keyarts_folder() -> Value {
    let path = crate::services::open_keyarts_folder();
    json!({ "path": path })
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Window Controls Commands
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn window_minimize(window: Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn window_maximize(window: Window) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
        let _ = window.emit("window-maximize-change", false);
    } else {
        let _ = window.maximize();
        let _ = window.emit("window-maximize-change", true);
    }
}

#[tauri::command]
fn window_close(window: Window) {
    let _ = window.close();
}

#[tauri::command]
fn window_is_maximized(window: Window) -> bool {
    window.is_maximized().unwrap_or(false)
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Skins & Capes Commands
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn select_skin_file(app: AppHandle) -> Value {
    use tauri_plugin_dialog::DialogExt;
    if let Some(file_path) = app
        .dialog()
        .file()
        .add_filter("PNG Skin", &["png"])
        .blocking_pick_file()
    {
        if let Some(path) = file_path.as_path() {
            let data_url = crate::skin::file_to_data_url(path).unwrap_or_default();
            return json!({
                "canceled": false,
                "filePath": path.to_string_lossy(),
                "dataUrl": data_url
            });
        }
    }
    json!({ "canceled": true })
}

#[tauri::command]
fn select_cape_file(app: AppHandle) -> Value {
    use tauri_plugin_dialog::DialogExt;
    if let Some(file_path) = app
        .dialog()
        .file()
        .add_filter("PNG Cape", &["png"])
        .blocking_pick_file()
    {
        if let Some(path) = file_path.as_path() {
            let data_url = crate::skin::file_to_data_url(path).unwrap_or_default();
            return json!({
                "canceled": false,
                "filePath": path.to_string_lossy(),
                "dataUrl": data_url
            });
        }
    }
    json!({ "canceled": true })
}

#[tauri::command]
fn save_offline_skin(skin_data: Value) -> Value {
    let base_dir = crate::config::get_default_game_dir();
    let skin_path = base_dir.join("assets").join("selfnametag_skin.png");
    if let Some(parent) = skin_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let raw_str = if let Some(s) = skin_data.as_str() {
        s
    } else if let Some(s) = skin_data.get("dataUrl").and_then(|v| v.as_str()) {
        s
    } else {
        ""
    };

    if raw_str.contains("base64,") {
        let b64 = raw_str.split("base64,").nth(1).unwrap_or("");
        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64.trim()) {
            let _ = std::fs::write(&skin_path, bytes);
            return json!({ "success": true, "path": skin_path.to_string_lossy() });
        }
    }
    json!({ "success": true })
}

#[tauri::command]
async fn get_mojang_profile() -> Value {
    match crate::skin::get_mojang_profile_data().await {
        Ok(v) => v,
        Err(e) => json!({ "success": false, "error": e }),
    }
}

#[tauri::command]
async fn upload_mojang_skin(file_path: String, variant: Option<String>) -> Value {
    crate::skin::upload_custom_skin_file(&file_path, variant.as_deref().unwrap_or("classic")).await
}

#[tauri::command]
async fn reset_mojang_skin() -> Value {
    crate::skin::reset_skin_to_default().await
}

#[tauri::command]
async fn set_mojang_cape(cape_id: Option<String>) -> Value {
    crate::skin::set_mojang_active_cape(cape_id.as_deref()).await
}

#[tauri::command]
fn save_dragged_skin(file_path: String) -> Value {
    let base_dir = crate::config::get_default_game_dir();
    let skin_dest = base_dir.join("assets").join("selfnametag_skin.png");
    if let Some(parent) = skin_dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let src = PathBuf::from(&file_path);
    if src.exists() {
        if std::fs::copy(&src, &skin_dest).is_ok() {
            return json!({ "success": true, "path": skin_dest.to_string_lossy() });
        }
    }
    json!({ "success": false, "error": "Soubor se nepodařilo zkopírovat." })
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Warden Anticheat & Crash Auto-Fix Commands
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn check_warden_probe(profile_id: Option<String>) -> Value {
    crate::warden::scan_profile_mods_warden(profile_id.as_deref())
}

#[tauri::command]
fn disable_illegal_mods(profile_id: Option<String>, filename: Option<String>) -> Value {
    if let Some(f) = filename {
        crate::warden::disable_illegal_mod(profile_id.as_deref(), &f)
    } else {
        crate::warden::disable_all_illegal_mods(profile_id.as_deref())
    }
}

#[tauri::command]
async fn apply_crash_fix(
    app: AppHandle,
    auto_fix: Value,
    profile_id: Option<String>,
) -> Value {
    crate::crash::apply_crash_fix(Some(&app), &auto_fix, profile_id.as_deref()).await
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. System Services, RPC, Updater & Diagnostics
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn scan_launcher_cache() -> Value {
    crate::services::scan_launcher_cache()
}

#[tauri::command]
fn clean_launcher_cache() -> Value {
    crate::services::clean_launcher_cache()
}

#[tauri::command]
async fn check_for_updates() -> Value {
    crate::services::check_for_updates().await
}

#[tauri::command]
async fn apply_update(app: AppHandle, asset_url: String) -> Value {
    crate::services::apply_update(Some(&app), &asset_url).await
}

#[tauri::command]
fn restart_launcher(app: AppHandle) {
    app.restart();
}

#[tauri::command]
fn check_audio_dlc() -> Value {
    let base = crate::config::get_default_game_dir();
    crate::launcher::check_audio_dlc(&base, "26.3")
}

#[tauri::command]
async fn download_audio_dlc(app: AppHandle) -> Value {
    let base = crate::config::get_default_game_dir();
    let manifest = match crate::launcher::fetch_or_cache_mojang_manifest(&base, "26.3").await {
        Ok(m) => m,
        Err(e) => return json!({ "success": false, "error": format!("Chyba manifestu: {}", e) }),
    };

    let app_clone = app.clone();
    if let Some(ref asset_ref) = manifest.asset_index {
        let res = crate::launcher::ensure_assets(&base, asset_ref, true, move |pct, text| {
            let _ = app_clone.emit("audio-dlc-progress", json!({ "percent": pct, "text": text }));
        })
        .await;
        match res {
            Ok(_) => json!({ "success": true }),
            Err(e) => json!({ "success": false, "error": format!("Chyba stahování zvuků: {}", e) }),
        }
    } else {
        json!({ "success": false, "error": "Manifest neobsahuje index assetů." })
    }
}

#[tauri::command]
fn cancel_audio_dlc() -> bool {
    crate::launcher::cancel_audio_dlc()
}

#[tauri::command]
fn get_system_info() -> Value {
    crate::services::get_system_info()
}

#[tauri::command]
fn open_game_dir() {
    let base = crate::config::get_default_game_dir();
    let _ = open::that_detached(base);
}

#[tauri::command]
fn open_url(url: String) {
    let _ = open::that_detached(&url);
}

#[tauri::command]
fn copy_to_clipboard(text: String) -> bool {
    crate::services::copy_to_clipboard(&text)
}

#[tauri::command]
fn get_latest_game_log() -> Value {
    let base = crate::config::get_default_game_dir();
    let tail = crate::crash::read_latest_log_tail(&base, 1000);
    json!({ "log": tail })
}

#[tauri::command]
fn open_log_in_editor() -> Value {
    let base = crate::config::get_default_game_dir();
    let log_path = base.join("logs").join("latest.log");
    if log_path.exists() {
        let _ = open::that_detached(&log_path);
        json!({ "success": true, "path": log_path.to_string_lossy() })
    } else {
        json!({ "success": false, "error": "Soubor latest.log zatím neexistuje." })
    }
}

#[tauri::command]
fn open_logs_folder() {
    let base = crate::config::get_default_game_dir();
    let logs_dir = base.join("logs");
    if !logs_dir.exists() {
        let _ = std::fs::create_dir_all(&logs_dir);
    }
    let _ = open::that_detached(&logs_dir);
}

#[tauri::command]
fn download_log_mog(app: AppHandle, custom_text: Option<String>) -> Value {
    use tauri_plugin_dialog::DialogExt;
    let base = crate::config::get_default_game_dir();
    let text = custom_text.unwrap_or_else(|| crate::crash::read_latest_log_tail(&base, 2000));
    let now = chrono::Utc::now().format("%Y-%m-%d-%H%M%S").to_string();
    let default_name = format!("mychalsmp-log-{}.mog", now);

    if let Some(file_path) = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("Mychal Log", &["mog"])
        .blocking_save_file()
    {
        if let Some(path) = file_path.as_path() {
            if std::fs::write(path, text.as_bytes()).is_ok() {
                return json!({ "success": true, "path": path.to_string_lossy() });
            }
        }
    }
    json!({ "success": false, "canceled": true })
}

#[tauri::command]
fn download_log_myco(app: AppHandle, custom_text: Option<String>) -> Value {
    use tauri_plugin_dialog::DialogExt;
    let base = crate::config::get_default_game_dir();
    let text = custom_text.unwrap_or_else(|| crate::crash::read_latest_log_tail(&base, 2000));
    let now = chrono::Utc::now().format("%Y-%m-%d-%H%M%S").to_string();
    let default_name = format!("mychalsmp-log-{}.myco", now);

    if let Some(file_path) = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("MYCO Log", &["myco"])
        .blocking_save_file()
    {
        if let Some(path) = file_path.as_path() {
            if std::fs::write(path, text.as_bytes()).is_ok() {
                return json!({ "success": true, "path": path.to_string_lossy() });
            }
        }
    }
    json!({ "success": false, "canceled": true })
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. Screenshots Gallery Commands
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_profile_screenshots(profile_id: Option<String>) -> Value {
    crate::services::get_profile_screenshots(profile_id.as_deref())
}

#[tauri::command]
fn copy_screenshot_to_clipboard(full_path: String) -> Value {
    crate::services::copy_screenshot_to_clipboard(&full_path)
}

#[tauri::command]
fn delete_screenshot(full_path: String) -> Value {
    crate::services::delete_screenshot(&full_path)
}

#[tauri::command]
fn open_file_path(full_path: String) -> Value {
    crate::services::open_file_path(&full_path)
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. Resource Packs & Shaders Commands
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_profile_packs(profile_id: Option<String>, pack_type: String) -> Value {
    crate::mods::get_profile_packs_list(profile_id.as_deref(), &pack_type)
}

#[tauri::command]
fn toggle_profile_pack(
    profile_id: Option<String>,
    pack_type: String,
    filename: String,
) -> Value {
    crate::mods::toggle_profile_pack_file(profile_id.as_deref(), &pack_type, &filename)
}

#[tauri::command]
fn delete_profile_pack(
    profile_id: Option<String>,
    pack_type: String,
    filename: String,
) -> Value {
    crate::mods::delete_profile_pack_file(profile_id.as_deref(), &pack_type, &filename)
}

// ─────────────────────────────────────────────────────────────────────────────
// 14. Tauri v2 Application Runner
// ─────────────────────────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.emit("window-restored-from-tray", ());
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            ping_server,
            login_offline,
            login_microsoft,
            launch_game,
            kill_game,
            cancel_launch,
            is_game_running,
            get_active_session,
            detect_java,
            get_available_javas,
            get_installed_versions,
            preload_launch_environment,
            search_modrinth,
            download_mod_or_pack,
            check_profile_mod_updates,
            toggle_mod,
            get_profile_mods,
            toggle_profile_mod,
            delete_profile_mod,
            resolve_mod_collisions,
            discover_installed_profiles,
            import_profile_dialog,
            confirm_import_profile,
            upgrade_profile,
            open_profile_folder,
            update_profile_settings,
            delete_profile,
            reset_launcher_data,
            generate_profile_seed,
            import_profile_seed,
            duplicate_profile,
            apply_profile_optimization,
            check_optimization_status,
            get_keybinds,
            save_keybinds,
            reset_keybinds_default,
            get_available_keyarts,
            open_keyarts_folder,
            window_minimize,
            window_maximize,
            window_close,
            window_is_maximized,
            select_skin_file,
            select_cape_file,
            save_offline_skin,
            get_mojang_profile,
            upload_mojang_skin,
            reset_mojang_skin,
            set_mojang_cape,
            save_dragged_skin,
            check_warden_probe,
            disable_illegal_mods,
            apply_crash_fix,
            scan_launcher_cache,
            clean_launcher_cache,
            check_for_updates,
            apply_update,
            restart_launcher,
            check_audio_dlc,
            download_audio_dlc,
            cancel_audio_dlc,
            get_system_info,
            open_game_dir,
            open_url,
            copy_to_clipboard,
            get_latest_game_log,
            open_log_in_editor,
            open_logs_folder,
            download_log_mog,
            download_log_myco,
            get_profile_screenshots,
            copy_screenshot_to_clipboard,
            delete_screenshot,
            open_file_path,
            get_profile_packs,
            toggle_profile_pack,
            delete_profile_pack
        ])
        .setup(|_app| {
            let _ = crate::config::load_config();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
