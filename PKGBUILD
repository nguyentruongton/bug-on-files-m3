# Maintainer: Bhima <bhima.work@gmail.com>
pkgname=bug-on-files-m3-bin
pkgver=0.2.0
pkgrel=1
pkgdesc="Bug On Files M3 - Material 3 Expressive File Explorer"
arch=('x86_64')
url="https://github.com/nguyentruongton/bug-on-files-m3"
license=('MIT')
depends=('webkit2gtk-4.1' 'gtk3' 'glib2' 'hicolor-icon-theme')
optdepends=(
    'ffmpeg: video thumbnails and metadata'
    'unzip: .zip extraction'
    'zip: .zip compression'
    'unrar: .rar extraction'
    'xdg-utils: Open With MIME detection'
)
provides=('bug-on-files-m3')
conflicts=('bug-on-files-m3')
options=('!strip')
_deb="Bug.On.Files.M3_${pkgver}_amd64.deb"

# Using GitHub Release source (run `updpkgsums` post-release before AUR publish)
source=("${_deb}::https://github.com/nguyentruongton/bug-on-files-m3/releases/download/v${pkgver}/${_deb}"
        "https://raw.githubusercontent.com/nguyentruongton/bug-on-files-m3/v${pkgver}/assets/icon.png")
noextract=("${_deb}")
sha256sums=('SKIP' 'SKIP')

package() {
    bsdtar -xOf "${srcdir}/${_deb}" 'data.tar.*' | bsdtar -xf - -C "${pkgdir}"

    # Remove any bundler-generated desktop entry duplicates before installing canonical entry
    rm -f "${pkgdir}/usr/share/applications/"*.desktop

    install -Dm644 "${srcdir}/icon.png" "${pkgdir}/usr/share/icons/hicolor/512x512/apps/bug-on-files-m3.png"

    # Install canonical desktop entry
    install -d "${pkgdir}/usr/share/applications"
    cat > "${pkgdir}/usr/share/applications/bug-on-files-m3.desktop" << EOF
[Desktop Entry]
Name=Files M3
Exec=/usr/bin/bug-on-files-m3 %U
Icon=bug-on-files-m3
Type=Application
Categories=Utility;FileManager;
MimeType=inode/directory;
Comment=Bug On Files M3 - Material 3 Expressive File Explorer
Terminal=false
StartupWMClass=bug-on-files-m3
EOF
}
