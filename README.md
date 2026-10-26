# <p align="center"><img src="src/renderer/assets/logo.png" alt="SMPClient Logo" width="96"><br>SMPClient</p>

<p align="center">
  <strong>Oficiální prémiový multiplatformní Minecraft klient vytvořený na míru pro komunitu a síť MYCHAL SMP.</strong>
</p>

<p align="center">
  <a href="https://mychalsmp.xyz"><img src="https://img.shields.io/badge/Server-mychalsmp.xyz-0a67e5?style=for-the-badge&logo=minecraft" alt="Server IP"></a>
  <a href="#"><img src="https://img.shields.io/badge/Doporučená_verze-26.2-21de00?style=for-the-badge" alt="Doporučená verze 26.2"></a>
  <a href="#"><img src="https://img.shields.io/badge/Platformy-Linux_%7C_Windows_11-blue?style=for-the-badge&logo=linux" alt="Platformy"></a>
  <a href="#"><img src="https://img.shields.io/badge/Licence-MIT-94a3b8?style=for-the-badge" alt="Licence"></a>
</p>

---

## 🌟 O SMPClientu

**SMPClient** je moderní herní klient postavený na Electronu a moderním webovém jádru. Klade důraz na maximální herní výkon, okamžité spuštění, nulový vizuální balast a bezproblémové připojení na oficiální Minecraft server mychalsmp.xyz.

Launcher plně podporuje **Linux** (včetně CachyOS, Arch Linuxu, Ubuntu, Debianu a Fedory bez neohrabaných AppImage formátů) i **Windows 11** (s instalátorem i plně přenosnou Portable verzí).

---

## ✨ Klíčové funkce

### 🎨 Dynamické Key Arty & Imersivní UI
* **Dynamické pozadí podle verze:** Hlavní uvítací Hero Banner i jednotlivé karty herních profilů automaticky zobrazují oficiální klíčové arty dané verze Minecraftu (`26.3`, `26.2`, `26.1.2`, `1.21.11`).
* **Interaktivní 3D model postavy:** Plnohodnotný 3D náhled tvého skinu a pláště přímo na domovské obrazovce (možnost otáčení myší, podpora variant Classic i Slim).
* **Čistý Dark Surface design:** Sofistikované tmavé uživatelské rozhraní (`#12141f`), jemný glassmorphismus u stavových prvků a plynulé mikroanimace bez zbytečného vizuálního šumu.

### ⚡ Extrémní FPS & 1-Click Herní optimalizace
* **Přednastavený Fabric loader:** Automatické nasazení a správa moderního zavaděče módů pro nejvyšší možnou plynulost.
* **Sodium + Iris + Lithium:** Jedním kliknutím nainstaluje a nakonfiguruje nejvýkonnější optimalizační modifikace a podporu moderních shaderů.
* **Vyladěné JVM argumenty:** Výchozí optimalizace pro moderní garbage collectory (ZGC / Generational ZGC), eliminující záseky při generování světa.

### 🎮 Flexibilní správa herních profilů
* **Více nezávislých instancí:** Každý profil může mít vlastní složku, vyhrazenou paměť RAM, modifikace i verzi hry.
* **Okamžitý upgrade mezi verzemi:** Bezpečný přechod profilu na novější verzi se zachováním veškerého nastavení (`options.txt`), konfigurací módů, shaderů i resource packů.
* **Sledování odehraného času:** Automatické počítadlo nahraných hodin a evidence naposledy spuštěných profilů.

### 🧩 Integrovaný Modrinth Store
* **Prohlížeč módů přímo v aplikaci:** Procházení a vyhledávání tisíců komunitních modifikací z platformy Modrinth.
* **Chytré řešení závislostí:** Launcher automaticky detekuje chybějící knihovny (např. *Fabric API*) a stáhne kompatibilní verzi pro danou instanci hry.
* **Filtrace podle verze a loaderu:** Pohodlné filtrování módů pro verze 26.3, 26.2, 26.1.2 i 1.21.11.

### ⌨️ Vizuální Keybind Manager
* **Interaktivní klávesnice:** Přehledná virtuální klávesnice znázorňující obsazené a volné klávesy.
* **Detekce konfliktů:** Inteligentní vyhodnocení kolizí ovládání (s ignorováním standardních debug funkcí F3).
* **Globální synchronizace:** Možnost synchronizovat oblíbené rozložení kláves napříč všemi tvými herními profily jedním kliknutím.

### 🛡️ Inteligentní Crash Analyzer
* **Automatická diagnostika pádů:** Při neočekávaném pádu hry analyzátor prozkoumá herní logy a identifikuje konkrétní viníky (nekompatibilní mód, nedostatek RAM, špatná verze Javy).
* **Akce na jedno kliknutí:** Nabízí přímé řešení problému (deaktivace vadného módu, oprava knihoven).

### 🌐 Živý Server Tracker & 1-Click Join
* **Reálná telemetrie:** Ping, dostupnost a počet aktivních hráčů na síti `mychalsmp.xyz` přímo v launcheru.
* **Automatický Failover:** V případě výpadku DNS automaticky přepíná na záložní IP (`130.61.89.37`), aby bylo spojení vždy spolehlivé.
* **Přímé připojení do hry:** Tlačítko pro okamžité spuštění hry přímo na server bez hledání v multiplayer menu.

### 🐧 Linux Gaming Integrace
* **GameMode:** Automatické využití `gamemoderun` pro prioritizaci CPU a GPU vláken.
* **Nativní Wayland & X11:** Čisté vykreslování s volitelným Zink (OpenGL přes Vulkan) pro maximální odezvu.
* **Dedikovaná GPU:** Přepínač pro vynucení diskrétní grafické karty na noteboocích (`DRI_PRIME=1`, NVIDIA Prime offload).

### 👾 Discord Rich Presence
* Elegantní integrace stavu na Discordu se zobrazením aktuální činnosti (*„V launcheru“* / *„Hraje na: mychalsmp.xyz“*), zvoleného profilu a herního času.

---

## ☕ Podporované verze Minecraftu

Síť MYCHAL SMP a SMPClient podporují následující verze:

| Verze | Status | Popis |
| :--- | :--- | :--- |
| **`26.3`** | 🚀 **Nejnovější** | Nejnovější herní drop s podporou nejnovějších herních prvků a módů. |
| **`26.2`** | 🌟 **Doporučeno** | Primární, plně stabilní verze sítě MYCHAL SMP s kompletní optimalizací. |
| **`26.1.2`** | 📦 **Legacy** | Předchozí stabilní verze pro dlouhodobě udržované modpacky. |
| **`1.21.11`** | 🛡️ **Podporováno** | Verze 1.21 s integrovaným profilem a oficiálním keyartem. |

---

## 📥 Instalace & Stažení

### 🐧 Linux

V souladu se standardy **nevyužíváme žádné AppImage balíčky**. Pro všechny linuxové distribuce je připraven čistý, rychlý a univerzální archiv:

#### 1. Rychlý 1-click instalátor (všechny distribuce)
Otevři terminál a spusť:
```bash
curl -sSfL https://raw.githubusercontent.com/mychalVidea/mychalsmp-launcher/main/install.sh | bash
```

#### 2. CachyOS / Arch Linux
V kořenové složce stačí spustit instalátor nebo využít `PKGBUILD`:
```bash
./install-cachyos.sh
```

#### 3. Ruční spuštění archivu (`.tar.gz`)
```bash
tar -xzf mychalsmp-launcher.tar.gz
./mychalsmp-launcher
```

---

### 🪟 Windows 11

Pro operační systém Windows 11 jsou k dispozici dvě varianty:
1. **NSIS Instalátor (`.exe`):** Standardní instalátor, který vytvoří zástupce v nabídce Start a na ploše a integruje odinstalátor.
2. **Portable verze (`.exe`):** Spustitelný soubor bez nutnosti instalace – ideální na USB flashdisk nebo pro rychlé hraní bez administrátorských práv.

---

## 🛠️ Vývoj & Sestavení projektu

### Požadavky
* **Node.js** (v20 nebo novější)
* **npm**
* **Java 21 / 25** (pro spouštění Minecraftu 26.x a 1.21.x)

### Spuštění ve vývojovém režimu
```bash
npm install
npm start
```

### Sestavení instalačních balíčků

```bash
# Sestavení univerzálního tar.gz archivu pro Linux
npm run build:linux

# Sestavení Windows 11 instalátoru i Portable verze
npm run build:win

# Sestavení všech platforem současně
npm run build:all

# Rychlé rozbalené testovací sestavení
npm run pack
```

---

## 🌐 O síti MYCHAL SMP

* **Oficiální herní server:** `mychalsmp.xyz`
* **Oficiální web:** [mychalsmp.xyz](https://mychalsmp.xyz)
* **Návod k připojení:** [join.mychalsmp.xyz](https://join.mychalsmp.xyz)
* **Autor & správa projektu:** **mychalVidea** ([admin@mychalsmp.xyz](mailto:admin@mychalsmp.xyz))

---

<p align="center">
  <sub>Vytvořeno s důrazem na kvalitu, plynulost a čistý design pro hráče <strong>MYCHAL SMP</strong>.</sub>
</p>
