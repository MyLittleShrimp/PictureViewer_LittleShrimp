// 发布模式下关闭控制台窗口（纯 GUI 程序）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// 应用支持的图片扩展名（与前端 imageLoader 的支持列表一致）
const IMAGE_EXTS: [&str; 10] = [
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "tga", "tif", "tiff",
];

/// 覆盖层窗口 label 前缀（多屏时每屏一个：screenshot-overlay-0/1/...）
const OVERLAY_PREFIX: &str = "screenshot-overlay";

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

// ---------------- 原生拖框截图（多显示器） ----------------

/// 截图流程进行中标志（热键/按钮重复触发、覆盖层重复创建的统一防护）
static CAPTURING: AtomicBool = AtomicBool::new(false);

/// 各显示器已抓取的全屏 PNG 字节（按屏 index），等覆盖层窗口就绪后来拉取
struct ScreenshotStore(Mutex<Vec<Vec<u8>>>);

/// 被「有意关闭」的覆盖层 label 清单：
/// claim/finish/cancel 主动关窗前先登记，Destroyed 处理据此区分用户异常关闭（Alt+F4 等）
struct ClosingIntent(Mutex<Vec<String>>);

/// 恢复主窗口并重置进行标志（幂等：成功/取消/覆盖层被异常关闭都会走到）
fn restore_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    CAPTURING.store(false, Ordering::SeqCst);
}

/// 关闭全部截图覆盖层（except 可保留指定 label，用于 claim 后只留当前操作屏）
fn close_all_overlays(app: &tauri::AppHandle, except: Option<&str>) {
    let labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|l| l.starts_with(OVERLAY_PREFIX) && Some(l.as_str()) != except)
        .cloned()
        .collect();
    // 先登记意图，再关窗：这些窗口随后的 Destroyed 不再触发"异常关闭"兜底
    if let Ok(mut g) = app.state::<ClosingIntent>().0.lock() {
        g.extend(labels.iter().cloned());
    }
    for label in labels {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.close();
        }
    }
}

/// 截图启动流程（按钮与全局热键共用）：藏主窗 → 抓全部屏 → 每屏建全屏选区覆盖层
async fn start_screenshot_impl(app: tauri::AppHandle) -> Result<(), String> {
    if CAPTURING.swap(true, Ordering::SeqCst) {
        return Ok(()); // 已在截图中，忽略重复触发
    }
    match do_start(&app).await {
        Ok(()) => Ok(()),
        Err(e) => {
            close_all_overlays(&app, None);
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

    // 抓取所有显示器（必须在覆盖层出现之前，否则会把覆盖层自己截进去）。
    // 各屏 scale_factor 可能不同：display_info 的 x/y 是物理坐标，
    // 窗口 position 用逻辑坐标 = 物理 / scale_factor（前端裁剪再用各窗口 dpr 换算回物理）。
    let screens = screenshots::Screen::all().map_err(|e| e.to_string())?;
    if screens.is_empty() {
        return Err("未找到可用显示器".to_string());
    }
    let mut infos: Vec<(i32, i32, f64, bool)> = Vec::new(); // (x, y, scale_factor, is_primary)
    let mut pngs: Vec<Vec<u8>> = Vec::new();
    for screen in &screens {
        let image = screen.capture().map_err(|e| e.to_string())?;
        let mut buf = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut buf, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        pngs.push(buf.into_inner());
        let d = screen.display_info;
        infos.push((d.x, d.y, d.scale_factor as f64, d.is_primary));
    }
    *app
        .state::<ScreenshotStore>()
        .0
        .lock()
        .map_err(|_| "内部状态错误".to_string())? = pngs;

    let primary_idx = infos.iter().position(|i| i.3).unwrap_or(0);
    let mut build_err: Option<String> = None;
    for (i, (x, y, sf, _)) in infos.iter().enumerate() {
        let label = format!("{OVERLAY_PREFIX}-{i}");
        let overlay_result = tauri::WebviewWindowBuilder::new(
            app,
            &label,
            tauri::WebviewUrl::App(format!("index.html?mode=screenshot&screen={i}").into()),
        )
        .title("截图")
        // 显式定位到对应显示器 origin（多屏坐标系可能含负数），再 fullscreen 覆盖该屏
        .position(*x as f64 / *sf, *y as f64 / *sf)
        .fullscreen(true)
        .always_on_top(true)
        .decorations(false)
        .skip_taskbar(true)
        .resizable(false)
        .focused(i == primary_idx)
        .build();
        match overlay_result {
            Ok(overlay) => {
                // 任一覆盖层被异常关闭（Alt+F4 等）→ 关掉其余覆盖层并恢复主窗口；
                // 主动关闭（claim/finish/cancel）已在 ClosingIntent 登记，直接忽略
                let app_for_event = app.clone();
                let label_for_event = label.clone();
                overlay.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::Destroyed) {
                        let intentional = app_for_event
                            .state::<ClosingIntent>()
                            .0
                            .lock()
                            .map(|mut g| {
                                if let Some(pos) = g.iter().position(|l| *l == label_for_event) {
                                    g.remove(pos);
                                    true
                                } else {
                                    false
                                }
                            })
                            .unwrap_or(false);
                        if !intentional {
                            close_all_overlays(&app_for_event, None);
                            restore_main(&app_for_event);
                        }
                    }
                });
            }
            Err(e) => {
                build_err = Some(e.to_string());
                break;
            }
        }
    }
    if let Some(e) = build_err {
        close_all_overlays(app, None);
        return Err(e);
    }
    Ok(())
}

#[tauri::command]
async fn start_screenshot(app: tauri::AppHandle) -> Result<(), String> {
    start_screenshot_impl(app).await
}

/// 覆盖层拉取本屏已抓取的 PNG（clone 不 take，允许重试）
#[tauri::command]
fn take_screenshot(state: tauri::State<ScreenshotStore>, index: usize) -> Result<Vec<u8>, String> {
    state
        .0
        .lock()
        .map_err(|_| "内部状态错误".to_string())?
        .get(index)
        .cloned()
        .ok_or_else(|| format!("截图尚未就绪（屏 {index}）"))
}

/// 用户在某块屏上开始拖框：关掉其他屏的覆盖层，只留当前这层
#[tauri::command]
fn claim_screenshot(app: tauri::AppHandle, index: usize) {
    let keep = format!("{OVERLAY_PREFIX}-{index}");
    close_all_overlays(&app, Some(&keep));
}

/// 覆盖层完成选区：写入临时文件 → 复用主窗口 open-file 监听导入 → 关全部覆盖层并恢复主窗口
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
    close_all_overlays(&app, None);
    restore_main(&app);
    Ok(())
}

/// 覆盖层取消（Esc）：关全部覆盖层并恢复主窗口
#[tauri::command]
fn cancel_screenshot(app: tauri::AppHandle) {
    close_all_overlays(&app, None);
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
        // 全局热键 Ctrl+Shift+P：与「自由截图」按钮同一流程
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut("Ctrl+Shift+P")
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
            app.manage(ScreenshotStore(Mutex::new(Vec::new())));
            app.manage(ClosingIntent(Mutex::new(Vec::new())));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_pending_file,
            start_screenshot,
            take_screenshot,
            claim_screenshot,
            finish_screenshot,
            cancel_screenshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
