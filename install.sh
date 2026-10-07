#!/usr/bin/env bash
# ==============================================================================
# MYCHAL SMP Launcher - Univerzální 1-click instalátor pro Linux
# Oficiální web: https://mychalsmp.xyz
# ==============================================================================

set -e

INSTALL_DIR="$HOME/.local/share/mychalsmp-launcher"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
TAR_FILE="mychalsmp-launcher-1.0.0.tar.gz"

echo "⚡ [MYCHAL SMP] Zahajuji instalaci launcheru..."

mkdir -p "$INSTALL_DIR"
mkdir -p "$BIN_DIR"
mkdir -p "$DESKTOP_DIR"
mkdir -p "$ICON_DIR"

TEMP_TAR="/tmp/$TAR_FILE"

# Stažení instalačního balíčku výhradně z oficiálního GitHub Releases
GITHUB_RELEASE_URL="https://github.com/mychalVidea/mychalsmp-launcher/releases/latest/download/$TAR_FILE"

echo "📥 Stahuji balíček z GitHub Releases..."
if curl -fL "$GITHUB_RELEASE_URL" -o "$TEMP_TAR"; then
    echo "✓ Balíček byl úspěšně stažen z GitHub Releases"
else
    echo "❌ Chyba: Nepodařilo se stáhnout $TAR_FILE z GitHub Releases ($GITHUB_RELEASE_URL)."
    echo "Zkontroluj prosím internetové připojení nebo dostupnost vydání na GitHubu."
    exit 1
fi

echo "📦 Rozbaluji herního klienta do $INSTALL_DIR..."
tar -xzf "$TEMP_TAR" -C "$INSTALL_DIR"
rm -f "$TEMP_TAR"

# Vytvoření symlinku do ~/.local/bin
ln -sf "$INSTALL_DIR/mychalsmp-launcher" "$BIN_DIR/mychalsmp-launcher"
chmod +x "$INSTALL_DIR/mychalsmp-launcher"

# Zajištění ikony aplikace
if [ -f "$INSTALL_DIR/resources/app/renderer/assets/server-icon.png" ]; then
    cp "$INSTALL_DIR/resources/app/renderer/assets/server-icon.png" "$ICON_DIR/mychalsmp-launcher.png"
elif [ -f "$INSTALL_DIR/assets/server-icon.png" ]; then
    cp "$INSTALL_DIR/assets/server-icon.png" "$ICON_DIR/mychalsmp-launcher.png"
fi

# Vytvoření zástupce v menu aplikací (.desktop)
cat <<EOF > "$DESKTOP_DIR/mychalsmp-launcher.desktop"
[Desktop Entry]
Name=MYCHAL SMP Launcher
Comment=Oficiální Minecraft launcher sítě MYCHAL SMP
Exec=$INSTALL_DIR/mychalsmp-launcher %U
Icon=mychalsmp-launcher
Terminal=false
Type=Application
Categories=Game;ActionGame;AdventureGame;
StartupWMClass=xyz.mychalsmp.launcher
EOF

chmod +x "$DESKTOP_DIR/mychalsmp-launcher.desktop"

# Aktualizace ikony a menu cache pokud existují systémové nástroje
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f "$HOME/.local/share/icons/hicolor" || true

echo ""
echo "✅ [HOTOVO] MYCHAL SMP Launcher byl úspěšně nainstalován!"
echo "👉 Můžeš jej spustit z aplikačního menu systému nebo příkazem:"
echo "   ~/.local/bin/mychalsmp-launcher"
