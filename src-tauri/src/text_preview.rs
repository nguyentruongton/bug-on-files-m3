use serde::{Deserialize, Serialize};

pub const TEXT_PREVIEW_MAX_BYTES: u64 = 1_048_576;
pub const BINARY_CHECK_BYTES: usize = 8192;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum TextPreview {
    Text { content: String },
    TooLarge { size: u64 },
    Binary,
    Error,
}

pub fn read_text_preview(path: &str, max_bytes: u64) -> TextPreview {
    let metadata = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return TextPreview::Error,
    };

    if !metadata.is_file() {
        return TextPreview::Error;
    }

    let size = metadata.len();
    if size > max_bytes {
        return TextPreview::TooLarge { size };
    }

    if size == 0 {
        return TextPreview::Text {
            content: String::new(),
        };
    }

    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(_) => return TextPreview::Error,
    };

    if bytes.len() as u64 > max_bytes {
        return TextPreview::TooLarge {
            size: bytes.len() as u64,
        };
    }

    let check_len = std::cmp::min(bytes.len(), BINARY_CHECK_BYTES);
    if bytes[..check_len].contains(&0) {
        return TextPreview::Binary;
    }

    let content = String::from_utf8_lossy(&bytes).into_owned();
    TextPreview::Text { content }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_text_preview_max_bytes_constant() {
        assert_eq!(TEXT_PREVIEW_MAX_BYTES, 1_048_576);
    }

    #[test]
    fn test_reads_small_utf8_text_file_including_unicode_characters() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("sample.txt");
        let content = "Hello world! 🌍 ✨ éàç 世界";
        std::fs::write(&file_path, content).unwrap();

        let result = read_text_preview(file_path.to_str().unwrap(), TEXT_PREVIEW_MAX_BYTES);
        assert_eq!(
            result,
            TextPreview::Text {
                content: content.to_string()
            }
        );
    }

    #[test]
    fn test_reads_empty_file_as_text_with_empty_string_content() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("empty.txt");
        std::fs::write(&file_path, "").unwrap();

        let result = read_text_preview(file_path.to_str().unwrap(), TEXT_PREVIEW_MAX_BYTES);
        assert_eq!(
            result,
            TextPreview::Text {
                content: String::new()
            }
        );
    }

    #[test]
    fn test_returns_too_large_when_file_size_exceeds_max_bytes() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("toolarge.txt");
        std::fs::write(&file_path, "0123456789X").unwrap(); // 11 bytes

        let result = read_text_preview(file_path.to_str().unwrap(), 10);
        assert_eq!(result, TextPreview::TooLarge { size: 11 });
    }

    #[test]
    fn test_accepts_file_when_file_size_is_exactly_max_bytes() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("exact.txt");
        let content = "0123456789"; // 10 bytes
        std::fs::write(&file_path, content).unwrap();

        let result = read_text_preview(file_path.to_str().unwrap(), 10);
        assert_eq!(
            result,
            TextPreview::Text {
                content: content.to_string()
            }
        );
    }

    #[test]
    fn test_detects_binary_file_with_null_byte_in_first_8kb() {
        let dir = tempdir().unwrap();

        // 1. Null byte at start
        let file_start = dir.path().join("null-start.bin");
        std::fs::write(&file_start, [0x00, 0x61, 0x62, 0x63]).unwrap();
        assert_eq!(
            read_text_preview(file_start.to_str().unwrap(), TEXT_PREVIEW_MAX_BYTES),
            TextPreview::Binary
        );

        // 2. Null byte in middle of first 8KB
        let file_mid = dir.path().join("null-mid.bin");
        let mut mid_buf = vec![0x61u8; 100];
        mid_buf[50] = 0x00;
        std::fs::write(&file_mid, mid_buf).unwrap();
        assert_eq!(
            read_text_preview(file_mid.to_str().unwrap(), TEXT_PREVIEW_MAX_BYTES),
            TextPreview::Binary
        );

        // 3. Null byte at index 8191 (8192nd byte)
        let file_8191 = dir.path().join("null-8191.bin");
        let mut buf_8192 = vec![0x61u8; 8192];
        buf_8192[8191] = 0x00;
        std::fs::write(&file_8191, buf_8192).unwrap();
        assert_eq!(
            read_text_preview(file_8191.to_str().unwrap(), TEXT_PREVIEW_MAX_BYTES),
            TextPreview::Binary
        );
    }

    #[test]
    fn test_treats_file_with_null_byte_after_the_first_8192_bytes_as_text() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("null-late.txt");
        let mut buf = vec![b'a'; 9000];
        buf[8192] = 0x00;
        std::fs::write(&file_path, buf).unwrap();

        let result = read_text_preview(file_path.to_str().unwrap(), TEXT_PREVIEW_MAX_BYTES);
        match result {
            TextPreview::Text { content } => {
                assert_eq!(content.len(), 9000);
            }
            other => panic!("Expected TextPreview::Text, got {:?}", other),
        }
    }

    #[test]
    fn test_returns_error_for_missing_path() {
        let result = read_text_preview("/tmp/nonexistent-file-path-404.txt", TEXT_PREVIEW_MAX_BYTES);
        assert_eq!(result, TextPreview::Error);
    }

    #[test]
    fn test_returns_error_for_directory_path() {
        let dir = tempdir().unwrap();
        let result = read_text_preview(dir.path().to_str().unwrap(), TEXT_PREVIEW_MAX_BYTES);
        assert_eq!(result, TextPreview::Error);
    }

    #[test]
    fn test_lossy_utf8_handling() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("lossy.txt");
        let bytes = vec![0xFF, 0xFE, b'h', b'i'];
        std::fs::write(&file_path, bytes).unwrap();

        let result = read_text_preview(file_path.to_str().unwrap(), TEXT_PREVIEW_MAX_BYTES);
        match result {
            TextPreview::Text { content } => {
                assert!(content.ends_with("hi"));
            }
            other => panic!("Expected TextPreview::Text, got {:?}", other),
        }
    }

    #[test]
    fn test_serde_serialization() {
        assert_eq!(
            serde_json::to_string(&TextPreview::Text { content: "abc".into() }).unwrap(),
            r#"{"kind":"text","content":"abc"}"#
        );
        assert_eq!(
            serde_json::to_string(&TextPreview::TooLarge { size: 1024 }).unwrap(),
            r#"{"kind":"too-large","size":1024}"#
        );
        assert_eq!(
            serde_json::to_string(&TextPreview::Binary).unwrap(),
            r#"{"kind":"binary"}"#
        );
        assert_eq!(
            serde_json::to_string(&TextPreview::Error).unwrap(),
            r#"{"kind":"error"}"#
        );
    }
}
