use crate::config::{load_config, resolve_profile_dir};
use serde_json::{json, Value};
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;
use zip::ZipArchive;

struct ProhibitedRule {
    pattern: &'static str,
    name: &'static str,
    category: &'static str,
    severity: &'static str,
    reason: &'static str,
}

const PROHIBITED_RULES: &[ProhibitedRule] = &[
    ProhibitedRule { pattern: "meteor-client", name: "Meteor Client", category: "Hacked Client", severity: "CRITICAL", reason: "Plnohodnotný cheat klient zakázaný anticheatem Warden." },
    ProhibitedRule { pattern: "meteordev", name: "Meteor Client / Addon", category: "Hacked Client", severity: "CRITICAL", reason: "Detekovány interní balíčky Meteor Clientu." },
    ProhibitedRule { pattern: "wurst", name: "Wurst Client", category: "Hacked Client", severity: "CRITICAL", reason: "Plnohodnotný cheat klient zakázaný anticheatem Warden." },
    ProhibitedRule { pattern: "aristois", name: "Aristois", category: "Hacked Client", severity: "CRITICAL", reason: "Plnohodnotný cheat klient zakázaný anticheatem Warden." },
    ProhibitedRule { pattern: "liquidbounce", name: "LiquidBounce", category: "Hacked Client", severity: "CRITICAL", reason: "Plnohodnotný cheat klient zakázaný anticheatem Warden." },
    ProhibitedRule { pattern: "thunderhack", name: "ThunderHack", category: "Hacked Client", severity: "CRITICAL", reason: "PvP/HvH cheat klient zakázaný anticheatem Warden." },
    ProhibitedRule { pattern: "bleachhack", name: "BleachHack", category: "Hacked Client", severity: "CRITICAL", reason: "Cheat klient zakázaný anticheatem Warden." },
    ProhibitedRule { pattern: "doomsday", name: "Doomsday Client", category: "Ghost Client", severity: "CRITICAL", reason: "Skrytý Ghost/Injection klient zakázaný na MYCHAL SMP." },
    ProhibitedRule { pattern: "prestige", name: "Prestige Client", category: "Ghost Client", severity: "CRITICAL", reason: "Ghost PvP klient (AutoCrystal/TriggerBot) zakázaný na MYCHAL SMP." },
    ProhibitedRule { pattern: "grimclient", name: "Grim Client", category: "Hacked Client", severity: "CRITICAL", reason: "Cheat klient zakázaný anticheatem Warden." },
    ProhibitedRule { pattern: "rusherhack", name: "RusherHack", category: "Hacked Client", severity: "CRITICAL", reason: "Cheat klient zakázaný anticheatem Warden." },
    ProhibitedRule { pattern: "futureclient", name: "Future Client", category: "Hacked Client", severity: "CRITICAL", reason: "Cheat klient zakázaný anticheatem Warden." },
    ProhibitedRule { pattern: "baritone", name: "Baritone Autominer", category: "Automation / Bot", severity: "CRITICAL", reason: "Automatické těžební a pathfinding boty jsou přísně zakázány." },
    ProhibitedRule { pattern: "fabritone", name: "Fabritone", category: "Automation / Bot", severity: "CRITICAL", reason: "Automatické těžební boty jsou přísně zakázány." },
    ProhibitedRule { pattern: "xray", name: "X-Ray Mod", category: "World Exploit", severity: "HIGH", reason: "Průhlednost bloků a vyhledávání rud je zakázáno." },
    ProhibitedRule { pattern: "advanced-xray", name: "Advanced XRay", category: "World Exploit", severity: "HIGH", reason: "Vyhledávání rud přes stěny je zakázáno." },
    ProhibitedRule { pattern: "seedcracker", name: "SeedCrackerX", category: "World Exploit", severity: "CRITICAL", reason: "Zjišťování seedu světa pro hledání struktur a rud je zakázáno." },
    ProhibitedRule { pattern: "freecam", name: "Freecam", category: "Fair-Play Exploit", severity: "HIGH", reason: "Volná kamera pro procházení zdí a hledání bází/jeskyní je zakázána." },
    ProhibitedRule { pattern: "chestesp", name: "ChestESP / StorageESP", category: "ESP / Wallhack", severity: "HIGH", reason: "Zobrazování truhel a entit přes bloky je zakázáno." },
    ProhibitedRule { pattern: "playeresp", name: "PlayerESP", category: "ESP / Wallhack", severity: "HIGH", reason: "Viditelnost hráčů přes stěny je zakázána." },
    ProhibitedRule { pattern: "killaura", name: "KillAura", category: "Combat Cheat", severity: "CRITICAL", reason: "Automatický útok na entity a hráče je zakázán." },
    ProhibitedRule { pattern: "autoclicker", name: "AutoClicker", category: "Combat Cheat", severity: "HIGH", reason: "Automatické klikání a makra v soubojích jsou zakázána." },
    ProhibitedRule { pattern: "triggerbot", name: "TriggerBot", category: "Combat Cheat", severity: "CRITICAL", reason: "Automatické útočení při zaměření hráče je zakázáno." },
    ProhibitedRule { pattern: "aimassist", name: "AimAssist / Aimbot", category: "Combat Cheat", severity: "CRITICAL", reason: "Asistence míření v PvP je zakázána." },
    ProhibitedRule { pattern: "autototem", name: "AutoTotem", category: "Combat Cheat", severity: "CRITICAL", reason: "Automatické doplňování totemu do ruky je zakázáno." },
    ProhibitedRule { pattern: "cw-crystal", name: "Crystal Macro / Optimizer Exploit", category: "Combat Cheat", severity: "HIGH", reason: "Zakázané krystalové makro." },
    ProhibitedRule { pattern: "invwalk", name: "Inventory Walk / InvMove", category: "Movement Cheat", severity: "HIGH", reason: "Pohyb s otevřeným inventářem je anticheatem Warden blokován." },
    ProhibitedRule { pattern: "invmove", name: "InvMove", category: "Movement Cheat", severity: "HIGH", reason: "Pohyb s otevřeným inventářem je anticheatem Warden blokován." },
    ProhibitedRule { pattern: "tweakeroo", name: "Tweakeroo", category: "Fair-Play Exploit", severity: "MEDIUM", reason: "Obsahuje Freecam, FakeSneak a FastBlockPlacement blokované anticheatem." },
];

fn inspect_mod_jar(path: &Path, filename: &str) -> Option<Value> {
    let lower_fname = filename.to_lowercase();
    for rule in PROHIBITED_RULES {
        if lower_fname.contains(rule.pattern) {
            return Some(json!({
                "filename": filename,
                "name": rule.name,
                "modId": rule.pattern,
                "category": rule.category,
                "severity": rule.severity,
                "reason": rule.reason
            }));
        }
    }

    let file = File::open(path).ok()?;
    let mut archive = ZipArchive::new(file).ok()?;

    // Check fabric.mod.json
    if let Ok(mut mod_json_file) = archive.by_name("fabric.mod.json") {
        let mut content = String::new();
        if mod_json_file.read_to_string(&mut content).is_ok() {
            let lower_content = content.to_lowercase();
            let parsed = serde_json::from_str::<Value>(&content).ok();
            let mod_id = parsed
                .as_ref()
                .and_then(|v| v.get("id"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            let mod_name = parsed
                .as_ref()
                .and_then(|v| v.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or(filename);

            for rule in PROHIBITED_RULES {
                if mod_id == rule.pattern
                    || mod_id.contains(rule.pattern)
                    || lower_content.contains(&format!("\"{}\"", rule.pattern))
                {
                    return Some(json!({
                        "filename": filename,
                        "name": format!("{} ({})", rule.name, mod_name),
                        "modId": if mod_id.is_empty() { rule.pattern.to_string() } else { mod_id },
                        "category": rule.category,
                        "severity": rule.severity,
                        "reason": rule.reason
                    }));
                }
            }
        }
    }

    // Check class entries for known hack package namespaces
    let len = archive.len().min(600);
    for i in 0..len {
        if let Ok(entry) = archive.by_index(i) {
            let entry_name = entry.name().to_lowercase();
            if entry_name.starts_with("meteordev/meteorclient")
                || entry_name.starts_with("net/wurstclient")
                || entry_name.starts_with("net/ccbluex/liquidbounce")
                || entry_name.starts_with("baritone/api")
                || entry_name.contains("seedcracker")
            {
                for rule in PROHIBITED_RULES {
                    if entry_name.contains(rule.pattern.replace('-', "").as_str())
                        || entry_name.contains(rule.pattern)
                    {
                        return Some(json!({
                            "filename": filename,
                            "name": rule.name,
                            "modId": rule.pattern,
                            "category": rule.category,
                            "severity": rule.severity,
                            "reason": rule.reason
                        }));
                    }
                }
            }
        }
    }

    None
}

pub fn scan_profile_mods_warden(profile_id: Option<&str>) -> Value {
    let cfg = load_config();
    let prof_dir = resolve_profile_dir(&cfg, profile_id);
    let mods_dir = prof_dir.join("mods");

    if !mods_dir.exists() {
        return json!({
            "clean": true,
            "scannedCount": 0,
            "violations": []
        });
    }

    let mut scanned_count = 0usize;
    let mut violations = Vec::new();

    if let Ok(entries) = fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            // Only scan active .jar files (ignore .jar.disabled)
            if !fname.to_lowercase().ends_with(".jar") {
                continue;
            }
            scanned_count += 1;
            if let Some(v) = inspect_mod_jar(&entry.path(), &fname) {
                violations.push(v);
            }
        }
    }

    json!({
        "clean": violations.is_empty(),
        "scannedCount": scanned_count,
        "violations": violations
    })
}

pub fn disable_illegal_mod(profile_id: Option<&str>, filename: &str) -> Value {
    let cfg = load_config();
    let prof_dir = resolve_profile_dir(&cfg, profile_id);
    let mods_dir = prof_dir.join("mods");

    let safe_name = Path::new(filename)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    if safe_name.is_empty() {
        return json!({ "success": false, "error": "Neplatný název souboru." });
    }

    let target = mods_dir.join(&safe_name);
    if !target.exists() {
        return json!({ "success": false, "error": "Soubor již neexistuje." });
    }

    let disabled = mods_dir.join(format!("{}.disabled", safe_name));
    match crate::mods::resilient_rename(&target, &disabled) {
        Ok(_) => json!({ "success": true, "disabledFile": format!("{}.disabled", safe_name) }),
        Err(e) => json!({ "success": false, "error": e }),
    }
}

pub fn disable_all_illegal_mods(profile_id: Option<&str>) -> Value {
    let scan = scan_profile_mods_warden(profile_id);
    let mut disabled_count = 0usize;
    if let Some(violations) = scan.get("violations").and_then(|v| v.as_array()) {
        for v in violations {
            if let Some(fname) = v.get("filename").and_then(|x| x.as_str()) {
                let res = disable_illegal_mod(profile_id, fname);
                if res.get("success").and_then(|x| x.as_bool()) == Some(true) {
                    disabled_count += 1;
                }
            }
        }
    }
    json!({
        "success": true,
        "disabledCount": disabled_count
    })
}

