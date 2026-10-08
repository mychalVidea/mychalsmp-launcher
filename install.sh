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

echo "⚡ [MYCHAL SMP] Zahajuji instalaci launcheru..."

mkdir -p "$INSTALL_DIR"
mkdir -p "$BIN_DIR"
mkdir -p "$DESKTOP_DIR"
mkdir -p "$ICON_DIR"

TEMP_TAR="/tmp/mychalsmp-launcher-latest.tar.gz"

# 1. Zjištění odkazu na nejnovější Linux balíček přímo z GitHub API
LATEST_RELEASE_API="https://api.github.com/repos/mychalVidea/mychalsmp-launcher/releases/latest"
echo "🔍 Zjišťuji nejnovější verzi balíčku z GitHubu..."

DOWNLOAD_URL=$(curl -sSfL "$LATEST_RELEASE_API" | grep -o 'https://[^"]*mychalsmp-launcher[^"]*\.tar\.gz' | head -n 1 || true)

if [ -z "$DOWNLOAD_URL" ]; then
    DOWNLOAD_URL="https://github.com/mychalVidea/mychalsmp-launcher/releases/latest/download/mychalsmp-launcher-1.0.0.tar.gz"
fi

echo "📥 Stahuji balíček z GitHub Releases ($DOWNLOAD_URL)..."
if curl -fL "$DOWNLOAD_URL" -o "$TEMP_TAR"; then
    echo "✓ Balíček byl úspěšně stažen z GitHub Releases"
else
    echo "❌ Chyba: Nepodařilo se stáhnout balíček z GitHub Releases ($DOWNLOAD_URL)."
    echo "Zkontroluj prosím internetové připojení nebo dostupnost vydání na GitHubu."
    exit 1
fi

echo "📦 Rozbaluji herního klienta do $INSTALL_DIR..."
# Pokusíme se o rozbalení s odstraněním nadřazené složky (--strip-components=1)
if tar -xzf "$TEMP_TAR" -C "$INSTALL_DIR" --strip-components=1 2>/dev/null; then
    :
else
    tar -xzf "$TEMP_TAR" -C "$INSTALL_DIR"
fi
rm -f "$TEMP_TAR"

# Pojistka: pokud by byl spustitelný soubor v podsložce, přesuneme obsah přímo do INSTALL_DIR
if [ ! -f "$INSTALL_DIR/mychalsmp-launcher" ]; then
    NESTED_BIN=$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 2 -type f -name "mychalsmp-launcher" | head -n 1 || true)
    if [ -n "$NESTED_BIN" ]; then
        NESTED_DIR=$(dirname "$NESTED_BIN")
        if [ "$NESTED_DIR" != "$INSTALL_DIR" ]; then
            cp -r "$NESTED_DIR"/* "$INSTALL_DIR"/ 2>/dev/null || true
            rm -rf "$NESTED_DIR" 2>/dev/null || true
        fi
    fi
fi

if [ ! -f "$INSTALL_DIR/mychalsmp-launcher" ]; then
    echo "❌ Chyba: Spustitelný soubor mychalsmp-launcher nebyl v archivu nalezen."
    exit 1
fi

# Vytvoření symlinku do ~/.local/bin a nastavení oprávnění
chmod +x "$INSTALL_DIR/mychalsmp-launcher"
ln -sf "$INSTALL_DIR/mychalsmp-launcher" "$BIN_DIR/mychalsmp-launcher"

# Zajištění ikony aplikace
if [ -f "$INSTALL_DIR/resources/app/src/renderer/assets/logo.png" ]; then
    cp "$INSTALL_DIR/resources/app/src/renderer/assets/logo.png" "$ICON_DIR/mychalsmp-launcher.png"
elif [ -f "$INSTALL_DIR/resources/app/src/renderer/assets/server-icon.png" ]; then
    cp "$INSTALL_DIR/resources/app/src/renderer/assets/server-icon.png" "$ICON_DIR/mychalsmp-launcher.png"
elif [ -f "$INSTALL_DIR/resources/logo.png" ]; then
    cp "$INSTALL_DIR/resources/logo.png" "$ICON_DIR/mychalsmp-launcher.png"
elif [ -f "$INSTALL_DIR/resources/server-icon.png" ]; then
    cp "$INSTALL_DIR/resources/server-icon.png" "$ICON_DIR/mychalsmp-launcher.png"
fi

# Vytvoření zástupce v menu aplikací (.desktop)
cat <<EOF > "$DESKTOP_DIR/mychalsmp-launcher.desktop"
[Desktop Entry]
Name=SMPLauncher
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
echo "✅ [HOTOVO] SMPLauncher byl úspěšně nainstalován!"
echo "👉 Můžeš jej spustit z aplikačního menu systému nebo příkazem:"
echo "   ~/.local/bin/mychalsmp-launcher"
