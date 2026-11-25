# Maintainer: Bhima <bhima.work@gmail.com>
pkgname=bug-on-files-m3-bin
pkgver=0.2.0
pkgrel=1
pkgdesc="Bug On Files M3 - Material 3 Expressive File Explorer"
arch=('x86_64')
url="https://github.com/nguyentruongton/bug-on-files-m3"
license=('MIT')
depends=('fuse2' 'webkit2gtk-4.1' 'gtk3' 'openssl' 'librsvg')
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
    install -Dm644 "${srcdir}/icon.png" "${pkgdir}/usr/share/icons/hicolor/512x512/apps/bug-on-files-m3.png"

    # Create desktop entry
    mkdir -p "${pkgdir}/usr/share/applications"
    cat > "${pkgdir}/usr/share/applications/bug-on-files-m3.desktop" << EOF
[Desktop Entry]
Name=Files M3
Exec=/opt/${pkgname}/${pkgname}.AppImage
Icon=bug-on-files-m3
Type=Application
Categories=Utility;FileManager;
Comment=Bug On Files M3 - Material 3 Expressive File Explorer
Terminal=false
StartupWMClass=bug-on-files-m3
EOF
}
