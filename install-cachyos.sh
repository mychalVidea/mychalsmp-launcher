#!/usr/bin/env bash
# ==============================================================================
# MYCHAL SMP Launcher - Automatický instalátor pro CachyOS & Arch Linux
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.local/share/mychalsmp-launcher"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"

echo "⚡ [MYCHAL SMP] Instalace Launcheru pro CachyOS / Arch Linux..."

mkdir -p "$INSTALL_DIR"
mkdir -p "$BIN_DIR"
mkdir -p "$DESKTOP_DIR"
mkdir -p "$ICON_DIR"

# 0. Kontrola WebKit2GTK 4.1 na CachyOS / Arch Linuxu
if command -v pacman >/dev/null 2>&1 && ! pacman -Qi webkit2gtk-4.1 >/dev/null 2>&1; then
    echo "📦 Instaluji závislosti pro CachyOS / Arch (webkit2gtk-4.1, gtk3)..."
    sudo pacman -S --needed --noconfirm webkit2gtk-4.1 gtk3 libayatana-appindicator 2>/dev/null || sudo pacman -S --needed --noconfirm webkit2gtk-4.1 gtk3
fi

# 1. Zkopírovat nativní Tauri binárku nebo rozbalit tar.gz
if [ -f "$DIR/src-tauri/target/release/mychalsmp-launcher" ]; then
    echo "📦 Kopíruji zkompilovanou Tauri v2 binárku..."
    cp "$DIR/src-tauri/target/release/mychalsmp-launcher" "$INSTALL_DIR/mychalsmp-launcher"
    cp "$DIR/src-tauri/target/release/mychalsmp-launcher" "$INSTALL_DIR/SMPClient"
    [ -d "$DIR/assets" ] && cp -r "$DIR/assets" "$INSTALL_DIR/" 2>/dev/null || true
elif [ -f "$DIR/mychalsmp-launcher.tar.gz" ]; then
    echo "📦 Rozbaluji archiv..."
    rm -f "$INSTALL_DIR/mychalsmp-launcher" "$INSTALL_DIR/SMPClient"
    if tar -tf "$DIR/mychalsmp-launcher.tar.gz" 2>/dev/null | grep -q "^mychalsmp-launcher/"; then
        tar -xzf "$DIR/mychalsmp-launcher.tar.gz" -C "$INSTALL_DIR/" --strip-components=1
    else
        tar -xzf "$DIR/mychalsmp-launcher.tar.gz" -C "$INSTALL_DIR/"
    fi
else
    echo "⚙️ Kompiluji nativní Tauri v2 launcher..."
    cd "$DIR" && npm run tauri:build
    cp "$DIR/src-tauri/target/release/mychalsmp-launcher" "$INSTALL_DIR/mychalsmp-launcher"
    cp "$DIR/src-tauri/target/release/mychalsmp-launcher" "$INSTALL_DIR/SMPClient"
fi

# 2. Spouštěcí symlink
ln -sf "$INSTALL_DIR/mychalsmp-launcher" "$BIN_DIR/mychalsmp-launcher"
chmod +x "$INSTALL_DIR/mychalsmp-launcher"

# 3. Ikona aplikace
cp "$DIR/build/icon.png" "$ICON_DIR/mychalsmp-launcher.png"

# 4. Desktop entry
cat <<EOF > "$DESKTOP_DIR/mychalsmp-launcher.desktop"
[Desktop Entry]
Name=MYCHAL SMP Launcher
Comment=Oficiální Minecraft launcher sítě MYCHAL SMP
Exec=$INSTALL_DIR/mychalsmp-launcher %U
Icon=$ICON_DIR/mychalsmp-launcher.png
Terminal=false
Type=Application
Categories=Game;ActionGame;AdventureGame;
StartupWMClass=xyz.mychalsmp.launcher
EOF

chmod +x "$DESKTOP_DIR/mychalsmp-launcher.desktop"

echo "✅ [HOTOVO] MYCHAL SMP Launcher byl úspěšně nainstalován!"

# Pokud běží grafické prostředí (X11 nebo Wayland), automaticky spustíme launcher a zavřeme terminál
if ([ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]) && [ "$NO_START" != "1" ] && [ "$1" != "--no-start" ]; then
    echo "🚀 Spouštím herního klienta a zavírám terminál..."

    # Plně odpojené spuštění v nové session nezávislé na terminálu
    nohup setsid "$INSTALL_DIR/mychalsmp-launcher" </dev/null >/dev/null 2>&1 &
    disown -a 2>/dev/null || true

    sleep 1.2

    # Automatické zavření okna terminálu ukončením rodičovského shellu
    if [ -n "$PPID" ] && [ "$PPID" -gt 1 ]; then
        kill -HUP "$PPID" 2>/dev/null || kill -TERM "$PPID" 2>/dev/null || kill -9 "$PPID" 2>/dev/null || true
    fi
    exit 0
else
    echo "👉 Můžeš ho spustit z aplikačního menu nebo příkazem: ~/.local/bin/mychalsmp-launcher"
fi
