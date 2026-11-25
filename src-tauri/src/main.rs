// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args()
        .skip(1)
        .any(|arg| arg == "--version" || arg == "-V")
    {
        println!("bug-on-files-m3 {}", env!("CARGO_PKG_VERSION"));
        return;
    }

    materials_lib::run();
}
