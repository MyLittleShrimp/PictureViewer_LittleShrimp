// 发布模式下关闭控制台窗口（纯 GUI 程序）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
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

// ---------------- 原生拖框截图 ----------------

/// 截图流程进行中标志（热键/按钮重复触发、覆盖层重复创建的统一防护）
static CAPTURING: AtomicBool = AtomicBool::new(false);

/// 已抓取的全屏 PNG 字节，等覆盖层窗口就绪后来拉取
struct ScreenshotStore(Mutex<Option<Vec<u8>>>);

/// 恢复主窗口并重置进行标志（幂等：成功/取消/覆盖层被异常关闭都会走到）
fn restore_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    CAPTURING.store(false, Ordering::SeqCst);
}

/// 抓取主显示器全屏画面 → PNG 字节。
/// 多显示器：先只支持主屏（display_info.is_primary），后续可按鼠标所在屏扩展。
fn capture_primary_png() -> Result<Vec<u8>, String> {
    let screens = screenshots::Screen::all().map_err(|e| e.to_string())?;
    let primary = screens
        .iter()
        .find(|s| s.display_info.is_primary)
        .or(screens.first())
        .ok_or_else(|| "未找到可用显示器".to_string())?;
    let image = primary.capture().map_err(|e| e.to_string())?;
    let mut buf = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(buf.into_inner())
}

/// 截图启动流程（按钮与全局热键共用）：藏主窗 → 抓屏 → 建全屏选区覆盖层
async fn start_screenshot_impl(app: tauri::AppHandle) -> Result<(), String> {
    if CAPTURING.swap(true, Ordering::SeqCst) {
        return Ok(()); // 已在截图中，忽略重复触发
    }
    match do_start(&app).await {
        Ok(()) => Ok(()),
        Err(e) => {
            restore_main(&app);
            Err(e)
        }
    }
}

async fn do_start(app: &tauri::AppHandle) -> Result<(), String> {
    // 先隐藏主窗口（避免截到自己），给 DWM 一点时间真正移出画面
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    std::thread::sleep(std::time::Duration::from_millis(200));

    // 抓屏（必须在覆盖层出现之前，否则会把覆盖层自己截进去）
    let bytes = capture_primary_png()?;
    app.state::<ScreenshotStore>()
        .0
        .lock()
        .map_err(|_| "内部状态错误".to_string())?
        .replace(bytes);

    // 全屏置顶覆盖层：加载同一前端的 ?mode=screenshot 选区 UI
    let app_for_event = app.clone();
    let overlay = tauri::WebviewWindowBuilder::new(
        app,
        "screenshot-overlay",
        tauri::WebviewUrl::App("index.html?mode=screenshot".into()),
    )
    .title("截图")
    .fullscreen(true)
    .always_on_top(true)
    .decorations(false)
    .skip_taskbar(true)
    .resizable(false)
    .focused(true)
    .build()
    .map_err(|e| e.to_string())?;
    // 覆盖层被任何方式关闭（含 Alt+F4）都要恢复主窗口，兜底成功/取消之外的路径
    overlay.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            restore_main(&app_for_event);
        }
    });
    Ok(())
}

#[tauri::command]
async fn start_screenshot(app: tauri::AppHandle) -> Result<(), String> {
    start_screenshot_impl(app).await
}

/// 覆盖层拉取已抓取的全屏 PNG（clone 不 take，允许重试）
#[tauri::command]
fn take_screenshot(state: tauri::State<ScreenshotStore>) -> Result<Vec<u8>, String> {
    state
        .0
        .lock()
        .map_err(|_| "内部状态错误".to_string())?
        .clone()
        .ok_or_else(|| "截图尚未就绪".to_string())
}

/// 覆盖层完成选区：写入临时文件 → 复用主窗口 open-file 监听导入 → 恢复主窗口
#[tauri::command]
fn finish_screenshot(app: tauri::AppHandle, bytes: Vec<u8>) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("截图数据为空".to_string());
    }
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("截图_{millis}.png"));
    std::fs::write(&path, &bytes).map_err(|e| format!("写入临时截图失败: {e}"))?;
    let _ = app.emit("open-file", path.to_string_lossy().to_string());
    if let Some(overlay) = app.get_webview_window("screenshot-overlay") {
        let _ = overlay.close();
    }
    restore_main(&app);
    Ok(())
}

/// 覆盖层取消（Esc）
#[tauri::command]
fn cancel_screenshot(app: tauri::AppHandle) {
    if let Some(overlay) = app.get_webview_window("screenshot-overlay") {
        let _ = overlay.close();
    }
    restore_main(&app);
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
        // 全局热键 Ctrl+Shift+A：与「截图」按钮同一流程
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut("Ctrl+Shift+A")
                .expect("无效的截图热键")
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = start_screenshot_impl(app).await;
                        });
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let pending = extract_image_path(std::env::args().collect());
            app.manage(PendingFile(Mutex::new(pending)));
            app.manage(ScreenshotStore(Mutex::new(None)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_pending_file,
            start_screenshot,
            take_screenshot,
            finish_screenshot,
            cancel_screenshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
