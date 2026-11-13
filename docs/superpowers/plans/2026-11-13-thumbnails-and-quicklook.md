# Thumbnails & Quick Look Media Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken `media://` URIs on Linux WebKitGTK, generate and disk-cache Rust-backed thumbnails for all current and extended image/video formats (including MPEG-TS `.ts` sniffing), and upgrade `FileList` and `QuickLook` to display thumbnails and graceful previews/poster fallbacks.

**Architecture:** Extend the existing `media://` custom protocol in `src-tauri` using authority-based routing (`media://localhost/...` for raw files with Range support, `media://thumb/...` for cached grid/poster thumbnails, `media://preview/...` for high-res converted image previews) executed asynchronously via `register_asynchronous_uri_scheme_protocol` with bounded concurrency. Rust uses the `image` crate for common raster images, passes `.svg` through directly, falls back to `/usr/bin/ffmpeg` for videos and unsupported image codecs (`.heic`/`.heif`), and provides one new `get_video_metadata` Tauri command (`ffprobe`) for Quick Look's video poster fallback card.

**Tech Stack:** Rust (`tauri` 2, `image`, `sha2`, `tokio`, `dirs`), system `ffmpeg`/`ffprobe`, TypeScript, React 19, `@bug-on/m3-expressive`, `bun test`, `cargo test`.

**Spec:** [2026-11-13-thumbnails-and-quicklook-design.md](file:///home/stark/Documents/GitHub/material-3-file-explorer/docs/superpowers/specs/2026-11-13-thumbnails-and-quicklook-design.md)

## Global Constraints

- Linux / Tauri 2 (`wry` / WebKitGTK 4.1): custom URI scheme requests require a non-empty authority (`media://localhost/...`, `media://thumb/...`, `media://preview/...`).
- Legacy Electron backend (`electron/main.ts`) is out of scope; focus on Tauri + Rust only.
- CSP in `src-tauri/tauri.conf.json` already allows `media:` for `img-src`, `media-src`, and `frame-src`; do not weaken CSP.
- System `ffmpeg` and `ffprobe` are optional at runtime: missing binaries must degrade gracefully without panicking.
- Maintain 1:1 parity between `COMMAND_MAP` (`src/api/commandMap.ts`) and `tauri::generate_handler!` (`src-tauri/src/lib.rs`), verified by `src/api/__tests__/commandParity.test.ts`.
- Keep thumbnails inside `ExpressiveShape` containers in `FileList.tsx` and preserve `loading="lazy"` and existing M3 Expressive tokens.

## Review Focus

- TypeScript `.ts` files starting with `'G'` (`0x47`) or shorter than 189 bytes must NOT be misclassified as MPEG-TS video -> covered by Task 1 `sniff_ts_media_kind` unit tests.
- Zero-byte or corrupt image/video files must return clean error responses without panicking and reveal the fallback `<Icon>` inside `ExpressiveShape` instead of a blank shape -> covered by Task 2 and Task 6 tests.
- Cached thumbnails must invalidate when a file at the same path changes `mtime` or `size` -> covered by Task 2 cache-key unit tests.
- Filenames containing `#`, `?`, `%`, spaces, and Unicode combined with `?size=poster` query strings must resolve cleanly in `media://thumb/...` and `media://preview/...` -> covered by Task 3 URI routing tests.
- Rapid file switching in `QuickLook` must not leak stale `mediaError` or stale async `getVideoMetadata` results onto the newly displayed file -> covered by Task 7 QuickLook tests.

---

### Task 1: Rust `.ts` MPEG-TS Sniffing & `FileEntry.media_kind`

**Files:**
- Modify: `src-tauri/src/fs_ops.rs`
- Modify: `src-tauri/src/search.rs`

**Interfaces:**
- Produces:
  - `FileEntry` in `src-tauri/src/fs_ops.rs` with `#[serde(skip_serializing_if = "Option::is_none")] pub media_kind: Option<String>`
  - `pub fn sniff_ts_media_kind(path: &std::path::Path) -> Option<String>` in `src-tauri/src/fs_ops.rs`

- [ ] **Step 1: Write failing tests for `.ts` sniffing in `src-tauri/src/fs_ops.rs`**

```rust
#[test]
fn sniff_ts_media_kind_distinguishes_mpeg_ts_from_typescript() {
    let dir = tempfile::tempdir().unwrap();

    // TypeScript file starting with 'G' (0x47) must stay None
    let ts_code = dir.path().join("generator.ts");
    std::fs::write(&ts_code, "Generator function export const x = 1;\n".repeat(12)).unwrap();
    assert_eq!(sniff_ts_media_kind(&ts_code), None);

    // Short TypeScript file (< 189 bytes) starting with 'G' must stay None
    let short_ts = dir.path().join("short.ts");
    std::fs::write(&short_ts, b"G").unwrap();
    assert_eq!(sniff_ts_media_kind(&short_ts), None);

    // Non-.ts file with 0x47 sync bytes is ignored (None)
    let txt_file = dir.path().join("data.txt");
    let mut ts_bytes = vec![0u8; 564];
    ts_bytes[0] = 0x47;
    ts_bytes[188] = 0x47;
    ts_bytes[376] = 0x47;
    std::fs::write(&txt_file, &ts_bytes).unwrap();
    assert_eq!(sniff_ts_media_kind(&txt_file), None);

    // Standard 188-byte MPEG-TS stream in .ts file returns Some("video")
    let ts_video = dir.path().join("clip.ts");
    std::fs::write(&ts_video, &ts_bytes).unwrap();
    assert_eq!(sniff_ts_media_kind(&ts_video), Some("video".to_string()));

    // 192-byte BDAV MPEG-TS stream (4-byte timestamp + 0x47 sync) returns Some("video")
    let bdav_video = dir.path().join("bdav.ts");
    let mut bdav_bytes = vec![0u8; 576];
    bdav_bytes[4] = 0x47;
    bdav_bytes[196] = 0x47;
    bdav_bytes[388] = 0x47;
    std::fs::write(&bdav_video, &bdav_bytes).unwrap();
    assert_eq!(sniff_ts_media_kind(&bdav_video), Some("video".to_string()));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml sniff_ts_media_kind`
Expected: FAIL with `cannot find function sniff_ts_media_kind`.

- [ ] **Step 3: Implement `sniff_ts_media_kind` and `FileEntry.media_kind` in `src-tauri/src/fs_ops.rs` and `src-tauri/src/search.rs`**

1. In `src-tauri/src/fs_ops.rs`, add `#[serde(skip_serializing_if = "Option::is_none")] pub media_kind: Option<String>` to `FileEntry`.
2. Implement `pub fn sniff_ts_media_kind(path: &std::path::Path) -> Option<String>`:
   - Return `None` immediately unless extension (case-insensitive) is `"ts"`.
   - Open file and read up to 576 bytes (`let mut buf = [0u8; 576]`).
   - Return `Some("video".to_string())` when `is_mpeg_ts_sync(&buf[..n])` matches:
     - 188-byte packet stride: `n >= 377 && buf[0] == 0x47 && buf[188] == 0x47 && buf[376] == 0x47`, or `(n >= 189 && n < 377 && buf[0] == 0x47 && buf[188] == 0x47 && buf[..n].contains(&0))`.
     - 192-byte BDAV packet stride: `n >= 389 && buf[4] == 0x47 && buf[196] == 0x47 && buf[388] == 0x47`.
   - Populate `media_kind: if is_directory { None } else { sniff_ts_media_kind(&full_path) }` in `fs_ops::list_dir` and `search::search` (and in any existing Rust test `FileEntry` literals if any).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml fs_ops search`
Expected: PASS (all existing `fs_ops`/`search` tests + `sniff_ts_media_kind_distinguishes_mpeg_ts_from_typescript`).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/fs_ops.rs src-tauri/src/search.rs
git commit -m "feat(rust): add MPEG-TS .ts content sniffing to FileEntry"
```

---

### Task 2: Rust Thumbnail & Preview Generator with Disk Cache + Video Metadata Probe

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/thumbnails.rs`
- Modify: `src-tauri/src/lib.rs` (declare `pub mod thumbnails;` so `cargo test` compiles it)

**Interfaces:**
- Produces in `src-tauri/src/thumbnails.rs`:
  - `pub enum ThumbnailSize { Grid, Poster }` (`Grid` max edge `256`, `Poster` max edge `1280`)
  - `pub struct GeneratedMedia { pub bytes: Vec<u8>, pub content_type: &'static str }`
  - `pub struct VideoMetadata { pub width: Option<u32>, pub height: Option<u32>, pub duration_seconds: Option<f64>, pub codec: Option<String> }` (`#[serde(rename_all = "camelCase")]`)
  - `pub fn cache_key(path: &std::path::Path, size: u64, mtime_nanos: u128, tag: &str) -> String`
  - `pub fn get_or_generate_thumbnail_in(path: &std::path::Path, size: ThumbnailSize, cache_dir: &std::path::Path) -> Result<GeneratedMedia, ThumbnailError>`
  - `pub fn get_or_generate_thumbnail(path: &std::path::Path, size: ThumbnailSize) -> Result<GeneratedMedia, ThumbnailError>`
  - `pub fn get_or_generate_preview_in(path: &std::path::Path, cache_dir: &std::path::Path) -> Result<GeneratedMedia, ThumbnailError>`
  - `pub fn get_or_generate_preview(path: &std::path::Path) -> Result<GeneratedMedia, ThumbnailError>`
  - `pub fn probe_video_metadata(path: &std::path::Path) -> Option<VideoMetadata>`

- [ ] **Step 1: Add dependencies to `src-tauri/Cargo.toml`**

Add:
- `image = { version = "0.25", default-features = false, features = ["png", "jpeg", "gif", "webp", "bmp", "ico", "tiff"] }`
- `sha2 = "0.10"`
- Ensure `tokio = { version = "1", features = ["sync"] }` stays present (for Task 3 async semaphore).

- [ ] **Step 2: Write failing unit tests in `src-tauri/src/thumbnails.rs`**

Include tests covering:
```rust
#[test]
fn cache_key_changes_with_mtime_size_and_tag() {
    let p = Path::new("/tmp/photo.png");
    let k1 = cache_key(p, 100, 1000, "thumb-grid");
    let k2 = cache_key(p, 101, 1000, "thumb-grid");
    let k3 = cache_key(p, 100, 2000, "thumb-grid");
    let k4 = cache_key(p, 100, 1000, "thumb-poster");
    assert_ne!(k1, k2);
    assert_ne!(k1, k3);
    assert_ne!(k1, k4);
    assert_eq!(k1, cache_key(p, 100, 1000, "thumb-grid"));
}

#[test]
fn svg_passes_through_without_rasterizing() {
    let dir = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let svg_path = dir.path().join("icon.svg");
    let svg = b"<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'></svg>";
    std::fs::write(&svg_path, svg).unwrap();

    let out = get_or_generate_thumbnail_in(&svg_path, ThumbnailSize::Grid, cache.path()).unwrap();
    assert_eq!(out.content_type, "image/svg+xml");
    assert_eq!(out.bytes, svg);
}

#[test]
fn raster_image_is_resized_and_cached_on_disk() {
    let dir = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let img_path = dir.path().join("large.png");
    let img = image::DynamicImage::new_rgba8(800, 400);
    img.save(&img_path).unwrap();

    let out = get_or_generate_thumbnail_in(&img_path, ThumbnailSize::Grid, cache.path()).unwrap();
    assert_eq!(out.content_type, "image/jpeg");
    let decoded = image::load_from_memory(&out.bytes).unwrap();
    assert_eq!(decoded.width(), 256);
    assert_eq!(decoded.height(), 128);

    // Cache hit returns identical bytes even if checked directly via cache file presence
    let cached_files: Vec<_> = std::fs::read_dir(cache.path()).unwrap().collect();
    assert_eq!(cached_files.len(), 1);
    let out2 = get_or_generate_thumbnail_in(&img_path, ThumbnailSize::Grid, cache.path()).unwrap();
    assert_eq!(out2.bytes, out.bytes);
}

#[test]
fn corrupt_or_empty_image_returns_error_cleanly() {
    let dir = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let bad_path = dir.path().join("broken.png");
    std::fs::write(&bad_path, b"").unwrap();

    let res = get_or_generate_thumbnail_in(&bad_path, ThumbnailSize::Grid, cache.path());
    assert!(res.is_err());
}

#[test]
fn parse_ffprobe_json_extracts_metadata() {
    let raw = r#"{
        "streams": [{"width": 1920, "height": 1080, "codec_name": "h264"}],
        "format": {"duration": "125.42"}
    }"#;
    let meta = parse_ffprobe_json(raw).unwrap();
    assert_eq!(meta.width, Some(1920));
    assert_eq!(meta.height, Some(1080));
    assert_eq!(meta.codec.as_deref(), Some("h264"));
    assert!((meta.duration_seconds.unwrap() - 125.42).abs() < 0.001);
}
```
Also include an `ffmpeg` video frame extraction test gated safely if `/usr/bin/ffmpeg` is available (generating a tiny 1-second test mp4 with `ffmpeg -f lavfi -i color=c=blue:s=320x240:d=0.5`, calling `get_or_generate_thumbnail_in`, verifying JPEG dimensions and `probe_video_metadata`).

- [ ] **Step 3: Run tests to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml thumbnails`
Expected: FAIL (module/functions missing).

- [ ] **Step 4: Implement `src-tauri/src/thumbnails.rs`**

Key implementation rules:
- Default cache directory: `dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join("materials").join("thumbnails")`.
- `cache_key`: SHA-256 hex digest over path string, `size`, `mtime_nanos`, and `tag`.
- `svg` files: read bytes up to `crate::media::MAX_FULL_RESPONSE_BYTES` and return `image/svg+xml` directly.
- Raster images:
  - Open via `image::ImageReader::open(path)?.with_guessed_format()?.decode()`, reading EXIF orientation via `decoder.orientation()` (from `image::ImageDecoder::orientation`) and applying `img.apply_orientation(orientation)` before resizing.
  - Only downscale (`if w > max_dim || h > max_dim { img.resize(max_dim, max_dim, image::imageops::FilterType::Triangle) }`).
  - Encode as JPEG (`image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 85)` after `img.to_rgb8()`).
  - If `image` fails (e.g., `.heic`, `.heif`, unsupported subformat), fall back to `ffmpeg`:
    `ffmpeg -hide_banner -loglevel error -y -i <input> -frames:v 1 -vf scale='min(MAX,iw)':'min(MAX,ih)':force_original_aspect_ratio=decrease -q:v 3 <tmp_out.jpg>` with a 15-second wait timeout (polling `child.try_wait()` or bounded loop so a hung/corrupt stream terminates and cleans up).
- Video files (detected by extension or `crate::fs_ops::sniff_ts_media_kind(path)`):
  - Run `ffmpeg` with `-ss 1 -i <input> -frames:v 1 -vf scale='min(MAX,iw)':'min(MAX,ih)':force_original_aspect_ratio=decrease -q:v 3 <tmp_out.jpg>`; if output file wasn't created or is empty (e.g. clip shorter than 1s), retry with `-ss 0`.
- Atomic write to cache: write `<cache_dir>/<key>.<pid>.<counter>.tmp.jpg` and `std::fs::rename` to `<cache_dir>/<key>.jpg`. Clean up `.tmp.jpg` on failure.
- `probe_video_metadata(path)`: run `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name -show_entries format=duration -of json <path>` with timeout guard, parse via `parse_ffprobe_json` using `serde_json::Value`. Return `None` if `ffprobe` is missing, times out, or returns invalid/empty data.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml thumbnails`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/thumbnails.rs src-tauri/src/lib.rs
git commit -m "feat(rust): add disk-cached thumbnail/preview generator and video metadata probe"
```

---

### Task 3: Rust `media://` Routing, Expanded MIME Types & Async Protocol Registration

**Files:**
- Modify: `src-tauri/src/media.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `fs_ops::sniff_ts_media_kind`, `thumbnails::{ThumbnailSize, get_or_generate_thumbnail, get_or_generate_preview}`
- Produces:
  - `MediaRoute` enum (`Raw`, `Thumbnail(ThumbnailSize)`, `Preview`) and `parse_media_route(uri: &str) -> Option<(MediaRoute, PathBuf)>` in `src-tauri/src/media.rs`
  - `guess_mime_for_path(path: &std::path::Path) -> &'static str`
  - `handle_media_request(req: &Request<Vec<u8>>) -> Response<Vec<u8>>` routing `Raw` / `Thumbnail` / `Preview`
  - Asynchronous `register_asynchronous_uri_scheme_protocol("media", ...)` in `src-tauri/src/lib.rs` with bounded `Semaphore` concurrency.

- [ ] **Step 1: Write failing tests in `src-tauri/src/media.rs`**

Add tests covering:
- `parse_media_route` parses:
  - `media://localhost/home/u/a%20b%231%3F.png` -> `(MediaRoute::Raw, "/home/u/a b#1?.png")`
  - `media://thumb/home/u/a%20b%231%3F.mp4?size=grid` -> `(MediaRoute::Thumbnail(ThumbnailSize::Grid), "/home/u/a b#1?.mp4")`
  - `media://thumb/home/u/clip.mkv?size=poster` -> `(MediaRoute::Thumbnail(ThumbnailSize::Poster), "/home/u/clip.mkv")`
  - `media://preview/home/u/photo.heic` -> `(MediaRoute::Preview, "/home/u/photo.heic")`
  - Special filename `?` encoded as `%3F` stays in path while trailing `?size=poster` is stripped as query string.
- `guess_mime` covers `.heic` (`image/heic`), `.heif` (`image/heif`), `.m4v` (`video/mp4`), `.flv` (`video/x-flv`), `.mts`/`.m2ts` (`video/mp2t`), `.wmv` (`video/x-ms-wmv`), `.3gp` (`video/3gpp`), `.mpg`/`.mpeg` (`video/mpeg`).
- `guess_mime_for_path` returns `video/mp2t` for a `.ts` file with MPEG-TS sync bytes and `text/javascript` (or `text/plain`) for a `.ts` TypeScript text file.
- `handle_media_request` with `media://thumb/...` returns `200 OK` with `image/jpeg` for a real temporary PNG file and `404` for nonexistent file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml media::tests`
Expected: FAIL (`parse_media_route` / new routes not defined).

- [ ] **Step 3: Implement routing in `src-tauri/src/media.rs` and async protocol in `src-tauri/src/lib.rs`**

1. In `src-tauri/src/media.rs`:
   - Implement `parse_media_route(uri: &str) -> Option<(MediaRoute, PathBuf)>`, extracting authority (`localhost`, `thumb`, `preview`) and query parameter `size` (`poster` -> `ThumbnailSize::Poster`, default `Grid`), percent-decoding path segments while keeping legacy `extract_media_path` tests passing.
   - Update `guess_mime` and add `guess_mime_for_path(path: &Path)`.
   - In `handle_media_request(req)`:
     - Dispatch `MediaRoute::Raw` to the existing raw/Range streaming handler (using `guess_mime_for_path(&path)`).
     - Dispatch `MediaRoute::Thumbnail(size)` to `thumbnails::get_or_generate_thumbnail(&path, size)` -> `200 OK` with `Content-Type`, `Cache-Control: max-age=3600`, `Access-Control-Allow-Origin: *`, or `404` on error.
     - Dispatch `MediaRoute::Preview` to `thumbnails::get_or_generate_preview(&path)` with the same response headers.
2. In `src-tauri/src/lib.rs`:
   - Create `let media_semaphore = Arc::new(tokio::sync::Semaphore::new(4));` in `run()`.
   - Replace `.register_uri_scheme_protocol("media", ...)` with `.register_asynchronous_uri_scheme_protocol("media", move |_ctx, req, responder| { ... })`:
     - Parse `parse_media_route` fast; for `Raw` requests spawn onto `tauri::async_runtime::spawn_blocking` directly (no heavy CPU semaphore needed for Range reads), and for `Thumbnail` / `Preview` acquire a permit from `media_semaphore` inside `tauri::async_runtime::spawn_blocking` (or async task wrapping `spawn_blocking`) before calling `media::handle_media_request(&req)` and invoking `responder.respond(resp)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml media`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/media.rs src-tauri/src/lib.rs
git commit -m "feat(rust): route media:// thumb/preview asynchronously with expanded MIME types"
```

---

### Task 4: `get_video_metadata` Command & Frontend/Backend API Parity

**Files:**
- Modify: `src-tauri/src/commands/system.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types/files.ts`
- Modify: `src/api/types.ts`
- Modify: `src/api/commandMap.ts`
- Modify: `src/api/tauriAdapter.ts`
- Modify: `src/api/__tests__/commandParity.test.ts`
- Modify: `src/api/__tests__/tauriAdapter.test.ts`

**Interfaces:**
- Consumes: `thumbnails::{VideoMetadata, probe_video_metadata}`
- Produces:
  - `IFile.mediaKind?: 'video'` in `src/types/files.ts`
  - `VideoMetadata` interface in `src/api/types.ts`
  - `IApi.getVideoMetadata: (path: string) => Promise<VideoMetadata | null>`
  - `COMMAND_MAP.getVideoMetadata = 'get_video_metadata'`

- [ ] **Step 1: Write failing tests in `src/api/__tests__/commandParity.test.ts` and `src/api/__tests__/tauriAdapter.test.ts`**

1. In `src/api/__tests__/commandParity.test.ts`, update expected count `32` -> `33`.
2. In `src/api/__tests__/tauriAdapter.test.ts`:
   - Assert `listDir` preserves `mediaKind: 'video'` when `entry.mediaKind === 'video'` (or `media_kind === 'video'`) and leaves `mediaKind` `undefined` otherwise.
   - Assert `adapter.getVideoMetadata('/tmp/clip.mkv')` invokes `'get_video_metadata'` with `{ path: '/tmp/clip.mkv' }` and returns the payload.

- [ ] **Step 2: Run frontend API tests to verify they fail**

Run: `bun test src/api/__tests__/commandParity.test.ts src/api/__tests__/tauriAdapter.test.ts`
Expected: FAIL (32 vs 33 mismatch and `getVideoMetadata` missing).

- [ ] **Step 3: Wire Rust command & TS API adapter**

1. Add `#[tauri::command(rename_all = "camelCase")] pub fn get_video_metadata(path: String) -> Option<crate::thumbnails::VideoMetadata>` in `src-tauri/src/commands/system.rs` and register `commands::system::get_video_metadata` in `src-tauri/src/lib.rs`.
2. Update `src/types/files.ts` (`mediaKind?: 'video'`), `src/api/types.ts` (`VideoMetadata` + `getVideoMetadata`), `src/api/commandMap.ts` (`getVideoMetadata: 'get_video_metadata'`), and `src/api/tauriAdapter.ts` (`RawFileEntry.mediaKind` / `media_kind` in `toIFile`, plus `getVideoMetadata`).

- [ ] **Step 4: Run Rust and frontend API tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && bun test src/api/__tests__/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/system.rs src-tauri/src/lib.rs src/types/files.ts src/api/types.ts src/api/commandMap.ts src/api/tauriAdapter.ts src/api/__tests__/commandParity.test.ts src/api/__tests__/tauriAdapter.test.ts
git commit -m "feat(api): add get_video_metadata command and IFile mediaKind parity"
```

---

### Task 5: Frontend Media Format Alignment & URL Builders

**Files:**
- Modify: `src/utils/fileUtils.ts`
- Modify: `src/utils/shapeUtils.ts`
- Modify: `src/utils/quickLook.ts`
- Modify: `src/utils/__tests__/fileUtils.test.ts`
- Modify: `src/utils/__tests__/quickLook.test.ts`

**Interfaces:**
- Produces:
  - `src/utils/fileUtils.ts`: expanded `IMAGE_EXTENSIONS` and `VIDEO_EXTENSIONS` (without `ts`), `isVideoEntry(file: IFile): boolean`, `isMediaThumbnailCandidate(file: IFile): boolean`, updated `getSemanticGroup(file)` and `getFileIconInfo(file)` checking `file.mediaKind === 'video'`.
  - `src/utils/shapeUtils.ts`: `getFileGroupShapePair(group, isDirectory, fileName?, mediaKind?)` using `VIDEO_SHAPE_PAIR` when `mediaKind === 'video'`.
  - `src/utils/quickLook.ts`:
    - `toMediaUrl(path: string): string` -> `media://localhost<encoded>`
    - `toThumbnailUrl(path: string, size?: 'grid' | 'poster'): string` -> `media://thumb<encoded>?size=...`
    - `toPreviewUrl(path: string): string` -> `media://preview<encoded>`
    - `shouldPreferPreviewUrl(filename: string): boolean` (`heic`, `heif`, `tif`, `tiff`)
    - `formatVideoDuration(seconds: number | null | undefined): string | null`
    - updated `getPreviewKind(file: IFile)` returning `'video'` when `file.mediaKind === 'video'`.

- [ ] **Step 1: Write failing tests in `src/utils/__tests__/fileUtils.test.ts` and `src/utils/__tests__/quickLook.test.ts`**

1. In `fileUtils.test.ts`:
   - Test extended image extensions (`avif`, `tif`, `tiff`, `heic`, `heif`) and video extensions (`m4v`, `flv`, `mts`, `m2ts`, `ogv`, `wmv`, `3gp`, `mpg`, `mpeg`).
   - Keep `isVideoFile('index.ts') === false` and `getSemanticGroup(makeFile('index.ts')) === 'Code'`.
   - Test `isVideoEntry({ ...makeFile('clip.ts'), mediaKind: 'video' }) === true`, `getSemanticGroup` returns `'Media'`, and `getFileIconInfo` returns `{ icon: 'movie', colorClass: 'media-icon' }`.
2. In `quickLook.test.ts`:
   - Update `toMediaUrl` assertions from `media:///...` to `media://localhost/...`.
   - Add assertions for `toThumbnailUrl('/home/u/a b#1?.mp4', 'grid')` -> `'media://thumb/home/u/a%20b%231%3F.mp4?size=grid'`, `toThumbnailUrl('/home/u/a.mkv', 'poster')`, `toPreviewUrl('/home/u/a.heic')` -> `'media://preview/home/u/a.heic'`.
   - Test `shouldPreferPreviewUrl('photo.HEIC') === true`, `shouldPreferPreviewUrl('scan.tiff') === true`, `shouldPreferPreviewUrl('pic.png') === false`.
   - Test `getPreviewKind({ ...makeFile('stream.ts'), mediaKind: 'video' }) === 'video'` while `getPreviewKind(makeFile('app.ts')) === 'text'`.
   - Test `formatVideoDuration(125)` -> `'02:05'`, `formatVideoDuration(3661)` -> `'1:01:01'`, `formatVideoDuration(null)` -> `null`.

- [ ] **Step 2: Run utility tests to verify they fail**

Run: `bun test src/utils/__tests__/fileUtils.test.ts src/utils/__tests__/quickLook.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement updates in `fileUtils.ts`, `shapeUtils.ts`, and `quickLook.ts`**

- Align extension sets, add helper predicates, update URL builders, and support `file.mediaKind === 'video'` across `fileUtils`, `shapeUtils`, and `quickLook`.

- [ ] **Step 4: Run utility tests and verify they pass**

Run: `bun test src/utils/__tests__/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/fileUtils.ts src/utils/shapeUtils.ts src/utils/quickLook.ts src/utils/__tests__/fileUtils.test.ts src/utils/__tests__/quickLook.test.ts
git commit -m "feat(utils): expand media formats, MPEG-TS fileKind routing, and media:// URL builders"
```

---

### Task 6: `FileList` Image & Video Thumbnails, Fallback Icon & Play Badge

**Files:**
- Modify: `src/components/FileList.tsx`
- Create: `src/components/__tests__/FileListMedia.test.tsx`

**Interfaces:**
- Consumes: `isMediaThumbnailCandidate`, `isVideoEntry`, `toThumbnailUrl`, `getFileGroupShapePair`
- Produces: Updated `FileList` (`FileListRow` + grid view) rendering cached thumbnails for images and videos, restoring `<Icon>` when a thumbnail errors, and displaying a play badge overlay for videos.

- [ ] **Step 1: Write failing tests in `src/components/__tests__/FileListMedia.test.tsx`**

Using `renderToStaticMarkup` (matching `src/components/__tests__/uiStandardization.test.tsx`):
- Grid view and List view render `<img src="media://thumb/home/u/clip.mp4?size=grid" ...>` for video files and `<img src="media://thumb/home/u/photo.heic?size=grid" ...>` for extended image files (and `.ts` with `mediaKind: 'video'`).
- Video items render a play indicator (`play_arrow` icon) overlay inside the `ExpressiveShape`.
- Export a focused subcomponent or helper (e.g. `MediaThumbnail` in `FileList.tsx`) so tests can also verify that when `failed` / fallback state is active, `<Icon name={iconInfo.icon} ... />` is rendered inside `ExpressiveShape` instead of a hidden empty `<img>`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/__tests__/FileListMedia.test.tsx`
Expected: FAIL (videos render `<Icon name="movie">` without `<img>` or play badge; image src still uses `media://localhost` instead of `media://thumb`).

- [ ] **Step 3: Implement `MediaThumbnail` and wire into `FileListRow` and grid view in `src/components/FileList.tsx`**

1. Extract a small local `MediaThumbnail` component inside `FileList.tsx` (props: `file`, `iconName`, `iconSize`, `filled`) that keeps `failedPath` state (`const [failedPath, setFailedPath] = useState<string | null>(null)` — auto-resets whenever `file.path` changes without `useEffect` state resets).
2. When `isMediaThumbnailCandidate(file)` and `failedPath !== file.path`:
   - Render `<img src={toThumbnailUrl(file.path, 'grid')} alt={file.name} loading="lazy" decoding="async" className="w-full h-full object-cover" onError={() => setFailedPath(file.path)} />`.
   - If `isVideoEntry(file)`, overlay a subtle centered/corner translucent pill containing `<Icon name="play_arrow" size={...} filled />` with `pointer-events-none`.
3. Otherwise render `<Icon name={iconName} size={iconSize} filled={filled} />`.
4. Pass `file.mediaKind` into `getFileGroupShapePair(groupName, file.isDirectory, file.name, file.mediaKind)` in both `FileListRow` and grid items.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/components/__tests__/FileListMedia.test.tsx src/components/__tests__/uiStandardization.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/FileList.tsx src/components/__tests__/FileListMedia.test.tsx
git commit -m "feat(ui): render image/video thumbnails with play badge and icon fallback in FileList"
```

---

### Task 7: `QuickLook` Image Preview Fallback & Video Poster/Metadata Fallback

**Files:**
- Modify: `src/components/QuickLook.tsx`
- Create: `src/components/__tests__/QuickLookMedia.test.tsx`

**Interfaces:**
- Consumes: `toMediaUrl`, `toThumbnailUrl`, `toPreviewUrl`, `shouldPreferPreviewUrl`, `formatVideoDuration`, `api.getVideoMetadata`
- Produces: Updated `QuickLook` supporting:
  - Automatic `raw` -> `preview` (`media://preview/...`) fallback for images (and starting directly on `preview` when `shouldPreferPreviewUrl(file.name)` is true)
  - `<video poster={toThumbnailUrl(file.path, 'poster')} ...>` streaming `media://localhost/...`
  - Video fallback card on `<video>` `onError` displaying large poster thumbnail, resolution/duration/codec/size metadata, and **Open** button (`onOpen(file)`).

- [ ] **Step 1: Write failing tests in `src/components/__tests__/QuickLookMedia.test.tsx`**

Using `renderToStaticMarkup` + pure helper state tests (exporting small pure state helpers from `QuickLook.tsx` if helpful):
- `QuickLook` for `photo.png` renders `<img src="media://localhost/home/u/photo.png">`.
- `QuickLook` for `photo.heic` renders `<img src="media://preview/home/u/photo.heic">` directly (`shouldPreferPreviewUrl`).
- `QuickLook` for `clip.mkv` renders `<video src="media://localhost/home/u/clip.mkv" poster="media://thumb/home/u/clip.mkv?size=poster" ...>`.
- `QuickLook` for MPEG-TS `{ ...makeFile('stream.ts'), mediaKind: 'video' }` renders the `'video'` preview (NOT `'text'`).
- Pure helper `getInitialImageStage(file.name)` / `getNextImageStage(stage)` transitions `'raw' -> 'preview' -> 'error'` cleanly and resets per `file.path`, and `formatVideoMetadataSummary(meta, fileSize)` formats resolution (`1920×1080`), duration (`02:05`), and codec (`H264`) without throwing on partial/null metadata.
- Stale-response guard: when `videoMeta` state stores `{ path, data }`, switching `file.path` ignores metadata belonging to any previous path.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/__tests__/QuickLookMedia.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement image & video fallback logic in `src/components/QuickLook.tsx`**

1. **Image stage state keyed by `file.path`:**
   - Store `imageStageState: { path: string; stage: 'raw' | 'preview' | 'error' } | null`.
   - Derive effective stage for current `file.path`: if `imageStageState?.path === file.path`, use `imageStageState.stage`; else `shouldPreferPreviewUrl(file.name) ? 'preview' : 'raw'`.
   - On `<img>` `onError`: advance `'raw'` -> `'preview'`, or `'preview'` -> `'error'` (which drops `previewKind` to `'other'`).
2. **Video playback & poster fallback state keyed by `file.path`:**
   - Store `videoErrorPath: string | null` and `videoMeta: { path: string; data: VideoMetadata | null } | null`.
   - When `previewKind === 'video'` and `videoErrorPath !== file.path`: render `<video key={file.path} src={toMediaUrl(file.path)} poster={toThumbnailUrl(file.path, 'poster')} controls autoPlay={false} onError={() => setVideoErrorPath(file.path)} ... />`.
   - When `videoErrorPath === file.path`:
     - `useEffect` (cancelled on unmount/path change) calls `api.getVideoMetadata(file.path)` (guarded with `typeof api?.getVideoMetadata === 'function'`), storing `{ path: file.path, data }`.
     - Render large poster image (`toThumbnailUrl(file.path, 'poster')`, with fallback `<ExpressiveShape>` + `<Icon name="movie" />` if poster itself errors), message `"Inline playback unavailable for this format"`, metadata pills (resolution, duration via `formatVideoDuration`, codec, file size), and **Open** button calling `onOpen(file)`.

- [ ] **Step 4: Run full verification suite**

Run:
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- `bun test`
- `bunx tsc -b`
Expected: All Rust tests, clippy checks, TypeScript checks, and Bun tests pass with zero warnings/errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/QuickLook.tsx src/components/__tests__/QuickLookMedia.test.tsx
git commit -m "feat(ui): add QuickLook high-res preview and video poster/metadata fallbacks"
```

---

## Self-Review Checklist (verified against Spec)

1. **Spec coverage:** URI fix (`media://localhost`), `media://thumb` & `media://preview` routing (Task 3, 5); async protocol with concurrency limit (Task 3); disk cache + `image` crate + SVG pass-through + `ffmpeg` fallback (Task 2); expanded image/video formats + `.ts` sniffing across `FileEntry`/`IFile`/UI (Task 1, 3, 4, 5); `get_video_metadata` + 33-command parity (Task 4); `FileList` video/image thumbnails + error icon fallback + play badge (Task 6); `QuickLook` image preview fallback + video poster/metadata/Open fallback (Task 7). Zero gaps.
2. **Step scan:** Every step specifies exact file paths, function/struct names, test assertions, and commands without vague placeholders or whole-implementation transcripts.
3. **Type consistency:** `media_kind` (`Option<String>`) <-> `mediaKind?: 'video'`, `ThumbnailSize::{Grid, Poster}` <-> `'grid' | 'poster'`, `VideoMetadata` (`width`, `height`, `durationSeconds`, `codec`), `get_video_metadata` <-> `getVideoMetadata` match across all 7 tasks.
4. **Review Focus:** All 5 edge cases in `Review Focus` are explicitly mapped to tests in Tasks 1, 2, 3, 6, and 7.
