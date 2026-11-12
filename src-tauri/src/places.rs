use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PlaceKey {
    Home,
    Desktop,
    Documents,
    Downloads,
    Music,
    Pictures,
    Videos,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlaceItem {
    pub name: String,
    pub path: String,
    pub icon: String,
}

pub struct PlaceDef {
    pub key: PlaceKey,
    pub name: &'static str,
    pub icon: &'static str,
}

pub const PLACE_DEFINITIONS: &[PlaceDef] = &[
    PlaceDef {
        key: PlaceKey::Home,
        name: "Home",
        icon: "🏠",
    },
    PlaceDef {
        key: PlaceKey::Desktop,
        name: "Desktop",
        icon: "🖥️",
    },
    PlaceDef {
        key: PlaceKey::Documents,
        name: "Documents",
        icon: "📄",
    },
    PlaceDef {
        key: PlaceKey::Downloads,
        name: "Downloads",
        icon: "⬇️",
    },
    PlaceDef {
        key: PlaceKey::Music,
        name: "Music",
        icon: "🎵",
    },
    PlaceDef {
        key: PlaceKey::Pictures,
        name: "Pictures",
        icon: "🖼️",
    },
    PlaceDef {
        key: PlaceKey::Videos,
        name: "Videos",
        icon: "🎥",
    },
];

pub fn strip_trailing_slashes(p: &str) -> &str {
    if p.is_empty() || p == "/" {
        return p;
    }
    let trimmed = p.trim_end_matches('/');
    if trimmed.is_empty() && p.starts_with('/') {
        "/"
    } else {
        trimmed
    }
}

pub fn resolve_places(
    home: &str,
    system_path: impl Fn(PlaceKey) -> Option<String>,
) -> Vec<PlaceItem> {
    let normalized_home = strip_trailing_slashes(home);

    PLACE_DEFINITIONS
        .iter()
        .map(|def| {
            if def.key == PlaceKey::Home {
                return PlaceItem {
                    name: def.name.to_string(),
                    path: normalized_home.to_string(),
                    icon: def.icon.to_string(),
                };
            }

            let resolved = system_path(def.key)
                .map(|p| strip_trailing_slashes(&p).to_string())
                .unwrap_or_default();

            let path = if resolved.is_empty() || resolved == normalized_home {
                if normalized_home == "/" {
                    format!("/{}", def.name)
                } else if normalized_home.is_empty() {
                    def.name.to_string()
                } else {
                    format!("{}/{}", normalized_home, def.name)
                }
            } else {
                resolved
            };

            PlaceItem {
                name: def.name.to_string(),
                path,
                icon: def.icon.to_string(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_trailing_slashes() {
        assert_eq!(strip_trailing_slashes(""), "");
        assert_eq!(strip_trailing_slashes("/"), "/");
        assert_eq!(strip_trailing_slashes("/home/stark"), "/home/stark");
        assert_eq!(strip_trailing_slashes("/home/stark/"), "/home/stark");
        assert_eq!(strip_trailing_slashes("/home/stark///"), "/home/stark");
    }

    #[test]
    fn test_resolve_places_falls_back_to_home_folder_name_when_system_path_returns_home_dir_or_none() {
        let places = resolve_places("/home/stark", |key| {
            match key {
                PlaceKey::Home => Some("/home/stark".to_string()),
                PlaceKey::Documents => Some("/home/stark".to_string()),
                PlaceKey::Downloads => Some("/home/stark/".to_string()),
                PlaceKey::Music => None,
                PlaceKey::Desktop => Some("/home/stark/Desktop".to_string()),
                PlaceKey::Pictures => Some("/home/stark/Pictures".to_string()),
                PlaceKey::Videos => Some("/home/stark/Videos".to_string()),
            }
        });

        assert_eq!(
            places,
            vec![
                PlaceItem {
                    name: "Home".to_string(),
                    path: "/home/stark".to_string(),
                    icon: "🏠".to_string(),
                },
                PlaceItem {
                    name: "Desktop".to_string(),
                    path: "/home/stark/Desktop".to_string(),
                    icon: "🖥️".to_string(),
                },
                PlaceItem {
                    name: "Documents".to_string(),
                    path: "/home/stark/Documents".to_string(),
                    icon: "📄".to_string(),
                },
                PlaceItem {
                    name: "Downloads".to_string(),
                    path: "/home/stark/Downloads".to_string(),
                    icon: "⬇️".to_string(),
                },
                PlaceItem {
                    name: "Music".to_string(),
                    path: "/home/stark/Music".to_string(),
                    icon: "🎵".to_string(),
                },
                PlaceItem {
                    name: "Pictures".to_string(),
                    path: "/home/stark/Pictures".to_string(),
                    icon: "🖼️".to_string(),
                },
                PlaceItem {
                    name: "Videos".to_string(),
                    path: "/home/stark/Videos".to_string(),
                    icon: "🎥".to_string(),
                },
            ]
        );
    }

    #[test]
    fn test_resolve_places_when_home_has_trailing_slash() {
        let places = resolve_places("/home/stark/", |_| None);
        assert_eq!(places.len(), 7);
        assert_eq!(places[0].path, "/home/stark");
        assert_eq!(places[1].path, "/home/stark/Desktop");
    }

    #[test]
    fn test_resolve_places_root_home() {
        let places = resolve_places("/", |_| None);
        assert_eq!(places[0].path, "/");
        assert_eq!(places[1].path, "/Desktop");
    }
}
