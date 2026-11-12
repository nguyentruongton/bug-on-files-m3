use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Drive {
    pub name: String,
    pub label: String,
    pub mountpoint: String,
    pub size: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub removable: bool,
    pub usb: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StorageUsage {
    pub total: u64,
    pub used: u64,
    pub free: u64,
}

fn deserialize_bool_flexible<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let opt = Option::<serde_json::Value>::deserialize(deserializer)?;
    match opt {
        Some(serde_json::Value::Bool(b)) => Ok(b),
        Some(serde_json::Value::Number(n)) => Ok(n.as_i64().unwrap_or(0) != 0),
        Some(serde_json::Value::String(s)) => {
            let s_lower = s.trim().to_lowercase();
            Ok(s_lower == "1" || s_lower == "true")
        }
        _ => Ok(false),
    }
}

#[derive(Debug, Deserialize)]
struct LsblkResponse {
    #[serde(default)]
    blockdevices: Vec<LsblkDevice>,
}

#[derive(Debug, Deserialize)]
struct LsblkDevice {
    name: String,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    mountpoint: Option<String>,
    #[serde(default)]
    size: Option<String>,
    #[serde(default, rename = "type")]
    device_type: Option<String>,
    #[serde(default)]
    tran: Option<String>,
    #[serde(default, deserialize_with = "deserialize_bool_flexible")]
    rm: bool,
    #[serde(default)]
    children: Vec<LsblkDevice>,
}

fn process_device(dev: &LsblkDevice, drives: &mut Vec<Drive>) {
    if let Some(ref mp) = dev.mountpoint {
        if !mp.trim().is_empty() {
            let is_usb = dev
                .tran
                .as_deref()
                .map(|t| t.eq_ignore_ascii_case("usb"))
                .unwrap_or(false);
            let removable = dev.rm || is_usb;
            let label = match dev.label.as_deref() {
                Some(l) if !l.trim().is_empty() => l.to_string(),
                _ => dev.name.clone(),
            };

            drives.push(Drive {
                name: dev.name.clone(),
                label,
                mountpoint: mp.clone(),
                size: dev.size.clone().unwrap_or_default(),
                kind: dev.device_type.clone().unwrap_or_default(),
                removable,
                usb: is_usb,
            });
        }
    }

    for child in &dev.children {
        process_device(child, drives);
    }
}

pub fn parse_lsblk(json: &str) -> Vec<Drive> {
    let Ok(resp) = serde_json::from_str::<LsblkResponse>(json) else {
        return Vec::new();
    };

    let mut drives = Vec::new();
    for dev in &resp.blockdevices {
        process_device(dev, &mut drives);
    }

    drives.retain(|d| d.removable || d.mountpoint.starts_with("/run/media"));
    drives
}

pub fn parse_df(output: &str) -> Option<StorageUsage> {
    let lines: Vec<&str> = output.trim().lines().collect();
    if lines.len() < 2 {
        return None;
    }

    let parts: Vec<&str> = lines[1].split_whitespace().collect();
    if parts.len() < 4 {
        return None;
    }

    let total_kb = parts[1].parse::<u64>().ok()?;
    let used_kb = parts[2].parse::<u64>().ok()?;
    let free_kb = parts[3].parse::<u64>().ok()?;

    Some(StorageUsage {
        total: total_kb.checked_mul(1024)?,
        used: used_kb.checked_mul(1024)?,
        free: free_kb.checked_mul(1024)?,
    })
}

pub fn directory_size(path: &str) -> u64 {
    if path.trim().is_empty() {
        return 0;
    }

    let mut total: u64 = 0;
    for entry in walkdir::WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                total = total.saturating_add(meta.len());
            }
        }
    }
    total
}

pub fn get_drives() -> Vec<Drive> {
    let output = match Command::new("lsblk")
        .args(["--json", "-o", "NAME,LABEL,MOUNTPOINT,SIZE,TYPE,TRAN,RM"])
        .output()
    {
        Ok(out) if out.status.success() => out.stdout,
        _ => return Vec::new(),
    };

    let stdout_str = String::from_utf8_lossy(&output);
    parse_lsblk(&stdout_str)
}

pub fn get_storage_usage() -> Option<StorageUsage> {
    let output = match Command::new("df").args(["-kP", "/"]).output() {
        Ok(out) if out.status.success() => out.stdout,
        _ => return None,
    };

    let stdout_str = String::from_utf8_lossy(&output);
    parse_df(&stdout_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_lsblk_marks_usb_and_removable() {
        let json = r#"{
            "blockdevices": [
                {
                    "name": "sda",
                    "label": "InternalDrive",
                    "mountpoint": "/",
                    "size": "500G",
                    "type": "disk",
                    "tran": "sata",
                    "rm": false,
                    "children": []
                },
                {
                    "name": "sdb",
                    "label": null,
                    "mountpoint": null,
                    "size": "32G",
                    "type": "disk",
                    "tran": "usb",
                    "rm": 1,
                    "children": [
                        {
                            "name": "sdb1",
                            "label": "USB_DRIVE",
                            "mountpoint": "/media/usb",
                            "size": "32G",
                            "type": "part",
                            "tran": "usb",
                            "rm": 1
                        }
                    ]
                },
                {
                    "name": "sdc",
                    "label": "MediaCard",
                    "mountpoint": "/run/media/user/CARD",
                    "size": "64G",
                    "type": "disk",
                    "tran": null,
                    "rm": 0,
                    "children": []
                }
            ]
        }"#;

        let drives = parse_lsblk(json);
        assert_eq!(drives.len(), 2);

        let usb_drive = drives.iter().find(|d| d.name == "sdb1").expect("sdb1 drive");
        assert_eq!(usb_drive.label, "USB_DRIVE");
        assert_eq!(usb_drive.mountpoint, "/media/usb");
        assert_eq!(usb_drive.size, "32G");
        assert_eq!(usb_drive.kind, "part");
        assert!(usb_drive.removable);
        assert!(usb_drive.usb);

        let card_drive = drives.iter().find(|d| d.name == "sdc").expect("sdc drive");
        assert_eq!(card_drive.label, "MediaCard");
        assert_eq!(card_drive.mountpoint, "/run/media/user/CARD");
        assert_eq!(card_drive.size, "64G");
        assert_eq!(card_drive.kind, "disk");
        assert!(!card_drive.removable);
        assert!(!card_drive.usb);

        let serialized = serde_json::to_string(&usb_drive).unwrap();
        assert!(serialized.contains(r#""type":"part""#));
    }

    #[test]
    fn parse_lsblk_handles_numeric_and_string_rm() {
        let json = r#"{
            "blockdevices": [
                {
                    "name": "sdd",
                    "label": "",
                    "mountpoint": "/run/media/test",
                    "size": "16G",
                    "type": "disk",
                    "rm": "1"
                },
                {
                    "name": "sde",
                    "label": null,
                    "mountpoint": "/media/other",
                    "size": "8G",
                    "type": "disk",
                    "rm": 0
                }
            ]
        }"#;

        let drives = parse_lsblk(json);
        assert_eq!(drives.len(), 1);
        assert_eq!(drives[0].name, "sdd");
        assert_eq!(drives[0].label, "sdd"); // Fallback to name when label is empty
        assert!(drives[0].removable);
    }

    #[test]
    fn parse_lsblk_invalid_json_returns_empty() {
        assert!(parse_lsblk("not valid json").is_empty());
        assert!(parse_lsblk("{}").is_empty());
    }

    #[test]
    fn parse_df_converts_kib_to_bytes() {
        let output = "Filesystem     1024-blocks     Used Available Capacity Mounted on\n\
                      /dev/nvme0n1p3    91694792 37386044  49604904      43% /\n";

        let usage = parse_df(output).expect("valid storage usage");
        assert_eq!(usage.total, 91694792 * 1024);
        assert_eq!(usage.used, 37386044 * 1024);
        assert_eq!(usage.free, 49604904 * 1024);
    }

    #[test]
    fn parse_df_invalid_returns_none() {
        assert!(parse_df("").is_none());
        assert!(parse_df("header only\n").is_none());
        assert!(parse_df("header\npart1 part2\n").is_none());
        assert!(parse_df("header\nfs abc def ghi\n").is_none());
    }

    #[test]
    fn directory_size_sums_nested_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();

        let sub = root.join("sub");
        std::fs::create_dir(&sub).unwrap();
        let deeper = sub.join("deeper");
        std::fs::create_dir(&deeper).unwrap();

        std::fs::write(root.join("a.txt"), b"0123456789").unwrap(); // 10 bytes
        std::fs::write(sub.join("b.txt"), vec![b'x'; 25]).unwrap(); // 25 bytes
        std::fs::write(deeper.join("c.txt"), vec![b'y'; 15]).unwrap(); // 15 bytes

        let size = directory_size(root.to_str().unwrap());
        assert_eq!(size, 50);

        // Empty dir
        let empty_temp = tempfile::tempdir().unwrap();
        assert_eq!(directory_size(empty_temp.path().to_str().unwrap()), 0);

        // Empty path
        assert_eq!(directory_size(""), 0);
    }

    #[test]
    fn smoke_get_drives_and_storage() {
        // Just verify these live functions don't panic on Linux
        let _ = get_drives();
        let _ = get_storage_usage();
    }
}
