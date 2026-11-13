use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use image::ImageDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "webm", "avi", "mov", "m4v", "flv", "mts", "m2ts", "ogv", "wmv", "3gp", "mpg",
    "mpeg",
];

const PREVIEW_MAX_EDGE: u32 = 1920;
const PREVIEW_TAG: &str = "preview";
const FFMPEG_TIMEOUT: Duration = Duration::from_secs(15);
const FFPROBE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ThumbnailSize {
    Grid,
    Poster,
}

impl ThumbnailSize {
    pub fn max_edge(&self) -> u32 {
        match self {
            ThumbnailSize::Grid => 256,
            ThumbnailSize::Poster => 1280,
        }
    }

    pub fn tag(&self) -> &'static str {
        match self {
            ThumbnailSize::Grid => "thumb-grid",
            ThumbnailSize::Poster => "thumb-poster",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedMedia {
    pub bytes: Vec<u8>,
    pub content_type: &'static str,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadata {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_seconds: Option<f64>,
    pub codec: Option<String>,
}

#[derive(Debug)]
pub enum ThumbnailError {
    Io(std::io::Error),
    Decode(String),
    Process(String),
    NotFound,
    TooLarge,
    Unsupported(String),
}

impl std::fmt::Display for ThumbnailError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ThumbnailError::Io(e) => write!(f, "I/O error: {}", e),
            ThumbnailError::Decode(s) => write!(f, "Decode error: {}", s),
            ThumbnailError::Process(s) => write!(f, "Process error: {}", s),
            ThumbnailError::NotFound => write!(f, "File not found"),
            ThumbnailError::TooLarge => write!(f, "File exceeds maximum allowed size"),
            ThumbnailError::Unsupported(s) => write!(f, "Unsupported media: {}", s),
        }
    }
}

impl std::error::Error for ThumbnailError {}

impl From<std::io::Error> for ThumbnailError {
    fn from(e: std::io::Error) -> Self {
        ThumbnailError::Io(e)
    }
}

pub fn default_cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("materials")
        .join("thumbnails")
}

pub fn cache_key(path: &Path, size: u64, mtime_nanos: u128, tag: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(b"\0");
    hasher.update(size.to_string().as_bytes());
    hasher.update(b"\0");
    hasher.update(mtime_nanos.to_string().as_bytes());
    hasher.update(b"\0");
    hasher.update(tag.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn is_video_path(path: &Path) -> bool {
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        let ext_lower = ext.to_ascii_lowercase();
        if VIDEO_EXTENSIONS.contains(&ext_lower.as_str()) {
            return true;
        }
    }
    crate::fs_ops::sniff_ts_media_kind(path).as_deref() == Some("video")
}

fn run_command_with_timeout(
    mut cmd: std::process::Command,
    timeout: Duration,
) -> Result<std::process::Output, ThumbnailError> {
    let mut child = cmd.spawn().map_err(|e| ThumbnailError::Process(e.to_string()))?;

    let stdout_handle = child.stdout.take().map(|mut out| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = std::io::Read::read_to_end(&mut out, &mut buf);
            buf
        })
    });
    let stderr_handle = child.stderr.take().map(|mut err| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = std::io::Read::read_to_end(&mut err, &mut buf);
            buf
        })
    });

    let start = std::time::Instant::now();
    let poll_interval = Duration::from_millis(50);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = stdout_handle.map(|h| h.join().unwrap_or_default()).unwrap_or_default();
                let stderr = stderr_handle.map(|h| h.join().unwrap_or_default()).unwrap_or_default();
                return Ok(std::process::Output {
                    status,
                    stdout,
                    stderr,
                });
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    if let Some(h) = stdout_handle {
                        let _ = h.join();
                    }
                    if let Some(h) = stderr_handle {
                        let _ = h.join();
                    }
                    return Err(ThumbnailError::Process("Process timed out".to_string()));
                }
                std::thread::sleep(poll_interval);
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                if let Some(h) = stdout_handle {
                    let _ = h.join();
                }
                if let Some(h) = stderr_handle {
                    let _ = h.join();
                }
                return Err(ThumbnailError::Process(e.to_string()));
            }
        }
    }
}

pub fn parse_ffprobe_json(raw: &str) -> Option<VideoMetadata> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;

    let stream = v
        .get("streams")
        .and_then(|s| s.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|item| item.get("width").is_some())
                .or_else(|| arr.iter().find(|item| item.get("codec_name").is_some()))
                .or_else(|| arr.first())
        });

    let width = stream
        .and_then(|s| s.get("width"))
        .and_then(|w| w.as_u64())
        .map(|w| w as u32);

    let height = stream
        .and_then(|s| s.get("height"))
        .and_then(|h| h.as_u64())
        .map(|h| h as u32);

    let codec = stream
        .and_then(|s| s.get("codec_name"))
        .and_then(|c| c.as_str())
        .map(|c| c.to_string());

    let duration_seconds = v
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|d| {
            if let Some(s) = d.as_str() {
                s.parse::<f64>().ok()
            } else {
                d.as_f64()
            }
        });

    if width.is_none() && height.is_none() && duration_seconds.is_none() && codec.is_none() {
        return None;
    }

    Some(VideoMetadata {
        width,
        height,
        duration_seconds,
        codec,
    })
}

pub fn probe_video_metadata(path: &Path) -> Option<VideoMetadata> {
    if !path.is_file() {
        return None;
    }
    let mut cmd = std::process::Command::new("ffprobe");
    cmd.args([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,codec_name",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        "-i",
    ]);
    cmd.arg(path);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());

    let output = run_command_with_timeout(cmd, FFPROBE_TIMEOUT).ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = std::str::from_utf8(&output.stdout).ok()?;
    parse_ffprobe_json(raw)
}

fn decode_raster_image_pure(path: &Path) -> Result<image::DynamicImage, ThumbnailError> {
    let reader = image::ImageReader::open(path)
        .map_err(ThumbnailError::Io)?
        .with_guessed_format()
        .map_err(|e| ThumbnailError::Decode(e.to_string()))?;
    let mut decoder = reader
        .into_decoder()
        .map_err(|e| ThumbnailError::Decode(e.to_string()))?;
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut img = image::DynamicImage::from_decoder(decoder)
        .map_err(|e| ThumbnailError::Decode(e.to_string()))?;
    img.apply_orientation(orientation);
    Ok(img)
}

fn extract_frame_ffmpeg(
    path: &Path,
    max_dim: u32,
    tmp_path: &Path,
    is_video: bool,
) -> Result<(), ThumbnailError> {
    let filter = format!(
        "scale='min({max_dim},iw)':'min({max_dim},ih)':force_original_aspect_ratio=decrease"
    );

    if is_video {
        // Try seeking to 1s first
        let mut cmd = std::process::Command::new("ffmpeg");
        cmd.args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            "1",
            "-i",
        ]);
        cmd.arg(path);
        cmd.args(["-frames:v", "1", "-vf", &filter, "-q:v", "3"]);
        cmd.arg(tmp_path);
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::piped());

        let first_res = run_command_with_timeout(cmd, FFMPEG_TIMEOUT);

        let first_succeeded = matches!(first_res, Ok(ref out) if out.status.success())
            && tmp_path
                .metadata()
                .map(|m| m.len() > 0)
                .unwrap_or(false);

        if !first_succeeded {
            // Clean up any partial or corrupt file before retrying with -ss 0 (e.g. video shorter than 1s or seek error)
            let _ = std::fs::remove_file(tmp_path);
            let mut retry_cmd = std::process::Command::new("ffmpeg");
            retry_cmd.args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-ss",
                "0",
                "-i",
            ]);
            retry_cmd.arg(path);
            retry_cmd.args(["-frames:v", "1", "-vf", &filter, "-q:v", "3"]);
            retry_cmd.arg(tmp_path);
            retry_cmd.stdout(std::process::Stdio::null());
            retry_cmd.stderr(std::process::Stdio::piped());

            let output = run_command_with_timeout(retry_cmd, FFMPEG_TIMEOUT)?;
            let ok = output.status.success()
                && tmp_path
                    .metadata()
                    .map(|m| m.len() > 0)
                    .unwrap_or(false);
            if !ok {
                let _ = std::fs::remove_file(tmp_path);
                return Err(ThumbnailError::Process(
                    "ffmpeg failed to extract video frame".to_string(),
                ));
            }
        }
    } else {
        // Image fallback (e.g. .heic, .heif, exotic formats)
        let mut cmd = std::process::Command::new("ffmpeg");
        cmd.args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
        ]);
        cmd.arg(path);
        cmd.args(["-frames:v", "1", "-vf", &filter, "-q:v", "3"]);
        cmd.arg(tmp_path);
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::piped());

        let output = run_command_with_timeout(cmd, FFMPEG_TIMEOUT)?;
        let ok = tmp_path
            .metadata()
            .map(|m| m.len() > 0)
            .unwrap_or(false);
        if !ok || !output.status.success() {
            let _ = std::fs::remove_file(tmp_path);
            return Err(ThumbnailError::Decode(
                "ffmpeg failed to decode image".to_string(),
            ));
        }
    }

    Ok(())
}

fn get_or_generate_media_in(
    path: &Path,
    max_dim: u32,
    tag: &str,
    cache_dir: &Path,
) -> Result<GeneratedMedia, ThumbnailError> {
    let metadata = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(ThumbnailError::NotFound),
        Err(e) => return Err(ThumbnailError::Io(e)),
    };

    if metadata.is_dir() {
        return Err(ThumbnailError::Unsupported("Path is a directory".to_string()));
    }

    let file_size = metadata.len();
    if file_size == 0 {
        return Err(ThumbnailError::Decode("File is empty".to_string()));
    }

    // SVG files bypass raster decoding and resizing
    let is_svg = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("svg"))
        .unwrap_or(false);

    if is_svg {
        if file_size > crate::media::MAX_FULL_RESPONSE_BYTES {
            return Err(ThumbnailError::TooLarge);
        }
        let bytes = std::fs::read(path)?;
        return Ok(GeneratedMedia {
            bytes,
            content_type: "image/svg+xml",
        });
    }

    std::fs::create_dir_all(cache_dir)?;

    let mtime_nanos = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    let key = cache_key(path, file_size, mtime_nanos, tag);
    let final_path = cache_dir.join(format!("{}.jpg", key));

    // Cache hit
    if let Ok(bytes) = std::fs::read(&final_path) {
        if !bytes.is_empty() {
            return Ok(GeneratedMedia {
                bytes,
                content_type: "image/jpeg",
            });
        }
    }

    let is_video = is_video_path(path);
    let pid = std::process::id();
    let seq = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp_path = cache_dir.join(format!("{}.{}.{}.tmp.jpg", key, pid, seq));

    if is_video {
        if let Err(e) = extract_frame_ffmpeg(path, max_dim, &tmp_path, true) {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(e);
        }
        return read_and_commit_tmp_cache_file(&tmp_path, &final_path);
    }

    // Raster image: try pure Rust decode first
    let pure_result = decode_raster_image_pure(path);
    match pure_result {
        Ok(mut img) => {
            let (w, h) = (img.width(), img.height());
            if w > max_dim || h > max_dim {
                img = img.resize(max_dim, max_dim, image::imageops::FilterType::Triangle);
            }
            let rgb = img.to_rgb8();
            let mut buf = Vec::new();
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 85);
            if let Err(e) = encoder.encode_image(&rgb) {
                return Err(ThumbnailError::Decode(e.to_string()));
            }

            if let Err(e) = std::fs::write(&tmp_path, &buf) {
                let _ = std::fs::remove_file(&tmp_path);
                return Err(ThumbnailError::Io(e));
            }

            commit_tmp_cache_file(&tmp_path, &final_path, buf)
        }
        Err(_) => {
            // Pure decode failed: fall back to ffmpeg
            if let Err(e) = extract_frame_ffmpeg(path, max_dim, &tmp_path, false) {
                let _ = std::fs::remove_file(&tmp_path);
                return Err(e);
            }
            read_and_commit_tmp_cache_file(&tmp_path, &final_path)
        }
    }
}

fn commit_tmp_cache_file(
    tmp_path: &Path,
    final_path: &Path,
    bytes: Vec<u8>,
) -> Result<GeneratedMedia, ThumbnailError> {
    if let Err(e) = std::fs::rename(tmp_path, final_path) {
        let _ = std::fs::remove_file(tmp_path);
        if let Ok(existing) = std::fs::read(final_path) {
            if !existing.is_empty() {
                return Ok(GeneratedMedia {
                    bytes: existing,
                    content_type: "image/jpeg",
                });
            }
        }
        return Err(ThumbnailError::Io(e));
    }
    Ok(GeneratedMedia {
        bytes,
        content_type: "image/jpeg",
    })
}

fn read_and_commit_tmp_cache_file(
    tmp_path: &Path,
    final_path: &Path,
) -> Result<GeneratedMedia, ThumbnailError> {
    let bytes = match std::fs::read(tmp_path) {
        Ok(b) => b,
        Err(e) => {
            let _ = std::fs::remove_file(tmp_path);
            return Err(ThumbnailError::Io(e));
        }
    };
    commit_tmp_cache_file(tmp_path, final_path, bytes)
}

fn try_get_cached_or_svg_in(path: &Path, tag: &str, cache_dir: &Path) -> Option<GeneratedMedia> {
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.is_dir() || metadata.len() == 0 {
        return None;
    }

    let is_svg = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("svg"))
        .unwrap_or(false);

    if is_svg {
        if metadata.len() > crate::media::MAX_FULL_RESPONSE_BYTES {
            return None;
        }
        let bytes = std::fs::read(path).ok()?;
        return Some(GeneratedMedia {
            bytes,
            content_type: "image/svg+xml",
        });
    }

    let mtime_nanos = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let key = cache_key(path, metadata.len(), mtime_nanos, tag);
    let final_path = cache_dir.join(format!("{}.jpg", key));
    let bytes = std::fs::read(&final_path).ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some(GeneratedMedia {
        bytes,
        content_type: "image/jpeg",
    })
}

pub fn try_get_cached_or_svg_thumbnail(path: &Path, size: ThumbnailSize) -> Option<GeneratedMedia> {
    try_get_cached_or_svg_in(path, size.tag(), &default_cache_dir())
}

pub fn try_get_cached_or_svg_preview(path: &Path) -> Option<GeneratedMedia> {
    try_get_cached_or_svg_in(path, "preview", &default_cache_dir())
}

pub fn get_or_generate_thumbnail_in(
    path: &Path,
    size: ThumbnailSize,
    cache_dir: &Path,
) -> Result<GeneratedMedia, ThumbnailError> {
    get_or_generate_media_in(path, size.max_edge(), size.tag(), cache_dir)
}

pub fn get_or_generate_thumbnail(
    path: &Path,
    size: ThumbnailSize,
) -> Result<GeneratedMedia, ThumbnailError> {
    get_or_generate_thumbnail_in(path, size, &default_cache_dir())
}

pub fn get_or_generate_preview_in(
    path: &Path,
    cache_dir: &Path,
) -> Result<GeneratedMedia, ThumbnailError> {
    get_or_generate_media_in(path, PREVIEW_MAX_EDGE, PREVIEW_TAG, cache_dir)
}

pub fn get_or_generate_preview(path: &Path) -> Result<GeneratedMedia, ThumbnailError> {
    get_or_generate_preview_in(path, &default_cache_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn raster_image_smaller_than_target_is_not_upscaled() {
        let dir = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let img_path = dir.path().join("small.png");
        let img = image::DynamicImage::new_rgba8(100, 50);
        img.save(&img_path).unwrap();

        let out = get_or_generate_thumbnail_in(&img_path, ThumbnailSize::Grid, cache.path()).unwrap();
        let decoded = image::load_from_memory(&out.bytes).unwrap();
        assert_eq!(decoded.width(), 100);
        assert_eq!(decoded.height(), 50);
    }

    #[test]
    fn poster_and_preview_sizes_scale_correctly() {
        let dir = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let img_path = dir.path().join("massive.png");
        let img = image::DynamicImage::new_rgba8(3000, 1500);
        img.save(&img_path).unwrap();

        let poster = get_or_generate_thumbnail_in(&img_path, ThumbnailSize::Poster, cache.path()).unwrap();
        let poster_decoded = image::load_from_memory(&poster.bytes).unwrap();
        assert_eq!(poster_decoded.width(), 1280);
        assert_eq!(poster_decoded.height(), 640);

        let preview = get_or_generate_preview_in(&img_path, cache.path()).unwrap();
        let preview_decoded = image::load_from_memory(&preview.bytes).unwrap();
        assert_eq!(preview_decoded.width(), 1920);
        assert_eq!(preview_decoded.height(), 960);
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
    fn nonexistent_file_returns_not_found() {
        let cache = tempfile::tempdir().unwrap();
        let bad_path = Path::new("/tmp/nonexistent-image-12345.png");
        let res = get_or_generate_thumbnail_in(bad_path, ThumbnailSize::Grid, cache.path());
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

    #[test]
    fn parse_ffprobe_json_handles_empty_or_invalid() {
        assert!(parse_ffprobe_json("").is_none());
        assert!(parse_ffprobe_json("{}").is_none());
        assert!(parse_ffprobe_json(r#"{"streams":[],"format":{}}"#).is_none());
    }

    #[test]
    fn ffmpeg_and_ffprobe_video_frame_and_metadata_extraction() {
        let ffmpeg_exists = Path::new("/usr/bin/ffmpeg").exists();
        let ffprobe_exists = Path::new("/usr/bin/ffprobe").exists();
        if !ffmpeg_exists || !ffprobe_exists {
            eprintln!("Skipping video test: ffmpeg/ffprobe not found");
            return;
        }

        let dir = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let video_path = dir.path().join("test_clip.mp4");

        // Generate tiny 0.5s 320x240 video
        let status = std::process::Command::new("/usr/bin/ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=320x240:d=0.5",
                "-c:v",
                "libx264",
            ])
            .arg(&video_path)
            .status()
            .unwrap();
        assert!(status.success());

        // Test probe_video_metadata
        let meta = probe_video_metadata(&video_path).expect("probe_video_metadata should succeed");
        assert_eq!(meta.width, Some(320));
        assert_eq!(meta.height, Some(240));
        assert!(meta.codec.is_some());
        assert!(meta.duration_seconds.is_some());

        // Test thumbnail extraction (note: 0.5s video tests the -ss 1 -> -ss 0 fallback retry!)
        let thumb = get_or_generate_thumbnail_in(&video_path, ThumbnailSize::Grid, cache.path()).unwrap();
        assert_eq!(thumb.content_type, "image/jpeg");
        let decoded = image::load_from_memory(&thumb.bytes).unwrap();
        assert_eq!(decoded.width(), 256);
        assert_eq!(decoded.height(), 192);

        // Verify cache hit
        let thumb2 = get_or_generate_thumbnail_in(&video_path, ThumbnailSize::Grid, cache.path()).unwrap();
        assert_eq!(thumb2.bytes, thumb.bytes);
    }

    #[test]
    fn corrupt_video_fails_cleanly_without_leaving_tmp_files() {
        let ffmpeg_exists = Path::new("/usr/bin/ffmpeg").exists();
        if !ffmpeg_exists {
            return;
        }

        let dir = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let bad_video = dir.path().join("corrupted.mp4");
        std::fs::write(&bad_video, b"not a real mp4 video content at all").unwrap();

        let res = get_or_generate_thumbnail_in(&bad_video, ThumbnailSize::Grid, cache.path());
        assert!(res.is_err());

        // Cache dir should not contain any files (neither final nor leftover .tmp)
        let entries: Vec<_> = std::fs::read_dir(cache.path()).unwrap().collect();
        assert_eq!(entries.len(), 0);
    }

    #[test]
    fn subsecond_video_triggers_ss0_retry_and_cleans_partial_state() {
        let ffmpeg_exists = Path::new("/usr/bin/ffmpeg").exists();
        if !ffmpeg_exists {
            return;
        }

        let dir = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let video_path = dir.path().join("subsecond.mp4");

        // 0.2s video guaranteed to fail seeking at -ss 1
        let status = std::process::Command::new("/usr/bin/ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=160x120:d=0.2",
                "-c:v",
                "libx264",
            ])
            .arg(&video_path)
            .status()
            .unwrap();
        assert!(status.success());

        let res = get_or_generate_thumbnail_in(&video_path, ThumbnailSize::Grid, cache.path());
        assert!(res.is_ok());
        let media = res.unwrap();
        assert_eq!(media.content_type, "image/jpeg");
        let decoded = image::load_from_memory(&media.bytes).unwrap();
        assert_eq!(decoded.width(), 160);
        assert_eq!(decoded.height(), 120);

        // Verify only 1 cached file exists and no .tmp files linger
        let entries: Vec<_> = std::fs::read_dir(cache.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].ends_with(".jpg"));
        assert!(!entries[0].contains(".tmp."));
    }
}
