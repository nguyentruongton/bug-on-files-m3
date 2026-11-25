#!/bin/bash
set -euo pipefail

# Material 3 File Manager Native ELF Installer (/usr/local)

APP_NAME="Files M3"
BINARY_ID="bug-on-files-m3"
BINARY_SOURCE="./src-tauri/target/release/bug-on-files-m3"
ICON_SOURCE="./assets/icon.png"

refresh_caches() {
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database /usr/local/share/applications >/dev/null 2>&1 || true
        update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
    fi
    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
        gtk-update-icon-cache -f /usr/local/share/icons/hicolor >/dev/null 2>&1 || true
        gtk-update-icon-cache -f /usr/share/icons/hicolor >/dev/null 2>&1 || true
    fi
}

if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (e.g. sudo ./install.sh or sudo ./install.sh --uninstall)"
    exit 1
fi

if [ "${1:-}" = "--uninstall" ]; then
    echo "Uninstalling $APP_NAME from /usr/local..."
    rm -f /usr/local/bin/bug-on-files-m3
    rm -f /usr/local/share/applications/bug-on-files-m3.desktop
    rm -f /usr/local/share/icons/hicolor/512x512/apps/bug-on-files-m3.png
    refresh_caches
    echo "Uninstall complete!"
    exit 0
fi

echo "Installing $APP_NAME ($BINARY_ID) to /usr/local..."

if [ ! -f "$BINARY_SOURCE" ]; then
    echo "Error: Native binary not found at $BINARY_SOURCE. Please build first with 'bun run tauri:build:bin'."
    exit 1
fi

install -Dm755 "$BINARY_SOURCE" /usr/local/bin/bug-on-files-m3
echo "Binary installed to /usr/local/bin/bug-on-files-m3"

if [ -f "$ICON_SOURCE" ]; then
    install -Dm644 "$ICON_SOURCE" /usr/local/share/icons/hicolor/512x512/apps/bug-on-files-m3.png
    echo "Icon installed to /usr/local/share/icons/hicolor/512x512/apps/bug-on-files-m3.png"
else
    echo "Warning: Icon not found at $ICON_SOURCE"
fi

install -d /usr/local/share/applications
cat > /usr/local/share/applications/bug-on-files-m3.desktop << EOF
[Desktop Entry]
Name=$APP_NAME
Exec=/usr/local/bin/bug-on-files-m3 %U
Icon=$BINARY_ID
Type=Application
Categories=Utility;FileManager;
MimeType=inode/directory;
Comment=Bug On Files M3 - Material 3 Expressive File Explorer
Terminal=false
StartupWMClass=bug-on-files-m3
EOF
echo "Desktop entry created at /usr/local/share/applications/bug-on-files-m3.desktop"

# Clean up legacy /opt AppImage installation if present and not a symlink
if [[ -d /opt/bug-on-files-m3 && ! -L /opt/bug-on-files-m3 ]]; then
    rm -rf /opt/bug-on-files-m3
    echo "Removed legacy /opt/bug-on-files-m3 directory"
fi

# Clean up legacy untracked /usr/share entries only when not owned by pacman
for legacy_file in \
    /usr/share/applications/bug-on-files-m3.desktop \
    /usr/share/icons/hicolor/512x512/apps/bug-on-files-m3.png
do
    if [ -e "$legacy_file" ]; then
        if ! command -v pacman >/dev/null 2>&1 || ! pacman -Qo "$legacy_file" >/dev/null 2>&1; then
            rm -f "$legacy_file"
            echo "Removed legacy untracked $legacy_file"
        fi
    fi
done

refresh_caches
echo "Installation complete!"
