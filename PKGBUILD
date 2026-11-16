# Maintainer: Bhima <bhima.work@gmail.com>
pkgname=bug-on-files-m3-bin
pkgver=0.1.0
pkgrel=1
pkgdesc="Bug On Files M3 - Material 3 Expressive File Explorer"
arch=('x86_64')
url="https://github.com/nguyentruongton/bug-on-files-m3"
license=('MIT')
depends=('webkit2gtk-4.1' 'gtk3' 'openssl' 'librsvg')
provides=('bug-on-files-m3')
conflicts=('bug-on-files-m3')
options=('!strip')
_appimage="Bug.On.Files.M3_${pkgver}_amd64.AppImage"

# Using GitHub Release source
source=("${_appimage}::https://github.com/nguyentruongton/bug-on-files-m3/releases/download/v${pkgver}/${_appimage}"
        "https://raw.githubusercontent.com/nguyentruongton/bug-on-files-m3/v${pkgver}/assets/icon.png")
sha256sums=('SKIP' 'SKIP')

package() {
    install -Dm755 "${srcdir}/${_appimage}" "${pkgdir}/opt/${pkgname}/${pkgname}.AppImage"
    install -Dm644 "${srcdir}/icon.png" "${pkgdir}/usr/share/icons/hicolor/512x512/apps/${pkgname}.png"

    # Create desktop entry
    mkdir -p "${pkgdir}/usr/share/applications"
    cat > "${pkgdir}/usr/share/applications/${pkgname}.desktop" << EOF
[Desktop Entry]
Name=Files M3
Exec=/opt/${pkgname}/${pkgname}.AppImage
Icon=${pkgname}
Type=Application
Categories=Utility;FileManager;
Comment=Bug On Files M3 - Material 3 Expressive File Explorer
Terminal=false
StartupWMClass=Bug On Files M3
EOF
}
