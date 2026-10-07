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

V souladu s požadavky **nejsou použity žádné AppImage** balíčky. Launcher je připraven pro všechny hlavní distribuce:

### 1. CachyOS / Arch Linux
- **Rychlý instalátor:** Spusť `./install-cachyos.sh` přímo ve složce launcher.
- **Nativní balíček PKGBUILD:** Můžeš využít přiložený `PKGBUILD` a nainstalovat přes `makepkg -si`.
- **Archiv:** K dispozici je také standalone `.tar.gz` v `dist/`.

### 2. Ubuntu / Debian / Linux Mint
- Výstupní `.deb` balíček:
  ```bash
  sudo dpkg -i dist/mychalsmp-launcher_1.0.0_amd64.deb
  ```

### 3. Fedora / RHEL / openSUSE
- Výstupní `.rpm` balíček:
  ```bash
  sudo rpm -i dist/mychalsmp-launcher-1.0.0.x86_64.rpm
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

### Sestavení balíčků pro Linux (deb, rpm, tar.gz)
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
