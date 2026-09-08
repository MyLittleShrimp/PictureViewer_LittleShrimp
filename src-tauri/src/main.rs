// 发布模式下关闭控制台窗口（纯 GUI 程序）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// 应用支持的图片扩展名（与前端 imageLoader 的支持列表一致）
const IMAGE_EXTS: [&str; 10] = [
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "tga", "tif", "tiff",
];

/// 从 argv 中提取图片路径：跳过 exe 自身（第 0 项）与 '-' 开头的开关参数，
/// 只接受真实存在且扩展名受支持的文件。
fn extract_image_path(args: Vec<String>) -> Option<String> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .find(|a| {
            let ext = a.rsplit('.').next().unwrap_or("").to_lowercase();
            IMAGE_EXTS.contains(&ext.as_str()) && std::path::Path::new(a).is_file()
        })
}

/// 启动参数带来的待打开图片（前端就绪后主动拉取，避免事件竞态丢失）
struct PendingFile(Mutex<Option<String>>);

#[tauri::command]
fn get_pending_file(state: tauri::State<PendingFile>) -> Option<String> {
    state.0.lock().ok()?.take()
}

fn main() {
    tauri::Builder::default()
        // 单实例：文件关联双击时若程序已在运行，argv 转交已运行实例并聚焦窗口
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = extract_image_path(argv) {
                // 前端若在监听则实时送达；同时存 pending 兜底（listener 未就绪时）
                if let Some(state) = app.try_state::<PendingFile>() {
                    if let Ok(mut guard) = state.0.lock() {
                        *guard = Some(path.clone());
                    }
                }
                let _ = app.emit("open-file", path);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let pending = extract_image_path(std::env::args().collect());
            app.manage(PendingFile(Mutex::new(pending)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_pending_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
