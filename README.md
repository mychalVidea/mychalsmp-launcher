# <p align="center"><img src="src/renderer/assets/logo.png" alt="SMPClient Logo" width="96"><br>SMPClient v1.7.0</p>

<p align="center">
  <strong>Oficiální prémiový multiplatformní Minecraft klient vytvořený na míru pro komunitu a síť MYCHAL SMP.</strong><br>
  <sub>Postaveno na nativním jádru <strong>Rust & Tauri v2</strong> — 16 MB binárka, okamžitý start pod 150 ms a nulový Electron bloat.</sub>
</p>

<p align="center">
  <a href="https://mychalsmp.xyz"><img src="https://img.shields.io/badge/Server-mychalsmp.xyz-0a67e5?style=for-the-badge&logo=minecraft" alt="Server IP"></a>
  <a href="#"><img src="https://img.shields.io/badge/Doporučená_verze-26.3-21de00?style=for-the-badge" alt="Doporučená verze 26.3"></a>
  <a href="#"><img src="https://img.shields.io/badge/Jádro-Rust_%26_Tauri_v2-0a67e5?style=for-the-badge&logo=rust" alt="Rust & Tauri v2"></a>
  <a href="#"><img src="https://img.shields.io/badge/Platformy-Linux_%7C_Windows_11-18181c?style=for-the-badge&logo=linux" alt="Platformy"></a>
</p>

---

## 🌟 O SMPClientu (Nativní Rust & Tauri v2 Edice)

**SMPClient** prošel kompletním přepisem z původního Electronu do **100% nativního Rustu a Tauri v2**. Místo přibalování celého 250MB prohlížeče Chromium a Node.js je celý backend i herní suverénní orchestrátor zkompilovaný přímo do jediné nativní strojové binárky (~16 MB, v komprimovaném `.tar.gz` update balíčku jen **~6 MB**).

Launcher plně podporuje **všechny distribuce Linuxu** (**CachyOS, Arch Linux, Fedora, Nobara, Ubuntu, Debian, Linux Mint, openSUSE**) i **Windows 10/11**.

---

## ✨ Klíčové funkce

### 🦀 Nativní Rust Backend & Bleskový Auto-Updater
* **Ultralehký `.tar.gz` Auto-Updater (~6 MB):** Na rozdíl od starého Electronu (kde `.asar` aktualizoval jen JavaScript, ale samotný 200MB runtime zůstával starý) je v Tauri v2 kompletní UI i celý Rust backend zapečený přímo do jediné zkompilované binárky. Bleskový auto-updater stáhne jen ~6MB `.tar.gz` balíček, přímo v paměti ho přes `flate2` + `tar` rozbalí a atomicky vymění binárku za běhu bez nutnosti cokoliv přeinstalovávat.
* **Nativní trezor účtů (`vault.rs`):** Hardwarově vázané šifrování přihlašovacích tokenů pomocí **AES-256-GCM** a **PBKDF2-HMAC-SHA256** (100 000 iterací) vázané na `/etc/machine-id` (Linux) nebo `MachineGuid` (Windows). Renderer nikdy nemá přístup k raw tokenům.
* **Ochrana proti EBUSY zámkům (Windows Defender / Antiviry):** Exponenciální retry smyčka při stahování a přejmenovávání knihoven zabraňuje pádům spouštění hry na Windows.
* **Automatická verifikace a oprava Vanilla JARu:** Kontrola SHA-1 otisků a velikosti klientského `.jar` souboru před každým startem s automatickým pře-stažením poškozeného archivu.

### 🎛️ Profile Management Studio & Modpack Engine
* **Kompletní správa herních profilů:** Vlastní nezávislé instance s volbou verze Minecraftu (`26.3`, `26.2`, `26.1.2`, `1.21.11`), loaderu (`Fabric` / `Vanilla`), vyhrazené RAM, vlastních JVM argumentů a ikon.
* **Klonování, zálohování a přenos (`.smppack` / `.mrpack`):**
  * **1-Click Klonování profilu:** Kompletní hloubková kopie nastavení, módů, shaderů a resourcepacků.
  * **ZIP Zálohy (Snapshots):** Vytváření a obnova časových snímků profilu jedním kliknutím.
  * **Import & Export:** Plná podpora exportu do `.smppack` a přímého importu komunitních **Modrinth (`.mrpack`)** modpacků včetně paralelního stažení všech závislostí.
* **Chytrá správa světa a screenshotů:** Přehled světů (velikost, datum posledního hraní, rychlé otevření složky, záloha do ZIPu) a integrovaná galerie screenshotů přímo v detailu profilu.

### ⚡ Extrémní FPS & 1-Click Herní optimalizace
* **Přednastavený Fabric loader:** Automatické nasazení a správa moderního zavaděče módů včetně automatického sloučení konfigurace s Mojang manifestem.
* **Sodium + Iris + Lithium:** Jedním kliknutím nainstaluje a nakonfiguruje nejvýkonnější optimalizační modifikace s automatickým hlídáním vzájemné kompatibility verzí Sodium a Iris.
* **Vyladěné JVM argumenty:** Nativní detekce dostupné systémové paměti (`sysinfo`) a automatická konfigurace moderního Garbage Collectoru (**Generational ZGC**).

### 🧩 Integrovaný Modrinth Store
* **Prohlížeč módů, shaderů a resourcepacků přímo v aplikaci:** Okamžité vyhledávání a instalace z platformy Modrinth.
* **Chytré řešení závislostí:** Automatická detekce a stažení vyžadovaných knihoven (např. *Fabric API*) pro příslušnou verzi hry.
* **Správa nainstalovaných doplňků:** Rychlé zapínání/vypínání módů (`.jar` ↔ `.jar.disabled`) a bezpečné mazání přímo z rozhraní profilu.

### 🛡️ Hloubkový Crash Analyzer & Warden Integrace
* **Detekce konkrétního viníka v Mixinech (`crash.rs`):** Analyzátor čte kompletní stacktrace i `hs_err_pid` logy, rozklíčuje kaskádové chyby Mixinů (`MixinApplyError`, `MixinTransformerError`), odfiltruje interní knihovny Fabric API a přesně označí konkrétní nekompatibilní mód s tlačítkem pro jeho okamžité vypnutí.
* **Warden Probe Checker (`warden.rs`):** Nativní kontrola integrity prostředí a modifikací před připojením na server.

### 🌐 Živý Server Tracker & 1-Click Join
* **Nativní Tokio TCP & SLP Ping (`ping.rs`):** Asynchronní měření odezvy (RTT), čtení MOTD, počtu online hráčů a stavu sítě `mychalsmp.xyz` a `pvp.mychalsmp.xyz`.
* **Přímé připojení do hry:** Tlačítko pro okamžité spuštění hry rovnou na zvolený server (`--quickPlayMultiplayer`).

### 🐧 Nativní Linux Gaming Integrace
* **Feral GameMode:** Automatické využití `gamemoderun` pro maximální prioritu CPU a GPU.
* **Wayland & X11 + Zink:** Podpora nativního běhu i akcelerace OpenGL přes Vulkan (`Zink`).
* **Dedikovaná GPU:** Přepínač pro vynucení diskrétní grafické karty (`DRI_PRIME=1`, NVIDIA Prime offload).

---

## ☕ Podporované verze Minecraftu

| Verze | Status | Popis |
| :--- | :--- | :--- |
| **`26.3`** | 🌟 **Doporučeno & Nativní** | Primární, plně stabilní nativní verze sítě MYCHAL SMP s kompletní optimalizací. |
| **`26.2`** | 📦 **Podporováno** | Podporovaná verze přes multi-version ProtocolBridge. |
| **`26.1.2`** | 📦 **Podporováno** | Plně kompatibilní verze s podporou ProtocolBridge. |
| **`1.21.11`** | 🛡️ **Podporováno** | Stabilní verze 1.21 s integrovaným profilem a oficiálním keyartem. |

---

## 📥 Instalace & Balíčky pro všechny systémy

Každé vydání na GitHubu automaticky generuje nativní balíčky pro všechny hlavní distribuce Linuxu i Windows:

### 🐧 Linux (CachyOS, Arch Linux, Fedora, Ubuntu, Debian)

#### 1. Univerzální 1-Click instalátor (CachyOS / Arch / Fedora / Ubuntu)
Automaticky rozpozná tvůj systém (`pacman`, `dnf`, `apt`, `zypper`), zkontroluje závislosti (`webkit2gtk-4.1`), stáhne nejnovější `.tar.gz` a vytvoří zástupce v menu aplikací:
```bash
curl -sSfL https://raw.githubusercontent.com/mychalVidea/mychalsmp-launcher/main/install.sh | bash
```

#### 2. Nativní distribuční balíčky (GitHub Releases)
* **CachyOS / Arch Linux:** `./install-cachyos.sh` nebo sestavení přes přiložený `PKGBUILD` (`makepkg -si`).
* **Fedora / Nobara / RHEL / openSUSE:** `sudo dnf install ./mychalsmp-launcher.rpm`
* **Ubuntu / Debian / Mint / Pop!_OS:** `sudo apt install ./mychalsmp-launcher.deb`
* **Univerzální archiv / AppImage:** `mychalsmp-launcher.tar.gz` nebo `mychalsmp-launcher.AppImage`

---

### 🪟 Windows 10 & 11
* **`mychalsmp-launcher-setup.exe` (NSIS Instalátor):** Rychlý nativní instalátor (~8 MB), který využívá systémový Microsoft Edge WebView2, vytvoří zástupce v nabídce Start i na ploše a podporuje automatické aktualizace přímo z prostředí launcheru.

---

## 🛠️ Vývoj & Sestavení projektu

### Požadavky pro kompilaci
* **Rust Toolchain** (`rustup`, `cargo` 1.77.2+)
* **Node.js** (v20+ pro `@tauri-apps/cli`)
* **Linux systémové knihovny:**
  * *CachyOS / Arch:* `sudo pacman -S webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg xdotool`
  * *Fedora:* `sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel libxdo-devel`
  * *Ubuntu / Debian:* `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

### Spuštění a kompilace
```bash
# Instalace Tauri CLI
npm install

# Spuštění ve vývojovém režimu s hot-reloadem
npm start

# Sestavení Linux balíčků (.deb, .rpm, .AppImage)
npm run build:linux

# Sestavení Windows NSIS instalátoru (.exe)
npm run build:win

# Vydání nové verze (aktualizuje verze v package.json, tauri.conf.json a Cargo.toml)
npm run release
```

---

## 🌐 O síti MYCHAL SMP

* **Oficiální IP serveru:** `mychalsmp.xyz`
* **Web a návod k připojení:** [join.mychalsmp.xyz](https://join.mychalsmp.xyz)
* **Autor & správa projektu:** **mychalVidea** ([admin@mychalsmp.xyz](mailto:admin@mychalsmp.xyz))

---

<p align="center">
  <sub>Vytvořeno s důrazem na nekompromisní výkon, čistý Matte Obsidian design a stabilitu pro hráče <strong>MYCHAL SMP</strong>.</sub>
</p>
