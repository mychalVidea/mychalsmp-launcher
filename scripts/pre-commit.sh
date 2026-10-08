#!/usr/bin/env bash
# ==============================================================================
# MYCHAL SMP Launcher - Pre-Commit Git Hook
# Automaticky se zeptá na verzi balíčku při každém 'git commit'
# ==============================================================================

# Zkontrolujeme, zda máme interaktivní terminál
if [ ! -t 0 ] && [ ! -e /dev/tty ]; then
    exit 0
fi

DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PACKAGE_JSON="$DIR/package.json"

if [ ! -f "$PACKAGE_JSON" ]; then
    exit 0
fi

# Pokud již commitujeme změnu verze přes release.sh, nepřerušovat
if [ "$LAUNCHER_RELEASE_SCRIPT" = "1" ]; then
    exit 0
fi

CURRENT_VERSION=$(node -p "require('$PACKAGE_JSON').version || '1.0.0'" 2>/dev/null || echo "1.0.0")

# Výpočet doporučeného patche
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
NEXT_PATCH="${MAJOR:-1}.${MINOR:-0}.$(( ${PATCH:-0} + 1 ))"

echo "" > /dev/tty
echo "==================================================================" > /dev/tty
echo "📦 [MYCHAL SMP Launcher] Kontrola verze před commitem" > /dev/tty
echo "Aktuální verze: $CURRENT_VERSION (doporučený další patch: $NEXT_PATCH)" > /dev/tty
echo "Zadej novou verzi (např. 1.0.1 nebo 1.2.0) k vydání nového balíčku," > /dev/tty
echo "nebo stiskni [ENTER] pro ponechání stávající verze $CURRENT_VERSION:" > /dev/tty
echo "==================================================================" > /dev/tty
printf "👉 Nová verze [%s]: " "$CURRENT_VERSION" > /dev/tty

read -r INPUT_VERSION < /dev/tty || true

if [ -n "$INPUT_VERSION" ] && [ "$INPUT_VERSION" != "$CURRENT_VERSION" ]; then
    NEW_VERSION="${INPUT_VERSION#v}"
    if [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
        # Aktualizace package.json
        node -e "
        const fs = require('fs');
        const pkg = JSON.parse(fs.readFileSync('$PACKAGE_JSON', 'utf8'));
        pkg.version = '$NEW_VERSION';
        fs.writeFileSync('$PACKAGE_JSON', JSON.stringify(pkg, null, 2) + '\n');
        " 2>/dev/null || true

        # Aktualizace package-lock.json pokud existuje
        if [ -f "$DIR/package-lock.json" ]; then
            node -e "
            const fs = require('fs');
            const lock = JSON.parse(fs.readFileSync('$DIR/package-lock.json', 'utf8'));
            lock.version = '$NEW_VERSION';
            if (lock.packages && lock.packages['']) {
                lock.packages[''].version = '$NEW_VERSION';
            }
            fs.writeFileSync('$DIR/package-lock.json', JSON.stringify(lock, null, 2) + '\n');
            " 2>/dev/null || true
            git add "$DIR/package-lock.json" 2>/dev/null || true
        fi

        git add "$PACKAGE_JSON" 2>/dev/null || true
        echo "✔ Verze nastavena na $NEW_VERSION a zahrnuta do tohoto commitu!" > /dev/tty
        echo "ℹ Po 'git push' GitHub Actions automaticky vytvoří nový release v$NEW_VERSION." > /dev/tty
        echo "" > /dev/tty
    else
        echo "⚠️ Neplatný formát verze '$INPUT_VERSION', ponechána $CURRENT_VERSION" > /dev/tty
    fi
fi

exit 0
