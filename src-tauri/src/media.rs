use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use tauri::http::{header, Request, Response, StatusCode};

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
        let start = if n >= len { 0 } else { len - n };
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

        // Videos
        "mp4" => "video/mp4",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "ogv" => "video/ogg",

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
        "js" | "mjs" => "text/javascript",

        _ => "application/octet-stream",
    }
}

/// Extracts and percent-decodes the filesystem path from a `media://` URI or raw path.
/// Handles:
/// - `media:///abs/path` (strips `media://` leaving `/abs/path`)
/// - `media://localhost/abs/path`
/// - `http://media.localhost/abs/path`
/// - `media:/abs/path`
/// - Direct absolute paths
/// - Strips unencoded query strings (`?`) or fragments (`#`)
/// - Percent-decodes UTF-8 characters (`%20` -> space, `%23` -> `#`, `%3F` -> `?`, `%25` -> `%`, etc.)
pub fn extract_media_path(uri: &str) -> Option<PathBuf> {
    let raw = uri.trim();
    if raw.is_empty() {
        return None;
    }

    // Strip custom scheme / host prefixes
    let without_scheme = if let Some(stripped) = raw.strip_prefix("media://") {
        if let Some(after_localhost) = stripped.strip_prefix("localhost/") {
            format!("/{}", after_localhost)
        } else {
            stripped.to_string()
        }
    } else if let Some(stripped) = raw.strip_prefix("media:/") {
        stripped.to_string()
    } else if let Some(stripped) = raw.strip_prefix("http://media.localhost/") {
        format!("/{}", stripped)
    } else if let Some(stripped) = raw.strip_prefix("https://media.localhost/") {
        format!("/{}", stripped)
    } else {
        raw.to_string()
    };

    // Strip unencoded query string or fragment if present
    let path_part = match without_scheme.find(['?', '#']) {
        Some(idx) => &without_scheme[..idx],
        None => &without_scheme,
    };

    if path_part.is_empty() {
        return None;
    }

    let decoded = percent_encoding::percent_decode_str(path_part)
        .decode_utf8()
        .ok()?;

    if decoded.is_empty() {
        return None;
    }

    Some(PathBuf::from(decoded.as_ref()))
}

/// Convenience alias for `extract_media_path`.
pub fn decode_media_path(uri: &str) -> Option<PathBuf> {
    extract_media_path(uri)
}

/// Handles incoming `media://` protocol requests, returning:
/// - `200 OK` for full file reads
/// - `206 Partial Content` when a valid `Range` header is present
/// - `416 Range Not Satisfiable` for out-of-range requests
/// - `404 Not Found` for nonexistent files, unreadable files, or directories
pub fn handle_media_request(req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri_str = req.uri().to_string();
    let maybe_path = extract_media_path(&uri_str)
        .or_else(|| extract_media_path(req.uri().path()));

    let Some(path) = maybe_path else {
        return not_found_response();
    };

    let Ok(metadata) = std::fs::metadata(&path) else {
        return not_found_response();
    };

    if metadata.is_dir() {
        return not_found_response();
    }

    let len = metadata.len();
    let mime = guess_mime(&path.to_string_lossy());

    let mut file = match std::fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return not_found_response(),
    };

    if let Some(range_header) = req.headers().get(header::RANGE).and_then(|v| v.to_str().ok()) {
        match parse_range(range_header, len) {
            Some((start, end)) => {
                if file.seek(SeekFrom::Start(start)).is_err() {
                    return internal_error_response();
                }
                let count = end - start + 1;
                let mut buf = Vec::with_capacity(count as usize);
                if file.take(count).read_to_end(&mut buf).is_err() {
                    return internal_error_response();
                }

                Response::builder()
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header(header::CONTENT_TYPE, mime)
                    .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
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
        let mut body = Vec::with_capacity(len.min(16 * 1024 * 1024) as usize);
        if file.read_to_end(&mut body).is_err() {
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
}
