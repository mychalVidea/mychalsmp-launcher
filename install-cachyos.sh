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

# 1. Zkopírovat binárky z dist/linux-unpacked nebo rozbalit tar.gz
if [ -d "$DIR/dist/linux-unpacked" ]; then
    echo "📦 Kopíruji herní soubory..."
    cp -r "$DIR/dist/linux-unpacked/"* "$INSTALL_DIR/"
elif [ -f "$DIR/dist/mychalsmp-launcher-1.0.0.tar.gz" ]; then
    echo "📦 Rozbaluji archiv..."
    tar -xzf "$DIR/dist/mychalsmp-launcher-1.0.0.tar.gz" -C "$INSTALL_DIR/"
else
    echo "⚙️ Vytvářím linux balíček přes npm run pack..."
    cd "$DIR" && npm run pack
    cp -r "$DIR/dist/linux-unpacked/"* "$INSTALL_DIR/"
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
echo "👉 Můžeš ho spustit z aplikačního menu nebo příkazem: ~/.local/bin/mychalsmp-launcher"
