<div align="center">
  <img src="src/assets/bug-on-files-m3.svg" alt="Bug On Files M3 Logo" width="128" height="128" />
  <h1>Bug On Files M3</h1>
  <p><strong>Bất Ổn Files M3</strong> · Short name: <code>Files M3</code></p>
  <p>
    A fast, Linux-first desktop file manager built with <strong>Tauri v2 (Rust)</strong>,
    <strong>React 19</strong>, and <strong>Material 3 Expressive</strong>.
  </p>
</div>

---

## About & Fork History

**Bug On Files M3** (*Bất Ổn Files M3*) was originally forked from [`bhimio1/material-3-file-explorer`](https://github.com/bhimio1/material-3-file-explorer) and now runs exclusively on a native **Tauri v2 + Rust** backend with **React 19**, **Material 3 Expressive** (`@bug-on/m3-expressive`), and self-hosted `Material Symbols Rounded` (`@bug-on/m3-fonts`), while supporting dynamic desktop theming (Matugen / Caelestia / GTK) and a logo-driven navy & sky-blue default palette (`#1F305E` / `#99C0FB`).

---

## Tech Stack & UI

| Layer | Technologies |
| --- | --- |
| **Desktop Runtime & Backend** | [Tauri v2](https://v2.tauri.app/) (Rust 2021), `tokio`, `walkdir`, `notify` (file watching), `trash`, `portable-pty`, `image`, `sha2` |
| **Frontend & State** | React 19, TypeScript 5.9, Vite 7 |
| **Design System & Motion** | [`@bug-on/m3-expressive`](https://www.npmjs.com/package/@bug-on/m3-expressive), [`@bug-on/m3-fonts`](https://www.npmjs.com/package/@bug-on/m3-fonts) (`Rounded` only), Tailwind CSS v4, `motion` |
| **Integrated Terminal** | Lazy-loaded `xterm.js` + `xterm-addon-fit` backed by Rust `portable-pty` (`$SHELL` with immediate PTY reclamation on close) |
| **Theming** | Material 3 dynamic tonal palettes (default seed: `#1F305E` Logo Navy) with automatic Matugen / Caelestia / GTK detection |

### UI & Features

- **Material 3 Expressive Interface**: Expressive shapes, connected pill tab bar, collapsible navigation rail & sidebar, in-DOM startup splash overlay, and responsive light/dark themes.
- **Virtualized Grid & List Views**: Viewport-bounded DOM rendering in both Grid and List views, plus inactive-tab `<FileList>` unmounting with synchronous scroll restoration.
- **Off-Main-Thread Rust Backend**: Async `spawn_blocking` filesystem, search, directory-size, thumbnail, and subprocess execution with cooperative cancellation and bounded memory quotas.
- **Unified Omnibar & File Manager Integration**: Address bar, live search, `file://` `%U` desktop launch support, and outbound/inbound file drag-and-drop.
- **Integrated PTY Terminal**: On-demand embedded shell pane synced with your active directory that terminates its shell process on close.
- **Quick Look & Media Routing**: Lazy-loaded preview overlay for text, images, and video backed by the `media://` protocol and disk-bounded thumbnail cache.
- **Safe File Operations**: Trash/restore/purge support, conflict resolution dialogs, and archive extraction/compression.

---

## Download (Pre-built Releases)

Download pre-built packages (`.deb`, `.AppImage`, or Arch Linux `PKGBUILD`) from [GitHub Releases](https://github.com/nguyentruongton/bug-on-files-m3/releases).

---

## Manual Build & Run

### Common Prerequisites

- **Git**
- **Rust & Cargo** via [`rustup`](https://rustup.rs/) (`stable` toolchain)
- **Bun** (recommended, used in `tauri.conf.json`) or **Node.js 20+ / npm**

---

### Arch Linux (Primary Target — Native ELF)

Arch Linux uses a stripped native ELF binary directly (no `fuse2` or `.AppImage` mount overhead).

1. **Install build & runtime dependencies:**

   ```bash
   sudo pacman -S --needed \
     base-devel \
     webkit2gtk-4.1 \
     gtk3 \
     glib2 \
     hicolor-icon-theme \
     curl \
     wget \
     file \
     openssl \
     appmenu-gtk-module \
     libappindicator-gtk3 \
     librsvg \
     xdotool
   ```

2. **Optional runtime CLI tools:**

   ```bash
   sudo pacman -S --needed ffmpeg unzip zip unrar xdg-utils
   ```

   - `ffmpeg`: video thumbnails and metadata (`ffprobe`)
   - `unzip`, `zip`, `unrar`: archive extraction and compression
   - `xdg-utils`: "Open With" MIME type detection (`xdg-mime`)

3. **Optional Arch build optimizations:**

   - **Parallel Rust linking & compilation** (add to `~/.cargo/config.toml`):
     ```bash
     sudo pacman -S --needed mold clang
     ```
     ```toml
     # ~/.cargo/config.toml
     [target.x86_64-unknown-linux-gnu]
     linker = "clang"
     rustflags = ["-C", "link-arg=-fuse-ld=mold"]
     ```
   - The release profile in `src-tauri/Cargo.toml` is already tuned with `codegen-units = 1`, `lto = "thin"`, and `strip = true`.

4. **Install on Arch Linux:**

   - **Option A — Package via `PKGBUILD` (installs to `/usr/bin/bug-on-files-m3`, tracked by `pacman`):**
     ```bash
     makepkg -si
     ```
   - **Option B — Build local native ELF binary & install to `/usr/local/bin/bug-on-files-m3`:**
     ```bash
     bun install
     bun run tauri:build:bin
     sudo ./install.sh
     ```
     To uninstall the local `/usr/local` installation:
     ```bash
     sudo ./install.sh --uninstall
     ```

---

### Ubuntu / Debian / Linux Mint

1. **Install system dependencies:**

   ```bash
   sudo apt update
   sudo apt install -y \
     build-essential \
     libwebkit2gtk-4.1-dev \
     curl \
     wget \
     file \
     libxdo-dev \
     libssl-dev \
     libayatana-appindicator3-dev \
     librsvg2-dev
   ```

---

### Clone, Run & Build

1. **Clone the repository:**

   ```bash
   git clone https://github.com/nguyentruongton/bug-on-files-m3.git
   cd bug-on-files-m3
   ```

2. **Install JavaScript dependencies:**

   ```bash
   bun install
   ```

3. **Run in development mode (Tauri v2):**

   ```bash
   bun run tauri:dev
   ```

4. **Build local native ELF binary (Arch Linux / fast local build):**

   ```bash
   bun run tauri:build:bin
   ```

   The stripped binary is produced at `src-tauri/target/release/bug-on-files-m3`.

5. **Build multi-distro bundles (`.deb`, `.AppImage`):**

   ```bash
   bun run tauri:build
   ```

   Built packages are placed under `src-tauri/target/release/bundle/`.

---

## Dynamic Theming (Matugen / Caelestia / GTK)

By default, **Bug On Files M3** uses the logo's **Logo Navy (`#1F305E`)** and **Sky Blue (`#99C0FB`)** tonal palette. You can also enable system/wallpaper theming via [Matugen](https://github.com/InioX/matugen) (`~/.config/matugen/theme.css`), Caelestia, or GTK theme tokens in Settings.

---

## License

MIT
