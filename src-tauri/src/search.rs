use serde::{Deserialize, Serialize};
use crate::fs_ops::FileEntry;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    #[serde(rename = "type")]
    pub entry_type: Option<String>,
    pub min_size: Option<String>,
    pub max_size: Option<String>,
}

/// Parses a size string following standard `find` syntax.
///
/// Supported suffixes:
/// - `c` / `C`: bytes (1 byte)
/// - `w` / `W`: two-byte words (2 bytes)
/// - `b` / `B`: 512-byte blocks
/// - `k` / `K`: kibibytes (1024 bytes)
/// - `M` / `m`: mebibytes (1024 * 1024 bytes)
/// - `G` / `g`: gibibytes (1024 * 1024 * 1024 bytes)
/// - Unitless integer: defaults to 512-byte blocks (per GNU find)
///
/// Optional leading `+` or `-` characters are stripped before parsing.
pub fn parse_find_size(s: &str) -> Option<u64> {
    let trimmed = s.trim().trim_start_matches(['+', '-']).trim();
    if trimmed.is_empty() {
        return None;
    }

    let last_char = trimmed.chars().last()?;
    if last_char.is_ascii_alphabetic() {
        let multiplier: u64 = match last_char {
            'c' | 'C' => 1,
            'w' | 'W' => 2,
            'b' | 'B' => 512,
            'k' | 'K' => 1024,
            'm' | 'M' => 1024 * 1024,
            'g' | 'G' => 1024 * 1024 * 1024,
            _ => return None,
        };
        let num_part = &trimmed[..trimmed.len() - last_char.len_utf8()];
        let num = num_part.trim().parse::<u64>().ok()?;
        num.checked_mul(multiplier)
    } else if last_char.is_ascii_digit() {
        let num = trimmed.parse::<u64>().ok()?;
        // Default find unit is 512-byte blocks
        num.checked_mul(512)
    } else {
        None
    }
}

pub fn search(dir: &str, query: &str, opts: &SearchOptions) -> Vec<FileEntry> {
    if dir.trim().is_empty() {
        return Vec::new();
    }

    let min_bytes = opts.min_size.as_deref().and_then(parse_find_size);
    let max_bytes = opts.max_size.as_deref().and_then(parse_find_size);
    let query_lower = query.to_lowercase();

    let mut results = Vec::new();
    let walker = walkdir::WalkDir::new(dir).min_depth(1);

    for entry_res in walker {
        let entry = match entry_res {
            Ok(e) => e,
            Err(_) => continue,
        };

        let file_name = entry.file_name().to_string_lossy();
        if !query_lower.is_empty() && !file_name.to_lowercase().contains(&query_lower) {
            continue;
        }

        let full_path = entry.path();
        // Follow symlinks like fs.stat; skip broken symlinks or inaccessible entries
        let metadata = match std::fs::metadata(full_path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let is_dir = metadata.is_dir();

        if let Some(ref t) = opts.entry_type {
            match t.as_str() {
                "f" if is_dir => continue,
                "d" if !is_dir => continue,
                _ => {}
            }
        }

        let size = metadata.len();

        if let Some(min_b) = min_bytes {
            if size <= min_b {
                continue;
            }
        }

        if let Some(max_b) = max_bytes {
            if size >= max_b {
                continue;
            }
        }

        let mtime_ms = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        results.push(FileEntry {
            name: file_name.into_owned(),
            path: full_path.to_string_lossy().into_owned(),
            is_directory: is_dir,
            size,
            mtime_ms,
        });

        if results.len() >= 100 {
            break;
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_find_size_supported_units() {
        assert_eq!(parse_find_size("100c"), Some(100));
        assert_eq!(parse_find_size("100C"), Some(100));
        assert_eq!(parse_find_size("2w"), Some(4));
        assert_eq!(parse_find_size("2b"), Some(1024));
        assert_eq!(parse_find_size("1k"), Some(1024));
        assert_eq!(parse_find_size("1K"), Some(1024));
        assert_eq!(parse_find_size("2M"), Some(2 * 1024 * 1024));
        assert_eq!(parse_find_size("2m"), Some(2 * 1024 * 1024));
        assert_eq!(parse_find_size("1G"), Some(1024 * 1024 * 1024));
        assert_eq!(parse_find_size("1g"), Some(1024 * 1024 * 1024));
        // Unitless defaults to 512-byte blocks
        assert_eq!(parse_find_size("2"), Some(1024));
        assert_eq!(parse_find_size("0"), Some(0));

        // Leading +/- signs
        assert_eq!(parse_find_size("+10M"), Some(10 * 1024 * 1024));
        assert_eq!(parse_find_size("-5k"), Some(5 * 1024));

        // Invalid
        assert_eq!(parse_find_size(""), None);
        assert_eq!(parse_find_size("+"), None);
        assert_eq!(parse_find_size("-"), None);
        assert_eq!(parse_find_size("abc"), None);
        assert_eq!(parse_find_size("10x"), None);
    }

    #[test]
    fn search_treats_glob_chars_literally() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();

        std::fs::write(root.join("a*b.txt"), b"literal star").unwrap();
        std::fs::write(root.join("axb.txt"), b"glob candidate").unwrap();
        std::fs::write(root.join("a?b.txt"), b"question mark").unwrap();

        let opts = SearchOptions::default();
        let results = search(root.to_str().unwrap(), "a*b", &opts);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "a*b.txt");

        let q_results = search(root.to_str().unwrap(), "a?b", &opts);
        assert_eq!(q_results.len(), 1);
        assert_eq!(q_results[0].name, "a?b.txt");
    }

    #[test]
    fn search_is_case_insensitive() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();

        std::fs::write(root.join("MyDocument.PDF"), b"content").unwrap();
        std::fs::write(root.join("other.txt"), b"other").unwrap();

        let opts = SearchOptions::default();
        let results = search(root.to_str().unwrap(), "mydocument", &opts);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "MyDocument.PDF");

        let results_ext = search(root.to_str().unwrap(), "pdf", &opts);
        assert_eq!(results_ext.len(), 1);
        assert_eq!(results_ext[0].name, "MyDocument.PDF");
    }

    #[test]
    fn search_limits_to_100() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();

        for i in 0..120 {
            std::fs::write(root.join(format!("file_{:03}.txt", i)), b"data").unwrap();
        }

        let opts = SearchOptions::default();
        let results = search(root.to_str().unwrap(), "file_", &opts);
        assert_eq!(results.len(), 100);
    }

    #[test]
    fn search_filters_by_type_and_min_size() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();

        std::fs::write(root.join("small.txt"), vec![b'a'; 100]).unwrap();
        std::fs::write(root.join("large.txt"), vec![b'b'; 2000]).unwrap();
        std::fs::create_dir(root.join("subdir")).unwrap();

        let opts_file = SearchOptions {
            entry_type: Some("f".to_string()),
            min_size: Some("1k".to_string()),
            max_size: None,
        };
        let results_file = search(root.to_str().unwrap(), "", &opts_file);
        assert_eq!(results_file.len(), 1);
        assert_eq!(results_file[0].name, "large.txt");

        let opts_dir = SearchOptions {
            entry_type: Some("d".to_string()),
            min_size: None,
            max_size: None,
        };
        let results_dir = search(root.to_str().unwrap(), "", &opts_dir);
        assert_eq!(results_dir.len(), 1);
        assert_eq!(results_dir[0].name, "subdir");
    }

    #[test]
    fn search_max_size_filter() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();

        std::fs::write(root.join("small.txt"), vec![b'a'; 100]).unwrap();
        std::fs::write(root.join("large.txt"), vec![b'b'; 2000]).unwrap();

        let opts = SearchOptions {
            entry_type: Some("f".to_string()),
            min_size: None,
            max_size: Some("500c".to_string()),
        };
        let results = search(root.to_str().unwrap(), "", &opts);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "small.txt");
    }

    #[test]
    fn search_empty_or_nonexistent_directory() {
        let opts = SearchOptions::default();
        assert!(search("", "query", &opts).is_empty());
        assert!(search("/path/that/does/not/exist/hopefully/12345", "query", &opts).is_empty());
    }
}
