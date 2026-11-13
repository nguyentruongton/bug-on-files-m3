use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use tauri::http::{header, Request, Response, StatusCode};
use crate::thumbnails::ThumbnailSize;

/// Route kind for incoming `media://` URIs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaRoute {
    Raw,
    Thumbnail(ThumbnailSize),
    Preview,
}

/// Maximum chunk size served per `206 Partial Content` response (8 MiB).
/// Protects against unbounded memory allocations and OOM spikes on open-ended range requests (`bytes=0-`).
pub const MAX_RANGE_CHUNK: u64 = 8 * 1024 * 1024;

/// Maximum file size served in a single `200 OK` response without a Range header (64 MiB).
/// Files exceeding this limit require Range requests (returning `413 Payload Too Large` with `Accept-Ranges: bytes`).
pub const MAX_FULL_RESPONSE_BYTES: u64 = 64 * 1024 * 1024;

/// Parses a byte range specification according to RFC 7233 / HTTP Range.
/// Supports:
/// - `bytes=a-b` (inclusive byte range, clamped to `len - 1` if `b >= len`)
/// - `bytes=a-` (open-ended range from `a` to `len - 1`)
/// - `bytes=-n` (suffix range: last `n` bytes, clamped if `n >= len`)
///
/// Returns `None` if header is invalid, file is empty (`len == 0`),
/// `a >= len`, or `a > b`.
pub fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    if len == 0 {
        return None;
    }
    let trimmed = header.trim();
    let spec = trimmed.strip_prefix("bytes=")?;
    let spec = spec.trim();

    // Multi-range is not supported
    if spec.contains(',') {
        return None;
    }

    if let Some(suffix_str) = spec.strip_prefix('-') {
        // Suffix range: bytes=-n
        let n: u64 = suffix_str.trim().parse().ok()?;
        if n == 0 {
            return None;
        }
        let start = len.saturating_sub(n);
        Some((start, len - 1))
    } else if let Some((start_str, end_str)) = spec.split_once('-') {
        let start: u64 = start_str.trim().parse().ok()?;
        if start >= len {
            return None;
        }
        let end_str = end_str.trim();
        if end_str.is_empty() {
            // Open-ended range: bytes=a-
            Some((start, len - 1))
        } else {
            // Explicit range: bytes=a-b
            let raw_end: u64 = end_str.parse().ok()?;
            if raw_end < start {
                return None;
            }
            let end = raw_end.min(len - 1);
            Some((start, end))
        }
    } else {
        None
    }
}

/// Guesses a MIME type by file extension (case-insensitive).
/// Covers images, video, audio, text, pdf, json, svg, webp, avif, mkv, mp4, webm, mp3, flac, ogg, wav,
/// heic, heif, m4v, flv, mts, m2ts, wmv, 3gp, mpg, mpeg,
/// with fallback to `application/octet-stream`.
pub fn guess_mime(path: &str) -> &'static str {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match ext.as_str() {
        // Images
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "tif" | "tiff" => "image/tiff",
        "heic" => "image/heic",
        "heif" => "image/heif",

        // Videos
        "mp4" | "m4v" => "video/mp4",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "ogv" => "video/ogg",
        "flv" => "video/x-flv",
        "mts" | "m2ts" => "video/mp2t",
        "wmv" => "video/x-ms-wmv",
        "3gp" => "video/3gpp",
        "mpg" | "mpeg" => "video/mpeg",

        // Audio
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" | "oga" => "audio/ogg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",

        // Documents and text
        "pdf" => "application/pdf",
        "json" => "application/json",
        "txt" | "text" | "log" | "md" | "conf" | "ini" | "toml" => "text/plain",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" | "ts" => "text/javascript",

        _ => "application/octet-stream",
    }
}

/// Guesses MIME type for a filesystem path, taking into account file content sniffing
/// for MPEG-TS vs TypeScript files when extension is `.ts`.
pub fn guess_mime_for_path(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if ext == "ts" {
        if crate::fs_ops::sniff_ts_media_kind(path).as_deref() == Some("video") {
            return "video/mp2t";
        }
        return "text/javascript";
    }

    guess_mime(&path.to_string_lossy())
}

fn parse_thumbnail_size(query_opt: Option<&str>) -> ThumbnailSize {
    let Some(query) = query_opt else {
        return ThumbnailSize::Grid;
    };
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or("").trim();
        let val = parts.next().unwrap_or("").trim();
        if key.eq_ignore_ascii_case("size") {
            if val.eq_ignore_ascii_case("poster") {
                return ThumbnailSize::Poster;
            } else {
                return ThumbnailSize::Grid;
            }
        }
    }
    ThumbnailSize::Grid
}

/// Parses a `media://` URI into a `MediaRoute` and the decoded filesystem `PathBuf`.
/// Handles:
/// - `media://localhost/abs/path` -> `(MediaRoute::Raw, /abs/path)`
/// - `media://thumb/abs/path?size=grid|poster` -> `(MediaRoute::Thumbnail(size), /abs/path)`
/// - `media://preview/abs/path` -> `(MediaRoute::Preview, /abs/path)`
/// - `media:///abs/path`, `media:/abs/path`, `http(s)://media.localhost/abs/path` -> `(MediaRoute::Raw, /abs/path)`
/// - Preserves percent-encoded `?` (`%3F`) and `#` (`%23`) in the path while stripping unencoded query/fragment.
pub fn parse_media_route(uri: &str) -> Option<(MediaRoute, PathBuf)> {
    let raw = uri.trim();
    if raw.is_empty() {
        return None;
    }

    // Strip unencoded fragment '#' if present
    let without_frag = match raw.find('#') {
        Some(idx) => &raw[..idx],
        None => raw,
    };

    if without_frag.is_empty() {
        return None;
    }

    // Separate unencoded query string '?' from base URI
    let (base_uri, query_opt) = match without_frag.find('?') {
        Some(idx) => (&without_frag[..idx], Some(&without_frag[idx + 1..])),
        None => (without_frag, None),
    };

    if base_uri.is_empty() {
        return None;
    }

    // Determine route and extract remaining path string
    let (route, path_str) = if let Some(rest) = base_uri.strip_prefix("media://") {
        if let Some(after) = rest.strip_prefix("thumb/") {
            let size = parse_thumbnail_size(query_opt);
            (MediaRoute::Thumbnail(size), after)
        } else if rest == "thumb" {
            return None;
        } else if let Some(after) = rest.strip_prefix("preview/") {
            (MediaRoute::Preview, after)
        } else if rest == "preview" {
            return None;
        } else if let Some(after) = rest.strip_prefix("localhost/") {
            (MediaRoute::Raw, after)
        } else if rest == "localhost" {
            return None;
        } else {
            (MediaRoute::Raw, rest)
        }
    } else if let Some(rest) = base_uri.strip_prefix("media:/") {
        (MediaRoute::Raw, rest)
    } else if let Some(rest) = base_uri.strip_prefix("http://media.localhost/") {
        (MediaRoute::Raw, rest)
    } else if let Some(rest) = base_uri.strip_prefix("https://media.localhost/") {
        (MediaRoute::Raw, rest)
    } else {
        (MediaRoute::Raw, base_uri)
    };

    if path_str.is_empty() {
        return None;
    }

    // Normalize path to have leading slash unless it is a Windows drive letter path (e.g. C:/...)
    let normalized = if path_str.starts_with('/')
        || (path_str.len() >= 2
            && path_str.as_bytes()[1] == b':'
            && path_str.as_bytes()[0].is_ascii_alphabetic())
    {
        path_str.to_string()
    } else {
        format!("/{}", path_str)
    };

    let decoded = percent_encoding::percent_decode_str(&normalized)
        .decode_utf8()
        .ok()?;

    if decoded.is_empty() {
        return None;
    }

    Some((route, PathBuf::from(decoded.as_ref())))
}

/// Extracts and percent-decodes the filesystem path from a `media://` URI or raw path.
pub fn extract_media_path(uri: &str) -> Option<PathBuf> {
    parse_media_route(uri).map(|(_, path)| path)
}

/// Convenience alias for `extract_media_path`.
pub fn decode_media_path(uri: &str) -> Option<PathBuf> {
    extract_media_path(uri)
}

pub fn parse_request_route(req: &Request<Vec<u8>>) -> Option<(MediaRoute, PathBuf)> {
    let uri_str = req.uri().to_string();
    parse_media_route(&uri_str).or_else(|| parse_media_route(req.uri().path()))
}

pub fn media_bytes_response(media: crate::thumbnails::GeneratedMedia) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, media.content_type)
        .header(header::CONTENT_LENGTH, media.bytes.len().to_string())
        .header(header::CACHE_CONTROL, "max-age=3600")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(media.bytes)
        .unwrap_or_else(|_| internal_error_response())
}

pub fn handle_routed_media_request(
    req: &Request<Vec<u8>>,
    route: MediaRoute,
    path: &Path,
) -> Response<Vec<u8>> {
    match route {
        MediaRoute::Thumbnail(size) => match crate::thumbnails::get_or_generate_thumbnail(path, size) {
            Ok(media) => media_bytes_response(media),
            Err(_) => not_found_response(),
        },
        MediaRoute::Preview => match crate::thumbnails::get_or_generate_preview(path) {
            Ok(media) => media_bytes_response(media),
            Err(_) => not_found_response(),
        },
        MediaRoute::Raw => handle_raw_media_request(req, path),
    }
}

/// Handles incoming `media://` protocol requests, returning:
/// - `200 OK` for full file reads, thumbnails, or previews
/// - `206 Partial Content` when a valid `Range` header is present (capped at `MAX_RANGE_CHUNK` per RFC 7233 §4.1)
/// - `416 Range Not Satisfiable` for out-of-range requests
/// - `404 Not Found` for nonexistent files, unreadable files, or directories
pub fn handle_media_request(req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some((route, path)) = parse_request_route(req) else {
        return not_found_response();
    };
    handle_routed_media_request(req, route, &path)
}

fn handle_raw_media_request(req: &Request<Vec<u8>>, path: &Path) -> Response<Vec<u8>> {
    let Ok(metadata) = std::fs::metadata(path) else {
        return not_found_response();
    };

    if metadata.is_dir() {
        return not_found_response();
    }

    let len = metadata.len();
    let mime = guess_mime_for_path(path);

    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return not_found_response(),
    };

    if let Some(range_header) = req.headers().get(header::RANGE).and_then(|v| v.to_str().ok()) {
        match parse_range(range_header, len) {
            Some((start, end)) => {
                // Cap chunk to MAX_RANGE_CHUNK (RFC 7233 §4.1 allows serving a bounded subrange)
                let count = (end - start + 1).min(MAX_RANGE_CHUNK);
                let actual_end = start + count - 1;

                if file.seek(SeekFrom::Start(start)).is_err() {
                    return internal_error_response();
                }
                let mut buf = Vec::with_capacity(count as usize);
                if file.take(count).read_to_end(&mut buf).is_err() {
                    return internal_error_response();
                }

                Response::builder()
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header(header::CONTENT_TYPE, mime)
                    .header(header::CONTENT_RANGE, format!("bytes {start}-{actual_end}/{len}"))
                    .header(header::CONTENT_LENGTH, count.to_string())
                    .header(header::ACCEPT_RANGES, "bytes")
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .header(
                        header::ACCESS_CONTROL_EXPOSE_HEADERS,
                        "Content-Range, Content-Length, Accept-Ranges",
                    )
                    .body(buf)
                    .unwrap_or_else(|_| internal_error_response())
            }
            None => Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(Vec::new())
                .unwrap_or_else(|_| internal_error_response()),
        }
    } else {
        if len > MAX_FULL_RESPONSE_BYTES {
            return Response::builder()
                .status(StatusCode::PAYLOAD_TOO_LARGE)
                .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(b"Payload Too Large".to_vec())
                .unwrap_or_else(|_| internal_error_response());
        }

        let mut body = Vec::with_capacity(len as usize);
        if file.take(MAX_FULL_RESPONSE_BYTES).read_to_end(&mut body).is_err() {
            return internal_error_response();
        }

        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime)
            .header(header::CONTENT_LENGTH, len.to_string())
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(body)
            .unwrap_or_else(|_| internal_error_response())
    }
}

fn not_found_response() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(b"Not Found".to_vec())
        .unwrap()
}

fn internal_error_response() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::INTERNAL_SERVER_ERROR)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(b"Internal Server Error".to_vec())
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn parse_range_open_ended() {
        assert_eq!(parse_range("bytes=0-", 100), Some((0, 99)));
        assert_eq!(parse_range("bytes=50-", 100), Some((50, 99)));
        assert_eq!(parse_range("bytes=99-", 100), Some((99, 99)));
    }

    #[test]
    fn parse_range_suffix() {
        assert_eq!(parse_range("bytes=-20", 100), Some((80, 99)));
        assert_eq!(parse_range("bytes=-1", 100), Some((99, 99)));
        assert_eq!(parse_range("bytes=-100", 100), Some((0, 99)));
        assert_eq!(parse_range("bytes=-200", 100), Some((0, 99)));
    }

    #[test]
    fn parse_range_rejects_start_past_end() {
        assert_eq!(parse_range("bytes=100-", 100), None);
        assert_eq!(parse_range("bytes=105-110", 100), None);
        assert_eq!(parse_range("bytes=50-40", 100), None);
        assert_eq!(parse_range("bytes=0-10", 0), None);
    }

    #[test]
    fn guess_mime_known_and_unknown() {
        assert_eq!(guess_mime("sample.png"), "image/png");
        assert_eq!(guess_mime("PHOTO.JPEG"), "image/jpeg");
        assert_eq!(guess_mime("video.mp4"), "video/mp4");
        assert_eq!(guess_mime("MOVIE.MKV"), "video/x-matroska");
        assert_eq!(guess_mime("audio.mp3"), "audio/mpeg");
        assert_eq!(guess_mime("song.flac"), "audio/flac");
        assert_eq!(guess_mime("doc.pdf"), "application/pdf");
        assert_eq!(guess_mime("data.json"), "application/json");
        assert_eq!(guess_mime("notes.txt"), "text/plain");
        assert_eq!(guess_mime("vector.svg"), "image/svg+xml");
        assert_eq!(guess_mime("image.webp"), "image/webp");
        assert_eq!(guess_mime("image.avif"), "image/avif");
        assert_eq!(guess_mime("unknown.xyz"), "application/octet-stream");
        assert_eq!(guess_mime("no_extension"), "application/octet-stream");
    }

    #[test]
    fn decodes_percent_encoded_spaces() {
        let path = extract_media_path("media:///home/u/a%20b%231%3F.png");
        assert_eq!(
            path.as_deref().and_then(|p| p.to_str()),
            Some("/home/u/a b#1?.png")
        );

        let path_space = extract_media_path("media:///home/u/hello%20world.txt");
        assert_eq!(
            path_space.as_deref().and_then(|p| p.to_str()),
            Some("/home/u/hello world.txt")
        );

        let path_percent = extract_media_path("media:///home/u/100%25%20test.png");
        assert_eq!(
            path_percent.as_deref().and_then(|p| p.to_str()),
            Some("/home/u/100% test.png")
        );

        let path_unicode = extract_media_path("media:///home/u/%C3%BCn%C3%AF.png");
        assert_eq!(
            path_unicode.as_deref().and_then(|p| p.to_str()),
            Some("/home/u/ünï.png")
        );

        // media:/ and media:// normalization to absolute path
        let path_single_slash = extract_media_path("media:/home/u/file.txt");
        assert_eq!(
            path_single_slash.as_deref().and_then(|p| p.to_str()),
            Some("/home/u/file.txt")
        );

        let path_double_slash = extract_media_path("media://home/u/file.txt");
        assert_eq!(
            path_double_slash.as_deref().and_then(|p| p.to_str()),
            Some("/home/u/file.txt")
        );
    }

    #[test]
    fn parse_range_explicit_span() {
        assert_eq!(parse_range("bytes=0-49", 100), Some((0, 49)));
        assert_eq!(parse_range("bytes=10-20", 100), Some((10, 20)));
        assert_eq!(parse_range("bytes=0-200", 100), Some((0, 99)));
        assert_eq!(parse_range("invalid", 100), None);
        assert_eq!(parse_range("characters=0-10", 100), None);
    }

    #[test]
    fn handle_media_request_caps_large_range_to_max_range_chunk() {
        let mut temp_file = NamedTempFile::new().unwrap();
        // File size = 9 MiB (exceeds MAX_RANGE_CHUNK of 8 MiB)
        let total_size = (MAX_RANGE_CHUNK + 1024 * 1024) as usize;
        let data = vec![0x42u8; total_size];
        temp_file.write_all(&data).unwrap();
        let path_str = temp_file.path().to_str().unwrap();

        // Open-ended range request: bytes=0-
        let req_open = Request::builder()
            .uri(format!("media://localhost{path_str}"))
            .header("Range", "bytes=0-")
            .body(Vec::new())
            .unwrap();
        let resp = handle_media_request(&req_open);

        assert_eq!(resp.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(resp.body().len(), MAX_RANGE_CHUNK as usize);
        let expected_range = format!("bytes 0-{}/{}", MAX_RANGE_CHUNK - 1, total_size);
        assert_eq!(
            resp.headers().get("Content-Range").unwrap().to_str().unwrap(),
            expected_range
        );
        assert_eq!(
            resp.headers().get("Content-Length").unwrap().to_str().unwrap(),
            MAX_RANGE_CHUNK.to_string()
        );
    }

    #[test]
    fn handle_media_request_200_and_206_and_404_and_416() {
        let mut temp_file = NamedTempFile::new().unwrap();
        temp_file
            .write_all(b"Hello world, this is media protocol test content!")
            .unwrap();
        let path_str = temp_file.path().to_str().unwrap();

        // 200 OK full content
        let req_full = Request::builder()
            .uri(format!("media://localhost{path_str}"))
            .body(Vec::new())
            .unwrap();
        let resp_full = handle_media_request(&req_full);
        assert_eq!(resp_full.status(), StatusCode::OK);
        assert_eq!(
            resp_full.body(),
            b"Hello world, this is media protocol test content!"
        );
        assert_eq!(
            resp_full.headers().get("Content-Length").unwrap().to_str().unwrap(),
            "49"
        );
        assert_eq!(
            resp_full.headers().get("Accept-Ranges").unwrap().to_str().unwrap(),
            "bytes"
        );

        // 206 Partial Content
        let req_range = Request::builder()
            .uri(format!("media://localhost{path_str}"))
            .header("Range", "bytes=0-4")
            .body(Vec::new())
            .unwrap();
        let resp_range = handle_media_request(&req_range);
        assert_eq!(resp_range.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(resp_range.body(), b"Hello");
        assert_eq!(
            resp_range
                .headers()
                .get("Content-Range")
                .unwrap()
                .to_str()
                .unwrap(),
            "bytes 0-4/49"
        );
        assert_eq!(
            resp_range
                .headers()
                .get("Content-Length")
                .unwrap()
                .to_str()
                .unwrap(),
            "5"
        );

        // 416 Range Not Satisfiable
        let req_416 = Request::builder()
            .uri(format!("media://localhost{path_str}"))
            .header("Range", "bytes=100-200")
            .body(Vec::new())
            .unwrap();
        let resp_416 = handle_media_request(&req_416);
        assert_eq!(resp_416.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(
            resp_416
                .headers()
                .get("Content-Range")
                .unwrap()
                .to_str()
                .unwrap(),
            "bytes */49"
        );

        // 404 Not Found for missing file
        let req_404 = Request::builder()
            .uri("media://localhost/nonexistent/file/path.txt")
            .body(Vec::new())
            .unwrap();
        let resp_404 = handle_media_request(&req_404);
        assert_eq!(resp_404.status(), StatusCode::NOT_FOUND);

        // 404 Not Found for directory
        let temp_dir = tempfile::tempdir().unwrap();
        let dir_str = temp_dir.path().to_str().unwrap();
        let req_dir = Request::builder()
            .uri(format!("media://localhost{dir_str}"))
            .body(Vec::new())
            .unwrap();
        let resp_dir = handle_media_request(&req_dir);
        assert_eq!(resp_dir.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn handle_media_request_rejects_oversized_non_range_request() {
        let file = NamedTempFile::new().unwrap();
        file.as_file()
            .set_len(MAX_FULL_RESPONSE_BYTES + 1)
            .unwrap();
        let path_str = file.path().to_str().unwrap();

        let req = Request::builder()
            .uri(format!("media://localhost{path_str}"))
            .body(Vec::new())
            .unwrap();

        let resp = handle_media_request(&req);
        assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(
            resp.headers()
                .get("Accept-Ranges")
                .unwrap()
                .to_str()
                .unwrap(),
            "bytes"
        );
    }

    #[test]
    fn parse_media_route_parses_all_route_variants_and_query_params() {
        // Raw route with encoded chars
        let (route1, path1) = parse_media_route("media://localhost/home/u/a%20b%231%3F.png").unwrap();
        assert_eq!(route1, MediaRoute::Raw);
        assert_eq!(path1, PathBuf::from("/home/u/a b#1?.png"));

        // Thumbnail route with grid size
        let (route2, path2) = parse_media_route("media://thumb/home/u/a%20b%231%3F.mp4?size=grid").unwrap();
        assert_eq!(route2, MediaRoute::Thumbnail(ThumbnailSize::Grid));
        assert_eq!(path2, PathBuf::from("/home/u/a b#1?.mp4"));

        // Thumbnail route with poster size
        let (route3, path3) = parse_media_route("media://thumb/home/u/clip.mkv?size=poster").unwrap();
        assert_eq!(route3, MediaRoute::Thumbnail(ThumbnailSize::Poster));
        assert_eq!(path3, PathBuf::from("/home/u/clip.mkv"));

        // Thumbnail route without query param defaults to grid
        let (route3_def, path3_def) = parse_media_route("media://thumb/home/u/clip.mkv").unwrap();
        assert_eq!(route3_def, MediaRoute::Thumbnail(ThumbnailSize::Grid));
        assert_eq!(path3_def, PathBuf::from("/home/u/clip.mkv"));

        // Preview route
        let (route4, path4) = parse_media_route("media://preview/home/u/photo.heic").unwrap();
        assert_eq!(route4, MediaRoute::Preview);
        assert_eq!(path4, PathBuf::from("/home/u/photo.heic"));

        // Special filename ? encoded as %3F stays in path while trailing ?size=poster is stripped as query string
        let (route5, path5) = parse_media_route("media://thumb/home/u/what%3F.jpg?size=poster").unwrap();
        assert_eq!(route5, MediaRoute::Thumbnail(ThumbnailSize::Poster));
        assert_eq!(path5, PathBuf::from("/home/u/what?.jpg"));

        // Rejections for empty/invalid
        assert_eq!(parse_media_route(""), None);
        assert_eq!(parse_media_route("media://thumb"), None);
        assert_eq!(parse_media_route("media://preview"), None);
        assert_eq!(parse_media_route("media://localhost"), None);
    }

    #[test]
    fn guess_mime_covers_expanded_formats() {
        assert_eq!(guess_mime("photo.heic"), "image/heic");
        assert_eq!(guess_mime("photo.heif"), "image/heif");
        assert_eq!(guess_mime("video.m4v"), "video/mp4");
        assert_eq!(guess_mime("video.flv"), "video/x-flv");
        assert_eq!(guess_mime("stream.mts"), "video/mp2t");
        assert_eq!(guess_mime("stream.m2ts"), "video/mp2t");
        assert_eq!(guess_mime("video.wmv"), "video/x-ms-wmv");
        assert_eq!(guess_mime("video.3gp"), "video/3gpp");
        assert_eq!(guess_mime("movie.mpg"), "video/mpeg");
        assert_eq!(guess_mime("movie.mpeg"), "video/mpeg");
    }

    #[test]
    fn guess_mime_for_path_handles_ts_sniffing_and_fallback() {
        let dir = tempfile::tempdir().unwrap();

        // MPEG-TS file with 0x47 sync bytes
        let ts_video = dir.path().join("broadcast.ts");
        let mut ts_bytes = vec![0u8; 564];
        ts_bytes[0] = 0x47;
        ts_bytes[188] = 0x47;
        ts_bytes[376] = 0x47;
        std::fs::write(&ts_video, &ts_bytes).unwrap();
        assert_eq!(guess_mime_for_path(&ts_video), "video/mp2t");

        // TypeScript text file with .ts extension
        let ts_code = dir.path().join("index.ts");
        std::fs::write(&ts_code, "export const PI = 3.14159;").unwrap();
        assert_eq!(guess_mime_for_path(&ts_code), "text/javascript");

        // Regular image file
        let png_file = dir.path().join("icon.png");
        std::fs::write(&png_file, b"fake png").unwrap();
        assert_eq!(guess_mime_for_path(&png_file), "image/png");
    }

    #[test]
    fn handle_media_request_thumbnail_and_preview_routes() {
        let dir = tempfile::tempdir().unwrap();
        let png_path = dir.path().join("test_img.png");
        let img = image::DynamicImage::new_rgba8(200, 100);
        img.save(&png_path).unwrap();
        let png_path_str = png_path.to_str().unwrap();

        // media://thumb/... returns 200 OK with image/jpeg
        let req_thumb = Request::builder()
            .uri(format!("media://thumb{png_path_str}?size=grid"))
            .body(Vec::new())
            .unwrap();
        let resp_thumb = handle_media_request(&req_thumb);
        assert_eq!(resp_thumb.status(), StatusCode::OK);
        assert_eq!(
            resp_thumb.headers().get("Content-Type").unwrap().to_str().unwrap(),
            "image/jpeg"
        );
        assert_eq!(
            resp_thumb.headers().get("Cache-Control").unwrap().to_str().unwrap(),
            "max-age=3600"
        );
        assert_eq!(
            resp_thumb.headers().get("Access-Control-Allow-Origin").unwrap().to_str().unwrap(),
            "*"
        );
        assert!(!resp_thumb.body().is_empty());

        // media://preview/... returns 200 OK with image/jpeg
        let req_preview = Request::builder()
            .uri(format!("media://preview{png_path_str}"))
            .body(Vec::new())
            .unwrap();
        let resp_preview = handle_media_request(&req_preview);
        assert_eq!(resp_preview.status(), StatusCode::OK);
        assert_eq!(
            resp_preview.headers().get("Content-Type").unwrap().to_str().unwrap(),
            "image/jpeg"
        );
        assert_eq!(
            resp_preview.headers().get("Cache-Control").unwrap().to_str().unwrap(),
            "max-age=3600"
        );
        assert!(!resp_preview.body().is_empty());

        // Nonexistent file returns 404
        let req_404_thumb = Request::builder()
            .uri("media://thumb/nonexistent/image.png?size=grid")
            .body(Vec::new())
            .unwrap();
        let resp_404_thumb = handle_media_request(&req_404_thumb);
        assert_eq!(resp_404_thumb.status(), StatusCode::NOT_FOUND);

        let req_404_preview = Request::builder()
            .uri("media://preview/nonexistent/image.png")
            .body(Vec::new())
            .unwrap();
        let resp_404_preview = handle_media_request(&req_404_preview);
        assert_eq!(resp_404_preview.status(), StatusCode::NOT_FOUND);
    }
}
