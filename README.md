<p align="center">
  <img src="src/renderer/assets/logo.png" alt="SMPClient Logo" width="88">
</p>

<h1 align="center">SMPClient</h1>

<p align="center">
  Oficiální multiplatformní Minecraft launcher pro síť <strong>MYCHAL SMP</strong>.<br>
  Postaveno na nativním backendu <strong>Rust &amp; Tauri v2</strong> a čistém HTML/CSS/JS rozhraní pro Linux a Windows.
</p>

<p align="center">
  <a href="https://join.mychalsmp.xyz"><img src="https://img.shields.io/badge/Server-mychalsmp.xyz-0a67e5?style=flat-square" alt="Server mychalsmp.xyz"></a>
  <a href="#"><img src="https://img.shields.io/badge/Verze_launcheru-1.7.24-18181c?style=flat-square" alt="Verze 1.7.24"></a>
  <a href="#"><img src="https://img.shields.io/badge/Doporučený_Minecraft-26.3-21de00?style=flat-square" alt="Minecraft 26.3"></a>
  <a href="#"><img src="https://img.shields.io/badge/Stack-Rust_%2B_Tauri_v2-0a67e5?style=flat-square" alt="Rust + Tauri v2"></a>
</p>

---

## Přehled

**SMPClient** spravuje instalace Minecraftu, herní profily, módy z Modrinthu, skiny, pláště i optimalizaci spuštění přímo z nativní desktopové aplikace bez přibalování Chromium/Node.js runtime.

Podporované systémy:
- **Linux:** CachyOS, Arch Linux, Fedora, Ubuntu, Debian, Linux Mint, openSUSE (Wayland i X11)
- **Windows:** Windows 10 a Windows 11 (x64, WebView2 + NSIS instalátor)

---

## Architektura a funkce

### Jádro spouštění a správa knihoven
- **Izolované nativní knihovny (`launcher.rs`):** Každý profil rozbaluje nativní soubory LWJGL striktně podle svého manifestu a architektury do odděleného adresáře s kontrolním `.natives-stamp` otiskem, aby se nemíchaly verze napříč instalacemi Minecraftu.
- **Ověření integrity a SHA-1:** Kontrola klientských JARů a knihoven před spuštěním včetně ochrany proti souborovým zámkům (`resilient_rename` s opakovanými pokusy na Windows).
- **Hardwarově řízený tuning (`services.rs`, `drm_vblank.rs`):** Automatická detekce GPU (NVIDIA / AMD / Intel), typu session (Wayland / X11), dostupnosti `gamemoderun`, Vulkan/Zink přepínačů a systémové RAM pro nastavení JVM (ZGC, custom argumenty).
- **Identifikace klienta (`mods.rs`):** Automatická synchronizace `selfnametag-1.0.0.jar` pro Fabric a bootclasspath brandingu `smpclient-brand.jar` pro Vanilla profily.

### Profily, zálohy a Modrinth katalog
- **Správa profilů (`profiles.rs`):** Vytváření nezávislých instancí (verze, mod loader `Vanilla` / `Fabric` / `NeoForge` / `Forge`, vyhrazená RAM, vlastní JVM parametry, ikona), klonování a automatické vyhledání existujících instancí na disku.
- **Import, export a zálohy:** Podpora balíčků `.smppack`, komunitních Modrinth modpacků (`.mrpack`) a lokálních ZIP snímků profilů i světů.
- **Modrinth katalog (`mods.rs`):** Vyhledávání módů, shaderů a resource packů filtrovaných podle verze a loaderu, instalace závislostí (např. Fabric API), hromadné aktualizace a přepínání `.jar` ↔ `.jar.disabled`.

### Účty, skiny a diagnostika pádů
- **Microsoft & Offline účty (`auth.rs`, `vault.rs`):** Přihlašování přes Microsoft OAuth i lokální offline profily. Přístupové tokeny jsou uložené zašifrovaně pomocí **AES-256-GCM** a klíče odvozeného přes **PBKDF2-HMAC-SHA256** navázaného na identifikátor zařízení; frontend nikdy nečte surové tokeny.
- **3D náhled a správa skinů (`skin.rs`):** Interaktivní 3D prohlížeč (`skinview3d`), přepínání modelu (`Classic` / `Slim`), nahrání vlastního PNG skinu na Mojang účet i pro offline profil (výběr souboru nebo Drag & Drop) a správa Mojang plášťů.
- **Crash Analyzer & Auto-Opravy (`crash.rs`):** Rozbor logů `latest.log`, `crash-reports/*.txt` a `hs_err_pid*.log` — detekce OOM, neshody verzí Javy, chybějících závislostí, kolizí Mixinů, poškozeného client JARu nebo nekompatibilních nativních knihoven LWJGL s návaznou automatickou opravou.
- **Live Server Tracker & Auto-Updater (`ping.rs`, `services.rs`):** Asynchronní TCP/SLP stav serverů `mychalsmp.xyz` a `pvp.mychalsmp.xyz`, 1-click připojení přes `--quickPlayMultiplayer` a aktualizace binárky přímo z GitHub Releases.

---

## Podporované verze Minecraftu

| Verze | Doporučení | Poznámka |
| :--- | :--- | :--- |
| `26.3` | Doporučeno | Primární podporovaná verze sítě MYCHAL SMP |
| `26.2` | Podporováno | Plná kompatibilita přes multi-version ProtocolBridge |
| `26.1.2` | Podporováno | Starší stabilní větev kompatibilní s ProtocolBridge |
| `1.21.11` | Podporováno | Stabilní verze 1.21 |
| `26.4` | Coming Soon | Připravený placeholder v seznamu profilů (zatím nelze spustit) |

---

## Struktura projektu

```text
mychalsmp-launcher/
├── src/renderer/           # Vanilla HTML, CSS (Matte Obsidian), JS & skinview3d UI
├── src-tauri/
│   ├── tauri.conf.json     # Tauri v2 konfigurace & NSIS bundle nastavení
│   ├── capabilities/       # Oprávnění Tauri oken, dialogů a asset protokolu
│   └── src/
│       ├── auth.rs         # Microsoft OAuth & offline session logika
│       ├── config.rs       # Výchozí profily, servery a persistence konfigurace
│       ├── crash.rs        # Analyzátor pádů a automatické opravy
│       ├── drm_vblank.rs   # Detekce obnovovací frekvence a DRM na Linuxu
│       ├── launcher.rs     # Stahování manifestů, knihoven, izolace natives & spuštění JVM
│       ├── lib.rs          # Tauri v2 příkazy, tray a asynchronní dialogy
│       ├── mods.rs         # Modrinth API, správa módů/packů a selfnametag/brand sync
│       ├── ping.rs         # SLP server status ping
│       ├── profiles.rs     # Profily, klonování, .mrpack/.smppack & zálohy
│       ├── services.rs     # HW detekce, cache cleaner, Discord RPC & auto-updater
│       ├── skin.rs         # PNG validace, Mojang API skiny/pláště & offline sync
│       ├── vault.rs        # Lokální AES-256-GCM úložiště tokenů
│       └── warden.rs       # Kontrola kompatibility modifikací prostředí
├── install.sh              # Univerzální Linux instalátor
├── install-cachyos.sh      # Instalátor pro CachyOS / Arch Linux
├── install.ps1             # PowerShell instalátor pro Windows
├── PKGBUILD                # Balíček pro Arch / makepkg
└── release.sh              # Skript pro synchronizaci verzí a vydání
```

---

## Instalace

### Linux

**Univerzální instalátor (Arch / CachyOS / Fedora / Ubuntu / Debian):**
```bash
curl -sSfL https://join.mychalsmp.xyz/install.sh | bash
```

**Lokální skripty v repozitáři:**
- CachyOS / Arch Linux: `./install-cachyos.sh` nebo sestavení přes přiložený `PKGBUILD` (`makepkg -si`).
- Obecný Linux instalátor: `./install.sh`

### Windows 10 / 11

- Spusť instalátor `SMPClient_*_x64-setup.exe` (NSIS) z GitHub Releases nebo instalační skript `install.ps1`.
- Požaduje systémový Microsoft Edge WebView2 Runtime (součást Windows 11).

---

## Vývoj a sestavení

### Požadavky
- **Rust Toolchain** (`rustup`, `cargo >= 1.77.2`)
- **Node.js** (`>= 20`) pro `@tauri-apps/cli`
- **Systémové knihovny na Linuxu:**
  - *CachyOS / Arch:* `sudo pacman -S webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg xdotool`
  - *Fedora:* `sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel libxdo-devel`
  - *Ubuntu / Debian:* `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

### Příkazy
```bash
# Instalace Tauri CLI
npm install

# Vývojový režim
npm start

# Spuštění unit testů Rust backendu
cargo test --manifest-path src-tauri/Cargo.toml

# Sestavení Linux binárky (--no-bundle)
npm run build:linux

# Sestavení Windows NSIS instalátoru (.exe)
npm run build:win
```

---

## Síť a kontakt

- **IP adresa herního serveru:** `mychalsmp.xyz`
- **Web:** [join.mychalsmp.xyz](https://join.mychalsmp.xyz)
- **Správa projektu:** `mychalVidea` ([admin@mychalsmp.xyz](mailto:admin@mychalsmp.xyz))
