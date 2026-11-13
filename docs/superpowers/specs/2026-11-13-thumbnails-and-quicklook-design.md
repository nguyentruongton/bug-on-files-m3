# Thumbnails & Quick Look Media Preview — Design

Date: 2026-11-13 · Status: approved

## Intent and why

Images and videos in the Tauri-based Materials file explorer currently fail to render both as thumbnails in the file list and as previews in Quick Look:
- `toMediaUrl` (`src/utils/quickLook.ts`) produces `media:///abs/path` (empty authority). On Linux WebKitGTK (`wry`), `http::Request::builder().uri(...)` rejects custom-scheme URIs that lack an authority before `media::handle_media_request` (`src-tauri/src/media.rs`) is even invoked. In `FileList.tsx`, the broken `<img>` hides itself via `onError`, leaving a bare colored `ExpressiveShape`; in `QuickLook.tsx`, `onError` switches `previewKind` to `'other'`, showing the generic file placeholder.
- `FileList.tsx` does not render thumbnails for videos at all, loads full-resolution original image files into grid/list items without resizing or caching, and loses the fallback icon whenever an `<img>` fails to load.
- Extended image and video formats (`.heic`, `.heif`, `.avif`, `.tif`, `.tiff`, `.m4v`, `.flv`, `.ts`, `.ogv`, `.wmv`, `.3gp`, `.mpg`, `.mpeg`, etc.) are partially missing from `src/utils/fileUtils.ts` and unsupported natively by WebKitGTK.

The goal is to fix Quick Look media previews and display cached thumbnails for all supported image and video formats in the explorer, with media processing implemented in the Rust backend.

## Goals

- Fix `media://` URI formatting and routing so images, videos, audio, and PDFs load reliably under Tauri/WebKitGTK on Linux (Tauri/Rust backend only; legacy Electron protocol handling is out of scope).
- Generate and disk-cache thumbnails in Rust for both **images** and **videos** across all current and extended formats:
  - Images: `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `bmp`, `ico`, `avif`, `tif`, `tiff`, `heic`, `heif`.
  - Videos: `mp4`, `mkv`, `webm`, `avi`, `mov`, `m4v`, `flv`, `mts`, `m2ts`, `ogv`, `wmv`, `3gp`, `mpg`, `mpeg`, plus `.ts` files when sniffed as MPEG-TS streams (defaulting `.ts` to TypeScript code/text).
- Use pure-Rust decoding/resizing (`image` crate) for common raster image formats, direct pass-through for `.svg`, and `ffmpeg` fallback (`/usr/bin/ffmpeg`) for all video frame extraction and image formats `image` cannot decode (such as `.heic`/`.heif`, or exotic encodings).
- Keep the WebKitGTK UI responsive by handling `media://` asynchronously with bounded concurrency.
- Fix `QuickLook` so:
  - Images that WebKitGTK cannot render natively (e.g. `.heic`, `.tiff`) automatically fall back to a Rust-rendered high-resolution preview (`media://preview/...`).
  - Videos first attempt native `<video>` playback with HTTP Range streaming (`media://localhost/...`) and a pre-generated poster; if WebKitGTK cannot decode the container/codec (`onError`), Quick Look shows a large extracted video poster, basic metadata (resolution, duration, codec/size via `get_video_metadata`), and the **Open** button to launch the system player.

## Non-goals

- On-the-fly video transcoding or remuxing in Rust for unsupported codecs inside Quick Look.
- Thumbnail generation for non-media files (folders, PDFs, text/code, audio, archives).
- A settings UI or background daemon for thumbnail cache management/pruning.
- Legacy Electron backend (`electron/main.ts`) thumbnail/preview parity (Tauri + Rust only).
- Windows or macOS support (Linux Tauri/WebKitGTK only, matching the project scope).

## Anti-goals

- Blocking the GTK/WebKit main thread while decoding large images or running `ffmpeg`.
- Spawning unbounded concurrent `ffmpeg` processes when scrolling a folder with hundreds of videos.
- Passing binary thumbnail payloads as base64 strings through Tauri `invoke` IPC.
- Dropping a valid image or video back to the generic `'other'` file placeholder when WebKitGTK lacks a native decoder for that format.

## Constraints

- **Linux / Tauri 2 (`wry` / WebKitGTK 4.1):** Custom URI schemes parsed by `wry` (`http::Uri`) require a non-empty authority (e.g., `media://localhost/...`, `media://thumb/...`, `media://preview/...`).
- **CSP (`src-tauri/tauri.conf.json`):** Already allows `img-src 'self' media: data: blob:` and `media-src 'self' media: blob: data:`. Extending `media://` authorities requires no CSP relaxation.
- **External CLI dependency:** System `ffmpeg` and `ffprobe` (available at `/usr/bin/ffmpeg` and `/usr/bin/ffprobe`) are used as fallback/video tools; if missing at runtime on a target system, image thumbnails via `image` must still work and missing `ffmpeg`/`ffprobe` must degrade gracefully without panicking.
- **Command Parity:** Adding a Tauri command must keep `COMMAND_MAP` (`src/api/commandMap.ts`), `IApi` (`src/api/types.ts`), `createTauriAdapter` (`src/api/tauriAdapter.ts`), `src-tauri/src/lib.rs`, and `src/api/__tests__/commandParity.test.ts` in 1:1 sync.
- **UI Consistency:** Thumbnails in `FileList.tsx` stay inside the existing `ExpressiveShape` containers (`clover4Leaf` for images, `pill` for videos) and preserve `loading="lazy"` / virtualized list performance.

## Approaches considered

1. **Approach 1 (Chosen): Extend the `media://` custom protocol asynchronously with authority-based routing + one `get_video_metadata` IPC command.**
   - Routes all binary media, thumbnails, and converted image previews over `media://` (`localhost` = raw file with Range support, `thumb` = cached thumbnail, `preview` = cached high-res converted image preview).
   - Uses `register_asynchronous_uri_scheme_protocol` in `src-tauri/src/lib.rs` with a bounded worker pool/semaphore.
   - Adds one lightweight Tauri command (`get_video_metadata`) invoked only when Quick Look needs the video fallback card.
   - *Trade-off:* Keeps zero IPC binary serialization overhead, preserves browser `<img>` lazy loading and HTTP caching, and reuses existing `media.rs` Range logic; requires updating `toMediaUrl` and its unit tests from `media:///...` to `media://localhost/...`.
2. **Approach 2: Fetch thumbnails via Tauri `invoke` returning byte arrays / Blob URLs.**
   - *Rejected:* Forces manual `URL.createObjectURL` / `revokeObjectURL` lifecycle management inside virtualized list rows (prone to flicker and leaks) and bypasses native `<img>` lazy-loading.
3. **Approach 3: Run an embedded HTTP server on `127.0.0.1:<port>` in Rust.**
   - *Rejected:* Duplicates `media.rs`, introduces port binding, per-session auth token handling, and CSP changes with no benefit over async `media://`.

## Design

### 1. URI Scheme & Routing (`src/utils/quickLook.ts` & `src-tauri/src/media.rs`)

- **URL builders in `src/utils/quickLook.ts`:**
  - `toMediaUrl(path)` -> `media://localhost<encoded_segments>` (e.g. `media://localhost/home/u/a%20b.png`).
  - `toThumbnailUrl(path, size?: 'grid' | 'poster')` -> `media://thumb<encoded_segments>?size=grid|poster` (default `grid`).
  - `toPreviewUrl(path)` -> `media://preview<encoded_segments>`.
  - Update `src/utils/__tests__/quickLook.test.ts` to assert `media://localhost/...`, `media://thumb/...`, `media://preview/...`, special-character encoding (`#`, `?`, `%`, spaces, Unicode), and round-trip decoding.
- **Rust URI parsing (`src-tauri/src/media.rs`):**
  - Parse the `media://` request into `(MediaRoute, PathBuf, QueryParams)`:
    - `localhost` (or legacy empty/single-slash paths for backwards compatibility in parser tests): `MediaRoute::Raw` -> existing `handle_media_request` behavior (full read up to `MAX_FULL_RESPONSE_BYTES` or `206 Partial Content` Range streaming).
    - `thumb`: `MediaRoute::Thumbnail { size: ThumbnailSize }` (`Grid` = 256px max edge, `Poster` = 1280px max edge).
    - `preview`: `MediaRoute::Preview` (max 1920px edge converted JPEG/PNG for non-web-native images).

### 2. Async Protocol & Concurrency (`src-tauri/src/lib.rs`)

- Replace `.register_uri_scheme_protocol("media", ...)` with `.register_asynchronous_uri_scheme_protocol("media", |_ctx, req, responder| ...)`.
- Dispatch request handling off the GTK/WebKit main thread onto a bounded concurrency worker/semaphore (e.g. via `tauri::async_runtime::spawn_blocking` guarded by a `Semaphore` for thumbnail/preview generation, limiting concurrent `ffmpeg`/decode jobs to e.g. 4–6) so fast raw file/cache hits stay snappy and `ffmpeg` never floods CPU/RAM in large folders.
- Maintain `Cache-Control` / `Access-Control-Allow-Origin: *` headers on responses.

### 3. Rust Thumbnail & Preview Pipeline (`src-tauri/src/thumbnails.rs`)

- **Cache layout & key:**
  - Store generated thumbnails/previews under `dirs::cache_dir()/materials/thumbnails/` (falling back to `std::env::temp_dir()` if `cache_dir` is unavailable).
  - Key = deterministic hash (e.g. SHA-256 or FNV/SipHash — builder's choice of fast hash, SHA-256 or blake3/sha2 preferred for collision safety) of `(canonical_or_abs_path, file_size, mtime_nanos, route_kind_and_bucket)`.
  - Write outputs atomically (write to a unique `.tmp` file in the cache dir, then `std::fs::rename` to the final `.jpg` / `.png` path) so concurrent requests for the same file never serve half-written images.
  - Deduplicate in-flight generation for identical cache keys (or let atomic rename + double-checked cache lookup handle rare races cleanly).
- **SVG handling:**
  - `.svg` files bypass raster decoding/resizing for both `thumb` and `preview` and return the original SVG bytes (`image/svg+xml`, capped at `MAX_FULL_RESPONSE_BYTES`).
- **Image decoding & resizing:**
  - Attempt pure-Rust decoding first with the `image` crate (`png`, `jpeg`, `gif`, `webp`, `bmp`, `ico`, `tiff`; `avif` via `image` or `ffmpeg` fallback — builder's choice to keep build clean without C `-dev` headers).
  - Apply EXIF orientation if present before resizing (`image` decoder orientation / metadata or `ffmpeg` auto-orient) so portrait phone photos aren't rotated sideways.
  - Resize preserving aspect ratio (`thumbnail` / Lanczos3 or Triangle filter) so neither dimension exceeds the target bucket (`256` for `Grid`, `1280` for `Poster`, `1920` for `Preview`). Do not upscale small images.
  - Encode thumbnail/preview as JPEG (quality ~85, or PNG if transparent/requested — JPEG is fast and compact for grid; PNG/WebP optional if alpha preservation is desired for small icons).
  - If `image` fails to decode (e.g. `.heic`, `.heif`, unsupported subformat, or malformed header), fall back to `ffmpeg`:
    `ffmpeg -hide_banner -loglevel error -y -i <input> -frames:v 1 -vf "scale='min(MAX,iw)':'min(MAX,ih)':force_original_aspect_ratio=decrease" <out.jpg>`
- **Video frame extraction:**
  - Use `ffmpeg` with fast input seeking: try `-ss 1` before `-i <input>` (`-frames:v 1`, scaled preserving aspect ratio to `256px` for `Grid` or `1280px` for `Poster`).
  - If seeking to `1s` produces no frame (e.g. video shorter than 1 second), retry once at `-ss 0`.
  - If `ffmpeg` is missing or exits non-zero (corrupt file), return `404` / `422` so the frontend displays its fallback icon cleanly.

### 4. Format Support Alignment & `.ts` Content Sniffing (`src/utils/fileUtils.ts`, `src-tauri/src/fs_ops.rs`, `src-tauri/src/media.rs`)

- **Extension sets in `src/utils/fileUtils.ts`:**
  - `IMAGE_EXTENSIONS`: `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `bmp`, `ico`, `avif`, `tif`, `tiff`, `heic`, `heif`.
  - `VIDEO_EXTENSIONS`: `mp4`, `mkv`, `webm`, `avi`, `mov`, `m4v`, `flv`, `mts`, `m2ts`, `ogv`, `wmv`, `3gp`, `mpg`, `mpeg`.
  - **Keep `ts` out of `VIDEO_EXTENSIONS`** and keep `ts` in `CODE_EXTENSIONS` / `TEXT_EXTENSIONS` so TypeScript files remain `'Code'` / `'text'` by default (preserving existing tests in `fileUtils.test.ts` and `quickLook.test.ts`).
- **MPEG-TS `.ts` sniffing in Rust (`fs_ops.rs`, `search.rs`, `media.rs`):**
  - Add an optional `media_kind: Option<String>` (`#[serde(skip_serializing_if = "Option::is_none")]`, camelCase `mediaKind?: 'video'` on `IFile` in `src/types/files.ts` and mapped in `src/api/tauriAdapter.ts`).
  - Only when a non-directory entry has extension `.ts` (case-insensitive), read up to the first ~576 bytes in Rust and check for MPEG-TS sync byte `0x47` at packet boundaries:
    - Standard 188-byte TS packets: `buf[0] == 0x47 && buf[188] == 0x47` (and `buf[376] == 0x47` when `len >= 377`), or 192-byte BDAV/M2TS packets (`buf[4] == 0x47 && buf[196] == 0x47`). Checking repeated sync bytes at packet stride avoids false positives on TypeScript files starting with `'G'` (`0x47`).
    - When matched, set `media_kind = Some("video".into())`; otherwise leave `None` (treated as TypeScript code/text).
  - In `src/utils/fileUtils.ts` & `src/utils/quickLook.ts`:
    - Update `getSemanticGroup(file)`, `getFileIconInfo(file)`, `getPreviewKind(file)`, and `getFileGroupShapePair` / `FileList.tsx` to treat `file.mediaKind === 'video'` as video (taking precedence over `.ts` code/text classification), while keeping string-only `isVideoFile(filename)` unchanged for existing callers/tests.
- **MIME mapping in `src-tauri/src/media.rs`:**
  - Update `guess_mime` (or `guess_mime_for_path` when reading `.ts` on disk) to cover all extended image/video formats (`image/heic`, `image/heif`, `video/x-flv`, `video/mp2t` for `.mts`/`.m2ts`/sniffed `.ts`, `video/x-ms-wmv`, `video/3gpp`, `video/mpeg`, `video/mp4` for `m4v`, etc.).

### 5. Video Metadata Command (`get_video_metadata`)

- Add `get_video_metadata(path: String)` in Rust (e.g. `src-tauri/src/commands/fs.rs` or `thumbnails.rs`):
  - Runs `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name -show_entries format=duration -of json <path>` (with a short timeout/error guard so a bad file never hangs).
  - Returns `VideoMetadata { width: Option<u32>, height: Option<u32>, duration_seconds: Option<f64>, codec: Option<String> }` (camelCase in TS: `durationSeconds`).
  - Gracefully returns `null` / empty fields if `ffprobe` is missing or fails.
- Wire across `src/api/types.ts`, `src/api/commandMap.ts`, `src/api/tauriAdapter.ts`, `src-tauri/src/lib.rs`, and update `src/api/__tests__/commandParity.test.ts` (33 commands).

### 6. Frontend UI Updates (`FileList.tsx` & `QuickLook.tsx`)

- **`FileList.tsx` (both `FileListRow` list view and Grid view):**
  - Render thumbnails for both images (`isImageFile(file.name)`) and videos (`isVideoFile(file.name) || file.mediaKind === 'video'`) using `toThumbnailUrl(file.path, 'grid')`.
  - Fix the broken error fallback: track failed thumbnail state per item/path (resetting if `file.path` changes) so if an `<img>` fails `onError`, `FileList` renders the fallback `<Icon name={iconInfo.icon} ... />` inside `ExpressiveShape` instead of hiding `<img>` and leaving an empty shape.
  - For videos whose thumbnail has loaded, overlay a subtle play badge (e.g. centered/bottom-right translucent pill or circle with `play_arrow` icon) inside the shape so videos remain visually distinguishable from images.
- **`QuickLook.tsx`:**
  - **Images (`previewKind === 'image'`):**
    - Track fallback stage per `file.path`: `'raw'` (`toMediaUrl(file.path)`) -> `'preview'` (`toPreviewUrl(file.path)`) -> `'error'` (only fall back to `'other'` placeholder if both raw and Rust-converted preview fail).
    - Also allow directly starting with `'preview'` for extensions known to be unsupported in WebKitGTK (like `.heic`, `.heif`, `.tif`, `.tiff`) to avoid a double request/flash, with `'raw'` -> `'preview'` fallback still active for edge cases (e.g., CMYK JPEG or AVIF if unsupported).
  - **Videos (`previewKind === 'video'`):**
    - Render `<video key={file.path} src={toMediaUrl(file.path)} poster={toThumbnailUrl(file.path, 'poster')} controls autoPlay={false} ... />`.
    - If `<video>` triggers `onError`, switch to an inline **Video Poster Fallback** state (instead of `'other'`):
      - Fetch `api.getVideoMetadata(file.path)` (guarded with `typeof api?.getVideoMetadata === 'function'`).
      - Show the large poster thumbnail (`toThumbnailUrl(file.path, 'poster')`, with clean icon fallback if even poster fails), a concise label ("Inline playback unavailable for this format"), metadata pills (resolution e.g. `1920×1080`, formatted duration e.g. `02:14`, codec, file size), and a prominent **Open** button (`onOpen(file)`) to open in the system player.

## What's left to the builder

- Exact Rust module organization (`thumbnails.rs` vs splitting `media.rs`) and choice of crates for hashing (`sha2` / `blake3`) and `image` feature flags (e.g., whether `avif` uses `image`'s `avif-native`/`rav1d` or delegates cleanly to `ffmpeg` to keep dependencies minimal).
- Exact cache size/eviction policy (optional LRU cap or keeping simple disk cache files) and JPEG encoding quality / PNG alpha handling.
- Exact `ffmpeg` process timeout / cancellation guard and concurrency limit tuning (e.g., 4–6 permits).
- Exact visual styling of the video play badge in `FileList.tsx` and the poster + metadata card in `QuickLook.tsx` using existing `@bug-on/m3-expressive` / Tailwind tokens.
- Comprehensive Rust tests (`cargo test`, `cargo clippy --all-targets -- -D warnings`) and frontend unit tests (`bun test`, `bunx tsc -b`) covering URI parsing, thumbnail generation & caching, fallback chains, format extension parity, and Quick Look error fallback states.
