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

if [ ! -f "$INSTALL_DIR/mychalsmp-launcher" ] && [ -f "$INSTALL_DIR/SMPClient" ]; then
    ln -sf "$INSTALL_DIR/SMPClient" "$INSTALL_DIR/mychalsmp-launcher"
fi

if [ ! -f "$INSTALL_DIR/mychalsmp-launcher" ]; then
    echo "❌ Chyba: Spustitelný soubor mychalsmp-launcher nebyl v archivu nalezen."
    exit 1
fi

# Deaktivace chrome-sandbox pokud nemá SUID root (zabraňuje okamžitému SIGTRAP pádu na moderních distrech)
if [ -f "$INSTALL_DIR/chrome-sandbox" ]; then
    mv -f "$INSTALL_DIR/chrome-sandbox" "$INSTALL_DIR/chrome-sandbox.disabled" 2>/dev/null || rm -f "$INSTALL_DIR/chrome-sandbox" 2>/dev/null || true
fi

# Nastavení oprávnění a vytvoření spouštěcího wrapperu v ~/.local/bin s --no-sandbox
chmod +x "$INSTALL_DIR/mychalsmp-launcher"
[ -f "$INSTALL_DIR/SMPClient" ] && chmod +x "$INSTALL_DIR/SMPClient" || true

rm -f "$BIN_DIR/mychalsmp-launcher"
cat <<EOF > "$BIN_DIR/mychalsmp-launcher"
#!/usr/bin/env bash
exec "$INSTALL_DIR/mychalsmp-launcher" --no-sandbox "\$@"
EOF
chmod +x "$BIN_DIR/mychalsmp-launcher"

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
Name=SMPClient
Comment=Oficiální Minecraft klient sítě MYCHAL SMP
Exec="$INSTALL_DIR/mychalsmp-launcher" --no-sandbox %U
Icon=mychalsmp-launcher
Terminal=false
Type=Application
Categories=Game;ActionGame;AdventureGame;
StartupWMClass=xyz.mychalsmp.launcher
EOF

chmod +x "$DESKTOP_DIR/mychalsmp-launcher.desktop"

# Aktualizace ikony a menu cache pokud existují systémové nástroje
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -f "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true

echo ""
echo "✅ [HOTOVO] SMPClient byl úspěšně nainstalován!"

# Pokud běží grafické prostředí (X11 nebo Wayland), automaticky spustíme launcher a zavřeme terminál
if ([ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]) && [ "$NO_START" != "1" ] && [ "$1" != "--no-start" ]; then
    echo "🚀 Spouštím herního klienta a zavírám terminál..."

    # Plně odpojené spuštění v nové session nezávislé na terminálu
    nohup setsid "$INSTALL_DIR/mychalsmp-launcher" --no-sandbox </dev/null >/dev/null 2>&1 &
    disown -a 2>/dev/null || true

    sleep 1.2

    # Automatické zavření okna terminálu ukončením rodičovského shellu
    if [ -n "$PPID" ] && [ "$PPID" -gt 1 ]; then
        kill -HUP "$PPID" 2>/dev/null || kill -TERM "$PPID" 2>/dev/null || kill -9 "$PPID" 2>/dev/null || true
    fi
    exit 0
else
    echo "👉 Můžeš jej spustit z aplikačního menu systému nebo příkazem:"
    echo "   ~/.local/bin/mychalsmp-launcher"
fi
