#!/bin/bash

# Material 3 File Manager Installer

APP_NAME="Files M3"
BINARY_ID="bug-on-files-m3"
INSTALL_DIR="/opt/$BINARY_ID"
ICON_DIR="/usr/share/icons/hicolor/512x512/apps"
DESKTOP_FILE="/usr/share/applications/$BINARY_ID.desktop"
APP_IMAGE_SOURCE=$(ls -1 ./src-tauri/target/release/bundle/appimage/*.AppImage 2>/dev/null | head -n 1)
if [ -z "$APP_IMAGE_SOURCE" ]; then
    APP_IMAGE_SOURCE=$(ls -1 ./release/*Files*.AppImage 2>/dev/null | head -n 1)
fi
ICON_SOURCE="./assets/icon.png"

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root"
  exit 1
fi

echo "Installing $APP_NAME..."

# Create directories
mkdir -p "$INSTALL_DIR"
mkdir -p "$ICON_DIR"

# Copy AppImage
if [ -f "$APP_IMAGE_SOURCE" ]; then
    cp "$APP_IMAGE_SOURCE" "$INSTALL_DIR/$BINARY_ID.AppImage"
    chmod +x "$INSTALL_DIR/$BINARY_ID.AppImage"
    echo "AppImage installed to $INSTALL_DIR/$BINARY_ID.AppImage"
else
    echo "Error: AppImage not found at $APP_IMAGE_SOURCE. Please build the app first with 'bun run tauri:build'."
    exit 1
fi

# Copy Icon
if [ -f "$ICON_SOURCE" ]; then
    cp "$ICON_SOURCE" "$ICON_DIR/$BINARY_ID.png"
    echo "Icon installed to $ICON_DIR/$BINARY_ID.png"
    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
        gtk-update-icon-cache -f /usr/share/icons/hicolor >/dev/null 2>&1 || true
    fi
else
    echo "Warning: Icon not found at $ICON_SOURCE"
fi

# Create Desktop Entry
cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Name=$APP_NAME
Exec="$INSTALL_DIR/$BINARY_ID.AppImage" %U
Icon=$BINARY_ID
Type=Application
Categories=Utility;FileManager;
Comment=Bug On Files M3 - Material 3 Expressive File Explorer
Terminal=false
StartupWMClass=bug-on-files-m3
EOF

echo "Desktop entry created at $DESKTOP_FILE"
echo "Installation complete!"
