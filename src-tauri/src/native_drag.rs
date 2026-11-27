use std::collections::HashSet;
use std::path::Path;

const MAX_BADGE_NAME_CHARS: usize = 28;

fn normalize_trailing_slash(path: &str) -> &str {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() && path.starts_with('/') {
        "/"
    } else {
        trimmed
    }
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    if max_chars <= 3 {
        return ".".repeat(max_chars);
    }
    let prefix: String = text.chars().take(max_chars - 3).collect();
    format!("{prefix}...")
}

/// Validates and deduplicates absolute filesystem paths for native drag payloads.
pub fn validate_drag_paths(paths: &[String]) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Err("At least one path is required for native drag".to_string());
    }

    let mut seen = HashSet::with_capacity(paths.len());
    let mut validated = Vec::with_capacity(paths.len());

    for path in paths {
        if !path.starts_with('/') {
            return Err(format!("Drag path must be absolute: {path}"));
        }
        if path.contains('\0') {
            return Err("Drag path contains invalid NUL byte".to_string());
        }
        let normalized = normalize_trailing_slash(path);
        if seen.insert(normalized) {
            validated.push(normalized.to_string());
        }
    }

    Ok(validated)
}

/// Converts absolute paths to RFC 8089 `file://` URIs without trailing directory slashes.
pub fn format_file_uris(paths: &[String]) -> Vec<String> {
    paths
        .iter()
        .filter_map(|path| {
            let normalized = normalize_trailing_slash(path);
            url::Url::from_file_path(normalized)
                .ok()
                .map(|uri| uri.to_string())
        })
        .collect()
}

/// Joins paths with `\n` for `text/plain` drag targets such as terminal emulators.
pub fn format_plain_paths(paths: &[String]) -> String {
    paths.join("\n")
}

/// Formats the compact drag badge label (`<name>` or `<name> (+N)`), truncating long names.
pub fn build_drag_badge_text(paths: &[String], label: Option<&str>) -> String {
    let explicit_label = label.map(str::trim).filter(|s| !s.is_empty());
    if paths.is_empty() {
        return explicit_label
            .map(|l| truncate_chars(l, MAX_BADGE_NAME_CHARS))
            .unwrap_or_default();
    }

    let primary_raw = explicit_label.unwrap_or_else(|| {
        let normalized = normalize_trailing_slash(&paths[0]);
        Path::new(normalized)
            .file_name()
            .and_then(|n| n.to_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(normalized)
    });

    let primary = truncate_chars(primary_raw, MAX_BADGE_NAME_CHARS);
    if paths.len() > 1 {
        format!("{primary} (+{})", paths.len() - 1)
    } else {
        primary
    }
}

/// Returns whether GTK can safely initiate a drag from cached button-1 input state.
pub fn can_begin_drag(button1_pressed: bool, has_press_event: bool) -> bool {
    button1_pressed && has_press_event
}

/// Installs native drag source hooks for the given Tauri window.
pub fn install_for_window(window: &tauri::WebviewWindow) {
    platform::install_for_window(window);
}

/// Starts a native OS drag operation for `paths` from `window` if button 1 is currently pressed.
pub async fn start_drag_on_window(
    window: tauri::WebviewWindow,
    paths: Vec<String>,
    label: Option<String>,
    is_directory: bool,
) -> Result<bool, String> {
    let validated_paths = validate_drag_paths(&paths)?;
    platform::start_drag_on_window(window, validated_paths, label, is_directory).await
}

#[cfg(target_os = "linux")]
mod platform {
    use super::{
        build_drag_badge_text, can_begin_drag, format_file_uris, format_plain_paths,
    };
    use gtk::prelude::*;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::rc::Rc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration;
    use tauri::{Emitter, Manager};

    const TARGET_INFO_URI_LIST: u32 = 1;
    const TARGET_INFO_PLAIN_TEXT: u32 = 2;
    const DRAG_START_TIMEOUT_MS: u64 = 250;

    #[derive(Clone)]
    struct ActiveDragPayload {
        uris: Vec<String>,
        plain: String,
        badge: String,
        is_directory: bool,
    }

    #[derive(Default)]
    struct WindowDragState {
        last_press_event: Option<gdk::Event>,
        button1_pressed: bool,
        last_pos: (i32, i32),
        active_payload: Option<ActiveDragPayload>,
        webview_hooks_installed: bool,
        window_hooks_installed: bool,
    }

    thread_local! {
        static WINDOW_STATES: RefCell<HashMap<String, Rc<RefCell<WindowDragState>>>> =
            RefCell::new(HashMap::new());
    }

    fn get_or_init_window_state(label: &str) -> Rc<RefCell<WindowDragState>> {
        WINDOW_STATES.with(|states| {
            Rc::clone(
                states
                    .borrow_mut()
                    .entry(label.to_string())
                    .or_insert_with(|| Rc::new(RefCell::new(WindowDragState::default()))),
            )
        })
    }

    fn remove_window_state(label: &str) {
        WINDOW_STATES.with(|states| {
            states.borrow_mut().remove(label);
        });
    }

    fn widget_coords_in_toplevel(widget: &impl IsA<gtk::Widget>, x: f64, y: f64) -> (i32, i32) {
        let xi = x.round() as i32;
        let yi = y.round() as i32;
        if let Some(toplevel) = widget.toplevel() {
            if let Some((tx, ty)) = widget.translate_coordinates(&toplevel, xi, yi) {
                return (tx.max(0), ty.max(0));
            }
        }
        (xi.max(0), yi.max(0))
    }

    fn draw_rounded_rect(cr: &gtk::cairo::Context, x: f64, y: f64, w: f64, h: f64, r: f64) {
        let radius = r.min(w / 2.0).min(h / 2.0);
        let deg = std::f64::consts::FRAC_PI_2;
        cr.new_sub_path();
        cr.arc(x + w - radius, y + radius, radius, -deg, 0.0);
        cr.arc(x + w - radius, y + h - radius, radius, 0.0, deg);
        cr.arc(
            x + radius,
            y + h - radius,
            radius,
            deg,
            std::f64::consts::PI,
        );
        cr.arc(
            x + radius,
            y + radius,
            radius,
            std::f64::consts::PI,
            3.0 * deg,
        );
        cr.close_path();
    }

    fn draw_folder_glyph(
        cr: &gtk::cairo::Context,
        x: f64,
        y: f64,
        size: f64,
    ) -> Result<(), gtk::cairo::Error> {
        cr.set_source_rgba(0.66, 0.78, 0.98, 0.96);
        cr.new_path();
        cr.move_to(x + 1.5, y + 2.0);
        cr.line_to(x + size * 0.42, y + 2.0);
        cr.line_to(x + size * 0.54, y + 4.0);
        cr.line_to(x + size - 1.5, y + 4.0);
        cr.line_to(x + size - 1.5, y + size - 2.0);
        cr.line_to(x + 1.5, y + size - 2.0);
        cr.close_path();
        cr.fill()
    }

    fn draw_file_glyph(
        cr: &gtk::cairo::Context,
        x: f64,
        y: f64,
        size: f64,
    ) -> Result<(), gtk::cairo::Error> {
        cr.set_source_rgba(0.89, 0.90, 0.94, 0.96);
        let left = x + 2.0;
        let right = x + size - 2.0;
        let top = y + 1.0;
        let bottom = y + size - 1.0;
        let fold = 4.0;
        cr.new_path();
        cr.move_to(left, top);
        cr.line_to(right - fold, top);
        cr.line_to(right, top + fold);
        cr.line_to(right, bottom);
        cr.line_to(left, bottom);
        cr.close_path();
        cr.fill()
    }

    fn build_drag_badge_surface(
        scale_factor: i32,
        badge_text: &str,
        is_directory: bool,
    ) -> Result<gtk::cairo::ImageSurface, gtk::cairo::Error> {
        let scale = scale_factor.max(1) as f64;
        let measure_surface =
            gtk::cairo::ImageSurface::create(gtk::cairo::Format::ARgb32, 1, 1)?;
        let measure_ctx = gtk::cairo::Context::new(&measure_surface)?;
        measure_ctx.select_font_face(
            "Sans",
            gtk::cairo::FontSlant::Normal,
            gtk::cairo::FontWeight::Bold,
        );
        measure_ctx.set_font_size(12.5);
        let extents = measure_ctx.text_extents(badge_text)?;
        drop(measure_ctx);

        let pad_x = 12.0;
        let icon_size = 14.0;
        let gap = 8.0;
        let pill_h = 34.0;
        let text_w = extents.x_advance().max(extents.width()).ceil();
        let pill_w = (pad_x + icon_size + gap + text_w + pad_x).clamp(84.0, 480.0);

        let px_w = (pill_w * scale).ceil() as i32;
        let px_h = (pill_h * scale).ceil() as i32;
        let surface = gtk::cairo::ImageSurface::create(gtk::cairo::Format::ARgb32, px_w, px_h)?;
        surface.set_device_scale(scale, scale);

        {
            let cr = gtk::cairo::Context::new(&surface)?;
            draw_rounded_rect(&cr, 0.5, 0.5, pill_w - 1.0, pill_h - 1.0, 10.0);
            cr.set_source_rgba(0.13, 0.14, 0.17, 0.92);
            cr.fill_preserve()?;
            cr.set_source_rgba(1.0, 1.0, 1.0, 0.18);
            cr.set_line_width(1.0);
            cr.stroke()?;

            let icon_x = pad_x;
            let icon_y = (pill_h - icon_size) / 2.0;
            if is_directory {
                draw_folder_glyph(&cr, icon_x, icon_y, icon_size)?;
            } else {
                draw_file_glyph(&cr, icon_x, icon_y, icon_size)?;
            }

            cr.select_font_face(
                "Sans",
                gtk::cairo::FontSlant::Normal,
                gtk::cairo::FontWeight::Bold,
            );
            cr.set_font_size(12.5);
            cr.set_source_rgba(0.95, 0.96, 0.98, 0.98);
            let text_x = pad_x + icon_size + gap;
            let text_y = (pill_h - extents.height()) / 2.0 - extents.y_bearing();
            cr.move_to(text_x, text_y);
            cr.show_text(badge_text)?;
        }

        surface.flush();
        // Positive device offset shifts the drag pill down-right of the cursor hotspot, scaled for HiDPI.
        surface.set_device_offset(16.0 * scale, 20.0 * scale);
        Ok(surface)
    }

    fn finish_active_drag(state: &Rc<RefCell<WindowDragState>>, app_handle: &tauri::AppHandle) {
        let was_ours = {
            let mut s = state.borrow_mut();
            s.button1_pressed = false;
            s.last_press_event = None;
            s.active_payload.take().is_some()
        };
        if was_ours {
            let _ = app_handle.emit("fs:native-drag-ended", ());
        }
    }

    pub fn install_for_window(window: &tauri::WebviewWindow) {
        let window_label = window.label().to_string();
        let label_for_webview = window_label.clone();
        let _ = window.with_webview(move |platform_webview| {
            let state = get_or_init_window_state(&label_for_webview);
            {
                let mut s = state.borrow_mut();
                if s.webview_hooks_installed {
                    return;
                }
                s.webview_hooks_installed = true;
            }

            let webview = platform_webview.inner();
            webview.add_events(
                gdk::EventMask::BUTTON_PRESS_MASK
                    | gdk::EventMask::BUTTON_RELEASE_MASK
                    | gdk::EventMask::BUTTON1_MOTION_MASK,
            );

            let state_press = Rc::clone(&state);
            webview.connect_button_press_event(move |wv, event| {
                if event.button() == 1 {
                    let (x, y) = event.position();
                    let pos = widget_coords_in_toplevel(wv, x, y);
                    let mut s = state_press.borrow_mut();
                    s.last_press_event = Some(gdk::Event::clone(event));
                    s.button1_pressed = true;
                    s.last_pos = pos;
                }
                gtk::glib::Propagation::Proceed
            });

            let state_motion = Rc::clone(&state);
            webview.connect_motion_notify_event(move |wv, event| {
                let mut s = state_motion.borrow_mut();
                if s.button1_pressed {
                    if !event.state().contains(gdk::ModifierType::BUTTON1_MASK) {
                        s.button1_pressed = false;
                        s.last_press_event = None;
                    } else {
                        let (x, y) = event.position();
                        s.last_pos = widget_coords_in_toplevel(wv, x, y);
                    }
                }
                gtk::glib::Propagation::Proceed
            });

            let state_release = Rc::clone(&state);
            webview.connect_button_release_event(move |_wv, event| {
                if event.button() == 1 {
                    let mut s = state_release.borrow_mut();
                    s.button1_pressed = false;
                    s.last_press_event = None;
                }
                gtk::glib::Propagation::Proceed
            });

            let state_focus_out = Rc::clone(&state);
            webview.connect_focus_out_event(move |_wv, _event| {
                let mut s = state_focus_out.borrow_mut();
                if s.active_payload.is_none() {
                    s.button1_pressed = false;
                    s.last_press_event = None;
                }
                gtk::glib::Propagation::Proceed
            });
        });

        let window_for_main = window.clone();
        let app_handle = window.app_handle().clone();
        let _ = window.run_on_main_thread(move || {
            let Ok(gtk_window) = window_for_main.gtk_window() else {
                return;
            };
            let state = get_or_init_window_state(&window_label);
            {
                let mut s = state.borrow_mut();
                if s.window_hooks_installed {
                    return;
                }
                s.window_hooks_installed = true;
            }

            let state_get = Rc::clone(&state);
            gtk_window.connect_drag_data_get(move |_widget, _context, selection_data, info, _| {
                let payload = state_get.borrow().active_payload.clone();
                let Some(payload) = payload else {
                    return;
                };
                match info {
                    TARGET_INFO_URI_LIST => {
                        let uri_refs: Vec<&str> =
                            payload.uris.iter().map(String::as_str).collect();
                        selection_data.set_uris(&uri_refs);
                    }
                    TARGET_INFO_PLAIN_TEXT => {
                        selection_data.set_text(&payload.plain);
                    }
                    _ => {}
                }
            });

            let state_begin = Rc::clone(&state);
            gtk_window.connect_drag_begin(move |widget, context| {
                let payload = state_begin.borrow().active_payload.clone();
                let Some(payload) = payload else {
                    return;
                };

                match build_drag_badge_surface(
                    widget.scale_factor(),
                    &payload.badge,
                    payload.is_directory,
                ) {
                    Ok(surface) => {
                        context.drag_set_icon_surface(&surface);
                    }
                    Err(_) => {
                        let icon_name = if payload.is_directory {
                            "folder"
                        } else {
                            "text-x-generic"
                        };
                        context.drag_set_icon_name(icon_name, 0, 0);
                    }
                }
            });

            let state_end = Rc::clone(&state);
            let app_end = app_handle.clone();
            gtk_window.connect_drag_end(move |_widget, _context| {
                finish_active_drag(&state_end, &app_end);
            });

            let state_failed = Rc::clone(&state);
            let app_failed = app_handle.clone();
            gtk_window.connect_drag_failed(move |_widget, _context, _result| {
                finish_active_drag(&state_failed, &app_failed);
                gtk::glib::Propagation::Proceed
            });

            let destroy_label = window_label.clone();
            gtk_window.connect_destroy(move |_| {
                remove_window_state(&destroy_label);
            });
        });
    }

    pub async fn start_drag_on_window(
        window: tauri::WebviewWindow,
        paths: Vec<String>,
        label: Option<String>,
        is_directory: bool,
    ) -> Result<bool, String> {
        let uris = format_file_uris(&paths);
        if uris.is_empty() {
            return Ok(false);
        }
        let plain = format_plain_paths(&paths);
        let badge = build_drag_badge_text(&paths, label.as_deref());
        let payload = ActiveDragPayload {
            uris,
            plain,
            badge,
            is_directory,
        };

        let window_label = window.label().to_string();
        let window_for_main = window.clone();
        let (tx, rx) = std::sync::mpsc::sync_channel::<Result<bool, String>>(1);
        let timed_out = Arc::new(AtomicBool::new(false));
        let timed_out_main = Arc::clone(&timed_out);

        window
            .run_on_main_thread(move || {
                if timed_out_main.load(Ordering::Acquire) {
                    return;
                }
                let result = (|| -> Result<bool, String> {
                    let state = get_or_init_window_state(&window_label);
                    let (can_begin, press_event, x, y) = {
                        let s = state.borrow();
                        (
                            can_begin_drag(s.button1_pressed, s.last_press_event.is_some()),
                            s.last_press_event.clone(),
                            s.last_pos.0,
                            s.last_pos.1,
                        )
                    };

                    if !can_begin {
                        return Ok(false);
                    }

                    let gtk_window = window_for_main
                        .gtk_window()
                        .map_err(|e| format!("Failed to access GTK window: {e}"))?;

                    let targets = gtk::TargetList::new(&[]);
                    targets.add_uri_targets(TARGET_INFO_URI_LIST);
                    targets.add_text_targets(TARGET_INFO_PLAIN_TEXT);

                    {
                        let mut s = state.borrow_mut();
                        s.active_payload = Some(payload);
                    }

                    // Initiate drag on the outer GtkApplicationWindow so WebKitGTK's
                    // WebView drop receiver handles same-window Enter/Over/Drop/Leave.
                    let ctx = gtk_window.drag_begin_with_coordinates(
                        &targets,
                        gdk::DragAction::COPY,
                        1,
                        press_event.as_ref(),
                        x,
                        y,
                    );

                    if ctx.is_some() {
                        Ok(true)
                    } else {
                        let mut s = state.borrow_mut();
                        s.active_payload = None;
                        s.button1_pressed = false;
                        s.last_press_event = None;
                        Ok(false)
                    }
                })();
                let _ = tx.send(result);
            })
            .map_err(|e| format!("Failed to dispatch native drag to GTK main thread: {e}"))?;

        tauri::async_runtime::spawn_blocking(move || {
            match rx.recv_timeout(Duration::from_millis(DRAG_START_TIMEOUT_MS)) {
                Ok(res) => res,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    timed_out.store(true, Ordering::Release);
                    Err("Timed out waiting for GTK main thread to begin native drag".to_string())
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    Err("GTK main thread native drag channel disconnected".to_string())
                }
            }
        })
        .await
        .map_err(|e| format!("Native drag task failed: {e}"))?
    }
}

#[cfg(not(target_os = "linux"))]
mod platform {
    pub fn install_for_window(_window: &tauri::WebviewWindow) {}

    pub async fn start_drag_on_window(
        _window: tauri::WebviewWindow,
        _paths: Vec<String>,
        _label: Option<String>,
        _is_directory: bool,
    ) -> Result<bool, String> {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_drag_paths_rejects_empty_relative_and_nul_and_deduplicates() {
        assert!(validate_drag_paths(&[]).is_err());
        assert!(validate_drag_paths(&["".to_string()]).is_err());
        assert!(validate_drag_paths(&["rel/a.txt".to_string()]).is_err());
        assert!(validate_drag_paths(&["/tmp/bad\0.txt".to_string()]).is_err());
        assert!(validate_drag_paths(&["/a.txt".to_string(), "rel/b.txt".to_string()]).is_err());

        assert_eq!(
            validate_drag_paths(&[
                "/a.txt".to_string(),
                "/b".to_string(),
                "/a.txt".to_string(),
            ]),
            Ok(vec!["/a.txt".to_string(), "/b".to_string()])
        );

        assert_eq!(
            validate_drag_paths(&[
                "/tmp/dir/".to_string(),
                "/tmp/dir".to_string(),
                "/".to_string(),
                "///".to_string(),
            ]),
            Ok(vec!["/tmp/dir".to_string(), "/".to_string()])
        );
    }

    #[test]
    fn format_file_uris_encodes_spaces_utf8_hash_percent_and_omits_dir_trailing_slash() {
        let uris = format_file_uris(&[
            "/tmp/my folder/café #1%.png".to_string(),
            "/tmp/my dir/".to_string(),
            "/".to_string(),
        ]);

        assert_eq!(
            uris,
            vec![
                "file:///tmp/my%20folder/caf%C3%A9%20%231%25.png".to_string(),
                "file:///tmp/my%20dir".to_string(),
                "file:///".to_string(),
            ]
        );
    }

    #[test]
    fn format_plain_paths_joins_with_newlines() {
        assert_eq!(
            format_plain_paths(&["/a".to_string(), "/b c".to_string()]),
            "/a\n/b c"
        );
    }

    #[test]
    fn build_drag_badge_text_single_multi_and_truncation() {
        assert_eq!(
            build_drag_badge_text(&["/tmp/report.pdf".to_string()], None),
            "report.pdf"
        );
        assert_eq!(
            build_drag_badge_text(&["/tmp/my folder/".to_string()], None),
            "my folder"
        );
        assert_eq!(
            build_drag_badge_text(&["/tmp/a.txt".to_string()], Some("Custom Label")),
            "Custom Label"
        );
        assert_eq!(
            build_drag_badge_text(
                &[
                    "/tmp/a.txt".to_string(),
                    "/tmp/b.txt".to_string(),
                    "/tmp/c.txt".to_string(),
                ],
                None
            ),
            "a.txt (+2)"
        );

        let long_name = "this_is_a_very_long_filename_exceeding_twenty_eight_chars.txt";
        let single_truncated = build_drag_badge_text(&[format!("/tmp/{long_name}")], None);
        assert!(single_truncated.ends_with("..."));
        assert_eq!(single_truncated.chars().count(), 28);

        let multi_truncated = build_drag_badge_text(
            &[
                format!("/tmp/{long_name}"),
                "/tmp/b.txt".to_string(),
                "/tmp/c.txt".to_string(),
            ],
            None,
        );
        assert!(multi_truncated.ends_with(" (+2)"));
        assert!(multi_truncated.contains("..."));
        assert!(multi_truncated.starts_with("this_is_a_very_long_filen..."));

        let utf8_long = "é".repeat(32);
        let utf8_truncated = build_drag_badge_text(&[format!("/tmp/{utf8_long}")], None);
        assert!(utf8_truncated.ends_with("..."));
        assert_eq!(utf8_truncated.chars().count(), 28);
    }

    #[test]
    fn start_drag_returns_false_when_button_not_pressed_state() {
        assert!(!can_begin_drag(false, true));
        assert!(!can_begin_drag(true, false));
        assert!(!can_begin_drag(false, false));
        assert!(can_begin_drag(true, true));
    }
}
