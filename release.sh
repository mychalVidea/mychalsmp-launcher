#!/usr/bin/env bash
# ==============================================================================
# MYCHAL SMP Launcher - Interaktivní Release & Verze Skript
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PACKAGE_JSON="$DIR/package.json"

if [ ! -f "$PACKAGE_JSON" ]; then
    echo "❌ Chyba: package.json nebyl nalezen v $DIR"
    exit 1
fi

CURRENT_VERSION=$(node -p "require('./package.json').version || '1.0.0'")

# Výpočet doporučeného dalšího patche (např. 1.0.0 -> 1.0.1)
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
NEXT_PATCH="${MAJOR:-1}.${MINOR:-0}.$(( ${PATCH:-0} + 1 ))"
NEXT_MINOR="${MAJOR:-1}.$(( ${MINOR:-0} + 1 )).0"

echo ""
echo "=================================================================="
echo "⚡ [MYCHAL SMP Launcher] Vydání nové verze a automatický build"
echo "=================================================================="
echo "Aktuální verze: $CURRENT_VERSION"
echo "Doporučené možnosti: "
echo "  [1] Patch: $NEXT_PATCH (opravy chyb, drobné úpravy)"
echo "  [2] Minor: $NEXT_MINOR (nové funkce)"
echo "  Nebo zadej vlastní verzi (např. 1.2.0)"
echo "------------------------------------------------------------------"
read -p "👉 Zadej novou verzi [$NEXT_PATCH]: " INPUT_VERSION

if [ -z "$INPUT_VERSION" ]; then
    NEW_VERSION="$NEXT_PATCH"
elif [ "$INPUT_VERSION" = "1" ]; then
    NEW_VERSION="$NEXT_PATCH"
elif [ "$INPUT_VERSION" = "2" ]; then
    NEW_VERSION="$NEXT_MINOR"
else
    NEW_VERSION="${INPUT_VERSION#v}" # Odstranění případného 'v' na začátku
fi

# Validace formátu verze (např. 1.0.1)
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
    echo "❌ Neplatný formát verze: '$NEW_VERSION'. Musí být ve formátu např. 1.0.1 nebo 1.2.0"
    exit 1
fi

echo ""
echo "✔ Vybraná nová verze: v$NEW_VERSION"

# Dotaz na zprávu commitu
read -p "📝 Zadej popis změn (commit message) [Release v$NEW_VERSION]: " COMMIT_MSG
if [ -z "$COMMIT_MSG" ]; then
    COMMIT_MSG="Release v$NEW_VERSION"
fi

# 1. Aktualizace package.json
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('$PACKAGE_JSON', 'utf8'));
pkg.version = '$NEW_VERSION';
fs.writeFileSync('$PACKAGE_JSON', JSON.stringify(pkg, null, 2) + '\n');
"

# 2. Aktualizace package-lock.json pokud existuje
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
fi

echo "✔ Verze v package.json byla úspěšně změněna na $NEW_VERSION"

# 3. Git commit, tag a push
echo ""
echo "🚀 Vytvářím Git commit, tag a odesílám na GitHub..."
git add -A
git commit -m "$COMMIT_MSG" || echo "ℹ Žádné další změny k uložení kromě verze."
git tag -a "v$NEW_VERSION" -m "MYCHAL SMP Launcher v$NEW_VERSION" -f

echo "📤 Odesílám kód a tag na GitHub (origin main)..."
git push origin main
git push origin "v$NEW_VERSION" -f

echo ""
echo "=================================================================="
echo "✅ HOTOVO! Verze v$NEW_VERSION byla odeslána na GitHub."
echo "🤖 GitHub Actions právě zahajuje automatický build (Windows & Linux)."
echo "📦 Jakmile doběhne, v launcheru hráči uvidí aktualizaci na v$NEW_VERSION!"
echo "🔗 Sledovat průběh můžeš zde: https://github.com/mychalVidea/mychalsmp-launcher/actions"
echo "=================================================================="
echo ""
