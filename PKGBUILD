# Maintainer: mychalVidea <admin@mychalsmp.xyz>
pkgname=mychalsmp-launcher
pkgver=1.0.0
pkgrel=1
pkgdesc="Oficiální cross-platform Minecraft launcher pro síť MYCHAL SMP s optimalizací Sodium"
arch=('x64')
url="https://mychalsmp.xyz"
license=('custom')
depends=('electron' 'nss' 'libxss' 'alsa-lib' 'gtk3' 'libnotify')
optdepends=('jre21-openjdk: Java 21 runtime pro Minecraft 26.2 / 1.21.x')
source=("mychalsmp-launcher.desktop")
sha256sums=('SKIP')

package() {
    install -d "${pkgdir}/opt/${pkgname}"
    cp -r "${srcdir}/../dist/linux-unpacked/"* "${pkgdir}/opt/${pkgname}/" 2>/dev/null || true

    install -d "${pkgdir}/usr/bin"
    ln -s "/opt/${pkgname}/mychalsmp-launcher" "${pkgdir}/usr/bin/${pkgname}"

    install -d "${pkgdir}/usr/share/applications"
    install -m644 "${srcdir}/../mychalsmp-launcher.desktop" "${pkgdir}/usr/share/applications/${pkgname}.desktop"

    install -d "${pkgdir}/usr/share/pixmaps"
    install -m644 "${srcdir}/../build/icon.png" "${pkgdir}/usr/share/pixmaps/${pkgname}.png"
}
