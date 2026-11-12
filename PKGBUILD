# Maintainer: mychalVidea <admin@mychalsmp.xyz>
pkgname=mychalsmp-launcher
pkgver=1.4.6
pkgrel=1
pkgdesc="Oficiální cross-platform Minecraft launcher (Tauri v2 / Rust) pro síť MYCHAL SMP"
arch=('x86_64')
url="https://mychalsmp.xyz"
license=('MIT')
depends=('webkit2gtk-4.1' 'gtk3' 'libayatana-appindicator')
optdepends=('jre-openjdk: Java runtime pro Minecraft 26.3')
source=("mychalsmp-launcher.desktop")
sha256sums=('SKIP')

package() {
    install -d "${pkgdir}/opt/${pkgname}"
    if [ -f "${srcdir}/../src-tauri/target/release/mychalsmp-launcher" ]; then
        install -m755 "${srcdir}/../src-tauri/target/release/mychalsmp-launcher" "${pkgdir}/opt/${pkgname}/mychalsmp-launcher"
    fi
    if [ -d "${srcdir}/../assets" ]; then
        cp -r "${srcdir}/../assets" "${pkgdir}/opt/${pkgname}/" 2>/dev/null || true
    fi

    install -d "${pkgdir}/usr/bin"
    ln -s "/opt/${pkgname}/mychalsmp-launcher" "${pkgdir}/usr/bin/${pkgname}"

    install -d "${pkgdir}/usr/share/applications"
    install -m644 "${srcdir}/../mychalsmp-launcher.desktop" "${pkgdir}/usr/share/applications/${pkgname}.desktop"

    install -d "${pkgdir}/usr/share/pixmaps"
    install -m644 "${srcdir}/../build/icon.png" "${pkgdir}/usr/share/pixmaps/${pkgname}.png"
}
