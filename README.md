# ⚡ MYCHAL SMP Launcher

Oficiální moderní multiplatformní Minecraft launcher vyvinutý přímo na míru hráčům a komunitě sítě **MYCHAL SMP** ([mychalsmp.xyz](https://mychalsmp.xyz)).

Plná podpora pro **Linux** (Ubuntu/Debian, Fedora, CachyOS, Arch Linux) a **Windows 11** (x64 NSIS instalátor & Portable `.exe`).

---

## 💎 Hlavní funkce

1. **🚀 1-Click Přímé připojení na server:**
   - Automatické připojení přímo na herní server `mychalsmp.xyz` (`join.mychalsmp.xyz`) bez nutnosti ručně vyhledávat server v multiplayer seznamu.
2. **⚡ Maximální FPS & Optimalizace (Fabric + Sodium):**
   - Integrovaná podpora pro **Sodium / Embeddium**, **Iris Shaders**, **Lithium** a **FerriteCore** pro maximální plynulost a nízkou spotřebu paměti RAM i na slabších počítačích.
3. **👤 Duální správa účtů:**
   - **Offline účet:** Okamžité přihlášení na libovolný nick bez zdržování.
   - **Microsoft / Originál:** Oficiální Xbox Live OAuth přihlášení s originálním skinem a účtem.
4. **🎨 Skin & Postava:**
   - Okamžitý dynamický náhled postavy podle zvoleného nicku nebo možnost nahrát libovolný `.png` skin přímo z disku.
5. **📊 Živá telemetrie serveru:**
   - Detekce stavu serveru, počet online hráčů a ping v reálném čase přímo v záhlaví a na domovské stránce.
6. **🛠️ Pokročilá správa JVM:**
   - Nastavení alokace paměti RAM (posuvník 2–16 GB).
   - Automatická detekce Javy 21 v systému s možností vlastní cesty.
   - Výběr rozlišení okna (HD, Full HD, Fullscreen).
   - Vestavěná herní konzole s logy v reálném čase.

---

## 🐧 Podpora Linuxu

V souladu s požadavky **nejsou použity žádné AppImage** balíčky. Pro veškeré distribuce je k dispozici univerzální, čistý a rychlý archiv **`.tar.gz`**:

### 1. Univerzální 1-click instalátor (všechny distribuce)
- Stačí stáhnout a spustit přiložený instalační skript:
  ```bash
  curl -sSfL https://raw.githubusercontent.com/mychalVidea/mychalsmp-launcher/main/install.sh | bash
  ```

### 2. CachyOS / Arch Linux
- Spusť `./install-cachyos.sh` přímo ve složce launcheru nebo využij přiložený `PKGBUILD`.

### 3. Ruční spuštění archivu (.tar.gz)
- Rozbal archiv a spusť binárku:
  ```bash
  tar -xzf mychalsmp-launcher.tar.gz
  ./mychalsmp-launcher
  ```

---

## 🪟 Podpora Windows 11

Pro Windows 11 jsou k dispozici dva výstupy:
1. **NSIS Instalátor (`.exe`):** Kompletní průvodce instalací, vytvoření zástupce na ploše a v nabídce Start, odinstalátor.
2. **Portable verze (`.exe`):** Spustitelný soubor bez nutnosti instalace – stačí kliknout a hrát (vhodné na flashdisk).

---

## 🛠️ Vývoj a sestavení balíčků

### Spuštění ve vývojovém režimu
```bash
npm start
```

### Sestavení balíčku pro Linux (tar.gz)
```bash
npm run build:linux
```

### Sestavení balíčků pro Windows 11 (exe, portable)
```bash
npm run build:win
```

### Rychlé otestování struktury (unpacked dir)
```bash
npm run pack
```
